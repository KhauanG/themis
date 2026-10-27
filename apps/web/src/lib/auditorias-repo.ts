/**
 * Coleção `auditorias`: snapshots de contagens finalizadas.
 *
 * O formato gravado é idêntico ao do Themis 1.x: auditorias salvas por ele continuam no
 * banco e são lidas pelo mesmo código. Mudar o formato exigiria migrar o acervo.
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
import { runTransactionWithTimeout, withWriteTimeout } from './firestore-write.js';

const COLECAO = 'auditorias';

export interface DadosNovaAuditoria {
  nome: string;
  inventoryId: string;
  contagemCycle: number;
  produtos: readonly Produto[];
  /** Lote da rodada. Ausente em auditoria anterior à funcionalidade. */
  lote?: string | null;
}

export function montarAuditoria(dados: DadosNovaAuditoria): Omit<Auditoria, 'id'> {
  const agora = new Date();
  return {
    nome: dados.nome,
    inventoryId: dados.inventoryId,
    contagemCycle: dados.contagemCycle,
    // Grava o lote junto: é por ele que a contagem será localizada depois, e a auditoria
    // é o único lugar onde ele sobrevive à finalização (que expira o lote do estoque).
    ...(dados.lote ? { lote: dados.lote } : {}),
    data: agora,
    produtos: montarSnapshotProdutos([...dados.produtos]),
    estatisticas: calcularEstatisticas([...dados.produtos]),
    createdBy: deviceId(),
    createdAt: agora,
  };
}

/**
 * Id fixo por estoque e ciclo. É o que faz um segundo clique, ou um segundo aparelho,
 * encontrar a auditoria que já existe em vez de criar outra. Auditorias do 1.x e do site
 * até a 2.19 têm id aleatório e continuam legíveis: o id só importa na hora de gravar.
 */
export function idAuditoria(inventoryId: string, ciclo: number): string {
  return `${inventoryId}_${ciclo}`;
}

export type ResultadoFinalizacao =
  | { situacao: 'finalizada'; auditoriaId: string; cicloFinalizado: number; proximoCiclo: number }
  | { situacao: 'ja-finalizada'; auditoriaId: string; cicloFinalizado: number }
  | { situacao: 'ciclo-mudou'; cicloServidor: number };

/**
 * Grava a auditoria e sobe o ciclo na MESMA transação.
 *
 * Antes eram duas escritas: a auditoria (id aleatório) e depois o ciclo, sem conferir se ele
 * tinha mudado. Dois cliques, ou dois aparelhos, duplicavam a auditoria e subiam o ciclo duas
 * vezes; e se o ciclo falhasse depois da auditoria, o app mandava finalizar de novo e criava
 * mais uma. Numa transação só, ou entram as duas coisas ou nenhuma.
 *
 * Lê a auditoria do ciclo SEMPRE, antes de qualquer escrita: depois de um estouro de tempo a
 * gravação pode ter chegado ao servidor, e aí o próximo clique tem que achá-la e dizer "já
 * finalizada", não finalizar o ciclo seguinte. Só quem é master regrava `auditorias` (regra),
 * então o id fixo não é sobrescrito por quem apenas conta.
 */
export async function finalizarContagem(auditoria: Omit<Auditoria, 'id'>): Promise<ResultadoFinalizacao> {
  const ciclo = auditoria.contagemCycle;
  const auditoriaId = idAuditoria(auditoria.inventoryId, ciclo);
  const refAuditoria = doc(db, COLECAO, auditoriaId);
  const refEstoque = doc(db, 'inventories', auditoria.inventoryId);

  return runTransactionWithTimeout(
    async (tx): Promise<ResultadoFinalizacao> => {
      const snapAuditoria = await tx.get(refAuditoria);
      const snapEstoque = await tx.get(refEstoque);

      if (snapAuditoria.exists()) return { situacao: 'ja-finalizada', auditoriaId, cicloFinalizado: ciclo };

      const bruto = snapEstoque.data()?.['contagemCycle'];
      const cicloServidor = typeof bruto === 'number' && bruto >= 1 ? bruto : ciclo;
      if (cicloServidor !== ciclo) return { situacao: 'ciclo-mudou', cicloServidor };

      const agora = new Date();
      tx.set(refAuditoria, {
        ...auditoria,
        data: Timestamp.fromDate(auditoria.data),
        createdAt: Timestamp.fromDate(auditoria.createdAt),
      });
      // Só os campos que a regra libera para usuário comum. Nada além disso.
      tx.set(
        refEstoque,
        { contagemCycle: ciclo + 1, lastFinalizedCycle: ciclo, lastFinalizedAt: agora, updatedAt: agora },
        { merge: true },
      );
      return { situacao: 'finalizada', auditoriaId, cicloFinalizado: ciclo, proximoCiclo: ciclo + 1 };
    },
    // Sobe até 30 s: a auditoria pode passar de 1 MB num wifi de loja e os 12 s padrão estourariam à toa.
    { label: 'finalizar contagem', ms: 30_000 },
  );
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
