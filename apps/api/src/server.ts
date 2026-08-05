import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { rotasErp } from './routes/erp.js';
import { rotasWebhook } from './routes/webhook.js';

const app = Fastify({
  logger: config.isProd
    ? { level: 'info' }
    : { level: 'debug', transport: { target: 'pino-pretty' } },
  // A Hostinger fica atrás de proxy: sem isso `req.ip` vira o IP do proxy
  // e o rate limit passa a valer para todo mundo junto.
  trustProxy: true,
});

await app.register(cors, {
  origin: config.corsOrigins,
  methods: ['GET', 'POST'],
});

await app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
});

app.get('/api/health', async () => ({ ok: true, versao: '2.0.0' }));

await app.register(rotasErp);
await app.register(rotasWebhook);

try {
  // 0.0.0.0 é necessário atrás do proxy da Hostinger; localhost não recebe tráfego externo.
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (erro) {
  app.log.error(erro);
  process.exit(1);
}
