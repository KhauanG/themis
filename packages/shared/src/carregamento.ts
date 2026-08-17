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

/**
 * Quanto esperar pelo servidor antes de liberar com o que veio do cache.
 *
 * Vale para coleções pequenas — a lista de estoques são algumas dezenas de documentos, e
 * 8s é folga larga. Para os produtos existe um teto próprio, bem maior: ver abaixo.
 */
export const ESPERA_SERVIDOR_MS = 8_000;

/**
 * Teto de espera para a lista de **produtos**.
 *
 * Muito maior que o dos estoques, e de propósito. Conciliar um catálogo de milhares de
 * documentos em wifi de loja passa de 8s com folga — e soltar a tela no meio devolve
 * exatamente o problema que este módulo existe para resolver: a lista aparece com os
 * produtos de uma importação anterior misturados aos atuais, o funcionário vê item
 * duplicado, e a confiança na contagem inteira vai junto.
 *
 * O custo de esperar é baixo e o de errar é alto. A tela de contagem fica aberta por horas;
 * 25 segundos na abertura não pesam perto de uma contagem que ninguém acredita.
 *
 * ⚠️ Isto **não** atrasa quem está offline: `podeLiberarTela` libera na hora quando não há
 * conexão, porque aí o snapshot do servidor não vem mesmo e segurar impediria a contagem
 * offline — que é o motivo de o cache existir.
 */
export const ESPERA_CONCILIACAO_MS = 25_000;

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
