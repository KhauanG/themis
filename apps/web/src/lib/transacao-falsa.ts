/**
 * Transação falsa para os testes dos repositórios. O app não usa este arquivo.
 *
 * Molde do topo de um `*-repo.test.ts` (copie e ajuste os imports):
 *
 *   vi.mock('./firebase.js', () => ({ db: {} }));
 *   vi.mock('./firestore-write.js', async (original) => ({
 *     ...(await original<typeof import('./firestore-write.js')>()),
 *     runTransactionWithTimeout: vi.fn(),
 *   }));
 *   vi.mock('firebase/firestore', async (original) => ({
 *     ...(await original<typeof import('firebase/firestore')>()),
 *     collection: (base: { path?: string }, ...p: string[]) => ({ path: [base.path, ...p].filter(Boolean).join('/') }),
 *     doc: (base: { path?: string }, ...p: string[]) => ({ path: [base.path, ...p].filter(Boolean).join('/') }),
 *   }));
 *
 *   // `docs` é o que o servidor tem. Devolve a lista do que a função gravou.
 *   function servidor(docs: Record<string, Record<string, unknown>>) {
 *     const { tx, gravacoes } = transacaoFalsa(docs);
 *     vi.mocked(runTransactionWithTimeout).mockImplementation(((fn: (t: unknown) => unknown) => fn(tx)) as never);
 *     return gravacoes;
 *   }
 *
 *   beforeEach(() => vi.clearAllMocks());
 */
export interface GravacaoFalsa {
  tipo: 'set' | 'update' | 'delete';
  path: string;
  dados?: Record<string, unknown>;
  opcoes?: unknown;
}

type Ref = { path: string };

export function transacaoFalsa(docs: Record<string, Record<string, unknown>>) {
  const gravacoes: GravacaoFalsa[] = [];
  const tx = {
    get: async (ref: Ref) => ({
      id: ref.path.split('/').pop() ?? '',
      exists: () => ref.path in docs,
      data: () => docs[ref.path],
    }),
    set: (ref: Ref, dados: Record<string, unknown>, opcoes?: unknown) => {
      gravacoes.push({ tipo: 'set', path: ref.path, dados, opcoes });
      return tx;
    },
    update: (ref: Ref, dados: Record<string, unknown>) => {
      gravacoes.push({ tipo: 'update', path: ref.path, dados });
      return tx;
    },
    delete: (ref: Ref) => {
      gravacoes.push({ tipo: 'delete', path: ref.path });
      return tx;
    },
  };
  return { tx: tx as unknown, gravacoes };
}
