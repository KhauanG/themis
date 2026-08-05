/**
 * Coleção `inventories`: metadados dos estoques e o ciclo de contagem.
 *
 * Cuidado com as Security Rules: usuário comum só pode alterar os campos de ciclo
 * (`contagemCycle`, `lastFinalizedCycle`, `lastFinalizedAt`, `updatedAt`). Qualquer campo
 * a mais no payload — inclusive um `createdAt` regenerado sem querer — faz a regra negar
 * a escrita inteira. Foi exatamente esse bug que travou o app em 2026-08.
 */
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { Inventory } from '@themis/shared';
import { db } from './firebase.js';
import { runTransactionWithTimeout, withWriteTimeout } from './firestore-write.js';

const COLECAO = 'inventories';

/** Timestamp do Firestore não é `instanceof Date` — converter, nunca regenerar. */
function paraData(valor: unknown): Date | null {
  if (valor instanceof Timestamp) return valor.toDate();
  if (valor instanceof Date) return valor;
  return null;
}

function paraInventory(snap: QueryDocumentSnapshot<DocumentData>): Inventory {
  const d = snap.data();
  return {
    id: snap.id,
    nome: (d['nome'] as string) ?? snap.id,
    descricao: d['descricao'] as string | undefined,
    contagemCycle: (d['contagemCycle'] as number) ?? 1,
    lastFinalizedCycle: d['lastFinalizedCycle'] as number | undefined,
    lastFinalizedAt: paraData(d['lastFinalizedAt']),
    createdAt: paraData(d['createdAt']),
    updatedAt: paraData(d['updatedAt']),
  };
}

export async function carregarEstoques(): Promise<Inventory[]> {
  const snap = await getDocs(collection(db, COLECAO));
  return snap.docs.map(paraInventory).sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'));
}

export function ouvirEstoques(aoMudar: (estoques: Inventory[]) => void): () => void {
  return onSnapshot(
    collection(db, COLECAO),
    (snap) =>
      aoMudar(
        snap.docs.map(paraInventory).sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR')),
      ),
    (erro) => console.error('[estoques] Listener falhou:', erro),
  );
}

export interface ResultadoFinalizacao {
  cicloFinalizado: number;
  proximoCiclo: number;
}

/**
 * Fecha o ciclo de contagem.
 *
 * Em transação porque 4-5 aparelhos podem finalizar quase ao mesmo tempo: ler o ciclo da
 * tela e somar 1 perderia incrementos. O valor do servidor é a base.
 */
export async function finalizarCiclo(
  inventoryId: string,
  cicloLocal: number,
): Promise<ResultadoFinalizacao> {
  const ref = doc(db, COLECAO, inventoryId);

  return runTransactionWithTimeout(
    async (tx) => {
      const snap = await tx.get(ref);
      const dados = snap.exists() ? snap.data() : null;
      const cicloServidor =
        dados && typeof dados['contagemCycle'] === 'number' && dados['contagemCycle'] >= 1
          ? (dados['contagemCycle'] as number)
          : cicloLocal;

      // Só os campos que a regra libera para usuário comum. Nada além disso.
      tx.set(
        ref,
        {
          contagemCycle: cicloServidor + 1,
          lastFinalizedCycle: cicloServidor,
          lastFinalizedAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true },
      );

      return { cicloFinalizado: cicloServidor, proximoCiclo: cicloServidor + 1 };
    },
    { label: 'finalizar ciclo' },
  );
}

/** Cria ou renomeia estoque. Só admin/master — a regra nega para os demais. */
export async function salvarEstoque(
  inventoryId: string,
  dados: { nome: string; descricao?: string },
): Promise<void> {
  await withWriteTimeout(
    setDoc(doc(db, COLECAO, inventoryId), { ...dados, updatedAt: new Date() }, { merge: true }),
    { label: 'salvar estoque' },
  );
}
