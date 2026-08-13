/**
 * Quando a lista de produtos pode ser mostrada como verdade.
 *
 * ## O bug que isto existe para não repetir
 *
 * O Firestore roda com cache persistente (`persistentLocalCache`). Isso significa que
 * `onSnapshot` dispara **duas vezes** ao abrir o app: primeiro com o que está guardado no
 * aparelho, depois com o que o servidor tem. O primeiro disparo chega em milissegundos e
 * traz dados que podem estar dias atrasados.
 *
 * O app tratava esse primeiro disparo como final: baixava a tela de carregamento e
 * liberava o usuário. Quando alguém apagava o estoque e reimportava a planilha, os produtos
 * ganhavam IDs novos — e o aparelho que ainda tinha os IDs antigos no cache mostrava os
 * dois conjuntos ao mesmo tempo. O sintoma em campo: **itens duplicados e contagem maior do
 * que o estoque tem, que somem ao recarregar**.
 *
 * Some ao recarregar porque, no segundo acesso, o cache já foi reconciliado.
 *
 * ## Por que não é só "esperar o servidor"
 *
 * Segurar a tela até o servidor responder quebraria a contagem offline, que é o motivo de
 * o cache existir. E rede lenta é pior que rede ausente: offline o app detecta na hora;
 * lenta ele se acha online e esperaria para sempre — o mesmo raciocínio de
 * `firestore-write.ts`.
 *
 * Daí a decisão ter três entradas, e não uma.
 */

/** Quanto esperar pelo servidor antes de liberar com o que veio do cache. */
export const ESPERA_SERVIDOR_MS = 8_000;

export interface EstadoDoSnapshot {
  /** O snapshot veio do cache local, sem confirmação do servidor. */
  doCache: boolean;
  /** O aparelho acredita estar online. */
  online: boolean;
  /** O teto de espera estourou. */
  esgotou: boolean;
}

/**
 * A tela pode ser liberada para o usuário?
 *
 * | Situação | Libera | Por quê |
 * |---|---|---|
 * | Snapshot do servidor | sim | é a verdade |
 * | Cache, offline | sim | o servidor não vem; segurar impediria contar offline |
 * | Cache, online, dentro do teto | **não** | o snapshot do servidor está a caminho |
 * | Cache, online, teto estourado | sim | melhor dado velho que tela travada |
 *
 * A terceira linha é a única que muda o comportamento antigo — e é a que corrige o bug.
 */
export function podeLiberarTela({ doCache, online, esgotou }: EstadoDoSnapshot): boolean {
  if (!doCache) return true;
  if (!online) return true;
  return esgotou;
}
