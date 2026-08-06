/**
 * Proxy para a API de estoque do ERP.
 *
 * No Themis 1.x o navegador chamava `erp.nuvem3.com.br` direto. Passando por aqui
 * ganhamos: o endereço do ERP some do bundle, o timeout e o retry ficam do lado do
 * servidor (celular do funcionário não precisa segurar a requisição), e a validação do
 * payload acontece antes de sair da nossa rede.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

/** Payload esperado pelo ERP na atualização — mesmo contrato do Themis 1.x. */
interface AtualizacaoEstoque {
  IdProduto: string;
  HashLoja: string;
  Quantidade: number;
  CodigoBarras: string;
}

const schemaAtualizacao = {
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

/** Item da listagem de estoque do ERP. Campos em minúsculas, como o ERP devolve. */
interface ItemEstoqueErp {
  idproduto?: unknown;
  quantidade?: unknown;
}

async function comTempoLimite<T>(
  ms: number,
  executar: (sinal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await executar(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function rotasErp(app: FastifyInstance): Promise<void> {
  /** Envia a quantidade contada de um produto. */
  app.post<{ Body: AtualizacaoEstoque }>(
    '/api/erp/estoque',
    { schema: schemaAtualizacao },
    async (req, reply) => {
      try {
        const resposta = await comTempoLimite(config.erp.timeoutMs, (signal) =>
          fetch(config.erp.urlAtualizar, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(req.body),
            signal,
          }),
        );

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
      }
    },
  );

  /**
   * Lista o estoque atual da loja no ERP.
   *
   * É o que permite comparar a contagem com o saldo real antes de corrigir, e depois
   * verificar se a correção foi mesmo aplicada. O ERP devolve um array de
   * `{ idproduto, quantidade }` — às vezes embrulhado em `data` ou `items`.
   *
   * Timeout maior que o da atualização: a listagem traz o estoque inteiro da loja.
   */
  app.get<{ Params: { hashLoja: string } }>(
    '/api/erp/estoque/:hashLoja',
    {
      schema: {
        params: {
          type: 'object',
          required: ['hashLoja'],
          properties: { hashLoja: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const url = `${config.erp.urlListar}/${encodeURIComponent(req.params.hashLoja)}`;

      try {
        const resposta = await comTempoLimite(config.erp.timeoutListarMs, (signal) =>
          fetch(url, { headers: { Accept: 'application/json' }, signal }),
        );

        if (!resposta.ok) {
          req.log.warn({ status: resposta.status }, 'ERP recusou a listagem de estoque');
          return reply
            .status(502)
            .send({ ok: false, erro: 'ERP não devolveu o estoque', statusErp: resposta.status });
        }

        const bruto: unknown = await resposta.json();

        // O ERP às vezes embrulha o array. Desembrulhar aqui evita que cada cliente
        // precise conhecer os três formatos.
        let itens: unknown = bruto;
        if (!Array.isArray(itens) && bruto && typeof bruto === 'object') {
          const obj = bruto as Record<string, unknown>;
          if (Array.isArray(obj['data'])) itens = obj['data'];
          else if (Array.isArray(obj['items'])) itens = obj['items'];
        }

        if (!Array.isArray(itens)) {
          req.log.error({ tipo: typeof bruto }, 'Resposta do ERP não é uma lista');
          return reply.status(502).send({ ok: false, erro: 'Resposta do ERP em formato inesperado' });
        }

        const estoque = (itens as ItemEstoqueErp[])
          .map((i) => ({ idProduto: String(i.idproduto ?? '').trim(), quantidade: Number(i.quantidade) }))
          .filter((i) => i.idProduto !== '' && Number.isFinite(i.quantidade));

        return reply.send({ ok: true, itens: estoque, recebidos: itens.length });
      } catch (erro) {
        const abortou = erro instanceof Error && erro.name === 'AbortError';
        req.log.error({ erro }, 'Falha ao buscar o estoque no ERP');
        return reply.status(504).send({
          ok: false,
          erro: abortou ? 'Tempo esgotado ao buscar o estoque' : 'Falha ao buscar o estoque',
        });
      }
    },
  );
}
