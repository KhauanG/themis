/**
 * Trava de versionamento. Roda dentro de `npm run verificar`, antes do deploy.
 *
 * Confere quatro coisas, e falha em qualquer uma:
 *
 *   1. os quatro `package.json` têm a mesma versão;
 *   2. o `docs/CHANGELOG.md` tem uma seção para essa versão;
 *   3. essa seção não está vazia (o esqueleto que `versionar.mjs` abre não passa);
 *   4. a versão do topo do changelog é a versão atual — changelog escrito e versão
 *      esquecida é o mesmo problema pelo outro lado.
 *
 * Existe porque a versão já ficou parada em `2.0.0` enquanto o changelog ia em `2.6.2`.
 * Num PWA isso importa: o service worker guarda a versão velha no aparelho, e sem número
 * confiável não dá para responder "a correção chegou no celular do funcionário?".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const PACOTES = [
  'package.json',
  'apps/web/package.json',
  'apps/api/package.json',
  'packages/shared/package.json',
];

const problemas = [];
const ler = (c) => readFileSync(join(RAIZ, c), 'utf8');

const versao = JSON.parse(ler('package.json')).version;

for (const caminho of PACOTES.slice(1)) {
  const dele = JSON.parse(ler(caminho)).version;
  if (dele !== versao) {
    problemas.push(`${caminho} está em ${dele}, a raiz está em ${versao}. Rode: npm run versao -- ${versao}`);
  }
}

const changelog = ler('docs/CHANGELOG.md');
const secoes = [...changelog.matchAll(/^## (\d+\.\d+\.\d+) — (\S+)$/gm)];

if (secoes.length === 0) {
  problemas.push('docs/CHANGELOG.md não tem nenhuma seção de versão no formato "## X.Y.Z — AAAA-MM-DD".');
} else {
  const [primeira] = secoes;

  if (primeira[1] !== versao) {
    problemas.push(
      `docs/CHANGELOG.md começa em ${primeira[1]}, mas a versão do projeto é ${versao}. ` +
        'Um dos dois ficou para trás.',
    );
  }

  // Corpo da seção: daqui até a próxima seção, ou até o fim.
  const inicio = primeira.index + primeira[0].length;
  const fim = secoes[1] ? secoes[1].index : changelog.length;
  const corpo = changelog.slice(inicio, fim);

  // Item de lista com texto de verdade. `- ` sozinho é o esqueleto que o script abre.
  const temConteudo = /^-\s+\S/m.test(corpo);
  if (!temConteudo) {
    problemas.push(
      `A seção ${versao} do changelog está vazia. Descreva o que mudou antes de publicar — ` +
        'o changelog é a única memória do projeto entre uma sessão e outra.',
    );
  }
}

if (problemas.length > 0) {
  console.error('\nVersionamento inconsistente:\n');
  for (const p of problemas) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`Versionamento consistente: ${versao}`);
