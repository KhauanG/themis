import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ErroDePlanilha, lerPlanilha } from './planilha.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

interface Opcoes {
  /** Prefixo de namespace nos elementos, como o ERP faz (`<x:worksheet>`). */
  prefixo?: string;
  /** `Target="/xl/..."` em vez de relativo, como o ERP faz. */
  alvoAbsoluto?: boolean;
}

/**
 * Monta um `.xlsx` mínimo, com a opção de reproduzir o dialeto do ERP.
 *
 * Arquivo sintético em vez do arquivo do cliente porque a planilha real tem o catálogo de
 * produtos da empresa e não entra no repositório. Para conferir contra ela:
 * `npx tsx scripts/verificar-planilha.mts planilhaprodutos.xlsx`.
 */
async function montarXlsx(
  cabecalhos: string[],
  linhas: (string | number | null)[][],
  { prefixo, alvoAbsoluto = false }: Opcoes = {},
): Promise<File> {
  const p = prefixo ? `${prefixo}:` : '';
  const decl = prefixo ? `xmlns:${prefixo}="${NS}"` : `xmlns="${NS}"`;
  const coluna = (i: number) => String.fromCharCode(65 + i);

  const celula = (valor: string | number | null, ref: string) => {
    if (valor === null || valor === '') return `<${p}c r="${ref}"/>`;
    const tipo = typeof valor === 'number' ? 'n' : 'str';
    return `<${p}c r="${ref}" t="${tipo}"><${p}v>${valor}</${p}v></${p}c>`;
  };

  const linha = (valores: (string | number | null)[], n: number) =>
    `<${p}row r="${n}">${valores.map((v, i) => celula(v, `${coluna(i)}${n}`)).join('')}</${p}row>`;

  const sheet =
    `<?xml version="1.0" encoding="utf-8"?><${p}worksheet xmlns:r="${NS_REL}" ${decl}>` +
    `<${p}sheetData>${[cabecalhos, ...linhas].map((l, i) => linha(l, i + 1)).join('')}</${p}sheetData>` +
    `</${p}worksheet>`;

  const workbook =
    `<?xml version="1.0" encoding="utf-8"?><${p}workbook xmlns:r="${NS_REL}" ${decl}>` +
    `<${p}sheets><${p}sheet name="Produtos" sheetId="1" r:id="rId1"/></${p}sheets></${p}workbook>`;

  const alvo = alvoAbsoluto ? '/xl/worksheets/sheet1.xml' : 'worksheets/sheet1.xml';
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="${alvo}"/></Relationships>`,
  );
  zip.file('xl/workbook.xml', workbook);
  zip.file('xl/worksheets/sheet1.xml', sheet);

  return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'planilha.xlsx');
}

/** Os cabeçalhos exatos da planilha que o ERP da Nuvem3 gera. */
const CABECALHOS_ERP = [
  'IdProduto',
  'NomeProduto',
  'CodigoInterno',
  'CodigoBarras',
  'NCM',
  'PrecoCusto',
  'PrecoPJ',
  'PrecoVenda',
  'EstoqueMinimo',
  'EstoqueAtual',
  'Categoria',
  'Unidade',
];

const LINHA_ERP = [
  30289733,
  'ABRIDOR DE VINHO - GRANDE',
  null,
  '7908486122205',
  null,
  18.5,
  null,
  29.99,
  1,
  7,
  null,
  'Unidade',
];

/**
 * Teto de tempo próprio, e não o padrão de 5s do vitest.
 *
 * ## Por que
 *
 * `lerPlanilha` faz `await import('exceljs')` — um CommonJS de ~2 MB que o Vite precisa
 * transformar. Com a transformação já em cache o arquivo inteiro roda em 0,4s. Na
 * **primeira rodada depois de qualquer arquivo mudar**, a transformação é refeita e o
 * antivírus do Windows varre o que acabou de ser escrito: aí passa de 5s e o teste estoura.
 *
 * ## O que sustenta isso
 *
 * | Condição | Resultado |
 * |---|---|
 * | 1ª rodada após arquivos mudarem | falhou, ~10s — 3 ocorrências |
 * | Rodadas seguintes, mesma árvore | passa, 0,4–1,1s |
 * | 25 rodadas seguidas, árvore congelada | 25/25 passaram |
 *
 * Duas hipóteses foram descartadas por medição antes desta: cache do Vite apagado à mão
 * (746ms, não reproduziu) e 20 processos disputando 16 CPUs (1085ms, não reproduziu).
 *
 * ## Por que aqui e não no `vitest.config.ts`
 *
 * Subir o teto global esconderia travamento de verdade em qualquer outro teste. O custo é
 * real e conhecido **deste** arquivo: é o único que carrega o exceljs.
 */
const TETO_CARGA_FRIA_MS = 30_000;

describe('lerPlanilha', { timeout: TETO_CARGA_FRIA_MS }, () => {
  const ERP_LIDA = {
    linha: 2, nome: 'ABRIDOR DE VINHO - GRANDE', IdProduto: '30289733', codigoBarras: '7908486122205',
    PrecoCusto: 18.5, PrecoVenda: 29.99, EstoqueMinimo: 1, estoqueSistema: 7, Unidade: 'Unidade',
  };

  // A regressão que motivou a normalização: prefixo de namespace e alvo absoluto.
  it('lê a planilha no dialeto do ERP (prefixo x: e alvo absoluto)', async () => {
    const arquivo = await montarXlsx(CABECALHOS_ERP, [LINHA_ERP], { prefixo: 'x', alvoAbsoluto: true });
    const leitura = await lerPlanilha(arquivo);
    expect(leitura.aba).toBe('Produtos');
    expect(leitura.cabecalhos).toEqual(CABECALHOS_ERP);
    expect(leitura.colunasFaltando).toEqual([]);
    expect(leitura.mapa.NomeProduto).toBe(1);
    expect(leitura.linhas).toEqual([ERP_LIDA]);
  });

  it('continua lendo planilha comum, salva pelo Excel', async () => {
    const { linhas } = await lerPlanilha(await montarXlsx(CABECALHOS_ERP, [LINHA_ERP]));
    expect(linhas).toEqual([ERP_LIDA]);
  });

  // O defeito D1: vazio chegava como '' e 0, e a importação apagava o cadastro.
  it('célula vazia e coluna ausente chegam ausentes', async () => {
    const arquivo = await montarXlsx(
      ['IdProduto', 'NomeProduto', 'CodigoBarras', 'PrecoVenda', 'EstoqueAtual'],
      [[1, 'X', null, null, null]],
    );
    const [linha] = (await lerPlanilha(arquivo)).linhas;
    expect(linha).toEqual({ linha: 2, IdProduto: '1', nome: 'X' });
    expect(Object.keys(linha!).sort()).toEqual(['IdProduto', 'linha', 'nome']);
  });

  it('linha sem nome chega sem nome, com o número da planilha', async () => {
    const arquivo = await montarXlsx(CABECALHOS_ERP, [LINHA_ERP, [999, '', null, '111', null, 0, null, 0, 0, 0, null, '']]);
    expect((await lerPlanilha(arquivo)).linhas[1]).toEqual({
      linha: 3, IdProduto: '999', codigoBarras: '111', PrecoCusto: 0, PrecoVenda: 0, EstoqueMinimo: 0, estoqueSistema: 0,
    });
  });

  it('número em texto: ponto decimal, R$, e o que não é número vira null', async () => {
    const arquivo = await montarXlsx(['Nome', 'PrecoVenda', 'Saldo'], [['A', '12.5', 'R$ 12,50'], ['B', 'abc', '1.234,56']]);
    expect((await lerPlanilha(arquivo)).linhas).toEqual([
      { linha: 2, nome: 'A', PrecoVenda: 12.5, estoqueSistema: 12.5 },
      { linha: 3, nome: 'B', PrecoVenda: null, estoqueSistema: 1234.56 },
    ]);
  });

  // N1: o exceljs entrega a linha 1 com buraco, e a aproximação estourava.
  it('cabeçalho com coluna em branco no meio', async () => {
    const leitura = await lerPlanilha(await montarXlsx(['Nome', '', 'Estoque total'], [['A', null, 3]]));
    expect(leitura.cabecalhos).toEqual(['Nome', '', 'Estoque total']);
    expect(leitura.mapa).toEqual({ NomeProduto: 0, EstoqueAtual: 2 });
    expect(leitura.linhas).toEqual([{ linha: 2, nome: 'A', estoqueSistema: 3 }]);
  });

  it('aceita cabeçalhos em outras grafias', async () => {
    const arquivo = await montarXlsx(['ID', 'Nome', 'Código de Barras', 'Quantidade'], [[42, 'CERVEJA LATA', '789', 3]]);
    expect((await lerPlanilha(arquivo)).linhas).toEqual([
      { linha: 2, nome: 'CERVEJA LATA', IdProduto: '42', codigoBarras: '789', estoqueSistema: 3 },
    ]);
  });

  it('recusa planilha sem coluna de nome', async () => {
    const leitura = await lerPlanilha(await montarXlsx(['Coisa', 'Outra'], [['a', 'b']]));
    expect(leitura.colunasFaltando).toEqual(['nome do produto']);
    expect(leitura.linhas).toEqual([]);
    expect(leitura.cabecalhos).toEqual(['Coisa', 'Outra']);
  });

  it('arquivo que não é zip pede .xlsx', async () => {
    const csv = new File(['Nome;Saldo\nA;1\n'], 'produtos.xlsx');
    await expect(lerPlanilha(csv)).rejects.toThrow(ErroDePlanilha);
    await expect(lerPlanilha(csv)).rejects.toThrow('Salve a planilha como .xlsx e tente de novo.');
  });

  it('arquivo vazio pede .xlsx', async () => {
    await expect(lerPlanilha(new File([], 'vazio.xlsx'))).rejects.toThrow('Salve a planilha como .xlsx e tente de novo.');
  });

  it('zip que não é planilha rejeita', async () => {
    const zip = new JSZip();
    zip.file('leia-me.txt', 'isto não é uma planilha');
    const arquivo = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'outro.xlsx');
    await expect(lerPlanilha(arquivo)).rejects.toThrow();
  });

  it('mais de 20.000 linhas: manda dividir', async () => {
    const linhas = Array.from({ length: 20_001 }, (_, i) => [i + 1, `PRODUTO ${i + 1}`]);
    const arquivo = await montarXlsx(['IdProduto', 'NomeProduto'], linhas);
    await expect(lerPlanilha(arquivo)).rejects.toThrow('A planilha tem mais de 20.000 linhas. Divida o arquivo.');
  });
});
