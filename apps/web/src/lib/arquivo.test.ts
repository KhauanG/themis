import { afterEach, describe, expect, it, vi } from 'vitest';
import { nomeDeArquivo } from './arquivo.js';

afterEach(() => vi.useRealTimers());

describe('nomeDeArquivo', () => {
  it('depois das 21:00 leva o dia local, não o de amanhã', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 3, 22, 30));
    expect(nomeDeArquivo('contagem-Depósito Central', 'pdf')).toBe('contagem-deposito-central-2026-11-03.pdf');
  });
});
