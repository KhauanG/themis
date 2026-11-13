import { mergeConfig } from 'vitest/config';
import base from './vitest.regras.config';

// Mesmos testes, contra a regra da 2.24.0. Variável no arquivo, e não no script npm:
// `VAR=x comando` não funciona no Windows sem cross-env.
export default mergeConfig(base, {
  test: { env: { REGRAS_ARQUIVO: 'firestore/anteriores/firestore-2.24.0.rules' } },
});
