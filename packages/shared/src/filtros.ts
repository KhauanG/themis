/**
 * Filtros da tela de contagem. Porte de `app.js::getFilteredProducts`.
 *
 * Regra sutil herdada do 1.x: a aba "Atualizados" esconde itens `CONFERIDO`. Um item
 * corrigido pelo admin sai da lista de trabalho do funcionário — senão ele recontaria
 * algo que já foi resolvido.
 */
import type { FiltroContagem, Produto } from './types.js';
import { fisicoDe, statusContagemDe } from './produto.js';

export interface OpcaoFiltro {
  id: FiltroContagem;
  rotulo: string;
  vazio: string;
}

export const FILTROS: OpcaoFiltro[] = [
  { id: 'all', rotulo: 'Todos', vazio: 'Nenhum produto no estoque' },
  { id: 'updated', rotulo: 'Atualizados', vazio: 'Nenhum item foi atualizado nesta contagem' },
  { id: 'no-barcode', rotulo: 'Sem código', vazio: 'Nenhum produto sem código de barras' },
  { id: 'negative', rotulo: 'Negativos', vazio: 'Nenhum produto com estoque negativo' },
  { id: 'conferido-correto', rotulo: 'Corrigidos OK', vazio: 'Nenhum item corrigido correto' },
  {
    id: 'conferido-incorreto',
    rotulo: 'Corrigidos com erro',
    vazio: 'Nenhum item corrigido incorreto',
  },
  { id: 'api-not-found', rotulo: 'Fora do ERP', vazio: 'Nenhum item não encontrado pela API' },
];

export function mensagemVazio(filtro: FiltroContagem): string {
  return FILTROS.find((f) => f.id === filtro)?.vazio ?? 'Nenhum produto encontrado';
}

function passaNoFiltro(p: Produto, filtro: FiltroContagem, atualizados: ReadonlySet<string>): boolean {
  const status = statusContagemDe(p);

  switch (filtro) {
    case 'all':
      return true;
    case 'no-barcode':
      return !p.temCodigoBarras;
    case 'updated':
      // CONFERIDO sai da lista: já foi resolvido pelo admin.
      return atualizados.has(p.id) && status !== 'CONFERIDO';
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
  /** IDs alterados nesta contagem (aba "Atualizados"). */
  atualizados?: ReadonlySet<string>;
  /** Busca por nome ou código de barras. */
  busca?: string;
  /** Ordena por data de alteração em vez de nome — só faz sentido na aba "Atualizados". */
  ordenarPorData?: ReadonlyMap<string, number>;
}

/** Aplica filtro, busca e ordenação. Não muta o array recebido. */
export function filtrarProdutos(
  produtos: readonly Produto[],
  filtro: FiltroContagem,
  opcoes: OpcoesFiltro = {},
): Produto[] {
  const atualizados = opcoes.atualizados ?? new Set<string>();
  const termo = (opcoes.busca ?? '').trim().toLowerCase();

  const resultado = produtos.filter((p) => {
    if (!passaNoFiltro(p, filtro, atualizados)) return false;
    if (!termo) return true;
    const nome = (p.nome ?? p.NomeProduto ?? '').toLowerCase();
    const codigo = String(p.codigoBarras ?? p.CodigoBarras ?? '').toLowerCase();
    return nome.includes(termo) || codigo.includes(termo);
  });

  const datas = opcoes.ordenarPorData;
  if (datas) {
    return resultado.sort((a, b) => (datas.get(b.id) ?? 0) - (datas.get(a.id) ?? 0));
  }

  return resultado.sort((a, b) =>
    (a.nome ?? a.NomeProduto ?? '').localeCompare(b.nome ?? b.NomeProduto ?? '', 'pt-BR', {
      sensitivity: 'base',
    }),
  );
}
