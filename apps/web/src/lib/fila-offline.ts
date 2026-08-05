/**
 * Fila de alterações que ainda não chegaram ao servidor.
 *
 * Existe apesar da persistência do Firestore porque as escritas de produto são feitas em
 * **transação**, e transação não funciona a partir do cache: ou fala com o servidor, ou
 * não acontece. Quando a transação estoura o teto de tempo, a alteração cai aqui e é
 * reaplicada ao reconectar.
 *
 * Porte de `app.js::enqueuePendingUpdate` / `processPendingUpdates` (4.19.8).
 */
import { CHAVES, gravar, ler, remover } from './armazenamento.js';

export interface AlteracaoPendente {
  id: string;
  tipo: 'update' | 'delete';
  produtoId: string;
  inventoryId: string;
  /** Campos a gravar. Só primitivos — precisa sobreviver ao JSON do localStorage. */
  dados: Record<string, unknown>;
  /**
   * Valores que o cliente viu ao editar. Se o servidor divergir dos dois (do valor base
   * E do valor novo), outro aparelho contou no meio do caminho e a alteração é descartada
   * em vez de sobrescrever contagem mais recente.
   */
  baseQuantidade?: number | null;
  baseCodigoBarras?: string | null;
  enfileiradoEm: number;
}

export class ConflitoProdutoError extends Error {
  readonly code = 'conflict/stale-product';
  constructor(mensagem = 'O produto foi alterado em outro dispositivo.') {
    super(mensagem);
    this.name = 'ConflitoProdutoError';
  }
}

export function isConflito(erro: unknown): boolean {
  return (erro as { code?: string } | null)?.code === 'conflict/stale-product';
}

function novoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function valida(item: unknown): item is AlteracaoPendente {
  const i = item as Partial<AlteracaoPendente> | null;
  return Boolean(i && i.produtoId && i.inventoryId && (i.tipo === 'update' || i.tipo === 'delete'));
}

export function carregarFila(): AlteracaoPendente[] {
  const bruto = ler<unknown[]>(CHAVES.filaPendentes, []);
  if (!Array.isArray(bruto)) return [];
  return bruto.filter(valida);
}

function persistir(fila: AlteracaoPendente[]): void {
  if (fila.length === 0) remover(CHAVES.filaPendentes);
  else gravar(CHAVES.filaPendentes, fila);
}

export function enfileirar(
  item: Omit<AlteracaoPendente, 'id' | 'enfileiradoEm'>,
): AlteracaoPendente[] {
  const fila = carregarFila();

  // Uma alteração mais nova do mesmo produto substitui a anterior: reenviar contagens
  // intermediárias não muda o resultado e só aumenta o tempo de drenagem.
  const semDuplicata = fila.filter(
    (f) => !(f.produtoId === item.produtoId && f.inventoryId === item.inventoryId && f.tipo === item.tipo),
  );

  // A base de comparação tem que ser a da PRIMEIRA edição offline, não a da última:
  // o que interessa é o valor que o servidor tinha quando o aparelho perdeu contato.
  const anterior = fila.find(
    (f) => f.produtoId === item.produtoId && f.inventoryId === item.inventoryId && f.tipo === item.tipo,
  );

  semDuplicata.push({
    ...item,
    baseQuantidade: anterior ? anterior.baseQuantidade : item.baseQuantidade,
    baseCodigoBarras: anterior ? anterior.baseCodigoBarras : item.baseCodigoBarras,
    id: novoId(),
    enfileiradoEm: Date.now(),
  });

  persistir(semDuplicata);
  return semDuplicata;
}

export function removerDaFila(id: string): AlteracaoPendente[] {
  const fila = carregarFila().filter((f) => f.id !== id);
  persistir(fila);
  return fila;
}

export function limparFila(): void {
  remover(CHAVES.filaPendentes);
}

export function tamanhoFila(): number {
  return carregarFila().length;
}
