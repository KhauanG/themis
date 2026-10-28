import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Perfil } from '../acesso.js';
import { config } from '../config.js';
import { ErroGoogle, type FirestoreServidor } from '../google.js';
import { opcoesDeLog, registrarLogDeRespostas } from '../log-respostas.js';
import { MENSAGENS } from '../mensagens.js';
import { rotasErp } from './erp.js';
import { hashColado, rotasErpLojas } from './erp-lojas.js';

// O uid `semDoc` não tem perfil: `lerPerfil` devolve null.
const PERFIS: Record<'master' | 'admin' | 'adminX' | 'auditor' | 'comum' | 'flagTexto', Perfil> = {
  master: { isMaster: true },
  admin: { isAdmin: true },
  adminX: { isAdmin: true, allowedInventories: ['X'] },
  auditor: { isAuditor: true },
  comum: {},
  flagTexto: { isAdmin: 'true' },
};
const HASHES = new Map([['X', 'H-X-0001'], ['Y', 'H-Y-0002']]);
const ENVIO = { IdProduto: 1, Quantidade: 5, CodigoBarras: '789', NomeProduto: 'Produto teste', EstoqueMinimo: 0, PrecoVenda: 10, PrecoCusto: 6 };
// Nada disto pode aparecer no log, em teste nenhum.
const SEGREDOS = ['H-X-0001', 'H-Y-0002', 'CANDIDATO-1', 'DO-CLIENTE', 'tok-'];

async function verificarTokenFalso(t: string): Promise<string> {
  if (t === 'chaves-fora') throw new ErroGoogle('chaves', 0);
  if (!t.startsWith('tok-')) throw new Error('token inválido');
  return t.slice(4);
}
const comToken = (uid: string) => ({ authorization: `Bearer tok-${uid}` });

function firestoreFalso(sobrescrever: Partial<FirestoreServidor> = {}): FirestoreServidor {
  return {
    lerPerfil: vi.fn(sobrescrever.lerPerfil ?? (async (uid: string) => PERFIS[uid as keyof typeof PERFIS] ?? null)),
    lerHashes: vi.fn(sobrescrever.lerHashes ?? (async () => new Map(HASHES))),
    gravarHash: vi.fn(sobrescrever.gravarHash ?? (async () => {})),
    lerAmostra: vi.fn(sobrescrever.lerAmostra ?? (async () => [])),
  };
}

// ERP falso. Padrão: 200 com `[]`, a resposta real a um hash desconhecido (sonda de 2026-10-28).
const fetchErp = vi.fn();
const abertos: Array<{ app: FastifyInstance; linhas: string[] }> = [];

async function montarApp(opcoes: { firestore?: FirestoreServidor | null; comRotasAntigas?: boolean } = {}) {
  const linhas: string[] = [];
  const app = Fastify(opcoesDeLog(true, { write: (l) => linhas.push(l) }));
  registrarLogDeRespostas(app);
  // Como o onSend async de cabecalhos.ts: sem `return reply` no preHandler, o handler roda depois do 401.
  app.addHook('onSend', async (_req, _reply, payload) => {
    await new Promise((r) => setImmediate(r));
    return payload;
  });
  if (opcoes.comRotasAntigas) await app.register(rotasErp);
  await app.register(rotasErpLojas, {
    verificarToken: verificarTokenFalso,
    firestore: opcoes.firestore === undefined ? firestoreFalso() : opcoes.firestore,
  });
  abertos.push({ app, linhas });
  return { app, linhas };
}

beforeEach(() => {
  fetchErp.mockReset().mockImplementation(async () => new Response('[]'));
  vi.stubGlobal('fetch', fetchErp);
});

afterEach(async () => {
  const montados = abertos.splice(0);
  await Promise.all(montados.map(({ app }) => app.close()));
  const log = montados.flatMap(({ linhas }) => linhas).join('\n');
  // "Reply was already sent" leva a URL crua (fatos-fastify-log §2) e denuncia um preHandler sem `return`.
  for (const proibido of [...SEGREDOS, 'Reply was already sent']) expect(log).not.toContain(proibido);
});

it('mensagens exatas (o site mostra corpo.erro como vem)', () => {
  expect(MENSAGENS).toEqual({
    sessao: 'Sua sessão expirou. Entre de novo.',
    permissao: 'Você não tem permissão para usar o ERP nesta loja.',
    soMaster: 'Só o master pode trocar ou testar outro HashLoja.',
    lojaSemHash: 'Esta loja não tem HashLoja configurado.',
    recarregue: 'O Themis foi atualizado. Recarregue a página.',
    semCredencial: 'O servidor não está configurado para falar com o ERP. Avise o administrador.',
    hashRepetido: 'Este hash já está configurado em outra loja.',
    hashInvalido: 'HashLoja inválido: cole só o código, sem espaços no meio.',
    falhaFirestore: 'Não foi possível conferir a configuração agora. Tente de novo em instantes.',
  });
});

describe('porta de entrada das rotas por loja', () => {
  it('503 sem credencial, antes de tudo', async () => {
    const { app } = await montarApp({ firestore: null });
    const r = await app.inject({ url: '/api/erp/lojas/X/estoque' });
    expect([r.statusCode, r.json()]).toEqual([503, { ok: false, erro: MENSAGENS.semCredencial }]);
    expect(fetchErp).not.toHaveBeenCalled();
  });

  it.each([
    ['sem Authorization', {}],
    ['sem Bearer', { authorization: 'tok-admin' }],
    ['token inválido', { authorization: 'Bearer invalido' }],
  ])('401 %s: não lê perfil nem chama o ERP', async (_n, headers) => {
    const fs = firestoreFalso();
    const { app } = await montarApp({ firestore: fs });
    const r = await app.inject({ method: 'POST', url: '/api/erp/lojas/X/estoque', headers, payload: ENVIO });
    expect([r.statusCode, r.json()]).toEqual([401, { ok: false, erro: MENSAGENS.sessao }]);
    expect(fs.lerPerfil).not.toHaveBeenCalled();
    expect(fetchErp).not.toHaveBeenCalled();
  });

  it('chaves do Google fora do ar: 503, não "sessão expirou"', async () => {
    const { app, linhas } = await montarApp();
    const r = await app.inject({ url: '/api/erp/lojas/X/estoque', headers: { authorization: 'Bearer chaves-fora' } });
    expect([r.statusCode, r.json()]).toEqual([503, { ok: false, erro: MENSAGENS.falhaFirestore }]);
    expect(linhas.join('\n')).toContain('"erro":"chaves 0"');
  });

  it.each([['auditor', 'X'], ['comum', 'X'], ['semDoc', 'X'], ['flagTexto', 'X'], ['adminX', 'Y']])(
    '403 para %s na loja %s: o handler não roda',
    async (uid, loja) => {
      const fs = firestoreFalso();
      const { app } = await montarApp({ firestore: fs });
      const r = await app.inject({ method: 'POST', url: `/api/erp/lojas/${loja}/estoque`, headers: comToken(uid), payload: ENVIO });
      expect([r.statusCode, r.json()]).toEqual([403, { ok: false, erro: MENSAGENS.permissao }]);
      expect(fs.lerHashes).not.toHaveBeenCalled();
      expect(fetchErp).not.toHaveBeenCalled();
    },
  );

  it('perfil é relido a cada chamada: rebaixado é barrado na seguinte', async () => {
    const fs = firestoreFalso();
    vi.mocked(fs.lerPerfil).mockResolvedValueOnce(PERFIS.admin).mockResolvedValueOnce(PERFIS.comum);
    const { app } = await montarApp({ firestore: fs });
    const pedido = { url: '/api/erp/lojas/X/estoque', headers: comToken('admin') };
    expect((await app.inject(pedido)).statusCode).toBe(200);
    expect((await app.inject(pedido)).statusCode).toBe(403);
    expect(fs.lerPerfil).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['lerPerfil', { lerPerfil: async () => { throw new ErroGoogle('firestore', 500); } }, 'firestore 500'],
    // O 403 do Google não vira status HTTP: o site leria "sem permissão" num problema do servidor.
    ['lerHashes, com 403 do Google', { lerHashes: async () => { throw new ErroGoogle('firestore', 403); } }, 'firestore 403'],
  ])('503 quando o Firestore falha em %s, e o log diz etapa e status', async (_n, sobrescrever, noLog) => {
    const { app, linhas } = await montarApp({ firestore: firestoreFalso(sobrescrever) });
    const r = await app.inject({ url: '/api/erp/lojas/X/estoque', headers: comToken('admin') });
    expect([r.statusCode, r.json()]).toEqual([503, { ok: false, erro: MENSAGENS.falhaFirestore }]);
    expect(fetchErp).not.toHaveBeenCalled();
    expect(linhas.join('\n')).toContain(`"erro":"${noLog}"`);
  });

  it('id do 1.x passa no schema', async () => {
    const fs = firestoreFalso({ lerHashes: async () => new Map([['inventory_1690000000000', 'H-X-0001']]) });
    const { app } = await montarApp({ firestore: fs });
    const doUmX = await app.inject({ url: '/api/erp/lojas/inventory_1690000000000/estoque', headers: comToken('admin') });
    // 100 = maxParamLength da Fastify: passa no schema e cai no 409 de loja sem hash.
    const longo = await app.inject({ url: `/api/erp/lojas/${'a'.repeat(100)}/estoque`, headers: comToken('admin') });
    expect([doUmX.statusCode, longo.statusCode]).toEqual([200, 409]);
  });

  it.each(['a.b', 'a%2Fb'])('id %s é recusado com 400', async (id) => {
    const { app } = await montarApp();
    expect((await app.inject({ url: `/api/erp/lojas/${id}/estoque`, headers: comToken('admin') })).statusCode).toBe(400);
  });
});

// 503 pararia o laço do Corrigir (T14b) com a mensagem errada.
describe('erros da Fastify mantêm o status', () => {
  it('corpo JSON vazio: 400', async () => {
    const { app } = await montarApp();
    const r = await app.inject({
      method: 'POST', url: '/api/erp/lojas/X/estoque',
      headers: { ...comToken('admin'), 'content-type': 'application/json' }, payload: '',
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toContain('Body cannot be empty');
  });

  it('429 do rate limit continua 429', async () => {
    const app = Fastify();
    try {
      await app.register(rateLimit, { max: 1, timeWindow: '1 minute' });
      await app.register(rotasErpLojas, { verificarToken: verificarTokenFalso, firestore: firestoreFalso() });
      const pedido = { url: '/api/erp/lojas/X/estoque', headers: comToken('admin') };
      await app.inject(pedido);
      const r = await app.inject(pedido);
      expect(r.statusCode).toBe(429);
      expect(r.json().erro).toMatch(/^Rate limit exceeded/);
    } finally {
      await app.close();
    }
  });
});

describe('estoque da loja com o hash do servidor', () => {
  it('admin lê o estoque com o hash do servidor, que não volta na resposta', async () => {
    fetchErp.mockImplementation(async () => new Response('[{"idproduto":"1","quantidade":2}]'));
    const { app } = await montarApp();
    const r = await app.inject({ url: '/api/erp/lojas/X/estoque', headers: comToken('admin') });
    expect(r.statusCode).toBe(200);
    expect(fetchErp.mock.calls[0]?.[0]).toBe(`${config.erp.urlListar}/H-X-0001`);
    expect(r.body).not.toContain('H-X-0001');
  });

  const abortou = () => Object.assign(new Error('abortou'), { name: 'AbortError' });
  it.each([
    ['lista', () => new Response('[{"idproduto":"1","quantidade":2}]'), 200,
      { ok: true, itens: [{ idProduto: '1', quantidade: 2 }], recebidos: 1, semId: 0, campos: ['idproduto', 'quantidade'], naoPositivos: 0, omiteZerados: false }],
    ['tempo', () => { throw abortou(); }, 504, { ok: false, erro: 'Tempo esgotado ao buscar o estoque' }],
    ['rede', () => { throw new TypeError('fetch failed'); }, 504, { ok: false, erro: 'Falha ao buscar o estoque' }],
    ['5xx', () => new Response('', { status: 503 }), 502, { ok: false, erro: 'ERP não devolveu o estoque', statusErp: 503 }],
    ['recusa', () => new Response('', { status: 404 }), 502, { ok: false, erro: 'O ERP recusou a consulta. Confira o HashLoja do estoque.', statusErp: 404 }],
    ['inesperado', () => new Response('{"x":1}'), 502, { ok: false, erro: 'Resposta do ERP em formato inesperado' }],
  ])('GET com %s do ERP: status e corpo que o site lê', async (_n, resposta, status, corpo) => {
    fetchErp.mockImplementation(async () => resposta());
    const { app } = await montarApp();
    const r = await app.inject({ url: '/api/erp/lojas/X/estoque', headers: comToken('admin') });
    expect([r.statusCode, r.json()]).toEqual([status, corpo]);
  });

  it('loja sem hash: 409 no GET e no POST, ERP não chamado', async () => {
    const { app } = await montarApp();
    const ler = await app.inject({ url: '/api/erp/lojas/Z/estoque', headers: comToken('admin') });
    const enviar = await app.inject({ method: 'POST', url: '/api/erp/lojas/Z/estoque', headers: comToken('admin'), payload: ENVIO });
    for (const r of [ler, enviar]) expect([r.statusCode, r.json()]).toEqual([409, { ok: false, erro: MENSAGENS.lojaSemHash }]);
    expect(fetchErp).not.toHaveBeenCalled();
  });

  it('POST usa o hash do servidor, nunca o do cliente', async () => {
    const { app } = await montarApp();
    const r = await app.inject({ method: 'POST', url: '/api/erp/lojas/X/estoque', headers: comToken('admin'), payload: { ...ENVIO, HashLoja: 'DO-CLIENTE' } });
    expect([r.statusCode, r.json()]).toEqual([200, { ok: true, tentativas: 1 }]);
    const [url, init] = fetchErp.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(config.erp.urlAtualizar);
    expect(JSON.parse(String(init.body))).toEqual({ ...ENVIO, HashLoja: 'H-X-0001' });
  });

  // Divergência 6. Fica depois da T15, que apaga o describe `rotas antigas no push A — log sem hash` do erp.test.ts.
  it('recusa que ecoa o hash não devolve o hash nem o loga', async () => {
    fetchErp.mockImplementation(async () => new Response('{"erro":"hash H-X-0001 invalido TEXTO-DO-ERP"}'));
    const { app, linhas } = await montarApp();
    const r = await app.inject({ method: 'POST', url: '/api/erp/lojas/X/estoque', headers: comToken('admin'), payload: ENVIO });
    expect([r.statusCode, r.json()]).toEqual([502, { ok: false, erro: 'O ERP recusou a atualização.', statusErp: 200, tentativas: 1 }]);
    expect(linhas.join('\n')).not.toContain('TEXTO-DO-ERP');
    expect(fetchErp).toHaveBeenCalledTimes(1);
  });

  it('teto da Quantidade na rota nova', async () => {
    const { app } = await montarApp();
    const r = await app.inject({ method: 'POST', url: '/api/erp/lojas/X/estoque', headers: comToken('admin'), payload: { ...ENVIO, Quantidade: 1_000_000 } });
    expect(r.statusCode).toBe(400);
    expect(fetchErp).not.toHaveBeenCalled();
  });
});

describe('GET /api/erp/hashes', () => {
  it.each([['adminX', ['X']], ['admin', ['X', 'Y']], ['master', ['X', 'Y']]])(
    '%s recebe só os ids que pode ver, nunca os valores',
    async (uid, ids) => {
      const { app } = await montarApp();
      const r = await app.inject({ url: '/api/erp/hashes', headers: comToken(uid) });
      expect(r.json()).toEqual({ ok: true, configurados: ids });
    },
  );

  it.each(['comum', 'auditor', 'semDoc', 'flagTexto'])('%s: 403', async (uid) => {
    const { app } = await montarApp();
    const r = await app.inject({ url: '/api/erp/hashes', headers: comToken(uid) });
    expect([r.statusCode, r.json()]).toEqual([403, { ok: false, erro: MENSAGENS.permissao }]);
  });
});

describe('convivência com as rotas antigas', () => {
  // O site 2.20 segue no ar durante o push A. O afterEach confere que o hash da URL antiga não vai ao log.
  it('push A: as antigas seguem sem token; a nova pede token', async () => {
    const { app } = await montarApp({ comRotasAntigas: true });
    const antigoGet = await app.inject({ url: '/api/erp/estoque/H-X-0001' });
    const antigoPost = await app.inject({ method: 'POST', url: '/api/erp/estoque', payload: { ...ENVIO, HashLoja: 'H-X-0001' } });
    const nova = await app.inject({ url: '/api/erp/lojas/X/estoque' });
    expect([antigoGet.statusCode, antigoPost.statusCode, nova.statusCode]).toEqual([200, 200, 401]);
  });
});

describe('hashColado', () => {
  it.each([
    ['vazio exato remove', '', ''],
    ['apara espaço, tab e quebra de linha nas pontas', ' \tCANDIDATO-1\r\n', 'CANDIDATO-1'],
    ['só espaços é inválido, não remove', '   ', null],
    ['espaço no meio é inválido', 'CANDI DATO-1', null],
    ['200 caracteres passam', 'A'.repeat(200), 'A'.repeat(200)],
    ['201 caracteres não passam', 'A'.repeat(201), null],
    ['".." não é hash: subiria um nível na URL do ERP', '..', null],
  ] as const)('%s', (_nome, bruto, esperado) => expect(hashColado(bruto)).toBe(esperado));
});

describe('PUT e DELETE do HashLoja — só o master', () => {
  async function pedir(
    metodo: 'PUT' | 'DELETE',
    uid: string | null,
    o: { corpo?: object; firestore?: FirestoreServidor } = {},
  ) {
    const firestore = o.firestore ?? firestoreFalso();
    const { app } = await montarApp({ firestore });
    const res = await app.inject({
      method: metodo,
      url: '/api/erp/lojas/X/hash',
      headers: uid === null ? {} : comToken(uid),
      ...(o.corpo === undefined ? {} : { payload: o.corpo }),
    });
    return { res, firestore };
  }

  it.each([
    ['sem token no PUT: 401', 'PUT', null, 401, MENSAGENS.sessao],
    ['comum no PUT: 403 do cargo', 'PUT', 'comum', 403, MENSAGENS.permissao],
    ['admin no PUT: 403 de só master, antes do 409', 'PUT', 'admin', 403, MENSAGENS.soMaster],
    ['admin no DELETE: 403 de só master', 'DELETE', 'admin', 403, MENSAGENS.soMaster],
  ] as const)('só master grava ou apaga — %s', async (_nome, metodo, uid, status, erro) => {
    const { res, firestore } = await pedir(metodo, uid, metodo === 'PUT' ? { corpo: { hash: 'H-Y-0002' } } : {});
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ ok: false, erro });
    expect(firestore.gravarHash).not.toHaveBeenCalled();
  });

  it('hash colado com espaço e quebra de linha nas pontas é aparado', async () => {
    const { res, firestore } = await pedir('PUT', 'master', { corpo: { hash: ' \tCANDIDATO-1\r\n' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(firestore.gravarHash).toHaveBeenCalledTimes(1);
    expect(firestore.gravarHash).toHaveBeenCalledWith('X', 'CANDIDATO-1');
    expect(fetchErp).not.toHaveBeenCalled();
  });

  it.each([
    ['espaço no meio', 'CANDI DATO-1'],
    ['só espaços não apaga o hash salvo', '   '],
  ] as const)('hash inválido é recusado — %s', async (_nome, hash) => {
    const { res, firestore } = await pedir('PUT', 'master', { corpo: { hash } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, erro: MENSAGENS.hashInvalido });
    expect(firestore.gravarHash).not.toHaveBeenCalled();
  });

  it.each([
    ['sem o campo hash', {}],
    ['hash acima de 300 caracteres', { hash: 'A'.repeat(301) }],
  ] as const)('corpo fora do schema: 400 e nada gravado — %s', async (_nome, corpo) => {
    const { res, firestore } = await pedir('PUT', 'master', { corpo });
    expect(res.statusCode).toBe(400);
    expect(firestore.gravarHash).not.toHaveBeenCalled();
  });

  it('hash que já está em outra loja é recusado', async () => {
    const { res, firestore } = await pedir('PUT', 'master', { corpo: { hash: ' H-Y-0002\n' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, erro: MENSAGENS.hashRepetido });
    expect(firestore.gravarHash).not.toHaveBeenCalled();
  });

  it('regravar o mesmo hash na própria loja passa', async () => {
    const { res, firestore } = await pedir('PUT', 'master', { corpo: { hash: 'H-X-0001' } });
    expect(res.statusCode).toBe(200);
    expect(firestore.gravarHash).toHaveBeenCalledWith('X', 'H-X-0001');
  });

  it('hash vazio remove', async () => {
    const { res, firestore } = await pedir('PUT', 'master', { corpo: { hash: '' } });
    expect(res.json()).toEqual({ ok: true });
    expect(firestore.gravarHash).toHaveBeenCalledWith('X', '');
  });

  it('DELETE do master, sem corpo, remove', async () => {
    const { res, firestore } = await pedir('DELETE', 'master');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(firestore.gravarHash).toHaveBeenCalledWith('X', '');
  });

  it('falha ao gravar no Firestore: 503, nunca o status do Google', async () => {
    const firestore = firestoreFalso({ gravarHash: vi.fn().mockRejectedValue(new ErroGoogle('firestore', 403)) });
    const { res } = await pedir('PUT', 'master', { corpo: { hash: 'CANDIDATO-1' }, firestore });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, erro: MENSAGENS.falhaFirestore });
  });
});
