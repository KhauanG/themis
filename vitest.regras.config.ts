import { defineConfig } from 'vitest/config';

/**
 * Configuração separada para os testes das Security Rules.
 *
 * Eles **não** entram no `npm test`: exigem o emulador do Firestore no ar, e um `npm run
 * verificar` que falha porque falta emulador treina a equipe a ignorar falha de teste.
 * Rodam por `npm run testar-regras`, que sobe o emulador, executa e derruba.
 *
 * Timeout alto de propósito: cada asserção é uma ida ao emulador, e a primeira paga a
 * subida da JVM.
 */
export default defineConfig({
  test: {
    include: ['firestore/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Um arquivo por vez: os testes compartilham o mesmo banco do emulador e limpam entre
    // si com `clearFirestore()`. Em paralelo, um apagaria o cenário do outro.
    fileParallelism: false,
  },
});
