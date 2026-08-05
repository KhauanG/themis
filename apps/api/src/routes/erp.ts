/**
 * Proxy para a API de inventário do ERP.
 *
 * No Themis 1.x o navegador chamava o ERP direto (`erp-integration.js`). Passando por
 * aqui ganhamos: o endereço do ERP some do bundle, o timeout e o retry ficam do lado do
 * servidor (celular do funcionário não precisa segurar a requisição), e a validação do
 * payload acontece antes de sair da nossa rede.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

/** Payload esperado pelo ERP — mesmo contrato do Themis 1.x. */
interface AtualizacaoEstoque {
  IdProduto: string;
  HashLoja: string;
  Quantidade: number;
  CodigoBarras: string;
}

const schema = {
  body: {
    type: 'object',
    required: ['IdProduto', 'HashLoja', 'Quantidade', 'CodigoBarras'],
    additionalProperties: false,
    properties: {
      IdProduto: { type: 'string', minLength: 1 },
      HashLoja: { type: 'string', minLength: 1 },
      // Quantidade negativa nunca é contagem válida e o ERP a rejeita silenciosamente.
      Quantidade: { type: 'number', minimum: 0 },
      CodigoBarras: { type: 'string', minLength: 1 },
    },
  },
} as const;

export async function rotasErp(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AtualizacaoEstoque }>('/api/erp/estoque', { schema }, async (req, reply) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.erp.timeoutMs);

    try {
      const resposta = await fetch(config.erp.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });

      const corpo = await resposta.text();

      if (!resposta.ok) {
        req.log.warn(
          { status: resposta.status, idProduto: req.body.IdProduto },
          'ERP recusou a atualização',
        );
        // 502: o erro é do ERP, não do cliente. O app trata como "reenviar depois".
        return reply.status(502).send({
          ok: false,
          erro: 'ERP recusou a atualização',
          statusErp: resposta.status,
        });
      }

      return reply.send({ ok: true, resposta: corpo });
    } catch (erro) {
      const abortou = erro instanceof Error && erro.name === 'AbortError';
      req.log.error({ erro, idProduto: req.body.IdProduto }, 'Falha ao contatar o ERP');
      return reply.status(504).send({
        ok: false,
        erro: abortou ? 'Tempo esgotado ao contatar o ERP' : 'Falha ao contatar o ERP',
      });
    } finally {
      clearTimeout(timer);
    }
  });
}
