import { describe, expect, it } from 'vitest';
import {
  MAX_LOTE,
  loteAtivo,
  loteDe,
  datasDaLista,
  loteValido,
  nomeDaAuditoria,
  normalizarLote,
  rotuloDaAuditoria,
  rotuloDaRodada,
  rotulosDoSeletor,
  subtituloDaAuditoriaSalva,
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
    O ponto central do módulo. Finalizar é liberado para qualquer usuário e só sobe o
    `contagemCycle`: o carimbo deixa de bater e o lote vence sozinho, sem escrita a mais
    no payload do Finalizar.
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

  // O ciclo é contador interno e não vai à tela. O lote vencido continua no documento
  // depois de finalizar: vale o carimbo, não a presença do texto.
  it('sem lote ativo é "Sem lote", nunca o número do ciclo', () => {
    expect(rotuloDaRodada(estoque(undefined, undefined, 7))).toBe('Sem lote');
    expect(rotuloDaRodada(estoque('L-1', 1, 2))).toBe('Sem lote');
    expect(rotuloDaRodada(null)).toBe('Sem lote');
  });

  it('vale igual para auditoria salva', () => {
    expect(rotuloDaAuditoria({ lote: ' L-5 ' })).toBe('Lote L-5');
    expect(rotuloDaAuditoria({})).toBe('Sem lote');
    expect(rotuloDaAuditoria({ lote: '  ' })).toBe('Sem lote');
    expect(rotuloDaAuditoria({ lote: null })).toBe('Sem lote');
  });
});

describe('nomeDaAuditoria', () => {
  it('estoque e lote', () => {
    expect(nomeDaAuditoria('Loja Centro', '29-10 manhã')).toBe('Loja Centro - Lote 29-10 manhã');
  });

  it('sem lote', () => {
    expect(nomeDaAuditoria('Loja Centro', null)).toBe('Loja Centro - Sem lote');
  });

  // A regra nega o Finalizar com nome acima de 100 (firestore.rules:248). O nome do estoque
  // vai a 100 e o lote a 40: "<estoque> - Lote X" chegava a 148.
  it('corta em 100', () => {
    const nome = nomeDaAuditoria('N'.repeat(60), 'L'.repeat(40));
    expect(nome).toHaveLength(100);
    expect(nome).toBe(`${'N'.repeat(60)} - Lote ${'L'.repeat(32)}`);
  });

  it('loja com 100 caracteres fica só com o nome', () => {
    expect(nomeDaAuditoria('N'.repeat(100), 'L-1')).toBe('N'.repeat(100));
  });

  // O emoji ocupa duas unidades UTF-16. Cortado no meio, sobraria meia letra no nome gravado.
  it('emoji no ponto do corte não fica pela metade', () => {
    // 90 + " - Lote " + "X" = 99: a metade alta do emoji cairia na posição 100.
    expect(nomeDaAuditoria('N'.repeat(90), 'X🍺')).toBe(`${'N'.repeat(90)} - Lote X`);
  });
});

const salva = (lote: string | undefined, data: Date) => ({ lote, data });

describe('rotulosDoSeletor', () => {
  it('lote e data; sem lote, só a data', () => {
    expect(
      rotulosDoSeletor([salva('29-10 manhã', new Date(2026, 9, 29, 11, 40)), salva(undefined, new Date(2026, 7, 1, 9, 5))]),
    ).toEqual(['Lote 29-10 manhã — 29/10/2026', '01/08/2026']);
  });

  // O site até a 2.19 duplicava auditoria com dois cliques (auditorias-repo.ts:76-78), e o
  // seletor não mostra mais o nome gravado: duas do mesmo dia ficariam iguais.
  it('dois iguais ganham a hora; os outros não', () => {
    expect(
      rotulosDoSeletor([
        salva(undefined, new Date(2026, 7, 1, 9, 5)),
        salva('L-1', new Date(2026, 7, 1, 10, 0)),
        salva(undefined, new Date(2026, 7, 1, 18, 32)),
      ]),
    ).toEqual(['01/08/2026 09:05', 'Lote L-1 — 01/08/2026', '01/08/2026 18:32']);
  });

  it('com lote também ganha a hora', () => {
    expect(
      rotulosDoSeletor([salva('A', new Date(2026, 9, 28, 8, 0)), salva('A', new Date(2026, 9, 28, 14, 10))]),
    ).toEqual(['Lote A — 28/10/2026 08:00', 'Lote A — 28/10/2026 14:10']);
  });

  it('mesmo minuto continua igual, sem quebrar', () => {
    const d = new Date(2026, 7, 1, 9, 5);
    expect(rotulosDoSeletor([salva(undefined, d), salva(undefined, d)])).toEqual(['01/08/2026 09:05', '01/08/2026 09:05']);
  });

  it('lote só de espaços conta como sem lote', () => {
    expect(rotulosDoSeletor([salva('  ', new Date(2026, 9, 28, 18, 32))])).toEqual(['28/10/2026']);
  });
});

// Chips, tabela e PDF do consolidado mostram o lote e a data em lugares separados.
describe('datasDaLista', () => {
  it('mesma data e mesmo lote ganham a hora; lote diferente não', () => {
    expect(
      datasDaLista([
        salva(undefined, new Date(2026, 7, 1, 9, 5)),
        salva(' ', new Date(2026, 7, 1, 18, 32)),
        salva('L-1', new Date(2026, 7, 1, 10, 0)),
      ]),
    ).toEqual(['01/08/2026 09:05', '01/08/2026 18:32', '01/08/2026']);
  });
});

describe('subtituloDaAuditoriaSalva', () => {
  const data = new Date(2026, 9, 28, 18, 32, 10);

  it('com lote', () => {
    expect(subtituloDaAuditoriaSalva({ lote: 'L-9', data })).toBe('Lote L-9 · salva em 28/10/2026, 18:32:10 · somente leitura');
  });

  it('sem lote, começa com maiúscula', () => {
    expect(subtituloDaAuditoriaSalva({ data })).toBe('Salva em 28/10/2026, 18:32:10 · somente leitura');
  });

  it('lote só de espaços ou null conta como sem lote', () => {
    expect(subtituloDaAuditoriaSalva({ lote: '  ', data })).toBe('Salva em 28/10/2026, 18:32:10 · somente leitura');
    expect(subtituloDaAuditoriaSalva({ lote: null, data })).toBe('Salva em 28/10/2026, 18:32:10 · somente leitura');
  });
});
