import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { idDeImportacao } from '../apps/web/src/lib/planilha.ts';

const PASTA = new URL('../fixtures/planilhas/', import.meta.url);
const ler = (nome) => readFileSync(new URL(nome, PASTA));
const json = (nome) => JSON.parse(ler(nome).toString('utf8'));

describe('casos.json — ids', () => {
  it.each(json('casos.json').ids)('$chave', async ({ chave, id }) => {
    expect(await idDeImportacao(chave)).toBe(id);
  });
});
