/**
 * Cliente da integração com o ERP.
 *
 * No 1.x o navegador chamava `erp.nuvem3.com.br` direto. Agora passa pela nossa API: o
 * endereço do ERP sai do bundle e o timeout fica do lado do servidor.
 *
 * O `HashLoja` vem da coleção `hashConfigs` — é o que amarra o estoque do Themis à loja
 * no ERP.
 */
import { Timestamp, collection, getDocs, type DocumentData } from 'firebase/firestore';
import { db } from './firebase.js';

const TIMEOUT_MS = 15_000;

export interface EnvioEstoque {
  IdProduto: string;
  HashLoja: string;
  Quantidade: number;
  CodigoBarras: string;
}

export interface ResultadoEnvio {
  ok: boolean;
  erro?: string;
}

export async function enviarAoErp(dados: EnvioEstoque): Promise<ResultadoEnvio> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch('/api/erp/estoque', {
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

export interface ConfigLoja {
  id: string;
  hashLoja: string;
  inventoryId?: string;
  nome?: string;
}

function texto(valor: unknown): string {
  if (valor instanceof Timestamp) return valor.toDate().toISOString();
  return typeof valor === 'string' ? valor : '';
}

export async function carregarConfigsLoja(): Promise<ConfigLoja[]> {
  const snap = await getDocs(collection(db, 'hashConfigs'));
  return snap.docs.map((d) => {
    const dados = d.data() as DocumentData;
    return {
      id: d.id,
      hashLoja: texto(dados['hashLoja'] ?? dados['HashLoja'] ?? dados['hash']),
      inventoryId: texto(dados['inventoryId']) || undefined,
      nome: texto(dados['nome']) || undefined,
    };
  });
}

/** Hash da loja ligada a um estoque. `null` quando não há configuração. */
export async function hashDaLoja(inventoryId: string): Promise<string | null> {
  const configs = await carregarConfigsLoja();
  const achado = configs.find((c) => c.inventoryId === inventoryId) ?? configs[0];
  return achado?.hashLoja || null;
}
