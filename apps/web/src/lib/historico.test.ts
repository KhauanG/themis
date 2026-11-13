import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, addDoc, getDocs } from 'firebase/firestore';
import type { FiltroHistorico } from '@themis/shared';
import { CHAVES } from './armazenamento.js';
import {
  consultarHistorico,
  drenarHistorico,
  registrar,
  varrerHistorico,
  type CursorHistorico,
  type PaginaHistorico,
} from './historico.js';

vi.mock('./firebase.js', () => ({ db: {} }));
vi.mock('./dispositivo.js', () => ({ deviceId: () => 'aparelho', deviceLabel: () => 'Teste' }));
vi.mock('firebase/firestore', async (original) => ({
  ...(await original<typeof import('firebase/firestore')>()),
  collection: (_db: unknown, nome: string) => ({ collection: nome }),
  where: (...a: unknown[]) => ({ where: a }),
  orderBy: (...a: unknown[]) => ({ orderBy: a }),
  limit: (n: number) => ({ limit: n }),
  startAfter: (s: unknown) => ({ startAfter: s }),
  query: (...partes: unknown[]) => partes,
  getDocs: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: () => 'AGORA',
}));

beforeEach(() => vi.clearAllMocks());

const docDoHistorico = (n: number) => ({
  id: `h${n}`,
  data: () => ({ action: 'LOGIN', userId: 'u1', timestamp: Timestamp.fromDate(new Date(2026, 10, 13, 10, n % 60)) }),
});
const resposta = (qtd: number) => ({ docs: Array.from({ length: qtd }, (_, i) => docDoHistorico(i)) });
const pedido = () => vi.mocked(getDocs).mock.calls.at(-1)![0] as unknown as unknown[];

describe('consultarHistorico', () => {
  it('sem filtro: só a ordem e o limite, pedindo um a mais', async () => {
    vi.mocked(getDocs).mockResolvedValue(resposta(3) as never);
    const p = await consultarHistorico({});
    expect(pedido()).toEqual([{ collection: 'historico_geral' }, { orderBy: ['timestamp', 'desc'] }, { limit: 201 }]);
    expect(p.eventos.map((e) => e.id)).toEqual(['h0', 'h1', 'h2']);
    expect(p.temMais).toBe(false);
  });
  it('estoque, ação e datas viram where; a data vira Timestamp', async () => {
    vi.mocked(getDocs).mockResolvedValue(resposta(0) as never);
    const de = new Date(2026, 10, 1);
    const ate = new Date(2026, 10, 14);
    await consultarHistorico({ inventoryId: 'E1', action: 'LOGIN', de, ate });
    expect(pedido()).toContainEqual({ where: ['inventoryId', '==', 'E1'] });
    expect(pedido()).toContainEqual({ where: ['action', '==', 'LOGIN'] });
    expect(pedido()).toContainEqual({ where: ['timestamp', '>=', Timestamp.fromDate(de)] });
    expect(pedido()).toContainEqual({ where: ['timestamp', '<', Timestamp.fromDate(ate)] });
  });
  it('próxima página começa depois do cursor', async () => {
    vi.mocked(getDocs).mockResolvedValue(resposta(0) as never);
    const cursor = { id: 'h9' } as unknown as CursorHistorico;
    await consultarHistorico({}, 200, cursor);
    expect(pedido()).toContainEqual({ startAfter: cursor });
  });
  it('201 documentos: devolve 200 e diz que há mais', async () => {
    const r = resposta(201);
    vi.mocked(getDocs).mockResolvedValue(r as never);
    const p = await consultarHistorico({});
    expect(p.eventos).toHaveLength(200);
    expect(p.ultimo).toBe(r.docs[199]);
    expect(p.temMais).toBe(true);
  });
  it('nenhum: lista vazia e sem cursor', async () => {
    vi.mocked(getDocs).mockResolvedValue(resposta(0) as never);
    expect(await consultarHistorico({})).toEqual({ eventos: [], ultimo: null, temMais: false });
  });
});

describe('varrerHistorico', () => {
  const evento = (id: string, userId: string) => ({ id, userId, action: 'LOGIN' }) as never;
  /** Página falsa: `total` eventos, dos quais os `doU1` primeiros são do usuário u1. */
  const pagina = (n: number, total: number, doU1: number, temMais: boolean): PaginaHistorico => ({
    eventos: Array.from({ length: total }, (_, i) => evento(`p${n}-${i}`, i < doU1 ? 'u1' : 'u2')),
    ultimo: { id: `cursor${n}` } as unknown as CursorHistorico,
    temMais,
  });

  /** `consultarHistorico` falso, com os três parâmetros declarados para o teste poder ler as chamadas. */
  const falso = (fabrica: () => PaginaHistorico) =>
    vi.fn(async (_filtro: FiltroHistorico, _tamanho?: number, _depois?: CursorHistorico | null) => fabrica());

  it('junta 50 em várias páginas', async () => {
    let n = 0;
    const consultar = falso(() => pagina(++n, 200, 20, true));
    const r = await varrerHistorico({}, { userId: 'u1' }, null, consultar);
    expect(consultar).toHaveBeenCalledTimes(3);
    expect(r.eventos).toHaveLength(60);
    expect(r.varridos).toBe(600);
    expect(r.temMais).toBe(true);
    expect(r.ultimo).toEqual({ id: 'cursor3' });
  });
  it('passa o cursor da página anterior', async () => {
    let n = 0;
    const consultar = falso(() => pagina(++n, 200, 30, true));
    const inicio = { id: 'inicio' } as unknown as CursorHistorico;
    await varrerHistorico({ inventoryId: 'E1' }, { userId: 'u1' }, inicio, consultar);
    expect(consultar.mock.calls.map((c) => c[2])).toEqual([inicio, { id: 'cursor1' }]);
    expect(consultar.mock.calls[0]![0]).toEqual({ inventoryId: 'E1' });
    expect(consultar.mock.calls[0]![1]).toBe(200);
  });
  // Usuário que quase não aparece: a varredura para, mas não diz que o histórico acabou.
  it('para em 2.000 e não marca fim', async () => {
    let n = 0;
    const consultar = falso(() => pagina(++n, 200, 0, true));
    const r = await varrerHistorico({}, { userId: 'u1' }, null, consultar);
    expect(consultar).toHaveBeenCalledTimes(10);
    expect(r.eventos).toEqual([]);
    expect(r.varridos).toBe(2000);
    expect(r.temMais).toBe(true);
  });
  it('o servidor acabou antes de juntar 50: temMais falso', async () => {
    const consultar = falso(() => pagina(1, 30, 5, false));
    const r = await varrerHistorico({}, { userId: 'u1' }, null, consultar);
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(r.eventos).toHaveLength(5);
    expect(r.varridos).toBe(30);
    expect(r.temMais).toBe(false);
  });
  it('sem filtro no navegador, uma página basta', async () => {
    const consultar = falso(() => pagina(1, 200, 0, true));
    const r = await varrerHistorico({}, {}, null, consultar);
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(r.eventos).toHaveLength(200);
  });
});

/** localStorage mínimo (o teste roda em Node), no molde de `fila-offline.test.ts`. */
const guardado = new Map<string, string>();
function instalarLocalStorage() {
  globalThis.localStorage = {
    getItem: (k: string) => guardado.get(k) ?? null,
    setItem: (k: string, v: string) => void guardado.set(k, v),
    removeItem: (k: string) => void guardado.delete(k),
    clear: () => guardado.clear(),
    key: (i: number) => [...guardado.keys()][i] ?? null,
    get length() {
      return guardado.size;
    },
  } as Storage;
}

const entrada = (userId: string, produto: string) => ({
  action: 'MODIFICAR_PRODUTO', userId, userEmail: `${userId}@x.com`, userName: userId, inventoryId: 'E1', inventoryName: 'Loja',
  localTimestamp: '2026-11-13T10:00:00.000Z', details: { produto }, deviceId: 'aparelho', deviceLabel: 'Teste',
});
const fila = () => JSON.parse(guardado.get(CHAVES.historicoPendente) ?? '[]') as { action: string; userId: string; details: { produto: string } }[];
const negado = () => Object.assign(new Error('x'), { code: 'permission-denied' });
const semRede = () => Object.assign(new Error('x'), { code: 'unavailable' });
const contexto = { userId: 'u1', userEmail: 'u1@x.com', userName: 'u1', inventoryId: 'E1', inventoryName: 'Loja' };

describe('fila local do histórico', () => {
  // O global é do worker, não do arquivo: sem isto o próximo arquivo herdaria este localStorage.
  afterAll(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  beforeEach(() => {
    instalarLocalStorage();
    guardado.clear();
    vi.stubGlobal('navigator', { onLine: true, userAgent: 'teste' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(addDoc).mockResolvedValue({ id: 'novo' } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  // T1: a entrada de quem usou o aparelho antes era recusada pela regra e travava todas as outras.
  it('envia só as entradas do usuário atual; as dos outros ficam intactas', async () => {
    guardado.set(CHAVES.historicoPendente, JSON.stringify([entrada('u1', 'A'), entrada('u2', 'B'), entrada('u1', 'C')]));
    expect(await drenarHistorico('u1')).toBe(2);
    expect(addDoc).toHaveBeenCalledTimes(2);
    expect(fila().map((e) => e.details.produto)).toEqual(['B']);
  });
  it('uma falha de rede não para o resto, e a entrada que falhou fica', async () => {
    guardado.set(CHAVES.historicoPendente, JSON.stringify([entrada('u1', 'A'), entrada('u1', 'C')]));
    vi.mocked(addDoc).mockRejectedValueOnce(semRede());
    expect(await drenarHistorico('u1')).toBe(1);
    expect(fila().map((e) => e.details.produto)).toEqual(['A']);
  });
  // T2: entrada própria que a regra recusa nunca vai passar. Sai da fila.
  it('entrada própria recusada pela regra é descartada, com aviso no console', async () => {
    guardado.set(CHAVES.historicoPendente, JSON.stringify([entrada('u1', 'A'), entrada('u1', 'C')]));
    vi.mocked(addDoc).mockRejectedValueOnce(negado());
    expect(await drenarHistorico('u1')).toBe(1);
    expect(fila()).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
  it('sem internet não envia nada e não perde nada', async () => {
    vi.stubGlobal('navigator', { onLine: false, userAgent: 'teste' });
    guardado.set(CHAVES.historicoPendente, JSON.stringify([entrada('u1', 'A')]));
    expect(await drenarHistorico('u1')).toBe(0);
    expect(addDoc).not.toHaveBeenCalled();
    expect(fila()).toHaveLength(1);
  });
  it('fila vazia: zero, sem tocar no servidor', async () => {
    expect(await drenarHistorico('u1')).toBe(0);
    expect(addDoc).not.toHaveBeenCalled();
  });
  it('registrar: recusa da regra não vai para a fila', async () => {
    vi.mocked(addDoc).mockRejectedValueOnce(negado());
    await registrar('LOGIN', contexto);
    expect(fila()).toEqual([]);
  });
  it('registrar: erro de rede vai para a fila', async () => {
    vi.mocked(addDoc).mockRejectedValueOnce(semRede());
    await registrar('LOGIN', contexto);
    expect(fila()).toHaveLength(1);
  });
  it('registrar: sem internet vai direto para a fila', async () => {
    vi.stubGlobal('navigator', { onLine: false, userAgent: 'teste' });
    await registrar('LOGIN', contexto);
    expect(addDoc).not.toHaveBeenCalled();
    expect(fila()).toHaveLength(1);
  });
  // O LOGIN do app aberto cai na fila enquanto a drenagem ainda espera o servidor: a drenagem
  // não pode regravar a fila por cima e apagar o que entrou nesse meio tempo.
  it('entrada guardada durante a drenagem não é apagada quando ela termina', async () => {
    guardado.set(CHAVES.historicoPendente, JSON.stringify([entrada('u1', 'A'), entrada('u1', 'B')]));
    let enviarA!: () => void;
    vi.mocked(addDoc)
      .mockImplementationOnce(() => new Promise((ok) => (enviarA = () => ok({ id: 'a' } as never))))
      .mockRejectedValueOnce(semRede()) // o LOGIN
      .mockRejectedValueOnce(semRede()); // o B da drenagem
    const drenagem = drenarHistorico('u1');
    await registrar('LOGIN', contexto);
    enviarA();
    expect(await drenagem).toBe(1);
    expect(fila().map((e) => e.action)).toEqual(['MODIFICAR_PRODUTO', 'LOGIN']);
    expect(fila()[0]!.details.produto).toBe('B');
  });
  it('entrada guardada durante a drenagem fica mesmo quando a drenagem esvazia o resto', async () => {
    guardado.set(CHAVES.historicoPendente, JSON.stringify([entrada('u1', 'A')]));
    let enviarA!: () => void;
    vi.mocked(addDoc)
      .mockImplementationOnce(() => new Promise((ok) => (enviarA = () => ok({ id: 'a' } as never))))
      .mockRejectedValueOnce(semRede()); // o LOGIN
    const drenagem = drenarHistorico('u1');
    await registrar('LOGIN', contexto);
    enviarA();
    expect(await drenagem).toBe(1);
    expect(fila().map((e) => e.action)).toEqual(['LOGIN']);
  });
});
