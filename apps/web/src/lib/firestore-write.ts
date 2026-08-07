/**
 * Escrita segura no Firestore. Porte do módulo `firestore-write.js` do Themis 1.x
 * (versão 4.19.8), que corrigiu a classe de bug mais séria do app.
 *
 * Contexto — leia antes de mexer:
 * com persistência offline ligada, a promise de uma escrita (`setDoc`/`updateDoc`/
 * `addDoc`/`batch.commit`) NÃO significa "salvou". O dado já está no cache local antes
 * disso. A promise só resolve quando o SERVIDOR confirma, e sem servidor alcançável ela
 * **nunca resolve — e nunca rejeita**. Um `await` nela no meio do fluxo da interface
 * trava a tela: sem toast, sem re-render, usuário achando que o app perdeu a contagem.
 *
 * Rede lenta é pior que rede ausente: offline o app detecta e enfileira; lenta ele se
 * acha online e espera para sempre.
 *
 * Regras:
 * - Escrita comum: teto de tempo e SEGUE (resolve). O dado está local e sincroniza depois.
 * - Transação: exige servidor e não grava no cache. No teto, REJEITA com
 *   `deadline-exceeded` para o chamador cair na fila offline em vez de travar.
 */
import { runTransaction, type Firestore, type Transaction } from 'firebase/firestore';
import { db } from './firebase.js';

export const DEFAULT_WRITE_TIMEOUT_MS = 8_000;
export const DEFAULT_TRANSACTION_TIMEOUT_MS = 12_000;

/** Códigos que indicam problema de rede — e não recusa de regra/validação. */
const CODIGOS_DE_REDE = new Set(['unavailable', 'resource-exhausted', 'deadline-exceeded']);

// Última vez que o servidor confirmou/recusou uma operação real do Firestore.
// Sinal de conectividade mais confiável que probe externo: `generate_204` é bloqueado
// em muita rede de loja e produzia tanto falso-offline quanto falso-online.
let _lastServerOkAt = 0;
let _lastServerFailAt = 0;

export function markServerOk(): void {
  _lastServerOkAt = Date.now();
}

export function markServerFail(): void {
  _lastServerFailAt = Date.now();
}

export function lastServerOkAt(): number {
  return _lastServerOkAt;
}

export function lastServerFailAt(): number {
  return _lastServerFailAt;
}

function registrarResultado(erro: unknown): void {
  const code = (erro as { code?: string } | null)?.code;
  // Recusa de regra também é resposta do servidor: prova que há conexão.
  if (code && CODIGOS_DE_REDE.has(code)) markServerFail();
  else markServerOk();
}

export interface WriteTimeoutOptions {
  ms?: number;
  label?: string;
}

export interface WriteResult<T> {
  timedOut: boolean;
  value: T | undefined;
}

/** Erro de teto de tempo. `isWriteTimeout` marca para o retry NÃO re-tentar. */
export class WriteTimeoutError extends Error {
  readonly code = 'deadline-exceeded';
  readonly isWriteTimeout = true;

  constructor(label: string) {
    super(`Tempo esgotado ao contatar o servidor (${label}).`);
    this.name = 'WriteTimeoutError';
  }
}

export function isWriteTimeout(erro: unknown): boolean {
  return (erro as { isWriteTimeout?: boolean } | null)?.isWriteTimeout === true;
}

/**
 * Escrita que **precisa da confirmação do servidor**. Lança `WriteTimeoutError` no estouro.
 *
 * ## Por que existe
 *
 * `withWriteTimeout` resolve com `{ timedOut: true }` em vez de lançar — o dado fica no
 * cache local e sobe ao reconectar, e para um registro de histórico isso basta. Só que
 * **nenhum chamador conferia esse campo**. Uma gravação em lote que estourava o teto
 * reportava sucesso.
 *
 * O efeito apareceu na contagem da empresa: o admin corrigia o estoque, o lote de
 * `fecharConferencia` estourava, o listener do próprio aparelho lia do **cache local** e
 * mostrava tudo conferido — enquanto o servidor não tinha nada e os celulares dos
 * conferentes continuavam vendo os itens em aberto. Dois logins, duas verdades, e a tela
 * dizendo "concluído" nos dois.
 *
 * Use isto em **toda operação em lote cujo resultado é anunciado ao usuário**. Deixe o
 * `withWriteTimeout` cru só para o que é dispensável: histórico, preferência de aparelho.
 *
 * ⚠️ Estouro **não** significa que a gravação falhou — ela está no cache e sobe depois. Por
 * isso a mensagem para o usuário é "não confirmado", nunca "não salvou". Quem trata o erro
 * distingue com `isWriteTimeout`.
 */
export async function exigirGravacao<T>(
  promise: Promise<T>,
  options: WriteTimeoutOptions = {},
): Promise<T> {
  const resultado = await withWriteTimeout(promise, options);
  if (resultado.timedOut) throw new WriteTimeoutError(options.label ?? 'escrita');
  return resultado.value as T;
}

/**
 * Envolve uma escrita do Firestore com teto de tempo.
 * No estouro resolve com `{ timedOut: true }` — o dado segue no cache local e
 * sincroniza ao reconectar. Nunca lança por causa do teto; erro real continua subindo.
 */
export function withWriteTimeout<T>(
  promise: Promise<T>,
  options: WriteTimeoutOptions = {},
): Promise<WriteResult<T>> {
  const ms = options.ms ?? DEFAULT_WRITE_TIMEOUT_MS;
  const label = options.label ?? 'escrita';

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tracked = Promise.resolve(promise).then(
    (value): WriteResult<T> => {
      settled = true;
      markServerOk();
      return { timedOut: false, value };
    },
    (erro: unknown) => {
      settled = true;
      registrarResultado(erro);
      throw erro;
    },
  );

  const timeout = new Promise<WriteResult<T>>((resolve) => {
    timer = setTimeout(() => {
      if (settled) return;
      markServerFail();
      console.warn(
        `[firestore-write] Teto de ${ms}ms atingido em "${label}". ` +
          'O dado está no cache local e será sincronizado ao reconectar.',
      );
      resolve({ timedOut: true, value: undefined });
    }, ms);
  });

  // Falha tardia (depois do teto) não pode virar unhandled rejection.
  tracked.catch(() => {});

  return Promise.race([tracked, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * `runTransaction` com teto de tempo.
 * Transação NÃO funciona a partir do cache: ou fala com o servidor, ou não acontece.
 * No estouro rejeita com `WriteTimeoutError` para o chamador enfileirar offline.
 */
export async function runTransactionWithTimeout<T>(
  fn: (tx: Transaction) => Promise<T>,
  options: WriteTimeoutOptions = {},
  firestore: Firestore = db,
): Promise<T> {
  const ms = options.ms ?? DEFAULT_TRANSACTION_TIMEOUT_MS;
  const label = options.label ?? 'transação';

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tracked = runTransaction(firestore, fn).then(
    (value) => {
      settled = true;
      markServerOk();
      return value;
    },
    (erro: unknown) => {
      settled = true;
      registrarResultado(erro);
      throw erro;
    },
  );

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      if (settled) return;
      markServerFail();
      console.warn(`[firestore-write] Teto de ${ms}ms atingido em "${label}".`);
      reject(new WriteTimeoutError(label));
    }, ms);
  });

  tracked.catch(() => {});

  try {
    return await Promise.race([tracked, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
