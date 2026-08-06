import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `scripts/` entra porque o versionamento tem lógica própria (calcular a próxima
    // versão, abrir a seção do changelog) e ela decide o que vai para produção.
    include: ['{apps,packages}/*/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
