import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEXTO_FALHA, type UserProfile } from '@themis/shared';
import { apagarDocumentoDoEstoque, apagarUpdatedItems } from './estoques-repo.js';
import { apagarHashDaLoja } from './erp.js';
import { WriteTimeoutError } from './firestore-write.js';
import { mensagemDeFalha } from './gestao-escrita.js';
import { registrar } from './historico.js';
import { excluirTodosProdutos } from './produtos-repo.js';
import { limparEstoqueDoUsuario } from './usuarios-repo.js';
import { TEXTOS_EXCLUSAO, excluirEstoque, mensagemDaExclusao } from './excluir-estoque.js';

vi.mock('./firebase.js', () => ({ db: {} }));
vi.mock('./produtos-repo.js', () => ({ excluirTodosProdutos: vi.fn() }));
vi.mock('./estoques-repo.js', () => ({ apagarDocumentoDoEstoque: vi.fn(), apagarUpdatedItems: vi.fn() }));
vi.mock('./erp.js', () => ({ apagarHashDaLoja: vi.fn() }));
vi.mock('./historico.js', () => ({ registrar: vi.fn() }));
vi.mock('./usuarios-repo.js', () => ({
  limparEstoqueDoUsuario: vi.fn(),
  nomeExibivel: (p: UserProfile) => p.firstName ?? p.uid,
}));

const ana: UserProfile = { uid: 'u1', firstName: 'Ana', allowedInventories: ['E1'] };
const bia: UserProfile = { uid: 'u2', firstName: 'Bia', allowedInventories: ['E1', 'E2'] };
const mestre: UserProfile = { uid: 'u3', firstName: 'Mestre', isMaster: true, allowedInventories: ['E1'] };
const autor = { userId: 'm1', userEmail: 'm@x.com', userName: 'Master' };
const pedido = (afetados: UserProfile[] = [ana, bia]) => ({
  alvo: { id: 'E1', nome: 'Loja Sul' }, afetados, estoquesRestantes: [{ id: 'E2' }], autor,
});

let ordem: string[];
beforeEach(() => {
  vi.clearAllMocks();
  ordem = [];
  vi.mocked(excluirTodosProdutos).mockImplementation(async () => { ordem.push('produtos'); return 3; });
  vi.mocked(apagarDocumentoDoEstoque).mockImplementation(async () => { ordem.push('documento'); });
  vi.mocked(apagarHashDaLoja).mockImplementation(async () => { ordem.push('hash'); return { ok: true }; });
  vi.mocked(limparEstoqueDoUsuario).mockImplementation(async (uid) => {
    ordem.push(`permissao:${uid}`);
    return uid === 'u2' ? ['E2'] : ['E1'];
  });
  vi.mocked(registrar).mockImplementation(async () => { ordem.push('historico'); });
  vi.mocked(apagarUpdatedItems).mockImplementation(async () => { ordem.push('updatedItems'); return 0; });
});

describe('excluirEstoque', () => {
  it('segue a ordem e registra o histórico uma vez, com os valores reais', async () => {
    const r = await excluirEstoque(pedido());
    expect(ordem).toEqual(['produtos', 'documento', 'hash', 'permissao:u1', 'permissao:u2', 'historico', 'updatedItems']);
    expect(r).toEqual({ produtos: 3, hashRemovido: true, semNenhum: ['Ana'], falhasDePermissao: [] });
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledWith(
      'EXCLUIR_ESTOQUE',
      { ...autor, inventoryId: 'E1', inventoryName: 'Loja Sul' },
      { estoque: 'Loja Sul', produtos: 3, semNenhumEstoque: 1, hashRemovido: true },
    );
  });
  it('falha de uma pessoa não para as outras, e ela não conta em semNenhum', async () => {
    vi.mocked(limparEstoqueDoUsuario).mockImplementation(async (uid) => {
      if (uid === 'u1') throw Object.assign(new Error('x'), { code: 'permission-denied' });
      return ['E2'];
    });
    const r = await excluirEstoque(pedido());
    expect(limparEstoqueDoUsuario).toHaveBeenCalledTimes(2);
    expect(r.falhasDePermissao).toEqual(['Ana']);
    expect(r.semNenhum).toEqual([]);
    expect(vi.mocked(registrar).mock.calls[0]![2]).toMatchObject({ semNenhumEstoque: 0 });
  });
  it('master é limpo, mas não conta em semNenhum', async () => {
    const r = await excluirEstoque(pedido([mestre]));
    expect(limparEstoqueDoUsuario).toHaveBeenCalledWith('u3', 'E1');
    expect(r.semNenhum).toEqual([]);
  });
  it('hash que não saiu não para a exclusão', async () => {
    vi.mocked(apagarHashDaLoja).mockResolvedValue({ ok: false, erro: 'Sem resposta do servidor' });
    const r = await excluirEstoque(pedido());
    expect(r.hashRemovido).toBe(false);
    expect(vi.mocked(registrar).mock.calls[0]![2]).toMatchObject({ hashRemovido: false });
    expect(apagarUpdatedItems).toHaveBeenCalled();
  });
  it('produtos não terminaram: para antes do documento e não registra', async () => {
    vi.mocked(excluirTodosProdutos).mockRejectedValue(new WriteTimeoutError('apagar produtos'));
    await expect(excluirEstoque(pedido())).rejects.toMatchObject({ isWriteTimeout: true });
    expect(apagarDocumentoDoEstoque).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
  it('documento não confirmado: não toca hash nem permissões, e não registra', async () => {
    vi.mocked(apagarDocumentoDoEstoque).mockRejectedValue(new WriteTimeoutError('excluir estoque'));
    await expect(excluirEstoque(pedido())).rejects.toMatchObject({ isWriteTimeout: true });
    expect(apagarHashDaLoja).not.toHaveBeenCalled();
    expect(limparEstoqueDoUsuario).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
  it('falha ao limpar updatedItems não muda o resultado', async () => {
    vi.mocked(apagarUpdatedItems).mockRejectedValue(new Error('x'));
    await expect(excluirEstoque(pedido())).resolves.toMatchObject({ produtos: 3 });
  });
  it('sem autor: exclui e não registra', async () => {
    await excluirEstoque({ ...pedido(), autor: null });
    expect(registrar).not.toHaveBeenCalled();
    expect(apagarUpdatedItems).toHaveBeenCalled();
  });
});

describe('mensagemDaExclusao', () => {
  it('tudo certo, singular e plural', () => {
    expect(mensagemDaExclusao({ produtos: 1, hashRemovido: true, semNenhum: [], falhasDePermissao: [] }))
      .toBe('Estoque excluído, com 1 produto.');
    expect(mensagemDaExclusao({ produtos: 0, hashRemovido: true, semNenhum: [], falhasDePermissao: [] }))
      .toBe('Estoque excluído, com 0 produtos.');
  });
  it('junta os três avisos, nesta ordem', () => {
    expect(mensagemDaExclusao({ produtos: 3, hashRemovido: false, semNenhum: ['Ana', 'Bia'], falhasDePermissao: ['Caio'] })).toBe(
      'Estoque excluído, com 3 produtos. Ficaram sem nenhum estoque: Ana, Bia. O HashLoja não foi removido do servidor. Avise o dono. Não foi possível atualizar as permissões de: Caio.',
    );
  });
});

// Desenho 6.5: a mensagem da exclusão muda com o tipo do erro. É o que a tela mostra no `catch`.
describe('TEXTOS_EXCLUSAO', () => {
  it('recusa e teto têm o texto da exclusão; o resto cai no texto geral', () => {
    const negado = Object.assign(new Error('x'), { code: 'permission-denied' });
    expect(mensagemDeFalha(negado, TEXTOS_EXCLUSAO)).toBe('Não foi possível excluir. Só master pode apagar estoques.');
    expect(mensagemDeFalha(new WriteTimeoutError('excluir estoque'), TEXTOS_EXCLUSAO))
      .toBe('A exclusão não terminou. Pode repetir: o estoque continua na lista.');
    expect(mensagemDeFalha(new Error('x'), TEXTOS_EXCLUSAO)).toBe(TEXTO_FALHA);
  });
});
