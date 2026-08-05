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
import { runTransaction } from 'firebase/firestore';
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
export function markServerOk() {
    _lastServerOkAt = Date.now();
}
export function markServerFail() {
    _lastServerFailAt = Date.now();
}
export function lastServerOkAt() {
    return _lastServerOkAt;
}
export function lastServerFailAt() {
    return _lastServerFailAt;
}
function registrarResultado(erro) {
    const code = erro?.code;
    // Recusa de regra também é resposta do servidor: prova que há conexão.
    if (code && CODIGOS_DE_REDE.has(code))
        markServerFail();
    else
        markServerOk();
}
/** Erro de teto de tempo. `isWriteTimeout` marca para o retry NÃO re-tentar. */
export class WriteTimeoutError extends Error {
    code = 'deadline-exceeded';
    isWriteTimeout = true;
    constructor(label) {
        super(`Tempo esgotado ao contatar o servidor (${label}).`);
        this.name = 'WriteTimeoutError';
    }
}
export function isWriteTimeout(erro) {
    return erro?.isWriteTimeout === true;
}
/**
 * Envolve uma escrita do Firestore com teto de tempo.
 * No estouro resolve com `{ timedOut: true }` — o dado segue no cache local e
 * sincroniza ao reconectar. Nunca lança por causa do teto; erro real continua subindo.
 */
export function withWriteTimeout(promise, options = {}) {
    const ms = options.ms ?? DEFAULT_WRITE_TIMEOUT_MS;
    const label = options.label ?? 'escrita';
    let settled = false;
    let timer;
    const tracked = Promise.resolve(promise).then((value) => {
        settled = true;
        markServerOk();
        return { timedOut: false, value };
    }, (erro) => {
        settled = true;
        registrarResultado(erro);
        throw erro;
    });
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            if (settled)
                return;
            markServerFail();
            console.warn(`[firestore-write] Teto de ${ms}ms atingido em "${label}". ` +
                'O dado está no cache local e será sincronizado ao reconectar.');
            resolve({ timedOut: true, value: undefined });
        }, ms);
    });
    // Falha tardia (depois do teto) não pode virar unhandled rejection.
    tracked.catch(() => { });
    return Promise.race([tracked, timeout]).finally(() => {
        if (timer)
            clearTimeout(timer);
    });
}
/**
 * `runTransaction` com teto de tempo.
 * Transação NÃO funciona a partir do cache: ou fala com o servidor, ou não acontece.
 * No estouro rejeita com `WriteTimeoutError` para o chamador enfileirar offline.
 */
export async function runTransactionWithTimeout(fn, options = {}, firestore = db) {
    const ms = options.ms ?? DEFAULT_TRANSACTION_TIMEOUT_MS;
    const label = options.label ?? 'transação';
    let settled = false;
    let timer;
    const tracked = runTransaction(firestore, fn).then((value) => {
        settled = true;
        markServerOk();
        return value;
    }, (erro) => {
        settled = true;
        registrarResultado(erro);
        throw erro;
    });
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            if (settled)
                return;
            markServerFail();
            console.warn(`[firestore-write] Teto de ${ms}ms atingido em "${label}".`);
            reject(new WriteTimeoutError(label));
        }, ms);
    });
    tracked.catch(() => { });
    try {
        return await Promise.race([tracked, timeout]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
//# sourceMappingURL=firestore-write.js.map