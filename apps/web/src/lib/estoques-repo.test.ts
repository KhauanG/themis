import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocs, writeBatch } from 'firebase/firestore';
import { runTransactionWithTimeout } from './firestore-write.js';
import { transacaoFalsa } from './transacao-falsa.js';
import { DocumentoAusenteError } from './gestao-escrita.js';
import { apagarDocumentoDoEstoque, apagarUpdatedItems, criarEstoque, renomearEstoque } from './estoques-repo.js';

vi.mock('./firebase.js', () => ({ db: {} }));
vi.mock('./assinatura.js', () => ({ assinaturaResiliente: vi.fn() }));
vi.mock('./firestore-write.js', async (original) => ({
  ...(await original<typeof import('./firestore-write.js')>()),
  runTransactionWithTimeout: vi.fn(),
}));
vi.mock('firebase/firestore', async (original) => ({
  ...(await original<typeof import('firebase/firestore')>()),
  collection: (base: { path?: string }, ...p: string[]) => ({ path: [base.path, ...p].filter(Boolean).join('/') }),
  doc: (base: { path?: string }, ...p: string[]) => ({ path: [base.path, ...p].filter(Boolean).join('/') }),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
}));

// `docs` é o que o servidor tem. Devolve a lista do que a função gravou.
function servidor(docs: Record<string, Record<string, unknown>>) {
  const { tx, gravacoes } = transacaoFalsa(docs);
  vi.mocked(runTransactionWithTimeout).mockImplementation(((fn: (t: unknown) => unknown) => fn(tx)) as never);
  return gravacoes;
}

beforeEach(() => vi.clearAllMocks());

describe('criarEstoque', () => {
  it('documento não existe: cria com os cinco campos, sem merge', async () => {
    const gravacoes = servidor({});
    expect(await criarEstoque('novo1', '  Loja Sul ', ' Rua 1 ')).toBe('CRIADO');
    expect(gravacoes).toHaveLength(1);
    expect(gravacoes[0]).toMatchObject({ tipo: 'set', path: 'inventories/novo1' });
    expect(gravacoes[0]!.opcoes).toBeUndefined();
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual(['contagemCycle', 'createdAt', 'description', 'name', 'updatedAt']);
    expect(gravacoes[0]!.dados).toMatchObject({ name: 'Loja Sul', description: 'Rua 1', contagemCycle: 1 });
  });
  // O reenvio depois de um "Sem confirmação" que gravou: o lote aberto no meio não pode sumir.
  it('id já existe com o mesmo nome: aceito, sem regravar', async () => {
    const gravacoes = servidor({ 'inventories/novo1': { name: 'Loja Sul', contagemCycle: 1, lote: 'LOTE A', loteCiclo: 1 } });
    expect(await criarEstoque('novo1', 'Loja Sul', '')).toBe('JA_EXISTIA');
    expect(gravacoes).toEqual([]);
  });
  it('id já existe com outro nome: conflito, sem gravar', async () => {
    const gravacoes = servidor({ 'inventories/novo1': { name: 'Outra Loja' } });
    expect(await criarEstoque('novo1', 'Loja Sul', '')).toBe('CONFLITO');
    expect(gravacoes).toEqual([]);
  });
});

describe('renomearEstoque', () => {
  const abertura = { nome: 'Loja Sul', descricao: 'Rua 1' };
  const noServidor = { name: 'Loja Sul', description: 'Rua 1', contagemCycle: 3, lote: 'LOTE A' };

  it('só o nome mudou: grava name e updatedAt, com merge', async () => {
    const gravacoes = servidor({ 'inventories/E1': noServidor });
    const r = await renomearEstoque('E1', { nome: ' Loja Sul 2 ', descricao: 'Rua 1' }, abertura);
    expect(r).toEqual({ resultado: 'GRAVAR', de: { nome: 'Loja Sul', descricao: 'Rua 1' } });
    expect(gravacoes[0]!.opcoes).toEqual({ merge: true });
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual(['name', 'updatedAt']);
    expect(gravacoes[0]!.dados!['name']).toBe('Loja Sul 2');
  });
  it('nome e descrição mudaram: grava os dois', async () => {
    const gravacoes = servidor({ 'inventories/E1': noServidor });
    await renomearEstoque('E1', { nome: 'Loja Sul 2', descricao: 'Rua 2' }, abertura);
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual(['description', 'name', 'updatedAt']);
  });
  it('a tentativa anterior já gravou: não grava de novo, e o de é o valor de abertura', async () => {
    const gravacoes = servidor({ 'inventories/E1': { ...noServidor, name: 'Loja Sul 2' } });
    const r = await renomearEstoque('E1', { nome: 'Loja Sul 2', descricao: 'Rua 1' }, abertura);
    expect(r).toEqual({ resultado: 'JA_GRAVADO', de: { nome: 'Loja Sul', descricao: 'Rua 1' } });
    expect(gravacoes).toEqual([]);
  });
  it('outro aparelho renomeou no meio: grava por cima, e o de é o do servidor', async () => {
    servidor({ 'inventories/E1': { ...noServidor, name: 'Loja Centro' } });
    const r = await renomearEstoque('E1', { nome: 'Loja Sul 2', descricao: 'Rua 1' }, abertura);
    expect(r).toEqual({ resultado: 'GRAVAR', de: { nome: 'Loja Centro', descricao: 'Rua 1' } });
  });
  it('nada mudou: sem transação', async () => {
    expect((await renomearEstoque('E1', { nome: 'Loja Sul', descricao: 'Rua 1' }, abertura)).resultado).toBe('NADA_MUDOU');
    expect(runTransactionWithTimeout).not.toHaveBeenCalled();
  });
  it('estoque excluído no meio: erro, sem recriar', async () => {
    const gravacoes = servidor({});
    await expect(renomearEstoque('E1', { nome: 'X', descricao: '' }, abertura)).rejects.toBeInstanceOf(DocumentoAusenteError);
    expect(gravacoes).toEqual([]);
  });
  it('estoque sem descrição no servidor conta como vazia', async () => {
    const gravacoes = servidor({ 'inventories/E1': { name: 'Loja Sul' } });
    await renomearEstoque('E1', { nome: 'Loja Sul 2', descricao: '' }, { nome: 'Loja Sul', descricao: '' });
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual(['name', 'updatedAt']);
  });
});

describe('apagarDocumentoDoEstoque', () => {
  it('existe: apaga na transação', async () => {
    const gravacoes = servidor({ 'inventories/E1': { name: 'Loja Sul' } });
    await apagarDocumentoDoEstoque('E1');
    expect(gravacoes).toEqual([{ tipo: 'delete', path: 'inventories/E1' }]);
  });
  it('já não existe: conta como apagado', async () => {
    const gravacoes = servidor({});
    await expect(apagarDocumentoDoEstoque('E1')).resolves.toBeUndefined();
    expect(gravacoes).toEqual([]);
  });
});

describe('apagarUpdatedItems', () => {
  it('501 documentos saem em dois lotes', async () => {
    const docs = Array.from({ length: 501 }, (_, i) => ({ ref: { path: `estoques/E1/updatedItems/u${i}` } }));
    vi.mocked(getDocs).mockResolvedValue({ docs } as never);
    const tamanhos: number[] = [];
    vi.mocked(writeBatch).mockImplementation((() => {
      let n = 0;
      return { delete: () => { n++; }, commit: async () => { tamanhos.push(n); } };
    }) as never);
    expect(await apagarUpdatedItems('E1')).toBe(501);
    expect(tamanhos).toEqual([500, 1]);
  });
});
