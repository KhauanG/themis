import { describe, expect, it } from 'vitest';
import {
  estoquesPermitidos,
  filtrarEstoquesPermitidos,
  podeAcessarEstoque,
  semRestricaoDeEstoque,
} from './acesso-estoque.js';
import type { Inventory } from './types.js';

const estoques: Inventory[] = [
  { id: 'deposito', nome: 'Depósito Central' },
  { id: 'centro', nome: 'Loja Centro' },
  { id: 'norte', nome: 'Loja Norte' },
];

describe('estoquesPermitidos', () => {
  it('perfil sem a chave devolve lista vazia', () => {
    expect(estoquesPermitidos({})).toEqual([]);
    expect(estoquesPermitidos(null)).toEqual([]);
  });

  it('descarta entradas vazias', () => {
    expect(estoquesPermitidos({ allowedInventories: ['centro', '', '  '] })).toEqual(['centro']);
  });

  it('tolera valor que não é lista', () => {
    expect(estoquesPermitidos({ allowedInventories: 'centro' } as never)).toEqual([]);
  });
});

/**
 * Semântica herdada do 1.x: lista vazia é o padrão de quem nunca foi configurado, e
 * significa acesso a tudo. Inverter isso trancaria a equipe inteira para fora no dia da
 * migração.
 */
describe('semRestricaoDeEstoque', () => {
  it('lista vazia libera tudo', () => {
    expect(semRestricaoDeEstoque({ allowedInventories: [] }, 'comum')).toBe(true);
    expect(semRestricaoDeEstoque({}, 'comum')).toBe(true);
  });

  it('master ignora a restrição', () => {
    expect(semRestricaoDeEstoque({ allowedInventories: ['centro'] }, 'master')).toBe(true);
  });

  // Só master escapa. Admin restrito continua restrito, como no 1.x.
  it('admin restrito continua restrito', () => {
    expect(semRestricaoDeEstoque({ allowedInventories: ['centro'] }, 'admin')).toBe(false);
  });
});

describe('podeAcessarEstoque', () => {
  const restrito = { allowedInventories: ['centro', 'norte'] };

  it('permite o que está na lista', () => {
    expect(podeAcessarEstoque(restrito, 'comum', 'centro')).toBe(true);
    expect(podeAcessarEstoque(restrito, 'comum', 'norte')).toBe(true);
  });

  it('nega o que está fora', () => {
    expect(podeAcessarEstoque(restrito, 'comum', 'deposito')).toBe(false);
  });

  it('master alcança até o que está fora da lista', () => {
    expect(podeAcessarEstoque(restrito, 'master', 'deposito')).toBe(true);
  });

  it('sem perfil, libera — falha de leitura não tranca ninguém para fora', () => {
    expect(podeAcessarEstoque(null, 'comum', 'deposito')).toBe(true);
  });
});

describe('filtrarEstoquesPermitidos', () => {
  it('sem restrição devolve tudo', () => {
    expect(filtrarEstoquesPermitidos(estoques, {}, 'comum')).toHaveLength(3);
  });

  it('restrito devolve só os permitidos', () => {
    const r = filtrarEstoquesPermitidos(estoques, { allowedInventories: ['centro'] }, 'comum');
    expect(r.map((e) => e.id)).toEqual(['centro']);
  });

  it('master vê tudo mesmo com lista', () => {
    const r = filtrarEstoquesPermitidos(estoques, { allowedInventories: ['centro'] }, 'master');
    expect(r).toHaveLength(3);
  });

  /**
   * Estoque permitido pode ter sido excluído. Devolver lista vazia deixaria o app sem
   * contexto e o funcionário sem conseguir trabalhar — pior que mostrar demais.
   */
  it('devolve tudo quando a restrição não casa com nada', () => {
    const r = filtrarEstoquesPermitidos(estoques, { allowedInventories: ['apagado'] }, 'comum');
    expect(r).toHaveLength(3);
  });

  it('não muta a lista recebida', () => {
    const copia = [...estoques];
    filtrarEstoquesPermitidos(estoques, { allowedInventories: ['centro'] }, 'comum');
    expect(estoques).toEqual(copia);
  });

  it('preserva a ordem de entrada', () => {
    const r = filtrarEstoquesPermitidos(
      estoques,
      { allowedInventories: ['norte', 'deposito'] },
      'comum',
    );
    expect(r.map((e) => e.id)).toEqual(['deposito', 'norte']);
  });
});
