/**
 * Espelho de `validProductData` das Firestore Security Rules.
 *
 * A regra valida o documento **resultante** de qualquer update. Um produto legado com
 * `corrigidoIncorreto: null` ou `lastModified` gravado como texto faz o funcionário
 * receber permission-denied ao contar — mesmo sem encostar nesse campo. Em campo isso
 * aparece como "não salva" e é difícil de diagnosticar, porque só acontece com alguns
 * produtos.
 *
 * Serve para dois usos:
 *  - `scripts/auditar-produtos.mjs`, que varre o banco e lista o que precisa de conserto;
 *  - o app, para avisar com uma frase útil em vez de deixar a regra recusar.
 *
 * Se as regras mudarem, este arquivo muda junto. Os testes cobrem cada campo.
 */

export const LIMITE_NOME_PRODUTO = 300;
export const STATUS_PERMITIDOS = ['ATUALIZADO', 'CONFERIDO'] as const;

export interface ProblemaProduto {
  campo: string;
  encontrado: string;
  esperado: string;
}

type Verificador = (valor: unknown) => boolean;

/** Predicado, para o TypeScript estreitar o tipo depois da checagem de `nome`. */
const ehString = (v: unknown): v is string => typeof v === 'string';

/**
 * `NaN` e `Infinity` são doubles válidos no Firestore e passam no `is number` da regra.
 * Este módulo responde "as regras recusariam?", então eles passam aqui também — marcar
 * como violação mandaria consertar documento que a regra aceita. Dado ruim de outro tipo
 * é problema de outro relatório.
 */
const ehNumero: Verificador = (v) => typeof v === 'number';
const ehTexto: Verificador = ehString;
const ehBooleano: Verificador = (v) => typeof v === 'boolean';
const ehTextoOuNumero: Verificador = (v) => ehTexto(v) || ehNumero(v);

/**
 * Timestamp do Firestore por "formato", não por `instanceof`.
 * Este pacote não depende do SDK do Firebase — e `Date` também é aceito, porque é o que
 * o SDK entrega depois de converter.
 */
const ehData: Verificador = (v) => {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v !== 'object' || v === null) return false;
  const t = v as { seconds?: unknown; nanoseconds?: unknown; toDate?: unknown };
  return typeof t.toDate === 'function' && typeof t.seconds === 'number';
};

/** Campos opcionais: só validados quando a chave existe. */
const CAMPOS_OPCIONAIS: ReadonlyArray<readonly [string, Verificador, string]> = [
  ['estoqueSistema', ehNumero, 'número'],
  ['EstoqueAtual', ehNumero, 'número'],
  ['EstoqueMinimo', ehNumero, 'número'],
  ['estoqueMinimo', ehNumero, 'número'],
  ['PrecoVenda', ehNumero, 'número'],
  ['precoVenda', ehNumero, 'número'],
  ['apiNotFound', ehBooleano, 'booleano'],
  ['temCodigoBarras', ehBooleano, 'booleano'],
  ['inventoryId', ehTexto, 'texto'],
  ['IdProduto', ehTextoOuNumero, 'texto ou número'],
  ['idProduto', ehTextoOuNumero, 'texto ou número'],
  // Não é erro de digitação: existe no banco e na regra, herdado de uma importação antiga.
  ['idProdut', ehTextoOuNumero, 'texto ou número'],
  ['lastModified', ehData, 'timestamp'],
  ['createdAt', ehData, 'timestamp'],
  ['lastImportDate', ehData, 'timestamp'],
  ['lastSyncFromERP', ehData, 'timestamp'],
  ['modifiedBy', ehTexto, 'texto'],
  ['createdBy', ehTexto, 'texto'],
  ['corrigidoIncorreto', ehBooleano, 'booleano'],
  ['corrigidoCritico', ehBooleano, 'booleano'],
  ['dataValidade', ehTexto, 'texto'],
];

export const CAMPOS_OBRIGATORIOS = ['nome', 'quantidade', 'codigoBarras'] as const;

/** Nome do tipo encontrado, para a mensagem do relatório. */
export function descreverTipo(valor: unknown): string {
  if (valor === null) return 'null';
  if (valor === undefined) return 'ausente';
  if (ehData(valor)) return 'timestamp';
  if (Array.isArray(valor)) return 'lista';
  return typeof valor;
}

/**
 * Lista o que impediria a gravação. Array vazio = o documento passa nas regras.
 * Recebe o documento cru porque a checagem é sobre o dado como está no banco.
 */
export function problemasDeProduto(dados: Record<string, unknown>): ProblemaProduto[] {
  const problemas: ProblemaProduto[] = [];
  const tem = (campo: string) => Object.prototype.hasOwnProperty.call(dados, campo);

  for (const campo of CAMPOS_OBRIGATORIOS) {
    if (!tem(campo)) {
      problemas.push({ campo, encontrado: 'ausente', esperado: 'campo obrigatório' });
    }
  }

  if (tem('nome')) {
    const nome: unknown = dados['nome'];
    if (!ehString(nome)) {
      problemas.push({ campo: 'nome', encontrado: descreverTipo(nome), esperado: 'texto' });
    } else if (nome.length === 0) {
      problemas.push({ campo: 'nome', encontrado: 'vazio', esperado: 'texto não vazio' });
    } else if (nome.length > LIMITE_NOME_PRODUTO) {
      problemas.push({
        campo: 'nome',
        encontrado: `${nome.length} caracteres`,
        esperado: `até ${LIMITE_NOME_PRODUTO}`,
      });
    }
  }

  if (tem('quantidade') && !ehNumero(dados['quantidade'])) {
    problemas.push({
      campo: 'quantidade',
      encontrado: descreverTipo(dados['quantidade']),
      esperado: 'número',
    });
  }

  if (tem('codigoBarras') && !ehTexto(dados['codigoBarras'])) {
    problemas.push({
      campo: 'codigoBarras',
      encontrado: descreverTipo(dados['codigoBarras']),
      esperado: 'texto',
    });
  }

  if (tem('productStatus')) {
    const status = dados['productStatus'];
    if (!STATUS_PERMITIDOS.includes(status as (typeof STATUS_PERMITIDOS)[number])) {
      problemas.push({
        campo: 'productStatus',
        encontrado: JSON.stringify(status) ?? 'ausente',
        esperado: STATUS_PERMITIDOS.join(' ou '),
      });
    }
  }

  for (const [campo, valida, esperado] of CAMPOS_OPCIONAIS) {
    if (tem(campo) && !valida(dados[campo])) {
      problemas.push({ campo, encontrado: descreverTipo(dados[campo]), esperado });
    }
  }

  return problemas;
}

/** Sugestão de conserto, para quem for aplicar a correção depois. */
export function sugestaoDeConserto(problema: ProblemaProduto): string {
  if (problema.encontrado === 'null') {
    return `remover o campo (deleteField) ou gravar um ${problema.esperado}`;
  }
  if (problema.encontrado === 'ausente') {
    return problema.campo === 'quantidade' ? 'gravar 0' : 'gravar texto vazio';
  }
  return `converter para ${problema.esperado}`;
}
