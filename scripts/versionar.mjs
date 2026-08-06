/**
 * Sobe a versão do projeto inteiro numa operação só.
 *
 * ## Por que existe
 *
 * A versão estava em quatro `package.json` e no `docs/CHANGELOG.md`, mantidos à mão. Eles
 * divergiram: os pacotes diziam `2.0.0` enquanto o changelog já ia em `2.6.2`. Com um PWA
 * isso não é detalhe de organização — o service worker guarda a versão antiga no celular, e
 * sem um número confiável na tela não dá para responder "a correção chegou no aparelho?".
 *
 * ## Uso
 *
 *   npm run versao -- patch          # 2.6.2 -> 2.6.3   (correção)
 *   npm run versao -- minor          # 2.6.2 -> 2.7.0   (funcionalidade)
 *   npm run versao -- major          # 2.6.2 -> 3.0.0   (quebra de compatibilidade)
 *   npm run versao -- 2.9.1          # número exato
 *
 * O que ele faz:
 *   1. sincroniza a versão nos quatro `package.json`;
 *   2. abre a seção da versão nova no `docs/CHANGELOG.md`, com a data de hoje;
 *   3. NÃO commita e NÃO cria tag. Escrever o changelog é trabalho humano; o script só
 *      prepara o lugar. Depois de preencher, use `npm run versao:marcar`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Todo `package.json` que carrega a versão. Manter em sincronia é o objetivo do script. */
const PACOTES = [
  'package.json',
  'apps/web/package.json',
  'apps/api/package.json',
  'packages/shared/package.json',
];

const CHANGELOG = 'docs/CHANGELOG.md';

function ler(caminho) {
  return readFileSync(join(RAIZ, caminho), 'utf8');
}

function escrever(caminho, conteudo) {
  writeFileSync(join(RAIZ, caminho), conteudo, 'utf8');
}

export function versaoAtual() {
  return JSON.parse(ler('package.json')).version;
}

/** `2.6.2` + `minor` = `2.7.0`. Aceita também um número pronto. */
export function proximaVersao(atual, pedido) {
  if (/^\d+\.\d+\.\d+$/.test(pedido)) return pedido;

  const [maior, menor, correcao] = atual.split('.').map(Number);
  if (pedido === 'major') return `${maior + 1}.0.0`;
  if (pedido === 'minor') return `${maior}.${menor + 1}.0`;
  if (pedido === 'patch') return `${maior}.${menor}.${correcao + 1}`;

  throw new Error(`Não entendi "${pedido}". Use major, minor, patch ou um número X.Y.Z.`);
}

/** Data local em ISO. `toISOString()` usaria UTC e erraria o dia à noite no Brasil. */
export function hojeISO(agora = new Date()) {
  const d = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Insere a seção nova logo depois do cabeçalho do arquivo.
 *
 * O changelog é "mais recente primeiro", e o ponto de inserção é a primeira linha `---`
 * que vem antes da primeira versão. Se o formato mudar, o script avisa em vez de escrever
 * no lugar errado.
 */
export function abrirSecao(changelog, versao, data) {
  if (changelog.includes(`\n## ${versao} `)) {
    return { texto: changelog, jaExistia: true };
  }

  const marca = '\n---\n\n## ';
  const corte = changelog.indexOf(marca);
  if (corte === -1) {
    throw new Error(`Não achei onde inserir em ${CHANGELOG}. O formato do arquivo mudou?`);
  }

  const secao =
    `\n---\n\n## ${versao} — ${data}\n\n` +
    `### Adicionado\n\n- \n\n` +
    `### Corrigido\n\n- \n`;

  return {
    texto: changelog.slice(0, corte) + secao + changelog.slice(corte),
    jaExistia: false,
  };
}

function principal() {
  const pedido = process.argv[2];
  if (!pedido) {
    console.error('Uso: npm run versao -- <major|minor|patch|X.Y.Z>');
    process.exit(1);
  }

  const atual = versaoAtual();
  const nova = proximaVersao(atual, pedido);

  for (const caminho of PACOTES) {
    const texto = ler(caminho);
    // Substituição na primeira ocorrência de `"version"`, que é sempre a do próprio
    // pacote — as das dependências vêm depois e não têm essa chave no topo.
    const novo = texto.replace(/"version":\s*"[^"]+"/, `"version": "${nova}"`);
    if (novo === texto) throw new Error(`Não achei "version" em ${caminho}.`);
    escrever(caminho, novo);
  }

  const { texto, jaExistia } = abrirSecao(ler(CHANGELOG), nova, hojeISO());
  if (!jaExistia) escrever(CHANGELOG, texto);

  console.log(`Versão: ${atual} -> ${nova}`);
  console.log(`Pacotes sincronizados: ${PACOTES.length}`);
  console.log(
    jaExistia
      ? `${CHANGELOG} já tinha a seção ${nova}; nada mudou lá.`
      : `${CHANGELOG}: seção ${nova} aberta. Preencha antes de commitar.`,
  );
  console.log('\nDepois de escrever o changelog:');
  console.log('  npm run verificar');
  console.log('  git add -A && git commit');
  console.log('  npm run versao:marcar');
}

// Só roda como CLI; importado pelos testes, não executa nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal();
}
