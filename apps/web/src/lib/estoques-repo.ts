/**
 * Coleção `inventories`: metadados dos estoques e o ciclo de contagem.
 *
 * ⚠️ Os campos no banco são **`name` e `description`, em inglês** — herdado do Themis 1.x,
 * e é o que as Security Rules exigem (`validInventoryData` cobra `hasAll(['name'])`).
 * O domínio usa `nome`/`descricao`; a tradução acontece aqui, na fronteira. Ler `nome`
 * direto do documento devolve `undefined`, e o app passa a mostrar o ID do estoque no
 * lugar do nome.
 *
 * Cuidado com as regras: usuário comum só pode alterar os campos da rodada
 * (`contagemCycle`, `lastFinalizedCycle`, `lastFinalizedAt`, `updatedAt`, `lote` e
 * `loteCiclo`, `firestore/firestore.rules:197-198`). Qualquer campo a mais no payload —
 * inclusive um `createdAt` regenerado sem querer — faz a regra negar a escrita inteira.
 */
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { decidirEdicao, normalizarLote, type Inventory, type Repeticao } from '@themis/shared';
import { db } from './firebase.js';
import { exigirGravacao, runTransactionWithTimeout, withWriteTimeout } from './firestore-write.js';
import { DocumentoAusenteError, type ResultadoCriacao } from './gestao-escrita.js';
import { colecaoProdutos } from './produtos-repo.js';
import { assinaturaResiliente } from './assinatura.js';

const COLECAO = 'inventories';
const LIMITE_BATCH = 500;

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
    // `nome` como alternativa por segurança, caso algum documento tenha sido gravado
    // com a grafia em português por engano.
    nome: (d['name'] as string) ?? (d['nome'] as string) ?? snap.id,
    descricao: (d['description'] as string) ?? (d['descricao'] as string) ?? '',
    contagemCycle: (d['contagemCycle'] as number) ?? 1,
    lote: (d['lote'] as string) ?? '',
    loteCiclo: d['loteCiclo'] as number | undefined,
    lastFinalizedCycle: d['lastFinalizedCycle'] as number | undefined,
    lastFinalizedAt: paraData(d['lastFinalizedAt']),
    createdAt: paraData(d['createdAt']),
    updatedAt: paraData(d['updatedAt']),
  };
}

function ordenar(lista: Inventory[]): Inventory[] {
  return lista.sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'));
}

export async function carregarEstoques(): Promise<Inventory[]> {
  const snap = await getDocs(collection(db, COLECAO));
  return ordenar(snap.docs.map(paraInventory));
}

export function ouvirEstoques(aoMudar: (estoques: Inventory[]) => void): () => void {
  return assinaturaResiliente(
    (viva, falhou) =>
      onSnapshot(
        collection(db, COLECAO),
        (snap) => {
          viva();
          aoMudar(ordenar(snap.docs.map(paraInventory)));
        },
        falhou,
      ),
    { label: 'estoques' },
  );
}

/**
 * Abre o lote da rodada. **Qualquer usuário que possa contar neste estoque.**
 *
 * ⚠️ O payload leva **só** `lote`, `loteCiclo` e `updatedAt`. Nada mais.
 *
 * A regra de `inventories` libera o usuário comum por um ramo com `hasOnly`: o conjunto de
 * campos alterados precisa caber na lista da rodada. Mandar `name` junto — como esta função
 * fazia enquanto o lote era só de admin — coloca `name` no diff sempre que o valor enviado
 * diferir em um espaço sequer, e a escrita inteira é negada. É o mesmo formato do bug que o
 * `createdAt` regenerado causou no 1.x.
 *
 * `loteCiclo` carimba o `contagemCycle` corrente: é o que faz o lote vencer sozinho ao
 * finalizar, sem escrita a mais. Ver `lote.ts`.
 */
export async function abrirLote(inventoryId: string, lote: string, ciclo: number): Promise<void> {
  await exigirGravacao(
    setDoc(
      doc(db, COLECAO, inventoryId),
      { lote: normalizarLote(lote), loteCiclo: ciclo, updatedAt: new Date() },
      { merge: true },
    ),
    { label: 'abrir lote' },
  );
}

/**
 * Encerra o lote sem mexer no ciclo. Usado ao limpar a contagem.
 *
 * Mesmo cuidado com o payload: só os campos da rodada.
 */
export async function encerrarLote(inventoryId: string): Promise<void> {
  await exigirGravacao(
    setDoc(
      doc(db, COLECAO, inventoryId),
      { lote: '', updatedAt: new Date() },
      { merge: true },
    ),
    { label: 'encerrar lote' },
  );
}

/** `type`, não `interface`: precisa caber em `Record<string, ValorGestao>` do `decidirEdicao`. */
export type CamposEstoque = { nome: string; descricao: string };

/** Id novo, gerado no aparelho. Chamado quando o formulário abre, nunca a cada clique. */
export function novoIdDeEstoque(): string {
  return doc(collection(db, COLECAO)).id;
}

/**
 * Cria o estoque com o id que o formulário já tinha, numa transação. Só admin/master — a regra
 * nega para os demais.
 *
 * Reenvio depois de um "Sem confirmação" que gravou: o documento já está lá com o mesmo nome e
 * não é regravado, senão o lote aberto no meio sumiria. Com outro nome, o id é de outro estoque.
 */
export function criarEstoque(id: string, nome: string, descricao: string): Promise<ResultadoCriacao> {
  const nomeAparado = nome.trim();
  return runTransactionWithTimeout<ResultadoCriacao>(
    async (tx) => {
      const ref = doc(db, COLECAO, id);
      const snap = await tx.get(ref);
      if (snap.exists()) return snap.data()['name'] === nomeAparado ? 'JA_EXISTIA' : 'CONFLITO';
      tx.set(ref, {
        name: nomeAparado,
        description: descricao.trim(),
        contagemCycle: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return 'CRIADO';
    },
    { label: 'criar estoque' },
  );
}

/**
 * Renomeia o estoque, numa transação que grava só os campos que mudaram.
 *
 * `merge: true`, sem `createdAt`: enviar o documento inteiro regeneraria o `createdAt` e a regra
 * negaria a escrita. `abertura` é o que a tela abriu; `de` é o valor que o servidor tinha.
 */
export async function renomearEstoque(
  id: string,
  pedido: CamposEstoque,
  abertura: CamposEstoque,
): Promise<{ resultado: Repeticao; de: CamposEstoque }> {
  const aparado: CamposEstoque = { nome: pedido.nome.trim(), descricao: pedido.descricao.trim() };
  if (decidirEdicao(abertura, aparado, abertura).resultado === 'NADA_MUDOU') {
    return { resultado: 'NADA_MUDOU', de: abertura };
  }
  return runTransactionWithTimeout(
    async (tx) => {
      const ref = doc(db, COLECAO, id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new DocumentoAusenteError();
      const d = snap.data();
      const servidor: CamposEstoque = {
        nome: (d['name'] as string | undefined) ?? '',
        descricao: (d['description'] as string | undefined) ?? '',
      };
      const { resultado, campos, de } = decidirEdicao(abertura, aparado, servidor);
      if (resultado === 'GRAVAR') {
        const dados: Record<string, unknown> = { updatedAt: new Date() };
        if (campos.nome === 'GRAVAR') dados['name'] = aparado.nome;
        if (campos.descricao === 'GRAVAR') dados['description'] = aparado.descricao;
        tx.set(ref, dados, { merge: true });
      }
      return { resultado, de };
    },
    { label: 'renomear estoque' },
  );
}

/**
 * Exclui o estoque e todos os seus produtos.
 *
 * ⚠️ O Firestore **não apaga subcoleções** junto com o documento pai. Apagar só
 * `inventories/{id}` deixaria milhares de produtos órfãos em `estoques/{id}/produtos`,
 * invisíveis no app e cobrados na fatura para sempre. Por isso os produtos vão primeiro,
 * em lotes, e o documento do estoque só no fim — se algo falhar no meio, o estoque
 * continua existindo e a operação pode ser repetida.
 *
 * Só master: é o que as regras permitem para exclusão.
 */
export async function excluirEstoque(
  inventoryId: string,
  aoProgredir?: (apagados: number, total: number) => void,
): Promise<number> {
  const produtos = await getDocs(colecaoProdutos(inventoryId));
  const total = produtos.size;
  let apagados = 0;

  for (let i = 0; i < produtos.docs.length; i += LIMITE_BATCH) {
    const lote = writeBatch(db);
    for (const p of produtos.docs.slice(i, i + LIMITE_BATCH)) lote.delete(p.ref);
    await exigirGravacao(lote.commit(), { ms: 20_000, label: 'excluir produtos' });
    apagados += Math.min(LIMITE_BATCH, produtos.docs.length - i);
    aoProgredir?.(apagados, total);
  }

  await withWriteTimeout(deleteDoc(doc(db, COLECAO, inventoryId)), { label: 'excluir estoque' });
  return total;
}
