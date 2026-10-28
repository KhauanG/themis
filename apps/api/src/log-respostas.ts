import { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';

/**
 * Log da API sem URL crua. Desde `705d8c3` (2026-08-06) o log padrão da Fastify gravava
 * `req.url`, e o HashLoja de `/api/erp/estoque/<hash>` ia junto para o log da hospedagem.
 */

export interface DestinoDeLog {
  write(linha: string): void;
}

export function opcoesDeLog(
  isProd: boolean,
  destino?: DestinoDeLog,
): Pick<FastifyServerOptions, 'logger' | 'logController'> {
  const comum = {
    serializers: {
      req: (r: { method?: string; routeOptions?: { url?: string } }) => ({
        method: r.method,
        rota: r.routeOptions?.url,
      }),
    },
    hooks: {
      // O aviso "Reply was already sent" leva a URL crua no texto e não passa pelo `LogController`.
      streamWrite: (s: string) => s.replace(/(\/api\/erp\/estoque\/)(?!:)[^"\s?\\]+/g, '$1***'),
    },
  };
  const base = destino
    ? { level: 'info', stream: destino }
    : isProd
      ? { level: 'info' }
      : { level: 'debug', transport: { target: 'pino-pretty' } };
  return {
    logger: { ...base, ...comum },
    logController: new LogController({ disableRequestLogging: true }),
  };
}

export function registrarLogDeRespostas(app: FastifyInstance): void {
  app.addHook('onResponse', async (req, reply) => {
    req.log.info(
      {
        metodo: req.method,
        rota: req.routeOptions.url ?? 'sem rota',
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      },
      'resposta',
    );
  });

  // O `disableRequestLogging` também cala o log de erro padrão: esta é a única linha de erro.
  app.addHook('onError', async (req, _reply, erro) => {
    req.log[(erro.statusCode ?? 500) < 500 ? 'warn' : 'error'](
      { erro: erro.name, codigo: erro.code },
      'erro na rota',
    );
  });
}
