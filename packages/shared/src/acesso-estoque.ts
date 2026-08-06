/**
 * Quais estoques cada usuário enxerga.
 *
 * ⚠️ **Isto é escopo de interface, não barreira de segurança.** As Security Rules liberam
 * leitura e escrita de `estoques/{qualquer}/produtos` para qualquer usuário autenticado —
 * era assim no Themis 1.x e continua sendo, porque as regras são compartilhadas entre os
 * dois apps. Quem souber montar a requisição alcança qualquer estoque.
 *
 * Serve para **organizar**: o funcionário da Loja Centro não precisa rolar por seis
 * depósitos para achar o dele, nem contar no lugar errado por engano. Isso tem valor real
 * e evita erro humano — só não é proteção.
 *
 * Para virar barreira de verdade seria preciso mudar `firestore.rules`, o que afeta o 1.x
 * na hora. Registrado em `docs/pendencias.md`.
 *
 * Semântica herdada do 1.x, mantida:
 *  - **lista vazia = acesso a todos**. É o padrão de quem nunca foi configurado.
 *  - **master enxerga tudo**, independente da lista.
 *  - sem documento de perfil, libera — não trancar ninguém para fora por falha de leitura.
 */
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
 * por exemplo — devolve a lista inteira. Melhor mostrar tudo que deixar o app sem estoque
 * nenhum e o funcionário sem conseguir trabalhar; e o caso é raro o bastante para não
 * valer uma tela de erro.
 */
export function filtrarEstoquesPermitidos(
  estoques: readonly Inventory[],
  perfil: PerfilAcesso,
  papel: Papel,
): Inventory[] {
  if (semRestricaoDeEstoque(perfil, papel)) return [...estoques];

  const permitidos = new Set(estoquesPermitidos(perfil));
  const filtrados = estoques.filter((e) => permitidos.has(e.id));

  return filtrados.length > 0 ? filtrados : [...estoques];
}
