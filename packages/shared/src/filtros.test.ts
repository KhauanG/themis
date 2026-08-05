import { describe, expect, it } from 'vitest';
import { FILTROS, contarPorFiltro, filtrarProdutos, mensagemVazio, progressoContagem } from './filtros.js';
import type { Produto } from './types.js';

function p(over: Partial<Produto> & { id: string }): Produto {
  return { nome: 'Produto', temCodigoBarras: true, ...over };
}

const produtos: Produto[] = [
  p({ id: 'a', nome: 'Antarctica', quantidade: 5, productStatus: 'ATUALIZADO' }),
  p({ id: 'b', nome: 'Brahma', temCodigoBarras: false }),
  p({ id: 'c', nome: 'Corona', quantidade: -3, productStatus: 'ATUALIZADO' }),
  p({ id: 'd', nome: 'Devassa', productStatus: 'CONFERIDO' }),
  p({ id: 'e', nome: 'Eisenbahn', productStatus: 'CONFERIDO', corrigidoIncorreto: true }),
  p({ id: 'f', nome: 'Fritz', apiNotFound: true }),
];

describe('filtrarProdutos', () => {
  it('ordena por nome em português por padrão', () => {
    expect(filtrarProdutos(produtos, 'all').map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('não muta o array recebido', () => {
    const original = [...produtos];
    filtrarProdutos(produtos, 'all');
    expect(produtos).toEqual(original);
  });

  it('sem código de barras', () => {
    expect(filtrarProdutos(produtos, 'no-barcode').map((x) => x.id)).toEqual(['b']);
  });

  it('negativos usam o estoque físico', () => {
    expect(filtrarProdutos(produtos, 'negative').map((x) => x.id)).toEqual(['c']);
  });

  it('separa corrigidos corretos de incorretos', () => {
    expect(filtrarProdutos(produtos, 'conferido-correto').map((x) => x.id)).toEqual(['d']);
    expect(filtrarProdutos(produtos, 'conferido-incorreto').map((x) => x.id)).toEqual(['e']);
  });

  it('fora do ERP', () => {
    expect(filtrarProdutos(produtos, 'api-not-found').map((x) => x.id)).toEqual(['f']);
  });

  // A aba sai de productStatus, não de rastreamento local: com 5 celulares contando,
  // todos veem a mesma lista.
  it('Contados mostra ATUALIZADO e esconde CONFERIDO', () => {
    expect(filtrarProdutos(produtos, 'updated').map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('A contar mostra só quem não tem status', () => {
    expect(filtrarProdutos(produtos, 'pendentes').map((x) => x.id)).toEqual(['b', 'f']);
  });

  it('Contados e A contar não se sobrepõem e cobrem os não corrigidos', () => {
    const contados = filtrarProdutos(produtos, 'updated');
    const pendentes = filtrarProdutos(produtos, 'pendentes');
    const conferidos = produtos.filter((x) => x.productStatus === 'CONFERIDO');
    expect(contados.length + pendentes.length + conferidos.length).toBe(produtos.length);
  });

  it('busca por nome e por código de barras, sem diferenciar caixa', () => {
    const lista = [p({ id: 'x', nome: 'Skol Lata', codigoBarras: '789456' })];
    expect(filtrarProdutos(lista, 'all', { busca: 'skol' })).toHaveLength(1);
    expect(filtrarProdutos(lista, 'all', { busca: '9456' })).toHaveLength(1);
    expect(filtrarProdutos(lista, 'all', { busca: 'heineken' })).toHaveLength(0);
  });

  it('ordena pelos mais recentes usando lastModified do servidor', () => {
    const lista = [
      p({ id: 'velho', nome: 'A', productStatus: 'ATUALIZADO', lastModified: new Date(1000) }),
      p({ id: 'novo', nome: 'Z', productStatus: 'ATUALIZADO', lastModified: new Date(9000) }),
      p({ id: 'semData', nome: 'M', productStatus: 'ATUALIZADO' }),
    ];
    expect(filtrarProdutos(lista, 'updated', { maisRecentesPrimeiro: true }).map((x) => x.id)).toEqual([
      'novo',
      'velho',
      'semData',
    ]);
  });
});

// A contagem rápida existe para não ordenar 8 vezes a lista inteira a cada snapshot.
// Se ela divergir do filtro de verdade, os números das abas mentem.
describe('contarPorFiltro', () => {
  it('bate com filtrarProdutos em todas as abas', () => {
    const rapido = contarPorFiltro(produtos);
    for (const f of FILTROS) {
      expect(rapido[f.id], `aba ${f.id}`).toBe(filtrarProdutos(produtos, f.id).length);
    }
  });

  it('funciona com lista vazia', () => {
    const rapido = contarPorFiltro([]);
    for (const f of FILTROS) expect(rapido[f.id]).toBe(0);
  });
});

describe('progressoContagem', () => {
  it('conta quem tem qualquer status como contado', () => {
    const pr = progressoContagem(produtos);
    expect(pr.total).toBe(6);
    expect(pr.contados).toBe(4); // 2 ATUALIZADO + 2 CONFERIDO
    expect(pr.pendentes).toBe(2);
    expect(pr.percentual).toBe(67);
  });

  it('não divide por zero com estoque vazio', () => {
    expect(progressoContagem([])).toEqual({ total: 0, contados: 0, pendentes: 0, percentual: 0 });
  });
});

describe('mensagemVazio', () => {
  it('devolve mensagem específica do filtro', () => {
    expect(mensagemVazio('no-barcode')).toBe('Nenhum produto sem código de barras');
  });
});
