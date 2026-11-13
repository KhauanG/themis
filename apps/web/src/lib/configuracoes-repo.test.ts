import { describe, expect, it, vi } from 'vitest';
import { setDoc } from 'firebase/firestore';
import { salvarConfiguracoes } from './configuracoes-repo.js';

// O módulo real de `firebase.js` lança sem as variáveis do `.env`; aqui só o `db` importa.
vi.mock('./firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  setDoc: vi.fn(async () => undefined),
  doc: vi.fn((_db: unknown, ...p: string[]) => ({ path: p.join('/') })),
}));

describe('salvarConfiguracoes', () => {
  // O site não grava mais a lista de lojas travadas: a lista velha é esvaziada pelo script do dono.
  it('grava com merge e só modoContagem e lastUpdated', async () => {
    await salvarConfiguracoes({ modoContagem: true });
    const [, dados, opcoes] = vi.mocked(setDoc).mock.calls[0]!;
    expect(opcoes).toEqual({ merge: true });
    expect(Object.keys(dados as object).sort()).toEqual(['lastUpdated', 'modoContagem']);
  });
});
