/**
 * Conta de serviço do Firebase, lida de `FIREBASE_SERVICE_ACCOUNT_B64` (o JSON inteiro em base64).
 * Nunca lança: o `config.ts` roda na importação, e uma exceção aqui derrubaria o site inteiro.
 * Ausente ou inválida vira `null` com um aviso que cita só o nome da variável.
 */
import { createPrivateKey } from 'node:crypto';

export const PROJETO = 'auditoria-icebeer';

export interface Credencial {
  projectId: string;
  clientEmail: string;
  idChave?: string;
  chavePrivada: string;
}

const NOME = 'FIREBASE_SERVICE_ACCOUNT_B64';
const EMAIL_DE_SERVICO = /^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/;

function chaveRsaPkcs8(chave: unknown): chave is string {
  if (typeof chave !== 'string' || !chave.startsWith('-----BEGIN PRIVATE KEY-----')) return false;
  try {
    // Sem isso uma chave PKCS1 passaria aqui e só falharia no importPKCS8.
    return createPrivateKey(chave).asymmetricKeyType === 'rsa';
  } catch {
    return false;
  }
}

export function lerCredencial(
  b64: string | undefined,
  avisar: (mensagem: string) => void = console.warn,
): Credencial | null {
  const invalida = (motivo: string) => {
    avisar(`${NOME} inválida (${motivo}): as rotas do ERP respondem 503.`);
    return null;
  };
  try {
    const bruto = (b64 ?? '').trim();
    if (bruto === '') {
      avisar(`${NOME} ausente: as rotas do ERP respondem 503.`);
      return null;
    }

    let conta: unknown;
    try {
      conta = JSON.parse(Buffer.from(bruto, 'base64').toString('utf8'));
    } catch {
      return invalida('não é base64 de um JSON');
    }
    if (typeof conta !== 'object' || conta === null || Array.isArray(conta)) {
      return invalida('não é um objeto');
    }

    const c = conta as Record<string, unknown>;
    if (c['type'] !== 'service_account') return invalida('type não é service_account');
    if (c['project_id'] !== PROJETO) return invalida('project_id de outro projeto');
    const email = c['client_email'];
    if (typeof email !== 'string' || !EMAIL_DE_SERVICO.test(email)) {
      return invalida('client_email não é de conta de serviço');
    }
    // O PEM vai como veio: o base64 preserva a quebra de linha, e `\n` literal é chave colada errado.
    const chave = c['private_key'];
    if (!chaveRsaPkcs8(chave)) return invalida('chave privada não é RSA PKCS8');

    const id = c['private_key_id'];
    return {
      projectId: PROJETO,
      clientEmail: email,
      ...(typeof id === 'string' && id !== '' ? { idChave: id } : {}),
      chavePrivada: chave,
    };
  } catch {
    return invalida('não foi possível ler');
  }
}
