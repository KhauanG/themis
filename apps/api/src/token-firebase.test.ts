import {
  createLocalJWKSet, createRemoteJWKSet, exportJWK, generateKeyPair, SignJWT,
  type GenerateKeyPairResult, type JSONWebKeySet, type JWTPayload,
} from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PROJETO } from './credencial.js';
import { ErroGoogle } from './google.js';
import { criarVerificador, EMISSOR, URL_CHAVES_FIREBASE } from './token-firebase.js';

let par: GenerateKeyPairResult;
let outroPar: GenerateKeyPairResult;
let jwks: JSONWebKeySet;
let verificar: (token: string) => Promise<string>;

beforeAll(async () => {
  par = await generateKeyPair('RS256');
  outroPar = await generateKeyPair('RS256');
  jwks = { keys: [{ ...(await exportJWK(par.publicKey)), kid: 'k1', alg: 'RS256' }] };
  verificar = criarVerificador(createLocalJWKSet(jwks));
});

const agora = () => Math.floor(Date.now() / 1000);
const SEGREDO_HS = new TextEncoder().encode('segredo-de-teste-com-32-bytes-ok');

// `undefined` some do JSON: é assim que um teste tira uma claim.
function claims(extra: JWTPayload = {}): JWTPayload {
  const t = agora();
  return { iss: EMISSOR, aud: PROJETO, sub: 'uid-1', iat: t, exp: t + 3600, auth_time: t, ...extra };
}

function assinar(extra: JWTPayload = {}, kid = 'k1', chave: GenerateKeyPairResult['privateKey'] | Uint8Array = par.privateKey, alg = 'RS256') {
  return new SignJWT(claims(extra)).setProtectedHeader({ alg, kid }).sign(chave);
}

describe('criarVerificador — o que passa', () => {
  it('token válido devolve o uid', async () => {
    expect(await verificar(await assinar())).toBe('uid-1');
  });

  it('expirado há 20 s passa; há 40 s não', async () => {
    const t = agora();
    expect(await verificar(await assinar({ iat: t - 3620, exp: t - 20, auth_time: t - 3620 }))).toBe('uid-1');
    await expect(verificar(await assinar({ iat: t - 3640, exp: t - 40, auth_time: t - 3640 }))).rejects.toThrow();
  });

  it('iat e auth_time 20 s no futuro passam', async () => {
    const t = agora();
    expect(await verificar(await assinar({ iat: t + 20, auth_time: t + 20, exp: t + 3620 }))).toBe('uid-1');
  });

  it('sub com 128 caracteres passa', async () => {
    expect(await verificar(await assinar({ sub: 'u'.repeat(128) }))).toBe('u'.repeat(128));
  });
});

describe('criarVerificador — o que é recusado vira 401, nunca ErroGoogle', () => {
  it.each<[string, () => Promise<string>]>([
    ['aud de outro projeto', () => assinar({ aud: 'outro-projeto' })],
    ['iss de outro projeto', () => assinar({ iss: 'https://securetoken.google.com/outro-projeto' })],
    ['sub vazio', () => assinar({ sub: '' })],
    ['sub com 129 caracteres', () => assinar({ sub: 'u'.repeat(129) })],
    ['sub que não é texto', () => assinar({ sub: 7 as unknown as string })],
    ['sem sub', () => assinar({ sub: undefined })],
    ['sem iat', () => assinar({ iat: undefined })],
    ['sem exp', () => assinar({ exp: undefined })],
    ['sem auth_time', () => assinar({ auth_time: undefined })],
    ['auth_time em texto', () => assinar({ auth_time: String(agora()) })],
    ['auth_time 60 s no futuro', () => assinar({ auth_time: agora() + 60 })],
    ['iat 60 s no futuro', () => assinar({ iat: agora() + 60 })],
    ['iat de mais de 1 h, com exp no futuro', () => assinar({ iat: agora() - 3700, exp: agora() + 60 })],
    ['kid desconhecido', () => assinar({}, 'k9')],
    // Pega quem só decodifica o token sem conferir a assinatura.
    ['assinado por outra chave com o mesmo kid', () => assinar({}, 'k1', outroPar.privateKey)],
    ['assinado com HS256', () => assinar({}, 'k1', SEGREDO_HS, 'HS256')],
  ])('%s', async (_nome, fazerToken) => {
    const erro = await verificar(await fazerToken()).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro).not.toBeInstanceOf(ErroGoogle);
  });
});

describe('chaves do Google', () => {
  it('o padrão busca URL_CHAVES_FIREBASE pelo fetch global, uma vez por módulo', async () => {
    const fetchFalso = vi.fn(async (_url: string) => Response.json(jwks));
    vi.stubGlobal('fetch', fetchFalso);
    expect(await criarVerificador()(await assinar())).toBe('uid-1');
    expect(await criarVerificador()(await assinar({ sub: 'uid-2' }))).toBe('uid-2');
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(String(fetchFalso.mock.calls[0]?.[0])).toBe(URL_CHAVES_FIREBASE);
  });

  it.each<[string, () => Promise<Response>]>([
    ['HTTP 500', async () => new Response('', { status: 500 })],
    ['corpo que não é JSON', async () => new Response('<html>')],
    ['JSON que não é JWKS', async () => Response.json({ x: 1 })],
    ['falha de rede', async () => { throw new TypeError('fetch failed'); }],
    ['tempo esgotado', async () => { throw new DOMException('tempo', 'TimeoutError'); }],
  ])('%s vira ErroGoogle chaves 0', async (_nome, resposta) => {
    vi.stubGlobal('fetch', vi.fn(resposta));
    const verificarRemoto = criarVerificador(createRemoteJWKSet(new URL(URL_CHAVES_FIREBASE)));
    const erro = await verificarRemoto(await assinar()).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroGoogle);
    expect(erro).toMatchObject({ etapa: 'chaves', statusGoogle: 0 });
  });
});
