/**
 * Mostra o que o ERP devolve para uma loja, e cruza com o catálogo da planilha.
 *
 * Existe porque "o estoque está incorreto" tem várias causas possíveis e elas exigem
 * respostas diferentes:
 *
 *   1. o ERP devolve outro número (aí o problema não é nosso);
 *   2. o ERP devolve o número certo com nome de campo que não reconhecemos;
 *   3. o `IdProduto` do catálogo não casa com o da listagem;
 *   4. o produto não está na listagem da loja — por estar zerado, por não pertencer àquela
 *      loja, ou por ter sido inativado no ERP.
 *
 * Só olhando a resposta crua dá para saber qual é. É o diagnóstico que o `auditoria.js` do
 * 1.x imprimia no console (`Exemplo de item da API`), fora do navegador e sem adivinhação.
 *
 * ## Uso
 *
 *   npx tsx scripts/diagnosticar-erp.mts <hashLoja>
 *   npx tsx scripts/diagnosticar-erp.mts <hashLoja> 30289733 24028455
 *   npx tsx scripts/diagnosticar-erp.mts <hashLoja> --planilha planilhaprodutos.xlsx
 *
 * O HashLoja aparece na tela **Estoques** do app. Os ids soltos são consultados um a um —
 * é o que se compara com o Nuvem3 aberto do lado.
 *
 * `--planilha` cruza o catálogo inteiro contra a listagem e responde a pergunta que um
 * produto sozinho não responde: **os ausentes têm algo em comum?** Se todos estavam
 * zerados, o ERP filtra. Se não, o motivo é outro.
 *
 * Só leitura. Não escreve no ERP nem no Firestore.
 */
import { readFileSync } from 'node:fs';
import { lerPlanilha, type LinhaImportada } from '../apps/web/src/lib/planilha.js';

const URL_LISTAR =
  process.env['ERP_LISTAR_URL'] ??
  'https://erp.nuvem3.com.br/apiv1/Estoque/EstoqueQuantidadePorLojaListar';

const argumentos = process.argv.slice(2);
const iPlanilha = argumentos.indexOf('--planilha');
const caminhoPlanilha = iPlanilha >= 0 ? argumentos[iPlanilha + 1] : undefined;
const soltos = argumentos.filter((_, i) => i !== iPlanilha && i !== iPlanilha + 1);
const [hashLoja, ...idsProcurados] = soltos;

if (!hashLoja) {
  console.error('Uso: npx tsx scripts/diagnosticar-erp.mts <hashLoja> [idProduto...] [--planilha <arquivo>]');
  console.error('O HashLoja está na tela Estoques do app.');
  process.exit(1);
}

/** As mesmas grafias que a API aceita. Ver apps/api/src/routes/erp.ts. */
const CAMPOS_ID = ['idproduto', 'IdProduto', 'idProduto', 'IdProdutoERP', 'idProdutoERP'];
const CAMPOS_QTD = ['quantidade', 'Quantidade', 'EstoqueAtual', 'estoqueAtual'];

type Registro = Record<string, unknown>;

function primeiro(item: Registro, campos: string[]): unknown {
  for (const c of campos) if (item[c] !== undefined && item[c] !== null) return item[c];
  return null;
}

/** Mesmas chaves que `chavesDeIdProduto` gera, para casar "007" com 7. */
function chaves(valor: unknown): string[] {
  const cru = String(valor ?? '').trim();
  if (cru === '') return [];
  const saida = new Set([cru]);
  const n = Number(cru);
  if (Number.isFinite(n)) saida.add(String(n));
  return [...saida];
}

const url = `${URL_LISTAR}/${encodeURIComponent(hashLoja)}`;
console.log(`GET ${url}\n`);

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 60_000);

let resposta: Response;
try {
  resposta = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
} catch (erro) {
  console.error(`Falha ao contatar o ERP: ${(erro as Error).message}`);
  process.exit(1);
} finally {
  clearTimeout(timer);
}

console.log(`HTTP ${resposta.status} ${resposta.statusText}`);
if (!resposta.ok) {
  console.error(`\nCorpo:\n${(await resposta.text()).slice(0, 500)}`);
  process.exit(1);
}

const bruto: unknown = await resposta.json();

// O ERP às vezes embrulha o array — mesmo desembrulho da API.
let itens: unknown = bruto;
if (!Array.isArray(itens) && bruto && typeof bruto === 'object') {
  const obj = bruto as Registro;
  if (Array.isArray(obj['data'])) itens = obj['data'];
  else if (Array.isArray(obj['items'])) itens = obj['items'];
}

if (!Array.isArray(itens)) {
  console.error(`\nA resposta não é uma lista. Veio um ${typeof bruto}:`);
  console.error(JSON.stringify(bruto).slice(0, 500));
  process.exit(1);
}

const lista = itens as Registro[];
console.log(`Itens recebidos: ${lista.length}\n`);
if (lista.length === 0) {
  console.error('Lista vazia. HashLoja errado devolve lista vazia em vez de erro.');
  process.exit(1);
}

console.log(`Campos do primeiro item: ${Object.keys(lista[0]!).join(', ')}`);
console.log('\nTrês primeiros itens, crus:');
for (const item of lista.slice(0, 3)) console.log(' ', JSON.stringify(item));

let semId = 0;
let semQtd = 0;
const porChave = new Map<string, number>();
const repetidos = new Map<string, number>();
const somas = new Map<string, number>();

for (const item of lista) {
  const id = String(primeiro(item, CAMPOS_ID) ?? '').trim();
  if (id === '' || id === 'null' || id === 'undefined') {
    semId++;
    continue;
  }
  if (primeiro(item, CAMPOS_QTD) === null) semQtd++;

  const q = Math.round(Number(primeiro(item, CAMPOS_QTD))) || 0;
  if (porChave.has(id)) repetidos.set(id, (repetidos.get(id) ?? 1) + 1);
  somas.set(id, (somas.get(id) ?? 0) + q);
  for (const chave of chaves(id)) porChave.set(chave, q);
}

const distintos = new Set([...somas.keys()]).size;
console.log(`\nCom identificador : ${distintos}`);
console.log(`Sem identificador : ${semId}`);
console.log(`Sem quantidade    : ${semQtd}`);

/**
 * A pergunta que decide o significado da ausência.
 *
 * Se numa amostra grande NENHUM item vem com saldo <= 0, o ERP está filtrando — e produto
 * ausente da listagem não é "desconhecido", e sim "zerado". Confundir os dois deixa na tela
 * o saldo da última importação para justamente os produtos zerados, que são os que mais
 * precisam de correção.
 */
const quantidades = [...somas.values()];
const zeros = quantidades.filter((q) => q === 0).length;
const negativos = quantidades.filter((q) => q < 0).length;

console.log(`\nSaldo zero        : ${zeros}`);
console.log(`Saldo negativo    : ${negativos}`);
console.log(`Menor saldo       : ${Math.min(...quantidades)}`);
console.log(`Maior saldo       : ${Math.max(...quantidades)}`);

if (distintos >= 50 && zeros === 0 && negativos === 0) {
  console.log('\n=> A listagem SÓ traz saldo positivo.');
  console.log('   Produto ausente está ZERADO no ERP, não "fora do ERP".');
  console.log('   O app aplica isso sozinho (omiteZerados).');
} else if (zeros > 0 || negativos > 0) {
  console.log('\n=> A listagem TRAZ saldo <= 0.');
  console.log('   Logo, ausência NÃO é "zerado": o produto não está no estoque desta loja.');
  console.log('   Causas: cadastrado em outra loja, inativado no ERP, ou IdProduto diferente.');
  console.log('   O app mantém esses produtos como "Fora do ERP" (omiteZerados desligado).');
} else {
  console.log(`\n=> Amostra pequena (${distintos} itens); não dá para concluir.`);
}

if (repetidos.size > 0) {
  console.log(`\n⚠️  ${repetidos.size} identificadores aparecem mais de uma vez.`);
  console.log('   O app grava a ÚLTIMA ocorrência. Se o Nuvem3 mostra a soma, é aqui.');
  for (const [id, vezes] of [...repetidos].slice(0, 10)) {
    console.log(`   ${id}: ${vezes}x · última=${porChave.get(id)} · soma=${somas.get(id)}`);
  }
}

if (idsProcurados.length > 0) {
  console.log('\nProdutos consultados (compare com o Nuvem3):');
  for (const id of idsProcurados) {
    const achado = chaves(id)
      .map((c) => porChave.get(c))
      .find((v) => v !== undefined);
    console.log(`  ${id}: ${achado === undefined ? 'NÃO ESTÁ NA LISTAGEM' : achado}`);
  }
}

/**
 * Cruzamento com o catálogo.
 *
 * Um produto ausente não diz nada; o conjunto dos ausentes diz. Se **todos** estavam
 * zerados na planilha, o ERP filtra zerados. Se estão espalhados por qualquer saldo, o
 * motivo é outro — loja errada, produto inativado, `IdProduto` divergente.
 */
if (caminhoPlanilha) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Cruzando com ${caminhoPlanilha}`);

  const arquivo = new File(
    [readFileSync(caminhoPlanilha)],
    caminhoPlanilha.split(/[/\\]/).pop() ?? 'planilha.xlsx',
  );
  const { linhas, colunasFaltando } = await lerPlanilha(arquivo);

  if (colunasFaltando.length > 0) {
    console.error(`Colunas faltando na planilha: ${colunasFaltando.join(', ')}`);
    process.exit(1);
  }

  const naListagem: LinhaImportada[] = [];
  const ausentes: LinhaImportada[] = [];
  const semIdNaPlanilha: LinhaImportada[] = [];

  for (const l of linhas) {
    if (l.IdProduto === null) {
      semIdNaPlanilha.push(l);
      continue;
    }
    const achou = chaves(l.IdProduto).some((c) => porChave.has(c));
    (achou ? naListagem : ausentes).push(l);
  }

  console.log(`\nProdutos na planilha : ${linhas.length}`);
  console.log(`Casaram com o ERP    : ${naListagem.length}`);
  console.log(`Ausentes da listagem : ${ausentes.length}`);
  if (semIdNaPlanilha.length > 0) {
    console.log(`Sem IdProduto        : ${semIdNaPlanilha.length}`);
  }

  if (ausentes.length > 0) {
    const zerados = ausentes.filter((l) => l.estoqueSistema === 0).length;
    const positivos = ausentes.filter((l) => l.estoqueSistema > 0).length;
    const negativosP = ausentes.filter((l) => l.estoqueSistema < 0).length;

    console.log(`\nDos ausentes, o saldo que a PLANILHA registrava:`);
    console.log(`  zero     : ${zerados}`);
    console.log(`  positivo : ${positivos}`);
    console.log(`  negativo : ${negativosP}`);

    if (positivos === 0 && negativosP === 0) {
      console.log('\n=> TODOS os ausentes estavam zerados na planilha.');
      console.log('   Forte indício de que o ERP omite zerados desta loja.');
    } else {
      console.log('\n=> Há ausentes com saldo positivo na planilha.');
      console.log('   Não é filtro de zerados. Provável: produto de outra loja,');
      console.log('   inativado no ERP, ou planilha de um momento diferente.');
    }

    console.log('\nDez primeiros ausentes (nome · IdProduto · saldo na planilha):');
    for (const l of ausentes.slice(0, 10)) {
      console.log(`  ${l.nome} · ${l.IdProduto} · ${l.estoqueSistema}`);
    }
  }
}
