import { generateKeyPairSync } from 'node:crypto';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Credencial } from './credencial.js';
import {
  ErroGoogle, ESCOPO, URL_DOCUMENTOS, URL_TOKEN,
  conferirCredencial, criarFirestoreServidor, type FirestoreServidor,
} from './google.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const CRED: Credencial = {
  projectId: 'auditoria-icebeer',
  clientEmail: 'themis-api@auditoria-icebeer.iam.gserviceaccount.com',
  idChave: 'k1',
  chavePrivada: privateKey,
};
const AGORA = Date.UTC(2026, 9, 28, 12, 0, 0);
let agora: number;
let filaToken: Array<Response | Error>;
let filaFirestore: Array<Response | Error>;
let pedidosToken: number;

const fetchFalso = vi.fn(async (entrada: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
  const url = String(entrada);
  if (url === URL_TOKEN) pedidosToken++;
  const r = url === URL_TOKEN
    ? filaToken.shift() ?? Response.json({ access_token: `acesso-${pedidosToken}`, expires_in: 3599, token_type: 'Bearer' })
    : filaFirestore.shift() ?? new Error(`sem resposta preparada: ${url}`);
  if (!(r instanceof Response)) throw r;
  return r;
});
const chamadasFirestore = () => fetchFalso.mock.calls.filter(([u]) => String(u) !== URL_TOKEN);
const autorizacao = (i: number) => new Headers(chamadasFirestore()[i]?.[1]?.headers).get('authorization');
const servidor = () => criarFirestoreServidor(CRED, () => agora);
const status = (n: number) => new Response('H-SEGREDO', { status: n });
const str = (v: string) => ({ stringValue: v });
const int = (n: number) => ({ integerValue: String(n) });
const mapa = (fields: Record<string, unknown>) => ({ mapValue: { fields } });
const doc = (fields?: Record<string, unknown>) => Response.json(fields ? { fields } : {});

beforeEach(() => {
  agora = AGORA; filaToken = []; filaFirestore = []; pedidosToken = 0;
  fetchFalso.mockClear();
  vi.stubGlobal('fetch', fetchFalso);
});

describe('token da conta de serviço', () => {
  it('assina o JWT da conta de serviço e guarda o token', async () => {
    filaFirestore = [doc(), doc()];
    const fs = servidor();
    await fs.lerHashes();
    await fs.lerHashes();
    expect(pedidosToken).toBe(1);
    const [, init] = fetchFalso.mock.calls.find(([u]) => String(u) === URL_TOKEN)!;
    expect(init?.method).toBe('POST');
    // URLSearchParams faz o fetch mandar `application/x-www-form-urlencoded`; um texto iria como text/plain.
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const assertion = form.get('assertion')!;
    expect(decodeProtectedHeader(assertion)).toMatchObject({ alg: 'RS256', kid: 'k1' });
    const { payload } = await jwtVerify(assertion, await importSPKI(publicKey, 'RS256'), {
      issuer: CRED.clientEmail, audience: URL_TOKEN, currentDate: new Date(AGORA),
    });
    expect(payload.scope).toBe(ESCOPO);
    expect(payload.iat).toBe(AGORA / 1000 - 60);
    expect(payload.exp! - payload.iat!).toBe(3600);
    expect([autorizacao(0), autorizacao(1)]).toEqual(['Bearer acesso-1', 'Bearer acesso-1']);
    for (const [, i] of fetchFalso.mock.calls) expect(i?.signal).toBeInstanceOf(AbortSignal);
  });

  it('renova o token depois de 55 min', async () => {
    filaFirestore = [doc(), doc(), doc()];
    const fs = servidor();
    await fs.lerHashes();
    agora += 54 * 60_000; await fs.lerHashes(); expect(pedidosToken).toBe(1);
    agora += 2 * 60_000; await fs.lerHashes(); expect(pedidosToken).toBe(2);
  });

  it('falha no pedido do token não fica guardada', async () => {
    filaToken = [status(500)];
    filaFirestore = [doc()];
    const fs = servidor();
    await expect(fs.lerHashes()).rejects.toMatchObject({ name: 'ErroGoogle', etapa: 'token', statusGoogle: 500, message: 'token 500' });
    await expect(fs.lerHashes()).resolves.toEqual(new Map());
    expect(pedidosToken).toBe(2);
  });

  it('401 do Firestore descarta o token e tenta uma vez', async () => {
    filaFirestore = [status(401), doc()];
    await expect(servidor().lerHashes()).resolves.toEqual(new Map());
    expect(pedidosToken).toBe(2);
    expect(autorizacao(1)).toBe('Bearer acesso-2');
  });

  it('dois 401 seguidos rejeitam sem laço', async () => {
    filaFirestore = [status(401), status(401)];
    await expect(servidor().lerHashes()).rejects.toMatchObject({ etapa: 'firestore', statusGoogle: 401 });
    expect(chamadasFirestore()).toHaveLength(2);
    expect(pedidosToken).toBe(2);
  });

  it('chave que não importa só falha quando alguém pede o token', async () => {
    const fs = criarFirestoreServidor({ ...CRED, chavePrivada: 'nao-e-chave' }, () => agora);
    // Importar na construção deixaria aqui uma rejeição sem dono, e o Vitest falha a rodada.
    await new Promise((r) => setImmediate(r));
    expect(fetchFalso).not.toHaveBeenCalled();
    await expect(fs.lerHashes()).rejects.toThrow();
    expect(pedidosToken).toBe(0);
  });
});

describe('erros do Google', () => {
  it('erro do Firestore não leva o corpo nem usa o campo status', async () => {
    filaFirestore = [status(500)];
    const erro = await servidor().lerHashes().catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroGoogle);
    expect(erro).toMatchObject({ name: 'ErroGoogle', etapa: 'firestore', statusGoogle: 500, message: 'firestore 500' });
    expect(String((erro as Error).stack)).not.toContain('H-SEGREDO');
    expect(erro).not.toHaveProperty('status');
    expect(erro).not.toHaveProperty('statusCode');
  });

  it.each([
    ['tempo esgotado no Firestore', () => { filaFirestore = [new DOMException('tempo', 'TimeoutError')]; }, 'firestore'],
    ['rede no pedido do token', () => { filaToken = [new TypeError('fetch failed')]; }, 'token'],
  ])('%s vira status 0', async (_nome, preparar, etapa) => {
    preparar();
    await expect(servidor().lerHashes()).rejects.toMatchObject({ etapa, statusGoogle: 0, message: `${etapa} 0` });
  });
});

describe('lerPerfil', () => {
  it('lerPerfil pede só os três campos e decodifica com tipo', async () => {
    filaFirestore = [
      doc({ isAdmin: { booleanValue: true }, isMaster: { nullValue: null }, allowedInventories: { arrayValue: { values: [str('X'), int(7)] } } }),
      doc({ isAdmin: str('true'), isMaster: { timestampValue: '2026-10-28T12:00:00Z' }, allowedInventories: { arrayValue: {} } }),
    ];
    const fs = servidor();
    expect(await fs.lerPerfil('u/1')).toEqual({ isAdmin: true, isMaster: null, allowedInventories: ['X', 7] });
    expect(await fs.lerPerfil('u2')).toEqual({ isAdmin: 'true', allowedInventories: [] });
    expect(String(chamadasFirestore()[0]![0])).toBe(
      `${URL_DOCUMENTOS}/users/u%2F1?mask.fieldPaths=isMaster&mask.fieldPaths=isAdmin&mask.fieldPaths=allowedInventories`,
    );
  });

  it('lerPerfil: 404 dá null; documento sem campos dá {}', async () => {
    filaFirestore = [status(404), doc()];
    const fs = servidor();
    expect(await fs.lerPerfil('semDoc')).toBeNull();
    expect(await fs.lerPerfil('vazio')).toEqual({});
  });
});

describe('lerHashes', () => {
  it('lerHashes junta os dois mapas como o site: o novo vence, depois apara e descarta vazio', async () => {
    filaFirestore = [doc({
      inventoryHashes: mapa({ A: str('velho'), B: str(' b1 '), D: str('velho') }),
      hashes: mapa({ A: str('novo'), C: str(''), D: str('') }),
      updatedAt: { timestampValue: '2026-10-28T12:00:00Z' },
    })];
    expect(await servidor().lerHashes()).toEqual(new Map([['A', 'novo'], ['B', 'b1']]));
    expect(String(chamadasFirestore()[0]![0])).toBe(`${URL_DOCUMENTOS}/hashConfigs/inventoryHashes`);
  });

  it('lerHashes: documento ausente ou mapa vazio dá Map vazio', async () => {
    filaFirestore = [status(404), doc({ hashes: { mapValue: {} } })];
    const fs = servidor();
    expect(await fs.lerHashes()).toEqual(new Map());
    expect(await fs.lerHashes()).toEqual(new Map());
  });
});

describe('gravarHash', () => {
  const urlGravar = (id: string) =>
    `${URL_DOCUMENTOS}/hashConfigs/inventoryHashes?updateMask.fieldPaths=hashes.%60${id}%60&updateMask.fieldPaths=inventoryHashes.%60${id}%60&updateMask.fieldPaths=updatedAt`;
  const quando = { timestampValue: new Date(AGORA).toISOString() };

  it('gravarHash grava só a chave da loja e apaga a do legado', async () => {
    filaFirestore = [doc()];
    await servidor().gravarHash('X', 'H-X-0001');
    const [url, init] = chamadasFirestore()[0]!;
    expect(String(url)).toBe(urlGravar('X'));
    expect(init?.method).toBe('PATCH');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ fields: { hashes: mapa({ X: str('H-X-0001') }), updatedAt: quando } });
  });

  it('gravarHash vazio apaga nos dois mapas', async () => {
    filaFirestore = [doc()];
    await servidor().gravarHash('X', '');
    const [url, init] = chamadasFirestore()[0]!;
    expect(String(url)).toBe(urlGravar('X'));
    expect(JSON.parse(String(init?.body))).toEqual({ fields: { updatedAt: quando } });
  });

  it.each(['1abc', 'inventory_1690000000000'])('id que começa com dígito vai entre crases (%s)', async (id) => {
    filaFirestore = [doc()];
    await servidor().gravarHash(id, 'H-X-0001');
    expect(String(chamadasFirestore()[0]![0])).toBe(urlGravar(id));
  });
});

describe('lerAmostra', () => {
  const urlAmostra = `${URL_DOCUMENTOS}/estoques/X/produtos?pageSize=100&mask.fieldPaths=IdProduto&mask.fieldPaths=idProduto&mask.fieldPaths=estoqueSistema&mask.fieldPaths=EstoqueAtual`;
  const pagina = (campos: Array<Record<string, unknown> | undefined>, nextPageToken?: string) =>
    Response.json({ documents: campos.map((f) => ({ name: 'p', ...(f && { fields: f }) })), ...(nextPageToken && { nextPageToken }) });
  const comId = (n: number, base: number) => Array.from({ length: n }, (_, i) => ({ IdProduto: int(base + i) }));

  it('lerAmostra lê a URL exata, pula produto sem id e para em 100', async () => {
    filaFirestore = [pagina([...Array(10).fill(undefined), ...comId(50, 1)], 'p2'), pagina(comId(80, 100), 'p3')];
    const amostra = await servidor().lerAmostra('X');
    expect(amostra).toHaveLength(100);
    expect(amostra[0]).toEqual({ idProduto: 1 });
    expect(chamadasFirestore().map(([u]) => String(u))).toEqual([urlAmostra, `${urlAmostra}&pageToken=p2`]);
  });

  // Loja nova: o REST devolve `{}`, sem `documents`. É o caso do veredito `sem-amostra`.
  it('lerAmostra: coleção vazia ({} sem documents) dá []', async () => {
    filaFirestore = [Response.json({})];
    expect(await servidor().lerAmostra('X')).toEqual([]);
    expect(chamadasFirestore()).toHaveLength(1);
  });

  it('lerAmostra lê no máximo 5 páginas', async () => {
    filaFirestore = Array.from({ length: 6 }, () => pagina([undefined, { IdProduto: str('  ') }], 'mais'));
    expect(await servidor().lerAmostra('X')).toEqual([]);
    expect(chamadasFirestore()).toHaveLength(5);
  });

  it('lerAmostra usa o saldo guardado: estoqueSistema, senão EstoqueAtual, só número', async () => {
    filaFirestore = [pagina([
      { IdProduto: int(7), estoqueSistema: int(5) },
      { idProduto: str('007'), EstoqueAtual: { doubleValue: 2.5 } },
      { IdProduto: str('8'), estoqueSistema: str('x') },
      { IdProduto: str('9'), idProduto: str('10') },
    ])];
    expect(await servidor().lerAmostra('X')).toEqual([
      { idProduto: 7, estoqueSistema: 5 },
      { idProduto: '007', estoqueSistema: 2.5 },
      { idProduto: '8' },
      { idProduto: '9' },
    ]);
  });
});

describe('conferirCredencial', () => {
  it('sem credencial: false, sem aviso e sem rede', async () => {
    const avisar = vi.fn();
    expect(await conferirCredencial(null, avisar)).toBe(false);
    expect(avisar).not.toHaveBeenCalled();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('leu hashConfigs: true', async () => {
    filaFirestore = [doc()];
    const avisar = vi.fn();
    expect(await conferirCredencial(servidor(), avisar)).toBe(true);
    expect(avisar).not.toHaveBeenCalled();
  });

  it('Firestore 403: false, e o aviso leva só etapa e status', async () => {
    filaFirestore = [status(403)];
    const avisar = vi.fn();
    expect(await conferirCredencial(servidor(), avisar)).toBe(false);
    expect(avisar.mock.calls).toEqual([['Credencial do Firebase não conferiu (firestore 403).']]);
  });

  it('erro que não é do Google: false, e o aviso leva só o nome', async () => {
    const fs = { lerHashes: () => Promise.reject(new TypeError('H-SEGREDO')) } as unknown as FirestoreServidor;
    const avisar = vi.fn();
    expect(await conferirCredencial(fs, avisar)).toBe(false);
    expect(avisar.mock.calls).toEqual([['Credencial do Firebase não conferiu (TypeError).']]);
  });
});
