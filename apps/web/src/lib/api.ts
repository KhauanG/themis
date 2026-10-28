import type { User } from 'firebase/auth';
import { auth } from './firebase.js';

/**
 * Endereço base da API.
 *
 * Padrão `/api`: mesma origem, sem CORS e sem preflight. Em desenvolvimento o Vite faz
 * proxy para `localhost:3000`.
 *
 * Na Hostinger, se o app Node ficar num subdomínio próprio (`api.seudominio.com`) em vez
 * de atrás do mesmo domínio, defina `VITE_API_URL` no build — e lembre de incluir a
 * origem do PWA em `CORS_ORIGINS` na API, senão o navegador bloqueia a resposta.
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');

export function urlApi(caminho: string): string {
  return `${API_BASE}${caminho.startsWith('/') ? caminho : `/${caminho}`}`;
}

export const MENSAGEM_SESSAO = 'Sua sessão expirou. Entre de novo.';

const sessaoPerdida = (): Response =>
  new Response(JSON.stringify({ ok: false, erro: MENSAGEM_SESSAO }), { status: 401 });

/** `null` = sessão perdida (sem usuário ou token recusado); só falha de rede relança. */
async function pedirToken(usuario: User | null, forcar: boolean): Promise<string | null> {
  if (!usuario) return null;
  try {
    return await usuario.getIdToken(forcar);
  } catch (e) {
    if ((e as { code?: unknown }).code === 'auth/network-request-failed') throw e;
    return null;
  }
}

// Token pedido a cada chamada: o Corrigir pode passar de 20 min e o token dura 1 h.
// O SDK só renova sozinho com 30 s de vida ou menos (`Buffer.TOKEN_REFRESH`), por isso o 401 força a renovação.
export async function chamarApi(
  caminho: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
): Promise<Response> {
  // Ao abrir a página o usuário ainda não foi restaurado.
  await auth.authStateReady();
  const usuario = auth.currentUser;
  const enviar = async (forcar: boolean): Promise<Response | null> => {
    const token = await pedirToken(usuario, forcar);
    if (token === null) return null;
    // DELETE com Content-Type JSON e corpo vazio dá 400 na Fastify.
    const json: Record<string, string> = init.body != null ? { 'Content-Type': 'application/json' } : {};
    return fetch(urlApi(caminho), {
      ...init,
      headers: { ...init.headers, ...json, Authorization: `Bearer ${token}` },
    });
  };
  const primeira = await enviar(false);
  if (!primeira) return sessaoPerdida();
  if (primeira.status !== 401) return primeira;
  return (await enviar(true)) ?? sessaoPerdida();
}
