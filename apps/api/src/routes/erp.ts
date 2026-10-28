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
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { MENSAGENS } from '../mensagens.js';

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
export interface AtualizacaoEstoque {
  IdProduto: number;
  HashLoja: string;
  Quantidade: number;
  CodigoBarras: string;
  NomeProduto: string;
  EstoqueMinimo: number;
  PrecoVenda: number;
  PrecoCusto: number;
}

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

/**
 * Tentativas totais de envio, contando a primeira. Com 45s por tentativa, 4 fariam um item
 * esperar até 3 min com o ERP travado; a operação é idempotente (mesma quantidade), então
 * uma repetição basta. Só rede, tempo esgotado e 5xx repetem: recusa e 4xx dão a mesma
 * resposta na segunda vez, e repetir só custa tempo.
 */
const TENTATIVAS = 2;

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

/**
 * Lê o corpo do ERP. O Nuvem3 (2026-10-27) responde JSON dentro de uma string JSON, e uma
 * string nunca passa em `erroDeNegocio`: sem desembrulhar, uma recusa valia como aceite.
 * Corpo que não é JSON lança, como o `JSON.parse` puro.
 */
export function jsonDoErp(corpo: string): unknown {
  const fora: unknown = JSON.parse(corpo);
  if (typeof fora !== 'string') return fora;
  try {
    return JSON.parse(fora);
  } catch {
    return fora;
  }
}

export type TipoFalha = 'recusa' | 'http' | 'nao-json' | 'tempo' | 'rede';

export interface TentativaEnvio {
  ok: boolean;
  /** Ausente quando `ok`. */
  tipo?: TipoFalha;
  /** Motivo da falha em texto fixo: o texto do ERP pode repetir o hash. Ausente quando `ok`. */
  erro?: string;
  /** Status HTTP do ERP, quando houve resposta. */
  statusErp?: number;
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
    const statusErp = resposta.status;

    if (!resposta.ok) return { ok: false, tipo: 'http', erro: `HTTP ${statusErp}`, statusErp };

    // Corpo vazio com 200 é aceite: o ERP nem sempre devolve JSON.
    if (corpo.trim() === '') return { ok: true, statusErp };

    let json: unknown;
    try {
      json = jsonDoErp(corpo);
    } catch {
      return { ok: false, tipo: 'nao-json', erro: 'Resposta do ERP não é JSON', statusErp };
    }

    if (erroDeNegocio(json) !== null) {
      return { ok: false, tipo: 'recusa', erro: 'O ERP recusou a atualização.', statusErp };
    }

    return { ok: true, statusErp };
  } catch (erro) {
    const abortou = erro instanceof Error && erro.name === 'AbortError';
    return abortou
      ? { ok: false, tipo: 'tempo', erro: 'Tempo esgotado ao contatar o ERP' }
      : { ok: false, tipo: 'rede', erro: 'Falha de rede' };
  }
}

const transitoria = (t: TentativaEnvio) =>
  t.tipo === 'tempo' || t.tipo === 'rede' || (t.tipo === 'http' && (t.statusErp ?? 0) >= 500);

/**
 * Envia a quantidade contada de um produto.
 *
 * Repete só rede, tempo e 5xx (45 s cada tentativa), com 1 s entre tentativas. É seguro
 * repetir: a chamada grava uma quantidade absoluta, não um incremento — reenviar o mesmo
 * valor dá no mesmo. O retry mora aqui, e não no celular, porque quem está no depósito com
 * wifi ruim é justamente quem não deveria segurar as tentativas na mão.
 *
 * Os logs nunca levam `erro`: o texto do ERP pode repetir o hash.
 */
export async function enviarComRetry(
  dados: AtualizacaoEstoque,
  log: FastifyBaseLogger,
): Promise<{ ultima: TentativaEnvio; tentativas: number }> {
  const idProduto = dados.IdProduto;
  for (let tentativa = 1; ; tentativa++) {
    const ultima = await enviarUmaVez(dados);
    if (ultima.ok) {
      if (tentativa > 1) log.info({ tentativa, idProduto }, 'ERP aceitou após retry');
      return { ultima, tentativas: tentativa };
    }

    log.warn(
      { tentativa, tipo: ultima.tipo, statusErp: ultima.statusErp, idProduto },
      'Tentativa de envio ao ERP falhou',
    );

    if (tentativa >= TENTATIVAS || !transitoria(ultima)) {
      log.error({ idProduto, tipo: ultima.tipo }, 'ERP não aceitou a atualização');
      return { ultima, tentativas: tentativa };
    }

    await pausa(PAUSA_ENTRE_TENTATIVAS_MS);
  }
}

export function responderEnvio(
  reply: FastifyReply,
  { ultima, tentativas }: { ultima: TentativaEnvio; tentativas: number },
): FastifyReply {
  if (ultima.ok) return reply.send({ ok: true, tentativas });
  // 502: o erro é do ERP, não do cliente. O app trata como "reenviar depois".
  return reply.code(502).send({
    ok: false,
    erro: ultima.erro ?? 'O ERP recusou a atualização.',
    ...(ultima.statusErp === undefined ? {} : { statusErp: ultima.statusErp }),
    tentativas,
  });
}

export type Listagem =
  | { tipo: 'lista'; itens: unknown[] }
  | { tipo: 'sem-conexao'; motivo: 'tempo' | 'rede' | 'http'; statusErp?: number }
  | { tipo: 'recusa'; statusErp: number }
  | { tipo: 'inesperado'; formato: string; tamanho: number };

/**
 * Lista o estoque atual da loja no ERP.
 *
 * É o que permite comparar a contagem com o saldo real antes de corrigir, e depois
 * verificar se a correção foi mesmo aplicada. O ERP devolve um array de
 * `{ idproduto, quantidade }` — às vezes embrulhado em `data` ou `items`.
 *
 * Timeout maior que o da atualização: a listagem traz o estoque inteiro da loja.
 *
 * Um GET só, nunca repetido. Não loga: quem loga é `responderListagem`, e nunca o corpo.
 * Hash desconhecido volta HTTP 200 com `[]` (sonda de 2026-10-28): lista vazia é lista.
 */
export async function listarNoErp(hash: string): Promise<Listagem> {
  try {
    const resposta = await comTempoLimite(config.erp.timeoutListarMs, (signal) =>
      fetch(`${config.erp.urlListar}/${encodeURIComponent(hash)}`, {
        headers: { Accept: 'application/json' },
        signal,
      }),
    );
    const corpo = await resposta.text();
    const statusErp = resposta.status;

    if (statusErp >= 500) return { tipo: 'sem-conexao', motivo: 'http', statusErp };
    if (!resposta.ok) return { tipo: 'recusa', statusErp };
    if (corpo.trim() === '') return { tipo: 'inesperado', formato: 'vazio', tamanho: 0 };

    let json: unknown;
    try {
      json = jsonDoErp(corpo);
    } catch {
      return { tipo: 'recusa', statusErp };
    }
    if (typeof json === 'string' || erroDeNegocio(json) !== null) {
      return { tipo: 'recusa', statusErp };
    }

    // O ERP às vezes embrulha o array em `data` ou `items`.
    const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
    const itens = [json, obj['data'], obj['items']].find(Array.isArray);
    if (itens) return { tipo: 'lista', itens };

    // Depois da lista: uma lista com mensagem continua lista.
    const mensagem = ['msg', 'mensagem', 'message'].some((campo) => {
      const valor = obj[campo];
      return typeof valor === 'string' && valor.trim() !== '';
    });
    if (mensagem) return { tipo: 'recusa', statusErp };

    return { tipo: 'inesperado', formato: typeof json, tamanho: corpo.length };
  } catch (erro) {
    const abortou = erro instanceof Error && erro.name === 'AbortError';
    return { tipo: 'sem-conexao', motivo: abortou ? 'tempo' : 'rede' };
  }
}

export function responderListagem(reply: FastifyReply, l: Listagem): FastifyReply {
  if (l.tipo === 'lista') {
    const normalizado = normalizarItensDoErp(l.itens);

    if (normalizado.itens.length === 0 && l.itens.length > 0) {
      reply.log.error(
        { recebidos: l.itens.length, campos: normalizado.campos },
        'ERP devolveu itens, mas nenhum tinha identificador reconhecível',
      );
    }

    return reply.send({
      ok: true,
      itens: normalizado.itens,
      recebidos: l.itens.length,
      semId: normalizado.semId,
      campos: normalizado.campos,
      naoPositivos: normalizado.naoPositivos,
      omiteZerados: normalizado.omiteZerados,
    });
  }

  // `l` só tem tipo, motivo, status, formato e tamanho: nunca o hash nem o corpo do ERP.
  reply.log.warn(l, 'Listagem do ERP falhou');

  if (l.tipo === 'recusa') {
    return reply.code(502).send({
      ok: false,
      erro: 'O ERP recusou a consulta. Confira o HashLoja do estoque.',
      statusErp: l.statusErp,
    });
  }
  if (l.tipo === 'inesperado') {
    return reply.code(502).send({ ok: false, erro: 'Resposta do ERP em formato inesperado' });
  }
  if (l.motivo === 'http') {
    return reply
      .code(502)
      .send({ ok: false, erro: 'ERP não devolveu o estoque', statusErp: l.statusErp });
  }
  return reply.code(504).send({
    ok: false,
    erro: l.motivo === 'tempo' ? 'Tempo esgotado ao buscar o estoque' : 'Falha ao buscar o estoque',
  });
}

/**
 * Rotas do site 2.20: o hash ia no caminho da URL e no corpo. Desde a 2.22.0 só respondem
 * 410, sem schema e sem ler nada. Uma aba aberta antes do push B mostra `corpo.erro` como
 * vem (`git show v2.20.0:apps/web/src/lib/erp.ts`, `:42-44` e `:119-120`), e o usuário
 * recarrega. O log da API grava só o padrão da rota (log-respostas.ts). O proxy da
 * Hostinger pode gravar a URL, e isso a API não controla.
 */
export async function rotasErp(app: FastifyInstance): Promise<void> {
  const recarregue = { ok: false, erro: MENSAGENS.recarregue } as const;
  app.get('/api/erp/estoque/:hashLoja', async (_req, reply) => reply.code(410).send(recarregue));
  app.post('/api/erp/estoque', async (_req, reply) => reply.code(410).send(recarregue));
}
