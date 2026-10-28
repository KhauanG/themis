import { describe, expect, it } from 'vitest';
import type { Listagem } from './routes/erp.js';
import { chavesDoId, veredictoDoTeste } from './teste-hash.js';

// Textos fixos. O site mostra `mensagem` como vem.
const SEM_CONEXAO =
  'Não consegui falar com o ERP. Tente de novo em alguns minutos. Isto não diz se o hash está certo.';
const RECUSADO =
  'Hash provavelmente errado: o ERP recusou a consulta. Pegue o HashLoja de novo no painel do Nuvem3.';
const INESPERADO = 'Resposta inesperada do ERP. Tente de novo; se repetir, avise o administrador.';
const VAZIO =
  'Hash provavelmente errado: o ERP não devolveu nenhum produto. Pegue o HashLoja de novo no painel do Nuvem3. (Uma loja sem estoque no ERP aparece igual.)';
const ALERTA = ' Os saldos não batem com o último Buscar; confira se este hash é mesmo desta loja.';

const lista = (itens: unknown[]): Listagem => ({ tipo: 'lista', itens });
const doErp = (...pares: Array<[string, number]>) =>
  lista(pares.map(([idproduto, quantidade]) => ({ idproduto, quantidade })));

describe('chavesDoId — porte de chavesDeIdProduto', () => {
  it.each([
    ['ABC123', ['ABC123']],
    [7, ['7']],
    ['7', ['7']],
    ['007', ['007', '7']],
    ['  42  ', ['42']],
    [null, []],
    [undefined, []],
    ['', []],
  ] as const)('%j → %j', (valor, chaves) => expect(chavesDoId(valor)).toEqual(chaves));
});

describe('veredictoDoTeste — ordem da spec 4.5', () => {
  const AMOSTRA = [{ idProduto: 1, estoqueSistema: 5 }];

  it.each([
    [{ tipo: 'sem-conexao', motivo: 'tempo' }, 'sem-conexao', SEM_CONEXAO],
    [{ tipo: 'sem-conexao', motivo: 'rede' }, 'sem-conexao', SEM_CONEXAO],
    [{ tipo: 'sem-conexao', motivo: 'http', statusErp: 503 }, 'sem-conexao', SEM_CONEXAO],
    [{ tipo: 'recusa', statusErp: 404 }, 'recusado', RECUSADO],
    [{ tipo: 'inesperado', formato: 'object', tamanho: 7 }, 'inesperado', INESPERADO],
  ] as const)('%j → %s', (listagem, veredicto, mensagem) =>
    expect(veredictoDoTeste(listagem, AMOSTRA)).toEqual({ veredicto, mensagem }));

  it('lista vazia → vazio', () =>
    expect(veredictoDoTeste(lista([]), AMOSTRA)).toEqual({ veredicto: 'vazio', mensagem: VAZIO, recebidos: 0 }));

  it('lista sem nenhum id reconhecível → inesperado, com ou sem amostra', () => {
    const semId = lista([{ codigointerno: 'A1', quantidade: 2 }, null]);
    for (const amostra of [AMOSTRA, []]) {
      expect(veredictoDoTeste(semId, amostra)).toEqual({ veredicto: 'inesperado', mensagem: INESPERADO, recebidos: 2 });
    }
  });

  it('loja sem produtos com IdProduto → sem-amostra, com recebidos', () =>
    expect(veredictoDoTeste(doErp(['1', 5], ['2', 3]), [])).toEqual({
      veredicto: 'sem-amostra',
      mensagem:
        'O ERP respondeu (produtos devolvidos: 2), mas esta loja ainda não tem produtos para conferir. Importe a planilha e teste de novo.',
      recebidos: 2,
    }));

  it('nenhum id da amostra na lista → nenhum-id', () =>
    expect(
      veredictoDoTeste(doErp(['1', 5], ['2', 3]), [{ idProduto: 8 }, { idProduto: 9 }, { idProduto: 10 }]),
    ).toEqual({
      veredicto: 'nenhum-id',
      mensagem:
        'Nenhum produto da loja aparece no ERP. Produtos da loja conferidos: 3; devolvidos pelo ERP: 2. O hash pode ser de outra conta do ERP, ou a planilha tem IDs errados.',
      recebidos: 2,
      amostra: 3,
      encontrados: 0,
    }));

  it('ok conta encontrados e só compara quem está no ERP e tem saldo guardado', () =>
    expect(
      veredictoDoTeste(doErp(['1', 5], ['2', 3], ['4', 1]), [
        { idProduto: 1, estoqueSistema: 5 }, // igual
        { idProduto: 2, estoqueSistema: 9 }, // diferente
        { idProduto: 3, estoqueSistema: 7 }, // fora do ERP: não compara
        { idProduto: 4 }, // sem saldo guardado: não compara
      ]),
    ).toEqual({
      veredicto: 'ok',
      mensagem:
        'Hash ok. Produtos devolvidos pelo ERP: 3. Produtos da loja conferidos: 4; achados na lista: 3. Saldos iguais ao guardado no Themis (último Buscar ou importação): 1 de 2.',
      recebidos: 3,
      amostra: 4,
      encontrados: 3,
      saldosComparados: 2,
      saldosIguais: 1,
      alertaSaldos: false,
    }));

  it('ok sem saldo comparável não fala de saldos', () =>
    expect(veredictoDoTeste(doErp(['1', 5]), [{ idProduto: 1 }]).mensagem).toBe(
      'Hash ok. Produtos devolvidos pelo ERP: 1. Produtos da loja conferidos: 1; achados na lista: 1.',
    ));

  it('IdProduto 7 casa com idproduto "007"', () => {
    expect(veredictoDoTeste(doErp(['007', 2]), [{ idProduto: 7 }]).encontrados).toBe(1);
    expect(veredictoDoTeste(doErp(['7', 2]), [{ idProduto: '007' }]).encontrados).toBe(1);
  });
});

describe('alerta só com 5 ou mais comparáveis e menos de 20% iguais', () => {
  // n produtos com saldo 1 no ERP; na loja, os k primeiros guardam 1 e os outros 2.
  const comparar = (n: number, k: number) => {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    return veredictoDoTeste(
      lista(ids.map((id) => ({ idproduto: String(id), quantidade: 1 }))),
      ids.map((id) => ({ idProduto: id, estoqueSistema: id <= k ? 1 : 2 })),
    );
  };

  it.each([
    [5, 0, true],
    [4, 0, false],
    [10, 1, true],
    [10, 2, false],
  ] as const)('%i comparáveis, %i iguais → alerta %s', (n, k, alerta) => {
    const r = comparar(n, k);
    expect(r.alertaSaldos).toBe(alerta);
    expect(r.mensagem.endsWith(ALERTA)).toBe(alerta);
  });

  // O ERP lista itens zerados. Com o hash da loja vizinha, os zerados nas duas calariam o alerta.
  it('par zerado nos dois lados não conta como saldo comparável', () => {
    const ids = Array.from({ length: 10 }, (_, i) => i + 1);
    const r = veredictoDoTeste(
      lista(ids.map((id) => ({ idproduto: String(id), quantidade: id <= 5 ? 0 : 1 }))),
      ids.map((id) => ({ idProduto: id, estoqueSistema: id <= 5 ? 0 : 2 })),
    );
    expect([r.saldosComparados, r.saldosIguais, r.alertaSaldos]).toEqual([5, 0, true]);
  });
});
