/**
 * Limpeza do hash antigo: o do histórico do 1.x e as chaves órfãs de `hashConfigs`.
 *
 * Por que existe: o 1.x gravou o hash em cada `BUSCAR_ESTOQUE` do histórico
 * (`details.hashLoja`; `www/app.js:6914-6919` no repositório do app). E excluir a loja
 * deixou a chave dela em `hashConfigs` (`apps/web/src/features/estoques/TelaEstoques.tsx:175-195`).
 * Spec 4.9.
 *
 * Simula por padrão; só grava com `--aplicar`. Imprime só contagens, nunca hash nem id.
 * Para antes de gravar se nenhum estoque foi lido, ou se todas as chaves pareceriam órfãs.
 *
 * Sem `updateMask`, um PATCH troca o documento inteiro: todos os hashes sumiriam. Por
 * isso todo PATCH passa por `urlApagarCampos`, que exige os campos.
 *
 * Uso, no PowerShell, numa linha só (a variável do token some no fim):
 *   $env:GCLOUD_TOKEN = (gcloud auth print-access-token); node scripts/limpar-hash-antigo.mjs; Remove-Item Env:GCLOUD_TOKEN
 *   $env:GCLOUD_TOKEN = (gcloud auth print-access-token); node scripts/limpar-hash-antigo.mjs --aplicar; Remove-Item Env:GCLOUD_TOKEN
 *
 * Nunca rode `gcloud auth print-access-token` sozinho: o token sai na tela e no registro.
 */
import { pathToFileURL } from 'node:url';
import { BASE, caminhoDeCampo, chamar, lerToken, listarTodos, urlApagarCampos } from './firestore-dono.mjs';

const CONSULTA = {
  structuredQuery: {
    from: [{ collectionId: 'historico_geral' }],
    where: { fieldFilter: { field: { fieldPath: 'action' }, op: 'EQUAL', value: { stringValue: 'BUSCAR_ESTOQUE' } } },
    select: { fields: [{ fieldPath: 'details.hashLoja' }] },
  },
};

export function temHashLoja(campos) {
  return campos?.details?.mapValue?.fields?.hashLoja !== undefined;
}

/** Chaves de um mapa REST. Mapa vazio vem sem `fields`; mapa ausente, sem nada. */
const chaves = (campos, mapa) => Object.keys(campos?.[mapa]?.mapValue?.fields ?? {});

export function chavesOrfas(campos, ids) {
  return {
    hashes: chaves(campos, 'hashes').filter((c) => !ids.has(c)),
    inventoryHashes: chaves(campos, 'inventoryHashes').filter((c) => !ids.has(c)),
  };
}

async function contar(token) {
  const respostas = await chamar(token, 'POST', `${BASE}:runQuery`, CONSULTA);
  // A resposta traz entradas só com readTime, sem document.
  const registros = respostas
    .filter((e) => e.document && temHashLoja(e.document.fields))
    .map((e) => e.document.name);
  const config = await chamar(token, 'GET', `${BASE}/hashConfigs/inventoryHashes`);
  const estoques = await listarTodos(token, 'inventories', ['name']);
  const ids = new Set(estoques.map((d) => d.name.split('/').pop()));
  const orfas = chavesOrfas(config.fields, ids);
  const total = chaves(config.fields, 'hashes').length + chaves(config.fields, 'inventoryHashes').length;
  return { registros, nomeConfig: config.name, ids, orfas, total, k: orfas.hashes.length + orfas.inventoryHashes.length };
}

export async function limparHashAntigo(token, { aplicar }, escrever = console.log) {
  const { registros, nomeConfig, ids, orfas, total, k } = await contar(token);
  escrever(`Registros BUSCAR_ESTOQUE com hashLoja: ${registros.length}`);
  escrever(`Chaves: ${total}, estoques: ${ids.size}, órfãs: ${k}`);
  if (ids.size === 0) throw new Error('Nenhum estoque lido: nada foi alterado.');
  if (total > 0 && k === total) throw new Error('Todas as chaves pareceriam órfãs: nada foi alterado.');
  if (!aplicar) {
    escrever('Simulação: nada foi alterado. Rode com --aplicar para gravar.');
    return;
  }
  for (const nome of registros) {
    await chamar(token, 'PATCH', urlApagarCampos(nome, ['details.hashLoja']), { fields: {} });
  }
  if (k > 0) {
    const caminhos = [
      ...orfas.hashes.map((c) => caminhoDeCampo('hashes', c)),
      ...orfas.inventoryHashes.map((c) => caminhoDeCampo('inventoryHashes', c)),
    ];
    await chamar(token, 'PATCH', urlApagarCampos(nomeConfig, caminhos), { fields: {} });
  }
  const depois = await contar(token);
  escrever(`depois: ${depois.registros.length} e ${depois.k}`);
}

// Só roda como CLI; importado pelos testes, não executa nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  limparHashAntigo(lerToken(), { aplicar: process.argv.includes('--aplicar') }).catch((erro) => {
    console.error(erro instanceof Error ? erro.message : 'Falha inesperada.');
    process.exitCode = 1;
  });
}
