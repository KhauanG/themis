/**
 * Quais estoques cada usuário enxerga.
 *
 * Desde a 2.14 a regra do Firestore barra a **gravação** fora da lista (`podeAcessarEstoque`
 * em `firestore/firestore.rules`). A leitura continua aberta de propósito, para o seletor.
 * Aqui fica o filtro da interface, que não pode ser mais permissivo que a regra.
 *
 * Semântica herdada do 1.x, mantida:
 *  - **lista vazia = acesso a todos**. É o padrão de quem nunca foi configurado.
 *  - **lista com ids e nenhum existente = nenhum estoque**.
 *  - **master enxerga tudo**, independente da lista.
 *  - sem documento de perfil, libera — não trancar ninguém para fora por falha de leitura.
 */
import { papelDe } from './papeis.js';
import type { Inventory, Papel, UserProfile } from './types.js';

type PerfilAcesso = Pick<UserProfile, 'allowedInventories'> | null;

/** Lista limpa de estoques permitidos. Vazia significa "todos". */
export function estoquesPermitidos(perfil: PerfilAcesso): string[] {
  const lista = perfil?.allowedInventories;
  if (!Array.isArray(lista)) return [];
  return lista.map(String).filter((id) => id.trim() !== '');
}

/** `true` quando o usuário tem a lista aberta — enxerga tudo. */
export function semRestricaoDeEstoque(perfil: PerfilAcesso, papel: Papel): boolean {
  return papel === 'master' || estoquesPermitidos(perfil).length === 0;
}

export function podeAcessarEstoque(
  perfil: PerfilAcesso,
  papel: Papel,
  inventoryId: string,
): boolean {
  if (semRestricaoDeEstoque(perfil, papel)) return true;
  return estoquesPermitidos(perfil).includes(inventoryId);
}

/**
 * Filtra a lista de estoques pelo que o usuário pode ver.
 *
 * Se a restrição não deixar nenhum estoque de pé — porque os permitidos foram apagados,
 * por exemplo — devolve vazio. A tela "Nenhum estoque" cobre o caso; mostrar tudo seria
 * mais permissivo que a regra.
 */
export function filtrarEstoquesPermitidos(
  estoques: readonly Inventory[],
  perfil: PerfilAcesso,
  papel: Papel,
): Inventory[] {
  if (semRestricaoDeEstoque(perfil, papel)) return [...estoques];

  const permitidos = new Set(estoquesPermitidos(perfil));
  return estoques.filter((e) => permitidos.has(e.id));
}

/** A lista tem ids e nenhum deles existe em `estoques`. Lista vazia devolve `false` (vale "todos"). */
export function semNenhumEstoque(lista: readonly string[], estoques: readonly { id: string }[]): boolean {
  return lista.length > 0 && estoquesExistentes(lista, estoques).length === 0;
}

/** Os ids de `lista` que existem em `estoques`, na ordem de `lista`. */
export function estoquesExistentes(lista: readonly string[], estoques: readonly { id: string }[]): string[] {
  const vivos = new Set(estoques.map((e) => e.id));
  return lista.filter((id) => vivos.has(id));
}

/** Desenho 5.3 (F7): lista vazia → "todos os estoques"; nenhum existente → "nenhum estoque"; senão os nomes dos que existem, na ordem da lista, com ", ". */
export function textoEstoquesPermitidos(
  lista: readonly string[],
  estoques: readonly { id: string; nome?: string }[],
): string {
  if (lista.length === 0) return 'todos os estoques';
  const porId = new Map(estoques.map((e) => [e.id, e.nome || e.id]));
  const nomes = estoquesExistentes(lista, estoques).map((id) => porId.get(id)!);
  return nomes.length > 0 ? nomes.join(', ') : 'nenhum estoque';
}

/**
 * Desenho 5.8. A lista de permitidos de quem perde um estoque excluído: tira `idExcluido` e os ids em
 * branco. `null` = não gravar: o id não está na lista, ou a lista ficaria vazia (vazia = "todos").
 */
export function novaListaSemEstoque(
  listaAtual: readonly unknown[] | null | undefined,
  idExcluido: string,
): string[] | null {
  const lista = estoquesPermitidos({ allowedInventories: (listaAtual ?? undefined) as string[] | undefined });
  const nova = lista.filter((id) => id !== idExcluido);
  return nova.length === lista.length || nova.length === 0 ? null : nova;
}

type PerfilDaLimpeza = Pick<UserProfile, 'allowedInventories' | 'isMaster' | 'isAdmin' | 'isAuditor'>;

/**
 * Só para o aviso do modal de exclusão. `afetados`: quem tem o id na lista. `semNenhum`: afetados que não são
 * master e ficariam com lista de ids e nenhum estoque existente. A gravação relê a lista; isto não decide nada.
 */
export function planejarLimpezaDePermissoes<U extends PerfilDaLimpeza>(
  usuarios: readonly U[],
  estoques: readonly { id: string }[],
  idExcluido: string,
): { afetados: U[]; semNenhum: U[] } {
  const restantes = estoques.filter((e) => e.id !== idExcluido);
  const afetados = usuarios.filter((u) => estoquesPermitidos(u).includes(idExcluido));
  const semNenhum = afetados.filter((u) => {
    const efetiva = novaListaSemEstoque(u.allowedInventories, idExcluido) ?? estoquesPermitidos(u);
    return papelDe(u) !== 'master' && semNenhumEstoque(efetiva, restantes);
  });
  return { afetados, semNenhum };
}
