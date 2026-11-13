import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, getDocs } from 'firebase/firestore';
import type { FiltroHistorico } from '@themis/shared';
import { consultarHistorico, varrerHistorico, type CursorHistorico, type PaginaHistorico } from './historico.js';

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
