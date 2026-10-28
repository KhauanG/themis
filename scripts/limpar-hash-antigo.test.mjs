import { describe, expect, it, vi } from 'vitest';
import { BASE } from './firestore-dono.mjs';
import { chavesOrfas, limparHashAntigo, temHashLoja } from './limpar-hash-antigo.mjs';

const V1 = 'https://firestore.googleapis.com/v1/';
const nome = (colecao, id) => `projects/auditoria-icebeer/databases/(default)/documents/${colecao}/${id}`;
const json = (corpo) => new Response(JSON.stringify(corpo), { status: 200 });
const texto = (valor) => ({ stringValue: valor });
// Como o REST de verdade: mapa vazio vem sem `fields`.
const mapa = (obj) => (Object.keys(obj).length === 0
  ? { mapValue: {} }
  : { mapValue: { fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, texto(v)])) } });
const comHash = (valor) => ({ details: { mapValue: { fields: { hashLoja: texto(valor) } } } });
const PATCH_HISTORICO = (id) =>
  `${V1}${nome('historico_geral', id)}?updateMask.fieldPaths=details.hashLoja&currentDocument.exists=true`;

/** Firestore falso com estado: o PATCH apaga de verdade, e a recontagem do fim vale. */
function bancoFalso({ historico, hashes, inventoryHashes, paginas }) {
  const estado = { hashes: { ...hashes }, inventoryHashes: { ...inventoryHashes } };
  const registros = historico.map(([id, fields]) => ({ name: nome('historico_geral', id), ...(fields ? { fields } : {}) }));
  const fetch = vi.fn(async (url, init) => {
    if (init.method === 'POST' && url === `${BASE}:runQuery`) {
      // A resposta real traz entradas só com readTime, sem document.
      return json([{ readTime: 't0' }, ...registros.map((document) => ({ document, readTime: 't1' }))]);
    }
    if (init.method === 'GET' && url === `${BASE}/hashConfigs/inventoryHashes`) {
      return json({
        name: nome('hashConfigs', 'inventoryHashes'),
        fields: { hashes: mapa(estado.hashes), inventoryHashes: mapa(estado.inventoryHashes) },
      });
    }
    if (init.method === 'GET' && url.startsWith(`${BASE}/inventories?pageSize=300&mask.fieldPaths=name`)) {
      const pagina = url.endsWith('&pageToken=pag%2F2') ? 1 : 0;
      const ids = paginas[pagina];
      return json({
        ...(ids.length > 0 ? { documents: ids.map((id) => ({ name: nome('inventories', id) })) } : {}),
        ...(pagina === 0 && paginas.length > 1 ? { nextPageToken: 'pag/2' } : {}),
      });
    }
    if (init.method === 'PATCH') {
      const u = new URL(url);
      for (const caminho of u.searchParams.getAll('updateMask.fieldPaths')) {
        if (caminho === 'details.hashLoja') {
          delete registros.find((r) => `${V1}${r.name}` === `${u.origin}${u.pathname}`).fields;
        } else {
          const [m, chave] = caminho.split('.');
          delete estado[m][chave.slice(1, -1)];
        }
      }
      return json({});
    }
    throw new Error(`chamada inesperada: ${init.method} ${url}`);
  });
  return { fetch, estado };
}

const BUSCAR_DO_2_0 = { details: { mapValue: { fields: { recebidosDoErp: { integerValue: '9' } } } } };
const PADRAO = {
  historico: [['r1', comHash('H-A-0001')], ['r2', comHash('')], ['r3', BUSCAR_DO_2_0], ['r4']],
  hashes: { A: 'H-A-0001', B: 'H-B-0002' },
  inventoryHashes: { C: 'H-C-0003' },
  paginas: [['X'], ['A']], // a loja A só vem na 2ª página
};

const patches = (fetch) =>
  fetch.mock.calls.filter(([, i]) => i.method === 'PATCH').map(([url, i]) => [url, JSON.parse(i.body)]);

// Síncrona de propósito: o teste prende o .rejects na mesma volta, sem rejeição solta.
function rodar(cenario, aplicar) {
  const banco = bancoFalso(cenario);
  vi.stubGlobal('fetch', banco.fetch);
  const linhas = [];
  const execucao = limparHashAntigo('TOKEN-FALSO-1', { aplicar }, (l) => linhas.push(l));
  return { ...banco, linhas, execucao };
}

describe('temHashLoja', () => {
  it.each([
    ['com hashLoja', comHash('H-A-0001'), true],
    ['hashLoja vazio também conta', comHash(''), true],
    ['details sem hashLoja', { details: { mapValue: {} } }, false],
    ['sem details', {}, false],
    ['documento sem fields', undefined, false],
  ])('%s', (_n, campos, esperado) => expect(temHashLoja(campos)).toBe(esperado));
});

describe('chavesOrfas', () => {
  it('só as chaves de estoque que não existe mais, nos dois mapas', () =>
    expect(chavesOrfas({ hashes: mapa({ A: 'x', B: 'y' }), inventoryHashes: mapa({ C: 'z' }) }, new Set(['A'])))
      .toEqual({ hashes: ['B'], inventoryHashes: ['C'] }));
  it('documento sem os mapas não tem órfã', () =>
    expect(chavesOrfas(undefined, new Set(['A']))).toEqual({ hashes: [], inventoryHashes: [] }));
  // A 2.20 apaga chaves do legado: o mapa pode estar vazio, ou nem existir.
  it('mapa vazio ou ausente não tem órfã', () => {
    const vazio = { hashes: mapa({ A: 'x' }), inventoryHashes: mapa({}) };
    expect(chavesOrfas(vazio, new Set(['A']))).toEqual({ hashes: [], inventoryHashes: [] });
    expect(chavesOrfas({ hashes: mapa({ A: 'x' }) }, new Set(['A']))).toEqual({ hashes: [], inventoryHashes: [] });
  });
});

describe('limparHashAntigo', () => {
  it('simulação só lê e imprime só contagens', async () => {
    const { fetch, linhas, execucao } = rodar(PADRAO, false);
    await execucao;
    expect(linhas).toEqual([
      'Registros BUSCAR_ESTOQUE com hashLoja: 2',
      'Chaves: 3, estoques: 2, órfãs: 2',
      'Simulação: nada foi alterado. Rode com --aplicar para gravar.',
    ]);
    expect(patches(fetch)).toEqual([]);
    const [, consulta] = fetch.mock.calls.find(([, i]) => i.method === 'POST');
    expect(JSON.parse(consulta.body)).toEqual({
      structuredQuery: {
        from: [{ collectionId: 'historico_geral' }],
        where: { fieldFilter: { field: { fieldPath: 'action' }, op: 'EQUAL', value: { stringValue: 'BUSCAR_ESTOQUE' } } },
        select: { fields: [{ fieldPath: 'details.hashLoja' }] },
      },
    });
  });

  it('--aplicar apaga só details.hashLoja e só as chaves órfãs', async () => {
    const { fetch, estado, linhas, execucao } = rodar(PADRAO, true);
    await execucao;
    expect(patches(fetch)).toEqual([
      [PATCH_HISTORICO('r1'), { fields: {} }],
      [PATCH_HISTORICO('r2'), { fields: {} }],
      [
        `${V1}${nome('hashConfigs', 'inventoryHashes')}?updateMask.fieldPaths=hashes.%60B%60&updateMask.fieldPaths=inventoryHashes.%60C%60&currentDocument.exists=true`,
        { fields: {} },
      ],
    ]);
    expect(estado.hashes).toEqual({ A: 'H-A-0001' });
    expect(linhas).toEqual([
      'Registros BUSCAR_ESTOQUE com hashLoja: 2',
      'Chaves: 3, estoques: 2, órfãs: 2',
      'depois: 0 e 0',
    ]);
  });

  it('sem órfã e sem registro, --aplicar não manda PATCH', async () => {
    const cenario = { historico: [['r3', BUSCAR_DO_2_0]], hashes: { A: 'H-A-0001', X: 'H-X-0001' }, inventoryHashes: {}, paginas: [['X'], ['A']] };
    const { fetch, linhas, execucao } = rodar(cenario, true);
    await execucao;
    expect(patches(fetch)).toEqual([]);
    expect(linhas).toEqual(['Registros BUSCAR_ESTOQUE com hashLoja: 0', 'Chaves: 2, estoques: 2, órfãs: 0', 'depois: 0 e 0']);
  });

  it('nenhum estoque lido: para antes de gravar', async () => {
    const { fetch, execucao } = rodar({ ...PADRAO, paginas: [[]] }, true);
    await expect(execucao).rejects.toThrow('Nenhum estoque lido: nada foi alterado.');
    expect(patches(fetch)).toEqual([]);
  });

  it('todas as chaves pareceriam órfãs: para antes de gravar', async () => {
    const { fetch, execucao } = rodar({ ...PADRAO, paginas: [['Z']] }, true);
    await expect(execucao).rejects.toThrow('Todas as chaves pareceriam órfãs: nada foi alterado.');
    expect(patches(fetch)).toEqual([]);
  });
});
