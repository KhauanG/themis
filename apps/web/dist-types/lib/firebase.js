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
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, } from 'firebase/firestore';
function obrigatorio(nome, valor) {
    if (!valor) {
        throw new Error(`Variável de ambiente ${nome} não definida. Copie apps/web/.env.example para .env e preencha.`);
    }
    return valor;
}
const firebaseConfig = {
    apiKey: obrigatorio('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
    authDomain: obrigatorio('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: obrigatorio('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: obrigatorio('VITE_FIREBASE_STORAGE_BUCKET', import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: obrigatorio('VITE_FIREBASE_MESSAGING_SENDER_ID', import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: obrigatorio('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID),
};
export const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
    }),
});
export const auth = getAuth(app);
//# sourceMappingURL=firebase.js.map