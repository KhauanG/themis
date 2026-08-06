/**
 * Importação e exportação de planilha.
 *
 * Usa `exceljs`, mantido no npm, no lugar do `xlsx` que o 1.x carregava direto no HTML
 * (861 KB em toda abertura do app, versão do npm sem as correções publicadas só no CDN).
 * Entra por import dinâmico: só quem importa ou exporta paga o custo.
 */
import {
  mapearColunas,
  numeroDeCelula,
  textoDeCelula,
  type CampoPlanilha,
  type LinhaRelatorio,
} from '@themis/shared';
import { entregarArquivo, nomeDeArquivo } from './arquivo.js';
import { normalizarPacoteXlsx } from './planilha-formato.js';

/**
 * `exceljs` é CommonJS. O Vite achata os named exports no import dinâmico; o Node os
 * entrega dentro de `default`. Sem isto, `new ExcelJS.Workbook()` estoura com
 * `is not a constructor` fora do navegador — e o script que confere a leitura contra a
 * planilha real do cliente roda no Node.
 */
async function carregarExcelJS() {
  const mod = await import('exceljs');
  const raiz = mod as unknown as { default?: unknown };
  return (raiz.default ?? mod) as typeof mod;
}

/**
 * Uma linha aproveitada da planilha.
 *
 * Traz mais do que a contagem precisa de propósito: `PrecoCusto`, `PrecoVenda` e
 * `EstoqueMinimo` **fazem parte do payload que o ERP espera** na correção de estoque. Se a
 * importação os descartasse, toda correção mandaria `0` para produto que tem preço.
 */
export interface LinhaImportada {
  nome: string;
  codigoBarras: string;
  IdProduto: string | null;
  estoqueSistema: number;
  temCodigoBarras: boolean;
  CodigoInterno: string;
  NCM: string;
  PrecoCusto: number;
  PrecoPJ: number;
  PrecoVenda: number;
  EstoqueMinimo: number;
  Categoria: string;
  Unidade: string;
}

export interface ResultadoImportacao {
  linhas: LinhaImportada[];
  /** Linhas sem nome de produto. Não dá para importar produto sem nome. */
  ignoradas: number;
  /** Vazio quando a planilha serve. Só o nome é indispensável, como no 1.x. */
  colunasFaltando: string[];
  /**
   * A planilha trazia coluna de saldo.
   *
   * Quando **não** trazia, o saldo do produto que já existe não pode ser sobrescrito com
   * zero: a planilha simplesmente não fala sobre isso. É a mesma distinção que o 1.x fazia
   * com `hasEstoqueAtualColumn`.
   */
  temColunaEstoque: boolean;
}

export async function lerPlanilha(arquivo: File): Promise<ResultadoImportacao> {
  const ExcelJS = await carregarExcelJS();
  const pasta = new ExcelJS.Workbook();

  // O ERP gera OOXML num dialeto que o `exceljs` não abre. Ver `planilha-formato.ts`.
  await pasta.xlsx.load(await normalizarPacoteXlsx(await arquivo.arrayBuffer()));

  const aba = pasta.worksheets[0];
  if (!aba) throw new Error('A planilha está vazia.');

  // `values` do exceljs é 1-based: a posição 0 nunca é usada.
  const cabecalhos = ((aba.getRow(1).values as unknown[]) ?? []).slice(1);
  const mapa = mapearColunas(cabecalhos);

  // Só o nome é obrigatório — mesma regra do 1.x. Sem `EstoqueAtual` o produto entra com
  // saldo 0, que é o certo: "Buscar estoque" preenche depois a partir do ERP.
  const temColunaEstoque = mapa.EstoqueAtual !== undefined;

  if (mapa.NomeProduto === undefined) {
    return { linhas: [], ignoradas: 0, colunasFaltando: ['nome do produto'], temColunaEstoque };
  }

  const linhas: LinhaImportada[] = [];
  let ignoradas = 0;

  aba.eachRow((linha, numero) => {
    if (numero === 1) return;
    const valores = ((linha.values as unknown[]) ?? []).slice(1);

    const celula = (campo: CampoPlanilha): unknown => {
      const i = mapa[campo];
      return i === undefined ? undefined : valores[i];
    };
    const texto = (campo: CampoPlanilha) => textoDeCelula(celula(campo));
    const numero_ = (campo: CampoPlanilha) => numeroDeCelula(celula(campo));

    const nome = texto('NomeProduto');
    if (!nome) {
      ignoradas++;
      return;
    }

    const codigo = texto('CodigoBarras');

    linhas.push({
      nome,
      codigoBarras: codigo,
      IdProduto: texto('IdProduto') || null,
      estoqueSistema: numero_('EstoqueAtual'),
      temCodigoBarras: codigo !== '',
      CodigoInterno: texto('CodigoInterno'),
      NCM: texto('NCM'),
      PrecoCusto: numero_('PrecoCusto'),
      PrecoPJ: numero_('PrecoPJ'),
      PrecoVenda: numero_('PrecoVenda'),
      EstoqueMinimo: numero_('EstoqueMinimo'),
      Categoria: texto('Categoria'),
      Unidade: texto('Unidade'),
    });
  });

  return { linhas, ignoradas, colunasFaltando: [], temColunaEstoque };
}

export async function exportarPlanilha(
  linhas: readonly LinhaRelatorio[],
  nomeEstoque: string,
): Promise<void> {
  const ExcelJS = await carregarExcelJS();
  const pasta = new ExcelJS.Workbook();
  pasta.creator = 'Themis';
  pasta.created = new Date();

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

  // Sem reordenar: as linhas já chegam no recorte e na ordem escolhidos na tela.
  for (const l of linhas) {
    aba.addRow({
      nome: l.nome,
      sistema: l.sistema,
      // Célula vazia em vez de 0: 0 é contagem legítima e confundiria com "não contado".
      contado: l.contado ?? '',
      diferenca: l.diferenca === '-' ? '' : l.diferenca,
      status: l.status,
      validade: l.validade ?? '',
    });
  }

  const buffer = await pasta.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  await entregarArquivo(blob, nomeDeArquivo(`contagem-${nomeEstoque}`, 'xlsx'));
}
