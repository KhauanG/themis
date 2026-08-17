import { describe, expect, it } from 'vitest';
import { estaConciliando, podeLiberarTela } from './carregamento.js';

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

describe('estaConciliando', () => {
  const base = { snapshotDoCache: true, online: true, contatoPerdido: false, esgotou: false };

  it('snapshot do servidor não espera', () => {
    expect(estaConciliando({ ...base, snapshotDoCache: false })).toBe(false);
  });

  it('cache com o app online espera', () => {
    expect(estaConciliando(base)).toBe(true);
  });

  /*
    A regressão que motivou este bloco. Amarrado só ao `fromCache`, o aviso ficava eterno
    offline: o primeiro snapshot vem do cache, nenhum outro chega, e não existe evento para
    desligá-lo. Em campo: "sincronizando…" para sempre, totais escondidos e Finalizar
    travado — para quem está offline, que é o cenário principal do app.
  */
  it('offline NÃO espera — o servidor não vem', () => {
    expect(estaConciliando({ ...base, online: false })).toBe(false);
  });

  it('inscrição caída não espera — nada está a caminho', () => {
    expect(estaConciliando({ ...base, contatoPerdido: true })).toBe(false);
  });

  it('teto estourado não espera', () => {
    expect(estaConciliando({ ...base, esgotou: true })).toBe(false);
  });
});
