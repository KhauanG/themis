import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { opcoesDeLog, registrarLogDeRespostas } from './log-respostas.js';

function montar(rotas: (app: FastifyInstance) => void) {
  const linhas: string[] = [];
  const app = Fastify(opcoesDeLog(true, { write: (l) => linhas.push(l) }));
  registrarLogDeRespostas(app);
  rotas(app);
  return { app, log: () => linhas.join('') };
}

describe('log das respostas', () => {
  it('registra o padrão da rota, nunca a URL crua', async () => {
    const { app, log } = montar((a) => {
      a.get('/api/erp/estoque/:hashLoja', async (req) => {
        req.log.info({ req }, 'manual'); // o serializer de req também fica sem url
        return { ok: true };
      });
    });
    await app.inject('/api/erp/estoque/HASH-SECRETO-1');
    await app.close();
    expect(log()).toContain('"rota":"/api/erp/estoque/:hashLoja"');
    expect(log()).toContain('"status":200');
    expect(log()).not.toContain('HASH-SECRETO-1');
    expect(log()).not.toContain('incoming request');
    expect(log()).not.toContain('"url"');
  });

  it('404 não registra a URL', async () => {
    const { app, log } = montar(() => {});
    expect((await app.inject('/api/x/HASH-SECRETO-2')).statusCode).toBe(404);
    await app.close();
    expect(log()).toContain('"rota":"sem rota"');
    expect(log()).not.toContain('HASH-SECRETO-2');
  });

  it('erro 500 registra só o nome do erro', async () => {
    const { app, log } = montar((a) => {
      a.get('/api/falha', async () => {
        throw new Error('falhou HASH-SECRETO-3');
      });
    });
    expect((await app.inject('/api/falha')).statusCode).toBe(500);
    await app.close();
    expect(log()).toContain('"erro":"Error"');
    expect(log()).not.toContain('HASH-SECRETO-3');
  });

  it('aviso de resposta enviada duas vezes não leva o hash', async () => {
    const { app, log } = montar((a) => {
      a.get('/api/erp/estoque/:hashLoja', async (_req, reply) => {
        reply.send({ ok: 1 });
        reply.send({ ok: 2 }); // a Fastify avisa "Reply was already sent" com a URL crua
        return reply;
      });
    });
    await app.inject('/api/erp/estoque/HASH-SECRETO-4');
    await app.close();
    expect(log()).toContain('Reply was already sent');
    expect(log()).toContain('/api/erp/estoque/***');
    expect(log()).not.toContain('HASH-SECRETO-4');
  });

  // Produção chama `opcoesDeLog(config.isProd)` sem destino. Os testes acima usam o ramo com destino.
  it.each([true, false])('opcoesDeLog(%s) sem destino tem o controller, o serializer e o streamWrite', (isProd) => {
    const { logController, logger } = opcoesDeLog(isProd) as unknown as {
      logController: unknown;
      logger: { hooks: { streamWrite: (s: string) => string }; serializers: { req: (r: object) => unknown } };
    };
    expect(logController).toBeInstanceOf(LogController);
    expect(logger.hooks.streamWrite('{"msg":"in \\"/api/erp/estoque/HASH-SECRETO-5\\" (GET)"}')).not.toContain('HASH-SECRETO-5');
    expect(logger.serializers.req({ method: 'GET', url: '/api/erp/estoque/HASH-SECRETO-6', routeOptions: { url: '/api/erp/estoque/:hashLoja' } }))
      .toEqual({ method: 'GET', rota: '/api/erp/estoque/:hashLoja' });
  });
});
