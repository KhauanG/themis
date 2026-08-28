/**
 * Lote da contagem — o rótulo que identifica uma rodada.
 *
 * Substitui o **Ciclo** como referência humana: é o que a equipe digita e pelo qual
 * localiza uma contagem depois. O `contagemCycle` continua existindo por baixo, como
 * contador interno, porque as Security Rules em produção exigem
 * `contagemCycle is number >= 1` ao criar auditoria — tirá-lo obrigaria a publicar regras.
 *
 * ## Como o lote expira sem tocar nas regras
 *
 * O lote guarda o **ciclo em que foi aberto** (`loteCiclo`). Ele vale enquanto esse carimbo
 * bater com o `contagemCycle` corrente.
 *
 * Isso resolve um conflito real: Finalizar é liberado para qualquer usuário, mas
 * `finalizarCiclo` escreve em `inventories` pelo ramo restrito da regra, que aceita
 * **apenas** os quatro campos de ciclo (`hasOnly`). Um `lote: ''` a mais no payload seria
 * negado — é o mesmo formato do bug que o `createdAt` regenerado causou no 1.x.
 *
 * Como finalizar já incrementa o ciclo, o carimbo deixa de bater sozinho e o lote expira.
 * Nenhum campo novo no payload restrito, nenhuma regra publicada.
 */
import type { Inventory } from './types.js';

/** Limite do rótulo. Igual ao `name` do estoque, pelo mesmo motivo: cabe na tela. */
export const MAX_LOTE = 40;

/**
 * Normaliza o que a pessoa digitou.
 *
 * Espaços nas pontas e repetidos somem: "LOTE  12 " e "LOTE 12" são o mesmo lote, e deixar
 * os dois entrarem quebraria justamente a busca que o lote existe para permitir.
 */
export function normalizarLote(bruto: string): string {
  return bruto.trim().replace(/\s+/g, ' ').slice(0, MAX_LOTE);
}

export function loteValido(bruto: string): boolean {
  return normalizarLote(bruto).length > 0;
}

/**
 * O estoque tem lote aberto agora?
 *
 * Exige o rótulo **e** o carimbo do ciclo corrente. Sem o carimbo, um lote de meses atrás
 * continuaria valendo depois de finalizar, e a contagem nova entraria no nome da antiga.
 */
export function loteAtivo(estoque: Pick<Inventory, 'lote' | 'loteCiclo' | 'contagemCycle'> | null): boolean {
  if (!estoque) return false;
  const rotulo = (estoque.lote ?? '').trim();
  if (rotulo === '') return false;
  return estoque.loteCiclo === (estoque.contagemCycle ?? 1);
}

/** O lote em vigor, ou `null` quando não há. */
export function loteDe(
  estoque: Pick<Inventory, 'lote' | 'loteCiclo' | 'contagemCycle'> | null,
): string | null {
  return loteAtivo(estoque) ? ((estoque?.lote ?? '').trim() || null) : null;
}

/**
 * Como a rodada aparece na tela e no nome da auditoria.
 *
 * Cai para "Ciclo N" quando não há lote: o acervo tem auditorias anteriores a esta
 * funcionalidade, e rotulá-las como "Lote —" apagaria a única referência que elas têm.
 */
export function rotuloDaRodada(
  estoque: Pick<Inventory, 'lote' | 'loteCiclo' | 'contagemCycle'> | null,
): string {
  const lote = loteDe(estoque);
  return lote ? `Lote ${lote}` : `Ciclo ${estoque?.contagemCycle ?? 1}`;
}

/** Mesma regra para uma auditoria já salva, que guarda o lote junto. */
export function rotuloDaAuditoria(auditoria: { lote?: string | null; contagemCycle: number }): string {
  const lote = (auditoria.lote ?? '').trim();
  return lote ? `Lote ${lote}` : `Ciclo ${auditoria.contagemCycle}`;
}
