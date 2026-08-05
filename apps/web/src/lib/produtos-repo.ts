/**
 * Acesso à coleção de produtos: `estoques/{inventoryId}/produtos`.
 *
 * Regra de ouro: a contagem fala com o Firestore direto, nunca pela API. É a persistência
 * offline do SDK que faz o app funcionar em depósito com wifi ruim.
 */
import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { Produto } from '@themis/shared';
import { db } from './firebase.js';
import { deviceId } from './dispositivo.js';
import { runTransactionWithTimeout, withWriteTimeout } from './firestore-write.js';
import {
  ConflitoProdutoError,
  carregarFila,
  enfileirar,
  isConflito,
  removerDaFila,
  type AlteracaoPendente,
} from './fila-offline.js';

export function colecaoProdutos(inventoryId: string) {
  return collection(db, 'estoques', inventoryId, 'produtos');
}

function paraProduto(snap: QueryDocumentSnapshot<DocumentData>): Produto {
  const d = snap.data();
  const lastModified =
    d['lastModified'] instanceof Timestamp
      ? d['lastModified'].toDate()
      : d['lastModified'] instanceof Date
        ? d['lastModified']
        : null;
  return { ...d, id: snap.id, lastModified } as Produto;
}

/**
 * Escuta a coleção em tempo real.
 * `includeMetadataChanges: false` de propósito: sem isso cada escrita local dispara dois
 * snapshots (cache e servidor) e a lista pisca a cada produto contado.
 */
export function ouvirProdutos(
  inventoryId: string,
  aoMudar: (produtos: Produto[]) => void,
  aoFalhar?: (erro: Error) => void,
): () => void {
  return onSnapshot(
    colecaoProdutos(inventoryId),
    (snap) => aoMudar(snap.docs.map(paraProduto)),
    (erro) => {
      console.error('[produtos] Listener falhou:', erro);
      aoFalhar?.(erro);
    },
  );
}

export async function carregarProdutos(inventoryId: string): Promise<Produto[]> {
  const snap = await getDocs(colecaoProdutos(inventoryId));
  return snap.docs.map(paraProduto);
}

/**
 * Marcador de "remover este campo".
 *
 * O sentinela `deleteField()` do Firestore é um objeto e **não sobrevive ao JSON** do
 * localStorage — uma alteração enfileirada offline chegaria ao servidor como `{}` e o
 * campo ficaria lá. Por isso o chamador usa este marcador, que é string, e a conversão
 * para `deleteField()` acontece só na hora de gravar.
 */
export const REMOVER = '__themis_remover_campo__';

function paraFirestore(dados: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(dados)) {
    saida[chave] = valor === REMOVER ? deleteField() : valor;
  }
  return saida;
}

export interface BaseCliente {
  /** Quantidade que estava na tela quando o usuário começou a editar. */
  quantidade?: number | null;
  codigoBarras?: string | null;
}

export interface ResultadoGravacao {
  /** `false` quando a alteração foi para a fila offline em vez de chegar ao servidor. */
  sincronizado: boolean;
}

/**
 * Detecta se outro aparelho gravou por cima entre a leitura e a gravação.
 *
 * Só é conflito se o servidor divergir do valor base **e** do valor novo. Se o servidor
 * já está com o valor que estamos escrevendo, alguém aplicou a mesma alteração (ou a
 * nossa própria, reenviada pela fila) — reaplicar é inofensivo.
 */
function houveAlteracaoRemota(
  atual: unknown,
  base: unknown | undefined,
  novo: unknown,
): boolean {
  if (base === undefined) return false;
  return atual !== base && atual !== novo;
}

async function gravarComTransacao(
  inventoryId: string,
  produtoId: string,
  dados: Record<string, unknown>,
  base: BaseCliente,
  rotulo: string,
): Promise<void> {
  const ref = doc(colecaoProdutos(inventoryId), produtoId);

  await runTransactionWithTimeout(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Produto não encontrado');

    const atual = snap.data();

    const quantidadeMudou = houveAlteracaoRemota(
      atual['quantidade'],
      base.quantidade,
      dados['quantidade'],
    );
    const codigoMudou = houveAlteracaoRemota(
      atual['codigoBarras'],
      base.codigoBarras,
      dados['codigoBarras'],
    );

    if (quantidadeMudou || codigoMudou) {
      throw new ConflitoProdutoError(
        'Este produto foi alterado em outro dispositivo. Reabra o produto e salve novamente.',
      );
    }

    tx.update(ref, { ...paraFirestore(dados), lastModified: new Date(), modifiedBy: deviceId() });
  }, { label: rotulo });
}

/**
 * Grava a alteração de um produto.
 *
 * Sem rede, ou se a transação estourar o teto, a alteração vai para a fila offline e o
 * chamador recebe `sincronizado: false` — a interface segue normalmente. Conflito real
 * (outro aparelho contou o mesmo item) sobe como erro, porque exige decisão do usuário.
 */
export async function atualizarProduto(
  inventoryId: string,
  produtoId: string,
  dados: Record<string, unknown>,
  base: BaseCliente = {},
): Promise<ResultadoGravacao> {
  const paraFila = () => {
    enfileirar({
      tipo: 'update',
      produtoId,
      inventoryId,
      dados,
      baseQuantidade: base.quantidade ?? null,
      baseCodigoBarras: base.codigoBarras ?? null,
    });
    return { sincronizado: false };
  };

  if (!navigator.onLine) return paraFila();

  try {
    await gravarComTransacao(inventoryId, produtoId, dados, base, 'salvar produto');
    return { sincronizado: true };
  } catch (erro) {
    // Conflito é decisão do usuário, não falha de rede: não vai para a fila.
    if (isConflito(erro)) throw erro;
    console.warn('[produtos] Gravação não confirmada, enfileirando:', erro);
    return paraFila();
  }
}

export interface ResultadoDrenagem {
  enviados: number;
  descartados: number;
  restantes: number;
}

/**
 * Reenvia a fila offline. Para no primeiro erro de rede e deixa o resto para a próxima
 * tentativa — insistir com a rede caída só queima bateria.
 */
export async function drenarFila(): Promise<ResultadoDrenagem> {
  let enviados = 0;
  let descartados = 0;

  for (const item of carregarFila()) {
    try {
      await aplicarPendente(item);
      removerDaFila(item.id);
      enviados++;
    } catch (erro) {
      if (isConflito(erro)) {
        // Contagem mais recente de outro aparelho vence: descartar é o certo.
        console.warn('[produtos] Pendência descartada por conflito:', item.produtoId);
        removerDaFila(item.id);
        descartados++;
        continue;
      }
      break;
    }
  }

  return { enviados, descartados, restantes: carregarFila().length };
}

async function aplicarPendente(item: AlteracaoPendente): Promise<void> {
  if (item.tipo === 'delete') {
    await withWriteTimeout(deleteDoc(doc(colecaoProdutos(item.inventoryId), item.produtoId)), {
      label: 'remover produto',
    });
    return;
  }

  await gravarComTransacao(
    item.inventoryId,
    item.produtoId,
    item.dados,
    { quantidade: item.baseQuantidade, codigoBarras: item.baseCodigoBarras },
    'sincronizar pendência',
  );
}

/** Cria produto. `doc()` gera o ID localmente — disponível mesmo sem ack do servidor. */
export async function criarProduto(
  inventoryId: string,
  dados: Omit<Produto, 'id'>,
): Promise<string> {
  const ref = doc(colecaoProdutos(inventoryId));
  await withWriteTimeout(
    setDoc(ref, { ...dados, lastModified: new Date(), modifiedBy: deviceId() }),
    { label: 'cadastrar produto' },
  );
  return ref.id;
}

export async function excluirProduto(inventoryId: string, produtoId: string): Promise<void> {
  await withWriteTimeout(deleteDoc(doc(colecaoProdutos(inventoryId), produtoId)), {
    label: 'excluir produto',
  });
}

/** O Firestore limita um batch a 500 operações. */
const LIMITE_BATCH = 500;

/**
 * Zera a contagem do estoque.
 *
 * "Não contado" é a **ausência** de `productStatus`, não um valor. As Security Rules
 * exigem `quantidade is number` e só aceitam `productStatus in ['ATUALIZADO',
 * 'CONFERIDO']` — gravar `null` ou `'PENDENTE'` faria a regra negar o batch inteiro.
 * Por isso: quantidade vai a `0` e os demais campos são removidos com `deleteField()`.
 *
 * A validade é apagada junto de propósito (decisão do produto na 4.19.5): validade sem
 * contagem correspondente é dado órfão que o relatório mostraria como atual.
 */
export async function limparContagem(inventoryId: string, produtos: readonly Produto[]): Promise<void> {
  for (let i = 0; i < produtos.length; i += LIMITE_BATCH) {
    const lote = writeBatch(db);

    for (const p of produtos.slice(i, i + LIMITE_BATCH)) {
      const limpeza: Record<string, unknown> = {
        // Zera até quem já estava em 0: o que importa é remover o status junto.
        quantidade: 0,
        lastModified: new Date(),
        modifiedBy: deviceId(),
      };
      // Só remove o que existe: `deleteField()` num campo ausente entra no diff da
      // regra à toa e pode derrubar a validação.
      if (p.productStatus != null) limpeza['productStatus'] = deleteField();
      if (p.corrigidoIncorreto != null) limpeza['corrigidoIncorreto'] = deleteField();
      if (p.dataValidade != null) limpeza['dataValidade'] = deleteField();

      lote.update(doc(colecaoProdutos(inventoryId), p.id), limpeza);
    }

    await withWriteTimeout(lote.commit(), { label: 'limpar contagem' });
  }
}
