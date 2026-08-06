/**
 * Proxy para a API de estoque do ERP.
 *
 * No Themis 1.x o navegador chamava `erp.nuvem3.com.br` direto. Passando por aqui
 * ganhamos: o endereço do ERP some do bundle, o timeout e o retry ficam do lado do
 * servidor (celular do funcionário não precisa segurar a requisição), e a validação do
 * payload acontece antes de sair da nossa rede.
 *
 * ⚠️ O **contrato com o ERP é o do 1.x, campo por campo**. Ele rodou anos em produção; é a
 * única prova que temos do que a Nuvem3 aceita. Qualquer campo a menos, ou com tipo
 * diferente, é uma aposta que não temos como testar sem mexer no estoque real da empresa.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

/**
 * Payload da atualização — **os oito campos do Themis 1.x**, com os mesmos tipos.
 *
 * `IdProduto` é inteiro, não texto: o 1.x fazia `parseInt` antes de enviar. API .NET com
 * `System.Text.Json` recusa `"123"` num campo `int` por padrão, então mandar string era
 * arriscar um 400 que só apareceria em produção.
 *
 * `NomeProduto`, `EstoqueMinimo`, `PrecoVenda` e `PrecoCusto` não são decorativos: são
 * parte da especificação que o 1.x seguia. Omitir campo que o ERP espera pode significar
 * "não mexe" ou "zera", e a diferença entre os dois é o preço do produto no sistema.
 */
interface AtualizacaoEstoque {
  IdProduto: number;
  HashLoja: string;
  Quantidade: number;
  CodigoBarras: string;
  NomeProduto: string;
  EstoqueMinimo: number;
  PrecoVenda: number;
  PrecoCusto: number;
}

const schemaAtualizacao = {
  body: {
    type: 'object',
    required: [
      'IdProduto',
      'HashLoja',
      'Quantidade',
      'CodigoBarras',
      'NomeProduto',
      'EstoqueMinimo',
      'PrecoVenda',
      'PrecoCusto',
    ],
    additionalProperties: false,
    properties: {
      // `> 0` como no `validateProductData` do 1.x: id zero nunca identifica produto.
      IdProduto: { type: 'integer', minimum: 1 },
      HashLoja: { type: 'string', minLength: 1 },
      // Quantidade negativa nunca é contagem válida e o ERP a rejeita silenciosamente.
      Quantidade: { type: 'number', minimum: 0 },
      // Vazio é permitido: o 1.x só exigia que o campo existisse, e produto sem código de
      // barras é comum no cadastro. Exigir `minLength: 1` bloquearia envio que o 1.x fazia.
      CodigoBarras: { type: 'string' },
      NomeProduto: { type: 'string' },
      EstoqueMinimo: { type: 'integer', minimum: 0 },
      PrecoVenda: { type: 'number', minimum: 0 },
      PrecoCusto: { type: 'number', minimum: 0 },
    },
  },
} as const;

/**
 * Item da listagem de estoque do ERP.
 *
 * ⚠️ **O nome dos campos varia.** A resposta costuma vir em minúsculas (`idproduto`,
 * `quantidade`), mas o `auditoria.js` do 1.x — a versão mais testada em campo — aceitava
 * quatro grafias para o id e três para a quantidade. Aceitar só `idproduto` faz a listagem
 * inteira ser descartada em silêncio: nenhum produto casa, e o app mostra o saldo da última
 * importação achando que acabou de sincronizar.
 */
interface ItemEstoqueErp {
  [campo: string]: unknown;
}

/** Grafias do identificador, na ordem em que o 1.x tentava. */
const CAMPOS_ID = ['idproduto', 'IdProduto', 'idProduto', 'IdProdutoERP', 'idProdutoERP'] as const;

/** Grafias da quantidade. `EstoqueAtual` aparece em respostas mais antigas. */
const CAMPOS_QUANTIDADE = ['quantidade', 'Quantidade', 'EstoqueAtual', 'estoqueAtual'] as const;

function primeiroPresente(item: ItemEstoqueErp, campos: readonly string[]): unknown {
  for (const campo of campos) {
    const valor = item[campo];
    if (valor !== undefined && valor !== null) return valor;
  }
  return null;
}

/**
 * Quantidade normalizada. Porte do `parseQuantidade` do 1.x.
 *
 * Valor ilegível vira **0**, não descarte: o 1.x fazia assim, e descartar transformaria um
 * produto com dado ruim em "não existe no ERP" — dois problemas diferentes que pedem
 * respostas diferentes.
 */
function quantidadeDoErp(bruto: unknown): number {
  const n = Number(bruto);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Abaixo disto, "não veio nenhum item com saldo ≤ 0" não é evidência de nada — é amostra
 * pequena. O número é um julgamento: alto o bastante para uma loja de verdade não passar
 * por acaso, baixo o bastante para não descartar loja pequena. Uma loja do Ice Beer devolve
 * mais de mil itens.
 */
const AMOSTRA_MINIMA = 50;

export interface EstoqueNormalizado {
  itens: Array<{ idProduto: string; quantidade: number }>;
  /** Linhas descartadas por não ter identificador reconhecível. */
  semId: number;
  /**
   * Nomes das chaves do primeiro item — **só os nomes, nunca o conteúdo**.
   *
   * É o que responde "o ERP mudou o nome do campo?" sem mandar nome de produto nem preço
   * para o log. O `auditoria.js` do 1.x logava o item inteiro; isto é o mesmo diagnóstico
   * sem o vazamento.
   */
  campos: string[];
  /** Quantos itens vieram com saldo `<= 0`. */
  naoPositivos: number;
  /**
   * A listagem só traz saldo positivo — logo, **produto ausente está zerado no ERP**.
   *
   * A conclusão sai da própria resposta: se numa amostra grande nenhum item veio com saldo
   * `<= 0`, o ERP está filtrando. Isso importa porque muda o significado da ausência:
   *
   * - listagem **com** zeros → ausente = "o ERP não conhece este produto";
   * - listagem **sem** zeros → ausente = "o ERP tem zero deste produto".
   *
   * Tratar o segundo caso como o primeiro deixa na tela o saldo da última importação e o
   * produto sai da correção — o funcionário conta 5, o ERP fica em 0, e ninguém corrige.
   *
   * A conclusão se refaz a cada resposta: no dia em que o ERP passar a devolver zeros, o
   * sinal desliga sozinho.
   */
  omiteZerados: boolean;
}

/** Converte a lista crua do ERP no formato que o app consome. */
export function normalizarItensDoErp(itens: readonly unknown[]): EstoqueNormalizado {
  const saida: EstoqueNormalizado['itens'] = [];
  let semId = 0;

  for (const bruto of itens) {
    if (!bruto || typeof bruto !== 'object') {
      semId++;
      continue;
    }
    const item = bruto as ItemEstoqueErp;
    const id = String(primeiroPresente(item, CAMPOS_ID) ?? '').trim();

    if (id === '' || id === 'null' || id === 'undefined') {
      semId++;
      continue;
    }

    saida.push({
      idProduto: id,
      quantidade: quantidadeDoErp(primeiroPresente(item, CAMPOS_QUANTIDADE)),
    });
  }

  const primeiro = itens[0];
  const campos = primeiro && typeof primeiro === 'object' ? Object.keys(primeiro) : [];

  const naoPositivos = saida.filter((i) => i.quantidade <= 0).length;
  const omiteZerados = saida.length >= AMOSTRA_MINIMA && naoPositivos === 0;

  return { itens: saida, semId, campos, naoPositivos, omiteZerados };
}

/** Tentativas totais de envio, contando a primeira. Mesmo orçamento do 1.x (1 + 3). */
const TENTATIVAS = 4;

/** Pausa entre tentativas. Mesmo valor do 1.x (`retryDelay`). */
const PAUSA_ENTRE_TENTATIVAS_MS = 1000;

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function comTempoLimite<T>(
  ms: number,
  executar: (sinal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await executar(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Procura erro de negócio no corpo da resposta.
 *
 * **HTTP 200 não significa que o ERP aceitou.** Ele responde 200 com `{ success: false }`
 * ou `{ erro: "..." }` quando recusa a atualização por regra dele. O 1.x inspecionava isso
 * (`extractBusinessError`); sem a checagem, o app contaria como enviado um item que o ERP
 * descartou, e só a releitura da fase 3 perceberia — quando percebesse.
 *
 * Conservador de propósito: só acusa erro quando o corpo sinaliza explicitamente. Resposta
 * em formato desconhecido é tratada como sucesso, porque o 200 já é um sinal.
 */
export function erroDeNegocio(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const dados = corpo as Record<string, unknown>;

  const texto = (...campos: string[]): string | null => {
    for (const campo of campos) {
      const valor = dados[campo];
      if (typeof valor === 'string' && valor.trim() !== '') return valor;
    }
    return null;
  };

  for (const bandeira of ['success', 'Success', 'sucesso', 'Sucesso']) {
    if (dados[bandeira] === false) {
      return (
        texto('error', 'erro', 'message', 'mensagem', 'Mensagem') ?? `campo "${bandeira}" = false`
      );
    }
  }

  const explicito = texto('error', 'erro', 'Error', 'Erro');
  if (explicito) return explicito;

  if (dados['status'] === 'error' || dados['Status'] === 'error') {
    return texto('message', 'mensagem') ?? 'status = error';
  }

  return null;
}

interface TentativaEnvio {
  ok: boolean;
  /** Motivo da falha, já legível. Ausente quando `ok`. */
  erro?: string;
  /** Status HTTP do ERP, quando houve resposta. */
  statusErp?: number;
  corpo?: string;
}

async function enviarUmaVez(dados: AtualizacaoEstoque): Promise<TentativaEnvio> {
  try {
    const resposta = await comTempoLimite(config.erp.timeoutMs, (signal) =>
      fetch(config.erp.urlAtualizar, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(dados),
        signal,
      }),
    );

    const corpo = await resposta.text();

    if (!resposta.ok) {
      return { ok: false, erro: `HTTP ${resposta.status}`, statusErp: resposta.status, corpo };
    }

    // Corpo vazio com 200 é aceite: o ERP nem sempre devolve JSON.
    if (corpo.trim() === '') return { ok: true, statusErp: resposta.status, corpo };

    let json: unknown;
    try {
      json = JSON.parse(corpo);
    } catch {
      return { ok: false, erro: 'Resposta do ERP não é JSON', statusErp: resposta.status, corpo };
    }

    const recusa = erroDeNegocio(json);
    if (recusa) {
      return { ok: false, erro: `ERP recusou: ${recusa}`, statusErp: resposta.status, corpo };
    }

    return { ok: true, statusErp: resposta.status, corpo };
  } catch (erro) {
    const abortou = erro instanceof Error && erro.name === 'AbortError';
    return { ok: false, erro: abortou ? 'Tempo esgotado ao contatar o ERP' : 'Falha de rede' };
  }
}

export async function rotasErp(app: FastifyInstance): Promise<void> {
  /**
   * Envia a quantidade contada de um produto.
   *
   * Repete até `TENTATIVAS` vezes, como o `sendStockUpdateSync` do 1.x. É seguro repetir:
   * a chamada grava uma quantidade absoluta, não um incremento — reenviar o mesmo valor dá
   * no mesmo. O retry mora aqui, e não no celular, porque quem está no depósito com wifi
   * ruim é justamente quem não deveria segurar quatro tentativas na mão.
   */
  app.post<{ Body: AtualizacaoEstoque }>(
    '/api/erp/estoque',
    { schema: schemaAtualizacao },
    async (req, reply) => {
      let ultima: TentativaEnvio = { ok: false, erro: 'Nenhuma tentativa executada' };

      for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
        ultima = await enviarUmaVez(req.body);
        if (ultima.ok) {
          if (tentativa > 1) {
            req.log.info({ tentativa, idProduto: req.body.IdProduto }, 'ERP aceitou após retry');
          }
          return reply.send({ ok: true, resposta: ultima.corpo ?? '', tentativas: tentativa });
        }

        req.log.warn(
          { tentativa, erro: ultima.erro, statusErp: ultima.statusErp, idProduto: req.body.IdProduto },
          'Tentativa de envio ao ERP falhou',
        );

        if (tentativa < TENTATIVAS) await pausa(PAUSA_ENTRE_TENTATIVAS_MS);
      }

      req.log.error(
        { idProduto: req.body.IdProduto, erro: ultima.erro },
        `ERP não aceitou a atualização após ${TENTATIVAS} tentativas`,
      );

      // 502: o erro é do ERP, não do cliente. O app trata como "reenviar depois".
      return reply.status(502).send({
        ok: false,
        erro: ultima.erro ?? 'ERP recusou a atualização',
        ...(ultima.statusErp === undefined ? {} : { statusErp: ultima.statusErp }),
        tentativas: TENTATIVAS,
      });
    },
  );

  /**
   * Lista o estoque atual da loja no ERP.
   *
   * É o que permite comparar a contagem com o saldo real antes de corrigir, e depois
   * verificar se a correção foi mesmo aplicada. O ERP devolve um array de
   * `{ idproduto, quantidade }` — às vezes embrulhado em `data` ou `items`.
   *
   * Timeout maior que o da atualização: a listagem traz o estoque inteiro da loja.
   */
  app.get<{ Params: { hashLoja: string } }>(
    '/api/erp/estoque/:hashLoja',
    {
      schema: {
        params: {
          type: 'object',
          required: ['hashLoja'],
          properties: { hashLoja: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const url = `${config.erp.urlListar}/${encodeURIComponent(req.params.hashLoja)}`;

      try {
        const resposta = await comTempoLimite(config.erp.timeoutListarMs, (signal) =>
          fetch(url, { headers: { Accept: 'application/json' }, signal }),
        );

        if (!resposta.ok) {
          req.log.warn({ status: resposta.status }, 'ERP recusou a listagem de estoque');
          return reply
            .status(502)
            .send({ ok: false, erro: 'ERP não devolveu o estoque', statusErp: resposta.status });
        }

        const bruto: unknown = await resposta.json();

        // O ERP às vezes embrulha o array. Desembrulhar aqui evita que cada cliente
        // precise conhecer os três formatos.
        let itens: unknown = bruto;
        if (!Array.isArray(itens) && bruto && typeof bruto === 'object') {
          const obj = bruto as Record<string, unknown>;
          if (Array.isArray(obj['data'])) itens = obj['data'];
          else if (Array.isArray(obj['items'])) itens = obj['items'];
        }

        if (!Array.isArray(itens)) {
          req.log.error({ tipo: typeof bruto }, 'Resposta do ERP não é uma lista');
          return reply.status(502).send({ ok: false, erro: 'Resposta do ERP em formato inesperado' });
        }

        const normalizado = normalizarItensDoErp(itens);

        if (normalizado.itens.length === 0 && itens.length > 0) {
          req.log.error(
            { recebidos: itens.length, campos: normalizado.campos },
            'ERP devolveu itens, mas nenhum tinha identificador reconhecível',
          );
        }

        return reply.send({
          ok: true,
          itens: normalizado.itens,
          recebidos: itens.length,
          semId: normalizado.semId,
          campos: normalizado.campos,
          naoPositivos: normalizado.naoPositivos,
          omiteZerados: normalizado.omiteZerados,
        });
      } catch (erro) {
        const abortou = erro instanceof Error && erro.name === 'AbortError';
        req.log.error({ erro }, 'Falha ao buscar o estoque no ERP');
        return reply.status(504).send({
          ok: false,
          erro: abortou ? 'Tempo esgotado ao buscar o estoque' : 'Falha ao buscar o estoque',
        });
      }
    },
  );
}
