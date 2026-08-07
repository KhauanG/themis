import { describe, expect, it } from 'vitest';
import {
  FILTROS,
  contagemFechada,
  contarPorFiltro,
  filtrarProdutos,
  mensagemVazio,
  progressoContagem,
} from './filtros.js';
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
    expect(filtrarProdutos(produtos, 'pendentes').map((x) => x.id)).toEqual(['b']);
  });

  /**
   * O produto 'f' não tem status e mesmo assim fica fora de 'A contar': o ERP não o
   * conhece, então não dá para contá-lo. Deixá-lo na aba manda a equipe procurar na
   * prateleira o que precisa ser resolvido no cadastro do Nuvem3 — e a aba nunca zera.
   */
  it('A contar não inclui produto fora do ERP', () => {
    const pendentes = filtrarProdutos(produtos, 'pendentes').map((x) => x.id);
    expect(pendentes).not.toContain('f');
    expect(filtrarProdutos(produtos, 'api-not-found').map((x) => x.id)).toEqual(['f']);
  });

  it('Contados e A contar não se sobrepõem e cobrem os não corrigidos', () => {
    const contados = filtrarProdutos(produtos, 'updated');
    const pendentes = filtrarProdutos(produtos, 'pendentes');
    const conferidos = produtos.filter((x) => x.productStatus === 'CONFERIDO');
    const fora = produtos.filter((x) => x.apiNotFound === true);
    expect(contados.length + pendentes.length + conferidos.length + fora.length).toBe(
      produtos.length,
    );
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
    // 6 produtos, mas 'f' está fora do ERP e não é contável.
    expect(pr.total).toBe(5);
    expect(pr.contados).toBe(4); // 2 ATUALIZADO + 2 CONFERIDO
    expect(pr.pendentes).toBe(1);
    expect(pr.percentual).toBe(80);
  });

  /**
   * Com o produto fora do ERP no total, a barra travaria abaixo de 100%% para sempre — e
   * ninguém fecharia a contagem achando que faltava item.
   */
  it('produto fora do ERP não trava a barra em menos de 100%%', () => {
    const tudoContado = [
      p({ id: 'a', quantidade: 1, productStatus: 'ATUALIZADO' }),
      p({ id: 'f', apiNotFound: true }),
    ];
    expect(progressoContagem(tudoContado)).toEqual({
      total: 1,
      contados: 1,
      pendentes: 0,
      percentual: 100,
    });
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

/**
 * Conferir encerra a rodada. Enquanto ela está fechada ninguém grava — e é isso que
 * impede um aparelho de ficar com um número que os outros não têm.
 */
describe('contagemFechada', () => {
  it('fechada com pelo menos um conferido', () => {
    expect(contagemFechada([p({ id: 'a', productStatus: 'CONFERIDO' })])).toBe(true);
  });

  it('um conferido no meio de muitos contados já fecha', () => {
    expect(
      contagemFechada([
        p({ id: 'a', quantidade: 3, productStatus: 'ATUALIZADO' }),
        p({ id: 'b' }),
        p({ id: 'c', productStatus: 'CONFERIDO' }),
      ]),
    ).toBe(true);
  });

  it('aberta sem nenhum conferido', () => {
    expect(
      contagemFechada([
        p({ id: 'a', quantidade: 3, productStatus: 'ATUALIZADO' }),
        p({ id: 'b' }),
      ]),
    ).toBe(false);
  });

  it('estoque vazio está aberto, não fechado', () => {
    expect(contagemFechada([])).toBe(false);
  });

  // Limpar contagem remove o `productStatus` — é o que reabre a rodada.
  it('reabre quando o status é removido', () => {
    const depoisDeLimpar = [p({ id: 'a', quantidade: 0 })];
    expect(contagemFechada(depoisDeLimpar)).toBe(false);
  });
});
