/**
 * Coleção `auditorias`: snapshots de contagens finalizadas.
 *
 * O formato gravado é idêntico ao do Themis 1.x — auditorias antigas e novas são lidas
 * pelo mesmo código, e o app 1.x continua conseguindo ler o que o 2.0 salva enquanto os
 * dois estiverem no ar.
 */
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  setDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  calcularEstatisticas,
  montarSnapshotProdutos,
  type Auditoria,
  type Produto,
} from '@themis/shared';
import { db } from './firebase.js';
import { deviceId } from './dispositivo.js';
import { withWriteTimeout } from './firestore-write.js';

const COLECAO = 'auditorias';

export interface DadosNovaAuditoria {
  nome: string;
  inventoryId: string;
  contagemCycle: number;
  produtos: readonly Produto[];
}

export function montarAuditoria(dados: DadosNovaAuditoria): Omit<Auditoria, 'id'> {
  const agora = new Date();
  return {
    nome: dados.nome,
    inventoryId: dados.inventoryId,
    contagemCycle: dados.contagemCycle,
    data: agora,
    produtos: montarSnapshotProdutos([...dados.produtos]),
    estatisticas: calcularEstatisticas([...dados.produtos]),
    createdBy: deviceId(),
    createdAt: agora,
  };
}

/**
 * Grava a auditoria e devolve o id.
 *
 * `doc()` + `setDoc()` em vez de `addDoc()`: o ID é gerado localmente, então fica
 * disponível de imediato mesmo se o ack do servidor demorar. E **não há retry** aqui de
 * propósito — repetir a gravação criaria auditorias duplicadas.
 */
export async function salvarAuditoria(auditoria: Omit<Auditoria, 'id'>): Promise<string> {
  const ref = doc(collection(db, COLECAO));
  await withWriteTimeout(
    setDoc(ref, { ...auditoria, data: Timestamp.fromDate(auditoria.data), createdAt: Timestamp.fromDate(auditoria.createdAt) }),
    { label: 'salvar auditoria' },
  );
  return ref.id;
}

function paraAuditoria(snap: QueryDocumentSnapshot<DocumentData>): Auditoria {
  const d = snap.data();
  const data = d['data'] instanceof Timestamp ? d['data'].toDate() : new Date();
  const createdAt = d['createdAt'] instanceof Timestamp ? d['createdAt'].toDate() : data;
  return { ...(d as Omit<Auditoria, 'id' | 'data' | 'createdAt'>), id: snap.id, data, createdAt };
}

export async function listarAuditorias(inventoryId?: string, maximo = 100): Promise<Auditoria[]> {
  const restricoes = inventoryId ? [where('inventoryId', '==', inventoryId)] : [];
  const snap = await getDocs(
    query(collection(db, COLECAO), ...restricoes, orderBy('data', 'desc'), limit(maximo)),
  );
  return snap.docs.map(paraAuditoria);
}

export async function buscarAuditoria(id: string): Promise<Auditoria | null> {
  const snap = await getDoc(doc(db, COLECAO, id));
  if (!snap.exists()) return null;
  return paraAuditoria(snap as QueryDocumentSnapshot<DocumentData>);
}

export async function excluirAuditoria(id: string): Promise<void> {
  await withWriteTimeout(deleteDoc(doc(db, COLECAO, id)), { label: 'excluir auditoria' });
}
