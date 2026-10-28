import { describe, expect, it } from 'vitest';
import { ehAdmin, ehMaster, podeAcessarEstoque, podeUsarErp, type Perfil } from './acesso.js';

// Porte de firestore/firestore.rules. A conta de serviço da API ignora as regras: mudou a
// regra, muda aqui. O `não autenticado não escreve` de regras.test.ts é o 401 de
// routes/erp-lojas.test.ts. Não usar `papelDe` nem o `podeAcessarEstoque` do shared:
// aceitam "true" e 1, convertem com String e descartam texto vazio. A regra não faz isso.

const SEMENTES = {
  master: { isMaster: true },
  semLista: {},
  listaVazia: { allowedInventories: [] },
  soLojaX: { allowedInventories: ['X'] },
  soLojaY: { allowedInventories: ['Y'] },
  semDoc: null,
} satisfies Record<string, Perfil>;

describe('podeAcessarEstoque — mesmos casos de regras.test.ts', () => {
  it.each([
    ['master escreve em qualquer estoque', 'master', 'X', true],
    ['master escreve em qualquer estoque', 'master', 'Y', true],
    ['sem allowedInventories escreve em qualquer estoque', 'semLista', 'X', true],
    ['lista vazia significa todos, não nenhum', 'listaVazia', 'X', true],
    ['lista com o estoque permite', 'soLojaX', 'X', true],
    ['lista SEM o estoque nega', 'soLojaX', 'Y', false],
    ['lista SEM o estoque nega', 'soLojaY', 'X', false],
    ['usuário sem documento de perfil escreve', 'semDoc', 'X', true],
  ] as const)('%s — %s na loja %s', (_nome, semente, loja, esperado) =>
    expect(podeAcessarEstoque(SEMENTES[semente], loja)).toBe(esperado));
});

describe('podeAcessarEstoque — só no porte', () => {
  it.each([
    ['allowedInventories que não é lista passa (rules:64)', { allowedInventories: 'X' }, 'Y', true],
    ['7 não é "7": compara sem converter tipo (rules:66)', { allowedInventories: [7] }, '7', false],
    ['texto vazio na lista não vira lista vazia (rules:65-66)', { allowedInventories: [''] }, 'X', false],
    ['isMaster "true" não abre loja fora da lista (rules:17-20)', { isMaster: 'true', allowedInventories: ['X'] }, 'Y', false],
  ] as const)('%s', (_nome, perfil, loja, esperado) =>
    expect(podeAcessarEstoque(perfil, loja)).toBe(esperado));
});

it('ehMaster e ehAdmin: só true vale, e um cargo não implica o outro', () => {
  expect(ehMaster({ isMaster: true })).toBe(true);
  expect(ehAdmin({ isAdmin: true })).toBe(true);
  expect(ehAdmin({ isMaster: true })).toBe(false);
  expect(ehMaster({ isAdmin: true })).toBe(false);
  expect(ehMaster({ isMaster: 'true' })).toBe(false);
  expect(ehAdmin(null)).toBe(false);
});

// master, admin, comum e sem documento vêm do antigo `só cargo alto lê hash` de regras.test.ts.
// A 2.22.0 fechou `hashConfigs` para clientes, e essa decisão ficou só aqui.
// Auditor vem da spec 4.1. As flags em texto e número são só do porte (rules:17-25).
describe('podeUsarErp — admin ou master, e a loja', () => {
  it.each([
    ['master com lista sem a loja passa', { isMaster: true, allowedInventories: ['X'] }, 'Y', true],
    ['admin sem lista', { isAdmin: true }, 'X', true],
    ['admin com a loja na lista', { isAdmin: true, allowedInventories: ['X'] }, 'X', true],
    ['admin com lista sem a loja nega', { isAdmin: true, allowedInventories: ['X'] }, 'Y', false],
    ['auditor nega', { isAuditor: true }, 'X', false],
    ['comum nega', {}, 'X', false],
    ['sem documento nega', null, 'X', false],
    ['flag "true" em texto não vale', { isAdmin: 'true' }, 'X', false],
    ['flag 1 não vale', { isMaster: 1 }, 'X', false],
  ] as const)('%s', (_nome, perfil, loja, esperado) =>
    expect(podeUsarErp(perfil, loja)).toBe(esperado));
});
