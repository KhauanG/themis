import { describe, expect, it, vi } from 'vitest';
import { BASE } from './firestore-dono.mjs';
import { CORPO_ESVAZIAR, interpretar, travasEstoque, urlEsvaziar } from './travas-estoque.mjs';

const json = (corpo) => new Response(JSON.stringify(corpo), { status: 200 });
const NOME_DOC = 'projects/auditoria-icebeer/databases/(default)/documents/appSettings/global';
const lista = (...ids) => ({ arrayValue: { values: ids.map((id) => ({ stringValue: id })) } });
const estoques = { documents: [
  { name: 'projects/auditoria-icebeer/databases/(default)/documents/inventories/E1', fields: { name: { stringValue: 'Loja Sul' } } },
  { name: 'projects/auditoria-icebeer/databases/(default)/documents/inventories/E2', fields: { name: { stringValue: 'Loja Norte' } } },
] };
/** fetch falso: devolve `config` nas leituras de appSettings e `estoques` na de inventories. */
const servidor = (...configs) => {
  let n = 0;
  return vi.fn(async (url, init) => {
    if (init.method === 'PATCH') return json({});
    if (String(url).includes('/inventories')) return json(estoques);
    return json({ name: NOME_DOC, fields: configs[Math.min(n++, configs.length - 1)] });
  });
};
const rodar = async (fetch, opcoes) => {
  vi.stubGlobal('fetch', fetch);
  const linhas = [];
  await travasEstoque('TOKEN-FALSO-1', opcoes, (l) => linhas.push(l));
  return linhas;
};

describe('interpretar', () => {
  const nomes = new Map([['E1', 'Loja Sul']]);
  it('documento sem os campos', () => {
    expect(interpretar(undefined, nomes)).toEqual({
      travadas: [], versao: { tipo: 'ausente', valor: '' }, modoContagem: 'ausente',
    });
  });
  it('lojas travadas com nome; id que não existe mais aparece sem nome', () => {
    expect(interpretar({ readonlyInventories: lista('E1', 'morto') }, nomes).travadas).toEqual([
      { id: 'E1', nome: 'Loja Sul' }, { id: 'morto', nome: '(estoque não existe mais)' },
    ]);
  });
  it('lista vazia e lista sem values', () => {
    expect(interpretar({ readonlyInventories: lista() }, nomes).travadas).toEqual([]);
    expect(interpretar({ readonlyInventories: { arrayValue: {} } }, nomes).travadas).toEqual([]);
  });
  it('versão: texto, número e outro tipo', () => {
    expect(interpretar({ latestNativeAppVersion: { stringValue: '5.4.0' } }, nomes).versao).toEqual({ tipo: 'texto', valor: '5.4.0' });
    expect(interpretar({ latestNativeAppVersion: { doubleValue: 5.4 } }, nomes).versao).toEqual({ tipo: 'número', valor: '5.4' });
    expect(interpretar({ latestNativeAppVersion: { integerValue: '5' } }, nomes).versao).toEqual({ tipo: 'número', valor: '5' });
    expect(interpretar({ latestNativeAppVersion: { booleanValue: true } }, nomes).versao.tipo).toBe('outro');
  });
  it('modo contagem', () => {
    expect(interpretar({ modoContagem: { booleanValue: true } }, nomes).modoContagem).toBe('ligado');
    expect(interpretar({ modoContagem: { booleanValue: false } }, nomes).modoContagem).toBe('desligado');
  });
});

describe('urlEsvaziar', () => {
  it('máscara só de readonlyInventories, e exige que o documento exista', () => {
    expect(urlEsvaziar(NOME_DOC)).toBe(
      `https://firestore.googleapis.com/v1/${NOME_DOC}?updateMask.fieldPaths=readonlyInventories&currentDocument.exists=true`,
    );
    expect(CORPO_ESVAZIAR).toEqual({ fields: { readonlyInventories: { arrayValue: { values: [] } } } });
  });
});

describe('travasEstoque', () => {
  it('sem --aplicar só lê, e diz o que viu', async () => {
    const fetch = servidor({ readonlyInventories: lista('E1'), modoContagem: { booleanValue: false } });
    expect(await rodar(fetch, { aplicar: false })).toEqual([
      'Lojas travadas: 1',
      '- Loja Sul (E1)',
      'Versão mais nova do app: ausente',
      'Modo contagem: desligado',
      'Atenção: ao esvaziar a lista, as contagens presas nos celulares sobem sozinhas.',
      'Simulação: nada foi alterado. Rode com --aplicar para destravar todas.',
    ]);
    expect(fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/appSettings/global`);
  });
  it('nenhuma loja travada: não grava nem com --aplicar', async () => {
    const fetch = servidor({ readonlyInventories: lista(), latestNativeAppVersion: { stringValue: '5.4.0' }, modoContagem: { booleanValue: true } });
    expect(await rodar(fetch, { aplicar: true })).toEqual([
      'Nenhuma loja travada.',
      'Versão mais nova do app: "5.4.0" (texto)',
      'Modo contagem: ligado',
      'Nada a esvaziar: nenhuma escrita foi feita.',
    ]);
    expect(fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });
  it('versão em número é avisada', async () => {
    const linhas = await rodar(servidor({ latestNativeAppVersion: { doubleValue: 5.4 } }), { aplicar: false });
    expect(linhas).toContain('Versão mais nova do app: 5.4 (número)');
    expect(linhas).toContain('Atenção: a versão não está como texto. A regra nova exige texto: salve o campo pelo site antes de publicar a regra.');
  });
  it('com --aplicar manda um PATCH só, com a máscara de readonlyInventories, e lê de novo', async () => {
    const fetch = servidor({ readonlyInventories: lista('E1', 'E2') }, { readonlyInventories: lista() });
    const linhas = await rodar(fetch, { aplicar: true });
    const patches = fetch.mock.calls.filter(([, init]) => init.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0][0]).toBe(urlEsvaziar(NOME_DOC));
    expect(JSON.parse(patches[0][1].body)).toEqual(CORPO_ESVAZIAR);
    expect(linhas.slice(-4)).toEqual([
      'Depois de esvaziar:',
      'Nenhuma loja travada.',
      'Versão mais nova do app: ausente',
      'Modo contagem: ausente',
    ]);
  });
});
