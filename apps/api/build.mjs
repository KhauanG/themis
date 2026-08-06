/**
 * Empacota a API num arquivo único, sem dependências em tempo de execução.
 *
 * Motivo: a Hostinger compila num diretório (`hbuilds/source/repository`) e depois copia
 * o resultado para onde o app roda. Se o `node_modules` não sobrevive a essa cópia, o
 * processo morre no primeiro `import` — e o sintoma é um `503 Service Unavailable` sem
 * nada no log, porque nem chega a existir logger.
 *
 * Com tudo embutido, rodar a API precisa de exatamente dois caminhos:
 *   apps/api/dist/server.mjs  (este bundle)
 *   apps/web/dist/            (o PWA que ele serve)
 *
 * Sem `node_modules`, sem `npm install` no servidor, sem resolução de workspace.
 *
 * A extensão `.mjs` não é detalhe: o bundle é ESM, e num arquivo `.js` o Node decide o
 * formato pelo `package.json` mais próximo. Se a cópia da hospedagem não levar esse
 * arquivo junto, o Node 20 assume CommonJS e morre com `Cannot use import statement
 * outside a module` — de novo, 503 sem log. `.mjs` é ESM por especificação, em qualquer
 * versão e sem depender de nenhum arquivo vizinho.
 */
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });

const resultado = await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  // Sem minificar: se algo quebrar em produção, o stack trace precisa ser legível.
  minify: false,
  logLevel: 'info',
  // Várias dependências (pino, fastify) usam `require` internamente. Em bundle ESM esse
  // símbolo não existe, então é preciso recriá-lo a partir de `import.meta.url`.
  banner: {
    js: [
      "import { createRequire as __criarRequire } from 'node:module';",
      "import { fileURLToPath as __urlParaCaminho } from 'node:url';",
      "import { dirname as __pastaDe } from 'node:path';",
      'const require = __criarRequire(import.meta.url);',
      'const __filename = __urlParaCaminho(import.meta.url);',
      'const __dirname = __pastaDe(__filename);',
    ].join('\n'),
  },
  metafile: true,
});

const saida = resultado.metafile.outputs['dist/server.mjs'];
console.log(`\nBundle: ${(saida.bytes / 1024).toFixed(0)} KB, zero dependências em runtime.`);
