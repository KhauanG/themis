/**
 * Importação e exportação de planilha.
 *
 * Usa `exceljs`, mantido no npm, no lugar do `xlsx` que o 1.x carregava direto no HTML
 * (861 KB em toda abertura do app, versão do npm sem as correções publicadas só no CDN).
 * Entra por import dinâmico: só quem importa ou exporta paga o custo.
 *
 * A leitura não decide nada: devolve o que a planilha diz, com célula vazia e coluna ausente
 * como campo ausente. Quem decide o que entra, o que muda e o que se recusa é
 * `planejarImportacao`, em `@themis/shared`.
 */
import {
  mapearColunas,
  numeroDeCelula,
  textoDeCelula,
  type LinhaPlanilha,
  type LinhaRelatorio,
  type MapaColunas,
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

/** Id do produto novo: `imp-` + os 32 primeiros hex do SHA-256 (UTF-8) da chave de casamento. */
export async function idDeImportacao(chave: string): Promise<string> {
  const resumo = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chave));
  const hex = Array.from(new Uint8Array(resumo), (b) => b.toString(16).padStart(2, '0')).join('');
  return `imp-${hex.slice(0, 32)}`;
}

export const LIMITE_LINHAS_PLANILHA = 20_000;

/** Erro de leitura cuja mensagem é texto de tela. */
export class ErroDePlanilha extends Error {}

export interface LeituraPlanilha {
  /** Nome da aba lida: a primeira, na ordem do arquivo. */
  aba: string;
  /** Texto de cada célula da linha 1. Coluna em branco é `''`. */
  cabecalhos: string[];
  mapa: MapaColunas;
  /** `['nome do produto']` quando falta a coluna de nome; aí `linhas` vem vazia. */
  colunasFaltando: string[];
  /** Toda linha com algum valor, menos a 1, na ordem. Inclui as sem nome. */
  linhas: LinhaPlanilha[];
}

const CAMPOS_DE_TEXTO = [
  ['NomeProduto', 'nome'],
  ['IdProduto', 'IdProduto'],
  ['CodigoBarras', 'codigoBarras'],
  ['CodigoInterno', 'CodigoInterno'],
  ['NCM', 'NCM'],
  ['Categoria', 'Categoria'],
  ['Unidade', 'Unidade'],
] as const;

const CAMPOS_NUMERICOS = [
  ['PrecoCusto', 'PrecoCusto'],
  ['PrecoPJ', 'PrecoPJ'],
  ['PrecoVenda', 'PrecoVenda'],
  ['EstoqueMinimo', 'EstoqueMinimo'],
  ['EstoqueAtual', 'estoqueSistema'],
] as const;

export async function lerPlanilha(arquivo: File): Promise<LeituraPlanilha> {
  const dados = await arquivo.arrayBuffer();
  // Todo .xlsx é um zip, e todo zip começa com "PK". Pega .csv e .xls renomeados.
  const inicio = new Uint8Array(dados, 0, Math.min(2, dados.byteLength));
  if (inicio.length < 2 || inicio[0] !== 0x50 || inicio[1] !== 0x4b) {
    throw new ErroDePlanilha('Salve a planilha como .xlsx e tente de novo.');
  }

  const ExcelJS = await carregarExcelJS();
  const pasta = new ExcelJS.Workbook();

  // O ERP gera OOXML num dialeto que o `exceljs` não abre. Ver `planilha-formato.ts`.
  await pasta.xlsx.load(await normalizarPacoteXlsx(dados));

  const aba = pasta.worksheets[0];
  if (!aba) throw new ErroDePlanilha('A planilha está vazia.');
  // Antes do eachRow: não monta 20 mil objetos à toa. O 1 é o cabeçalho.
  if (aba.actualRowCount > LIMITE_LINHAS_PLANILHA + 1) {
    throw new ErroDePlanilha('A planilha tem mais de 20.000 linhas. Divida o arquivo.');
  }

  // `values` do exceljs é 1-based (a posição 0 nunca é usada) e vem com buraco onde a coluna
  // está em branco; `Array.from` tapa os buracos.
  const cabecalhos = Array.from((aba.getRow(1).values as unknown[]) ?? [])
    .slice(1)
    .map(textoDeCelula);
  const mapa = mapearColunas(cabecalhos);

  if (mapa.NomeProduto === undefined) {
    return { aba: aba.name, cabecalhos, mapa, colunasFaltando: ['nome do produto'], linhas: [] };
  }

  // O `eachRow` já pula a linha sem nenhum valor. Aqui entra só a chave que tem valor: vazio
  // e coluna ausente são a mesma coisa, "não mexa".
  const linhas: LinhaPlanilha[] = [];
  aba.eachRow((linha, numero) => {
    if (numero === 1) return;
    const valores = ((linha.values as unknown[]) ?? []).slice(1);
    const celula = (campo: keyof MapaColunas): unknown => {
      const i = mapa[campo];
      return i === undefined ? undefined : valores[i];
    };

    const item: LinhaPlanilha = { linha: numero };
    for (const [campo, chave] of CAMPOS_DE_TEXTO) {
      const t = textoDeCelula(celula(campo));
      if (t !== '') item[chave] = t;
    }
    for (const [campo, chave] of CAMPOS_NUMERICOS) {
      const n = numeroDeCelula(celula(campo));
      if (n !== undefined) item[chave] = n;
    }
    linhas.push(item);
  });

  return { aba: aba.name, cabecalhos, mapa, colunasFaltando: [], linhas };
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
