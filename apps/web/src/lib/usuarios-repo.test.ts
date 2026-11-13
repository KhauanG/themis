import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runTransactionWithTimeout } from './firestore-write.js';
import { DocumentoAusenteError } from './gestao-escrita.js';
import { transacaoFalsa } from './transacao-falsa.js';
import { salvarEstoquesPermitidos, salvarPapeis } from './usuarios-repo.js';

vi.mock('./firebase.js', () => ({ db: {} }));
vi.mock('./firestore-write.js', async (original) => ({
  ...(await original<typeof import('./firestore-write.js')>()),
  runTransactionWithTimeout: vi.fn(),
}));
vi.mock('firebase/firestore', async (original) => ({
  ...(await original<typeof import('firebase/firestore')>()),
  collection: (base: { path?: string }, ...p: string[]) => ({ path: [base.path, ...p].filter(Boolean).join('/') }),
  doc: (base: { path?: string }, ...p: string[]) => ({ path: [base.path, ...p].filter(Boolean).join('/') }),
}));

// `docs` é o que o servidor tem. Devolve a lista do que a função gravou.
function servidor(docs: Record<string, Record<string, unknown>>) {
  const { tx, gravacoes } = transacaoFalsa(docs);
  vi.mocked(runTransactionWithTimeout).mockImplementation(((fn: (t: unknown) => unknown) => fn(tx)) as never);
  return gravacoes;
}

beforeEach(() => vi.clearAllMocks());

describe('salvarPapeis', () => {
  it('grava as três flags e updatedAt, com merge', async () => {
    const gravacoes = servidor({ 'users/u1': { firstName: 'A', lastName: 'B', isAdmin: true, allowedInventories: ['X'] } });
    expect(await salvarPapeis('u1', 'master', 'admin')).toEqual({ resultado: 'GRAVAR', de: 'admin' });
    expect(gravacoes[0]!.path).toBe('users/u1');
    expect(gravacoes[0]!.opcoes).toEqual({ merge: true });
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual(['isAdmin', 'isAuditor', 'isMaster', 'updatedAt']);
    expect(gravacoes[0]!.dados).toMatchObject({ isAdmin: true, isAuditor: false, isMaster: true });
  });
  it('o de vem do servidor quando outro master mudou no meio', async () => {
    servidor({ 'users/u1': { isAuditor: true } });
    expect(await salvarPapeis('u1', 'admin', 'comum')).toEqual({ resultado: 'GRAVAR', de: 'auditor' });
  });
  it('servidor já tem o papel pedido: não grava', async () => {
    const gravacoes = servidor({ 'users/u1': { isAdmin: true } });
    expect(await salvarPapeis('u1', 'admin', 'comum')).toEqual({ resultado: 'JA_GRAVADO', de: 'comum' });
    expect(gravacoes).toEqual([]);
  });
  it('perfil que não existe: erro, sem criar documento', async () => {
    const gravacoes = servidor({});
    await expect(salvarPapeis('u9', 'admin', 'comum')).rejects.toBeInstanceOf(DocumentoAusenteError);
    expect(gravacoes).toEqual([]);
  });
});

describe('salvarEstoquesPermitidos', () => {
  it('grava só allowedInventories e updatedAt, com merge', async () => {
    const gravacoes = servidor({ 'users/u1': { isAdmin: true, allowedInventories: ['X', 'morto'] } });
    expect(await salvarEstoquesPermitidos('u1', ['X', 'Y'], ['X', 'morto'])).toEqual({ resultado: 'GRAVAR', de: ['X', 'morto'] });
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual(['allowedInventories', 'updatedAt']);
    expect(gravacoes[0]!.dados!['allowedInventories']).toEqual(['X', 'Y']);
    expect(gravacoes[0]!.opcoes).toEqual({ merge: true });
  });
  it('liberar todos grava lista vazia', async () => {
    const gravacoes = servidor({ 'users/u1': { allowedInventories: ['morto'] } });
    expect((await salvarEstoquesPermitidos('u1', [], ['morto'])).resultado).toBe('GRAVAR');
    expect(gravacoes[0]!.dados!['allowedInventories']).toEqual([]);
  });
  it('seleção igual à abertura: nada mudou, sem transação', async () => {
    expect((await salvarEstoquesPermitidos('u1', ['X'], ['X'])).resultado).toBe('NADA_MUDOU');
    expect(runTransactionWithTimeout).not.toHaveBeenCalled();
  });
});
