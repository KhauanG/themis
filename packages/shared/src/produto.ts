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
