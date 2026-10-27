import { describe, expect, it } from 'vitest';
import { MENSAGEM_QUANTIDADE as M, validarQuantidade } from './quantidade.js';

const erro = (mensagem: string) => ({ ok: false, mensagem });

// Mesma tabela do app (spec, seção 5, A8). Mudou aqui, muda lá.
describe('validarQuantidade — tabela A8', () => {
  it.each(['', '  '])('%j: obrigatória', (t) => expect(validarQuantidade(t)).toEqual(erro(M.obrigatoria)));
  it.each([['0', 0], [' 12 ', 12], ['999999', 999_999]] as const)('%j: ok %i', (t, v) =>
    expect(validarQuantidade(t)).toEqual({ ok: true, valor: v }));
  it.each(['1000000', '7891234567890'])('%j: muito alta', (t) =>
    expect(validarQuantidade(t)).toEqual(erro(M.muitoAlta)));
  it.each(['2,5', '2.5', '1.234'])('%j: só inteiro', (t) =>
    expect(validarQuantidade(t)).toEqual(erro(M.inteiro)));
  it.each(['-1', 'abc'])('%j: inválida', (t) => expect(validarQuantidade(t)).toEqual(erro(M.invalida)));
});

describe('validarQuantidade — texto do leitor com tab ou quebra de linha', () => {
  it('código lido com quebra de linha é muito alta', () =>
    expect(validarQuantidade('7891234567890\n')).toEqual(erro(M.muitoAlta)));
  it('número com tab passa', () => expect(validarQuantidade('12\t')).toEqual({ ok: true, valor: 12 }));
});

describe('validarQuantidade — zeros à esquerda e notação estranha', () => {
  it('zeros à esquerda valem', () => expect(validarQuantidade('0012')).toEqual({ ok: true, valor: 12 }));
  it.each(['1e3', '+5'])('%j: inválida', (t) => expect(validarQuantidade(t)).toEqual(erro(M.invalida)));
});

it('o texto de muito alta é o mesmo do app', () =>
  expect(M.muitoAlta).toBe(
    'Quantidade muito alta (acima de 999.999). Se um código de barras foi lido no campo, apague e digite a quantidade contada.',
  ));
