import { describe, expect, it, vi } from 'vitest';
import { BASE, caminhoDeCampo, chamar, urlApagarCampos } from './firestore-dono.mjs';

const V1 = 'https://firestore.googleapis.com/v1/';
const RAIZ = `${V1}projects/auditoria-icebeer/databases/(default)/documents`;
const DOC = 'projects/auditoria-icebeer/databases/(default)/documents/hashConfigs/inventoryHashes';
const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status });

describe('caminhoDeCampo', () => {
  it('põe a chave entre crases', () => expect(caminhoDeCampo('hashes', 'B')).toBe('hashes.`B`'));
  it('escapa crase e barra', () =>
    expect(caminhoDeCampo('hashes', 'a`b\\c')).toBe('hashes.`a\\`b\\\\c`'));
});

describe('urlApagarCampos', () => {
  it('um updateMask codificado por caminho, e só em documento que existe', () =>
    expect(urlApagarCampos(DOC, ['hashes.`B`', 'inventoryHashes.`C`'])).toBe(
      `${V1}${DOC}?updateMask.fieldPaths=hashes.%60B%60&updateMask.fieldPaths=inventoryHashes.%60C%60&currentDocument.exists=true`,
    ));
  it('campo aninhado do histórico', () =>
    expect(urlApagarCampos('projects/auditoria-icebeer/databases/(default)/documents/historico_geral/r1', ['details.hashLoja'])).toBe(
      `${RAIZ}/historico_geral/r1?updateMask.fieldPaths=details.hashLoja&currentDocument.exists=true`,
    ));
  // PATCH com { fields: {} } e sem updateMask troca o documento inteiro: todos os hashes sumiriam.
  it('lista vazia lança em vez de montar um PATCH sem updateMask', () =>
    expect(() => urlApagarCampos(DOC, [])).toThrow(/documento inteiro/));
});

// O CLI imprime a mensagem do erro: ela não pode levar o corpo do Firestore.
it('chamar: resposta não ok lança só o status, sem o corpo', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'H-SEGREDO-9' } }, 403)));
  await expect(chamar('TOKEN-FALSO-1', 'GET', `${BASE}/users`)).rejects.toThrow(/^Firestore respondeu 403$/);
});
