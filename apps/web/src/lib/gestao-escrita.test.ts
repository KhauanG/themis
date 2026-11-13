import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEXTO_FALHA, TEXTO_SEM_CONFIRMACAO, TEXTO_SEM_PERMISSAO } from '@themis/shared';
import { WriteTimeoutError, runTransactionWithTimeout } from './firestore-write.js';
import { transacaoFalsa } from './transacao-falsa.js';
import { DocumentoAusenteError, gravarCampoDeGestao, mensagemDeFalha } from './gestao-escrita.js';

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

const ref = { path: 'appSettings/global' } as never;
const campo = (abertura: boolean, pedido: boolean) => ({
  ref, rotulo: 'teste', abertura, pedido,
  ler: (d: Record<string, unknown> | undefined) => d?.['ligado'] === true,
  dados: (v: boolean) => ({ ligado: v, quando: 'agora' }),
});

describe('gravarCampoDeGestao', () => {
  it('pedido igual à abertura: não abre transação', async () => {
    expect(await gravarCampoDeGestao(campo(true, true))).toEqual({ resultado: 'NADA_MUDOU', de: true });
    expect(runTransactionWithTimeout).not.toHaveBeenCalled();
  });
  it('servidor já tem o pedido: não grava, e o de é o valor de abertura', async () => {
    const gravacoes = servidor({ 'appSettings/global': { ligado: true, outra: 1 } });
    expect(await gravarCampoDeGestao(campo(false, true))).toEqual({ resultado: 'JA_GRAVADO', de: false });
    expect(gravacoes).toEqual([]);
  });
  it('servidor diferente: grava só as chaves do campo, com merge, e o de é o do servidor', async () => {
    const gravacoes = servidor({ 'appSettings/global': { ligado: false, outra: 1 } });
    expect(await gravarCampoDeGestao(campo(false, true))).toEqual({ resultado: 'GRAVAR', de: false });
    expect(gravacoes).toEqual([
      { tipo: 'set', path: 'appSettings/global', dados: { ligado: true, quando: 'agora' }, opcoes: { merge: true } },
    ]);
  });
  it('documento ausente: ler recebe undefined e a gravação cria com merge', async () => {
    const gravacoes = servidor({});
    expect((await gravarCampoDeGestao(campo(false, true))).resultado).toBe('GRAVAR');
    expect(gravacoes).toHaveLength(1);
  });
  it('exigeDocumento: documento ausente lança e não grava', async () => {
    const gravacoes = servidor({});
    await expect(gravarCampoDeGestao({ ...campo(false, true), exigeDocumento: true })).rejects.toBeInstanceOf(DocumentoAusenteError);
    expect(gravacoes).toEqual([]);
  });
  it('a transação leva o rótulo e o teto padrão de 12 s', async () => {
    servidor({});
    await gravarCampoDeGestao(campo(false, true));
    expect(vi.mocked(runTransactionWithTimeout).mock.calls[0]![1]).toEqual({ label: 'teste' });
  });
});

describe('mensagemDeFalha', () => {
  const negado = Object.assign(new Error('x'), { code: 'permission-denied' });
  it('recusa da regra', () => {
    expect(mensagemDeFalha(negado)).toBe(TEXTO_SEM_PERMISSAO);
    expect(mensagemDeFalha(negado, { recusa: 'Texto da ação.' })).toBe('Texto da ação.');
  });
  it('teto', () => {
    expect(mensagemDeFalha(new WriteTimeoutError('t'))).toBe(TEXTO_SEM_CONFIRMACAO);
    expect(mensagemDeFalha(new WriteTimeoutError('t'), { teto: 'Pode repetir.' })).toBe('Pode repetir.');
  });
  it('outro erro, e o que não é erro', () => {
    expect(mensagemDeFalha(new Error('qualquer'))).toBe(TEXTO_FALHA);
    expect(mensagemDeFalha(undefined)).toBe(TEXTO_FALHA);
    expect(mensagemDeFalha(new DocumentoAusenteError())).toBe(TEXTO_FALHA);
  });
});
