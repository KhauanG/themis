/**
 * Detecção de conectividade.
 *
 * `navigator.onLine` só diz se existe interface de rede — responde `true` num wifi de
 * loja que não passa tráfego. E rede lenta é pior que rede ausente: offline o app detecta
 * e enfileira; lenta ele se acha online e espera para sempre.
 *
 * Por isso a ordem de confiança é:
 *  1. Resultado real da última operação Firestore (janela de 30s). É a única evidência de
 *     que o servidor que importa está respondendo.
 *  2. `navigator.onLine` como negativo forte — se ele diz offline, está offline.
 *  3. Probe HTTP como desempate. Fica por último porque `generate_204` é bloqueado em
 *     muita rede de loja e produzia falso-offline e, pior, falso-online.
 *
 * Porte de `app.js::checkRealConnectivity` (4.19.8).
 */
import { lastServerFailAt, lastServerOkAt } from './firestore-write.js';

/** Janela em que o sinal do Firestore ainda é considerado fresco. */
const JANELA_SINAL_MS = 30_000;
const TIMEOUT_PROBE_MS = 5_000;
const INTERVALO_VERIFICACAO_MS = 15_000;

const PROBES = [
  'https://www.gstatic.com/generate_204',
  'https://clients3.google.com/generate_204',
];

async function probeHttp(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_PROBE_MS);
  try {
    for (const url of PROBES) {
      try {
        // `no-cors` devolve resposta opaca: não dá para ler o status, mas a promise só
        // resolve se a requisição saiu e voltou. É o suficiente aqui.
        await fetch(`${url}?_=${Date.now()}`, {
          method: 'GET',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal,
        });
        return true;
      } catch {
        // tenta o próximo
      }
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Verifica conectividade real. Consulta o Firestore antes de recorrer a probe externo. */
export async function verificarConexao(): Promise<boolean> {
  if (!navigator.onLine) return false;

  const agora = Date.now();
  const ok = lastServerOkAt();
  const falha = lastServerFailAt();

  const okFresco = ok > 0 && agora - ok < JANELA_SINAL_MS;
  const falhaFresca = falha > 0 && agora - falha < JANELA_SINAL_MS;

  // Sinal fresco do Firestore vence qualquer probe: é o servidor que o app precisa.
  if (okFresco || falhaFresca) return ok >= falha;

  return probeHttp();
}

export type OuvinteConexao = (online: boolean) => void;

/**
 * Monitora a conexão e chama o ouvinte só quando o estado muda.
 * Devolve a função de parada.
 */
export function monitorarConexao(aoMudar: OuvinteConexao): () => void {
  let estadoAtual = navigator.onLine;
  let parado = false;

  const avaliar = async () => {
    if (parado) return;
    const online = await verificarConexao();
    if (parado || online === estadoAtual) return;
    estadoAtual = online;
    aoMudar(online);
  };

  const aoVoltar = () => void avaliar();
  const aoCair = () => {
    if (estadoAtual) {
      estadoAtual = false;
      aoMudar(false);
    }
  };
  const aoFicarVisivel = () => {
    if (document.visibilityState === 'visible') void avaliar();
  };

  window.addEventListener('online', aoVoltar);
  window.addEventListener('offline', aoCair);
  document.addEventListener('visibilitychange', aoFicarVisivel);
  const intervalo = setInterval(() => void avaliar(), INTERVALO_VERIFICACAO_MS);

  void avaliar();

  return () => {
    parado = true;
    clearInterval(intervalo);
    window.removeEventListener('online', aoVoltar);
    window.removeEventListener('offline', aoCair);
    document.removeEventListener('visibilitychange', aoFicarVisivel);
  };
}
