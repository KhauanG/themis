/**
 * Inscrição no Firestore que se refaz sozinha.
 *
 * ## O problema
 *
 * `onSnapshot` **encerra a inscrição** quando chama o callback de erro. Não reabre, não
 * tenta de novo, não avisa mais nada. Falhas de rede comuns o SDK resolve sozinho por
 * baixo; o callback de erro só dispara no que ele considera definitivo —
 * `permission-denied`, `unauthenticated` (token que não renovou a tempo numa rede ruim),
 * `resource-exhausted` (cota).
 *
 * Até aqui os quatro listeners do app só registravam no console e desistiam. A partir daí
 * o aparelho parava de receber qualquer atualização: a tela continuava mostrando o que
 * tinha, sem nenhum sinal de que estava congelada. O sintoma relatado em campo foi
 * exatamente esse — **"os usuários têm que reabrir o app"**. Reabrir remonta os efeitos,
 * cria inscrições novas, e tudo volta.
 *
 * ## Por que reabrir só quando morreu
 *
 * A tentação é reinscrever toda vez que o app volta do plano de fundo. Sai caro: cada
 * inscrição nova pode cobrar a releitura da coleção, e um catálogo de milhares de produtos
 * viraria milhares de leituras cada vez que alguém troca de aplicativo no celular.
 *
 * E é desnecessário: enquanto a inscrição está viva, o SDK já reconecta sozinho. Por isso
 * `visibilitychange` e `online` só disparam a reabertura se ela **já caiu** — o que se sabe
 * com precisão, porque é o próprio callback de erro que marca.
 */

import { deveAvisar, esperaDeReconexao } from '@themis/shared';

export type Desinscrever = () => void;

export interface OpcoesAssinatura {
  /** Aparece no console. Use o nome da coleção. */
  label: string;
  /**
   * Chamado quando a inscrição cai e **continua** caindo. Serve para a tela dizer que os
   * dados podem estar velhos — sem isso, o congelamento é invisível.
   */
  aoPerderContato?: (erro: unknown) => void;
  /** Chamado quando volta a funcionar depois de ter avisado. */
  aoRecuperar?: () => void;
}

/**
 * Mantém uma inscrição de pé.
 *
 * `abrir` recebe duas funções e devolve a de desinscrever:
 *
 * - `viva` — chame no callback de snapshot. É o que zera o backoff e desfaz o aviso de
 *   contato perdido. Sem ela, a inscrição reabre mas o app continua achando que está caída.
 * - `falhou` — passe direto como callback de erro do `onSnapshot`.
 *
 * ```ts
 * assinaturaResiliente(
 *   (viva, falhou) => onSnapshot(ref, (snap) => { viva(); aoMudar(snap); }, falhou),
 *   { label: 'produtos' },
 * );
 * ```
 */
export function assinaturaResiliente(
  abrir: (viva: () => void, falhou: (erro: unknown) => void) => Desinscrever,
  { label, aoPerderContato, aoRecuperar }: OpcoesAssinatura,
): Desinscrever {
  let parado = false;
  let fechar: Desinscrever | null = null;
  let falhasSeguidas = 0;
  let avisou = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** O primeiro snapshot depois de uma queda: zera o backoff e desfaz o aviso. */
  function marcarViva(): void {
    if (falhasSeguidas === 0 && !avisou) return;
    falhasSeguidas = 0;
    if (avisou) {
      avisou = false;
      aoRecuperar?.();
    }
  }

  function reabrir(): void {
    if (parado) return;
    clearTimeout(timer);
    fechar?.();

    fechar = abrir(marcarViva, (erro) => {
      // O `onSnapshot` já se encerrou ao chamar isto. Guardar a função de desinscrever
      // seria guardar algo morto — e chamá-la depois esconderia o problema.
      fechar = null;
      if (parado) return;

      falhasSeguidas++;
      const espera = esperaDeReconexao(falhasSeguidas);
      console.warn(
        `[${label}] Inscrição caiu (${falhasSeguidas}ª vez). Refazendo em ${espera / 1000}s.`,
        erro,
      );

      if (deveAvisar(falhasSeguidas) && !avisou) {
        avisou = true;
        aoPerderContato?.(erro);
      }

      timer = setTimeout(reabrir, espera);
    });
  }

  /*
    Volta da rede e volta do plano de fundo são os dois momentos em que a inscrição costuma
    estar morta. Só reabre se realmente caiu (`fechar === null`) — reinscrever uma inscrição
    viva custaria releitura da coleção a cada troca de aplicativo no celular.
  */
  function aoAcordar(): void {
    if (parado || fechar !== null) return;
    if (document.visibilityState !== 'visible') return;
    falhasSeguidas = 0;
    reabrir();
  }

  document.addEventListener('visibilitychange', aoAcordar);
  window.addEventListener('online', aoAcordar);

  reabrir();

  return () => {
    parado = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', aoAcordar);
    window.removeEventListener('online', aoAcordar);
    fechar?.();
    fechar = null;
  };
}
