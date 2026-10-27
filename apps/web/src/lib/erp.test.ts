import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteField, getDoc, setDoc, type FieldValue } from 'firebase/firestore';
import { carregarHashes, salvarHashDaLoja } from './erp.js';

// O módulo real de `firebase.js` lança sem as variáveis do `.env`; aqui só o `db` importa.
vi.mock('./firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  setDoc: vi.fn(async () => undefined),
  getDoc: vi.fn(),
  doc: vi.fn((_db: unknown, ...p: string[]) => ({ path: p.join('/') })),
}));

beforeEach(() => vi.clearAllMocks());

describe('salvarHashDaLoja', () => {
  // Regravar o mapa inteiro a partir da tela apagava todos os hashes quando a leitura falhava.
  it('grava só a chave do estoque, com merge', async () => {
    await salvarHashDaLoja('E1', ' abc ');
    const [, dados, opcoes] = vi.mocked(setDoc).mock.calls[0]!;
    expect(opcoes).toEqual({ merge: true });
    expect(dados).toEqual({ hashes: { E1: 'abc' }, updatedAt: expect.any(Date) });
  });

  it('apagar remove a chave nos dois mapas', async () => {
    await salvarHashDaLoja('E1', '   ');
    const [, dados] = vi.mocked(setDoc).mock.calls[0]!;
    const mapas = dados as Record<string, Record<string, FieldValue>>;
    expect(mapas['hashes']!['E1']!.isEqual(deleteField())).toBe(true);
    expect(mapas['inventoryHashes']!['E1']!.isEqual(deleteField())).toBe(true);
  });
});

describe('carregarHashes — lê os dois mapas', () => {
  it('o mapa novo vence o legado', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ inventoryHashes: { A: 'velho', B: 'b1' }, hashes: { A: 'novo' } }),
    } as never);
    expect(await carregarHashes()).toEqual(new Map([['A', 'novo'], ['B', 'b1']]));
  });
});
