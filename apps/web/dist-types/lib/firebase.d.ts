/**
 * Inicialização do Firebase (SDK modular v11).
 *
 * Mesmo projeto do Themis 1.x (`auditoria-icebeer`) — mesmas coleções, mesmos dados,
 * mesmas Security Rules. Os dois apps podem rodar em paralelo durante a transição.
 *
 * Diferença relevante para o 1.x: aqui a persistência é declarada em
 * `initializeFirestore` com `persistentMultipleTabManager`. O `enablePersistence()`
 * antigo era single-tab e reclamava ("múltiplas abas abertas") desligando o cache —
 * num PWA de navegador isso acontece o tempo todo.
 */
import { type FirebaseApp } from 'firebase/app';
import { type Auth } from 'firebase/auth';
import { type Firestore } from 'firebase/firestore';
export declare const app: FirebaseApp;
export declare const db: Firestore;
export declare const auth: Auth;
//# sourceMappingURL=firebase.d.ts.map