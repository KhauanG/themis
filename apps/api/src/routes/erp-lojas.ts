/**
 * Rotas do ERP por loja. O hash não sai do servidor: o cliente manda só a loja e o ID token.
 * O plugin fica sem `fastify-plugin` para o login não alcançar as rotas antigas antes da T15.
 */
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { ehAdmin, ehMaster, podeAcessarEstoque, podeUsarErp, type Perfil } from '../acesso.js';
import { ErroGoogle, type FirestoreServidor } from '../google.js';
import { MENSAGENS } from '../mensagens.js';
import {
  enviarComRetry,
  listarNoErp,
  responderEnvio,
  responderListagem,
  type AtualizacaoEstoque,
} from './erp.js';

declare module 'fastify' {
  interface FastifyRequest {
    perfil: Perfil;
  }
}

export interface DependenciasErp {
  verificarToken: (token: string) => Promise<string>;
  firestore: FirestoreServidor | null;
}

// 100 é o `maxParamLength` da Fastify (acima disso, 414 antes do schema); ids reais têm
// 20 (automático) e 23 caracteres (`inventory_<13 dígitos>`).
const PARAMS_LOJA = {
  type: 'object',
  required: ['inventoryId'],
  properties: { inventoryId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' } },
} as const;

// Fica à parte porque a T15 apaga o antigo; o ajv da Fastify remove um `HashLoja` mandado pelo
// cliente, e o spread põe o do servidor por último.
// shortcut: duplica `schemaAtualizacao` de routes/erp.ts até a T15 apagar aquele; mudança de limite vai nos dois.
const SCHEMA_ENVIO = {
  type: 'object',
  required: [
    'IdProduto',
    'Quantidade',
    'CodigoBarras',
    'NomeProduto',
    'EstoqueMinimo',
    'PrecoVenda',
    'PrecoCusto',
  ],
  additionalProperties: false,
  properties: {
    // `> 0` como no `validateProductData` do 1.x: id zero nunca identifica produto.
    IdProduto: { type: 'integer', minimum: 1 },
    // Quantidade negativa nunca é contagem válida e o ERP a rejeita silenciosamente.
    // Teto = `LIMITE_QUANTIDADE` de packages/shared/src/quantidade.ts (a API não importa o shared).
    Quantidade: { type: 'number', minimum: 0, maximum: 999_999 },
    // Vazio é permitido: o 1.x só exigia que o campo existisse, e produto sem código de
    // barras é comum no cadastro. Exigir `minLength: 1` bloquearia envio que o 1.x fazia.
    CodigoBarras: { type: 'string' },
    NomeProduto: { type: 'string' },
    EstoqueMinimo: { type: 'integer', minimum: 0 },
    PrecoVenda: { type: 'number', minimum: 0 },
    PrecoCusto: { type: 'number', minimum: 0 },
  },
} as const;

export function hashColado(bruto: string): string | null {
  if (bruto === '') return '';
  const hash = bruto.trim();
  return /^(?!\.{1,2}$)\S{1,200}$/.test(hash) ? hash : null;
}

export const rotasErpLojas: FastifyPluginAsync<DependenciasErp> = async (app, { verificarToken, firestore }) => {
  // O `preHandler` já respondeu 503; isto só tira o `null` do tipo.
  const exigirFirestore = (): FirestoreServidor => {
    if (!firestore) throw new Error('sem credencial');
    return firestore;
  };

  app.decorateRequest('perfil', null);

  // Lê só `statusCode`, porque a Fastify também lê `err.status`.
  app.setErrorHandler<FastifyError>((erro, req, reply) => {
    // Validação já vem com 400. Corpo inválido, 413, 415 e o 429 do rate limit passam com o próprio status.
    const status = erro.statusCode ?? 0;
    if (status >= 400 && status < 500) return reply.code(status).send({ ok: false, erro: erro.message });
    // O message do ErroGoogle é só etapa e status ("firestore 403"): sem ele, uma chave revogada não se distingue de um Google fora.
    req.log.error({ erro: erro instanceof ErroGoogle ? erro.message : erro.name }, 'falha nas rotas do ERP');
    return reply.code(503).send({ ok: false, erro: MENSAGENS.falhaFirestore });
  });

  // Toda resposta antecipada é `return reply…`: com o `onSend` async dos cabeçalhos, sem o
  // `return` o handler roda depois do 401 e o POST chega ao ERP.
  app.addHook('preHandler', async (req, reply) => {
    if (firestore === null) return reply.code(503).send({ ok: false, erro: MENSAGENS.semCredencial });
    const cabecalho = req.headers.authorization ?? '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
    if (token === '') return reply.code(401).send({ ok: false, erro: MENSAGENS.sessao });
    let uid: string;
    try {
      uid = await verificarToken(token);
    } catch (erro) {
      if (erro instanceof ErroGoogle) throw erro; // chaves do Google fora: 503 pelo setErrorHandler
      return reply.code(401).send({ ok: false, erro: MENSAGENS.sessao });
    }
    req.perfil = await firestore.lerPerfil(uid); // sem cache: rebaixado é barrado na próxima chamada; falha → 503
    const { inventoryId } = req.params as { inventoryId?: string };
    const pode = inventoryId === undefined ? ehAdmin(req.perfil) || ehMaster(req.perfil) : podeUsarErp(req.perfil, inventoryId);
    if (!pode) return reply.code(403).send({ ok: false, erro: MENSAGENS.permissao });
  });

  app.get<{ Params: { inventoryId: string } }>(
    '/api/erp/lojas/:inventoryId/estoque',
    { schema: { params: PARAMS_LOJA } },
    async (req, reply) => {
      const hash = (await exigirFirestore().lerHashes()).get(req.params.inventoryId);
      if (hash === undefined) return reply.code(409).send({ ok: false, erro: MENSAGENS.lojaSemHash });
      return responderListagem(reply, await listarNoErp(hash));
    },
  );

  app.post<{ Params: { inventoryId: string }; Body: Omit<AtualizacaoEstoque, 'HashLoja'> }>(
    '/api/erp/lojas/:inventoryId/estoque',
    { schema: { params: PARAMS_LOJA, body: SCHEMA_ENVIO } },
    async (req, reply) => {
      const hash = (await exigirFirestore().lerHashes()).get(req.params.inventoryId);
      if (hash === undefined) return reply.code(409).send({ ok: false, erro: MENSAGENS.lojaSemHash });
      return responderEnvio(reply, await enviarComRetry({ ...req.body, HashLoja: hash }, req.log));
    },
  );

  app.get('/api/erp/hashes', async (req) => ({
    ok: true,
    configurados: [...(await exigirFirestore().lerHashes()).keys()].filter((id) => podeAcessarEstoque(req.perfil, id)),
  }));

  app.put<{ Params: { inventoryId: string }; Body: { hash: string } }>(
    '/api/erp/lojas/:inventoryId/hash',
    {
      schema: {
        params: PARAMS_LOJA,
        body: {
          type: 'object',
          required: ['hash'],
          additionalProperties: false,
          properties: { hash: { type: 'string', maxLength: 300 } },
        },
      },
    },
    async (req, reply) => {
      // O 403 vem antes de ler os hashes: senão o PUT diria ao admin se um hash está em uso.
      if (!ehMaster(req.perfil)) return reply.code(403).send({ ok: false, erro: MENSAGENS.soMaster });
      const hash = hashColado(req.body.hash);
      if (hash === null) return reply.code(400).send({ ok: false, erro: MENSAGENS.hashInvalido });
      const fs = exigirFirestore();
      const { inventoryId } = req.params;
      // Copiar o hash da loja vizinha é o erro mais provável, e o Testar não pega: no Nuvem3 os
      // ids de produto são iguais entre lojas (spec 4.5). Chave de loja excluída também conta,
      // porque a API não lê `inventories`. O scripts/limpar-hash-antigo.mjs tira essas chaves.
      if (hash !== '' && [...(await fs.lerHashes())].some(([id, valor]) => id !== inventoryId && valor === hash)) {
        return reply.code(409).send({ ok: false, erro: MENSAGENS.hashRepetido });
      }
      await fs.gravarHash(inventoryId, hash);
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { inventoryId: string } }>(
    '/api/erp/lojas/:inventoryId/hash',
    { schema: { params: PARAMS_LOJA } },
    async (req, reply) => {
      if (!ehMaster(req.perfil)) return reply.code(403).send({ ok: false, erro: MENSAGENS.soMaster });
      await exigirFirestore().gravarHash(req.params.inventoryId, '');
      return reply.send({ ok: true });
    },
  );
};
