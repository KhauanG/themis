/**
 * Tipos do domínio do Themis.
 *
 * IMPORTANTE: o Themis 2.0 lê e escreve no MESMO banco Firestore do app 1.x.
 * Por isso os tipos abaixo refletem os documentos como eles existem hoje,
 * inclusive os campos duplicados em duas grafias (`nome`/`NomeProduto`,
 * `estoqueSistema`/`EstoqueAtual`, ...) herdados da importação do ERP.
 *
 * Não "limpe" esses campos aqui. Normalize com os helpers de `produto.ts`.
 */

/**
 * Estado de contagem de um produto, gravado no documento.
 *
 * Não existe valor para "não contado": o campo é **removido** do documento ao limpar a
 * contagem. As Security Rules só aceitam estes dois valores (`data.productStatus in
 * ['ATUALIZADO', 'CONFERIDO']`), então gravar um terceiro faria a escrita ser negada.
 */
export type ProductStatus =
  | 'ATUALIZADO' // contado pelo funcionário
  | 'CONFERIDO'; // corrigido pelo admin/master após auditoria

/** Status calculado (nunca persistido no produto; vai no snapshot da auditoria). */
export type StatusAuditoria = 'CORRETO' | 'ERRADO' | 'CRITICO' | 'NÃO CONTADO';

/** Diferença |físico - sistema| a partir da qual o item é CRITICO. */
export const LIMITE_CRITICO = 10;

/** `estoques/{inventoryId}/produtos/{produtoId}` */
export interface Produto {
  id: string;

  // Nome: duas grafias no banco legado.
  nome?: string;
  NomeProduto?: string;

  // Identificador no ERP: duas grafias.
  IdProduto?: string | number | null;
  idProduto?: string | number | null;

  // Código de barras: duas grafias.
  codigoBarras?: string | null;
  CodigoBarras?: string | null;

  /** Quantidade contada no ciclo atual. Fonte primária do estoque físico. */
  quantidade?: number | null;
  /** Estoque físico legado — fallback quando `quantidade` é nulo. */
  estoqueFisico?: number | null;

  // Estoque do sistema (ERP): duas grafias.
  estoqueSistema?: number | null;
  EstoqueAtual?: number | null;

  productStatus?: ProductStatus | null;

  /** Marcado pelo admin quando a correção confirmou divergência. */
  corrigidoIncorreto?: boolean | null;

  /** Data de validade mais curta, formato `YYYY-MM-DD`. Sem quantidade associada. */
  dataValidade?: string | null;

  /** Marcado na importação: produto veio sem código de barras da planilha. */
  temCodigoBarras?: boolean;

  /** O ERP não reconheceu o produto no envio. */
  apiNotFound?: boolean;

  /** Controle de concorrência: quem gravou por último e quando. */
  lastModified?: Date | null;
  modifiedBy?: string;
}

/** Abas de filtro da tela de contagem. */
export type FiltroContagem =
  | 'all'
  | 'pendentes'
  | 'updated'
  | 'no-barcode'
  | 'conferido-correto'
  | 'conferido-incorreto'
  | 'api-not-found'
  | 'negative';

/** `inventories/{inventoryId}` — metadados do estoque. */
export interface Inventory {
  id: string;
  nome?: string;
  descricao?: string;
  /** Ciclo de contagem corrente. Incrementado ao finalizar. */
  contagemCycle?: number;
  lastFinalizedCycle?: number;
  lastFinalizedAt?: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

/** `users/{uid}` — perfil e papéis. Ausência de flag = usuário comum. */
export interface UserProfile {
  uid: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  isMaster?: boolean;
  isAdmin?: boolean;
  isAuditor?: boolean;
  allowedInventories?: string[];
  lastEstoque?: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export type Papel = 'master' | 'admin' | 'auditor' | 'comum';

/** Snapshot de um produto dentro de uma auditoria salva. */
export interface ProdutoSnapshot {
  id: string;
  nome: string;
  IdProduto: string | number | null;
  codigoBarras: string | null;
  NomeProduto: string;
  estoqueFisico: number;
  estoqueSistema: number;
  status: StatusAuditoria;
  /** Número, ou `'-'` quando o item não foi contado. */
  diferenca: number | '-';
  productStatus: ProductStatus | null;
  corrigidoIncorreto: boolean | null;
  dataValidade: string | null;
}

export interface EstatisticasCorrigidos {
  total: number;
  corretos: number;
  incorretos: number;
  percentualIncorretos: number;
}

export interface EstatisticasAuditoria {
  total: number;
  contados: number;
  naoContados: number;
  corretos: number;
  incorretos: number;
  percentualIncorretos: number;
  corrigidos: EstatisticasCorrigidos;
}

/** `auditorias/{auditoriaId}` */
export interface Auditoria {
  id?: string;
  nome: string;
  inventoryId: string;
  contagemCycle: number;
  data: Date;
  produtos: ProdutoSnapshot[];
  estatisticas: EstatisticasAuditoria;
  createdBy: string;
  createdAt: Date;
}

export type AcaoHistorico =
  | 'LOGIN'
  | 'MODIFICAR_PRODUTO'
  | 'LIMPAR_CONTAGEM'
  | 'LIMPAR_ESTOQUE'
  | 'BUSCAR_ESTOQUE'
  | 'IMPORTAR_PLANILHA'
  | 'EXPORTAR_PLANILHA'
  | 'ABRIR_AUDITORIA'
  | 'CORRIGIR_ESTOQUE'
  | 'EXCLUIR_ESTOQUE'
  | 'FINALIZAR_CONTAGEM';

/** `historico_geral/{id}` */
export interface EntradaHistorico {
  action: AcaoHistorico;
  userId: string;
  userEmail: string;
  userName: string;
  inventoryId: string;
  inventoryName: string;
  localTimestamp: string;
  timestamp?: Date | null;
  details: Record<string, unknown>;
  deviceId: string;
  deviceLabel: string;
}
