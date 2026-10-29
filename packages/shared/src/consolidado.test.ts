import { describe, expect, it } from 'vitest';
import { consolidarCiclos, percentual, periodoDoConsolidado } from './consolidado.js';
import type { Auditoria, EstatisticasAuditoria } from './types.js';

function estatisticas(p: Partial<EstatisticasAuditoria> = {}): EstatisticasAuditoria {
  return {
    total: 100,
    contados: 100,
    naoContados: 0,
    foraDoErp: 0,
    corretos: 90,
    incorretos: 10,
    percentualIncorretos: 10,
    corrigidos: { total: 0, corretos: 0, incorretos: 0, percentualIncorretos: 0 },
    ...p,
  } as EstatisticasAuditoria;
}

function auditoria(ciclo: number, e: Partial<EstatisticasAuditoria> = {}): Auditoria {
  return {
    id: `a${ciclo}`,
    nome: `Loja - Ciclo ${ciclo}`,
    inventoryId: 'X',
    contagemCycle: ciclo,
    data: new Date(2026, 0, ciclo),
    produtos: [],
    estatisticas: estatisticas(e),
    createdBy: 'dev',
    createdAt: new Date(2026, 0, ciclo),
  } as Auditoria;
}

describe('percentual', () => {
  it('uma casa decimal', () => {
    expect(percentual(1, 3)).toBe(33.3);
  });

  // Divisão por zero apareceria como NaN no relatório impresso.
  it('sem base devolve zero', () => {
    expect(percentual(5, 0)).toBe(0);
    expect(percentual(0, 0)).toBe(0);
  });
});

describe('consolidarCiclos', () => {
  it('soma os ciclos escolhidos', () => {
    const r = consolidarCiclos([auditoria(1), auditoria(2)]);
    expect(r.totais.ciclos).toBe(2);
    expect(r.totais.contados).toBe(200);
    expect(r.totais.corretos).toBe(180);
    expect(r.totais.incorretos).toBe(20);
  });

  // Relatório de evolução lido de trás para frente não é relatório de evolução — e a lista
  // chega do Firestore por data decrescente.
  it('ordena por ciclo crescente, venha como vier', () => {
    const r = consolidarCiclos([auditoria(3), auditoria(1), auditoria(2)]);
    expect(r.ciclos.map((c) => c.ciclo)).toEqual([1, 2, 3]);
  });

  /*
    A armadilha central deste módulo.

    Ciclo pequeno com desempenho ruim e ciclo grande com desempenho bom: a média dos
    percentuais daria (50 + 1) / 2 = 25,5%, número que parece razoável e está errado. O
    certo sai das somas: 6 incorretos em 1.010 contados = 0,6%.
  */
  it('percentual do total vem das somas, não da média dos percentuais', () => {
    const pequeno = auditoria(1, {
      total: 10, contados: 10, naoContados: 0,
      corretos: 5, incorretos: 5, percentualIncorretos: 50,
    });
    const grande = auditoria(2, {
      total: 1000, contados: 1000, naoContados: 0,
      corretos: 999, incorretos: 1, percentualIncorretos: 0.1,
    });

    const r = consolidarCiclos([pequeno, grande]);

    expect(r.totais.incorretos).toBe(6);
    expect(r.totais.contados).toBe(1010);
    expect(r.totais.percentualIncorretos).toBe(0.6);
    // A média simples daria 25,05. Se este número aparecer, o cálculo regrediu.
    expect(r.totais.percentualIncorretos).not.toBeCloseTo(25.05, 1);
  });

  it('cobertura é contados sobre o total contável', () => {
    const r = consolidarCiclos([
      auditoria(1, { total: 200, contados: 50, naoContados: 150, corretos: 50, incorretos: 0 }),
    ]);
    expect(r.ciclos[0]?.percentualCobertura).toBe(25);
    expect(r.totais.percentualCobertura).toBe(25);
  });

  it('soma os conferidos à parte, sem misturar com os contados', () => {
    const r = consolidarCiclos([
      auditoria(1, {
        contados: 80, corretos: 70, incorretos: 10,
        corrigidos: { total: 20, corretos: 12, incorretos: 8, percentualIncorretos: 40 },
      }),
      auditoria(2, {
        contados: 90, corretos: 85, incorretos: 5,
        corrigidos: { total: 10, corretos: 6, incorretos: 4, percentualIncorretos: 40 },
      }),
    ]);

    expect(r.totais.contados).toBe(170);
    expect(r.totais.corrigidos).toBe(30);
    expect(r.totais.corrigidosIncorretos).toBe(12);
  });

  it('nenhum ciclo escolhido não quebra', () => {
    const r = consolidarCiclos([]);
    expect(r.ciclos).toEqual([]);
    expect(r.totais.ciclos).toBe(0);
    expect(r.totais.percentualIncorretos).toBe(0);
  });

  /*
    Auditorias gravadas pelo 1.x podem não ter o bloco `corrigidos` — ele nasceu depois. Sem
    tolerar a ausência, consolidar um período antigo estoura no meio do relatório.
  */
  it('tolera auditoria antiga sem o bloco de corrigidos', () => {
    const antiga = auditoria(1);
    // @ts-expect-error — reproduz o documento legado, que não tinha o campo.
    delete antiga.estatisticas.corrigidos;

    const r = consolidarCiclos([antiga]);
    expect(r.totais.corrigidos).toBe(0);
    expect(r.ciclos[0]?.corrigidosIncorretos).toBe(0);
  });
});

describe('periodoDoConsolidado', () => {
  const r = (lote: string, data: Date) => ({ lote, data });

  it('lote nas duas pontas', () => {
    expect(
      periodoDoConsolidado([r('A', new Date(2026, 7, 1)), r('', new Date(2026, 8, 1)), r('B', new Date(2026, 9, 28))]),
    ).toBe('Lote A a Lote B · 01/08/2026 a 28/10/2026');
  });

  // Antes saía "Ciclo N a Lote B"; sem o ciclo, uma ponta sem lote deixa só as datas.
  it('uma ponta sem lote: só as datas', () => {
    expect(periodoDoConsolidado([r('', new Date(2026, 7, 1)), r('B', new Date(2026, 9, 28))])).toBe('01/08/2026 a 28/10/2026');
    expect(periodoDoConsolidado([r('A', new Date(2026, 7, 1)), r('', new Date(2026, 9, 28))])).toBe('01/08/2026 a 28/10/2026');
  });

  it('nenhuma rodada', () => {
    expect(periodoDoConsolidado([])).toBe('Nenhuma rodada selecionada');
  });
});
