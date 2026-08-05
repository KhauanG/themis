import { describe, expect, it } from 'vitest';
import { linhasDeProdutos, linhasDeSnapshot, ordenarPorNome } from './relatorio.js';
import { montarSnapshotProdutos } from './auditoria.js';
import type { Produto } from './types.js';

const produtos: Produto[] = [
  {
    id: 'a',
    nome: 'Skol Lata',
    codigoBarras: '789',
    quantidade: 25,
    estoqueSistema: 10,
    productStatus: 'ATUALIZADO',
    dataValidade: '2026-09-01',
  },
  { id: 'b', nome: 'Brahma', quantidade: 5, estoqueSistema: 5, productStatus: 'ATUALIZADO' },
  { id: 'c', nome: 'Corona', estoqueSistema: 8 },
];

describe('linhasDeProdutos', () => {
  it('marca item não contado com contado null, e não zero', () => {
    const linhas = linhasDeProdutos(produtos);
    expect(linhas.find((l) => l.id === 'c')).toMatchObject({
      contado: null,
      diferenca: '-',
      status: 'NÃO CONTADO',
    });
  });

  it('preserva validade e calcula diferença', () => {
    const linha = linhasDeProdutos(produtos)[0];
    expect(linha).toMatchObject({
      nome: 'Skol Lata',
      sistema: 10,
      contado: 25,
      diferenca: 15,
      status: 'CRITICO',
      validade: '2026-09-01',
    });
  });
});

/**
 * Invariante que impede a volta de um bug real: o painel mostrava a auditoria salva
 * selecionada, mas a exportação gerava o arquivo com a contagem ao vivo. Se as duas
 * origens produzem a mesma linha, as duas telas e os dois arquivos batem.
 */
describe('paridade entre contagem ao vivo e auditoria salva', () => {
  it('a mesma contagem gera as mesmas linhas pelos dois caminhos', () => {
    const aoVivo = linhasDeProdutos(produtos);
    const doSnapshot = linhasDeSnapshot(montarSnapshotProdutos(produtos));
    expect(doSnapshot).toEqual(aoVivo);
  });

  it('vale também para item não contado', () => {
    const soNaoContado = [produtos[2]!];
    expect(linhasDeSnapshot(montarSnapshotProdutos(soNaoContado))).toEqual(
      linhasDeProdutos(soNaoContado),
    );
  });
});

describe('ordenarPorNome', () => {
  it('ordena em português e não muta a entrada', () => {
    const linhas = linhasDeProdutos(produtos);
    const copia = [...linhas];
    expect(ordenarPorNome(linhas).map((l) => l.nome)).toEqual(['Brahma', 'Corona', 'Skol Lata']);
    expect(linhas).toEqual(copia);
  });
});
