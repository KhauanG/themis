import { describe, expect, it } from 'vitest';
import {
  chavesDeIdProduto,
  fisicoDe,
  saldoDoErpPara,
  saldoNoErp,
  sistemaDe,
  validadeDe,
} from './produto.js';

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

/**
 * Esta é a regressão que fazia produto sumir da correção: o mapa do ERP indexado por uma
 * grafia só, consultado com outra. O produto virava "sem correspondência" em silêncio.
 */
describe('saldoNoErp', () => {
  it('casa a grafia crua', () => {
    const erp = new Map([['42', 10]]);
    expect(saldoNoErp(erp, { id: 'a', IdProduto: '42' })).toBe(10);
  });

  it('casa id numérico com chave numérica', () => {
    const erp = new Map([['42', 10]]);
    expect(saldoNoErp(erp, { id: 'a', IdProduto: 42 })).toBe(10);
  });

  // O caso que quebrava: cadastro com 7, ERP indexado em "007".
  it('casa id numérico com chave que tem zeros à esquerda', () => {
    const erp = new Map([
      ['007', 3],
      ['7', 3],
    ]);
    expect(saldoNoErp(erp, { id: 'a', IdProduto: 7 })).toBe(3);
  });

  it('aceita a grafia minúscula do campo', () => {
    const erp = new Map([['99', 1]]);
    expect(saldoNoErp(erp, { id: 'a', idProduto: '99' })).toBe(1);
  });

  // Saldo zero é resposta válida; `undefined` significa "o ERP não conhece".
  it('distingue saldo zero de ausência', () => {
    const erp = new Map([['5', 0]]);
    expect(saldoNoErp(erp, { id: 'a', IdProduto: '5' })).toBe(0);
    expect(saldoNoErp(erp, { id: 'b', IdProduto: '6' })).toBeUndefined();
  });

  it('produto sem IdProduto não casa com nada', () => {
    const erp = new Map([['5', 9]]);
    expect(saldoNoErp(erp, { id: 'a' })).toBeUndefined();
  });
});

/**
 * A regra que decide o que "ausente da listagem" significa.
 *
 * Ela é aplicada em dois lugares distantes — ao gravar `estoqueSistema` e ao montar o
 * diagnóstico da correção. Duas cópias divergem: no 1.x foi assim que o cálculo de status
 * passou a nunca devolver `CRITICO` numa das telas. Por isso mora aqui, com teste.
 */
describe('saldoDoErpPara', () => {
  const erp = new Map([['42', 7]]);
  const presente = { id: 'a', IdProduto: '42' };
  const ausente = { id: 'b', IdProduto: '99' };

  it('produto na listagem devolve o saldo, independente da regra', () => {
    expect(saldoDoErpPara(erp, presente, false)).toBe(7);
    expect(saldoDoErpPara(erp, presente, true)).toBe(7);
  });

  // Listagem traz zeros: ausente é ausente mesmo — o produto não está naquela loja.
  it('ausente com listagem que traz zeros continua desconhecido', () => {
    expect(saldoDoErpPara(erp, ausente, false)).toBeUndefined();
  });

  // Listagem só com positivos: ausente é zero.
  it('ausente com listagem só de positivos vale zero', () => {
    expect(saldoDoErpPara(erp, ausente, true)).toBe(0);
  });

  // O caso que mais engana: 0 é saldo, não ausência. `??` funciona, `||` estragaria.
  it('saldo zero vindo da listagem não vira desconhecido', () => {
    const comZero = new Map([['42', 0]]);
    expect(saldoDoErpPara(comZero, presente, false)).toBe(0);
    expect(saldoDoErpPara(comZero, presente, true)).toBe(0);
  });

  it('saldo negativo é preservado', () => {
    expect(saldoDoErpPara(new Map([['42', -3]]), presente, false)).toBe(-3);
  });

  it('produto sem IdProduto segue a mesma regra da ausência', () => {
    expect(saldoDoErpPara(erp, { id: 'c' }, false)).toBeUndefined();
    expect(saldoDoErpPara(erp, { id: 'c' }, true)).toBe(0);
  });
});
