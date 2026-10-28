/**
 * Perfis com flag de cargo que não é booleana.
 *
 * SOMENTE LEITURA. Não grava nada, não corrige nada — lista.
 *
 * Por que existe: a API compara as flags com `=== true`, como a regra (spec 4.1). O site
 * aceita `"true"` e `1` (`packages/shared/src/papeis.ts:14-17`). Um perfil assim veria o
 * ERP no site e levaria 403 da API.
 *
 * Rodar antes de publicar a 2.21.0. Imprime o uid porque sem ele o dono não acha o
 * perfil no Console. Nunca imprime o valor.
 *
 * Uso, no PowerShell, numa linha só (a variável do token some no fim):
 *   $env:GCLOUD_TOKEN = (gcloud auth print-access-token); node scripts/conferir-cargos.mjs; Remove-Item Env:GCLOUD_TOKEN
 *
 * Nunca rode `gcloud auth print-access-token` sozinho: o token sai na tela e no registro.
 */
import { pathToFileURL } from 'node:url';
import { lerToken, listarTodos } from './firestore-dono.mjs';

const FLAGS = ['isAdmin', 'isMaster', 'isAuditor'];

export function flagsNaoBooleanas(campos) {
  return FLAGS.filter((campo) => campos?.[campo] && !('booleanValue' in campos[campo])).map((campo) => ({
    campo,
    tipo: Object.keys(campos[campo])[0].replace(/Value$/, ''),
  }));
}

export async function conferirCargos(token, escrever = console.log) {
  const perfis = await listarTodos(token, 'users', FLAGS);
  escrever(`${perfis.length} perfis lidos.`);
  let fora = 0;
  for (const { name, fields } of perfis) {
    const flags = flagsNaoBooleanas(fields);
    if (flags.length === 0) continue;
    fora++;
    escrever(`${name.split('/').pop()}: ${flags.map((f) => `${f.campo} (${f.tipo})`).join(', ')}`);
  }
  escrever(
    fora > 0
      ? 'Corrija no Console antes de publicar a 2.21.0: a API só aceita true/false.'
      : 'Nenhuma flag fora do padrão.',
  );
}

// Só roda como CLI; importado pelos testes, não executa nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  conferirCargos(lerToken()).catch((erro) => {
    console.error(erro instanceof Error ? erro.message : 'Falha inesperada.');
    process.exitCode = 1;
  });
}
