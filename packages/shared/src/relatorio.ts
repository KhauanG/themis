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
export type OrdemRelatorio = 'nome' | 'maior-diferenca' | 'menor-diferenca' | 'status';

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
  'maior-diferenca': 'Maior diferença',
  'menor-diferenca': 'Menor diferença',
  status: 'Gravidade',
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

  switch (filtro.ordem) {
    case 'maior-diferenca':
      return resultado.sort((a, b) => moduloDaDiferenca(b) - moduloDaDiferenca(a) || porNome(a, b));
    case 'menor-diferenca':
      return resultado.sort((a, b) => moduloDaDiferenca(a) - moduloDaDiferenca(b) || porNome(a, b));
    case 'status':
      return resultado.sort(
        (a, b) => PESO_STATUS[a.status] - PESO_STATUS[b.status] || porNome(a, b),
      );
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
