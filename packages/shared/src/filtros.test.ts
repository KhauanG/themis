import { describe, expect, it } from 'vitest';
import { filtrarProdutos, mensagemVazio } from './filtros.js';
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
    const r = filtrarProdutos(produtos, 'all');
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
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

  // Regra herdada do 1.x: item já corrigido pelo admin sai da lista de trabalho.
  it('aba Atualizados esconde itens CONFERIDO', () => {
    const atualizados = new Set(['a', 'd', 'e']);
    expect(filtrarProdutos(produtos, 'updated', { atualizados }).map((x) => x.id)).toEqual(['a']);
  });

  it('busca por nome e por código de barras, sem diferenciar caixa', () => {
    const lista = [p({ id: 'x', nome: 'Skol Lata', codigoBarras: '789456' })];
    expect(filtrarProdutos(lista, 'all', { busca: 'skol' })).toHaveLength(1);
    expect(filtrarProdutos(lista, 'all', { busca: '9456' })).toHaveLength(1);
    expect(filtrarProdutos(lista, 'all', { busca: 'heineken' })).toHaveLength(0);
  });

  it('ordena por data quando pedido', () => {
    const datas = new Map([
      ['a', 100],
      ['c', 300],
    ]);
    const atualizados = new Set(['a', 'c']);
    const r = filtrarProdutos(produtos, 'updated', { atualizados, ordenarPorData: datas });
    expect(r.map((x) => x.id)).toEqual(['c', 'a']);
  });
});

describe('mensagemVazio', () => {
  it('devolve mensagem específica do filtro', () => {
    expect(mensagemVazio('no-barcode')).toBe('Nenhum produto sem código de barras');
  });
});
