import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buscarNoCadastro, camposDoProduto, dadosDeCadastro, dadosDeEdicao, idErpValido, temCodigoBarrasDe,
  validarCadastroProduto, type CamposCadastro, type ValidacaoCadastro,
} from './cadastro-produto.js';
import { decidirEdicao, type Repeticao } from './gestao.js';
import type { Produto } from './types.js';

const casos = JSON.parse(readFileSync(new URL('../casos/produto.json', import.meta.url), 'utf8')) as {
  outros: Produto[];
  temCodigoBarras: { codigo: string; esperado: boolean }[];
  validacao: { caso: string; nomeVezes?: number; digitado: CamposCadastro; abertura: CamposCadastro | null; esperado: ValidacaoCadastro }[];
  edicao: {
    caso: string; abertura: CamposCadastro; pedido: CamposCadastro; servidor: CamposCadastro;
    grafias: { idProduto: boolean; idProdut: boolean };
    esperado: { resultado: Repeticao; gravar: Record<string, unknown>; remover: string[] };
  }[];
};

describe('produto.json', () => {
  it('o arquivo não tem BOM nem CRLF', () => {
    const bytes = readFileSync(new URL('../casos/produto.json', import.meta.url));
    expect(bytes[0]).toBe(0x7b);
    expect(bytes.includes(0x0d)).toBe(false);
  });
  it.each(casos.temCodigoBarras)('temCodigoBarras "$codigo" → $esperado', ({ codigo, esperado }) => {
    expect(temCodigoBarrasDe(codigo)).toBe(esperado);
  });
  it.each(casos.validacao)('validacao › $caso', ({ nomeVezes, digitado, abertura, esperado }) => {
    const nome = nomeVezes ? 'a'.repeat(nomeVezes) : digitado.nome;
    const r = validarCadastroProduto({ ...digitado, nome }, abertura, casos.outros);
    if (esperado.ok && nomeVezes) expect(r).toEqual({ ok: true, campos: { ...esperado.campos, nome } });
    else expect(r).toEqual(esperado);
  });
  it.each(casos.edicao)('edicao › $caso', ({ abertura, pedido, servidor, grafias, esperado }) => {
    const d = decidirEdicao(abertura, pedido, servidor);
    expect(d.resultado).toBe(esperado.resultado);
    expect(dadosDeEdicao(pedido, d.campos, grafias)).toEqual({ gravar: esperado.gravar, remover: esperado.remover });
  });
});

describe('validarCadastroProduto', () => {
  it('reenvio do cadastro: o próprio id, já gravado, fica fora de outros', () => {
    const novo = { nome: 'Agua', codigoBarras: '7891', idErp: '45' };
    const gravado: Produto = { id: 'p-novo', nome: 'Agua', codigoBarras: '7891', IdProduto: '45' };
    expect(validarCadastroProduto(novo, null, [gravado]).ok).toBe(false);
    expect(validarCadastroProduto(novo, null, [gravado].filter((p) => p.id !== 'p-novo')))
      .toEqual({ ok: true, campos: novo });
  });
});

describe('idErpValido', () => {
  it('só dígitos, sem zero à esquerda', () => {
    expect(['1', '45', ' 45 ', '100'].map(idErpValido)).toEqual([true, true, true, true]);
    expect(['', '0', '007', '-1', '1.5', '12abc', 'abc'].map(idErpValido)).toEqual([false, false, false, false, false, false, false]);
  });
});

describe('camposDoProduto', () => {
  it('lê as grafias antigas e devolve texto aparado', () => {
    expect(camposDoProduto({ id: 'p', NomeProduto: 'Agua', CodigoBarras: '790', idProdut: 33 }))
      .toEqual({ nome: 'Agua', codigoBarras: '790', idErp: '33' });
  });
  it('produto sem nada devolve vazios, sem o "Sem nome" de exibição', () => {
    expect(camposDoProduto({ id: 'p' })).toEqual({ nome: '', codigoBarras: '', idErp: '' });
  });
});

describe('dadosDeCadastro', () => {
  it('grava as dez chaves do desenho 5.6', () => {
    expect(dadosDeCadastro({ nome: 'Guarana', codigoBarras: '791', idErp: '45' }, 'E1')).toEqual({
      nome: 'Guarana', NomeProduto: 'Guarana', codigoBarras: '791', CodigoBarras: '791', temCodigoBarras: true,
      IdProduto: '45', quantidade: 0, estoqueSistema: 0, EstoqueAtual: 0, inventoryId: 'E1',
    });
  });
  it('sem código de barras', () => {
    expect(dadosDeCadastro({ nome: 'Guarana', codigoBarras: '', idErp: '45' }, 'E1')).toMatchObject({
      codigoBarras: '', CodigoBarras: '', temCodigoBarras: false,
    });
  });
});

describe('dadosDeEdicao', () => {
  // Guarda da função: o `decidirEdicao` não chega aqui com ID vazio (pedido == abertura dá NADA_MUDOU), mas, se chegasse, apagaria em vez de gravar "".
  it('ID vazio com GRAVAR remove o IdProduto', () => {
    const r = dadosDeEdicao({ nome: 'A', codigoBarras: '', idErp: '' },
      { nome: 'NADA_MUDOU', codigoBarras: 'NADA_MUDOU', idErp: 'GRAVAR' }, { idProduto: true, idProdut: false });
    expect(r).toEqual({ gravar: {}, remover: ['IdProduto', 'idProduto'] });
  });
});

describe('buscarNoCadastro', () => {
  const produtos: Produto[] = [
    { id: 'c', nome: 'Suco de Açaí', codigoBarras: '111', IdProduto: '30' },
    { id: 'a', nome: 'Agua 500ml', codigoBarras: '789123', IdProduto: 7 },
    { id: 'b', NomeProduto: 'Cerveja Lata', CodigoBarras: '222', idProduto: '45' },
  ];
  const ids = (termo: string) => buscarNoCadastro(produtos, termo).linhas.map((p) => p.id);

  it('sem termo: todos, por nome', () => expect(ids('')).toEqual(['a', 'b', 'c']));
  it('por nome, sem acento e sem maiúscula', () => expect(ids('acai')).toEqual(['c']));
  it('por pedaço do código de barras', () => expect(ids('9123')).toEqual(['a']));
  it('por código no ERP', () => expect(ids('45')).toEqual(['b']));
  it('corta no limite e diz o total', () => {
    const muitos = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, nome: `Item ${String(i).padStart(2, '0')}` }));
    const r = buscarNoCadastro(muitos, 'item');
    expect(r.linhas).toHaveLength(50);
    expect(r.total).toBe(60);
    expect(r.linhas[0]!.id).toBe('p0');
  });
});
