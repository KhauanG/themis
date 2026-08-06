/**
 * Importação e exportação de planilha.
 *
 * Usa `exceljs`, mantido no npm, no lugar do `xlsx` que o 1.x carregava direto no HTML
 * (861 KB em toda abertura do app, versão do npm sem as correções publicadas só no CDN).
 * Entra por import dinâmico: só quem importa ou exporta paga o custo.
 */
import type { LinhaRelatorio } from '@themis/shared';
import { entregarArquivo, nomeDeArquivo } from './arquivo.js';

/** Aceita as várias grafias que já apareceram nas planilhas do ERP. */
const COLUNAS: Record<string, string[]> = {
  nome: ['nome', 'produto', 'nomeproduto', 'descricao', 'descrição'],
  codigoBarras: ['codigobarras', 'codigo de barras', 'codigo', 'ean', 'gtin'],
  idProduto: ['idproduto', 'id', 'codigoproduto', 'codigo produto'],
  estoqueSistema: ['estoquesistema', 'estoque', 'estoqueatual', 'saldo', 'quantidade sistema'],
};

function normalizar(cabecalho: string): string {
  return cabecalho
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

function mapearColunas(cabecalhos: string[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  cabecalhos.forEach((bruto, indice) => {
    const limpo = normalizar(String(bruto ?? ''));
    for (const [campo, aceitos] of Object.entries(COLUNAS)) {
      if (mapa[campo] === undefined && aceitos.includes(limpo)) mapa[campo] = indice;
    }
  });
  return mapa;
}

export interface LinhaImportada {
  nome: string;
  codigoBarras: string | null;
  IdProduto: string | null;
  estoqueSistema: number;
  temCodigoBarras: boolean;
}

export interface ResultadoImportacao {
  linhas: LinhaImportada[];
  ignoradas: number;
  colunasFaltando: string[];
}

export async function lerPlanilha(arquivo: File): Promise<ResultadoImportacao> {
  const ExcelJS = await import('exceljs');
  const pasta = new ExcelJS.Workbook();
  await pasta.xlsx.load(await arquivo.arrayBuffer());

  const aba = pasta.worksheets[0];
  if (!aba) throw new Error('A planilha está vazia.');

  const cabecalhos = (aba.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ''));
  const mapa = mapearColunas(cabecalhos);

  const faltando = ['nome', 'estoqueSistema'].filter((c) => mapa[c] === undefined);
  if (faltando.length > 0) return { linhas: [], ignoradas: 0, colunasFaltando: faltando };

  const linhas: LinhaImportada[] = [];
  let ignoradas = 0;

  aba.eachRow((linha, numero) => {
    if (numero === 1) return;
    const valores = (linha.values as unknown[]).slice(1);
    const pegar = (campo: string) => {
      const i = mapa[campo];
      return i === undefined ? undefined : valores[i];
    };

    const nome = String(pegar('nome') ?? '').trim();
    if (!nome) {
      ignoradas++;
      return;
    }

    const codigo = String(pegar('codigoBarras') ?? '').trim();
    const sistema = Number(pegar('estoqueSistema') ?? 0);

    linhas.push({
      nome,
      codigoBarras: codigo || null,
      IdProduto: String(pegar('idProduto') ?? '').trim() || null,
      estoqueSistema: Number.isFinite(sistema) ? sistema : 0,
      temCodigoBarras: Boolean(codigo),
    });
  });

  return { linhas, ignoradas, colunasFaltando: [] };
}

export async function exportarPlanilha(
  linhas: readonly LinhaRelatorio[],
  nomeEstoque: string,
): Promise<void> {
  const ExcelJS = await import('exceljs');
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
