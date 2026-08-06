import { describe, expect, it } from 'vitest';
import { mapearColunas, numeroDeCelula, textoDeCelula } from './planilha-colunas.js';

describe('mapearColunas', () => {
  it('mapeia a planilha do ERP inteira', () => {
    expect(
      mapearColunas([
        'IdProduto',
        'NomeProduto',
        'CodigoInterno',
        'CodigoBarras',
        'NCM',
        'PrecoCusto',
        'PrecoPJ',
        'PrecoVenda',
        'EstoqueMinimo',
        'EstoqueAtual',
        'Categoria',
        'Unidade',
      ]),
    ).toEqual({
      IdProduto: 0,
      NomeProduto: 1,
      CodigoInterno: 2,
      CodigoBarras: 3,
      NCM: 4,
      PrecoCusto: 5,
      PrecoPJ: 6,
      PrecoVenda: 7,
      EstoqueMinimo: 8,
      EstoqueAtual: 9,
      Categoria: 10,
      Unidade: 11,
    });
  });

  /**
   * O `findColumn` do 1.x casava por "um contém o outro", sem passada exata antes. Com
   * `CodigoInterno` na frente, o sinônimo `'codigo'` do código de barras casava com ela — e
   * o app lia o código de barras da coluna errada, calado.
   */
  it('a passada exata impede que CodigoInterno roube CodigoBarras', () => {
    const mapa = mapearColunas(['CodigoInterno', 'CodigoBarras']);
    expect(mapa.CodigoInterno).toBe(0);
    expect(mapa.CodigoBarras).toBe(1);
  });

  it('nenhuma coluna serve a dois campos', () => {
    const mapa = mapearColunas(['Nome', 'Estoque']);
    const usados = Object.values(mapa);
    expect(new Set(usados).size).toBe(usados.length);
  });

  it('ignora acento, caixa e espaço', () => {
    const mapa = mapearColunas(['  DESCRIÇÃO  ', 'Saldo']);
    expect(mapa.NomeProduto).toBe(0);
    expect(mapa.EstoqueAtual).toBe(1);
  });

  it('cai para aproximação quando não há igualdade', () => {
    const mapa = mapearColunas(['Código de Barras (EAN)', 'Nome do Produto']);
    expect(mapa.CodigoBarras).toBe(0);
    expect(mapa.NomeProduto).toBe(1);
  });

  it('devolve mapa vazio para cabeçalhos que não dizem nada', () => {
    expect(mapearColunas(['aaa', 'bbb'])).toEqual({});
  });

  it('não casa com cabeçalho vazio', () => {
    expect(mapearColunas(['', null, undefined])).toEqual({});
  });
});

describe('numeroDeCelula', () => {
  it('passa número adiante', () => {
    expect(numeroDeCelula(18.5)).toBe(18.5);
    expect(numeroDeCelula(0)).toBe(0);
  });

  it('aceita vírgula decimal e separador de milhar', () => {
    expect(numeroDeCelula('29,99')).toBe(29.99);
    expect(numeroDeCelula('1.234,50')).toBe(1234.5);
  });

  it('vazio e lixo viram 0, nunca NaN', () => {
    expect(numeroDeCelula('')).toBe(0);
    expect(numeroDeCelula(null)).toBe(0);
    expect(numeroDeCelula('abc')).toBe(0);
    expect(numeroDeCelula(Number.NaN)).toBe(0);
  });
});

describe('textoDeCelula', () => {
  it('converte número para texto sem notação', () => {
    expect(textoDeCelula(30289733)).toBe('30289733');
  });

  it('tira espaços', () => {
    expect(textoDeCelula('  ABRIDOR  ')).toBe('ABRIDOR');
  });

  // O exceljs entrega célula com fórmula como objeto. Sem isto viraria "[object Object]".
  it('lê o resultado de célula com fórmula', () => {
    expect(textoDeCelula({ formula: 'A1', result: 'CERVEJA' })).toBe('CERVEJA');
  });

  it('lê texto formatado em partes', () => {
    expect(textoDeCelula({ richText: [{ text: 'CERVEJA ' }, { text: 'LATA' }] })).toBe(
      'CERVEJA LATA',
    );
  });

  it('vazio e nulo viram string vazia', () => {
    expect(textoDeCelula(null)).toBe('');
    expect(textoDeCelula(undefined)).toBe('');
  });
});
