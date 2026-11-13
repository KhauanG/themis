import { describe, expect, it } from 'vitest';
import { ROTULO_ACAO } from './historico-descricao.js';
import {
  ORDEM_ACOES, dividirFiltro, filtrarEventos, restricoesDoHistorico, subtituloDoHistorico, type FiltroDaTela,
} from './historico-filtro.js';

const tela = (over: Partial<FiltroDaTela> = {}): FiltroDaTela =>
  ({ inventoryId: 'TODOS', action: 'TODAS', userId: 'TODOS', de: '', ate: '', ...over });

describe('ORDEM_ACOES', () => {
  it('tem as 19 ações, sem repetir', () => {
    expect(ORDEM_ACOES).toHaveLength(19);
    expect([...ORDEM_ACOES].sort()).toEqual(Object.keys(ROTULO_ACAO).sort());
  });
});

describe('restricoesDoHistorico', () => {
  const de = new Date(2026, 10, 1);
  const ate = new Date(2026, 10, 14);
  it('sem filtro: nenhuma restrição', () => expect(restricoesDoHistorico({})).toEqual([]));
  it('só estoque', () => {
    expect(restricoesDoHistorico({ inventoryId: 'E1' })).toEqual([{ campo: 'inventoryId', op: '==', valor: 'E1' }]);
  });
  it('estoque e ação', () => {
    expect(restricoesDoHistorico({ inventoryId: 'E1', action: 'LOGIN' })).toEqual([
      { campo: 'inventoryId', op: '==', valor: 'E1' }, { campo: 'action', op: '==', valor: 'LOGIN' },
    ]);
  });
  // Ação sem estoque pediria o índice (action, timestamp), que é do 1.x e pode sair. Fica no navegador.
  it('ação sem estoque não vai ao servidor', () => expect(restricoesDoHistorico({ action: 'LOGIN' })).toEqual([]));
  it('datas, com e sem estoque', () => {
    expect(restricoesDoHistorico({ de, ate })).toEqual([
      { campo: 'timestamp', op: '>=', valor: de }, { campo: 'timestamp', op: '<', valor: ate },
    ]);
    expect(restricoesDoHistorico({ inventoryId: 'E1', action: 'LOGIN', de })).toEqual([
      { campo: 'inventoryId', op: '==', valor: 'E1' }, { campo: 'action', op: '==', valor: 'LOGIN' },
      { campo: 'timestamp', op: '>=', valor: de },
    ]);
  });
});

describe('filtrarEventos', () => {
  const eventos = [
    { id: 1, userId: 'u1', action: 'LOGIN' }, { id: 2, userId: 'u2', action: 'LOGIN' },
    { id: 3, userId: 'u1', action: 'EDITAR_PRODUTO' },
  ];
  it('sem filtro devolve todos', () => expect(filtrarEventos(eventos, {})).toHaveLength(3));
  it('por usuário', () => expect(filtrarEventos(eventos, { userId: 'u1' }).map((e) => e.id)).toEqual([1, 3]));
  it('por ação', () => expect(filtrarEventos(eventos, { action: 'LOGIN' }).map((e) => e.id)).toEqual([1, 2]));
  it('pelos dois', () => expect(filtrarEventos(eventos, { userId: 'u1', action: 'LOGIN' }).map((e) => e.id)).toEqual([1]));
});

describe('dividirFiltro', () => {
  it('tudo em "Todos": nada no servidor, nada no navegador', () => {
    expect(dividirFiltro(tela())).toEqual({ servidor: {}, navegador: {}, filtraNoNavegador: false });
  });
  it('estoque e ação vão ao servidor', () => {
    expect(dividirFiltro(tela({ inventoryId: 'E1', action: 'LOGIN' }))).toEqual({
      servidor: { inventoryId: 'E1', action: 'LOGIN' }, navegador: {}, filtraNoNavegador: false,
    });
  });
  it('ação com estoque "Todos" fica no navegador', () => {
    expect(dividirFiltro(tela({ action: 'LOGIN' }))).toEqual({
      servidor: {}, navegador: { action: 'LOGIN' }, filtraNoNavegador: true,
    });
  });
  it('usuário fica sempre no navegador', () => {
    expect(dividirFiltro(tela({ inventoryId: 'E1', userId: 'u1' }))).toEqual({
      servidor: { inventoryId: 'E1' }, navegador: { userId: 'u1' }, filtraNoNavegador: true,
    });
  });
  it('"De" é 00:00 local; "Até" é 00:00 local do dia seguinte', () => {
    const r = dividirFiltro(tela({ de: '2026-11-13', ate: '2026-11-13' }));
    expect(r.servidor).toEqual({ de: new Date(2026, 10, 13, 0, 0), ate: new Date(2026, 10, 14, 0, 0) });
  });
  it('"Até" no último dia do mês vira o dia 1 do mês seguinte', () => {
    expect(dividirFiltro(tela({ ate: '2026-11-30' })).servidor).toEqual({ ate: new Date(2026, 11, 1, 0, 0) });
  });
  it('data que não é AAAA-MM-DD é ignorada', () => {
    expect(dividirFiltro(tela({ de: '13/11/2026' })).servidor).toEqual({});
  });
});

describe('subtituloDoHistorico', () => {
  it('sem filtro no navegador', () => {
    expect(subtituloDoHistorico(50, 200, false)).toBe('50 registros.');
    expect(subtituloDoHistorico(1, 200, false)).toBe('1 registro.');
    expect(subtituloDoHistorico(0, 0, false)).toBe('0 registros.');
  });
  it('com filtro no navegador, diz em quantos procurou', () => {
    expect(subtituloDoHistorico(3, 2000, true)).toBe('3 registros. Procurei em 2000.');
  });
});
