/**
 * Payload de atualização de estoque do ERP (Nuvem3).
 *
 * Mora no pacote compartilhado porque é **contrato**, e contrato precisa de teste. Enquanto
 * vivia dentro de `lib/erp.ts` no app web, nenhum teste o alcançava — aquele módulo importa
 * o SDK do Firebase e exige variáveis de ambiente para carregar. Foi assim que o payload
 * divergiu do Themis 1.x sem ninguém perceber: metade dos campos faltando e o `IdProduto`
 * indo como texto onde o ERP espera inteiro.
 *
 * A referência é o `sendToERP` do 1.x, que rodou anos em produção. Ele é a única prova que
 * temos do que a API aceita.
 */
import type { Produto } from './types.js';
import { fisicoDe, idProdutoDe, nomeDe } from './produto.js';

/** Os oito campos, com os tipos que o 1.x enviava. */
export interface EnvioEstoque {
  /** Inteiro. O 1.x fazia `parseInt` antes de enviar; API .NET recusa `"123"` num `int`. */
  IdProduto: number;
  HashLoja: string;
  /** Inteiro, nunca negativo. */
  Quantidade: number;
  /** Pode ser vazio: produto sem código de barras existe e o 1.x enviava assim mesmo. */
  CodigoBarras: string;
  NomeProduto: string;
  EstoqueMinimo: number;
  PrecoVenda: number;
  PrecoCusto: number;
}

/** Preço com duas casas, tolerando vírgula decimal. Mesma conversão do 1.x. */
function preco(valor: unknown): number {
  const n =
    typeof valor === 'string' ? Number.parseFloat(valor.replace(',', '.')) : Number(valor ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * Monta o payload a partir do produto.
 *
 * `quantidade` sobrescreve o físico do produto: o reenvio de pendências manda **o valor
 * enviado na primeira vez**, não o atual — é aquele que precisa entrar no ERP.
 *
 * Nunca monte o objeto à mão no lugar de chamar isto. Foi exatamente assim que os campos
 * se perderam.
 */
export function montarEnvio(
  produto: Produto,
  hashLoja: string,
  quantidade: number = fisicoDe(produto),
): EnvioEstoque {
  return {
    IdProduto: Number.parseInt(String(idProdutoDe(produto) ?? 0), 10) || 0,
    HashLoja: hashLoja.trim(),
    // Fracionário o ERP recusa; negativo o 1.x grampeava em zero.
    Quantidade: Math.max(0, Math.round(Number(quantidade) || 0)),
    CodigoBarras: String(produto.codigoBarras ?? produto.CodigoBarras ?? '').trim(),
    NomeProduto: nomeDe(produto),
    // A Nuvem3 pede o campo; o 1.x sempre mandou 0 e o Themis não gerencia estoque mínimo.
    EstoqueMinimo: 0,
    PrecoVenda: preco(produto.PrecoVenda ?? produto.precoVenda),
    PrecoCusto: preco(produto.PrecoCusto ?? produto.precoCusto),
  };
}
