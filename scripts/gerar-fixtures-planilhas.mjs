/**
 * Gera os arquivos de teste de `fixtures/planilhas/`: planilhas sintéticas (nomes e códigos
 * inventados, nunca o catálogo do cliente), iguais para o site e o app.
 *
 *   node scripts/gerar-fixtures-planilhas.mjs            # grava, dos 21 arquivos, só os que ainda não existem
 *   node scripts/gerar-fixtures-planilhas.mjs --grande   # grava só o 19-grande.xlsx (sempre regrava)
 *
 * Nunca sobrescreve um dos 21: o `17` é feito pelo `exceljs`, que carimba a hora no zip, e
 * gerar de novo mudaria os bytes (e o SHA-256) sem mudar o conteúdo. Para refazer um arquivo,
 * apague-o antes.
 */
import { existsSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const PASTA = new URL('../fixtures/planilhas/', import.meta.url);
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PACOTE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DATA_FIXA = new Date(Date.UTC(2026, 0, 1));

// O estilo 1 é o de data (`numFmtId` 14 = mm-dd-yy): é por ele que o `exceljs` devolve `Date`.
const ESTILOS = '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';

const CABECALHOS_ERP = [
  'IdProduto', 'NomeProduto', 'CodigoInterno', 'CodigoBarras', 'NCM', 'PrecoCusto',
  'PrecoPJ', 'PrecoVenda', 'EstoqueMinimo', 'EstoqueAtual', 'Categoria', 'Unidade',
];

const esc = (t) =>
  String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Dias desde 1899-12-30, como o Excel grava. `serialDeData('2026-01-31')` é 46053. */
function serialDeData(iso) {
  return (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/**
 * @param {{ abas: Array<{ nome: string, oculta?: boolean, linhas: unknown[][] }>, prefixo?: string, alvoAbsoluto?: boolean }} opcoes
 * @returns {Promise<Buffer>} o zip do .xlsx
 */
async function montar({ abas, prefixo = '', alvoAbsoluto = false }) {
  const p = prefixo ? `${prefixo}:` : '';
  const decl = prefixo ? `xmlns:${prefixo}="${NS}"` : `xmlns="${NS}"`;
  const compartilhadas = [];

  const celula = (valor, ref) => {
    if (valor === null) return '';
    const c = (attrs, miolo) =>
      miolo === undefined ? `<${p}c r="${ref}"${attrs}/>` : `<${p}c r="${ref}"${attrs}>${miolo}</${p}c>`;
    const v = (x) => `<${p}v>${esc(x)}</${p}v>`;
    if (valor === '') return c('');
    if (typeof valor === 'number') return c(' t="n"', v(valor));
    if (typeof valor === 'string') return c(' t="str"', v(valor));
    if ('s' in valor) {
      const partes = Array.isArray(valor.s) ? valor.s : null;
      compartilhadas.push(
        partes
          ? `<si>${partes.map((t) => `<r><t xml:space="preserve">${esc(t)}</t></r>`).join('')}</si>`
          : `<si><t xml:space="preserve">${esc(valor.s)}</t></si>`,
      );
      return c(' t="s"', v(compartilhadas.length - 1));
    }
    if ('i' in valor) return c(' t="inlineStr"', `<${p}is><${p}t>${esc(valor.i)}</${p}t></${p}is>`);
    if ('f' in valor) {
      return c(typeof valor.v === 'string' ? ' t="str"' : '', `<${p}f>${esc(valor.f)}</${p}f>${v(valor.v)}`);
    }
    if ('b' in valor) return c(' t="b"', v(valor.b ? 1 : 0));
    if ('e' in valor) return c(' t="e"', v(valor.e));
    // Número com o estilo de data, como o Excel grava. Nunca `t="d"`: o `exceljs` não lê.
    if ('d' in valor) return c(' s="1"', v(serialDeData(valor.d)));
    throw new Error(`célula desconhecida: ${JSON.stringify(valor)}`);
  };

  const planilhas = abas.map(({ linhas }) => {
    const corpo = linhas
      .map((valores, n) => `<${p}row r="${n + 1}">${valores.map((x, i) => celula(x, `${String.fromCharCode(65 + i)}${n + 1}`)).join('')}</${p}row>`)
      .join('');
    return `<?xml version="1.0" encoding="utf-8"?><${p}worksheet xmlns:r="${NS_REL}" ${decl}><${p}sheetData>${corpo}</${p}sheetData></${p}worksheet>`;
  });

  const temTextos = compartilhadas.length > 0;
  const total = abas.length;
  const sobreposicoes = [
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ...abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...(temTextos ? ['<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'] : []),
  ];
  const alvo = (n) => (alvoAbsoluto ? `/xl/worksheets/sheet${n}.xml` : `worksheets/sheet${n}.xml`);
  const relacoes = [
    ...abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="${alvo(i + 1)}"/>`),
    `<Relationship Id="rId${total + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>`,
    ...(temTextos ? [`<Relationship Id="rId${total + 2}" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/>`] : []),
  ];

  const zip = new JSZip();
  // Sem `createFolders`, o JSZip cria as pastas (`xl/`, `_rels/`) com a hora de agora, e os bytes mudam a cada geração.
  const entrada = (nome, texto) => zip.file(nome, texto, { date: DATA_FIXA, createFolders: false });
  entrada('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${sobreposicoes.join('')}</Types>`);
  entrada('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${NS_PACOTE}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  entrada('xl/workbook.xml', `<?xml version="1.0" encoding="utf-8"?><${p}workbook xmlns:r="${NS_REL}" ${decl}><${p}sheets>${abas.map(({ nome, oculta }, i) => `<${p}sheet name="${esc(nome)}" sheetId="${i + 1}"${oculta ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</${p}sheets></${p}workbook>`);
  entrada('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${NS_PACOTE}">${relacoes.join('')}</Relationships>`);
  entrada('xl/styles.xml', ESTILOS);
  if (temTextos) {
    entrada('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${NS}" count="${compartilhadas.length}" uniqueCount="${compartilhadas.length}">${compartilhadas.join('')}</sst>`);
  }
  planilhas.forEach((xml, i) => entrada(`xl/worksheets/sheet${i + 1}.xml`, xml));

  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

/** Uma aba só, "Produtos", com a primeira linha de `linhas` como cabeçalho. */
const simples = (linhas, opcoes = {}) => montar({ abas: [{ nome: 'Produtos', linhas }], ...opcoes });

/** A planilha que o botão "Exportar" do site gera (`exportarPlanilha`). */
async function exportacaoDoSite() {
  const pasta = new ExcelJS.Workbook();
  pasta.creator = 'Themis';
  pasta.created = DATA_FIXA;
  pasta.modified = DATA_FIXA;
  const aba = pasta.addWorksheet('Contagem');
  aba.columns = [
    { header: 'Produto', key: 'nome', width: 42 },
    { header: 'Estoque sistema', key: 'sistema', width: 16 },
    { header: 'Contado', key: 'contado', width: 12 },
    { header: 'Diferença', key: 'diferenca', width: 12 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Validade', key: 'validade', width: 12 },
  ];
  aba.getRow(1).font = { bold: true };
  for (const [nome, sistema, contado, diferenca, status, validade] of [
    ['PRODUTO TESTE 1', 10, 8, -2, 'ERRADO', '2027-01-31'],
    ['PRODUTO TESTE 2', 0, '', '', 'NÃO CONTADO', ''],
    ['PRODUTO SEM ID', '-', 2, '', 'FORA DO ERP', ''],
    ['PRODUTO X', 5, 5, 0, 'CORRETO', ''],
    ['PRODUTO Y', 3, 0, -3, 'CRITICO', ''],
  ]) {
    aba.addRow({ nome, sistema, contado, diferenca, status, validade });
  }
  return Buffer.from(await pasta.xlsx.writeBuffer());
}

const ARQUIVOS = [
  ['01-erp-dialeto.xlsx', () => simples([
    [...CABECALHOS_ERP, 'UsaNoMenuDigital', 'UsaBalancaEtiquetadoraStr', 'Excluir'],
    [1001, 'PRODUTO TESTE 1', null, '7890000010016', '22030000', 3.5, null, 6.5, 2, 12, 'BEBIDAS', 'UN', 'Não', 'Não', null],
    [2001, 'PRODUTO TESTE 9', null, null, null, 1, null, 2, 0, 0, null, 'UN', 'Não', 'Não', null],
  ], { prefixo: 'x', alvoAbsoluto: true })],
  ['02-excel-comum.xlsx', () => montar({ abas: [{ nome: 'Planilha1', linhas: [
    [{ s: 'IdProduto' }, { s: 'NomeProduto' }, { s: 'EstoqueAtual' }],
    [1001, { s: ['PRODUTO ', 'TESTE 1'] }, 10],
    [7, { s: 'PRODUTO TESTE 2' }, 3],
  ] }] })],
  ['03a-produto-qtd-ean.xlsx', () => simples([['Produto', 'Qtd', 'EAN'], ['PRODUTO SEM ID', 4, '7890000030014']])],
  ['03b-id-nome-qtde.xlsx', () => simples([['ID', 'Nome do produto', 'Qtde'], [7, 'PRODUTO TESTE 2', 0]])],
  ['03c-codigo-nome-saldo.xlsx', () => simples([['Código', 'Nome', 'Saldo'], ['7890000099996', 'PRODUTO NOVO C', 1]])],
  ['04-numeros-em-texto.xlsx', () => simples([
    ['Nome', 'PrecoVenda'],
    ['NUM A', '12.5'], ['NUM B', '0.5'], ['NUM C', '12,5'], ['NUM D', '1.234,56'],
    ['NUM E', 'R$ 12,50'], ['NUM F', 'abc'], ['NUM G', null],
  ])],
  ['05a-celulas-vazias.xlsx', () => simples([
    ['IdProduto', 'NomeProduto', 'CodigoBarras', 'NCM', 'PrecoCusto', 'PrecoVenda', 'EstoqueAtual'],
    [1001, 'PRODUTO TESTE 1', null, null, null, null, null],
    [1004, 'PRODUTO LEGADO', null, '22030000', null, null, null],
  ])],
  ['05b-sem-colunas-de-preco.xlsx', () => simples([['IdProduto', 'NomeProduto'], [1001, 'PRODUTO TESTE 1']])],
  ['06-id-repetido.xlsx', () => simples([
    ['IdProduto', 'NomeProduto'],
    [2002, 'REPETIDO A'], [2002, 'REPETIDO B'], ['007', 'PRODUTO TESTE 2'], [7, 'PRODUTO TESTE 2 DE NOVO'],
  ])],
  ['07-recusadas.xlsx', () => simples([
    ['IdProduto', 'NomeProduto', 'PrecoVenda', 'EstoqueAtual'],
    [3001, 'A'.repeat(301), 1, 1],
    ['abc', 'ID TEXTO', 1, 1],
    [0, 'ID ZERO', 1, 1],
    [3002, 'PRECO NEGATIVO', -3, 1],
    [3003, null, 1, 1],
    [3004, 'SALDO NEGATIVO', 1, -3],
  ])],
  ['08-sem-coluna-nome.xlsx', () => simples([['Coisa', 'Outra'], ['a', 'b']])],
  ['09-cabecalho-com-buraco.xlsx', () => simples([['Nome', '', 'Estoque'], ['PRODUTO BURACO', null, 3]])],
  ['10-validade-no-cabecalho.xlsx', () => simples([['Nome', 'Validade', 'Saldo'], ['PRODUTO VALIDADE', '2027-01-31', 5]])],
  ['11a-capa-na-frente.xlsx', () => montar({ abas: [
    { nome: 'Capa', linhas: [['Relatório de produtos']] },
    { nome: 'Produtos', linhas: [['IdProduto', 'NomeProduto'], [1001, 'PRODUTO TESTE 1']] },
  ] })],
  ['11b-aba-oculta.xlsx', () => montar({ abas: [
    { nome: 'Oculta', oculta: true, linhas: [['Nome'], ['PRODUTO DA OCULTA']] },
    { nome: 'Produtos', linhas: [['Nome'], ['PRODUTO DA VISIVEL']] },
  ] })],
  ['12-so-cabecalho.xlsx', () => simples([['IdProduto', 'NomeProduto']])],
  // Assinatura do formato antigo (OLE2) e zeros até 512 bytes: não é zip.
  ['13-antigo.xls', () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)])],
  ['14-csv-renomeado.xlsx', () => Buffer.from('Nome;Saldo\nPRODUTO CSV;1\n', 'utf8')],
  ['15-codigos.xlsx', () => simples([
    ['Nome', 'CodigoBarras'],
    ['EAN NUMERO', 7890000150019], ['EAN TEXTO', '7890000150026'], ['ZERO A ESQUERDA', '0789000015003'],
    ['QUATORZE', 17890000150016], ['DEZESSEIS', '1234567890123456'],
  ])],
  ['16-formulas-e-formatado.xlsx', () => simples([
    ['Nome', 'CodigoBarras', 'PrecoVenda', 'Unidade'],
    [{ f: '"FORMULA"&" OK"', v: 'FORMULA OK' }, { i: 'INLINE123' }, { f: '1+1', v: 2 }, 'UN'],
    [{ s: ['TEXTO ', 'EM PARTES'] }, { b: true }, 1, { d: '2026-01-31' }],
    ['COM ERRO', { e: '#N/A' }, { e: '#DIV/0!' }, 'UN'],
    ['DATA NO PRECO', null, { d: '2026-01-31' }, 'UN'],
  ])],
  ['17-exportacao-site.xlsx', exportacaoDoSite],
];

const grande = () => simples([
  CABECALHOS_ERP,
  ...Array.from({ length: 10_000 }, (_, k) => {
    const i = k + 1;
    return [i, `PRODUTO GRANDE ${i}`, null, String(7890000000000 + i), null, 1, 1, 2, 0, i % 50, 'TESTE', 'UN'];
  }),
]);

const opcao = process.argv[2];
if (opcao === '--grande') {
  writeFileSync(new URL('19-grande.xlsx', PASTA), await grande());
  console.log('gravado 19-grande.xlsx');
} else if (opcao === undefined) {
  for (const [nome, gerar] of ARQUIVOS) {
    const destino = new URL(nome, PASTA);
    if (existsSync(destino)) {
      console.log(`já existe ${nome}`);
    } else {
      writeFileSync(destino, await gerar());
      console.log(`gravado ${nome}`);
    }
  }
} else {
  console.error('Uso: node scripts/gerar-fixtures-planilhas.mjs [--grande]');
  process.exitCode = 1;
}
