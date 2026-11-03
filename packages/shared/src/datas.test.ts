import { afterEach, describe, expect, it, vi } from 'vitest';
import { hojeLocalISO } from './datas.js';

afterEach(() => vi.useRealTimers());

// O CI roda em Ubuntu (UTC). Sem o fuso fixo no vitest.setup.ts, os testes de data só
// passariam na máquina do dono.
describe('fuso dos testes', () => {
  it('é America/Sao_Paulo', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Sao_Paulo');
    expect(new Date(2026, 10, 3, 22, 0).toISOString()).toBe('2026-11-04T01:00:00.000Z');
  });
});

describe('hojeLocalISO', () => {
  it('às 22:00 de Brasília ainda é hoje', () => {
    expect(hojeLocalISO(0, new Date(2026, 10, 3, 22, 0))).toBe('2026-11-03');
  });

  it('23:59 do último dia do ano', () => {
    expect(hojeLocalISO(0, new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('soma dias no calendário local', () => {
    expect(hojeLocalISO(30, new Date(2026, 10, 3, 22, 0))).toBe('2026-12-03');
  });

  it('sem argumentos usa agora', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 3, 21, 15));
    expect(hojeLocalISO()).toBe('2026-11-03');
  });
});
