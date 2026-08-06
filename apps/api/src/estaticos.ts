/**
 * Serve o PWA a partir do mesmo processo Node que serve a API.
 *
 * Na Hostinger o app Node é publicado direto do GitHub e atende o domínio inteiro — não
 * há Apache na frente, então o `.htaccess` do build não é lido. Tudo o que ele fazia
 * (rota de SPA e cabeçalhos de cache) precisa acontecer aqui.
 *
 * Mesma origem também significa: nenhum preflight de CORS no caminho da contagem, e
 * `/api` resolve sem configurar `VITE_API_URL`.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** Um ano. Só para arquivo com hash no nome, cujo conteúdo nunca muda. */
const CACHE_IMUTAVEL = 'public, max-age=31536000, immutable';

/**
 * Sempre revalidar. Se o service worker ficar preso em cache, o usuário trava numa
 * versão antiga do app e o deploy por push perde o sentido.
 */
const CACHE_REVALIDAR = 'public, max-age=0, must-revalidate';

const COM_HASH = /\.[0-9a-zA-Z_-]{8,}\.(?:js|css|woff2|png|svg)$/;
const SEMPRE_FRESCO = /(?:sw|registerSW|workbox-[^/\\]*)\.js$|\.webmanifest$|index\.html$/;

/** Na dúvida, revalidar: servir arquivo velho achando que é novo é o pior caso. */
function cacheDe(caminho: string): string {
  if (SEMPRE_FRESCO.test(caminho)) return CACHE_REVALIDAR;
  return COM_HASH.test(caminho) ? CACHE_IMUTAVEL : CACHE_REVALIDAR;
}

/**
 * `dist/estaticos.js` roda em `apps/api/dist`, e o PWA fica em `apps/web/dist`.
 * `STATIC_DIR` permite apontar para outro lugar se a hospedagem mudar o layout.
 */
export function caminhoDoPwa(): string | null {
  const configurado = process.env['STATIC_DIR'];
  const candidatos = configurado
    ? [resolve(configurado)]
    : [
        resolve(AQUI, '../../web/dist'),
        resolve(AQUI, '../../../apps/web/dist'),
        resolve(process.cwd(), 'apps/web/dist'),
      ];

  return candidatos.find((c) => existsSync(join(c, 'index.html'))) ?? null;
}

export async function registrarEstaticos(app: FastifyInstance): Promise<boolean> {
  const raiz = caminhoDoPwa();
  if (!raiz) {
    app.log.warn(
      'PWA não encontrado — a API sobe mesmo assim, mas o site não será servido. ' +
        'Rode `npm run build` ou defina STATIC_DIR.',
    );
    return false;
  }

  app.log.info({ raiz }, 'Servindo o PWA');

  await app.register(fastifyStatic, {
    root: raiz,
    index: ['index.html'],
    // No @fastify/static v10 o callback recebe a `FastifyReply` (não a resposta crua
    // do Node, como nas versões antigas), então é `.header()` e não `.setHeader()`.
    setHeaders: (reply, caminho) => {
      reply.header('cache-control', cacheDe(caminho));
    },
  });

  // Rota de SPA: /auditoria, /historico e /produtos não existem como arquivo. Sem isto,
  // recarregar a página nessas rotas devolve 404.
  app.setNotFoundHandler((req, reply) => {
    // 404 de API tem que continuar sendo 404 JSON. Devolver o HTML do app aqui faria o
    // cliente tentar interpretar uma página como resposta da API.
    if (req.url.startsWith('/api/')) {
      return reply.status(404).send({ ok: false, erro: 'Rota não encontrada' });
    }
    return reply.header('cache-control', CACHE_REVALIDAR).sendFile('index.html');
  });

  return true;
}
