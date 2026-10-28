import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { opcoesDeLog, registrarLogDeRespostas } from '../log-respostas.js';
import {
  enviarComRetry,
  erroDeNegocio,
  jsonDoErp,
  listarNoErp,
  normalizarItensDoErp,
  rotasErp,
  type AtualizacaoEstoque,
} from './erp.js';

/**
 * O ERP responde **HTTP 200 com erro no corpo** quando recusa a atualização por regra dele.
 * Sem esta checagem o app contava o item como enviado, e só a releitura da fase 3 do
 * "Corrigir estoque" perceberia — quando percebesse. O 1.x fazia isso em
 * `extractBusinessError`; o porte inicial tinha esquecido.
 */
describe('erroDeNegocio', () => {
  it('aceita resposta sem sinal de erro', () => {
    expect(erroDeNegocio({ id: 1, ok: true })).toBeNull();
  });

  it('aceita corpo que não é objeto', () => {
    expect(erroDeNegocio(null)).toBeNull();
    expect(erroDeNegocio('OK')).toBeNull();
    expect(erroDeNegocio(42)).toBeNull();
  });

  it('acusa success: false e usa a mensagem do corpo', () => {
    expect(erroDeNegocio({ success: false, message: 'Produto inexistente' })).toBe(
      'Produto inexistente',
    );
  });

  it('acusa success: false mesmo sem mensagem', () => {
    expect(erroDeNegocio({ success: false })).toBe('campo "success" = false');
  });

  it('reconhece as grafias em português', () => {
    expect(erroDeNegocio({ sucesso: false, mensagem: 'Loja inválida' })).toBe('Loja inválida');
  });

  it('acusa campo de erro preenchido', () => {
    expect(erroDeNegocio({ erro: 'HashLoja não encontrado' })).toBe('HashLoja não encontrado');
    expect(erroDeNegocio({ Error: 'falhou' })).toBe('falhou');
  });

  // Campo de erro vazio é o que a API devolve quando deu certo. Não é erro.
  it('ignora campo de erro vazio', () => {
    expect(erroDeNegocio({ erro: '' })).toBeNull();
    expect(erroDeNegocio({ error: '   ' })).toBeNull();
  });

  it('acusa status = error', () => {
    expect(erroDeNegocio({ status: 'error', message: 'timeout interno' })).toBe('timeout interno');
    expect(erroDeNegocio({ status: 'error' })).toBe('status = error');
  });

  // Conservador de propósito: 200 já é sinal de aceite, e falso positivo aqui faria o app
  // reenviar item que o ERP gravou — barulho sem ganho.
  it('não inventa erro em resposta desconhecida', () => {
    expect(erroDeNegocio({ resultado: 'algo', codigo: 7 })).toBeNull();
    expect(erroDeNegocio({ success: true, erro: null })).toBeNull();
  });
});

/**
 * O nome dos campos da listagem varia. Aceitar só `idproduto` fazia a resposta inteira ser
 * descartada em silêncio: nenhum produto casava, e o app mostrava o saldo da última
 * importação achando que tinha acabado de sincronizar com o ERP. O `auditoria.js` do 1.x
 * — a versão mais testada em campo — aceitava quatro grafias para o id e três para a
 * quantidade.
 */
describe('normalizarItensDoErp', () => {
  it('lê a grafia minúscula, que é a comum', () => {
    expect(normalizarItensDoErp([{ idproduto: '30289733', quantidade: 7 }]).itens).toEqual([
      { idProduto: '30289733', quantidade: 7 },
    ]);
  });

  it('lê as outras grafias do identificador', () => {
    const grafias = [
      { IdProduto: '1', quantidade: 5 },
      { idProduto: '2', quantidade: 5 },
      { IdProdutoERP: '3', quantidade: 5 },
      { idProdutoERP: '4', quantidade: 5 },
    ];
    expect(normalizarItensDoErp(grafias).itens.map((i) => i.idProduto)).toEqual(['1', '2', '3', '4']);
    expect(normalizarItensDoErp(grafias).semId).toBe(0);
  });

  it('lê as outras grafias da quantidade', () => {
    expect(normalizarItensDoErp([{ idproduto: '1', Quantidade: 9 }]).itens[0]?.quantidade).toBe(9);
    expect(normalizarItensDoErp([{ idproduto: '1', EstoqueAtual: 4 }]).itens[0]?.quantidade).toBe(4);
  });

  // Saldo fracionário nunca bateria com contagem inteira: viraria divergência eterna.
  it('arredonda a quantidade, como o parseQuantidade do 1.x', () => {
    expect(normalizarItensDoErp([{ idproduto: '1', quantidade: 4.6 }]).itens[0]?.quantidade).toBe(5);
    expect(normalizarItensDoErp([{ idproduto: '1', quantidade: '12' }]).itens[0]?.quantidade).toBe(12);
  });

  // Descartar transformaria "dado ruim" em "não existe no ERP" — problemas diferentes.
  it('quantidade ilegível vira 0, e o item continua na lista', () => {
    expect(normalizarItensDoErp([{ idproduto: '1', quantidade: 'abc' }]).itens[0]?.quantidade).toBe(0);
    expect(normalizarItensDoErp([{ idproduto: '1' }]).itens[0]?.quantidade).toBe(0);
  });

  it('quantidade zero é saldo válido, não ausência', () => {
    expect(normalizarItensDoErp([{ idproduto: '1', quantidade: 0 }]).itens[0]?.quantidade).toBe(0);
  });

  it('conta as linhas sem identificador em vez de fingir que não vieram', () => {
    const r = normalizarItensDoErp([
      { idproduto: '1', quantidade: 1 },
      { quantidade: 2 },
      { idproduto: '   ', quantidade: 3 },
      { idproduto: 'null', quantidade: 4 },
      null,
    ]);
    expect(r.itens).toHaveLength(1);
    expect(r.semId).toBe(4);
  });

  it('preserva zeros à esquerda para o casamento resolver depois', () => {
    expect(normalizarItensDoErp([{ idproduto: '007', quantidade: 3 }]).itens[0]?.idProduto).toBe('007');
  });

  // Só os nomes das chaves: nome de produto e preço não vão para log nenhum.
  it('reporta os campos do primeiro item, sem o conteúdo', () => {
    const r = normalizarItensDoErp([{ idproduto: '1', quantidade: 2, NomeProduto: 'CERVEJA' }]);
    expect(r.campos).toEqual(['idproduto', 'quantidade', 'NomeProduto']);
    expect(JSON.stringify(r.campos)).not.toContain('CERVEJA');
  });

  it('lista vazia não quebra', () => {
    expect(normalizarItensDoErp([])).toEqual({
      itens: [],
      semId: 0,
      campos: [],
      naoPositivos: 0,
      omiteZerados: false,
    });
  });
});

/**
 * Produto zerado no ERP simplesmente não vem na listagem. Confundir "ausente" com
 * "desconhecido" deixa na tela o saldo da última importação para justamente os produtos
 * zerados — que são os que mais precisam de correção. A conclusão sai da própria resposta,
 * e se refaz a cada leitura.
 */
describe('normalizarItensDoErp — omiteZerados', () => {
  const lista = (n: number, quantidade: number) =>
    Array.from({ length: n }, (_, i) => ({ idproduto: String(i + 1), quantidade }));

  it('amostra grande sem nenhum saldo <= 0 conclui que o ERP filtra', () => {
    const r = normalizarItensDoErp(lista(60, 3));
    expect(r.naoPositivos).toBe(0);
    expect(r.omiteZerados).toBe(true);
  });

  it('um único zero derruba a conclusão', () => {
    const r = normalizarItensDoErp([...lista(60, 3), { idproduto: 'z', quantidade: 0 }]);
    expect(r.naoPositivos).toBe(1);
    expect(r.omiteZerados).toBe(false);
  });

  it('negativo também conta como saldo não positivo', () => {
    const r = normalizarItensDoErp([...lista(60, 3), { idproduto: 'n', quantidade: -2 }]);
    expect(r.naoPositivos).toBe(1);
    expect(r.omiteZerados).toBe(false);
  });

  // Concluir a partir de 3 itens seria adivinhação com cara de dedução.
  it('amostra pequena não conclui nada, mesmo sem zeros', () => {
    expect(normalizarItensDoErp(lista(10, 5)).omiteZerados).toBe(false);
  });

  it('lista vazia não conclui', () => {
    expect(normalizarItensDoErp([]).omiteZerados).toBe(false);
  });
});

// Formato real do Nuvem3 em 2026-10-27: JSON dentro de uma string JSON.
describe('jsonDoErp', () => {
  const embrulhado = (v: unknown) => JSON.stringify(JSON.stringify(v));

  it('lê JSON normal', () => expect(jsonDoErp('{"msg":"ok"}')).toEqual({ msg: 'ok' }));

  it('desembrulha JSON dentro de string', () => {
    expect(jsonDoErp(embrulhado({ msg: 'ok' }))).toEqual({ msg: 'ok' });
    expect(erroDeNegocio(jsonDoErp(embrulhado({ msg: 'ok' })))).toBeNull();
  });

  // Antes, qualquer string passava por `erroDeNegocio` como "não é objeto" e valia como
  // aceite, inclusive uma recusa embrulhada.
  it('recusa dentro de string vira recusa', () =>
    expect(erroDeNegocio(jsonDoErp(embrulhado({ erro: 'Produto inexistente' })))).toBe(
      'Produto inexistente',
    ));

  it('texto que não é JSON por dentro continua texto', () => expect(jsonDoErp('"OK"')).toBe('OK'));

  it('corpo que não é JSON lança, como antes', () => expect(() => jsonDoErp('<html>')).toThrow());
});

// O site já recusa acima de 999.999; a API é a fronteira, e uma chamada direta não pode
// mandar ao ERP um código de barras como quantidade.
describe('POST /api/erp/estoque — teto da Quantidade', () => {
  it('recusa acima de 999.999 sem chamar o ERP', async () => {
    // Nunca o ERP de verdade: se o schema deixar passar, o handler chama este `fetch`.
    const fetchFalso = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchFalso);
    const app = Fastify();
    try {
      await app.register(rotasErp);
      const resposta = await app.inject({
        method: 'POST',
        url: '/api/erp/estoque',
        payload: {
          IdProduto: 1, HashLoja: 'H', Quantidade: 1_000_000, CodigoBarras: '', NomeProduto: 'x',
          EstoqueMinimo: 0, PrecoVenda: 0, PrecoCusto: 0,
        },
      });

      expect(resposta.statusCode).toBe(400);
      expect(fetchFalso).not.toHaveBeenCalled();
    } finally {
      // Um `fetch` falso que vaze para os outros testes esconderia uma chamada de verdade.
      await app.close();
      vi.unstubAllGlobals();
    }
  });
});

const DADOS: AtualizacaoEstoque = {
  IdProduto: 1, HashLoja: 'H-X-0001', Quantidade: 3, CodigoBarras: '', NomeProduto: 'x',
  EstoqueMinimo: 0, PrecoVenda: 0, PrecoCusto: 0,
};
const erroDeTempo = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

describe('enviarComRetry — só repete o que é transitório', () => {
  const novoLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  let log: ReturnType<typeof novoLog>;
  // Relógio falso só aqui, por causa da pausa de 1 s. O `app.inject` abaixo roda no relógio real.
  beforeEach(() => { vi.useFakeTimers(); log = novoLog(); });
  afterEach(() => vi.useRealTimers());

  async function enviar() {
    const promessa = enviarComRetry(DADOS, log as unknown as FastifyBaseLogger);
    await vi.runAllTimersAsync();
    return promessa;
  }

  it.each([
    ['recusa do ERP (200 com erro)', 1, 'recusa', () => new Response('{"erro":"TEXTO-DO-ERP"}')],
    ['4xx', 1, 'http', () => new Response('', { status: 400 })],
    ['200 que não é JSON', 1, 'nao-json', () => new Response('<html>')],
    ['5xx', 2, 'http', () => new Response('', { status: 503 })],
    ['tempo esgotado', 2, 'tempo', () => { throw erroDeTempo(); }],
    ['falha de rede', 2, 'rede', () => { throw new TypeError('fetch failed'); }],
  ])('%s: %i chamada(s) ao ERP', async (_nome, chamadas, tipo, responder) => {
    const fetchFalso = vi.fn(async () => responder());
    vi.stubGlobal('fetch', fetchFalso);
    const { ultima, tentativas } = await enviar();
    expect(fetchFalso).toHaveBeenCalledTimes(chamadas);
    expect(tentativas).toBe(chamadas);
    expect(ultima).toMatchObject({ ok: false, tipo });
    expect(ultima).not.toHaveProperty('corpo');
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({ tentativa: 1, tipo, idProduto: 1 });
    expect(log.error).toHaveBeenCalledWith({ idProduto: 1, tipo }, expect.any(String));
    // O log leva só tipo e status: nem o texto do ERP nem o hash.
    expect(JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]))
      .not.toMatch(/TEXTO-DO-ERP|H-X-0001/);
  });

  it('5xx e depois aceite: ok na segunda tentativa', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('')));
    expect(await enviar()).toEqual({ ultima: { ok: true, statusErp: 200 }, tentativas: 2 });
  });
});

describe('listarNoErp — classifica a resposta', () => {
  const JSON_UTF8 = { 'Content-Type': 'application/json; charset=utf-8' };

  it.each([
    // recon/2026-10-28-etapa-1/sonda-hash-falso.md: hash desconhecido volta HTTP 200 com `[]`.
    ['hash desconhecido (sonda 2026-10-28)', 200, '[]', { tipo: 'lista', itens: [] }],
    ['lista pura', 200, '[{"idproduto":"1","quantidade":2}]', { tipo: 'lista', itens: [{ idproduto: '1', quantidade: 2 }] }],
    ['lista em data', 200, '{"data":[]}', { tipo: 'lista', itens: [] }],
    ['lista em items', 200, '{"items":[]}', { tipo: 'lista', itens: [] }],
    ['lista dentro de string', 200, JSON.stringify('[]'), { tipo: 'lista', itens: [] }],
    ['recusa dentro de string', 200, JSON.stringify(JSON.stringify({ erro: 'Loja não encontrada' })), { tipo: 'recusa', statusErp: 200 }],
    ['texto dentro de string', 200, JSON.stringify('Loja não encontrada'), { tipo: 'recusa', statusErp: 200 }],
    ['texto que não é JSON', 200, 'Hash inválido', { tipo: 'recusa', statusErp: 200 }],
    // Spec 4.5, item 2: "texto/mensagem em vez de lista". O `erroDeNegocio` não lê `msg`.
    ['mensagem em objeto', 200, '{"msg":"Loja não encontrada"}', { tipo: 'recusa', statusErp: 200 }],
    ['lista com mensagem continua lista', 200, '{"data":[],"message":"ok"}', { tipo: 'lista', itens: [] }],
    ['corpo vazio', 200, '', { tipo: 'inesperado', formato: 'vazio', tamanho: 0 }],
    ['objeto sem lista nem recusa', 200, '{"x":1}', { tipo: 'inesperado', formato: 'object', tamanho: 7 }],
    ['404', 404, '', { tipo: 'recusa', statusErp: 404 }],
    ['503', 503, '', { tipo: 'sem-conexao', motivo: 'http', statusErp: 503 }],
  ])('%s', async (_nome, status, corpo, esperado) => {
    const fetchFalso = vi.fn(async () => new Response(corpo, { status, headers: JSON_UTF8 }));
    vi.stubGlobal('fetch', fetchFalso);
    expect(await listarNoErp('H-X-0001')).toMatchObject(esperado);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('tempo esgotado e falha de rede: sem conexão, uma chamada só', async () => {
    const abortou = vi.fn(async () => { throw erroDeTempo(); });
    vi.stubGlobal('fetch', abortou);
    expect(await listarNoErp('H-X-0001')).toEqual({ tipo: 'sem-conexao', motivo: 'tempo' });
    expect(abortou).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await listarNoErp('H-X-0001')).toEqual({ tipo: 'sem-conexao', motivo: 'rede' });
  });

  it('o hash vai só no caminho, codificado', async () => {
    const fetchFalso = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', fetchFalso);
    await listarNoErp('a/b');
    expect(fetchFalso).toHaveBeenCalledWith(`${config.erp.urlListar}/a%2Fb`, expect.anything());
  });
});

describe('rotas antigas no push A — log sem hash', () => {
  let linhas: string[];
  let app: FastifyInstance;

  async function montar(responder: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async () => responder()));
    linhas = [];
    app = Fastify(opcoesDeLog(true, { write: (l) => linhas.push(l) }));
    registrarLogDeRespostas(app);
    // onSend assíncrono, como o de cabecalhos.ts: um handler sem `return` responderia duas vezes.
    app.addHook('onSend', async () => { await new Promise((r) => setImmediate(r)); });
    await app.register(rotasErp);
  }

  afterEach(async () => {
    await app.close();
    expect(linhas.join('\n')).not.toMatch(/H-ANTIGO|TEXTO-DO-ERP|Reply was already sent/);
  });

  it('POST antigo: a recusa volta com texto fixo, e o log leva só o tipo', async () => {
    await montar(() => new Response('{"erro":"recusado TEXTO-DO-ERP H-ANTIGO-0001"}'));
    const r = await app.inject({ method: 'POST', url: '/api/erp/estoque', payload: { ...DADOS, HashLoja: 'H-ANTIGO-0001' } });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ ok: false, erro: 'O ERP recusou a atualização.', statusErp: 200, tentativas: 1 });
    expect(linhas.join('\n')).toContain('"tipo":"recusa"');
  });

  it('POST antigo aceito não devolve o corpo do ERP', async () => {
    await montar(() => new Response('{"msg":"ok"}'));
    const r = await app.inject({ method: 'POST', url: '/api/erp/estoque', payload: { ...DADOS, HashLoja: 'H-ANTIGO-0001' } });
    expect(r.json()).toEqual({ ok: true, tentativas: 1 });
  });

  it.each([
    ['lista', 200, { ok: true, itens: [{ idProduto: '1', quantidade: 2 }], recebidos: 1, semId: 0, campos: ['idproduto', 'quantidade'], naoPositivos: 0, omiteZerados: false },
      '"rota":"/api/erp/estoque/:hashLoja"', () => new Response('[{"idproduto":"1","quantidade":2}]')],
    ['tempo', 504, { ok: false, erro: 'Tempo esgotado ao buscar o estoque' }, '"motivo":"tempo"', () => { throw erroDeTempo(); }],
    ['rede', 504, { ok: false, erro: 'Falha ao buscar o estoque' }, '"motivo":"rede"', () => { throw new TypeError('fetch failed'); }],
    ['5xx', 502, { ok: false, erro: 'ERP não devolveu o estoque', statusErp: 503 }, '"statusErp":503', () => new Response('', { status: 503 })],
    ['recusa que ecoa o hash', 502, { ok: false, erro: 'O ERP recusou a consulta. Confira o HashLoja do estoque.', statusErp: 200 },
      '"tipo":"recusa"', () => new Response('{"erro":"TEXTO-DO-ERP H-ANTIGO-0002"}')],
    ['inesperado', 502, { ok: false, erro: 'Resposta do ERP em formato inesperado' }, '"formato":"object"', () => new Response('{"x":1}')],
  ])('GET antigo: %s → %i, sem o hash no log', async (_nome, status, esperado, noLog, responder) => {
    await montar(responder);
    const r = await app.inject('/api/erp/estoque/H-ANTIGO-0002');
    expect(r.statusCode).toBe(status);
    expect(r.json()).toMatchObject(esperado);
    expect(linhas.join('\n')).toContain(noLog);
  });
});
