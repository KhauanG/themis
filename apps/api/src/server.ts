import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { registrarEstaticos } from './estaticos.js';
import { rotasErp } from './routes/erp.js';
import { rotasWebhook } from './routes/webhook.js';

/**
 * Qualquer falha aqui deixa o servidor web sem ninguém para conversar, e o usuário vê um
 * `503 Service Unavailable` sem pista nenhuma. Estes dois avisos são a única forma de
 * descobrir o motivo pelo log da hospedagem.
 */
process.on('uncaughtException', (erro) => {
  console.error('[themis] Exceção não tratada — o processo vai encerrar:', erro);
  process.exit(1);
});

process.on('unhandledRejection', (motivo) => {
  console.error('[themis] Promise rejeitada sem tratamento:', motivo);
});

const app = Fastify({
  logger: config.isProd
    ? { level: 'info' }
    : { level: 'debug', transport: { target: 'pino-pretty' } },
  // A Hostinger fica atrás de proxy: sem isso `req.ip` vira o IP do proxy
  // e o rate limit passa a valer para todo mundo junto.
  trustProxy: true,
});

// Mesma origem dispensa CORS. O registro só serve para o caso de a API acabar num
// subdomínio separado, e para o `npm run dev`, em que o Vite roda na 5173.
await app.register(cors, {
  origin: config.corsOrigins,
  methods: ['GET', 'POST'],
});

await app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
  // O PWA carrega dezenas de arquivos de uma vez. Sem esta isenção, o limite
  // derrubaria o carregamento do próprio site.
  allowList: (req) => !req.url.startsWith('/api/'),
});

await app.register(rotasErp);
await app.register(rotasWebhook);

const servindoPwa = await registrarEstaticos(app);

app.get('/api/health', async () => ({
  ok: true,
  versao: '2.0.0',
  pwa: servindoPwa,
}));

try {
  if (config.escuta.tipo === 'socket') {
    // O Passenger entrega um socket Unix em PORT; nesse modo não existe host nem porta.
    await app.listen({ path: config.escuta.caminho });
    app.log.info(`Themis no ar no socket ${config.escuta.caminho} (pwa=${servindoPwa})`);
  } else {
    // 0.0.0.0 é necessário atrás de proxy; localhost não recebe tráfego externo.
    await app.listen({ port: config.escuta.porta, host: '0.0.0.0' });
    app.log.info(`Themis no ar na porta ${config.escuta.porta} (pwa=${servindoPwa})`);
  }
} catch (erro) {
  app.log.error(erro, 'Não foi possível abrir a escuta');
  process.exit(1);
}
