import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvioEstoque } from '@themis/shared';
import { chamarApi } from './api.js';
import {
  apagarHashDaLoja, buscarEstoqueDoErp, enviarAoErp, lerHashesConfigurados, salvarHashDaLoja, testarHash, tomDoTeste,
  type ResultadoTesteHash, type VeredictoTeste,
} from './erp.js';

// Token e renovação são da Task 12 (api.test.ts). Aqui só importam o caminho e o corpo.
vi.mock('./api.js', () => ({ chamarApi: vi.fn() }));

const api = vi.mocked(chamarApi);
const responder = (status: number, corpo: unknown) =>
  api.mockResolvedValueOnce(new Response(JSON.stringify(corpo), { status }));

beforeEach(() => vi.clearAllMocks());

describe('lerHashesConfigurados', () => {
  it('devolve só os ids das lojas com hash', async () => {
    responder(200, { ok: true, configurados: ['A', 'B'] });
    expect(await lerHashesConfigurados()).toEqual(new Set(['A', 'B']));
    expect(api).toHaveBeenCalledWith('/erp/hashes');
  });

  it('lança quando a API falha', async () => {
    responder(503, { ok: false, erro: 'Não foi possível conferir a configuração agora. Tente de novo em instantes.' });
    await expect(lerHashesConfigurados()).rejects.toThrow('Falha 503');
  });
});

describe('salvarHashDaLoja e apagarHashDaLoja', () => {
  it('PUT leva o hash só no corpo, e o id vai codificado', async () => {
    responder(200, { ok: true });
    expect(await salvarHashDaLoja('E/1', 'H-X-0001')).toEqual({ ok: true });
    expect(api).toHaveBeenCalledWith('/erp/lojas/E%2F1/hash', { method: 'PUT', body: '{"hash":"H-X-0001"}' });
  });

  it('DELETE vai sem corpo, e por isso sem Content-Type', async () => {
    responder(200, { ok: true });
    expect(await apagarHashDaLoja('E1')).toEqual({ ok: true });
    // Com Content-Type JSON e corpo vazio, a Fastify responde FST_ERR_CTP_EMPTY_JSON_BODY.
    expect(api).toHaveBeenCalledWith('/erp/lojas/E1/hash', { method: 'DELETE' });
  });

  it('o erro da API vem como veio, e só 401, 403, 409 e 503 param o laço', async () => {
    responder(409, { ok: false, erro: 'Este hash já está configurado em outra loja.' });
    expect(await salvarHashDaLoja('E1', 'H-Y-0002'))
      .toEqual({ ok: false, erro: 'Este hash já está configurado em outra loja.', parar: true });
    // toStrictEqual: nos outros status a chave `parar` não existe.
    responder(400, { ok: false, erro: 'HashLoja inválido: cole só o código, sem espaços no meio.' });
    expect(await salvarHashDaLoja('E1', 'H-X 0001'))
      .toStrictEqual({ ok: false, erro: 'HashLoja inválido: cole só o código, sem espaços no meio.' });
    api.mockResolvedValueOnce(new Response('<html>', { status: 502 }));
    expect(await apagarHashDaLoja('E1')).toStrictEqual({ ok: false, erro: 'Falha 502' });
  });
});

describe('testarHash', () => {
  it('sem candidato manda {}; com candidato, o hash vai só no corpo', async () => {
    const corpo = { ok: true, veredicto: 'ok', mensagem: 'Hash ok.', recebidos: 2, alertaSaldos: false };
    responder(200, corpo);
    responder(200, corpo);
    expect(await testarHash('E1')).toMatchObject({ ok: true, veredicto: 'ok', mensagem: 'Hash ok.', alertaSaldos: false });
    await testarHash('E1', 'CANDIDATO-1');
    expect(api.mock.calls).toEqual([
      ['/erp/lojas/E1/teste', { method: 'POST', body: '{}' }],
      ['/erp/lojas/E1/teste', { method: 'POST', body: '{"hash":"CANDIDATO-1"}' }],
    ]);
  });

  it('falha HTTP vira mensagem, sem veredicto', async () => {
    responder(403, { ok: false, erro: 'Só o master pode trocar ou testar outro HashLoja.' });
    expect(await testarHash('E1', 'CANDIDATO-1'))
      .toEqual({ ok: false, mensagem: 'Só o master pode trocar ou testar outro HashLoja.' });
  });
});

it('sem resposta do servidor, salvar, apagar e testar não lançam', async () => {
  for (let i = 0; i < 3; i++) api.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  expect(await salvarHashDaLoja('E1', 'H-X-0001')).toEqual({ ok: false, erro: 'Sem resposta do servidor' });
  expect(await apagarHashDaLoja('E1')).toEqual({ ok: false, erro: 'Sem resposta do servidor' });
  expect(await testarHash('E1')).toEqual({ ok: false, mensagem: 'Sem resposta do servidor' });
});

describe('tomDoTeste decide pelo veredicto', () => {
  // A API manda `ok: true` em todo veredicto. Só a falha HTTP vem sem veredicto.
  const r = (veredicto?: VeredictoTeste, alertaSaldos?: boolean): ResultadoTesteHash =>
    ({ ok: veredicto !== undefined, veredicto, mensagem: 'x', alertaSaldos });

  it.each([
    ['ok sem alerta', r('ok', false), 'success'],
    ['ok com alerta de saldos', r('ok', true), 'warning'],
    ['sem-amostra', r('sem-amostra'), 'warning'],
    ['nenhum-id', r('nenhum-id'), 'warning'],
    // Hash falso volta 200 com [] (recon/2026-10-28-etapa-1/sonda-hash-falso.md): `vazio` é o hash errado de verdade.
    ['vazio', r('vazio'), 'error'],
    ['recusado', r('recusado'), 'error'],
    ['sem-conexao', r('sem-conexao'), 'error'],
    ['inesperado', r('inesperado'), 'error'],
    ['falha HTTP, sem veredicto', r(), 'error'],
  ])('%s', (_nome, resultado, tom) => {
    expect(tomDoTeste(resultado)).toBe(tom);
  });
});

const ENVIO: EnvioEstoque = {
  IdProduto: 7, Quantidade: 3, CodigoBarras: '', NomeProduto: 'Skol Lata', EstoqueMinimo: 0, PrecoVenda: 0, PrecoCusto: 0,
};
const resposta = (status: number, corpo: object) => new Response(JSON.stringify(corpo), { status });

describe('enviarAoErp — só a loja vai ao servidor', () => {
  it('manda só a loja na URL e nenhum HashLoja', async () => {
    vi.mocked(chamarApi).mockResolvedValue(resposta(200, { ok: true, tentativas: 1 }));
    expect(await enviarAoErp('E1', ENVIO)).toEqual({ ok: true });
    const [caminho, init] = vi.mocked(chamarApi).mock.calls[0]!;
    expect(caminho).toBe('/erp/lojas/E1/estoque');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(ENVIO);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([401, 403, 409, 503])('%i para o laço', async (status) => {
    vi.mocked(chamarApi).mockResolvedValue(resposta(status, { ok: false, erro: 'motivo da API' }));
    expect(await enviarAoErp('E1', ENVIO)).toEqual({ ok: false, erro: 'motivo da API', parar: true });
  });

  it('502 do ERP não para o laço', async () => {
    vi.mocked(chamarApi).mockResolvedValue(resposta(502, { ok: false, erro: 'O ERP recusou', tentativas: 1 }));
    const r = await enviarAoErp('E1', ENVIO);
    expect(r).toMatchObject({ ok: false, erro: 'O ERP recusou' });
    expect(r.parar).toBeFalsy();
  });

  it('sem resposta do servidor não para o laço', async () => {
    vi.mocked(chamarApi).mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await enviarAoErp('E1', ENVIO)).toEqual({ ok: false, erro: 'Sem resposta do servidor' });
  });
});

describe('buscarEstoqueDoErp — pela loja', () => {
  it('chama a rota da loja e indexa as grafias do id', async () => {
    vi.mocked(chamarApi).mockResolvedValue(resposta(200, {
      ok: true, itens: [{ idProduto: '007', quantidade: 3 }], recebidos: 1, semId: 0,
      campos: ['idproduto', 'quantidade'], naoPositivos: 0, omiteZerados: false,
    }));
    const r = await buscarEstoqueDoErp('E1');
    const [caminho, init] = vi.mocked(chamarApi).mock.calls[0]!;
    expect(caminho).toBe('/erp/lojas/E1/estoque');
    expect(init?.method).toBeUndefined();
    expect(init?.body).toBeUndefined();
    expect(r).toMatchObject({ ok: true, itens: 1, recebidos: 1 });
    expect(r.estoque.get('7')).toBe(3);
  });

  it('erro da API vem como está', async () => {
    vi.mocked(chamarApi).mockResolvedValue(resposta(409, { ok: false, erro: 'Esta loja não tem HashLoja configurado.' }));
    expect(await buscarEstoqueDoErp('E1')).toMatchObject({ ok: false, erro: 'Esta loja não tem HashLoja configurado.', itens: 0 });
  });
});
