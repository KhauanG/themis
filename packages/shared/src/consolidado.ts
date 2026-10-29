/**
 * Relatório consolidado: várias auditorias salvas de um estoque, somadas.
 *
 * ## O que "somar ciclos" significa aqui
 *
 * Cada ciclo é uma **medição independente**. Um produto contado no ciclo 1 e de novo no
 * ciclo 2 conta **duas vezes** — são duas medições, não um produto duplicado.
 *
 * É de propósito, e é o que mede acurácia de inventário ao longo do tempo: de todas as
 * contagens feitas no período, quantas bateram com o sistema. Deduplicar por produto
 * responderia outra pergunta ("quantos produtos distintos foram tocados"), que não é a que
 * um relatório de auditoria faz.
 *
 * ⚠️ Por isso a tela e o PDF precisam dizer **"medições"**, e não "produtos": ler
 * "3.200 itens contados" como "o estoque tem 3.200 produtos" é o mal-entendido natural, e
 * caro num relatório que circula.
 *
 * ## A armadilha dos percentuais
 *
 * O percentual do total é recalculado a partir das **somas**, nunca pela média dos
 * percentuais de cada ciclo. Média de percentual dá peso igual a um ciclo de 10 itens e a
 * um de 2.000 — e produz um número que parece razoável e está errado. Há teste para isso.
 */
import { rotuloDaAuditoria } from './lote.js';
import type { Auditoria } from './types.js';

/** Uma linha do relatório: o resumo de um ciclo. */
export interface CicloConsolidado {
  auditoriaId: string;
  nome: string;
  ciclo: number;
  /** Lote da rodada. Vazio nas auditorias anteriores à funcionalidade. */
  lote: string;
  data: Date;
  /** Produtos contáveis no ciclo (exclui os fora do ERP). */
  total: number;
  contados: number;
  naoContados: number;
  corretos: number;
  incorretos: number;
  /** Itens que o admin conferiu, com o que ele marcou. Saem de `contados`. */
  corrigidos: number;
  corrigidosCorretos: number;
  corrigidosIncorretos: number;
  foraDoErp: number;
  /** Sobre os contados. `0` quando nada foi contado. */
  percentualCorretos: number;
  percentualIncorretos: number;
  /** Quanto do estoque o ciclo cobriu: contados sobre o total contável. */
  percentualCobertura: number;
}

export interface TotaisConsolidados {
  ciclos: number;
  total: number;
  contados: number;
  naoContados: number;
  corretos: number;
  incorretos: number;
  corrigidos: number;
  corrigidosCorretos: number;
  corrigidosIncorretos: number;
  foraDoErp: number;
  percentualCorretos: number;
  percentualIncorretos: number;
  percentualCobertura: number;
}

export interface RelatorioConsolidado {
  /** Um por ciclo, do mais antigo para o mais recente — é como se lê uma evolução. */
  ciclos: CicloConsolidado[];
  totais: TotaisConsolidados;
}

/** Uma casa decimal, como o resto do projeto. `0` quando não há base. */
export function percentual(parte: number, total: number): number {
  if (total <= 0) return 0;
  return parseFloat(((parte / total) * 100).toFixed(1));
}

function doCiclo(a: Auditoria): CicloConsolidado {
  const e = a.estatisticas;
  const corrigidos = e.corrigidos ?? { total: 0, corretos: 0, incorretos: 0 };

  return {
    // `Auditoria.id` é opcional no tipo — `montarAuditoria` devolve `Omit<Auditoria, 'id'>`,
    // porque o id só existe depois de gravar. Consolidar só recebe auditoria já salva, mas
    // o padrão evita que a tela use `undefined` como chave de lista.
    auditoriaId: a.id ?? '',
    lote: (a.lote ?? '').trim(),
    nome: a.nome,
    ciclo: a.contagemCycle,
    data: a.data,
    total: e.total ?? 0,
    contados: e.contados ?? 0,
    naoContados: e.naoContados ?? 0,
    corretos: e.corretos ?? 0,
    incorretos: e.incorretos ?? 0,
    corrigidos: corrigidos.total ?? 0,
    corrigidosCorretos: corrigidos.corretos ?? 0,
    corrigidosIncorretos: corrigidos.incorretos ?? 0,
    foraDoErp: e.foraDoErp ?? 0,
    percentualCorretos: percentual(e.corretos ?? 0, e.contados ?? 0),
    percentualIncorretos: percentual(e.incorretos ?? 0, e.contados ?? 0),
    percentualCobertura: percentual(e.contados ?? 0, e.total ?? 0),
  };
}

/**
 * Consolida as auditorias escolhidas.
 *
 * Aceita a lista em qualquer ordem e devolve por ciclo crescente: um relatório de evolução
 * lido de trás para frente não é relatório de evolução.
 *
 * As estatísticas vêm do que foi **gravado** em cada auditoria, não recalculadas do
 * snapshot de produtos. É deliberado: a auditoria é um retrato do que valia no fechamento,
 * e recalcular hoje aplicaria as regras de hoje a um dado de meses atrás — o número mudaria
 * sozinho a cada alteração no cálculo.
 */
export function consolidarCiclos(auditorias: readonly Auditoria[]): RelatorioConsolidado {
  const ciclos = auditorias
    .map(doCiclo)
    .sort((a, b) => a.ciclo - b.ciclo || a.data.getTime() - b.data.getTime());

  const soma = (campo: keyof CicloConsolidado): number =>
    ciclos.reduce((acc, c) => acc + (typeof c[campo] === 'number' ? (c[campo] as number) : 0), 0);

  const contados = soma('contados');
  const total = soma('total');
  const corretos = soma('corretos');
  const incorretos = soma('incorretos');

  return {
    ciclos,
    totais: {
      ciclos: ciclos.length,
      total,
      contados,
      naoContados: soma('naoContados'),
      corretos,
      incorretos,
      corrigidos: soma('corrigidos'),
      corrigidosCorretos: soma('corrigidosCorretos'),
      corrigidosIncorretos: soma('corrigidosIncorretos'),
      foraDoErp: soma('foraDoErp'),
      // Das SOMAS, nunca da média dos percentuais de cada ciclo — ver o topo do arquivo.
      percentualCorretos: percentual(corretos, contados),
      percentualIncorretos: percentual(incorretos, contados),
      percentualCobertura: percentual(contados, total),
    },
  };
}

/**
 * O período do relatório, das pontas que chegam na ordem do `consolidarCiclos`:
 * `Lote A a Lote B · d1 a d2`. Sem lote em alguma ponta, só `d1 a d2`: o contador interno
 * não vai à tela.
 */
export function periodoDoConsolidado(ciclos: ReadonlyArray<Pick<CicloConsolidado, 'lote' | 'data'>>): string {
  const primeiro = ciclos[0];
  const ultimo = ciclos[ciclos.length - 1];
  if (!primeiro || !ultimo) return 'Nenhuma rodada selecionada';
  const datas = `${primeiro.data.toLocaleDateString('pt-BR')} a ${ultimo.data.toLocaleDateString('pt-BR')}`;
  return primeiro.lote.trim() && ultimo.lote.trim()
    ? `${rotuloDaAuditoria(primeiro)} a ${rotuloDaAuditoria(ultimo)} · ${datas}`
    : datas;
}
