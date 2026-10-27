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
  // Sem merge, cada ajuste apagava latestNativeAppVersion (aviso de versão do app nativo).
  it('grava com merge para não apagar campo que a tela não conhece', async () => {
    await salvarConfiguracoes({ modoContagem: true, somenteLeitura: ['E1'], mostrarCiclo: false });
    const [, dados, opcoes] = vi.mocked(setDoc).mock.calls[0]!;
    expect(opcoes).toEqual({ merge: true });
    expect(Object.keys(dados as object).sort()).toEqual([
      'lastUpdated',
      'modoContagem',
      'mostrarCiclo',
      'readonlyInventories',
    ]);
  });
});
