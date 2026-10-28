/**
 * Cliente da integração com o ERP.
 *
 * No 1.x o navegador chamava `erp.nuvem3.com.br` direto. Agora passa pela nossa API: o
 * endereço do ERP sai do bundle e o timeout fica do lado do servidor.
 *
 * O HashLoja nunca passa pelo navegador: o site manda só a loja, e a API lê o hash com a conta
 * de serviço.
 */
import { chavesDeIdProduto, type EnvioEstoque } from '@themis/shared';
import { chamarApi } from './api.js';

/**
 * Teto do envio, do lado do navegador.
 *
 * Precisa cobrir o **orçamento inteiro de retry do servidor** (2 tentativas de 45s mais 1
 * pausa de 1s entre elas ≈ 91s). Com um teto menor o navegador abortava no meio da segunda
 * tentativa e o item entrava como falha enquanto o ERP ainda estava respondendo.
 */
const TIMEOUT_MS = 100_000;

export interface ResultadoEnvio {
  ok: boolean;
  erro?: string;
  /** Status 401, 403, 409 ou 503: os próximos itens dariam o mesmo erro. */
  parar?: boolean;
}

export async function enviarAoErp(inventoryId: string, dados: EnvioEstoque): Promise<ResultadoEnvio> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await respostaDaApi(
      await chamarApi(`/erp/lojas/${encodeURIComponent(inventoryId)}/estoque`, {
        method: 'POST',
        body: JSON.stringify(dados),
        signal: controller.signal,
      }),
    );
  } catch (erro) {
    const abortou = (erro as { name?: string } | null)?.name === 'AbortError';
    return { ok: false, erro: abortou ? 'Tempo esgotado' : 'Sem resposta do servidor' };
  } finally {
    clearTimeout(timer);
  }
}

/** Buscar o estoque inteiro da loja demora; o teto acompanha o da API. */
const TIMEOUT_LISTAR_MS = 60_000;

export interface ResultadoBusca {
  ok: boolean;
  /**
   * `idProduto` → quantidade no ERP, indexado por **todas as grafias** da chave.
   *
   * Use `chavesDeIdProduto` para consultar, nunca `String(id)` cru. E não use `.size` como
   * contagem de itens — um produto ocupa mais de uma entrada. Para isso existe `itens`.
   */
  estoque: Map<string, number>;
  /** Produtos distintos recebidos do ERP. É este o número que se mostra ao usuário. */
  itens: number;
  /** Linhas que o ERP devolveu, antes de qualquer descarte. */
  recebidos: number;
  /** Linhas descartadas por não ter identificador reconhecível. */
  semId: number;
  /** Nomes dos campos do primeiro item — só os nomes. Diagnóstico de mudança de contrato. */
  campos: string[];
  /**
   * A listagem só traz saldo positivo — logo, **produto ausente está zerado no ERP**, e não
   * "é desconhecido pelo ERP". Ver `omiteZerados` em `apps/api/src/routes/erp.ts`.
   */
  omiteZerados: boolean;
  erro?: string;
}

/**
 * Lê o saldo atual da loja no ERP.
 *
 * Usado duas vezes no "Corrigir estoque": **antes**, para comparar a contagem contra dado
 * fresco em vez do `estoqueSistema` guardado; e **depois**, para verificar se o envio foi
 * mesmo aplicado. Sem a primeira leitura, o app mandaria correções de itens que já batiam
 * e deixaria passar divergências surgidas desde a importação.
 */
export async function buscarEstoqueDoErp(inventoryId: string): Promise<ResultadoBusca> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_LISTAR_MS);

  try {
    const resposta = await chamarApi(`/erp/lojas/${encodeURIComponent(inventoryId)}/estoque`, {
      signal: controller.signal,
    });

    const corpo = (await resposta.json().catch(() => null)) as {
      ok?: boolean;
      itens?: Array<{ idProduto: string; quantidade: number }>;
      recebidos?: number;
      semId?: number;
      campos?: string[];
      omiteZerados?: boolean;
      erro?: string;
    } | null;

    const vazio = {
      estoque: new Map<string, number>(),
      itens: 0,
      recebidos: 0,
      semId: 0,
      campos: [],
      omiteZerados: false,
    };

    if (!resposta.ok || !corpo?.ok || !Array.isArray(corpo.itens)) {
      return { ok: false, ...vazio, erro: corpo?.erro ?? `Falha ${resposta.status}` };
    }

    const recebidos = corpo.recebidos ?? corpo.itens.length;
    const semId = corpo.semId ?? 0;
    const campos = corpo.campos ?? [];
    const omiteZerados = corpo.omiteZerados === true;

    /**
     * Resposta com linhas mas sem nenhum identificador reconhecível é **falha**, não
     * "nada a atualizar". O `auditoria.js` do 1.x lançava erro nesse caso, e com razão:
     * seguir em frente marca o catálogo inteiro como "fora do ERP" e deixa na tela o saldo
     * da última importação — que o usuário lê como se fosse o saldo do ERP.
     */
    if (corpo.itens.length === 0 && recebidos > 0) {
      console.error('[erp] Nenhum item com identificador. Campos recebidos:', campos);
      return {
        ok: false,
        ...vazio,
        recebidos,
        semId,
        campos,
        erro:
          `O ERP devolveu ${recebidos} itens, mas nenhum com identificador reconhecível. ` +
          `Campos recebidos: ${campos.join(', ') || 'nenhum'}.`,
      };
    }

    /**
     * Indexa por **todas** as grafias da chave, como o `buildApiStockMap` do 1.x.
     *
     * O ERP manda `"007"` onde o catálogo tem `7`, e vice-versa. Normalizar só do lado da
     * consulta não resolve: `chavesDeIdProduto(7)` é `["7"]` e nunca alcança a entrada
     * `"007"`. O resultado era o produto entrar como "sem correspondência no ERP" — some
     * da correção sem avisar, e o saldo fica errado.
     *
     * Última ocorrência vence, também como no 1.x: o ERP às vezes repete o mesmo produto.
     */
    const estoque = new Map<string, number>();
    let itens = 0;

    for (const item of corpo.itens) {
      const chaves = chavesDeIdProduto(item.idProduto);
      if (chaves.length === 0) continue;
      for (const chave of chaves) estoque.set(chave, item.quantidade);
      itens++;
    }

    return { ok: true, estoque, itens, recebidos, semId, campos, omiteZerados };
  } catch (erro) {
    const abortou = (erro as { name?: string } | null)?.name === 'AbortError';
    return {
      ok: false,
      estoque: new Map(),
      itens: 0,
      recebidos: 0,
      semId: 0,
      campos: [],
      omiteZerados: false,
      erro: abortou ? 'Tempo esgotado ao buscar o estoque' : 'Sem resposta do servidor',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * O hash nunca volta ao navegador. A API só diz quais lojas têm hash, grava o que o master
 * cola e testa pelo id da loja.
 */
const STATUS_QUE_PARAM = [401, 403, 409, 503];

async function respostaDaApi(r: Response): Promise<ResultadoEnvio> {
  if (r.ok) return { ok: true };
  const corpo = (await r.json().catch(() => null)) as { erro?: string } | null;
  const erro = corpo?.erro ?? `Falha ${r.status}`;
  return STATUS_QUE_PARAM.includes(r.status) ? { ok: false, erro, parar: true } : { ok: false, erro };
}

const caminhoDoHash = (inventoryId: string) => `/erp/lojas/${encodeURIComponent(inventoryId)}/hash`;

/** Ids das lojas com hash, filtrados pelo acesso de quem pede. */
export async function lerHashesConfigurados(): Promise<Set<string>> {
  const r = await chamarApi('/erp/hashes');
  const corpo = (await r.json().catch(() => null)) as { configurados?: unknown } | null;
  if (!r.ok || !Array.isArray(corpo?.configurados)) throw new Error(`Falha ${r.status}`);
  return new Set(corpo.configurados as string[]);
}

// Salvar, apagar e testar nunca rejeitam: na tela, o estoque já foi renomeado ou excluído
// quando o hash falha, e o `catch` dela diria que nada deu certo.
export async function salvarHashDaLoja(inventoryId: string, hash: string): Promise<ResultadoEnvio> {
  try {
    return await respostaDaApi(
      await chamarApi(caminhoDoHash(inventoryId), { method: 'PUT', body: JSON.stringify({ hash }) }),
    );
  } catch {
    return { ok: false, erro: 'Sem resposta do servidor' };
  }
}

export async function apagarHashDaLoja(inventoryId: string): Promise<ResultadoEnvio> {
  try {
    // Sem corpo: com Content-Type JSON e corpo vazio, a Fastify responde 400.
    return await respostaDaApi(await chamarApi(caminhoDoHash(inventoryId), { method: 'DELETE' }));
  } catch {
    return { ok: false, erro: 'Sem resposta do servidor' };
  }
}

export type VeredictoTeste = 'sem-conexao' | 'recusado' | 'inesperado' | 'vazio' | 'sem-amostra' | 'nenhum-id' | 'ok';

export interface ResultadoTesteHash {
  ok: boolean;
  /** Ausente só na falha HTTP. */
  veredicto?: VeredictoTeste;
  mensagem: string;
  alertaSaldos?: boolean;
}

/**
 * Testa o hash salvo da loja, ou o candidato que o master digitou, com uma listagem no ERP.
 *
 * Sem teto próprio: a API já corta a listagem em `timeoutListarMs`, e cada leitura do
 * Firestore em 10 s.
 */
export async function testarHash(inventoryId: string, hashCandidato?: string): Promise<ResultadoTesteHash> {
  try {
    const r = await chamarApi(`/erp/lojas/${encodeURIComponent(inventoryId)}/teste`, {
      method: 'POST',
      body: JSON.stringify(hashCandidato === undefined ? {} : { hash: hashCandidato }),
    });
    const corpo = (await r.json().catch(() => null)) as (Partial<ResultadoTesteHash> & { erro?: string }) | null;
    if (!r.ok || typeof corpo?.mensagem !== 'string') {
      return { ok: false, mensagem: corpo?.erro ?? `Falha ${r.status}` };
    }
    return { ok: corpo.ok === true, veredicto: corpo.veredicto, mensagem: corpo.mensagem, alertaSaldos: corpo.alertaSaldos };
  } catch {
    return { ok: false, mensagem: 'Sem resposta do servidor' };
  }
}

/** Pelo `veredicto`, nunca pelo `ok`: a API manda `ok: true` em todo veredicto. */
export function tomDoTeste(r: ResultadoTesteHash): 'success' | 'warning' | 'error' {
  switch (r.veredicto) {
    case 'ok':
      return r.alertaSaldos ? 'warning' : 'success';
    case 'sem-amostra':
    case 'nenhum-id':
      return 'warning';
    default:
      return 'error';
  }
}
