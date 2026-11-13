/**
 * Lojas travadas em somente leitura, versão do app e modo contagem.
 *
 * Sem `--aplicar` SÓ LÊ. Com `--aplicar` esvazia `readonlyInventories` de appSettings/global
 * e nenhum outro campo (o PATCH leva a máscara só desse campo e exige que o documento exista).
 *
 * Por que existe: a 2.25.0 deixa de gravar essa lista, mas o app instalado ainda trava a
 * contagem por ela, e a regra nova passa a recusar a lista. Quem destrava é o dono, uma vez,
 * antes de publicar a regra. A regra nova também exige `latestNativeAppVersion` como texto:
 * o script mostra como o campo está hoje.
 *
 * Esvaziar a lista libera as contagens presas nos celulares, que sobem sozinhas. Por isso o
 * script avisa antes e só grava com `--aplicar`. Com a lista já vazia ou ausente, não grava.
 *
 * Uso, no PowerShell, numa linha só (a variável do token some no fim):
 *   $env:GCLOUD_TOKEN = (gcloud auth print-access-token); node scripts/travas-estoque.mjs; Remove-Item Env:GCLOUD_TOKEN
 *   $env:GCLOUD_TOKEN = (gcloud auth print-access-token); node scripts/travas-estoque.mjs --aplicar; Remove-Item Env:GCLOUD_TOKEN
 *
 * Nunca rode `gcloud auth print-access-token` sozinho: o token sai na tela e no registro.
 */
import { pathToFileURL } from 'node:url';
import { BASE, chamar, lerToken, listarTodos } from './firestore-dono.mjs';

const SEM_ESTOQUE = '(estoque não existe mais)';

/** `nomes` é um Map de id para nome do estoque. */
export function interpretar(campos, nomes) {
  const valores = campos?.readonlyInventories?.arrayValue?.values ?? [];
  const versao = campos?.latestNativeAppVersion;
  const modo = campos?.modoContagem?.booleanValue;
  return {
    travadas: valores.map((v) => {
      const id = v.stringValue ?? '';
      return { id, nome: nomes.get(id) ?? SEM_ESTOQUE };
    }),
    versao: !versao
      ? { tipo: 'ausente', valor: '' }
      : 'stringValue' in versao
        ? { tipo: 'texto', valor: versao.stringValue }
        : 'doubleValue' in versao || 'integerValue' in versao
          ? { tipo: 'número', valor: String(versao.doubleValue ?? versao.integerValue) }
          // Só o tipo, nunca o conteúdo de um valor que não era para estar ali.
          : { tipo: 'outro', valor: Object.keys(versao)[0].replace(/Value$/, '') },
    modoContagem: modo === undefined ? 'ausente' : modo ? 'ligado' : 'desligado',
  };
}

export function urlEsvaziar(nomeDoc) {
  return `https://firestore.googleapis.com/v1/${nomeDoc}?updateMask.fieldPaths=readonlyInventories&currentDocument.exists=true`;
}

export const CORPO_ESVAZIAR = { fields: { readonlyInventories: { arrayValue: { values: [] } } } };

function mostrar({ travadas, versao, modoContagem }, escrever) {
  if (travadas.length === 0) escrever('Nenhuma loja travada.');
  else {
    escrever(`Lojas travadas: ${travadas.length}`);
    for (const { id, nome } of travadas) escrever(`- ${nome} (${id})`);
  }
  escrever(
    versao.tipo === 'ausente'
      ? 'Versão mais nova do app: ausente'
      : `Versão mais nova do app: ${versao.tipo === 'texto' ? `"${versao.valor}"` : versao.valor} (${versao.tipo})`,
  );
  escrever(`Modo contagem: ${modoContagem}`);
}

export async function travasEstoque(token, { aplicar }, escrever = console.log) {
  const url = `${BASE}/appSettings/global`;
  const documento = await chamar(token, 'GET', url);
  const estoques = await listarTodos(token, 'inventories', ['name']);
  const nomes = new Map(estoques.map((e) => [e.name.split('/').pop(), e.fields?.name?.stringValue ?? '(sem nome)']));

  const lido = interpretar(documento.fields, nomes);
  mostrar(lido, escrever);
  if (lido.versao.tipo !== 'texto' && lido.versao.tipo !== 'ausente') {
    escrever('Atenção: a versão não está como texto. A regra nova exige texto: salve o campo pelo site antes de publicar a regra.');
  }

  if (lido.travadas.length === 0) {
    if (aplicar) escrever('Nada a esvaziar: nenhuma escrita foi feita.');
    return;
  }
  escrever('Atenção: ao esvaziar a lista, as contagens presas nos celulares sobem sozinhas.');
  if (!aplicar) {
    escrever('Simulação: nada foi alterado. Rode com --aplicar para destravar todas.');
    return;
  }
  await chamar(token, 'PATCH', urlEsvaziar(documento.name), CORPO_ESVAZIAR);
  escrever('Depois de esvaziar:');
  mostrar(interpretar((await chamar(token, 'GET', url)).fields, nomes), escrever);
}

// Só roda como CLI; importado pelos testes, não executa nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  travasEstoque(lerToken(), { aplicar: process.argv.includes('--aplicar') }).catch((erro) => {
    console.error(erro instanceof Error ? erro.message : 'Falha inesperada.');
    process.exitCode = 1;
  });
}
