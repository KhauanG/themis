/**
 * Filtros da tela de contagem. Porte de `app.js::getFilteredProducts`.
 *
 * O 1.x mantinha um rastreamento paralelo de "itens atualizados" (uma subcoleção
 * `updatedItems` no Firestore mais um Set em memória) só para alimentar esta aba. Era
 * redundante: `productStatus === 'ATUALIZADO'` já é exatamente essa informação, vem do
 * servidor e é a mesma para todos os aparelhos. Contar com 5 celulares e cada um ver só
 * o que ele mesmo contou era efeito colateral daquele rastreamento local.
 *
 * `CONFERIDO` não aparece na aba: item já resolvido pelo admin sai da lista de trabalho
 * do funcionário, senão ele recontaria algo decidido.
 */
import type { FiltroContagem, Produto } from './types.js';
import { fisicoDe, foraDoErp, statusContagemDe } from './produto.js';

export interface OpcaoFiltro {
  id: FiltroContagem;
  rotulo: string;
  vazio: string;
  /**
   * A aba conta ao usuário se a contagem dele bateu com o sistema.
   *
   * Quem conta, conta às cegas: não pode ver o saldo do sistema nem a diferença, senão
   * "confere" o número em vez de contar. "Corrigidos com erro" é a diferença dita de outro
   * jeito — a aba some para quem só conta.
   */
  revelaDivergencia?: boolean;
}

export const FILTROS: OpcaoFiltro[] = [
  { id: 'all', rotulo: 'Todos', vazio: 'Nenhum produto no estoque' },
  { id: 'pendentes', rotulo: 'A contar', vazio: 'Tudo contado neste ciclo' },
  { id: 'updated', rotulo: 'Contados', vazio: 'Nenhum item foi contado nesta rodada' },
  { id: 'no-barcode', rotulo: 'Sem código', vazio: 'Nenhum produto sem código de barras' },
  { id: 'negative', rotulo: 'Negativos', vazio: 'Nenhum produto com estoque negativo' },
  {
    id: 'conferido-correto',
    rotulo: 'Corrigidos OK',
    vazio: 'Nenhum item corrigido correto',
    revelaDivergencia: true,
  },
  {
    id: 'conferido-incorreto',
    rotulo: 'Corrigidos com erro',
    vazio: 'Nenhum item corrigido incorreto',
    revelaDivergencia: true,
  },
  { id: 'api-not-found', rotulo: 'Fora do ERP', vazio: 'Nenhum item não encontrado pela API' },
];

/** As abas que um papel pode ver. `verSistema` é `permissoes.verEstoqueSistema`. */
export function filtrosVisiveis(verSistema: boolean): OpcaoFiltro[] {
  return verSistema ? FILTROS : FILTROS.filter((f) => !f.revelaDivergencia);
}

export function mensagemVazio(filtro: FiltroContagem): string {
  return FILTROS.find((f) => f.id === filtro)?.vazio ?? 'Nenhum produto encontrado';
}

function passaNoFiltro(p: Produto, filtro: FiltroContagem): boolean {
  const status = statusContagemDe(p);

  switch (filtro) {
    case 'all':
      return true;
    case 'pendentes':
      // Fora do ERP não é pendência de contagem: não dá para contá-lo. Deixá-lo aqui manda
      // a equipe procurar na prateleira o que precisa ser resolvido no cadastro.
      return status === null && !foraDoErp(p);
    case 'updated':
      return status === 'ATUALIZADO';
    case 'no-barcode':
      return !p.temCodigoBarras;
    case 'conferido-correto':
      return status === 'CONFERIDO' && p.corrigidoIncorreto !== true;
    case 'conferido-incorreto':
      return status === 'CONFERIDO' && p.corrigidoIncorreto === true;
    case 'api-not-found':
      return p.apiNotFound === true;
    case 'negative':
      return fisicoDe(p) < 0;
  }
}

export interface OpcoesFiltro {
  /** Busca por nome ou código de barras. */
  busca?: string;
  /**
   * Ordena pela última gravação, mais recente primeiro, em vez de por nome.
   * Usa `lastModified` do documento — verdade do servidor, igual em todos os aparelhos.
   */
  maisRecentesPrimeiro?: boolean;
}

function quando(p: Produto): number {
  return p.lastModified instanceof Date ? p.lastModified.getTime() : 0;
}

/** Aplica filtro, busca e ordenação. Não muta o array recebido. */
export function filtrarProdutos(
  produtos: readonly Produto[],
  filtro: FiltroContagem,
  opcoes: OpcoesFiltro = {},
): Produto[] {
  const termo = (opcoes.busca ?? '').trim().toLowerCase();

  const resultado = produtos.filter((p) => {
    if (!passaNoFiltro(p, filtro)) return false;
    if (!termo) return true;
    const nome = (p.nome ?? p.NomeProduto ?? '').toLowerCase();
    const codigo = String(p.codigoBarras ?? p.CodigoBarras ?? '').toLowerCase();
    return nome.includes(termo) || codigo.includes(termo);
  });

  if (opcoes.maisRecentesPrimeiro) {
    return resultado.sort((a, b) => quando(b) - quando(a));
  }

  return resultado.sort((a, b) =>
    (a.nome ?? a.NomeProduto ?? '').localeCompare(b.nome ?? b.NomeProduto ?? '', 'pt-BR', {
      sensitivity: 'base',
    }),
  );
}

/**
 * Contagem de itens por aba, em uma passada e sem ordenar.
 *
 * Chamar `filtrarProdutos` uma vez por aba só para saber o total custava 8 ordenações
 * com `localeCompare` sobre a lista inteira a cada snapshot do Firestore — com 2000
 * produtos e 5 aparelhos contando, isso é a cada poucos segundos.
 */
export function contarPorFiltro(produtos: readonly Produto[]): Record<FiltroContagem, number> {
  const contagem = {
    all: produtos.length,
    pendentes: 0,
    updated: 0,
    'no-barcode': 0,
    'conferido-correto': 0,
    'conferido-incorreto': 0,
    'api-not-found': 0,
    negative: 0,
  } satisfies Record<FiltroContagem, number>;

  for (const p of produtos) {
    const status = statusContagemDe(p);
    if (status === null) {
      // Fora do ERP não conta como pendência: tem aba própria e não dá para contá-lo.
      if (!foraDoErp(p)) contagem.pendentes++;
    } else if (status === 'ATUALIZADO') contagem.updated++;
    else if (p.corrigidoIncorreto === true) contagem['conferido-incorreto']++;
    else contagem['conferido-correto']++;

    if (!p.temCodigoBarras) contagem['no-barcode']++;
    if (p.apiNotFound === true) contagem['api-not-found']++;
    if (fisicoDe(p) < 0) contagem.negative++;
  }

  return contagem;
}

export interface ProgressoContagem {
  total: number;
  contados: number;
  pendentes: number;
  percentual: number;
}

/**
 * A contagem deste estoque está **fechada**: existe ao menos um item conferido.
 *
 * Conferir é o ato que encerra a rodada — o admin comparou com o ERP, mandou as correções e
 * fechou. Deixar a contagem aberta depois disso permite que alguém altere a quantidade de um
 * produto que já foi corrigido no Nuvem3, e a partir daí o Themis e o ERP contam histórias
 * diferentes sem que nada acuse.
 *
 * Também é o que mantém os aparelhos coerentes: enquanto a rodada está fechada, ninguém
 * grava, então não há como um celular ficar com um número que os outros não têm.
 *
 * Destrava com **Limpar contagem** (remove `productStatus` de todos) ou desfazendo as
 * conferências uma a uma no painel de auditoria.
 */
export function contagemFechada(produtos: readonly Produto[]): boolean {
  return produtos.some((p) => statusContagemDe(p) === 'CONFERIDO');
}

/** Progresso da rodada atual, para a barra no topo da tela de contagem. */
export function progressoContagem(produtos: readonly Produto[]): ProgressoContagem {
  // Produto fora do ERP não pode ser contado: mantê-lo no total faria a barra travar em
  // 75%% para sempre, com a equipe procurando na prateleira o que não dá para contar.
  const contaveis = produtos.filter((p) => !foraDoErp(p));
  const total = contaveis.length;
  const contados = contaveis.filter((p) => statusContagemDe(p) !== null).length;
  return {
    total,
    contados,
    pendentes: total - contados,
    percentual: total === 0 ? 0 : Math.round((contados / total) * 100),
  };
}
