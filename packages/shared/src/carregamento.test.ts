import { describe, expect, it } from 'vitest';
import { podeLiberarTela } from './carregamento.js';

describe('podeLiberarTela', () => {
  it('snapshot do servidor libera sempre', () => {
    expect(podeLiberarTela({ doCache: false, online: true, esgotou: false })).toBe(true);
    expect(podeLiberarTela({ doCache: false, online: false, esgotou: false })).toBe(true);
  });

  // Offline o snapshot do servidor nunca vem. Segurar a tela impediria a contagem offline,
  // que é justamente o motivo de o cache existir.
  it('offline libera com o cache', () => {
    expect(podeLiberarTela({ doCache: true, online: false, esgotou: false })).toBe(true);
  });

  /*
    A linha que corrige o bug relatado: itens duplicados e contagem inflada ao abrir o app,
    que somem ao recarregar. Era o cache sendo tratado como verdade final.
  */
  it('online e do cache SEGURA, esperando o servidor', () => {
    expect(podeLiberarTela({ doCache: true, online: true, esgotou: false })).toBe(false);
  });

  // Rede lenta é pior que rede ausente: o app se acha online e esperaria para sempre.
  it('teto estourado libera com o cache', () => {
    expect(podeLiberarTela({ doCache: true, online: true, esgotou: true })).toBe(true);
  });
});
