/**
 * Relatórios em PDF.
 *
 * Mesma linguagem visual da interface: neutros carregam a página, cor só onde comunica
 * estado. Nada de zebrado nem de linhas de grade — separação por régua fina, como na
 * tabela do app. Um relatório impresso costuma ser lido em reunião; ruído visual atrapalha
 * mais no papel do que na tela.
 *
 * `jspdf` e `jspdf-autotable` entram por import dinâmico: são ~400 KB que só interessam a
 * quem exporta relatório.
 *
 * Recebem `LinhaRelatorio[]`, não produtos: assim a contagem ao vivo e a auditoria salva
 * passam pelo mesmo caminho e não há como exportar uma achando que é a outra.
 */
import { ordenarPorNome, type EstatisticasAuditoria, type LinhaRelatorio } from '@themis/shared';
import { entregarArquivo, nomeDeArquivo } from './arquivo.js';

const DIAS_ALERTA = 30;

/** Paleta espelhada de `estilos/tokens.css`. Se lá mudar, aqui muda junto. */
const COR = {
  texto: [29, 29, 31] as [number, number, number],
  suave: [110, 110, 115] as [number, number, number],
  fraco: [150, 150, 155] as [number, number, number],
  regua: [210, 210, 215] as [number, number, number],
  faixa: [248, 248, 250] as [number, number, number],
  ok: [0, 135, 90] as [number, number, number],
  alerta: [164, 91, 0] as [number, number, number],
  critico: [201, 37, 45] as [number, number, number],
};

const MARGEM = 16;

function dataBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function emDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export interface ContextoRelatorio {
  estoque: string;
  ciclo: number;
  /** Data da auditoria salva; ausente na contagem ao vivo. */
  quando?: Date;
}

async function carregarJsPdf() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return { jsPDF, autoTable };
}

type Documento = Awaited<ReturnType<typeof carregarJsPdf>>['jsPDF'] extends new (
  ...args: never[]
) => infer D
  ? D
  : never;

/**
 * Cabeçalho do relatório: título grande, contexto em cinza, régua fina.
 * Devolve a altura ocupada, para a tabela saber onde começar.
 */
function desenharCabecalho(doc: Documento, titulo: string, contexto: ContextoRelatorio): number {
  const largura = doc.internal.pageSize.getWidth();
  const quando = (contexto.quando ?? new Date()).toLocaleString('pt-BR');
  const origem = contexto.quando ? 'Auditoria salva' : 'Contagem ao vivo';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...COR.texto);
  doc.text(titulo, MARGEM, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...COR.suave);
  doc.text(`${contexto.estoque} · Ciclo ${contexto.ciclo}`, MARGEM, 26.5);

  // Origem e data à direita: informação de contexto, não de conteúdo.
  doc.setFontSize(8.5);
  doc.setTextColor(...COR.fraco);
  doc.text(`${origem} · ${quando}`, largura - MARGEM, 26.5, { align: 'right' });

  doc.setDrawColor(...COR.regua);
  doc.setLineWidth(0.3);
  doc.line(MARGEM, 31, largura - MARGEM, 31);

  return 38;
}

/** Rodapé com paginação, aplicado depois que o total de páginas é conhecido. */
function desenharRodape(doc: Documento): void {
  const total = doc.getNumberOfPages();
  const largura = doc.internal.pageSize.getWidth();
  const altura = doc.internal.pageSize.getHeight();

  for (let pagina = 1; pagina <= total; pagina++) {
    doc.setPage(pagina);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COR.fraco);
    doc.text('Themis · Grupo Ice Beer', MARGEM, altura - 10);
    doc.text(`${pagina} de ${total}`, largura - MARGEM, altura - 10, { align: 'right' });
  }
}

/** Estilo comum das tabelas: régua fina embaixo, sem grade, cabeçalho em caixa alta. */
const ESTILO_TABELA = {
  theme: 'plain' as const,
  styles: {
    font: 'helvetica',
    fontSize: 9,
    cellPadding: { top: 2.4, bottom: 2.4, left: 2, right: 2 },
    textColor: COR.texto,
    lineColor: COR.regua,
    lineWidth: { bottom: 0.1 } as never,
  },
  headStyles: {
    fontStyle: 'bold' as const,
    fontSize: 7.5,
    textColor: COR.suave,
    fillColor: COR.faixa,
    lineWidth: { bottom: 0.3 } as never,
    lineColor: COR.regua,
  },
  margin: { left: MARGEM, right: MARGEM },
};

export async function exportarContagemPDF(
  linhas: readonly LinhaRelatorio[],
  contexto: ContextoRelatorio,
  estatisticas: EstatisticasAuditoria,
): Promise<void> {
  const { jsPDF, autoTable } = await carregarJsPdf();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }) as Documento;

  const inicio = desenharCabecalho(doc, 'Relatório de contagem', contexto);

  // Resumo em blocos de rótulo e número, como as métricas do painel.
  const largura = doc.internal.pageSize.getWidth();
  const util = largura - MARGEM * 2;
  const metricas: Array<[string, string, [number, number, number]]> = [
    ['CONTADOS', String(estatisticas.contados), COR.texto],
    ['A CONTAR', String(estatisticas.naoContados), COR.texto],
    ['CORRETOS', String(estatisticas.corretos), COR.ok],
    ['DIVERGENTES', String(estatisticas.incorretos), COR.alerta],
    ['DIVERGÊNCIA', `${estatisticas.percentualIncorretos}%`, COR.texto],
  ];

  const passo = util / metricas.length;
  metricas.forEach(([rotulo, valor, cor], i) => {
    const x = MARGEM + passo * i;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COR.fraco);
    doc.text(rotulo, x, inicio);

    doc.setFontSize(16);
    doc.setTextColor(...cor);
    doc.text(valor, x, inicio + 7);
  });

  doc.setDrawColor(...COR.regua);
  doc.setLineWidth(0.3);
  doc.line(MARGEM, inicio + 12, largura - MARGEM, inicio + 12);

  autoTable(doc, {
    ...ESTILO_TABELA,
    startY: inicio + 18,
    head: [['Produto', 'Sistema', 'Contado', 'Dif.', 'Status']],
    body: ordenarPorNome(linhas).map((l) => [
      l.nome,
      String(l.sistema),
      l.contado === null ? '—' : String(l.contado),
      String(l.diferenca),
      l.status,
    ]),
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 20, textColor: COR.suave },
      2: { halign: 'right', cellWidth: 20 },
      3: { halign: 'right', cellWidth: 18 },
      4: { cellWidth: 26, fontSize: 8 },
    },
    didParseCell: (dados) => {
      if (dados.section !== 'body') return;
      const status = String(dados.row.raw ? (dados.row.raw as string[])[4] : '');

      // Cor só na coluna de status e na diferença: são as duas que pedem ação.
      if (dados.column.index === 4 || dados.column.index === 3) {
        if (status === 'CRITICO') dados.cell.styles.textColor = COR.critico;
        else if (status === 'ERRADO') dados.cell.styles.textColor = COR.alerta;
        else if (status === 'NÃO CONTADO') dados.cell.styles.textColor = COR.fraco;
        else if (dados.column.index === 4) dados.cell.styles.textColor = COR.ok;
      }
      if (dados.column.index === 4 && status === 'CRITICO') {
        dados.cell.styles.fontStyle = 'bold';
      }
    },
  });

  desenharRodape(doc);
  await entregarArquivo(doc.output('blob'), nomeDeArquivo(`contagem-${contexto.estoque}`, 'pdf'));
}

/**
 * Relatório de validades.
 *
 * Só nome e data — a validade não carrega quantidade, por decisão do produto na 4.19.5.
 * Ordenado do vencimento mais próximo ao mais distante: é a ordem em que a loja precisa
 * agir. Comparação de string funciona porque a data é ISO — ordem lexicográfica é a mesma
 * que a cronológica.
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
  const vencidos = comValidade.filter((l) => l.validade < hoje).length;
  const proximos = comValidade.filter((l) => l.validade >= hoje && l.validade <= limiteAlerta).length;

  const { jsPDF, autoTable } = await carregarJsPdf();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }) as Documento;

  const inicio = desenharCabecalho(doc, 'Relatório de validade', contexto);
  const largura = doc.internal.pageSize.getWidth();

  // Só o que exige ação aparece no resumo. Total de itens é detalhe, não decisão.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COR.fraco);
  doc.text('VENCIDOS', MARGEM, inicio);
  doc.text(`VENCEM EM ${DIAS_ALERTA} DIAS`, MARGEM + 45, inicio);
  doc.text('COM VALIDADE', MARGEM + 100, inicio);

  doc.setFontSize(16);
  doc.setTextColor(...(vencidos > 0 ? COR.critico : COR.texto));
  doc.text(String(vencidos), MARGEM, inicio + 7);
  doc.setTextColor(...(proximos > 0 ? COR.alerta : COR.texto));
  doc.text(String(proximos), MARGEM + 45, inicio + 7);
  doc.setTextColor(...COR.texto);
  doc.text(String(comValidade.length), MARGEM + 100, inicio + 7);

  doc.setDrawColor(...COR.regua);
  doc.setLineWidth(0.3);
  doc.line(MARGEM, inicio + 12, largura - MARGEM, inicio + 12);

  autoTable(doc, {
    ...ESTILO_TABELA,
    startY: inicio + 18,
    head: [['Produto', 'Validade', 'Situação']],
    body: comValidade.map((l) => [
      l.nome,
      dataBR(l.validade),
      l.validade < hoje ? 'VENCIDO' : l.validade <= limiteAlerta ? `Vence em ${DIAS_ALERTA} dias` : '',
    ]),
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 28, halign: 'right' },
      2: { cellWidth: 40, fontSize: 8 },
    },
    didParseCell: (dados) => {
      if (dados.section !== 'body' || dados.column.index !== 2) return;
      const texto = String(dados.cell.raw ?? '');
      if (texto === 'VENCIDO') {
        dados.cell.styles.textColor = COR.critico;
        dados.cell.styles.fontStyle = 'bold';
      } else if (texto) {
        dados.cell.styles.textColor = COR.alerta;
      }
    },
  });

  desenharRodape(doc);
  await entregarArquivo(doc.output('blob'), nomeDeArquivo(`validade-${contexto.estoque}`, 'pdf'));
  return comValidade.length;
}
