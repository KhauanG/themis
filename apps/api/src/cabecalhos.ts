/**
 * Cabeçalhos de segurança das respostas.
 *
 * Existiam em `apps/web/public/.htaccess`, mas **nunca foram aplicados**: na Hostinger o
 * Node serve o site direto, sem Apache na frente. O arquivo ficou no repositório para o dia
 * em que houver servidor web na frente; até lá, quem precisa mandar os cabeçalhos é o
 * Fastify.
 *
 * ## Em duas etapas, nunca em uma
 *
 * Os cinco primeiros são inofensivos e entram bloqueando. O **CSP entra em
 * `Report-Only`**: ele não bloqueia nada, só relata no console o que *teria* bloqueado. Um
 * CSP estrito demais quebra o app inteiro, para todo mundo, na hora — e o Themis carrega
 * Firebase, worker do PWA, `blob:` para leitor de código de barras e exportação de arquivo.
 * Adivinhar a lista certa de uma vez é como acertar na loteria.
 *
 * Para promover a bloqueio de verdade: usar o app um ou dois dias, olhar o console, e trocar
 * `MODO_RELATO` para `false`. Ver docs/pendencias.md §2.
 */
import type { FastifyInstance } from 'fastify';
import { config } from './config.js';

/**
 * `true` = o CSP só relata. Trocar para `false` só depois de o console ficar limpo em uso
 * real — contagem, leitor de código de barras, exportação de PDF e planilha.
 */
const MODO_RELATO = true;

/**
 * Origens que o app precisa alcançar.
 *
 * `connect-src` é a lista mais frágil: qualquer domínio do Firebase que falte derruba a
 * sincronização, e o sintoma é o app "não salvar" sem erro visível.
 */
const CSP = [
  "default-src 'self'",
  // O Vite injeta o registro do service worker inline; sem `unsafe-inline` o PWA não
  // instala. Estilo idem, por causa dos estilos calculados em runtime.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // `blob:` cobre o vídeo do leitor de código de barras e os arquivos gerados na
  // exportação; `data:` cobre os ícones embutidos.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  [
    'connect-src',
    "'self'",
    'https://*.googleapis.com',
    'https://*.firebaseio.com',
    'https://*.google.com',
    'wss://*.firebaseio.com',
  ].join(' '),
  // Nenhum plugin, nenhum `<base>` injetado, nenhum formulário para fora.
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Clickjacking. Equivalente moderno do `X-Frame-Options: DENY`.
  "frame-ancestors 'none'",
].join('; ');

export function registrarCabecalhos(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    // Impede o navegador de adivinhar o tipo do arquivo e executar como script algo que
    // servimos como texto.
    reply.header('X-Content-Type-Options', 'nosniff');

    // Não vaza a URL completa (que carrega id de estoque) para sites externos.
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    // A câmera é usada pelo leitor de código de barras; o resto não tem uso aqui.
    reply.header('Permissions-Policy', 'camera=(self), geolocation=(), microphone=()');

    /**
     * O risco real que isto fecha: hoje qualquer site pode embutir o Themis num iframe
     * invisível e induzir um funcionário **já logado** a clicar em "Limpar contagem"
     * achando que clica noutra coisa. Custo zero, porque o Themis nunca é embutido.
     */
    reply.header('X-Frame-Options', 'DENY');

    reply.header(
      MODO_RELATO ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
      CSP,
    );

    /**
     * HSTS só em produção e **só sobre HTTPS**.
     *
     * Mandar em desenvolvimento trancaria `localhost` em HTTPS no navegador do
     * desenvolvedor, e desfazer isso exige limpar estado do navegador — dor por nada.
     * `max-age` de um ano é o valor usual; note que ele é difícil de desfazer depois de
     * publicado, porque o navegador respeita o prazo que já recebeu.
     */
    if (config.isProd && req.protocol === 'https') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    return payload;
  });
}
