import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { lerCredencial } from './credencial.js';

// Chaves geradas aqui: nenhuma chave real entra no repositório.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const PEM_PKCS1 = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const PEM_EC = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

const EMAIL = 'themis-api@auditoria-icebeer.iam.gserviceaccount.com';
const JSON_OK = {
  type: 'service_account',
  project_id: 'auditoria-icebeer',
  private_key_id: 'k1',
  private_key: PEM,
  client_email: EMAIL,
};
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const com = (campos: Record<string, unknown>) => b64({ ...JSON_OK, ...campos });
const AUSENTE = 'FIREBASE_SERVICE_ACCOUNT_B64 ausente: as rotas do ERP respondem 503.';
const invalida = (motivo: string) =>
  `FIREBASE_SERVICE_ACCOUNT_B64 inválida (${motivo}): as rotas do ERP respondem 503.`;

describe('lerCredencial — conta válida', () => {
  it('lê a conta de serviço válida', () => {
    const avisar = vi.fn();
    expect(lerCredencial(b64(JSON_OK), avisar)).toEqual({
      projectId: 'auditoria-icebeer',
      clientEmail: EMAIL,
      idChave: 'k1',
      chavePrivada: PEM,
    });
    expect(avisar).not.toHaveBeenCalled();
  });

  it('apara espaço e quebra de linha nas pontas do base64', () => {
    expect(lerCredencial(`  ${b64(JSON_OK)}\r\n`, vi.fn())).not.toBeNull();
  });

  it('sem private_key_id: lê sem idChave', () => {
    const r = lerCredencial(com({ private_key_id: undefined }), vi.fn());
    expect(r).not.toBeNull();
    expect(r?.idChave).toBeUndefined();
  });
});

// O config.ts roda na importação: uma exceção aqui derrubaria o site inteiro (anti-meta da spec).
describe('lerCredencial — ausente ou inválida volta null, avisa uma vez e nunca lança', () => {
  it.each([
    ['undefined', undefined],
    ['só espaço', '  \n'],
  ])('ausente: %s', (_n, entrada) => {
    const avisar = vi.fn();
    expect(lerCredencial(entrada, avisar)).toBeNull();
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar).toHaveBeenCalledWith(AUSENTE);
  });

  it.each([
    ['não é base64 de JSON', 'nao-e-json', 'não é base64 de um JSON'],
    ['JSON null', b64(null), 'não é um objeto'],
    ['JSON lista', b64([]), 'não é um objeto'],
    ['type errado', com({ type: 'user' }), 'type não é service_account'],
    ['outro projeto', com({ project_id: 'outro' }), 'project_id de outro projeto'],
    ['e-mail comum', com({ client_email: 'alguem@gmail.com' }), 'client_email não é de conta de serviço'],
    ['sem client_email', com({ client_email: undefined }), 'client_email não é de conta de serviço'],
    ['sem private_key', com({ private_key: undefined }), 'chave privada não é RSA PKCS8'],
    ['chave cortada', com({ private_key: PEM.slice(0, 200) }), 'chave privada não é RSA PKCS8'],
    ['chave com \\n literal', com({ private_key: PEM.replace(/\n/g, '\\n') }), 'chave privada não é RSA PKCS8'],
    ['chave RSA em PKCS1', com({ private_key: PEM_PKCS1 }), 'chave privada não é RSA PKCS8'],
    ['chave EC', com({ private_key: PEM_EC }), 'chave privada não é RSA PKCS8'],
  ])('%s', (_n, entrada, motivo) => {
    const avisar = vi.fn();
    expect(lerCredencial(entrada, avisar)).toBeNull();
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar).toHaveBeenCalledWith(invalida(motivo));
  });
});
