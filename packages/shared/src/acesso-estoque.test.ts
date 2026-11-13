import { describe, expect, it } from 'vitest';
import {
  estoquesExistentes,
  estoquesPermitidos,
  filtrarEstoquesPermitidos,
  planejarLimpezaDePermissoes,
  podeAcessarEstoque,
  semNenhumEstoque,
  semRestricaoDeEstoque,
  textoEstoquesPermitidos,
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

  // Lista só com ids mortos é "nenhum estoque", como no app e como a regra trata na gravação.
  it('não devolve nada quando a restrição não casa com nada', () => {
    expect(filtrarEstoquesPermitidos(estoques, { allowedInventories: ['apagado'] }, 'comum')).toEqual([]);
  });

  it('id morto ao lado de um vivo: mostra só o vivo', () => {
    const r = filtrarEstoquesPermitidos(estoques, { allowedInventories: ['apagado', 'centro'] }, 'comum');
    expect(r.map((e) => e.id)).toEqual(['centro']);
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

describe('semNenhumEstoque', () => {
  it('lista vazia vale todos, não nenhum', () => expect(semNenhumEstoque([], estoques)).toBe(false));
  it('só ids mortos', () => expect(semNenhumEstoque(['apagado', 'outro'], estoques)).toBe(true));
  it('um vivo basta', () => expect(semNenhumEstoque(['apagado', 'centro'], estoques)).toBe(false));
});

describe('estoquesExistentes', () => {
  it('descarta os mortos e mantém a ordem da lista', () => {
    expect(estoquesExistentes(['norte', 'apagado', 'centro'], estoques)).toEqual(['norte', 'centro']);
  });
});

describe('textoEstoquesPermitidos', () => {
  it('lista vazia', () => expect(textoEstoquesPermitidos([], estoques)).toBe('todos os estoques'));
  it('nomes dos que existem, na ordem da lista', () => {
    expect(textoEstoquesPermitidos(['norte', 'apagado', 'centro'], estoques)).toBe('Loja Norte, Loja Centro');
  });
  it('nenhum existente', () => expect(textoEstoquesPermitidos(['apagado'], estoques)).toBe('nenhum estoque'));
  it('estoque sem nome usa o id', () => {
    expect(textoEstoquesPermitidos(['x'], [{ id: 'x' }])).toBe('x');
  });
});

describe('planejarLimpezaDePermissoes', () => {
  const lojas = [{ id: 'A' }, { id: 'B' }];
  const u = (uid: string, allowedInventories: unknown, extra: object = {}) =>
    ({ uid, allowedInventories, ...extra }) as { uid: string; allowedInventories: string[] };
  const ids = (lista: { uid: string }[]) => lista.map((p) => p.uid);
  const plano = (...usuarios: ReturnType<typeof u>[]) => planejarLimpezaDePermissoes(usuarios, lojas, 'A');

  it('quem só tinha o excluído fica sem nenhum', () => {
    const r = plano(u('1', ['A']));
    expect(ids(r.afetados)).toEqual(['1']);
    expect(ids(r.semNenhum)).toEqual(['1']);
  });
  it('quem tem outro estoque vivo é afetado, mas não fica sem nenhum', () => {
    const r = plano(u('2', ['A', 'B']));
    expect(ids(r.afetados)).toEqual(['2']);
    expect(r.semNenhum).toEqual([]);
  });
  it('o outro id é de estoque que já não existe: fica sem nenhum', () => {
    expect(ids(plano(u('3', ['A', 'morto'])).semNenhum)).toEqual(['3']);
  });
  it('id em branco não conta como estoque', () => {
    expect(ids(plano(u('4', ['A', ''])).semNenhum)).toEqual(['4']);
  });
  // Master vê tudo, qualquer que seja a lista. A lista dele é limpa, mas ele não assusta ninguém no aviso.
  it('master é afetado, mas fica fora do aviso', () => {
    const r = plano(u('5', ['A'], { isMaster: true }));
    expect(ids(r.afetados)).toEqual(['5']);
    expect(r.semNenhum).toEqual([]);
  });
  it('quem não tem o id na lista não é afetado', () => {
    expect(plano(u('6', ['B']), u('7', []), u('8', undefined)).afetados).toEqual([]);
  });
});
