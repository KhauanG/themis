/**
 * Detecção das colunas da planilha do ERP.
 *
 * Porte do `findColumn` + `columnMapping` do Themis 1.x. As listas de sinônimos são as
 * dele, ampliadas — planilha que o 1.x lia, o 2.0 tem que ler.
 *
 * A planilha real do ERP tem estes cabeçalhos, nesta ordem:
 *
 * ```
 * IdProduto  NomeProduto  CodigoInterno  CodigoBarras  NCM  PrecoCusto  PrecoPJ
 * PrecoVenda  EstoqueMinimo  EstoqueAtual  Categoria  Unidade  UsaNoMenuDigital
 * UsaBalancaEtiquetadoraStr  Excluir
 * ```
 */

/** Campos que sabemos aproveitar. A ordem é a de prioridade na busca por aproximação. */
export type CampoPlanilha =
  | 'IdProduto'
  | 'NomeProduto'
  | 'CodigoInterno'
  | 'CodigoBarras'
  | 'NCM'
  | 'PrecoCusto'
  | 'PrecoPJ'
  | 'PrecoVenda'
  | 'EstoqueMinimo'
  | 'EstoqueAtual'
  | 'Categoria'
  | 'Unidade';

/** Sinônimos aceitos, já normalizados (minúsculo, sem acento). */
const SINONIMOS: Record<CampoPlanilha, readonly string[]> = {
  IdProduto: ['idproduto', 'idprodut', 'id_produto', 'codigoproduto', 'codigo produto', 'id'],
  NomeProduto: ['nomeproduto', 'nome', 'produto', 'descricao', 'product'],
  CodigoInterno: ['codigointerno', 'codigo_interno', 'codigo interno'],
  CodigoBarras: [
    'codigobarras',
    'codigo de barras',
    'codigo_barras',
    'codigo barras',
    'barcode',
    'ean',
    'gtin',
    'codigo',
  ],
  NCM: ['ncm'],
  PrecoCusto: ['precocusto', 'precocust', 'preco_custo', 'preco custo', 'custo'],
  PrecoPJ: ['precopj', 'preco_pj', 'preco pj'],
  PrecoVenda: ['precovenda', 'precovend', 'preco_venda', 'preco venda', 'venda'],
  EstoqueMinimo: ['estoqueminimo', 'estoque_minimo', 'estoque minimo', 'minimo'],
  EstoqueAtual: [
    'estoqueatual',
    'estoqueatua',
    'estoque_atual',
    'estoque atual',
    'estoquesistema',
    'estoque sistema',
    'quantidade sistema',
    'quantidade',
    'estoque',
    'saldo',
    'qtd',
    'qtde',
    'stock',
  ],
  Categoria: ['categoria', 'grupo'],
  Unidade: ['unidade', 'un'],
};

const ORDEM = Object.keys(SINONIMOS) as CampoPlanilha[];

/** Minúsculo, sem acento, sem espaço nas pontas. */
export function normalizarCabecalho(bruto: unknown): string {
  return String(bruto ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/** Índice (base 0) de cada campo encontrado nos cabeçalhos. */
export type MapaColunas = Partial<Record<CampoPlanilha, number>>;

const palavras = (texto: string) => texto.split(/[^a-z0-9]+/).filter(Boolean);

/** As palavras de `sinonimo` aparecem em `cabecalho`, juntas e na ordem. */
function contemPalavras(cabecalho: string[], sinonimo: string[]): boolean {
  return cabecalho.some((_, i) => sinonimo.every((p, j) => cabecalho[i + j] === p));
}

/**
 * Casa cabeçalhos com campos.
 *
 * Duas passadas, e a ordem importa:
 *
 * 1. **Igualdade exata** do cabeçalho normalizado com algum sinônimo. Determinística, e
 *    resolve a planilha real do ERP inteira.
 * 2. **Aproximação**, só para o que sobrou: sinônimo de mais de 3 letras, como palavras
 *    inteiras, dentro do cabeçalho. É o que salva cabeçalho tipo `"Código de Barras (EAN)"`.
 *    Pedaço de palavra não casa (`"Validade"` não tem `id`) e o sentido inverso saiu
 *    (`"Estoque"` não vira `EstoqueMinimo`).
 *
 * Sem a primeira passada, a aproximação do 1.x rouba coluna: o sinônimo `'codigo'` casa com
 * `"CodigoInterno"` e o código de barras acaba lido da coluna errada. Uma coluna já usada
 * nunca é reaproveitada por outro campo.
 */
export function mapearColunas(cabecalhos: readonly unknown[]): MapaColunas {
  // `Array.from` visita buraco (coluna em branco do exceljs); `map` pularia.
  const limpos = Array.from(cabecalhos, normalizarCabecalho);
  const mapa: MapaColunas = {};
  const usados = new Set<number>();

  const reservar = (campo: CampoPlanilha, indice: number) => {
    mapa[campo] = indice;
    usados.add(indice);
  };

  for (const campo of ORDEM) {
    const alvo = SINONIMOS[campo];
    const i = limpos.findIndex((c, idx) => !usados.has(idx) && c !== '' && alvo.includes(c));
    if (i >= 0) reservar(campo, i);
  }

  for (const campo of ORDEM) {
    if (mapa[campo] !== undefined) continue;
    const alvo = SINONIMOS[campo];
    const i = limpos.findIndex(
      (c, idx) =>
        !usados.has(idx) &&
        c !== '' &&
        alvo.some((s) => s.length > 3 && contemPalavras(palavras(c), palavras(s))),
    );
    if (i >= 0) reservar(campo, i);
  }

  return mapa;
}

/**
 * Número a partir de célula da planilha.
 *
 * Aceita vírgula decimal — a planilha do ERP às vezes vem com o número já formatado como
 * texto. Mesma conversão do `extractNumber` do 1.x.
 */
export function numeroDeCelula(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const texto = String(valor ?? '').trim();
  if (texto === '') return 0;
  const n = Number.parseFloat(texto.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Texto a partir de célula. Célula com fórmula chega como objeto com `result`. */
export function textoDeCelula(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'object') {
    const cel = valor as { result?: unknown; text?: unknown; richText?: { text?: string }[] };
    if (cel.result !== undefined) return textoDeCelula(cel.result);
    if (typeof cel.text === 'string') return cel.text.trim();
    if (Array.isArray(cel.richText)) return cel.richText.map((p) => p.text ?? '').join('').trim();
    return '';
  }
  return String(valor).trim();
}

/** Nome de tela de cada campo, para a prévia. */
export const ROTULO_CAMPO_PLANILHA: Record<CampoPlanilha, string> = {
  IdProduto: 'Código do produto',
  NomeProduto: 'Nome',
  CodigoInterno: 'Código interno',
  CodigoBarras: 'Código de barras',
  NCM: 'NCM',
  PrecoCusto: 'Preço de custo',
  PrecoPJ: 'Preço PJ',
  PrecoVenda: 'Preço de venda',
  EstoqueMinimo: 'Estoque mínimo',
  EstoqueAtual: 'Estoque do sistema',
  Categoria: 'Categoria',
  Unidade: 'Unidade',
};

export interface ColunasDescritas {
  /** Na ordem das colunas da planilha. */
  usadas: Array<{ coluna: string; campo: CampoPlanilha; rotulo: string }>;
  /** Cabeçalhos com texto que não viraram campo. Cabeçalho em branco não entra. */
  semUso: string[];
}

/** Diz, para a prévia, o que cada coluna virou e o que ficou de fora. */
export function descreverColunas(
  cabecalhos: readonly unknown[],
  mapa: MapaColunas,
): ColunasDescritas {
  const campoDaColuna = new Map<number, CampoPlanilha>();
  for (const campo of ORDEM) {
    const i = mapa[campo];
    if (i !== undefined) campoDaColuna.set(i, campo);
  }
  const resultado: ColunasDescritas = { usadas: [], semUso: [] };
  Array.from(cabecalhos).forEach((cabecalho, i) => {
    const coluna = String(cabecalho ?? '').trim();
    if (coluna === '') return;
    const campo = campoDaColuna.get(i);
    if (campo) resultado.usadas.push({ coluna, campo, rotulo: ROTULO_CAMPO_PLANILHA[campo] });
    else resultado.semUso.push(coluna);
  });
  return resultado;
}
