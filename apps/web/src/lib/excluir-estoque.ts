/**
 * Excluir estoque (Etapa 4, desenho 6.5). A ordem é a do desenho: até o documento do estoque sumir nada
 * é registrado nem tocado fora dele, então uma falha no começo deixa o estoque na lista e a exclusão pode
 * ser repetida. Depois dele vêm só passos que não desfazem a exclusão (hash, permissões, histórico, legado).
 */
import { papelDe, semNenhumEstoque, type UserProfile } from '@themis/shared';
import { apagarHashDaLoja } from './erp.js';
import { apagarDocumentoDoEstoque, apagarUpdatedItems } from './estoques-repo.js';
import { registrar, type AutorLog } from './historico.js';
import { excluirTodosProdutos } from './produtos-repo.js';
import { limparEstoqueDoUsuario, nomeExibivel } from './usuarios-repo.js';

/** Textos do `catch` da tela, para `mensagemDeFalha`. */
export const TEXTOS_EXCLUSAO = {
  recusa: 'Não foi possível excluir. Só master pode apagar estoques.',
  teto: 'A exclusão não terminou. Pode repetir: o estoque continua na lista.',
} as const;

export interface ResultadoExclusao {
  produtos: number;
  hashRemovido: boolean;
  /** Nomes de quem não é master e terminou com lista de ids e nenhum estoque existente. */
  semNenhum: string[];
  /** Nomes de quem não teve a permissão atualizada. */
  falhasDePermissao: string[];
}

export async function excluirEstoque(opcoes: {
  alvo: { id: string; nome: string };
  afetados: readonly UserProfile[];
  estoquesRestantes: readonly { id: string }[];
  autor: AutorLog | null;
  aoProgredir?: (texto: string) => void;
}): Promise<ResultadoExclusao> {
  const { alvo, afetados, estoquesRestantes, autor, aoProgredir } = opcoes;

  const produtos = await excluirTodosProdutos(alvo.id, (n) => aoProgredir?.(`Apagando produtos… ${n}`));
  await apagarDocumentoDoEstoque(alvo.id);

  // Sem hash nem id no log: o hash é credencial do ERP.
  const hashRemovido = (await apagarHashDaLoja(alvo.id)).ok;
  if (!hashRemovido) console.warn('[estoques] O HashLoja do estoque excluído ficou no servidor.');

  aoProgredir?.('Atualizando permissões…');
  const semNenhum: string[] = [];
  const falhasDePermissao: string[] = [];
  for (const u of afetados) {
    try {
      const lista = await limparEstoqueDoUsuario(u.uid, alvo.id);
      if (papelDe(u) !== 'master' && semNenhumEstoque(lista, estoquesRestantes)) semNenhum.push(nomeExibivel(u));
    } catch (erro) {
      falhasDePermissao.push(nomeExibivel(u));
      console.warn('[estoques] Permissão não atualizada:', erro);
    }
  }

  if (autor) {
    void registrar('EXCLUIR_ESTOQUE', { ...autor, inventoryId: alvo.id, inventoryName: alvo.nome }, {
      estoque: alvo.nome,
      produtos,
      semNenhumEstoque: semNenhum.length,
      hashRemovido,
    });
  }

  try {
    await apagarUpdatedItems(alvo.id);
  } catch (erro) {
    console.warn('[estoques] Não foi possível limpar updatedItems:', erro);
  }

  return { produtos, hashRemovido, semNenhum, falhasDePermissao };
}

export function mensagemDaExclusao(r: ResultadoExclusao): string {
  let texto = `Estoque excluído, com ${r.produtos} ${r.produtos === 1 ? 'produto' : 'produtos'}.`;
  if (r.semNenhum.length > 0) texto += ` Ficaram sem nenhum estoque: ${r.semNenhum.join(', ')}.`;
  if (!r.hashRemovido) texto += ' O HashLoja não foi removido do servidor. Avise o dono.';
  if (r.falhasDePermissao.length > 0) texto += ` Não foi possível atualizar as permissões de: ${r.falhasDePermissao.join(', ')}.`;
  return texto;
}
