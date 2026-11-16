// Plano da importação de planilha (Etapa 4): função pura, sem banco, sem data, sem id de aparelho.
// As regras e os casos são os mesmos do app (packages/shared/casos/importacao).
import { temCodigoBarrasDe } from './cadastro-produto.js';
import { LIMITE_NOME_PRODUTO, problemasDeProduto } from './validacao.js';

/** Uma linha da planilha. Campo ausente (coluna não existe ou célula vazia) não tem chave. */
export interface LinhaPlanilha {
  /** Número da linha na planilha. A 1 é o cabeçalho. */
  linha: number;
  nome?: string;
  IdProduto?: string;
  codigoBarras?: string;
  CodigoInterno?: string;
  NCM?: string;
  Categoria?: string;
  Unidade?: string;
  /** `null` = a célula tem valor, mas não é número. */
  PrecoCusto?: number | null;
  PrecoPJ?: number | null;
  PrecoVenda?: number | null;
  EstoqueMinimo?: number | null;
  /** Coluna `EstoqueAtual`. */
  estoqueSistema?: number | null;
}

/** Documento de produto como está no servidor, mais o id. */
export interface ProdutoDoBanco {
  id: string;
  [campo: string]: unknown;
}

export type CamposDeProduto = Record<string, string | number | boolean>;
export interface ItemCriar {
  linha: number;
  /** `id:{código sem zeros à esquerda}` ou `nome:{nome em minúsculas}` */
  chave: string;
  campos: CamposDeProduto;
}
export interface ItemAtualizar {
  linha: number;
  id: string;
  campos: CamposDeProduto;
}
export interface Recusada {
  linha: number;
  motivo: string;
}

export interface PlanoImportacao {
  criar: ItemCriar[];
  atualizar: ItemAtualizar[];
  semMudanca: number;
  recusadas: Recusada[];
  /** Linhas sem nome. */
  ignoradas: number;
  possiveisDuplicados: number;
}

const TEXTOS = ['CodigoInterno', 'NCM', 'Categoria', 'Unidade'] as const;
/** Nesta ordem: é a ordem em que o motivo de recusa é escolhido. */
const PRECOS_E_MINIMO = ['PrecoCusto', 'PrecoPJ', 'PrecoVenda', 'EstoqueMinimo'] as const;
/** Carimbos que a gravação refaz, e o id, que não é campo do documento. */
const FORA_DA_CONFERENCIA = ['id', 'lastModified', 'lastImportDate', 'modifiedBy'];

const semZeros = (v: unknown): string => String(v).trim().replace(/^0+(?=\d)/, '');
const emMinusculas = (v: unknown): string => String(v).trim().toLowerCase();

export function chaveDaLinha(linha: LinhaPlanilha): string {
  return linha.IdProduto !== undefined ? `id:${semZeros(linha.IdProduto)}` : `nome:${emMinusculas(linha.nome ?? '')}`;
}

/** Um motivo só, na ordem: nome, código, número, negativo. A repetida é conferida por quem chama. */
function motivoDeRecusa(l: LinhaPlanilha): string | undefined {
  if ((l.nome ?? '').length > LIMITE_NOME_PRODUTO) return `nome com mais de ${LIMITE_NOME_PRODUTO} letras`;
  // Texto, não Number(): 20 dígitos não cabem num double.
  if (l.IdProduto !== undefined && !(/^\d+$/.test(l.IdProduto) && /[1-9]/.test(l.IdProduto))) return 'código do produto inválido';
  for (const c of [...PRECOS_E_MINIMO, 'estoqueSistema'] as const) {
    if (l[c] === null) return `número inválido em ${c === 'estoqueSistema' ? 'EstoqueAtual' : c}`;
  }
  for (const c of PRECOS_E_MINIMO) {
    const v = l[c];
    if (typeof v === 'number' && v < 0) return `preço ou mínimo negativo em ${c}`;
  }
  return undefined;
}

/** Só o que a linha traz e que difere do produto. Vazio na planilha não mexe. */
function camposAlterados(e: ProdutoDoBanco, l: LinhaPlanilha): CamposDeProduto {
  const c: CamposDeProduto = {};
  if (l.nome !== undefined && l.nome !== e['nome']) {
    c['nome'] = l.nome;
    c['NomeProduto'] = l.nome;
  }
  if (l.codigoBarras !== undefined && l.codigoBarras !== e['codigoBarras']) {
    c['codigoBarras'] = l.codigoBarras;
    c['CodigoBarras'] = l.codigoBarras;
    c['temCodigoBarras'] = temCodigoBarrasDe(l.codigoBarras);
  }
  if (l.IdProduto !== undefined && (e['IdProduto'] === undefined || semZeros(e['IdProduto']) !== semZeros(l.IdProduto))) {
    c['IdProduto'] = l.IdProduto;
  }
  for (const k of [...TEXTOS, ...PRECOS_E_MINIMO]) {
    const v = l[k];
    if (v !== undefined && v !== null && v !== e[k]) c[k] = v;
  }
  if (l.estoqueSistema !== undefined && l.estoqueSistema !== null && l.estoqueSistema !== e['estoqueSistema']) {
    c['estoqueSistema'] = l.estoqueSistema;
    c['EstoqueAtual'] = l.estoqueSistema;
  }
  return c;
}

function camposDoNovo(nome: string, l: LinhaPlanilha): CamposDeProduto {
  const barras = l.codigoBarras ?? '';
  const saldo = l.estoqueSistema ?? 0;
  const c: CamposDeProduto = {
    nome,
    NomeProduto: nome,
    codigoBarras: barras,
    CodigoBarras: barras,
    temCodigoBarras: temCodigoBarrasDe(barras),
    quantidade: 0,
    estoqueSistema: saldo,
    EstoqueAtual: saldo,
  };
  for (const k of ['IdProduto', ...TEXTOS, ...PRECOS_E_MINIMO] as const) {
    const v = l[k];
    if (v !== undefined && v !== null) c[k] = v;
  }
  return c;
}

export function planejarImportacao(
  existentes: readonly ProdutoDoBanco[],
  linhas: readonly LinhaPlanilha[],
): PlanoImportacao {
  const doBanco = new Map<string, ProdutoDoBanco>();
  const nomesComCodigo = new Set<string>();
  const nomesSemCodigo = new Set<string>();
  for (const p of existentes) {
    const codigo = String(p['IdProduto'] ?? p['idProduto'] ?? p['idProdut'] ?? '').trim();
    const nome = emMinusculas(p['nome'] || p['NomeProduto'] || '');
    (codigo ? nomesComCodigo : nomesSemCodigo).add(nome);
    const chave = codigo ? `id:${semZeros(codigo)}` : `nome:${nome}`;
    if (!doBanco.has(chave)) doBanco.set(chave, p); // duplicata no banco: o primeiro vence
  }

  const plano: PlanoImportacao = { criar: [], atualizar: [], semMudanca: 0, recusadas: [], ignoradas: 0, possiveisDuplicados: 0 };
  const vistas = new Map<string, number>();
  for (const l of linhas) {
    if (!l.nome?.trim()) {
      plano.ignoradas++;
      continue;
    }
    const recusar = (motivo: string) => plano.recusadas.push({ linha: l.linha, motivo });
    const motivo = motivoDeRecusa(l);
    if (motivo) {
      recusar(motivo);
      continue;
    }
    const chave = chaveDaLinha(l);
    const primeira = vistas.get(chave);
    if (primeira !== undefined) {
      recusar(`repetida: vale a linha ${primeira}`);
      continue;
    }
    vistas.set(chave, l.linha);

    const existente = doBanco.get(chave);
    if (!existente) {
      plano.criar.push({ linha: l.linha, chave, campos: camposDoNovo(l.nome, l) });
      // Um lado com código e o outro sem: pode ser o mesmo produto. Só conta, não junta.
      const lado = l.IdProduto !== undefined ? nomesSemCodigo : nomesComCodigo;
      if (lado.has(emMinusculas(l.nome))) plano.possiveisDuplicados++;
      continue;
    }

    const campos = camposAlterados(existente, l);
    if (Object.keys(campos).length === 0) {
      plano.semMudanca++;
      continue;
    }
    // Legado sem `quantidade`: a regra exige o campo no documento resultante.
    if (typeof existente['quantidade'] !== 'number') {
      const fisico = existente['estoqueFisico'];
      campos['quantidade'] = typeof fisico === 'number' ? fisico : 0;
    }
    // Um campo inválido no banco faz a regra negar o lote inteiro: só esta linha cai.
    const resultante: Record<string, unknown> = { ...existente, ...campos };
    for (const k of FORA_DA_CONFERENCIA) delete resultante[k];
    const problema = problemasDeProduto(resultante)[0];
    if (problema) recusar(`produto do banco com campo inválido: ${problema.campo}`);
    else plano.atualizar.push({ linha: l.linha, id: existente.id, campos });
  }
  return plano;
}
