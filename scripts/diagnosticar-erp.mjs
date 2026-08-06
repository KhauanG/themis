/**
 * Mostra exatamente o que o ERP devolve para uma loja, sem passar pelo app.
 *
 * Existe porque "o estoque está incorreto" tem três causas possíveis e elas exigem
 * respostas diferentes:
 *
 *   1. o ERP devolve outro número (aí o problema não é nosso);
 *   2. o ERP devolve o número certo mas com nome de campo que não reconhecemos;
 *   3. o `IdProduto` do catálogo não casa com o da listagem.
 *
 * Só olhando a resposta crua dá para saber qual é. É o mesmo diagnóstico que o
 * `auditoria.js` do 1.x imprimia no console (`Exemplo de item da API`), fora do navegador.
 *
 * ## Uso
 *
 *   node scripts/diagnosticar-erp.mjs <hashLoja>
 *   node scripts/diagnosticar-erp.mjs <hashLoja> 30289733 24028455
 *
 * O HashLoja aparece na tela **Estoques** do app. Os ids depois dele são opcionais: para
 * cada um, o script mostra a quantidade que o ERP reporta — é o que se compara com o
 * Nuvem3 aberto do lado.
 *
 * Só leitura. Não escreve no ERP nem no Firestore.
 */
const URL_LISTAR =
  process.env.ERP_LISTAR_URL ??
  'https://erp.nuvem3.com.br/apiv1/Estoque/EstoqueQuantidadePorLojaListar';

const [hashLoja, ...idsProcurados] = process.argv.slice(2);

if (!hashLoja) {
  console.error('Uso: node scripts/diagnosticar-erp.mjs <hashLoja> [idProduto...]');
  console.error('O HashLoja está na tela Estoques do app.');
  process.exit(1);
}

/** As mesmas grafias que a API aceita. Ver apps/api/src/routes/erp.ts. */
const CAMPOS_ID = ['idproduto', 'IdProduto', 'idProduto', 'IdProdutoERP', 'idProdutoERP'];
const CAMPOS_QTD = ['quantidade', 'Quantidade', 'EstoqueAtual', 'estoqueAtual'];

const primeiro = (item, campos) => {
  for (const c of campos) if (item[c] !== undefined && item[c] !== null) return item[c];
  return null;
};

const url = `${URL_LISTAR}/${encodeURIComponent(hashLoja)}`;
console.log(`GET ${url}\n`);

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 60_000);

let resposta;
try {
  resposta = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
} catch (erro) {
  console.error(`Falha ao contatar o ERP: ${erro.message}`);
  process.exit(1);
} finally {
  clearTimeout(timer);
}

console.log(`HTTP ${resposta.status} ${resposta.statusText}`);
if (!resposta.ok) {
  console.error(`\nCorpo:\n${(await resposta.text()).slice(0, 500)}`);
  process.exit(1);
}

const bruto = await resposta.json();

// O ERP às vezes embrulha o array — mesmo desembrulho da API.
let itens = bruto;
if (!Array.isArray(itens) && bruto && typeof bruto === 'object') {
  if (Array.isArray(bruto.data)) itens = bruto.data;
  else if (Array.isArray(bruto.items)) itens = bruto.items;
}

if (!Array.isArray(itens)) {
  console.error(`\nA resposta não é uma lista. Veio um ${typeof bruto}:`);
  console.error(JSON.stringify(bruto).slice(0, 500));
  process.exit(1);
}

console.log(`Itens recebidos: ${itens.length}\n`);
if (itens.length === 0) {
  console.error('Lista vazia. HashLoja errado devolve lista vazia em vez de erro.');
  process.exit(1);
}

console.log(`Campos do primeiro item: ${Object.keys(itens[0]).join(', ')}`);
console.log(`\nTrês primeiros itens, crus:`);
for (const item of itens.slice(0, 3)) console.log(' ', JSON.stringify(item));

let semId = 0;
let semQtd = 0;
const porId = new Map();
const repetidos = new Map();

for (const item of itens) {
  const id = String(primeiro(item, CAMPOS_ID) ?? '').trim();
  if (id === '' || id === 'null' || id === 'undefined') {
    semId++;
    continue;
  }
  if (primeiro(item, CAMPOS_QTD) === null) semQtd++;
  if (porId.has(id)) repetidos.set(id, (repetidos.get(id) ?? 1) + 1);
  porId.set(id, Math.round(Number(primeiro(item, CAMPOS_QTD))) || 0);
}

console.log(`\nCom identificador : ${porId.size}`);
console.log(`Sem identificador : ${semId}`);
console.log(`Sem quantidade    : ${semQtd}`);

/**
 * A pergunta que decide o significado da ausência.
 *
 * Se numa amostra grande NENHUM item vem com saldo <= 0, o ERP está filtrando — e produto
 * ausente da listagem não e "desconhecido", e sim "zerado". Confundir os dois deixa na tela
 * o saldo da ultima importacao para justamente os produtos zerados, que sao os que mais
 * precisam de correcao.
 */
const quantidades = [...porId.values()];
const zeros = quantidades.filter((q) => q === 0).length;
const negativos = quantidades.filter((q) => q < 0).length;

console.log(`\nSaldo zero        : ${zeros}`);
console.log(`Saldo negativo    : ${negativos}`);
if (quantidades.length > 0) {
  console.log(`Menor saldo       : ${Math.min(...quantidades)}`);
  console.log(`Maior saldo       : ${Math.max(...quantidades)}`);
}

if (porId.size >= 50 && zeros === 0 && negativos === 0) {
  console.log('\n=> A listagem SO traz saldo positivo.');
  console.log('   Produto ausente esta ZERADO no ERP, nao "fora do ERP".');
  console.log('   O app aplica isso automaticamente (omiteZerados).');
} else if (zeros > 0 || negativos > 0) {
  console.log('\n=> A listagem TRAZ saldo <= 0.');
  console.log('   Produto ausente e mesmo desconhecido pelo ERP — provavel IdProduto diferente.');
} else {
  console.log(`\n=> Amostra pequena (${porId.size} itens); nao da para concluir.`);
}

/**
 * Produto repetido é o suspeito número um de "o número não bate".
 *
 * O app grava a última ocorrência, como o 1.x. Se o ERP manda uma linha por depósito, o
 * saldo correto seria a **soma** — e aí a diferença entre o que o Themis mostra e o que o
 * Nuvem3 mostra tem explicação. As duas leituras aparecem abaixo para comparar.
 */
if (repetidos.size > 0) {
  console.log(`\n⚠️  ${repetidos.size} identificadores aparecem mais de uma vez.`);
  console.log('   O app grava a ÚLTIMA ocorrência. Se o Nuvem3 mostra a soma, é aqui.');
  const somas = new Map();
  for (const item of itens) {
    const id = String(primeiro(item, CAMPOS_ID) ?? '').trim();
    if (!repetidos.has(id)) continue;
    somas.set(id, (somas.get(id) ?? 0) + (Math.round(Number(primeiro(item, CAMPOS_QTD))) || 0));
  }
  for (const [id, vezes] of [...repetidos].slice(0, 10)) {
    console.log(`   ${id}: ${vezes}x · última=${porId.get(id)} · soma=${somas.get(id)}`);
  }
}

if (idsProcurados.length > 0) {
  console.log('\nProdutos consultados (compare com o Nuvem3):');
  for (const id of idsProcurados) {
    const alvo = String(id).trim();
    // Mesmas chaves que `chavesDeIdProduto` gera.
    const chaves = new Set([alvo, String(Number(alvo))]);
    const achado = [...chaves].map((c) => porId.get(c)).find((v) => v !== undefined);
    console.log(`  ${alvo}: ${achado === undefined ? 'NÃO ESTÁ NA LISTAGEM' : achado}`);
  }
}
