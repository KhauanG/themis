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
  foraDoErp,
  idProdutoDe,
  isItemContado,
  nomeDe,
  sistemaDe,
  statusContagemDe,
  validadeDe,
} from './produto.js';

/**
 * Status de auditoria de um produto.
 *
 * `FORA DO ERP` vem **antes de tudo**: sem o produto na listagem da loja, o `estoqueSistema`
 * guardado é o da última importação, e comparar contra ele produz uma divergência que
 * ninguém confirmou. Um relatório que imprime `sistema 1 · contado 4 · ERRADO` para um
 * produto que o ERP não tem manda corrigir saldo quando o que falta é cadastro.
 */
export function statusDe(p: Produto): StatusAuditoria {
  if (foraDoErp(p)) return 'FORA DO ERP';
  if (!isItemContado(p)) return 'NÃO CONTADO';

  const fisico = fisicoDe(p);
  const sistema = sistemaDe(p);
  if (fisico === sistema) return 'CORRETO';

  return Math.abs(fisico - sistema) >= LIMITE_CRITICO ? 'CRITICO' : 'ERRADO';
}

/**
 * Diferença físico - sistema. `'-'` quando não há o que comparar.
 *
 * Item não contado não tem físico; item fora do ERP não tem sistema confiável. Nos dois
 * casos, qualquer número aqui seria invenção.
 */
export function diferencaDe(p: Produto): number | '-' {
  if (foraDoErp(p) || !isItemContado(p)) return '-';
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

  // Produto fora do ERP sai da conta inteira: não é contável, e somá-lo aos "não contados"
  // faria a contagem nunca fechar.
  const fora = produtos.filter(foraDoErp);
  const contaveis = produtos.filter((p) => !foraDoErp(p));

  const naContagem = contaveis.filter((p) => isItemContado(p) && !conferido(p));

  const contados = naContagem.length;
  const corretos = naContagem.filter((p) => fisicoDe(p) === sistemaDe(p)).length;
  const incorretos = contados - corretos;

  const corrigidos = contaveis.filter(conferido);
  let corrigidosCorretos = 0;
  let corrigidosIncorretos = 0;
  for (const p of corrigidos) {
    // A marcação explícita do admin vence o cálculo automático.
    if (p.corrigidoIncorreto === true) corrigidosIncorretos++;
    else if (fisicoDe(p) === sistemaDe(p)) corrigidosCorretos++;
    else corrigidosIncorretos++;
  }

  return {
    total: contaveis.length,
    contados,
    // Mantém `contados + naoContados === total`. Conferidos entram aqui de propósito — eles
    // saem de `contados` e são somados à parte em `corrigidos`; ver o comentário acima.
    naoContados: contaveis.length - contados,
    foraDoErp: fora.length,
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
