/**
 * Identificação do dispositivo.
 *
 * Usada em `modifiedBy` nos produtos e no histórico, para saber qual aparelho gravou o
 * quê quando 4-5 celulares contam o mesmo estoque ao mesmo tempo.
 */
import { CHAVES, gravar, ler } from './armazenamento.js';

function gerarId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let _deviceId: string | null = null;

export function deviceId(): string {
  if (_deviceId) return _deviceId;

  const guardado = ler<string | null>(CHAVES.dispositivo, null);
  if (guardado && typeof guardado === 'string') {
    _deviceId = guardado;
    return _deviceId;
  }

  _deviceId = gerarId();
  gravar(CHAVES.dispositivo, _deviceId);
  return _deviceId;
}

/** Rótulo legível para o histórico. Melhor esforço — user agent mente. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const plataforma = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac/i.test(ua)
          ? 'Mac'
          : 'Desconhecido';

  const modelo = /Android[^;]*;\s*([^)]+?)\s*(?:Build|\))/i.exec(ua)?.[1]?.trim();
  const sufixo = deviceId().slice(0, 6);

  return modelo ? `${plataforma} ${modelo} (${sufixo})` : `${plataforma} (${sufixo})`;
}
