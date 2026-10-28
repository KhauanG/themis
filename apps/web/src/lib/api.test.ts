import { beforeEach, expect, it, vi, type Mock } from 'vitest';
import { chamarApi, MENSAGEM_SESSAO, urlApi } from './api.js';

// O firebase.js real lança sem as variáveis do `.env`. Aqui só o `auth` importa.
const falso = vi.hoisted(() => ({
  auth: { authStateReady: vi.fn(async (): Promise<void> => undefined), currentUser: null as unknown },
}));
vi.mock('./firebase.js', () => ({ auth: falso.auth }));

let usuario: { getIdToken: Mock<(forcar?: boolean) => Promise<string>> };
let fetchFalso: Mock<(url: string, init: RequestInit) => Promise<Response>>;
const resposta = (status: number) => new Response('{}', { status });
const cabecalhos = (i: number) => fetchFalso.mock.calls[i]![1].headers;
const erroAuth = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  usuario = { getIdToken: vi.fn(async (forcar?: boolean) => (forcar ? 't2' : 't1')) };
  falso.auth.currentUser = usuario;
  fetchFalso = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => resposta(200));
  vi.stubGlobal('fetch', fetchFalso);
});

// O Corrigir pode passar de 20 min, e o token dura 1 h: um token pedido antes do laço pode vencer no meio dele.
it('pede um token novo a cada chamada', async () => {
  await chamarApi('/erp/hashes');
  await chamarApi('/erp/hashes');
  expect(usuario.getIdToken).toHaveBeenCalledTimes(2);
  expect(usuario.getIdToken).not.toHaveBeenCalledWith(true);
  expect(fetchFalso.mock.calls[0]![0]).toBe(urlApi('/erp/hashes'));
  expect(cabecalhos(1)).toEqual({ Authorization: 'Bearer t1' });
});

it('com corpo manda o cabeçalho JSON e repassa o init', async () => {
  await chamarApi('/erp/lojas/E1/hash', { method: 'PUT', body: '{"hash":"H-X-0001"}' });
  expect(fetchFalso.mock.calls[0]![1]).toMatchObject({ method: 'PUT', body: '{"hash":"H-X-0001"}' });
  expect(cabecalhos(0)).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t1' });
});

// DELETE com Content-Type JSON e corpo vazio dá 400 na Fastify (FST_ERR_CTP_EMPTY_JSON_BODY).
it('sem corpo não manda Content-Type', async () => {
  await chamarApi('/erp/lojas/E1/hash', { method: 'DELETE' });
  expect(cabecalhos(0)).toEqual({ Authorization: 'Bearer t1' });
});

it('em 401 renova uma vez e tenta de novo', async () => {
  fetchFalso.mockResolvedValueOnce(resposta(401));
  const r = await chamarApi('/erp/lojas/E1/estoque', { method: 'POST', body: '{"IdProduto":1}' });
  expect(r.status).toBe(200);
  expect(usuario.getIdToken.mock.calls.map(([forcar]) => forcar === true)).toEqual([false, true]);
  expect(cabecalhos(1)).toMatchObject({ Authorization: 'Bearer t2' });
  expect(fetchFalso.mock.calls[1]![1].body).toBe('{"IdProduto":1}');
});

it('401 de novo não entra em laço', async () => {
  fetchFalso.mockResolvedValueOnce(resposta(401)).mockResolvedValueOnce(resposta(401));
  expect((await chamarApi('/erp/hashes')).status).toBe(401);
  expect(fetchFalso).toHaveBeenCalledTimes(2);
});

it('403 não renova', async () => {
  fetchFalso.mockResolvedValueOnce(resposta(403));
  expect((await chamarApi('/erp/hashes')).status).toBe(403);
  expect(fetchFalso).toHaveBeenCalledTimes(1);
  expect(usuario.getIdToken).toHaveBeenCalledTimes(1);
});

it('sem usuário: 401 com a mensagem de sessão, sem rede', async () => {
  falso.auth.currentUser = null;
  const r = await chamarApi('/erp/hashes');
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({ ok: false, erro: MENSAGEM_SESSAO });
  expect(fetchFalso).not.toHaveBeenCalled();
});

// Sessão revogada ou vencida: o laço do Corrigir tem de parar, não marcar item por item.
it.each(['auth/user-token-expired', 'auth/user-disabled', 'auth/invalid-user-token'])(
  'getIdToken falha com %s: 401 com a mensagem de sessão, sem rede',
  async (code) => {
    usuario.getIdToken.mockRejectedValueOnce(erroAuth(code));
    const r = await chamarApi('/erp/hashes');
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false, erro: MENSAGEM_SESSAO });
    expect(fetchFalso).not.toHaveBeenCalled();
  },
);

it('renovação forçada que falha devolve 401 de sessão sem tentar de novo', async () => {
  fetchFalso.mockResolvedValueOnce(resposta(401));
  usuario.getIdToken.mockResolvedValueOnce('t1').mockRejectedValueOnce(erroAuth('auth/user-token-expired'));
  const r = await chamarApi('/erp/hashes');
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({ ok: false, erro: MENSAGEM_SESSAO });
  expect(fetchFalso).toHaveBeenCalledTimes(1);
});

it('falha de rede no getIdToken é relançada', async () => {
  usuario.getIdToken.mockRejectedValueOnce(erroAuth('auth/network-request-failed'));
  await expect(chamarApi('/erp/hashes')).rejects.toMatchObject({ code: 'auth/network-request-failed' });
  expect(fetchFalso).not.toHaveBeenCalled();
});

it('espera o login ser restaurado antes de ler o usuário', async () => {
  falso.auth.currentUser = null;
  falso.auth.authStateReady.mockImplementationOnce(async () => {
    falso.auth.currentUser = usuario;
  });
  expect((await chamarApi('/erp/hashes')).status).toBe(200);
});
