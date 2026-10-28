import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc } from 'firebase/firestore';
import { chamarApi } from './api.js';
import {
  apagarHashDaLoja, carregarHashes, lerHashesConfigurados, salvarHashDaLoja, testarHash, tomDoTeste,
  type ResultadoTesteHash, type VeredictoTeste,
} from './erp.js';

// O módulo real de `firebase.js` lança sem as variáveis do `.env`; aqui só o `db` importa.
vi.mock('./firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  getDoc: vi.fn(),
  doc: vi.fn((_db: unknown, ...p: string[]) => ({ path: p.join('/') })),
}));
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

describe('carregarHashes — lê os dois mapas', () => {
  it('o mapa novo vence o legado', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ inventoryHashes: { A: 'velho', B: 'b1' }, hashes: { A: 'novo' } }),
    } as never);
    expect(await carregarHashes()).toEqual(new Map([['A', 'novo'], ['B', 'b1']]));
  });
});
