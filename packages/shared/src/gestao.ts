// Funções puras da gestão (Etapa 4). Os casos de packages/shared/casos/gestao.json são os mesmos do app.

/** Os três textos de falha são fixos: nenhuma tela de gestão inventa outro. */
export const TEXTO_SEM_PERMISSAO = 'Sem permissão para esta ação.';
export const TEXTO_SEM_CONFIRMACAO = 'Sem confirmação do servidor. Confira a conexão e tente de novo.';
export const TEXTO_FALHA = 'Não foi possível salvar. Tente de novo.';
export const TEXTO_NADA_MUDOU = 'Nada mudou.';

export type Repeticao = 'NADA_MUDOU' | 'JA_GRAVADO' | 'GRAVAR';
/** Valor de um campo de gestão. Listas comparam item a item, na ordem. */
export type ValorGestao = string | number | boolean | readonly string[];
export interface ResultadoGestao<T> {
  resultado: Repeticao;
  de: T;
}

/** Desenho 5.2. Nesta ordem: pedido == abertura → NADA_MUDOU; servidor == pedido → JA_GRAVADO; senão GRAVAR. */
export function decidirRepeticao(abertura: ValorGestao, pedido: ValorGestao, servidor: ValorGestao): Repeticao {
  const igual = (a: ValorGestao, b: ValorGestao) => JSON.stringify(a) === JSON.stringify(b);
  if (igual(pedido, abertura)) return 'NADA_MUDOU';
  if (igual(servidor, pedido)) return 'JA_GRAVADO';
  return 'GRAVAR';
}

/**
 * Formulário com vários campos. `resultado`: GRAVAR se algum campo é GRAVAR; senão JA_GRAVADO se algum é;
 * senão NADA_MUDOU. `de[k]`: o valor do servidor quando o campo é GRAVAR; senão o de abertura.
 */
export function decidirEdicao<T extends Record<string, ValorGestao>>(
  abertura: T,
  pedido: T,
  servidor: T,
): { resultado: Repeticao; campos: Record<keyof T, Repeticao>; de: T } {
  const campos = {} as Record<keyof T, Repeticao>;
  const de = {} as T;
  for (const k of Object.keys(abertura) as (keyof T)[]) {
    // As casts só calam o noUncheckedIndexedAccess: `k` vem das chaves de `abertura`.
    campos[k] = decidirRepeticao(abertura[k] as ValorGestao, pedido[k] as ValorGestao, servidor[k] as ValorGestao);
    de[k] = (campos[k] === 'GRAVAR' ? servidor[k] : abertura[k]) as T[keyof T];
  }
  const todos = Object.values(campos);
  const resultado: Repeticao = todos.includes('GRAVAR')
    ? 'GRAVAR'
    : todos.includes('JA_GRAVADO')
      ? 'JA_GRAVADO'
      : 'NADA_MUDOU';
  return { resultado, campos, de };
}

/** Apara antes. Vazio aceita. Senão `^\d+(\.\d+){1,2}$`. */
export function versaoAppValida(texto: string): boolean {
  const t = texto.trim();
  return t === '' || /^\d+(\.\d+){1,2}$/.test(t);
}

/** Apara, minúsculas em pt-BR, NFD, tira `\p{Mn}`. Igual ao `TextoBusca.normalizar` do app. */
export function chaveNomeEstoque(nome: string): string {
  return nome.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Mn}+/gu, '');
}

/** Há outro estoque (id diferente de `ignorarId`) com a mesma `chaveNomeEstoque`? */
export function nomeEstoqueRepetido(
  nome: string,
  estoques: readonly { id: string; nome?: string }[],
  ignorarId: string | null,
): boolean {
  const chave = chaveNomeEstoque(nome);
  return estoques.some((e) => e.id !== ignorarId && chaveNomeEstoque(e.nome ?? '') === chave);
}

/** Desenho 5.4: com o modo contagem ligado, o cadastro fica bloqueado na tela. */
export function gestaoDeCadastroBloqueada(config: { modoContagem: boolean }): boolean {
  return config.modoContagem;
}
