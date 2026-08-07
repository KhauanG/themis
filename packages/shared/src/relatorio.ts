/**
 * Linha de relatório — formato único para exibir e exportar contagem ao vivo e auditoria
 * salva.
 *
 * Sem isto, cada exportação precisava saber de onde vinha o dado (produto do Firestore ou
 * snapshot gravado dentro da auditoria) e era fácil exportar a contagem atual achando que
 * estava exportando a auditoria antiga selecionada na tela.
 *
 * O filtro também mora aqui: a tela e o PDF aplicam **a mesma função**, então o arquivo
 * gerado é exatamente o que está sendo visto.
 */
import type { Produto, ProdutoSnapshot, StatusAuditoria } from './types.js';
import { diferencaDe, statusDe } from './auditoria.js';
import { fisicoDe, foraDoErp, isItemContado, nomeDe, sistemaDe, validadeDe } from './produto.js';

export interface LinhaRelatorio {
  id: string;
  nome: string;
  /**
   * Saldo do sistema. `'-'` quando o produto está **fora do ERP**.
   *
   * Ali o número guardado é o da última importação, que o ERP nunca confirmou. Imprimir
   * `sistema 1` num relatório que vai para a diretoria afirma algo que não sabemos, e faz
   * pedir correção de saldo quando o que falta é cadastro.
   */
  sistema: number | '-';
  /** `null` quando o item não foi contado — diferente de zero, que é contagem válida. */
  contado: number | null;
  diferenca: number | '-';
  status: StatusAuditoria;
  validade: string | null;
}

export function linhasDeProdutos(produtos: readonly Produto[]): LinhaRelatorio[] {
  return produtos.map((p) => {
    const fora = foraDoErp(p);
    return {
      id: p.id,
      nome: nomeDe(p),
      sistema: fora ? ('-' as const) : sistemaDe(p),
      contado: !fora && isItemContado(p) ? fisicoDe(p) : null,
      diferenca: diferencaDe(p),
      status: statusDe(p),
      validade: validadeDe(p),
    };
  });
}

export function linhasDeSnapshot(snapshot: readonly ProdutoSnapshot[]): LinhaRelatorio[] {
  return snapshot.map((s) => ({
    id: s.id,
    nome: s.nome,
    // Auditoria salva antes desta versão não tinha o status; a checagem cobre as duas.
    sistema: s.status === 'FORA DO ERP' ? ('-' as const) : s.estoqueSistema,
    contado: s.status === 'NÃO CONTADO' || s.status === 'FORA DO ERP' ? null : s.estoqueFisico,
    diferenca: s.diferenca,
    status: s.status,
    validade: s.dataValidade,
  }));
}

export function ordenarPorNome(linhas: readonly LinhaRelatorio[]): LinhaRelatorio[] {
  return [...linhas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ------------------------------------------------------------------ filtros

export type SituacaoRelatorio = 'todos' | 'contados' | 'nao-contados';

/**
 * Ordenação do relatório.
 *
 * União achatada em vez de `{ campo, direcao }` porque este valor viaja no filtro que a
 * tela guarda, o PDF descreve e o `<select>` mostra — um objeto obrigaria a mexer nos três
 * e nos testes, sem ganhar nada. Cada coluna clicável tem seu par crescente/decrescente.
 */
export type OrdemRelatorio =
  | 'nome'
  | 'nome-desc'
  | 'maior-sistema'
  | 'menor-sistema'
  | 'maior-contado'
  | 'menor-contado'
  | 'maior-diferenca'
  | 'menor-diferenca'
  | 'status'
  | 'status-desc';

/** Colunas que respondem ao clique no cabeçalho. */
export type ColunaOrdenavel = 'nome' | 'sistema' | 'contado' | 'diferenca' | 'status';

/** `[decrescente, crescente]` de cada coluna. O clique começa pelo primeiro. */
const ORDENS_DA_COLUNA: Record<ColunaOrdenavel, readonly [OrdemRelatorio, OrdemRelatorio]> = {
  // Nome começa em A–Z porque é como se procura um produto numa lista.
  nome: ['nome', 'nome-desc'],
  sistema: ['maior-sistema', 'menor-sistema'],
  contado: ['maior-contado', 'menor-contado'],
  diferenca: ['maior-diferenca', 'menor-diferenca'],
  status: ['status', 'status-desc'],
};

/**
 * Próxima ordenação ao clicar no cabeçalho da coluna.
 *
 * Primeiro clique aplica a ordem principal da coluna; clicar de novo inverte. Clicar em
 * outra coluna recomeça pela principal — herdar a direção da coluna anterior surpreende.
 */
export function ordemAoClicar(coluna: ColunaOrdenavel, atual: OrdemRelatorio): OrdemRelatorio {
  const [principal, invertida] = ORDENS_DA_COLUNA[coluna];
  return atual === principal ? invertida : principal;
}

/** Direção ativa da coluna, para a seta e o `aria-sort`. `null` quando não é a ordenada. */
export function direcaoDaColuna(
  coluna: ColunaOrdenavel,
  ordem: OrdemRelatorio,
): 'ascending' | 'descending' | null {
  const [principal, invertida] = ORDENS_DA_COLUNA[coluna];
  if (ordem === principal) return coluna === 'nome' ? 'ascending' : 'descending';
  if (ordem === invertida) return coluna === 'nome' ? 'descending' : 'ascending';
  return null;
}

export interface FiltroRelatorio {
  situacao: SituacaoRelatorio;
  status: StatusAuditoria | 'TODOS';
  ordem: OrdemRelatorio;
  /** Só divergências, ignorando quem bateu certo. */
  somenteDivergentes: boolean;
}

export const FILTRO_PADRAO: FiltroRelatorio = {
  situacao: 'todos',
  status: 'TODOS',
  ordem: 'nome',
  somenteDivergentes: false,
};

export const ROTULO_SITUACAO: Record<SituacaoRelatorio, string> = {
  todos: 'Todos os itens',
  contados: 'Somente contados',
  'nao-contados': 'Somente não contados',
};

export const ROTULO_ORDEM: Record<OrdemRelatorio, string> = {
  nome: 'Nome (A–Z)',
  'nome-desc': 'Nome (Z–A)',
  'maior-sistema': 'Maior estoque no sistema',
  'menor-sistema': 'Menor estoque no sistema',
  'maior-contado': 'Maior quantidade contada',
  'menor-contado': 'Menor quantidade contada',
  'maior-diferenca': 'Maior diferença',
  'menor-diferenca': 'Menor diferença',
  status: 'Gravidade',
  'status-desc': 'Gravidade (invertida)',
};

/** Gravidade decrescente: o que precisa de ação aparece antes. */
const PESO_STATUS: Record<StatusAuditoria, number> = {
  CRITICO: 0,
  ERRADO: 1,
  // Pede ação, mas no cadastro do Nuvem3, não na prateleira. Vem depois da divergência
  // real e antes do que só falta contar.
  'FORA DO ERP': 2,
  'NÃO CONTADO': 3,
  CORRETO: 4,
};

function moduloDaDiferenca(l: LinhaRelatorio): number {
  return l.diferenca === '-' ? -1 : Math.abs(l.diferenca);
}

/**
 * Número da coluna para ordenar, ou `null` quando não há valor.
 *
 * `sistema` é `'-'` em produto fora do ERP; `contado` é `null` em item não contado. Os dois
 * viram `null` aqui, e `null` **vai sempre para o fim**, nos dois sentidos — ordenar
 * crescente e receber 400 traços antes do primeiro número esconde o dado que se foi buscar.
 */
function valorDaColuna(l: LinhaRelatorio, coluna: 'sistema' | 'contado'): number | null {
  const bruto = coluna === 'sistema' ? l.sistema : l.contado;
  return typeof bruto === 'number' ? bruto : null;
}

function porValor(
  coluna: 'sistema' | 'contado',
  maiorPrimeiro: boolean,
): (a: LinhaRelatorio, b: LinhaRelatorio) => number {
  return (a, b) => {
    const va = valorDaColuna(a, coluna);
    const vb = valorDaColuna(b, coluna);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return maiorPrimeiro ? vb - va : va - vb;
  };
}

export function filtrarLinhas(
  linhas: readonly LinhaRelatorio[],
  filtro: FiltroRelatorio,
): LinhaRelatorio[] {
  const resultado = linhas.filter((l) => {
    // Pela presença da contagem, não pelo status: `FORA DO ERP` também não tem contagem,
    // e comparar com `'NÃO CONTADO'` o classificaria como contado.
    const contado = l.contado !== null;

    if (filtro.situacao === 'contados' && !contado) return false;
    if (filtro.situacao === 'nao-contados' && contado) return false;
    if (filtro.somenteDivergentes && (l.status === 'CORRETO' || l.status === 'NÃO CONTADO')) {
      return false;
    }
    if (filtro.status !== 'TODOS' && l.status !== filtro.status) return false;

    return true;
  });

  const porNome = (a: LinhaRelatorio, b: LinhaRelatorio) => a.nome.localeCompare(b.nome, 'pt-BR');

  // Nome como desempate em toda ordenação: sem isso, duas linhas com o mesmo número
  // trocam de lugar entre renderizações e a tabela "pisca" sozinha.
  switch (filtro.ordem) {
    case 'maior-sistema':
      return resultado.sort((a, b) => porValor('sistema', true)(a, b) || porNome(a, b));
    case 'menor-sistema':
      return resultado.sort((a, b) => porValor('sistema', false)(a, b) || porNome(a, b));
    case 'maior-contado':
      return resultado.sort((a, b) => porValor('contado', true)(a, b) || porNome(a, b));
    case 'menor-contado':
      return resultado.sort((a, b) => porValor('contado', false)(a, b) || porNome(a, b));
    case 'maior-diferenca':
      return resultado.sort((a, b) => moduloDaDiferenca(b) - moduloDaDiferenca(a) || porNome(a, b));
    case 'menor-diferenca':
      return resultado.sort((a, b) => moduloDaDiferenca(a) - moduloDaDiferenca(b) || porNome(a, b));
    case 'status':
      return resultado.sort(
        (a, b) => PESO_STATUS[a.status] - PESO_STATUS[b.status] || porNome(a, b),
      );
    case 'status-desc':
      return resultado.sort(
        (a, b) => PESO_STATUS[b.status] - PESO_STATUS[a.status] || porNome(a, b),
      );
    case 'nome-desc':
      return resultado.sort((a, b) => porNome(b, a));
    case 'nome':
      return resultado.sort(porNome);
  }
}

/**
 * Frase que descreve o recorte, para o cabeçalho do PDF.
 *
 * Não é enfeite: sem ela, quem recebe um relatório filtrado não tem como saber que ele é
 * parcial, e conclui que o estoque tem 40 itens quando tem 2000.
 */
export function descreverFiltro(filtro: FiltroRelatorio): string {
  const partes: string[] = [];

  if (filtro.somenteDivergentes) partes.push('Somente divergências');
  else if (filtro.situacao !== 'todos') partes.push(ROTULO_SITUACAO[filtro.situacao]);

  if (filtro.status !== 'TODOS') partes.push(`Status ${filtro.status}`);

  if (partes.length === 0) return 'Todos os itens';
  return partes.join(' · ');
}

/** `true` quando o recorte esconde alguma coisa — o PDF avisa nesse caso. */
export function filtroEstaAtivo(filtro: FiltroRelatorio): boolean {
  return filtro.somenteDivergentes || filtro.situacao !== 'todos' || filtro.status !== 'TODOS';
}
