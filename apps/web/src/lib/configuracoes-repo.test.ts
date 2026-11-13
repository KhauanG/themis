import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { runTransactionWithTimeout } from './firestore-write.js';
import { transacaoFalsa } from './transacao-falsa.js';
import { paraConfiguracoes, salvarModoContagem, salvarVersaoApp } from './configuracoes-repo.js';

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

describe('paraConfiguracoes', () => {
  it('documento ausente: desligado e sem versão', () => {
    expect(paraConfiguracoes(undefined)).toEqual({ modoContagem: false, versaoApp: '' });
  });
  it('versão em número vira texto; outro tipo vira vazio', () => {
    expect(paraConfiguracoes({ latestNativeAppVersion: 5.4 }).versaoApp).toBe('5.4');
    expect(paraConfiguracoes({ latestNativeAppVersion: '5.4.0' }).versaoApp).toBe('5.4.0');
    expect(paraConfiguracoes({ latestNativeAppVersion: null }).versaoApp).toBe('');
  });
  it('só true liga o modo contagem', () => {
    expect(paraConfiguracoes({ modoContagem: 'true' }).modoContagem).toBe(false);
  });
});

describe('salvarModoContagem', () => {
  it('grava só modoContagem e lastUpdated, com merge', async () => {
    const gravacoes = servidor({ 'appSettings/global': { modoContagem: false, latestNativeAppVersion: '5.3.0', readonlyInventories: [] } });
    expect(await salvarModoContagem(true, false)).toEqual({ resultado: 'GRAVAR', de: false });
    expect(gravacoes).toHaveLength(1);
    expect(gravacoes[0]!.path).toBe('appSettings/global');
    expect(gravacoes[0]!.opcoes).toEqual({ merge: true });
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual(['lastUpdated', 'modoContagem']);
    expect(gravacoes[0]!.dados!['lastUpdated']).toBeInstanceOf(Timestamp);
  });
  it('outro aparelho já ligou: não grava', async () => {
    const gravacoes = servidor({ 'appSettings/global': { modoContagem: true } });
    expect(await salvarModoContagem(true, false)).toEqual({ resultado: 'JA_GRAVADO', de: false });
    expect(gravacoes).toEqual([]);
  });
});

describe('salvarVersaoApp', () => {
  it('grava só latestNativeAppVersion e lastUpdated, aparando', async () => {
    const gravacoes = servidor({ 'appSettings/global': { modoContagem: true } });
    expect(await salvarVersaoApp('  5.4.0 ', '')).toEqual({ resultado: 'GRAVAR', de: '' });
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual(['lastUpdated', 'latestNativeAppVersion']);
    expect(gravacoes[0]!.dados!['latestNativeAppVersion']).toBe('5.4.0');
  });
  it('vazio grava texto vazio, que desliga o aviso', async () => {
    const gravacoes = servidor({ 'appSettings/global': { latestNativeAppVersion: '5.3.0' } });
    expect(await salvarVersaoApp('', '5.3.0')).toEqual({ resultado: 'GRAVAR', de: '5.3.0' });
    expect(gravacoes[0]!.dados!['latestNativeAppVersion']).toBe('');
  });
  it('campo ausente no servidor conta como vazio', async () => {
    servidor({ 'appSettings/global': { modoContagem: false } });
    expect(await salvarVersaoApp('', '5.3.0')).toEqual({ resultado: 'JA_GRAVADO', de: '5.3.0' });
  });
  it('recusa da transação sobe para a tela', async () => {
    vi.mocked(runTransactionWithTimeout).mockRejectedValue(Object.assign(new Error('x'), { code: 'permission-denied' }));
    await expect(salvarVersaoApp('5.4.0', '')).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
