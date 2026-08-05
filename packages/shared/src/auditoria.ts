/**
 * Cálculo canônico da auditoria — fonte ÚNICA da verdade.
 *
 * No Themis 1.x essa lógica existia duplicada em `app.js` e `auditoria.js`, e as duas
 * cópias divergiram: a de `app.js` nunca devolvia `CRITICO`. Auditoria salva pela tela
 * do funcionário e pelo painel do auditor davam resultados diferentes para os mesmos
 * produtos. Aqui existe uma implementação só, coberta por teste.
 *
 * Funções puras: sem DOM, sem Firebase, sem estado global.
 */
import {
  LIMITE_CRITICO,
  type EstatisticasAuditoria,
  type Produto,
  type ProdutoSnapshot,
  type StatusAuditoria,
} from './types.js';
import {
  codigoBarrasDe,
  fisicoDe,
  idProdutoDe,
  isItemContado,
  nomeDe,
  sistemaDe,
  statusContagemDe,
  validadeDe,
} from './produto.js';

/** Status de auditoria de um produto. */
export function statusDe(p: Produto): StatusAuditoria {
  if (!isItemContado(p)) return 'NÃO CONTADO';

  const fisico = fisicoDe(p);
  const sistema = sistemaDe(p);
  if (fisico === sistema) return 'CORRETO';

  return Math.abs(fisico - sistema) >= LIMITE_CRITICO ? 'CRITICO' : 'ERRADO';
}

/** Diferença físico - sistema. `'-'` quando o item não foi contado. */
export function diferencaDe(p: Produto): number | '-' {
  if (!isItemContado(p)) return '-';
  return fisicoDe(p) - sistemaDe(p);
}

function percentual(parte: number, total: number): number {
  if (total <= 0) return 0.0;
  return parseFloat(((parte / total) * 100).toFixed(1));
}

/**
 * Estatísticas da auditoria.
 *
 * Regra herdada do painel do auditor: itens `CONFERIDO` (já corrigidos pelo admin)
 * saem das contagens principais e são somados à parte em `corrigidos`. Sem isso,
 * uma correção contaria duas vezes.
 */
export function calcularEstatisticas(produtos: Produto[]): EstatisticasAuditoria {
  const conferido = (p: Produto) => statusContagemDe(p) === 'CONFERIDO';
  const naContagem = produtos.filter((p) => isItemContado(p) && !conferido(p));

  const contados = naContagem.length;
  const corretos = naContagem.filter((p) => fisicoDe(p) === sistemaDe(p)).length;
  const incorretos = contados - corretos;

  const corrigidos = produtos.filter(conferido);
  let corrigidosCorretos = 0;
  let corrigidosIncorretos = 0;
  for (const p of corrigidos) {
    // A marcação explícita do admin vence o cálculo automático.
    if (p.corrigidoIncorreto === true) corrigidosIncorretos++;
    else if (fisicoDe(p) === sistemaDe(p)) corrigidosCorretos++;
    else corrigidosIncorretos++;
  }

  return {
    total: produtos.length,
    contados,
    naoContados: produtos.length - contados,
    corretos,
    incorretos,
    percentualIncorretos: percentual(incorretos, contados),
    corrigidos: {
      total: corrigidos.length,
      corretos: corrigidosCorretos,
      incorretos: corrigidosIncorretos,
      percentualIncorretos: percentual(corrigidosIncorretos, corrigidos.length),
    },
  };
}

/**
 * Snapshot dos produtos gravado dentro da auditoria.
 * Formato idêntico ao que o Themis 1.x grava — auditorias antigas e novas
 * continuam legíveis pelo mesmo código de leitura.
 */
export function montarSnapshotProdutos(produtos: Produto[]): ProdutoSnapshot[] {
  return produtos.map((p) => ({
    id: p.id,
    nome: nomeDe(p),
    IdProduto: idProdutoDe(p),
    codigoBarras: codigoBarrasDe(p),
    NomeProduto: nomeDe(p),
    estoqueFisico: fisicoDe(p),
    estoqueSistema: sistemaDe(p),
    status: statusDe(p),
    diferenca: diferencaDe(p),
    productStatus: statusContagemDe(p),
    corrigidoIncorreto: p.corrigidoIncorreto ?? null,
    dataValidade: validadeDe(p),
  }));
}
