/**
 * Confere o ID token do Firebase que o site manda em `Authorization: Bearer`.
 * A URL `/jwk/` publica as mesmas chaves que o x509 citado na documentação do Firebase, sem precisar de `importX509`.
 * O jose 6 busca as chaves com o `fetch` global, e a guarda de rede dos testes cobre isso.
 * O C3 confere um login de verdade em produção.
 * Nada aqui loga, e o token nunca entra numa mensagem de erro.
 */
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { PROJETO } from './credencial.js';
import { ErroGoogle } from './google.js';

export const URL_CHAVES_FIREBASE = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export const EMISSOR = 'https://securetoken.google.com/auditoria-icebeer';

const TOLERANCIA_S = 30;

// Um só por módulo: o jose guarda as chaves 10 min e só refaz a busca diante de um kid desconhecido.
const CHAVES_FIREBASE = createRemoteJWKSet(new URL(URL_CHAVES_FIREBASE));

/** Devolve o `sub` (uid). Rejeita com `ErroGoogle('chaves', 0)` só quando as chaves do Google não vieram. */
export function criarVerificador(chaves: JWTVerifyGetKey = CHAVES_FIREBASE): (token: string) => Promise<string> {
  // Só a busca da chave é embrulhada: alg, assinatura e claims são conferidos fora dela e ficam erros do jose.
  const buscarChave: JWTVerifyGetKey = async (cabecalho, token) => {
    try {
      return await chaves(cabecalho, token);
    } catch (erro) {
      if (erro instanceof errors.JWKSNoMatchingKey || erro instanceof errors.JWKSMultipleMatchingKeys) throw erro;
      throw new ErroGoogle('chaves', 0);
    }
  };

  return async (token) => {
    const { payload } = await jwtVerify(token, buscarChave, {
      algorithms: ['RS256'],
      issuer: EMISSOR,
      audience: PROJETO,
      clockTolerance: TOLERANCIA_S,
      maxTokenAge: 3600,
      requiredClaims: ['sub', 'iat', 'exp', 'auth_time'],
    });
    const { sub, auth_time: authTime } = payload;
    if (typeof sub !== 'string' || sub.length < 1 || sub.length > 128) throw new Error('claim sub inválida');
    if (typeof authTime !== 'number' || authTime > Math.floor(Date.now() / 1000) + TOLERANCIA_S) {
      throw new Error('claim auth_time inválida');
    }
    return sub;
  };
}
