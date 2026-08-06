/**
 * Histórico geral de ações (`historico_geral`).
 *
 * Log nunca segura o fluxo do usuário: teto curto e segue. Se falhar, a entrada vai para
 * o localStorage e sobe na próxima drenagem. Perder um registro de log é aceitável;
 * travar a contagem por causa dele não é.
 */
import {
  Timestamp,
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { AcaoHistorico, EntradaHistorico } from '@themis/shared';
// Rótulos e cores vivem em `@themis/shared` junto do formatador — assim tela e testes
// leem a mesma tabela, e uma ação nova não fica sem nome.
export { COR_ACAO, ROTULO_ACAO } from '@themis/shared';
import { db } from './firebase.js';
import { withWriteTimeout } from './firestore-write.js';
import { CHAVES, gravar, ler, remover } from './armazenamento.js';
import { deviceId, deviceLabel } from './dispositivo.js';

const COLECAO = 'historico_geral';
const TETO_LOG_MS = 5_000;

export interface ContextoLog {
  userId: string;
  userEmail: string;
  userName: string;
  inventoryId: string;
  inventoryName: string;
}

export async function registrar(
  acao: AcaoHistorico,
  contexto: ContextoLog,
  detalhes: Record<string, unknown> = {},
): Promise<void> {
  const entrada: EntradaHistorico = {
    action: acao,
    ...contexto,
    localTimestamp: new Date().toISOString(),
    details: detalhes,
    deviceId: deviceId(),
    deviceLabel: deviceLabel(),
  };

  if (!navigator.onLine) {
    guardarLocal(entrada);
    return;
  }

  try {
    await withWriteTimeout(
      addDoc(collection(db, COLECAO), { ...entrada, timestamp: serverTimestamp() }),
      { ms: TETO_LOG_MS, label: 'histórico' },
    );
  } catch (erro) {
    console.warn('[histórico] Falhou, guardando local:', erro);
    guardarLocal(entrada);
  }
}

function guardarLocal(entrada: EntradaHistorico): void {
  const pendentes = ler<EntradaHistorico[]>(CHAVES.historicoPendente, []);
  pendentes.push(entrada);
  gravar(CHAVES.historicoPendente, pendentes);
}

/** Reenvia o histórico guardado. Para na primeira falha e mantém o resto na fila. */
export async function drenarHistorico(): Promise<number> {
  const pendentes = ler<EntradaHistorico[]>(CHAVES.historicoPendente, []);
  if (pendentes.length === 0) return 0;

  const restantes: EntradaHistorico[] = [];
  let enviados = 0;
  let parou = false;

  for (const entrada of pendentes) {
    if (parou || !navigator.onLine) {
      restantes.push(entrada);
      continue;
    }
    try {
      await withWriteTimeout(
        addDoc(collection(db, COLECAO), { ...entrada, timestamp: serverTimestamp() }),
        { ms: TETO_LOG_MS, label: 'histórico pendente' },
      );
      enviados++;
    } catch {
      restantes.push(entrada);
      parou = true;
    }
  }

  if (restantes.length === 0) remover(CHAVES.historicoPendente);
  else gravar(CHAVES.historicoPendente, restantes);

  return enviados;
}

export interface EntradaHistoricoLida extends EntradaHistorico {
  id: string;
  quando: Date;
}

function paraEntrada(snap: QueryDocumentSnapshot<DocumentData>): EntradaHistoricoLida {
  const d = snap.data();
  const ts = d['timestamp'];
  const quando =
    ts instanceof Timestamp ? ts.toDate() : new Date((d['localTimestamp'] as string) ?? Date.now());
  return { ...(d as EntradaHistorico), id: snap.id, quando };
}

export async function consultarHistorico(opcoes: {
  inventoryId?: string;
  acao?: AcaoHistorico;
  maximo?: number;
}): Promise<EntradaHistoricoLida[]> {
  const restricoes = [];
  if (opcoes.inventoryId) restricoes.push(where('inventoryId', '==', opcoes.inventoryId));
  if (opcoes.acao) restricoes.push(where('action', '==', opcoes.acao));

  const consulta = query(
    collection(db, COLECAO),
    ...restricoes,
    orderBy('timestamp', 'desc'),
    limit(opcoes.maximo ?? 200),
  );

  const snap = await getDocs(consulta);
  return snap.docs.map(paraEntrada);
}
