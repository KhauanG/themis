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
import { type Firestore, type Transaction } from 'firebase/firestore';
export declare const DEFAULT_WRITE_TIMEOUT_MS = 8000;
export declare const DEFAULT_TRANSACTION_TIMEOUT_MS = 12000;
export declare function markServerOk(): void;
export declare function markServerFail(): void;
export declare function lastServerOkAt(): number;
export declare function lastServerFailAt(): number;
export interface WriteTimeoutOptions {
    ms?: number;
    label?: string;
}
export interface WriteResult<T> {
    timedOut: boolean;
    value: T | undefined;
}
/** Erro de teto de tempo. `isWriteTimeout` marca para o retry NÃO re-tentar. */
export declare class WriteTimeoutError extends Error {
    readonly code = "deadline-exceeded";
    readonly isWriteTimeout = true;
    constructor(label: string);
}
export declare function isWriteTimeout(erro: unknown): boolean;
/**
 * Envolve uma escrita do Firestore com teto de tempo.
 * No estouro resolve com `{ timedOut: true }` — o dado segue no cache local e
 * sincroniza ao reconectar. Nunca lança por causa do teto; erro real continua subindo.
 */
export declare function withWriteTimeout<T>(promise: Promise<T>, options?: WriteTimeoutOptions): Promise<WriteResult<T>>;
/**
 * `runTransaction` com teto de tempo.
 * Transação NÃO funciona a partir do cache: ou fala com o servidor, ou não acontece.
 * No estouro rejeita com `WriteTimeoutError` para o chamador enfileirar offline.
 */
export declare function runTransactionWithTimeout<T>(fn: (tx: Transaction) => Promise<T>, options?: WriteTimeoutOptions, firestore?: Firestore): Promise<T>;
//# sourceMappingURL=firestore-write.d.ts.map