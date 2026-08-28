import { describe, expect, it } from 'vitest';
import {
  MAX_LOTE,
  loteAtivo,
  loteDe,
  loteValido,
  normalizarLote,
  rotuloDaAuditoria,
  rotuloDaAuditoriaCompleto,
  rotuloDaRodada,
  rotuloDaRodadaCompleto,
} from './lote.js';

const estoque = (lote: string | undefined, loteCiclo: number | undefined, contagemCycle: number) =>
  ({ lote, loteCiclo, contagemCycle }) as Parameters<typeof loteAtivo>[0];

describe('normalizarLote', () => {
  it('tira espaço das pontas', () => {
    expect(normalizarLote('  LOTE 12  ')).toBe('LOTE 12');
  });

  // "LOTE  12" e "LOTE 12" precisam ser o mesmo, senão a busca que o lote existe para
  // permitir encontra metade das contagens.
  it('colapsa espaços repetidos', () => {
    expect(normalizarLote('LOTE   12')).toBe('LOTE 12');
  });

  it('corta no limite', () => {
    expect(normalizarLote('x'.repeat(80))).toHaveLength(MAX_LOTE);
  });

  it('só espaço não é lote válido', () => {
    expect(loteValido('   ')).toBe(false);
    expect(loteValido('A')).toBe(true);
  });
});

describe('loteAtivo', () => {
  it('vale quando o carimbo bate com o ciclo corrente', () => {
    expect(loteAtivo(estoque('LOTE 1', 3, 3))).toBe(true);
  });

  /*
    O ponto central do módulo. Finalizar incrementa o ciclo e é liberado para qualquer
    usuário — mas a regra do Firestore só aceita os quatro campos de ciclo nesse caminho,
    então limpar o lote no mesmo payload seria negado. O carimbo faz o lote expirar sozinho.
  */
  it('expira quando o ciclo avança — é assim que finalizar encerra o lote', () => {
    expect(loteAtivo(estoque('LOTE 1', 3, 4))).toBe(false);
  });

  it('sem rótulo não vale, mesmo com o carimbo certo', () => {
    expect(loteAtivo(estoque('', 3, 3))).toBe(false);
    expect(loteAtivo(estoque('   ', 3, 3))).toBe(false);
    expect(loteAtivo(estoque(undefined, 3, 3))).toBe(false);
  });

  it('sem carimbo não vale — cobre o acervo anterior à funcionalidade', () => {
    expect(loteAtivo(estoque('LOTE 1', undefined, 3))).toBe(false);
  });

  it('sem estoque não quebra', () => {
    expect(loteAtivo(null)).toBe(false);
    expect(loteDe(null)).toBe(null);
  });
});

describe('rótulos', () => {
  it('mostra o lote quando há', () => {
    expect(rotuloDaRodada(estoque('L-99', 2, 2))).toBe('Lote L-99');
  });

  // Auditoria salva antes desta funcionalidade só tem o ciclo. Rotulá-la "Lote —" apagaria
  // a única referência que ela tem.
  it('cai para o ciclo quando não há lote', () => {
    expect(rotuloDaRodada(estoque(undefined, undefined, 7))).toBe('Ciclo 7');
    expect(rotuloDaRodada(estoque('L-1', 1, 2))).toBe('Ciclo 2');
  });

  it('vale igual para auditoria salva', () => {
    expect(rotuloDaAuditoria({ lote: 'L-5', contagemCycle: 3 })).toBe('Lote L-5');
    expect(rotuloDaAuditoria({ contagemCycle: 3 })).toBe('Ciclo 3');
    expect(rotuloDaAuditoria({ lote: '  ', contagemCycle: 3 })).toBe('Ciclo 3');
  });
});

describe('rótulos durante a transição', () => {
  const comLote = { lote: 'L-9', contagemCycle: 4 };
  const semLote = { contagemCycle: 4 };

  it('ligado, mostra os dois', () => {
    expect(rotuloDaAuditoriaCompleto(comLote, true)).toBe('Lote L-9 · Ciclo 4');
  });

  it('desligado, sobra só o lote', () => {
    expect(rotuloDaAuditoriaCompleto(comLote, false)).toBe('Lote L-9');
  });

  /*
    Auditoria anterior ao lote só tem o ciclo. Esconder por causa do interruptor deixaria a
    linha sem nenhuma identificação — pior que o ruído que o interruptor existe para cortar.
  */
  it('auditoria sem lote mostra o ciclo mesmo com o interruptor desligado', () => {
    expect(rotuloDaAuditoriaCompleto(semLote, false)).toBe('Ciclo 4');
  });

  it('vale igual para a rodada em andamento', () => {
    const estoque = { lote: 'L-9', loteCiclo: 4, contagemCycle: 4 } as Parameters<typeof rotuloDaRodadaCompleto>[0];
    expect(rotuloDaRodadaCompleto(estoque, true)).toBe('Lote L-9 · Ciclo 4');
    expect(rotuloDaRodadaCompleto(estoque, false)).toBe('Lote L-9');
  });
});
