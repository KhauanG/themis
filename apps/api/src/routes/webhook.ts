/**
 * Recebe notificações de estoque vindas do ERP.
 *
 * Substitui `www/webhook-server.js` do Themis 1.x, que declarava um servidor HTTP mas
 * rodava dentro do navegador — caía sempre no ramo de "simulação" e nunca recebeu
 * requisição de verdade.
 *
 * Autenticação: segredo compartilhado no header `x-themis-webhook-secret`. Um endpoint
 * aberto aqui deixaria qualquer pessoa na internet alterar contagem de estoque.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';

/** Comparação em tempo constante — `===` vaza o tamanho do prefixo correto. */
function segredoConfere(recebido: string | undefined): boolean {
  if (!config.webhookSecret || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(config.webhookSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface EventoEstoque {
  IdProduto: string;
  HashLoja: string;
  Quantidade: number;
  CodigoBarras?: string;
}

const schema = {
  body: {
    type: 'object',
    required: ['IdProduto', 'HashLoja', 'Quantidade'],
    properties: {
      IdProduto: { type: 'string', minLength: 1 },
      HashLoja: { type: 'string', minLength: 1 },
      Quantidade: { type: 'number', minimum: 0 },
      CodigoBarras: { type: 'string' },
    },
  },
} as const;

export async function rotasWebhook(app: FastifyInstance): Promise<void> {
  app.post<{ Body: EventoEstoque }>('/api/webhook/estoque', { schema }, async (req, reply) => {
    if (!config.webhookSecret) {
      req.log.warn('Webhook chamado mas WEBHOOK_SECRET não está configurado — recusando');
      return reply.status(503).send({ ok: false, erro: 'Webhook não configurado' });
    }

    const header = (req as FastifyRequest).headers['x-themis-webhook-secret'];
    const recebido = Array.isArray(header) ? header[0] : header;

    if (!segredoConfere(recebido)) {
      req.log.warn({ ip: req.ip }, 'Webhook com segredo inválido');
      return reply.status(401).send({ ok: false, erro: 'Não autorizado' });
    }

    // TODO(porte): gravar em `estoques/{inventoryId}/produtos` via Firebase Admin SDK.
    // Depende de definir como o ERP identifica o estoque (HashLoja -> inventoryId,
    // hoje resolvido pela coleção `hashConfigs`).
    req.log.info({ idProduto: req.body.IdProduto }, 'Evento de estoque recebido');

    return reply.send({ ok: true, recebido: true });
  });
}
