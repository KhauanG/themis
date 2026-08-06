import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { lerPlanilha } from './planilha.js';

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

describe('lerPlanilha', () => {
  /**
   * A regressão que motivou tudo: a planilha do ERP usa prefixo de namespace e alvo
   * absoluto nas relações. O `exceljs` estourava com "Cannot set properties of undefined
   * (setting 'sheetNo')" — mensagem que não diz nada sobre a causa. O 1.x lia normalmente,
   * porque usava SheetJS.
   */
  it('lê a planilha no dialeto do ERP (prefixo x: e alvo absoluto)', async () => {
    const arquivo = await montarXlsx(CABECALHOS_ERP, [LINHA_ERP], {
      prefixo: 'x',
      alvoAbsoluto: true,
    });
    const { linhas, ignoradas, colunasFaltando } = await lerPlanilha(arquivo);

    expect(colunasFaltando).toEqual([]);
    expect(ignoradas).toBe(0);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      nome: 'ABRIDOR DE VINHO - GRANDE',
      IdProduto: '30289733',
      codigoBarras: '7908486122205',
      estoqueSistema: 7,
      temCodigoBarras: true,
      PrecoCusto: 18.5,
      PrecoVenda: 29.99,
      EstoqueMinimo: 1,
      Unidade: 'Unidade',
    });
  });

  it('continua lendo planilha comum, salva pelo Excel', async () => {
    const arquivo = await montarXlsx(CABECALHOS_ERP, [LINHA_ERP]);
    const { linhas } = await lerPlanilha(arquivo);
    expect(linhas[0]?.nome).toBe('ABRIDOR DE VINHO - GRANDE');
  });

  // Preço e mínimo vão para o payload do ERP na correção de estoque. Descartá-los aqui
  // faria toda correção mandar 0 para produto que tem preço cadastrado.
  it('preserva preços e estoque mínimo', async () => {
    const arquivo = await montarXlsx(CABECALHOS_ERP, [LINHA_ERP], { prefixo: 'x' });
    const [linha] = (await lerPlanilha(arquivo)).linhas;
    expect(linha?.PrecoCusto).toBe(18.5);
    expect(linha?.PrecoVenda).toBe(29.99);
    expect(linha?.EstoqueMinimo).toBe(1);
  });

  it('aceita cabeçalhos em outras grafias', async () => {
    const arquivo = await montarXlsx(
      ['ID', 'Nome', 'Código de Barras', 'Quantidade'],
      [[42, 'CERVEJA LATA', '789', 3]],
    );
    const [linha] = (await lerPlanilha(arquivo)).linhas;
    expect(linha).toMatchObject({
      nome: 'CERVEJA LATA',
      IdProduto: '42',
      codigoBarras: '789',
      estoqueSistema: 3,
    });
  });

  it('ignora linha sem nome e conta quantas foram', async () => {
    const arquivo = await montarXlsx(CABECALHOS_ERP, [
      LINHA_ERP,
      [999, '', null, '111', null, 0, null, 0, 0, 0, null, ''],
    ]);
    const { linhas, ignoradas } = await lerPlanilha(arquivo);
    expect(linhas).toHaveLength(1);
    expect(ignoradas).toBe(1);
  });

  it('produto sem código de barras entra, marcado', async () => {
    const arquivo = await montarXlsx(CABECALHOS_ERP, [
      [1, 'GRANEL', null, null, null, 0, null, 0, 0, 5, null, 'KG'],
    ]);
    const [linha] = (await lerPlanilha(arquivo)).linhas;
    expect(linha?.codigoBarras).toBe('');
    expect(linha?.temCodigoBarras).toBe(false);
  });

  it('recusa planilha sem coluna de nome', async () => {
    const arquivo = await montarXlsx(['Coisa', 'Outra'], [['a', 'b']]);
    const { colunasFaltando, linhas } = await lerPlanilha(arquivo);
    expect(colunasFaltando).toEqual(['nome do produto']);
    expect(linhas).toEqual([]);
  });

  // Sem coluna de saldo a planilha não fala sobre estoque: sobrescrever com zero apagaria
  // o saldo do sistema de todo o catálogo.
  it('avisa quando a planilha não traz coluna de saldo', async () => {
    const semSaldo = await montarXlsx(['IdProduto', 'NomeProduto'], [[1, 'X']]);
    expect((await lerPlanilha(semSaldo)).temColunaEstoque).toBe(false);

    const comSaldo = await montarXlsx(CABECALHOS_ERP, [LINHA_ERP]);
    expect((await lerPlanilha(comSaldo)).temColunaEstoque).toBe(true);
  });
});
