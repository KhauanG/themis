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
import type { Produto } from '@themis/shared';
import { CHAVES, gravar, ler, remover } from './armazenamento.js';

/**
 * Marcador de "remover este campo".
 *
 * O sentinela `deleteField()` do Firestore é um objeto e **não sobrevive ao JSON** do
 * localStorage — uma alteração enfileirada offline chegaria ao servidor como `{}` e o
 * campo ficaria lá. Por isso o chamador usa este marcador, que é string, e a conversão
 * para `deleteField()` acontece só na hora de gravar (`produtos-repo.ts`).
 *
 * Mora aqui porque existe por causa da serialização da fila, não do Firestore.
 */
export const REMOVER = '__themis_remover_campo__';

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

/**
 * Sobrepõe as alterações da fila na lista vinda do Firestore.
 *
 * Sem isto a tela mente. Offline, `atualizarProduto` só enfileira — não escreve no
 * Firestore, então o cache local não muda, o `onSnapshot` não dispara e o produto continua
 * aparecendo como não contado. O usuário não tem como saber se a contagem entrou, e
 * reconta. O mesmo vale online com rede lenta, quando a transação estoura o teto.
 *
 * A fila é a verdade sobre "o que eu alterei e ainda não subiu". Quando ela drena, a
 * sobreposição some sozinha, porque o dado real chega pelo listener.
 *
 * Função pura, sem Firestore — é o que permite testá-la sem ambiente.
 */
export function aplicarPendentes(
  produtos: readonly Produto[],
  fila: readonly AlteracaoPendente[],
  inventoryId: string,
): Produto[] {
  const porProduto = new Map<string, AlteracaoPendente>();
  for (const item of fila) {
    if (item.tipo === 'update' && item.inventoryId === inventoryId) {
      porProduto.set(item.produtoId, item);
    }
  }

  if (porProduto.size === 0) return produtos as Produto[];

  return produtos.map((p) => {
    const pendente = porProduto.get(p.id);
    if (!pendente) return p;

    const mesclado: Produto = { ...p };
    const campos = mesclado as unknown as Record<string, unknown>;

    for (const [campo, valor] of Object.entries(pendente.dados)) {
      if (valor === REMOVER) delete campos[campo];
      else campos[campo] = valor;
    }

    // Momento em que o usuário alterou. Mantém a ordenação da aba "Contados" coerente
    // sem inventar dado: é a hora real da edição, guardada na fila.
    mesclado.lastModified = new Date(pendente.enfileiradoEm);

    return mesclado;
  });
}
