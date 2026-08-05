/**
 * Relatórios em PDF.
 *
 * `jspdf` e `jspdf-autotable` entram por import dinâmico: são ~400 KB que só interessam
 * a quem exporta relatório. No 1.x essas libs eram carregadas em toda abertura do app.
 *
 * Recebem `LinhaRelatorio[]`, não produtos: assim a contagem ao vivo e a auditoria salva
 * passam pelo mesmo caminho e não há como exportar uma achando que é a outra.
 */
import { ordenarPorNome, type EstatisticasAuditoria, type LinhaRelatorio } from '@themis/shared';
import { entregarArquivo, nomeDeArquivo } from './arquivo.js';

const DIAS_ALERTA = 30;

function dataBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function emDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
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
  /** Data da auditoria salva; ausente na contagem ao vivo. */
  quando?: Date;
}

function cabecalho(contexto: ContextoRelatorio): string {
  const quando = (contexto.quando ?? new Date()).toLocaleString('pt-BR');
  const origem = contexto.quando ? 'Auditoria salva' : 'Contagem ao vivo';
  return `${contexto.estoque} · Ciclo ${contexto.ciclo} · ${origem} · ${quando}`;
}

export async function exportarContagemPDF(
  linhas: readonly LinhaRelatorio[],
  contexto: ContextoRelatorio,
  estatisticas: EstatisticasAuditoria,
): Promise<void> {
  const { doc, autoTable } = await novoDocumento('Relatório de Contagem', cabecalho(contexto));

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

  autoTable(doc, {
    head: [['Produto', 'Sistema', 'Contado', 'Diferença', 'Status']],
    body: ordenarPorNome(linhas).map((l) => [
      l.nome,
      String(l.sistema),
      l.contado === null ? '-' : String(l.contado),
      String(l.diferenca),
      l.status,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 8, cellPadding: 1.5 },
    columnStyles: { 0: { cellWidth: 'auto' } },
    didParseCell: (dados) => {
      if (dados.section !== 'body' || dados.column.index !== 4) return;
      const texto = String(dados.cell.raw ?? '');
      if (texto === 'CRITICO') dados.cell.styles.textColor = [220, 38, 38];
      else if (texto === 'ERRADO') dados.cell.styles.textColor = [217, 119, 6];
    },
  });

  await entregarArquivo(doc.output('blob'), nomeDeArquivo(`contagem-${contexto.estoque}`, 'pdf'));
}

/**
 * Relatório de validades.
 *
 * Só nome e data — a validade não carrega quantidade, por decisão do produto na 4.19.5.
 * Ordenado do vencimento mais próximo para o mais distante: é a ordem em que a loja
 * precisa agir. Comparação de string funciona porque a data é ISO — ordem lexicográfica
 * é a mesma que a cronológica.
 */
export async function exportarValidadePDF(
  linhas: readonly LinhaRelatorio[],
  contexto: ContextoRelatorio,
): Promise<number> {
  const comValidade = linhas
    .filter((l): l is LinhaRelatorio & { validade: string } => l.validade !== null)
    .sort((a, b) => a.validade.localeCompare(b.validade));

  if (comValidade.length === 0) return 0;

  const hoje = new Date().toISOString().slice(0, 10);
  const limiteAlerta = emDias(DIAS_ALERTA);

  const { doc, autoTable } = await novoDocumento('Relatório de Validade', cabecalho(contexto));

  autoTable(doc, {
    startY: 32,
    head: [['Produto', 'Validade', 'Situação']],
    body: comValidade.map((l) => [
      l.nome,
      dataBR(l.validade),
      l.validade < hoje ? 'VENCIDO' : l.validade <= limiteAlerta ? `Vence em ${DIAS_ALERTA} dias` : '',
    ]),
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 },
    didParseCell: (dados) => {
      if (dados.section !== 'body' || dados.column.index !== 2) return;
      const texto = String(dados.cell.raw ?? '');
      if (texto === 'VENCIDO') {
        dados.cell.styles.textColor = [220, 38, 38];
        dados.cell.styles.fontStyle = 'bold';
      } else if (texto) {
        dados.cell.styles.textColor = [217, 119, 6];
      }
    },
  });

  await entregarArquivo(doc.output('blob'), nomeDeArquivo(`validade-${contexto.estoque}`, 'pdf'));
  return comValidade.length;
}
