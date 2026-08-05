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
