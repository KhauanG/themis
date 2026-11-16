/**
 * Roda a importação real contra um arquivo de planilha, sem tocar no Firestore.
 *
 * Existe porque a planilha do ERP vem num dialeto OOXML que quebrou o `exceljs` — e o
 * único jeito honesto de saber se a leitura funciona é ler o arquivo de verdade. Os testes
 * automatizados usam um arquivo sintético; este script usa o do cliente, que não vai para
 * o repositório.
 *
 * Uso:
 *   npx tsx scripts/verificar-planilha.mts planilhaprodutos.xlsx
 */
import { readFileSync } from 'node:fs';
import { planejarImportacao, resumoDoPlano } from '@themis/shared';
import { ErroDePlanilha, lerPlanilha, type LeituraPlanilha } from '../apps/web/src/lib/planilha.js';

const caminho = process.argv[2];
if (!caminho) {
  console.error('Informe o caminho da planilha.');
  process.exit(1);
}

const arquivo = new File([readFileSync(caminho)], caminho.split(/[/\\]/).pop() ?? 'planilha.xlsx');
let leitura: LeituraPlanilha;
try {
  leitura = await lerPlanilha(arquivo);
} catch (erro) {
  if (!(erro instanceof ErroDePlanilha)) throw erro;
  console.error(erro.message);
  process.exit(1);
}

if (leitura.colunasFaltando.length > 0) {
  console.error('Colunas faltando:', leitura.colunasFaltando);
  process.exit(1);
}

const { linhas } = leitura;
console.log(`Aba lida            : ${leitura.aba}`);
console.log(`Linhas lidas        : ${linhas.length}`);
console.log(`Com IdProduto       : ${linhas.filter((l) => l.IdProduto !== undefined).length}`);
console.log(`Com código de barras: ${linhas.filter((l) => l.codigoBarras !== undefined).length}`);
console.log(`Com PrecoVenda      : ${linhas.filter((l) => l.PrecoVenda !== undefined).length}`);

console.log('\nPrimeiras 3 linhas:');
for (const l of linhas.slice(0, 3)) console.log(' ', JSON.stringify(l));

const plano = planejarImportacao([], linhas);
console.log(`\nPlano (banco vazio): ${resumoDoPlano(plano)}`);
for (const r of plano.recusadas.slice(0, 5)) console.log(`linha ${r.linha}: ${r.motivo}`);
