/**
 * Cliente da integração com o ERP.
 *
 * No 1.x o navegador chamava `erp.nuvem3.com.br` direto. Agora passa pela nossa API: o
 * endereço do ERP sai do bundle e o timeout fica do lado do servidor.
 *
 * O `HashLoja` vem da coleção `hashConfigs` — é o que amarra o estoque do Themis à loja
 * no ERP.
 */
import { doc, getDoc, setDoc, type DocumentData } from 'firebase/firestore';
import { chavesDeIdProduto, type EnvioEstoque } from '@themis/shared';
import { db } from './firebase.js';
import { urlApi } from './api.js';
import { withWriteTimeout } from './firestore-write.js';

/**
 * Teto do envio, do lado do navegador.
 *
 * Precisa cobrir o **orçamento inteiro de retry do servidor** (4 tentativas de 10s mais as
 * pausas de 1s entre elas ≈ 43s). Com o teto antigo de 15s o navegador abortava no meio da
 * segunda tentativa e o item entrava como falha enquanto o ERP ainda estava respondendo.
 */
const TIMEOUT_MS = 60_000;

export interface ResultadoEnvio {
  ok: boolean;
  erro?: string;
}

export async function enviarAoErp(dados: EnvioEstoque): Promise<ResultadoEnvio> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(urlApi('/erp/estoque'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
      signal: controller.signal,
    });

    if (!resposta.ok) {
      const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
      return { ok: false, erro: corpo?.erro ?? `Falha ${resposta.status}` };
    }
    return { ok: true };
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
export async function buscarEstoqueDoErp(hashLoja: string): Promise<ResultadoBusca> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_LISTAR_MS);

  try {
    const resposta = await fetch(urlApi(`/erp/estoque/${encodeURIComponent(hashLoja)}`), {
      signal: controller.signal,
    });

    const corpo = (await resposta.json().catch(() => null)) as
      | { ok?: boolean; itens?: Array<{ idProduto: string; quantidade: number }>; erro?: string }
      | null;

    if (!resposta.ok || !corpo?.ok || !Array.isArray(corpo.itens)) {
      return {
        ok: false,
        estoque: new Map(),
        itens: 0,
        erro: corpo?.erro ?? `Falha ${resposta.status}`,
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

    return { ok: true, estoque, itens };
  } catch (erro) {
    const abortou = (erro as { name?: string } | null)?.name === 'AbortError';
    return {
      ok: false,
      estoque: new Map(),
      itens: 0,
      erro: abortou ? 'Tempo esgotado ao buscar o estoque' : 'Sem resposta do servidor',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Configuração de HashLoja.
 *
 * ⚠️ **É um documento só**, `hashConfigs/inventoryHashes`, com um mapa
 * `{ inventoryId: hash }` no campo `hashes` — não uma coleção de documentos por loja.
 * Documentos antigos usam `inventoryHashes` no lugar de `hashes`; os dois são lidos.
 *
 * Sem o hash, o ERP não sabe de qual loja se está falando: nem a leitura de estoque nem a
 * correção funcionam.
 */
const DOC_HASHES = 'inventoryHashes';

export async function carregarHashes(): Promise<Map<string, string>> {
  const snap = await getDoc(doc(db, 'hashConfigs', DOC_HASHES));
  const mapa = new Map<string, string>();
  if (!snap.exists()) return mapa;

  const dados = snap.data() as DocumentData;
  const bruto = (dados['hashes'] ?? dados['inventoryHashes']) as Record<string, unknown> | undefined;
  if (!bruto || typeof bruto !== 'object') return mapa;

  for (const [inventoryId, hash] of Object.entries(bruto)) {
    const valor = String(hash ?? '').trim();
    if (valor !== '') mapa.set(inventoryId, valor);
  }
  return mapa;
}

/** Hash da loja ligada a um estoque. `null` quando não há configuração. */
export async function hashDaLoja(inventoryId: string): Promise<string | null> {
  const hashes = await carregarHashes();
  return hashes.get(inventoryId) ?? null;
}

/**
 * Grava o mapa inteiro.
 *
 * `merge: true` no campo `hashes` mantém o que outros estoques já tinham — gravar o
 * documento inteiro apagaria a configuração de quem não estava na tela.
 */
export async function salvarHashes(hashes: ReadonlyMap<string, string>): Promise<void> {
  const objeto: Record<string, string> = {};
  for (const [inventoryId, hash] of hashes) {
    const valor = hash.trim();
    if (valor !== '') objeto[inventoryId] = valor;
  }

  await withWriteTimeout(
    setDoc(doc(db, 'hashConfigs', DOC_HASHES), { hashes: objeto, updatedAt: new Date() }),
    { label: 'salvar hashes' },
  );
}

/**
 * Testa se o hash responde no ERP.
 *
 * Hash errado devolve lista vazia em vez de erro, então "respondeu" não basta: o teste só
 * passa se vier ao menos um item.
 */
export async function testarHash(hash: string): Promise<{ ok: boolean; itens: number; erro?: string }> {
  const leitura = await buscarEstoqueDoErp(hash);
  if (!leitura.ok) return { ok: false, itens: 0, erro: leitura.erro ?? 'Falha na consulta' };
  return { ok: leitura.itens > 0, itens: leitura.itens };
}
