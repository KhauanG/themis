/**
 * Identidade do build que está rodando.
 *
 * Os três valores são injetados pelo Vite (`define` em `vite.config.ts`) na hora de compilar
 * — não há leitura de arquivo nem chamada de rede em runtime.
 *
 * ## Por que um PWA precisa disso na tela
 *
 * O service worker guarda a versão anterior no aparelho e troca no carregamento seguinte.
 * Quando alguém diz "o problema continua", a primeira pergunta é **qual build está no
 * celular dele** — e sem um número visível não há como responder. Com o app antigo isso
 * vinha da Play Store; aqui, vem daqui.
 */

declare const __VERSAO__: string;
declare const __COMMIT__: string;
declare const __DATA_BUILD__: string;

export const VERSAO = __VERSAO__;

/** SHA curto do commit. `desconhecido` quando o build não saiu de um repositório git. */
export const COMMIT = __COMMIT__;

/** ISO do momento da compilação. */
export const DATA_BUILD = __DATA_BUILD__;

/** `2.7.0 · a1b2c3d` — o que aparece no rodapé do menu. */
export const VERSAO_COMPLETA = `${VERSAO} · ${COMMIT}`;

/** `06/08/2026 19:40`, no fuso do aparelho. */
export function dataBuildLegivel(): string {
  const d = new Date(DATA_BUILD);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
