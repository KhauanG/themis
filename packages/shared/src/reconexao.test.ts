import { describe, expect, it } from 'vitest';
import {
  ESPERA_BASE_MS,
  ESPERA_MAXIMA_MS,
  deveAvisar,
  esperaDeReconexao,
} from './reconexao.js';

describe('esperaDeReconexao', () => {
  it('a primeira tentativa espera a base', () => {
    expect(esperaDeReconexao(1)).toBe(ESPERA_BASE_MS);
  });

  // Sem o crescimento, uma inscrição negada pela regra viraria martelo no Firestore:
  // uma tentativa por segundo, para sempre, em cada aparelho da equipe.
  it('dobra a cada falha seguida', () => {
    expect(esperaDeReconexao(2)).toBe(2_000);
    expect(esperaDeReconexao(3)).toBe(4_000);
    expect(esperaDeReconexao(4)).toBe(8_000);
  });

  // Sem o teto, a 20ª falha esperaria mais de oito dias — o aparelho ficaria mudo até
  // alguém reabrir, que é exatamente o problema que a reconexão existe para resolver.
  it('nunca passa do teto', () => {
    expect(esperaDeReconexao(10)).toBe(ESPERA_MAXIMA_MS);
    expect(esperaDeReconexao(50)).toBe(ESPERA_MAXIMA_MS);
    expect(esperaDeReconexao(1000)).toBe(ESPERA_MAXIMA_MS);
  });

  it('nunca devolve menos que a base', () => {
    expect(esperaDeReconexao(0)).toBe(ESPERA_BASE_MS);
    expect(esperaDeReconexao(-5)).toBe(ESPERA_BASE_MS);
  });
});

describe('deveAvisar', () => {
  // As duas primeiras costumam ser a mesma rede oscilando. Alarme que toca à toa é alarme
  // que a equipe ignora quando é de verdade.
  it('cala nas duas primeiras', () => {
    expect(deveAvisar(1)).toBe(false);
    expect(deveAvisar(2)).toBe(false);
  });

  it('avisa da terceira em diante', () => {
    expect(deveAvisar(3)).toBe(true);
    expect(deveAvisar(9)).toBe(true);
  });
});
