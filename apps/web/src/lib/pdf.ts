/**
 * Relatórios em PDF.
 *
 * `jspdf` e `jspdf-autotable` entram por import dinâmico: são ~400 KB que só interessam
 * a quem exporta relatório. No 1.x essas libs eram carregadas em toda abertura do app.
 */
import {
  diferencaDe,
  fisicoDe,
  nomeDe,
  sistemaDe,
  statusDe,
  validadeDe,
  type EstatisticasAuditoria,
  type Produto,
} from '@themis/shared';
import { entregarArquivo, nomeDeArquivo } from './arquivo.js';

function dataBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

async function novoDocumento(titulo: string, subtitulo: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFontSize(16);
  doc.text(titulo, 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(subtitulo, 14, 25);
  doc.setTextColor(0);

  return { doc, autoTable };
}

export interface ContextoRelatorio {
  estoque: string;
  ciclo: number;
}

export async function exportarContagemPDF(
  produtos: readonly Produto[],
  contexto: ContextoRelatorio,
  estatisticas: EstatisticasAuditoria,
): Promise<void> {
  const gerado = new Date().toLocaleString('pt-BR');
  const { doc, autoTable } = await novoDocumento(
    'Relatório de Contagem',
    `${contexto.estoque} · Ciclo ${contexto.ciclo} · ${gerado}`,
  );

  autoTable(doc, {
    startY: 32,
    head: [['Contados', 'Não contados', 'Corretos', 'Divergentes', '% divergência']],
    body: [
      [
        String(estatisticas.contados),
        String(estatisticas.naoContados),
        String(estatisticas.corretos),
        String(estatisticas.incorretos),
        `${estatisticas.percentualIncorretos}%`,
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59] },
  });

  const linhas = [...produtos]
    .sort((a, b) => nomeDe(a).localeCompare(nomeDe(b), 'pt-BR'))
    .map((p) => [
      nomeDe(p),
      String(sistemaDe(p)),
      String(fisicoDe(p)),
      String(diferencaDe(p)),
      statusDe(p),
    ]);

  autoTable(doc, {
    head: [['Produto', 'Sistema', 'Contado', 'Diferença', 'Status']],
    body: linhas,
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 8, cellPadding: 1.5 },
    columnStyles: { 0: { cellWidth: 'auto' } },
  });

  await entregarArquivo(doc.output('blob'), nomeDeArquivo(`contagem-${contexto.estoque}`, 'pdf'));
}

/**
 * Relatório de validades.
 *
 * Só nome e data — a validade não carrega quantidade, por decisão do produto na 4.19.5.
 * Ordenado do vencimento mais próximo para o mais distante: é a ordem em que a loja
 * precisa agir.
 */
export async function exportarValidadePDF(
  produtos: readonly Produto[],
  contexto: ContextoRelatorio,
): Promise<number> {
  const comValidade = produtos
    .map((p) => ({ nome: nomeDe(p), validade: validadeDe(p) }))
    .filter((p): p is { nome: string; validade: string } => p.validade !== null)
    .sort((a, b) => a.validade.localeCompare(b.validade));

  if (comValidade.length === 0) return 0;

  const hoje = new Date().toISOString().slice(0, 10);
  const gerado = new Date().toLocaleString('pt-BR');
  const { doc, autoTable } = await novoDocumento(
    'Relatório de Validade',
    `${contexto.estoque} · Ciclo ${contexto.ciclo} · ${gerado}`,
  );

  autoTable(doc, {
    startY: 32,
    head: [['Produto', 'Validade', 'Situação']],
    body: comValidade.map((p) => [
      p.nome,
      dataBR(p.validade),
      p.validade < hoje ? 'VENCIDO' : p.validade <= proximosDias(30) ? 'Vence em 30 dias' : '',
    ]),
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 },
    // Comparação de string funciona porque a data é ISO: ordem lexicográfica = cronológica.
    didParseCell: (dados) => {
      if (dados.section !== 'body' || dados.column.index !== 2) return;
      const texto = String(dados.cell.raw ?? '');
      if (texto === 'VENCIDO') dados.cell.styles.textColor = [220, 38, 38];
      else if (texto) dados.cell.styles.textColor = [217, 119, 6];
    },
  });

  await entregarArquivo(doc.output('blob'), nomeDeArquivo(`validade-${contexto.estoque}`, 'pdf'));
  return comValidade.length;
}

function proximosDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}
