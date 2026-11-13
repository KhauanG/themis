import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { novaListaSemEstoque } from './acesso-estoque.js';
import {
  chaveNomeEstoque, decidirEdicao, decidirRepeticao, gestaoDeCadastroBloqueada, nomeEstoqueRepetido,
  versaoAppValida, type Repeticao, type ValorGestao,
} from './gestao.js';

const casos = JSON.parse(readFileSync(new URL('../casos/gestao.json', import.meta.url), 'utf8')) as {
  versao: { texto: string; aceita: boolean }[];
  nomeEstoque: { a: string; b: string; repetido: boolean }[];
  limpezaPermissoes: { listaAtual: string[]; idExcluido: string; esperado: string[] | null }[];
  repeticao: { abertura: ValorGestao; pedido: ValorGestao; servidor: ValorGestao; esperado: Repeticao }[];
};

describe('gestao.json', () => {
  it('o arquivo não tem BOM nem CRLF', () => {
    const bytes = readFileSync(new URL('../casos/gestao.json', import.meta.url));
    expect(bytes[0]).toBe(0x7b);
    expect(bytes.includes(0x0d)).toBe(false);
  });
  it.each(casos.versao)('versao "$texto" → $aceita', ({ texto, aceita }) => {
    expect(versaoAppValida(texto)).toBe(aceita);
  });
  it.each(casos.nomeEstoque)('nomeEstoque "$a" x "$b" → $repetido', ({ a, b, repetido }) => {
    expect(chaveNomeEstoque(a) === chaveNomeEstoque(b)).toBe(repetido);
  });
  it.each(casos.limpezaPermissoes)('limpezaPermissoes $listaAtual − $idExcluido', ({ listaAtual, idExcluido, esperado }) => {
    expect(novaListaSemEstoque(listaAtual, idExcluido)).toEqual(esperado);
  });
  it.each(casos.repeticao)('repeticao $abertura → $pedido (servidor $servidor) = $esperado', (c) => {
    expect(decidirRepeticao(c.abertura, c.pedido, c.servidor)).toBe(c.esperado);
  });
});

describe('novaListaSemEstoque', () => {
  it('lista que não é lista conta como vazia', () => {
    expect(novaListaSemEstoque(undefined, 'A')).toBeNull();
    expect(novaListaSemEstoque(null, 'A')).toBeNull();
  });
  it('não muta a lista recebida', () => {
    const lista = ['A', 'B'];
    novaListaSemEstoque(lista, 'A');
    expect(lista).toEqual(['A', 'B']);
  });
});

describe('nomeEstoqueRepetido', () => {
  const estoques = [{ id: 'e1', nome: 'Loja Sul' }, { id: 'e2', nome: 'Depósito' }, { id: 'e3' }];
  it('acha repetido sem maiúscula e sem acento', () => {
    expect(nomeEstoqueRepetido(' loja súl ', estoques, null)).toBe(true);
    expect(nomeEstoqueRepetido('deposito', estoques, null)).toBe(true);
  });
  it('ignora o próprio id', () => {
    expect(nomeEstoqueRepetido('Loja Sul', estoques, 'e1')).toBe(false);
  });
  it('nome novo passa', () => {
    expect(nomeEstoqueRepetido('Loja Norte', estoques, null)).toBe(false);
  });
});

describe('decidirEdicao', () => {
  it('um campo GRAVAR, um JA_GRAVADO, um NADA_MUDOU', () => {
    const r = decidirEdicao(
      { nome: 'A', descricao: 'd1', outro: 'x' },
      { nome: 'B', descricao: 'd2', outro: 'x' },
      { nome: 'Z', descricao: 'd2', outro: 'y' },
    );
    expect(r.resultado).toBe('GRAVAR');
    expect(r.campos).toEqual({ nome: 'GRAVAR', descricao: 'JA_GRAVADO', outro: 'NADA_MUDOU' });
    expect(r.de).toEqual({ nome: 'Z', descricao: 'd1', outro: 'x' });
  });
  it('só JA_GRAVADO: resultado JA_GRAVADO', () => {
    expect(decidirEdicao({ nome: 'A' }, { nome: 'B' }, { nome: 'B' }).resultado).toBe('JA_GRAVADO');
  });
  it('nada mudou em nenhum campo', () => {
    expect(decidirEdicao({ nome: 'A' }, { nome: 'A' }, { nome: 'Q' }).resultado).toBe('NADA_MUDOU');
  });
});

describe('gestaoDeCadastroBloqueada', () => {
  it('segue o modo contagem', () => {
    expect(gestaoDeCadastroBloqueada({ modoContagem: true })).toBe(true);
    expect(gestaoDeCadastroBloqueada({ modoContagem: false })).toBe(false);
  });
});
