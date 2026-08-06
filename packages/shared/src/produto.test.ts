import { describe, expect, it } from 'vitest';
import { chavesDeIdProduto, fisicoDe, sistemaDe, validadeDe } from './produto.js';

/**
 * O casamento do produto com a listagem do ERP passa por aqui. Se falhar, o app conclui
 * que metade do estoque não existe no ERP e deixa de corrigir divergência real.
 */
describe('chavesDeIdProduto', () => {
  it('devolve a forma crua', () => {
    expect(chavesDeIdProduto('ABC123')).toEqual(['ABC123']);
  });

  it('número e texto geram a mesma chave', () => {
    expect(chavesDeIdProduto(7)).toEqual(['7']);
    expect(chavesDeIdProduto('7')).toEqual(['7']);
  });

  // O ERP manda "007", o cadastro tem 7. É o mesmo produto.
  it('zeros à esquerda geram as duas formas', () => {
    expect(chavesDeIdProduto('007')).toEqual(['007', '7']);
  });

  it('remove espaços em volta', () => {
    expect(chavesDeIdProduto('  42  ')).toEqual(['42']);
  });

  it('descarta valor ausente ou vazio', () => {
    expect(chavesDeIdProduto(null)).toEqual([]);
    expect(chavesDeIdProduto(undefined)).toEqual([]);
    expect(chavesDeIdProduto('')).toEqual([]);
    expect(chavesDeIdProduto('   ')).toEqual([]);
  });

  it('identificador não numérico não ganha forma numérica', () => {
    expect(chavesDeIdProduto('PROD-9')).toEqual(['PROD-9']);
  });

  it('não duplica quando as duas formas coincidem', () => {
    expect(chavesDeIdProduto('100')).toEqual(['100']);
  });
});

describe('fisicoDe e sistemaDe', () => {
  it('quantidade zero é contagem, não ausência', () => {
    expect(fisicoDe({ id: 'a', quantidade: 0, estoqueFisico: 99 })).toBe(0);
  });

  it('cai no campo legado quando quantidade é nula', () => {
    expect(fisicoDe({ id: 'a', quantidade: null, estoqueFisico: 12 })).toBe(12);
  });

  it('aceita as duas grafias do estoque do sistema', () => {
    expect(sistemaDe({ id: 'a', estoqueSistema: 5 })).toBe(5);
    expect(sistemaDe({ id: 'a', EstoqueAtual: 8 })).toBe(8);
    expect(sistemaDe({ id: 'a' })).toBe(0);
  });
});

describe('validadeDe', () => {
  it('aceita o formato ISO', () => {
    expect(validadeDe({ id: 'a', dataValidade: '2026-12-31' })).toBe('2026-12-31');
  });

  it('descarta formato brasileiro em vez de propagar lixo', () => {
    expect(validadeDe({ id: 'a', dataValidade: '31/12/2026' })).toBeNull();
  });

  it('descarta ausente', () => {
    expect(validadeDe({ id: 'a' })).toBeNull();
  });
});
