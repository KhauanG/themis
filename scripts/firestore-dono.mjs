/**
 * IO comum dos scripts do dono (`conferir-cargos.mjs`, `limpar-hash-antigo.mjs`).
 * Não roda sozinho: só exporta o que eles usam para falar com o Firestore pelo REST.
 *
 * Credencial: o login Google do dono (`gcloud`). Uma conta com papel no projeto não
 * passa pelas Security Rules, e assim nenhuma chave de conta de serviço fica no
 * computador.
 *
 * O token vem de `GCLOUD_TOKEN` e nunca é gravado nem impresso.
 */
import { basename } from 'node:path';

export const BASE = 'https://firestore.googleapis.com/v1/projects/auditoria-icebeer/databases/(default)/documents';

export function lerToken() {
  const token = process.env.GCLOUD_TOKEN?.trim();
  if (token) return token;
  const script = basename(process.argv[1] ?? 'script.mjs');
  console.error('GCLOUD_TOKEN ausente. Uso, no PowerShell, numa linha só:');
  console.error(
    `  $env:GCLOUD_TOKEN = (gcloud auth print-access-token); node scripts/${script}; Remove-Item Env:GCLOUD_TOKEN`,
  );
  process.exit(1);
}

export async function chamar(token, metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      'x-goog-user-project': 'auditoria-icebeer',
      'Content-Type': 'application/json',
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  // Sem o corpo: o CLI imprime esta mensagem, e o corpo do Firestore pode ecoar dados.
  if (!r.ok) throw new Error(`Firestore respondeu ${r.status}`);
  return r.json();
}

export async function listarTodos(token, colecao, mascaras) {
  const base = `${BASE}/${colecao}?pageSize=300${mascaras.map((m) => `&mask.fieldPaths=${encodeURIComponent(m)}`).join('')}`;
  const documentos = [];
  let pagina;
  do {
    const r = await chamar(token, 'GET', pagina ? `${base}&pageToken=${encodeURIComponent(pagina)}` : base);
    // Coleção vazia volta `{}`, sem `documents`.
    documentos.push(...(r.documents ?? []));
    pagina = r.nextPageToken;
  } while (pagina);
  return documentos;
}

export function caminhoDeCampo(mapa, chave) {
  return `${mapa}.\`${chave.replace(/[\\`]/g, '\\$&')}\``;
}

export function urlApagarCampos(nomeDoc, caminhos) {
  if (caminhos.length === 0) {
    throw new Error('urlApagarCampos sem campos: um PATCH sem updateMask troca o documento inteiro.');
  }
  const mascara = caminhos.map((c) => `updateMask.fieldPaths=${encodeURIComponent(c)}`).join('&');
  return `https://firestore.googleapis.com/v1/${nomeDoc}?${mascara}&currentDocument.exists=true`;
}
