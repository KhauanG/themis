/**
 * Firestore pela conta de serviço, pelo REST v1 com token OAuth assinado com `jose`.
 * REST em vez de `firebase-admin`: a API sai num bundle único (`apps/api/build.mjs:1-13`),
 * e o admin traz gRPC e protos lidos de arquivo.
 * Este módulo não loga nada; o erro leva só etapa e status, nunca URL, corpo ou cabeçalho.
 */
import { importPKCS8, SignJWT } from 'jose';
import type { Perfil } from './acesso.js';
import { PROJETO, type Credencial } from './credencial.js';

export const URL_TOKEN = 'https://oauth2.googleapis.com/token';
export const ESCOPO = 'https://www.googleapis.com/auth/datastore';
export const URL_DOCUMENTOS = `https://firestore.googleapis.com/v1/projects/${PROJETO}/databases/(default)/documents`;

const TEMPO_LIMITE_MS = 10_000;
const VALIDADE_TOKEN_MS = 55 * 60_000;
const DOC_HASHES = `${URL_DOCUMENTOS}/hashConfigs/inventoryHashes`;

/** `statusGoogle` e não `status`: a Fastify usaria `status` como o status HTTP da resposta. 0 = rede ou tempo. */
export class ErroGoogle extends Error {
  override readonly name = 'ErroGoogle';
  constructor(
    readonly etapa: 'token' | 'firestore' | 'chaves',
    readonly statusGoogle: number,
  ) {
    super(`${etapa} ${statusGoogle}`);
  }
}

export interface ProdutoDaAmostra {
  idProduto: string | number;
  estoqueSistema?: number;
}

export interface FirestoreServidor {
  lerPerfil(uid: string): Promise<Perfil>;
  lerHashes(): Promise<Map<string, string>>;
  gravarHash(inventoryId: string, hash: string): Promise<void>;
  lerAmostra(inventoryId: string): Promise<ProdutoDaAmostra[]>;
}

type Campos = Record<string, unknown>;

function decodificarValor(valor: unknown): unknown {
  const v = (valor ?? {}) as Record<string, unknown>;
  if ('stringValue' in v) return v['stringValue'];
  if ('booleanValue' in v) return v['booleanValue'];
  if ('integerValue' in v) return Number(v['integerValue']);
  if ('doubleValue' in v) return Number(v['doubleValue']);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) {
    const lista = (v['arrayValue'] as { values?: unknown[] } | undefined)?.values ?? [];
    return lista.map(decodificarValor);
  }
  if ('mapValue' in v) return decodificarCampos((v['mapValue'] as { fields?: Campos } | undefined)?.fields);
  return undefined;
}

function decodificarCampos(campos: Campos | undefined): Campos {
  return Object.fromEntries(Object.entries(campos ?? {}).map(([k, v]) => [k, decodificarValor(v)]));
}

const comoMapa = (v: unknown): Campos => (v && typeof v === 'object' ? (v as Campos) : {});
const comId = (v: unknown): v is string | number =>
  typeof v === 'number' || (typeof v === 'string' && v.trim() !== '');

export function criarFirestoreServidor(cred: Credencial, agora: () => number = Date.now): FirestoreServidor {
  // Importada só no primeiro pedido: na construção, uma chave ruim viraria rejeição sem dono.
  let chave: ReturnType<typeof importPKCS8> | undefined;
  let guardado: { token: string; vence: number } | undefined;

  async function pedir(etapa: ErroGoogle['etapa'], url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
    } catch {
      throw new ErroGoogle(etapa, 0);
    }
  }

  async function token(): Promise<string> {
    if (guardado && agora() < guardado.vence) return guardado.token;
    chave ??= importPKCS8(cred.chavePrivada, 'RS256');
    // 60 s para trás: o Google recusa `iat` no futuro, e o relógio do servidor não é conhecido.
    const iat = Math.floor(agora() / 1000) - 60;
    const assertion = await new SignJWT({ scope: ESCOPO })
      .setProtectedHeader(cred.idChave ? { alg: 'RS256', kid: cred.idChave } : { alg: 'RS256' })
      .setIssuer(cred.clientEmail)
      .setAudience(URL_TOKEN)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(await chave);
    const r = await pedir('token', URL_TOKEN, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!r.ok) throw new ErroGoogle('token', r.status);
    const corpo = (await r.json().catch(() => null)) as { access_token?: unknown } | null;
    if (typeof corpo?.access_token !== 'string') throw new ErroGoogle('token', 200);
    guardado = { token: corpo.access_token, vence: agora() + VALIDADE_TOKEN_MS };
    return guardado.token;
  }

  /** Corpo em JSON, ou `null` no 404 quando `aceita404`. Um 401 troca o token e tenta uma vez. */
  async function firestore(url: string, init: RequestInit = {}, aceita404 = false): Promise<unknown> {
    for (let tentativa = 0; ; tentativa++) {
      const headers = { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await token()}` };
      const r = await pedir('firestore', url, { ...init, headers });
      if (r.status === 401 && tentativa === 0) {
        guardado = undefined;
        continue;
      }
      if (aceita404 && r.status === 404) return null;
      if (!r.ok) throw new ErroGoogle('firestore', r.status);
      return r.json();
    }
  }

  async function lerDocumento(url: string): Promise<Campos | null> {
    const corpo = (await firestore(url, {}, true)) as { fields?: Campos } | null;
    return corpo && decodificarCampos(corpo.fields);
  }

  return {
    async lerPerfil(uid) {
      const mascara = ['isMaster', 'isAdmin', 'allowedInventories'].map((c) => `mask.fieldPaths=${c}`).join('&');
      return lerDocumento(`${URL_DOCUMENTOS}/users/${encodeURIComponent(uid)}?${mascara}`);
    },

    // Porte de `carregarHashes` (apps/web/src/lib/erp.ts): os dois mapas juntos, o novo por cima.
    async lerHashes() {
      const dados = (await lerDocumento(DOC_HASHES)) ?? {};
      const bruto = { ...comoMapa(dados['inventoryHashes']), ...comoMapa(dados['hashes']) };
      const mapa = new Map<string, string>();
      for (const [inventoryId, hash] of Object.entries(bruto)) {
        const valor = String(hash ?? '').trim();
        if (valor !== '') mapa.set(inventoryId, valor);
      }
      return mapa;
    },

    // Campo no mapa entre crases (id que começa com dígito). Crase e barra não são escapadas:
    // a rota só aceita id `^[A-Za-z0-9_-]{1,100}$`. Campo na máscara e fora do corpo = apagado,
    // então gravar também tira a chave do legado `inventoryHashes`, e '' apaga nos dois.
    async gravarHash(inventoryId, hash) {
      const mascara = [`hashes.\`${inventoryId}\``, `inventoryHashes.\`${inventoryId}\``, 'updatedAt']
        .map((c) => `updateMask.fieldPaths=${encodeURIComponent(c)}`)
        .join('&');
      const updatedAt = { timestampValue: new Date(agora()).toISOString() };
      const fields =
        hash === ''
          ? { updatedAt }
          : { hashes: { mapValue: { fields: { [inventoryId]: { stringValue: hash } } } }, updatedAt };
      await firestore(`${DOC_HASHES}?${mascara}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
    },

    async lerAmostra(inventoryId) {
      const base =
        `${URL_DOCUMENTOS}/estoques/${encodeURIComponent(inventoryId)}/produtos?pageSize=100&` +
        ['IdProduto', 'idProduto', 'estoqueSistema', 'EstoqueAtual'].map((c) => `mask.fieldPaths=${c}`).join('&');
      const amostra: ProdutoDaAmostra[] = [];
      let pagina: string | undefined;
      for (let lidas = 0; lidas < 5 && amostra.length < 100; lidas++) {
        const url = pagina ? `${base}&pageToken=${encodeURIComponent(pagina)}` : base;
        const corpo = (await firestore(url)) as { documents?: Array<{ fields?: Campos }>; nextPageToken?: string };
        for (const documento of corpo.documents ?? []) {
          const p = decodificarCampos(documento.fields);
          const id = p['IdProduto'] ?? p['idProduto'];
          if (!comId(id)) continue;
          // Saldo guardado, gravado pelo Buscar e pela importação (apps/web/src/lib/produtos-repo.ts:481, 489-490).
          const saldo = p['estoqueSistema'] ?? p['EstoqueAtual'];
          amostra.push(typeof saldo === 'number' ? { idProduto: id, estoqueSistema: saldo } : { idProduto: id });
        }
        pagina = corpo.nextPageToken;
        if (!pagina) break;
      }
      return amostra.slice(0, 100);
    },
  };
}

/** Lê `hashConfigs` uma vez para saber se a credencial funciona. Nunca rejeita; o aviso leva só etapa e status, ou o nome do erro. */
export async function conferirCredencial(
  fs: FirestoreServidor | null,
  avisar: (mensagem: string) => void,
): Promise<boolean> {
  try {
    if (!fs) return false;
    await fs.lerHashes();
    return true;
  } catch (erro) {
    const motivo = erro instanceof ErroGoogle ? erro.message : erro instanceof Error ? erro.name : typeof erro;
    try {
      avisar(`Credencial do Firebase não conferiu (${motivo}).`);
    } catch {
      // Um aviso que falha não pode derrubar a subida.
    }
    return false;
  }
}
