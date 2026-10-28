/**
 * Veredicto do Testar (spec 4.5): uma listagem do ERP cruzada com a amostra da loja.
 * Os números saem como `Rótulo: n`, para não errar o plural com 1.
 */
import type { ProdutoDaAmostra } from './google.js';
import { normalizarItensDoErp, type Listagem } from './routes/erp.js';

export type Veredicto = 'sem-conexao' | 'recusado' | 'inesperado' | 'vazio' | 'sem-amostra' | 'nenhum-id' | 'ok';

export interface ResultadoTeste {
  veredicto: Veredicto;
  mensagem: string;
  recebidos?: number;
  amostra?: number;
  encontrados?: number;
  saldosComparados?: number;
  saldosIguais?: number;
  alertaSaldos?: boolean;
}

const SEM_CONEXAO =
  'Não consegui falar com o ERP. Tente de novo em alguns minutos. Isto não diz se o hash está certo.';
const RECUSADO =
  'Hash provavelmente errado: o ERP recusou a consulta. Pegue o HashLoja de novo no painel do Nuvem3.';
const INESPERADO = 'Resposta inesperada do ERP. Tente de novo; se repetir, avise o administrador.';
const VAZIO =
  'Hash provavelmente errado: o ERP não devolveu nenhum produto. Pegue o HashLoja de novo no painel do Nuvem3. (Uma loja sem estoque no ERP aparece igual.)';
const ALERTA = ' Os saldos não batem com o último Buscar; confira se este hash é mesmo desta loja.';

/**
 * Porte de `chavesDeIdProduto` (packages/shared/src/produto.ts), que também tem cópia no `chaves`
 * de scripts/diagnosticar-erp.mts: mudou lá, muda aqui. A API não importa o `@themis/shared`.
 */
export function chavesDoId(valor: unknown): string[] {
  if (valor === null || valor === undefined) return [];

  const cru = String(valor).trim();
  if (cru === '') return [];

  const chaves = new Set<string>([cru]);

  const numero = Number(cru);
  if (Number.isFinite(numero)) chaves.add(String(numero));

  return [...chaves];
}

export function veredictoDoTeste(listagem: Listagem, amostra: readonly ProdutoDaAmostra[]): ResultadoTeste {
  if (listagem.tipo === 'sem-conexao') return { veredicto: 'sem-conexao', mensagem: SEM_CONEXAO };
  if (listagem.tipo === 'recusa') return { veredicto: 'recusado', mensagem: RECUSADO };
  if (listagem.tipo === 'inesperado') return { veredicto: 'inesperado', mensagem: INESPERADO };

  const recebidos = listagem.itens.length;
  if (recebidos === 0) return { veredicto: 'vazio', mensagem: VAZIO, recebidos };

  const { itens } = normalizarItensDoErp(listagem.itens);
  if (itens.length === 0) return { veredicto: 'inesperado', mensagem: INESPERADO, recebidos };

  if (amostra.length === 0) {
    return {
      veredicto: 'sem-amostra',
      mensagem: `O ERP respondeu (produtos devolvidos: ${recebidos}), mas esta loja ainda não tem produtos para conferir. Importe a planilha e teste de novo.`,
      recebidos,
    };
  }

  // Como `buscarEstoqueDoErp` do site: cada item grava todas as suas chaves, e a última ocorrência vence.
  const noErp = new Map<string, number>();
  for (const item of itens) for (const chave of chavesDoId(item.idProduto)) noErp.set(chave, item.quantidade);

  let encontrados = 0;
  let comparados = 0;
  let iguais = 0;
  for (const p of amostra) {
    // Primeiro acerto, como `saldoNoErp`.
    const saldo = chavesDoId(p.idProduto).map((c) => noErp.get(c)).find((v) => v !== undefined);
    if (saldo === undefined) continue;
    encontrados++;
    if (typeof p.estoqueSistema !== 'number' || (saldo === 0 && p.estoqueSistema === 0)) continue;
    comparados++;
    if (saldo === p.estoqueSistema) iguais++;
  }

  if (encontrados === 0) {
    return {
      veredicto: 'nenhum-id',
      mensagem: `Nenhum produto da loja aparece no ERP. Produtos da loja conferidos: ${amostra.length}; devolvidos pelo ERP: ${recebidos}. O hash pode ser de outra conta do ERP, ou a planilha tem IDs errados.`,
      recebidos,
      amostra: amostra.length,
      encontrados,
    };
  }

  // Só alerta: o estoque muda com o tempo, e o saldo guardado vem do último Buscar ou da importação.
  // Um par zerado nos dois lados ficou fora da conta porque não diz de que loja é o hash.
  const alertaSaldos = comparados >= 5 && iguais < 0.2 * comparados;
  const saldos =
    comparados > 0 ? ` Saldos iguais ao guardado no Themis (último Buscar ou importação): ${iguais} de ${comparados}.` : '';
  return {
    veredicto: 'ok',
    mensagem:
      `Hash ok. Produtos devolvidos pelo ERP: ${recebidos}. Produtos da loja conferidos: ${amostra.length}; achados na lista: ${encontrados}.` +
      saldos +
      (alertaSaldos ? ALERTA : ''),
    recebidos,
    amostra: amostra.length,
    encontrados,
    saldosComparados: comparados,
    saldosIguais: iguais,
    alertaSaldos,
  };
}
