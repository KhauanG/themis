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
import { lerPlanilha } from '../apps/web/src/lib/planilha.js';

const caminho = process.argv[2];
if (!caminho) {
  console.error('Informe o caminho da planilha.');
  process.exit(1);
}

const arquivo = new File([readFileSync(caminho)], caminho.split(/[/\\]/).pop() ?? 'planilha.xlsx');
const { linhas, ignoradas, colunasFaltando, temColunaEstoque } = await lerPlanilha(arquivo);

if (colunasFaltando.length > 0) {
  console.error('Colunas faltando:', colunasFaltando);
  process.exit(1);
}

console.log(`Linhas aproveitadas : ${linhas.length}`);
console.log(`Linhas ignoradas    : ${ignoradas}`);
console.log(`Coluna de saldo     : ${temColunaEstoque ? 'sim' : 'não'}`);

const comId = linhas.filter((l) => l.IdProduto !== null).length;
const comCodigo = linhas.filter((l) => l.temCodigoBarras).length;
const comPreco = linhas.filter((l) => l.PrecoVenda > 0).length;
console.log(`Com IdProduto       : ${comId}`);
console.log(`Com código de barras: ${comCodigo}`);
console.log(`Com PrecoVenda      : ${comPreco}`);

console.log('\nPrimeiras 3 linhas:');
for (const l of linhas.slice(0, 3)) console.log(' ', JSON.stringify(l));

// IdProduto repetido faria a segunda linha sobrescrever a primeira na importação.
const vistos = new Set<string>();
const repetidos = linhas.filter((l) => l.IdProduto && !vistos.add(l.IdProduto) === false);
const duplicados = linhas.length - new Set(linhas.map((l) => l.IdProduto ?? l.nome)).size;
console.log(`\nChaves duplicadas   : ${duplicados}`);
void repetidos;
