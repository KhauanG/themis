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
 * O Finalizar não limpa o lote: ele só sobe o `contagemCycle`, e o carimbo deixa de bater.
 * Desde a 2.18, o ramo restrito da regra aceita também `lote` e `loteCiclo` (`hasOnly` com
 * seis campos, `firestore/firestore.rules:197-198`), então limpar passaria. O carimbo ficou
 * porque dispensa escrita a mais no payload do Finalizar.
 *
 * Por isso o texto do lote velho continua no documento depois de finalizar, e quem lê o
 * lote aplica o `loteAtivo`.
 */
import type { Inventory } from './types.js';

/** Limite do rótulo. É o da regra: `lote.size() <= 40` (`firestore/firestore.rules:107` e `:205`). */
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
 * Como a rodada aparece na tela: `Lote X` com lote ativo, senão `Sem lote`.
 *
 * O `contagemCycle` é contador interno e não vai à tela. Vale o carimbo, não a presença do
 * texto: o lote vencido continua no documento depois de finalizar.
 */
export function rotuloDaRodada(
  estoque: Pick<Inventory, 'lote' | 'loteCiclo' | 'contagemCycle'> | null,
): string {
  const lote = loteDe(estoque);
  return lote ? `Lote ${lote}` : 'Sem lote';
}

/** Mesma regra para uma auditoria já salva, que guarda o lote junto. O contador interno não vai à tela. */
export function rotuloDaAuditoria(auditoria: { lote?: string | null }): string {
  const lote = (auditoria.lote ?? '').trim();
  return lote ? `Lote ${lote}` : 'Sem lote';
}

/**
 * Rótulo da rodada durante a transição de Ciclo para Lote.
 *
 * `mostrarCiclo` vem de `appSettings` e nasce **ligado**. Enquanto estiver assim, a rodada
 * aparece como `Lote X · Ciclo N` — as duas referências juntas, porque quem procura uma
 * contagem da semana passada ainda tem o número do ciclo na cabeça ou no papel.
 *
 * Desligado, sobra só o lote. Auditoria antiga, que não tem lote, **continua mostrando o
 * ciclo mesmo assim**: é a única identificação que ela possui, e escondê-la deixaria a
 * linha sem nome.
 */
export function rotuloDaRodadaCompleto(
  estoque: Pick<Inventory, 'lote' | 'loteCiclo' | 'contagemCycle'> | null,
  mostrarCiclo: boolean,
): string {
  const lote = loteDe(estoque);
  if (!lote) return `Ciclo ${estoque?.contagemCycle ?? 1}`;
  return mostrarCiclo ? `Lote ${lote} · Ciclo ${estoque?.contagemCycle ?? 1}` : `Lote ${lote}`;
}

/** Mesma regra para auditoria salva. */
export function rotuloDaAuditoriaCompleto(
  auditoria: { lote?: string | null; contagemCycle: number },
  mostrarCiclo: boolean,
): string {
  const lote = (auditoria.lote ?? '').trim();
  if (!lote) return `Ciclo ${auditoria.contagemCycle}`;
  return mostrarCiclo ? `Lote ${lote} · Ciclo ${auditoria.contagemCycle}` : `Lote ${lote}`;
}

/** Limite do `nome` da auditoria na regra (`firestore/firestore.rules:248`). */
export const MAX_NOME_AUDITORIA = 100;

/**
 * `<estoque> - Lote X` ou `<estoque> - Sem lote`, o `nome` gravado na auditoria.
 *
 * Nenhuma tela mostra o nome, mas a regra nega o Finalizar acima de 100, e o estoque (100)
 * mais o lote (40) passavam disso. O `slice` conta unidades UTF-16, como o `normalizarLote`;
 * o `replace` tira a metade alta de um emoji cortado no meio.
 */
export function nomeDaAuditoria(nomeEstoque: string, lote: string | null): string {
  return `${nomeEstoque} - ${rotuloDaAuditoria({ lote })}`.slice(0, MAX_NOME_AUDITORIA).replace(/[\uD800-\uDBFF]$/, '');
}

const hora = (data: Date) => data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Uma data por item, na mesma ordem: `DD/MM/AAAA`, mais ` HH:MM` quando outro item da lista
 * tem o mesmo lote aparado e a mesma data.
 *
 * O seletor de auditorias não mostra mais o `nome` gravado, e o site duplicava auditoria com
 * dois cliques até a 2.19: sem a hora, duas do mesmo lote e dia ficariam iguais. Os chips, a
 * tabela e o PDF do consolidado usam a mesma data, com o lote em outro lugar.
 */
export function datasDaLista(itens: ReadonlyArray<{ lote?: string | null; data: Date }>): string[] {
  const chave = (i: { lote?: string | null; data: Date }) => `${(i.lote ?? '').trim()}|${i.data.toLocaleDateString('pt-BR')}`;
  const vezes = new Map<string, number>();
  for (const i of itens) vezes.set(chave(i), (vezes.get(chave(i)) ?? 0) + 1);
  return itens.map((i) => {
    const dia = i.data.toLocaleDateString('pt-BR');
    return (vezes.get(chave(i)) ?? 0) > 1 ? `${dia} ${hora(i.data)}` : dia;
  });
}

/** Um texto por auditoria, na mesma ordem: `Lote X — <data>` ou `<data>`, com a `<data>` do `datasDaLista`. */
export function rotulosDoSeletor(auditorias: ReadonlyArray<{ lote?: string | null; data: Date }>): string[] {
  return datasDaLista(auditorias).map((data, n) => {
    const lote = (auditorias[n]?.lote ?? '').trim();
    return lote ? `Lote ${lote} — ${data}` : data;
  });
}

/** `Lote X · salva em <data e hora> · somente leitura` ou `Salva em <data e hora> · somente leitura`. */
export function subtituloDaAuditoriaSalva(auditoria: { lote?: string | null; data: Date }): string {
  const lote = (auditoria.lote ?? '').trim();
  const quando = `${auditoria.data.toLocaleString('pt-BR')} · somente leitura`;
  return lote ? `Lote ${lote} · salva em ${quando}` : `Salva em ${quando}`;
}
