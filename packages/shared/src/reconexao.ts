/**
 * Ritmo das retentativas de uma inscrição em tempo real que caiu.
 *
 * Mora aqui, e não junto do código que usa, por dois motivos. O primeiro é que a mecânica
 * de reconexão depende de `document` e `window`, que não existem no ambiente de teste — os
 * números ficariam sem cobertura. O segundo é que são exatamente os números que quebram em
 * silêncio: uma espera que não cresce vira martelo no Firestore, e uma que cresce sem teto
 * deixa o aparelho mudo por horas. Nos dois casos nada estoura, nada aparece no console, e
 * o sintoma chega semanas depois como "o app às vezes congela".
 */

/** Espera antes da primeira retentativa. Dobra a cada falha seguida. */
export const ESPERA_BASE_MS = 1_000;

/** Teto da espera. Alcançado ele, tenta de minuto em minuto, para sempre. */
export const ESPERA_MAXIMA_MS = 60_000;

/**
 * Falhas seguidas antes de avisar o usuário.
 *
 * Três porque as duas primeiras costumam ser a mesma rede de loja oscilando. Avisar nelas
 * transformaria instabilidade normal em alarme — e alarme que toca à toa é alarme que a
 * equipe aprende a ignorar, inclusive quando é de verdade.
 */
export const FALHAS_ATE_AVISAR = 3;

/**
 * Quanto esperar antes da próxima tentativa.
 *
 * `falhasSeguidas` começa em 1 na primeira falha. Zero ou negativo devolve a base — é
 * chamada defensiva, não um caso real.
 */
export function esperaDeReconexao(falhasSeguidas: number): number {
  const expoente = Math.max(0, Math.floor(falhasSeguidas) - 1);
  return Math.min(ESPERA_BASE_MS * 2 ** expoente, ESPERA_MAXIMA_MS);
}

/** Já falhou o bastante para valer a pena interromper o usuário? */
export function deveAvisar(falhasSeguidas: number): boolean {
  return falhasSeguidas >= FALHAS_ATE_AVISAR;
}
