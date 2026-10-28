import { describe, expect, it, vi } from 'vitest';
import { BASE } from './firestore-dono.mjs';
import { conferirCargos, flagsNaoBooleanas } from './conferir-cargos.mjs';

const json = (corpo) => new Response(JSON.stringify(corpo), { status: 200 });
const perfil = (uid, fields) => ({
  name: `projects/auditoria-icebeer/databases/(default)/documents/users/${uid}`,
  ...(fields ? { fields } : {}),
});

describe('flagsNaoBooleanas', () => {
  it('aponta texto, número e null, na ordem isAdmin, isMaster, isAuditor', () =>
    expect(flagsNaoBooleanas({
      isMaster: { stringValue: 'true' },
      isAuditor: { nullValue: null },
      isAdmin: { integerValue: '1' },
    })).toEqual([
      { campo: 'isAdmin', tipo: 'integer' },
      { campo: 'isMaster', tipo: 'string' },
      { campo: 'isAuditor', tipo: 'null' },
    ]));

  it('booleano, flag ausente e perfil sem fields passam', () => {
    expect(flagsNaoBooleanas({ isAdmin: { booleanValue: false }, isMaster: { booleanValue: true } })).toEqual([]);
    expect(flagsNaoBooleanas(undefined)).toEqual([]);
  });
});

describe('conferirCargos', () => {
  it('só lê, e mostra uid, campo e tipo, nunca o valor', async () => {
    const fetch = vi.fn(async () => json({ documents: [
      perfil('uid-1', { isAdmin: { stringValue: 'true' } }),
      perfil('uid-2', { isMaster: { booleanValue: true } }),
      perfil('uid-3'),
      perfil('uid-4', { isMaster: { integerValue: '1' }, isAuditor: { stringValue: 'sim' } }),
    ] }));
    vi.stubGlobal('fetch', fetch);
    const linhas = [];
    await conferirCargos('TOKEN-FALSO-1', (l) => linhas.push(l));
    expect(linhas).toEqual([
      '4 perfis lidos.',
      'uid-1: isAdmin (string)',
      'uid-4: isMaster (integer), isAuditor (string)',
      'Corrija no Console antes de publicar a 2.21.0: a API só aceita true/false.',
    ]);
    expect(fetch.mock.calls[0][0]).toBe(
      `${BASE}/users?pageSize=300&mask.fieldPaths=isAdmin&mask.fieldPaths=isMaster&mask.fieldPaths=isAuditor`,
    );
    expect(fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it('tudo booleano', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ documents: [perfil('uid-2', { isMaster: { booleanValue: true } })] })));
    const linhas = [];
    await conferirCargos('TOKEN-FALSO-1', (l) => linhas.push(l));
    expect(linhas).toEqual(['1 perfis lidos.', 'Nenhuma flag fora do padrão.']);
  });
});
