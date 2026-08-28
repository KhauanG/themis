/**
 * Gera `docs/mapa.md` a partir do índice do CodeGraph.
 *
 * ## Por que é gerado, e não escrito à mão
 *
 * Um mapa de código escrito à mão está errado no terceiro commit, e mapa errado é pior que
 * mapa nenhum: quem confia nele procura no lugar errado e conclui que a função não existe.
 * Este lê o índice e devolve o que está lá agora.
 *
 * ## O que ele NÃO é
 *
 * Não é o grafo inteiro. São 1.000+ símbolos e 3.000+ arestas; despejar isso em markdown
 * daria milhares de linhas que ninguém lê e que o CodeGraph responde melhor sob consulta.
 *
 * O que fica aqui é a parte que muda devagar e serve para **se orientar**: quais módulos
 * existem, o que cada um exporta, para onde as dependências apontam e quais símbolos o
 * projeto inteiro usa. Para o detalhe — corpo de função, cadeia de chamadas, raio de
 * impacto — a resposta é `codegraph_explore`, e o documento diz isso.
 *
 * Uso:
 *   npm run mapa
 *
 * Exige `codegraph init` rodado antes. Sem índice, falha dizendo isso.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

/*
  `node:sqlite` só existe a partir do Node 22.5, e o `engines` do projeto aceita 20 — que é
  a versão que a Hostinger roda. Sem esta checagem o erro seria
  `ERR_UNKNOWN_BUILTIN_MODULE`, que não diz o que fazer.

  Isto NÃO afeta produção: `npm run mapa` é ferramenta de quem desenvolve e não entra em
  `npm run build`. O servidor nunca executa este arquivo.
*/
const [maior, menor] = process.versions.node.split('.').map(Number);
if ((maior ?? 0) < 22 || ((maior ?? 0) === 22 && (menor ?? 0) < 5)) {
  console.error(`Este script precisa do Node 22.5 ou maior (você está no ${process.version}).`);
  console.error('Ele usa `node:sqlite`, que não existe em versões anteriores.');
  console.error('\nO resto do projeto continua rodando no Node 20 — só o mapa exige mais.');
  process.exit(1);
}

const { DatabaseSync } = await import('node:sqlite');

const BANCO = '.codegraph/codegraph.db';

if (!existsSync(BANCO)) {
  console.error('Índice do CodeGraph não encontrado.\n');
  console.error('Rode primeiro:  codegraph init');
  process.exit(1);
}

const db = new DatabaseSync(BANCO, { readOnly: true });
const q = (sql, ...p) => db.prepare(sql).all(...p);
const um = (sql, ...p) => db.prepare(sql).get(...p);

/** Área do projeto a que um caminho pertence. A ordem importa: a primeira que casar vence. */
const AREAS = [
  ['packages/shared/src/', 'Domínio compartilhado'],
  ['apps/web/src/lib/', 'PWA · acesso a dados (lib)'],
  ['apps/web/src/contexts/', 'PWA · estado global'],
  ['apps/web/src/components/', 'PWA · componentes'],
  ['apps/web/src/features/', 'PWA · telas'],
  ['apps/web/src/', 'PWA · raiz'],
  ['apps/api/src/', 'API'],
  ['scripts/', 'Scripts de manutenção'],
];

const areaDe = (caminho) =>
  (AREAS.find(([prefixo]) => caminho.startsWith(prefixo)) ?? [null, 'Configuração'])[1];

const ORDEM = [...AREAS.map(([, nome]) => nome), 'Configuração'];

/**
 * Primeira frase do docstring, em uma linha. Vazio quando não há.
 *
 * Descarta tabela, título, lista e bloco de código antes de cortar: sem isso a primeira
 * "frase" de um docstring que abre com tabela engolia a tabela inteira, e a coluna virava
 * uma parede de pipes.
 */
function resumo(doc) {
  if (!doc) return '';

  const linhas = doc
    .replace(/\/\*\*|\*\//g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\*/, '').trim());

  const prosa = [];
  for (const linha of linhas) {
    if (linha.startsWith('```')) break;
    if (linha.startsWith('|') || linha.startsWith('#') || linha.startsWith('-')) break;
    if (linha === '') {
      if (prosa.length > 0) break;
      continue;
    }
    prosa.push(linha);
  }

  const limpo = prosa.join(' ').replace(/\s+/g, ' ').replace(/[*`]/g, '').trim();
  const frase = limpo.split(/(?<=\.)\s/)[0] ?? '';
  return frase.length > 110 ? `${frase.slice(0, 107)}…` : frase;
}

const totais = {
  nos: um('SELECT COUNT(*) n FROM nodes').n,
  exportados: um('SELECT COUNT(*) n FROM nodes WHERE is_exported = 1').n,
  arestas: um('SELECT COUNT(*) n FROM edges').n,
  arquivos: um('SELECT COUNT(*) n FROM files').n,
};

const KINDS_UTEIS = "('function','class','interface','type_alias','constant','component','method')";

const exportados = q(`
  SELECT name, kind, file_path, start_line, docstring
  FROM nodes
  WHERE is_exported = 1 AND kind IN ${KINDS_UTEIS}
  ORDER BY file_path, start_line
`);

/**
 * Separa o cabeçalho do módulo do docstring do primeiro símbolo.
 *
 * O parser **concatena os dois**: o nó `file` fica com docstring nulo e o comentário de
 * cabeçalho vai colado no primeiro símbolo exportado. Sem tratar, `ESPERA_SERVIDOR_MS`
 * aparecia descrita como "Quando a lista de produtos pode ser mostrada como verdade" — que
 * é o assunto do arquivo, não da constante.
 *
 * O sinal de que houve concatenação é um título markdown (`## `): neste projeto só
 * cabeçalho de módulo usa. Nesse caso a abertura vira **legenda do arquivo**, que é
 * informação melhor do que a que se perde, e o símbolo fica sem resumo próprio.
 */
function separarCabecalho(doc) {
  if (!doc || !/\n\s*\*?\s*## /.test(doc)) return { cabecalho: '', proprio: doc };
  const [abertura] = doc.split(/\n\s*\*?\s*## /);
  return { cabecalho: abertura ?? '', proprio: null };
}

/*
  Quem é mais usado pelo resto do projeto. Conta só arestas vindas de OUTRO arquivo:
  chamada interna não diz nada sobre acoplamento, e infla justamente os módulos grandes.
*/
const maisUsados = q(`
  SELECT n.name, n.file_path, COUNT(*) usos
  FROM edges e
  JOIN nodes n ON n.id = e.target
  JOIN nodes o ON o.id = e.source
  WHERE e.kind IN ('calls','references')
    AND n.is_exported = 1
    AND n.kind IN ${KINDS_UTEIS}
    AND o.file_path <> n.file_path
  GROUP BY n.id
  ORDER BY usos DESC
  LIMIT 25
`);

// Direção das dependências entre áreas, pelas arestas de import.
const entreAreas = new Map();
for (const { de, para } of q(`
  SELECT o.file_path de, n.file_path para
  FROM edges e
  JOIN nodes o ON o.id = e.source
  JOIN nodes n ON n.id = e.target
  WHERE e.kind = 'imports'
`)) {
  const a = areaDe(de);
  const b = areaDe(para);
  if (a === b) continue;
  const chave = `${a} → ${b}`;
  entreAreas.set(chave, (entreAreas.get(chave) ?? 0) + 1);
}

const porArquivo = new Map();
for (const s of exportados) {
  if (!porArquivo.has(s.file_path)) porArquivo.set(s.file_path, []);
  porArquivo.get(s.file_path).push(s);
}

const porArea = new Map();
for (const [arquivo, simbolos] of porArquivo) {
  const area = areaDe(arquivo);
  if (!porArea.has(area)) porArea.set(area, []);
  porArea.get(area).push([arquivo, simbolos]);
}

let commit = 'desconhecido';
try {
  commit = execSync('git rev-parse --short HEAD', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // Fora de um repositório git. O mapa continua válido.
}

const L = [];
const p = (s = '') => L.push(s);

p('# Mapa do código');
p();
p('> ⚠️ **Gerado por `npm run mapa`. Não edite à mão** — a próxima geração apaga.');
p('> Um mapa escrito à mão está errado no terceiro commit, e mapa errado é pior que mapa');
p('> nenhum: quem confia nele procura no lugar errado e conclui que a função não existe.');
p();
p(
  `Índice de \`${commit}\` · **${totais.arquivos} arquivos**, ${totais.nos} símbolos ` +
    `(${totais.exportados} exportados), ${totais.arestas} arestas.`,
);
p();
p('## Para agentes: leia isto primeiro');
p();
p('Este documento serve para **se orientar** — descobrir onde uma coisa mora. Ele não traz');
p('corpo de função, cadeia de chamadas nem raio de impacto, e não deve trazer: são 1.000+');
p('símbolos e 3.000+ arestas, e markdown é o formato errado para isso.');
p();
p('Para o detalhe, consulte o índice — uma chamada devolve o fonte verbatim dos símbolos');
p('relevantes, os caminhos de chamada entre eles e quem quebra se você mexer:');
p();
p('```');
p('codegraph_explore(query: "<símbolos ou pergunta>", projectPath: "<raiz do projeto>")');
p('```');
p();
p('Sem MCP, o mesmo pelo terminal: `codegraph explore "<símbolos ou pergunta>"`.');
p();
p('⚠️ **O índice não se atualiza sozinho.** Se as linhas abaixo não baterem com o código,');
p('ele está velho — ver [desenvolvimento.md](desenvolvimento.md) §CodeGraph.');
p();
p('---');
p();
p('## Direção das dependências');
p();
p('Contagem de imports entre áreas. Serve para checar se a arquitetura ainda vale:');
p('`features/` não importa `firebase/firestore` direto, e o domínio não importa ninguém.');
p();
p('| De | Para | Imports |');
p('|---|---|---:|');
for (const [chave, n] of [...entreAreas.entries()].sort((a, b) => b[1] - a[1])) {
  const [de, para] = chave.split(' → ');
  p(`| ${de} | ${para} | ${n} |`);
}
p();
p('---');
p();
p('## Símbolos mais usados');
p();
p('Contando só usos **de fora do próprio arquivo** — chamada interna não diz nada sobre');
p('acoplamento. Mexer em qualquer um destes tem alcance largo.');
p();
p('| Símbolo | Onde | Usos |');
p('|---|---|---:|');
for (const s of maisUsados) p(`| \`${s.name}\` | ${s.file_path} | ${s.usos} |`);
p();
p('---');
p();
p('## O que cada módulo exporta');
p();
for (const area of ORDEM) {
  const arquivos = porArea.get(area);
  if (!arquivos) continue;
  p(`### ${area}`);
  p();
  for (const [arquivo, simbolos] of arquivos.sort((a, b) => a[0].localeCompare(b[0]))) {
    // Só o primeiro símbolo pode carregar o cabeçalho do módulo colado — ver `separarCabecalho`.
    const { cabecalho, proprio } = separarCabecalho(simbolos[0]?.docstring);
    const legenda = resumo(cabecalho);

    p(`**\`${arquivo}\`**`);
    p();
    if (legenda) {
      p(`_${legenda}_`);
      p();
    }
    p('| Símbolo | Tipo | Linha | O quê |');
    p('|---|---|---:|---|');
    for (const [i, s] of simbolos.entries()) {
      const doc = i === 0 ? proprio : s.docstring;
      const texto = resumo(doc).replace(/\|/g, '\\|');
      p(`| \`${s.name}\` | ${s.kind} | ${s.start_line} | ${texto} |`);
    }
    p();
  }
}

writeFileSync('docs/mapa.md', L.join('\n'), 'utf8');
db.close();

console.log(`docs/mapa.md gerado: ${totais.arquivos} arquivos, ${totais.exportados} símbolos exportados.`);
