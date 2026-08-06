/**
 * Cria a tag git da versão atual, depois que o commit já existe.
 *
 * Separado de `versionar.mjs` de propósito: a tag precisa apontar para o commit que **tem**
 * o changelog preenchido. Marcar antes de escrever produziria uma tag que não descreve
 * nada — e tag movida depois é pior do que tag nenhuma, porque quem já clonou fica com
 * outra ideia do que aquela versão significa.
 *
 * Uso:
 *   npm run versao:marcar          # cria a tag e mostra como publicar
 *   npm run versao:marcar -- push  # cria e publica
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (cmd) => execSync(`git ${cmd}`, { cwd: RAIZ, encoding: 'utf8' }).trim();

const versao = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version;
const tag = `v${versao}`;

// Árvore suja significa que a versão marcada não é a que está no disco.
const sujo = git('status --porcelain');
if (sujo) {
  console.error('Há alterações não commitadas. Commite antes de marcar a versão:\n');
  console.error(sujo);
  process.exit(1);
}

const existentes = git('tag --list').split('\n');
if (existentes.includes(tag)) {
  console.error(`A tag ${tag} já existe, apontando para ${git(`rev-list -n 1 ${tag}`).slice(0, 7)}.`);
  console.error('Suba a versão antes de marcar de novo: npm run versao -- patch');
  process.exit(1);
}

git(`tag -a ${tag} -m "Themis ${versao}"`);
console.log(`Tag ${tag} criada em ${git('rev-parse --short HEAD')}.`);

if (process.argv[2] === 'push') {
  git(`push origin ${tag}`);
  console.log(`Tag ${tag} publicada.`);
} else {
  console.log(`Para publicar: git push origin ${tag}`);
}
