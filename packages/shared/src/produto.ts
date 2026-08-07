/**
 * Normalização dos campos duplicados do produto.
 *
 * O banco legado guarda o mesmo dado em duas grafias, dependendo de o produto
 * ter vindo da importação do ERP ou do cadastro manual. Toda leitura de produto
 * passa por aqui — nenhum outro módulo deve tocar nos campos crus.
 */
import type { Produto, ProductStatus } from './types.js';

/** Nome exibível do produto. */
export function nomeDe(p: Produto): string {
  return p.nome || p.NomeProduto || 'Sem nome';
}

/** Identificador do produto no ERP. */
export function idProdutoDe(p: Produto): string | number | null {
  return p.IdProduto ?? p.idProduto ?? null;
}

export function codigoBarrasDe(p: Produto): string | null {
  return p.codigoBarras ?? p.CodigoBarras ?? null;
}

/**
 * Formas em que o `IdProduto` pode aparecer, para casar com a listagem do ERP.
 *
 * O mesmo identificador vem ora como número, ora como texto, ora com zeros à esquerda —
 * `"007"`, `"7"` e `7` são o mesmo produto. Comparar só a forma crua faz o app achar que
 * metade do estoque não existe no ERP.
 */
export function chavesDeIdProduto(valor: unknown): string[] {
  if (valor === null || valor === undefined) return [];

  const cru = String(valor).trim();
  if (cru === '') return [];

  const chaves = new Set<string>([cru]);

  const numero = Number(cru);
  if (Number.isFinite(numero)) chaves.add(String(numero));

  return [...chaves];
}

/**
 * Saldo do produto na leitura do ERP, ou `undefined` se o ERP não o conhece.
 *
 * **Única forma correta de consultar o mapa do ERP.** `estoque.get(String(id))` erra:
 * `String(7)` é `"7"` e não alcança a entrada `"007"`, e o produto vira "sem
 * correspondência" — desaparece da correção sem que ninguém veja.
 */
export function saldoNoErp(
  estoqueErp: ReadonlyMap<string, number>,
  p: Produto,
): number | undefined {
  for (const chave of chavesDeIdProduto(idProdutoDe(p))) {
    const valor = estoqueErp.get(chave);
    if (valor !== undefined) return valor;
  }
  return undefined;
}

/**
 * O produto não está na listagem da loja no ERP.
 *
 * Marcado por `atualizarEstoqueSistema` a cada "Buscar estoque". Enquanto vale, o
 * `estoqueSistema` guardado é o da última importação — número que o ERP **não** confirmou.
 * Por isso o produto sai da contagem e do cálculo de divergência: contar contra um valor
 * não confirmado produz divergência inventada, e é ela que vai parar no relatório impresso.
 *
 * Causas: produto de outra loja, inativado no ERP, ou `IdProduto` divergente. Todas se
 * resolvem no cadastro do Nuvem3, não no Themis.
 */
export function foraDoErp(p: Produto): boolean {
  return p.apiNotFound === true;
}

/**
 * Saldo que o ERP atribui ao produto, já resolvida a ausência.
 *
 * **A regra mora aqui e em nenhum outro lugar.** Ela é aplicada em dois momentos distantes
 * — ao gravar `estoqueSistema` e ao montar o diagnóstico da correção — e duas cópias de uma
 * regra acabam divergindo. No Themis 1.x foi exatamente assim que o cálculo de status
 * passou a nunca devolver `CRITICO` numa das telas.
 *
 * `omiteZerados` vem da resposta do ERP: quando a listagem só traz saldo positivo, produto
 * ausente está **zerado**, não desconhecido. Quando a listagem traz zeros, ausente é
 * ausente mesmo — o produto não está no estoque daquela loja.
 *
 * `undefined` significa "o ERP não sabe deste produto", e é o que mantém o item fora da
 * correção: sem saldo do ERP, a única comparação possível seria contra o valor da última
 * importação.
 */
export function saldoDoErpPara(
  estoqueErp: ReadonlyMap<string, number>,
  p: Produto,
  omiteZerados: boolean,
): number | undefined {
  const naListagem = saldoNoErp(estoqueErp, p);
  if (naListagem !== undefined) return naListagem;
  return omiteZerados ? 0 : undefined;
}

/**
 * Estoque físico: o que o funcionário contou.
 * `quantidade` tem precedência; `estoqueFisico` é o campo legado.
 * Atenção: `quantidade: 0` é contagem válida — só cai no fallback se for null/undefined.
 */
export function fisicoDe(p: Produto): number {
  return p.quantidade !== undefined && p.quantidade !== null ? p.quantidade : p.estoqueFisico || 0;
}

/** Estoque do sistema (ERP). */
export function sistemaDe(p: Produto): number {
  return p.estoqueSistema ?? p.EstoqueAtual ?? 0;
}

export function statusContagemDe(p: Produto): ProductStatus | null {
  return p.productStatus ?? null;
}

/**
 * Item contado neste ciclo.
 * `CONFERIDO` conta como contado: é um item que passou pela correção do admin.
 */
export function isItemContado(p: Produto): boolean {
  const status = statusContagemDe(p);
  return status === 'ATUALIZADO' || status === 'CONFERIDO';
}

/** Data de validade normalizada (`YYYY-MM-DD`) ou null se ausente/malformada. */
export function validadeDe(p: Produto): string | null {
  const v = p.dataValidade;
  if (!v || typeof v !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
