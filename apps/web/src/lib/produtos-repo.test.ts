import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeBatch } from 'firebase/firestore';
import { runTransactionWithTimeout } from './firestore-write.js';
import { transacaoFalsa } from './transacao-falsa.js';
import { cadastrarProduto, editarCadastroProduto, excluirProduto, limparContagem } from './produtos-repo.js';

vi.mock('./firebase.js', () => ({ db: {} }));
vi.mock('./assinatura.js', () => ({ assinaturaResiliente: vi.fn() }));
vi.mock('./dispositivo.js', () => ({ deviceId: () => 'aparelho', deviceLabel: () => 'Teste' }));
vi.mock('./firestore-write.js', async (original) => ({
  ...(await original<typeof import('./firestore-write.js')>()),
  runTransactionWithTimeout: vi.fn(),
}));
vi.mock('firebase/firestore', async (original) => ({
  ...(await original<typeof import('firebase/firestore')>()),
  collection: (base: { path?: string }, ...p: string[]) => ({ path: [base.path, ...p].filter(Boolean).join('/') }),
  doc: (base: { path?: string }, ...p: string[]) => ({ path: [base.path, ...p].filter(Boolean).join('/') }),
  writeBatch: vi.fn(),
}));

// `docs` é o que o servidor tem. Devolve a lista do que a função gravou.
function servidor(docs: Record<string, Record<string, unknown>>) {
  const { tx, gravacoes } = transacaoFalsa(docs);
  vi.mocked(runTransactionWithTimeout).mockImplementation(((fn: (t: unknown) => unknown) => fn(tx)) as never);
  return gravacoes;
}

beforeEach(() => vi.clearAllMocks());

const campos = { nome: 'Guarana 2L', codigoBarras: '791', idErp: '45' };

describe('cadastrarProduto', () => {
  it('produto não existe: cria com as treze chaves do desenho 5.6', async () => {
    const gravacoes = servidor({});
    expect(await cadastrarProduto('E1', 'p9', campos)).toBe('CRIADO');
    expect(gravacoes[0]).toMatchObject({ tipo: 'set', path: 'estoques/E1/produtos/p9' });
    expect(gravacoes[0]!.opcoes).toBeUndefined();
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual([
      'CodigoBarras', 'EstoqueAtual', 'IdProduto', 'NomeProduto', 'codigoBarras', 'createdAt', 'estoqueSistema',
      'inventoryId', 'lastModified', 'modifiedBy', 'nome', 'quantidade', 'temCodigoBarras',
    ]);
    expect(gravacoes[0]!.dados).toMatchObject({ IdProduto: '45', quantidade: 0, estoqueSistema: 0, modifiedBy: 'aparelho', inventoryId: 'E1' });
  });
  // Reenvio depois de um "Sem confirmação" que gravou. Alguém pode já ter contado o item.
  it('id já existe com o mesmo nome: aceito, sem regravar a contagem', async () => {
    const gravacoes = servidor({ 'estoques/E1/produtos/p9': { nome: 'Guarana 2L', quantidade: 12, productStatus: 'ATUALIZADO' } });
    expect(await cadastrarProduto('E1', 'p9', campos)).toBe('JA_EXISTIA');
    expect(gravacoes).toEqual([]);
  });
  it('id já existe com outro nome: conflito', async () => {
    const gravacoes = servidor({ 'estoques/E1/produtos/p9': { nome: 'Outro' } });
    expect(await cadastrarProduto('E1', 'p9', campos)).toBe('CONFLITO');
    expect(gravacoes).toEqual([]);
  });
});

describe('editarCadastroProduto', () => {
  const abertura = { nome: 'Guarana', codigoBarras: '791', idErp: '45' };
  const noServidor = { nome: 'Guarana', NomeProduto: 'Guarana', codigoBarras: '791', IdProduto: '45', quantidade: 12, productStatus: 'ATUALIZADO' };

  it('só o nome: grava nome, NomeProduto, lastModified e modifiedBy', async () => {
    const gravacoes = servidor({ 'estoques/E1/produtos/p1': noServidor });
    const r = await editarCadastroProduto('E1', 'p1', { ...abertura, nome: 'Guarana 2L' }, abertura);
    expect(r.resultado).toBe('GRAVAR');
    expect(r.campos).toEqual({ nome: 'GRAVAR', codigoBarras: 'NADA_MUDOU', idErp: 'NADA_MUDOU' });
    expect(r.de).toEqual(abertura);
    expect(gravacoes[0]).toMatchObject({ tipo: 'update', path: 'estoques/E1/produtos/p1' });
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual(['NomeProduto', 'lastModified', 'modifiedBy', 'nome']);
  });
  it('nunca manda quantidade, status, validade, saldo nem apiNotFound', async () => {
    const gravacoes = servidor({ 'estoques/E1/produtos/p1': noServidor });
    await editarCadastroProduto('E1', 'p1', { nome: 'N', codigoBarras: '792', idErp: '46' }, abertura);
    for (const chave of ['quantidade', 'productStatus', 'dataValidade', 'estoqueSistema', 'EstoqueAtual', 'apiNotFound']) {
      expect(gravacoes[0]!.dados).not.toHaveProperty(chave);
    }
  });
  it('ID novo apaga as grafias antigas que o documento tem', async () => {
    const gravacoes = servidor({ 'estoques/E1/produtos/p1': { nome: 'Guarana', codigoBarras: '791', idProduto: 45, idProdut: '45' } });
    await editarCadastroProduto('E1', 'p1', { ...abertura, idErp: '46' }, abertura);
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual(['IdProduto', 'idProdut', 'idProduto', 'lastModified', 'modifiedBy']);
    expect(gravacoes[0]!.dados!['IdProduto']).toBe('46');
  });
  it('ID novo num documento sem grafias antigas não manda chave a mais', async () => {
    const gravacoes = servidor({ 'estoques/E1/produtos/p1': noServidor });
    await editarCadastroProduto('E1', 'p1', { ...abertura, idErp: '46' }, abertura);
    expect(Object.keys(gravacoes[0]!.dados!).sort()).toEqual(['IdProduto', 'lastModified', 'modifiedBy']);
  });
  it('a tentativa anterior já gravou: não grava de novo', async () => {
    const gravacoes = servidor({ 'estoques/E1/produtos/p1': { ...noServidor, nome: 'Guarana 2L' } });
    const r = await editarCadastroProduto('E1', 'p1', { ...abertura, nome: 'Guarana 2L' }, abertura);
    expect(r.resultado).toBe('JA_GRAVADO');
    expect(gravacoes).toEqual([]);
  });
  it('nada mudou: sem transação', async () => {
    expect((await editarCadastroProduto('E1', 'p1', abertura, abertura)).resultado).toBe('NADA_MUDOU');
    expect(runTransactionWithTimeout).not.toHaveBeenCalled();
  });
  it('produto apagado no meio: erro, sem recriar', async () => {
    const gravacoes = servidor({});
    await expect(editarCadastroProduto('E1', 'p1', { ...abertura, nome: 'X' }, abertura)).rejects.toThrow();
    expect(gravacoes).toEqual([]);
  });
});

describe('excluirProduto', () => {
  it('existe: apaga na transação', async () => {
    const gravacoes = servidor({ 'estoques/E1/produtos/p1': { nome: 'Guarana' } });
    await excluirProduto('E1', 'p1');
    expect(gravacoes).toEqual([{ tipo: 'delete', path: 'estoques/E1/produtos/p1' }]);
  });
  it('já não existe: conta como excluído', async () => {
    const gravacoes = servidor({});
    await expect(excluirProduto('E1', 'p1')).resolves.toBeUndefined();
    expect(gravacoes).toEqual([]);
  });
});

describe('limparContagem', () => {
  it('remove também corrigidoCritico, e só o que o produto tem', async () => {
    const atualizacoes: Array<{ path: string; dados: Record<string, unknown> }> = [];
    vi.mocked(writeBatch).mockReturnValue({
      update: (ref: { path: string }, dados: Record<string, unknown>) => void atualizacoes.push({ path: ref.path, dados }),
      commit: async () => undefined,
    } as never);

    await limparContagem('E1', [
      { id: 'p1', quantidade: 5, productStatus: 'CONFERIDO', corrigidoIncorreto: true, corrigidoCritico: true, dataValidade: '2026-12-31' },
      { id: 'p2', quantidade: 0 },
    ]);

    expect(atualizacoes.map((a) => a.path)).toEqual(['estoques/E1/produtos/p1', 'estoques/E1/produtos/p2']);
    expect(Object.keys(atualizacoes[0]!.dados).sort()).toEqual([
      'corrigidoCritico', 'corrigidoIncorreto', 'dataValidade', 'lastModified', 'modifiedBy', 'productStatus', 'quantidade',
    ]);
    expect(Object.keys(atualizacoes[1]!.dados).sort()).toEqual(['lastModified', 'modifiedBy', 'quantidade']);
    expect(atualizacoes[0]!.dados['quantidade']).toBe(0);
  });
});
