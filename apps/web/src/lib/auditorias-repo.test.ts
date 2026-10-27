import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { calcularEstatisticas, type Auditoria } from '@themis/shared';
import { finalizarContagem } from './auditorias-repo.js';
import { runTransactionWithTimeout } from './firestore-write.js';

// O módulo real de `firebase.js` lança sem as variáveis do `.env`; aqui só o `db` importa.
vi.mock('./firebase.js', () => ({ db: {} }));
vi.mock('./firestore-write.js', () => ({
  runTransactionWithTimeout: vi.fn(),
  withWriteTimeout: vi.fn(),
}));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  doc: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
}));

beforeEach(() => vi.clearAllMocks());

/** Transação falsa: `docs` é o que o servidor tem; devolve o que a função gravou. */
function transacao(docs: Record<string, Record<string, unknown>>) {
  const gravados: Array<{ path: string; dados: Record<string, unknown>; opcoes?: unknown }> = [];
  const tx = {
    get: async (ref: { path: string }) => ({ exists: () => ref.path in docs, data: () => docs[ref.path] }),
    set: (ref: { path: string }, dados: Record<string, unknown>, opcoes?: unknown) => {
      gravados.push({ path: ref.path, dados, opcoes });
      return tx;
    },
  };
  vi.mocked(runTransactionWithTimeout).mockImplementation(((fn: (t: unknown) => unknown) => fn(tx)) as never);
  return gravados;
}

const auditoria = (ciclo: number): Omit<Auditoria, 'id'> => ({
  nome: `Loja - Ciclo ${ciclo}`, inventoryId: 'E1', contagemCycle: ciclo, data: new Date(0),
  produtos: [], estatisticas: calcularEstatisticas([]), createdBy: 'aparelho', createdAt: new Date(0),
});

describe('finalizarContagem', () => {
  it('grava auditoria E1_3 e sobe o ciclo na mesma transação', async () => {
    const gravados = transacao({ 'inventories/E1': { contagemCycle: 3 } });
    expect(await finalizarContagem(auditoria(3))).toEqual({
      situacao: 'finalizada', auditoriaId: 'E1_3', cicloFinalizado: 3, proximoCiclo: 4,
    });
    expect(gravados.map((g) => g.path)).toEqual(['auditorias/E1_3', 'inventories/E1']);
    expect(gravados[0]!.dados['data']).toBeInstanceOf(Timestamp);
    expect(gravados[1]!.opcoes).toEqual({ merge: true });
    expect(Object.keys(gravados[1]!.dados).sort()).toEqual([
      'contagemCycle', 'lastFinalizedAt', 'lastFinalizedCycle', 'updatedAt',
    ]);
    expect(gravados[1]!.dados['contagemCycle']).toBe(4);
  });

  // Segundo clique depois de estouro, ou segundo aparelho: a auditoria já está lá.
  it('auditoria do ciclo já existe: não grava e informa já finalizada', async () => {
    const gravados = transacao({ 'inventories/E1': { contagemCycle: 4 }, 'auditorias/E1_3': { nome: 'x' } });
    expect(await finalizarContagem(auditoria(3))).toEqual({
      situacao: 'ja-finalizada', auditoriaId: 'E1_3', cicloFinalizado: 3,
    });
    expect(gravados).toEqual([]);
  });

  it('ciclo do servidor diferente do da tela: não grava', async () => {
    const gravados = transacao({ 'inventories/E1': { contagemCycle: 5 } });
    expect(await finalizarContagem(auditoria(3))).toEqual({ situacao: 'ciclo-mudou', cicloServidor: 5 });
    expect(gravados).toEqual([]);
  });

  it('estoque sem contagemCycle usa o ciclo da tela, como antes', async () => {
    transacao({ 'inventories/E1': { name: 'Loja' } });
    expect((await finalizarContagem(auditoria(1))).situacao).toBe('finalizada');
  });
});
