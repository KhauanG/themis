import { describe, expect, it } from 'vitest';
import { montarEnvio } from './erp-payload.js';
import type { Produto } from './types.js';

const base: Produto = {
  id: 'doc1',
  nome: 'Cerveja Lata 350ml',
  IdProduto: '4321',
  codigoBarras: '7891234567890',
  quantidade: 12,
};

/**
 * Este teste existe porque o payload divergiu do Themis 1.x em produção: quatro campos
 * faltando e o `IdProduto` em texto. Cada expectativa aqui é o que o `sendToERP` do 1.x
 * enviava — a única referência confiável do que o ERP aceita.
 */
describe('montarEnvio', () => {
  it('produz os sete campos; o HashLoja é posto pela API', () => {
    expect(Object.keys(montarEnvio(base)).sort()).toEqual(
      ['CodigoBarras', 'EstoqueMinimo', 'IdProduto', 'NomeProduto', 'PrecoCusto', 'PrecoVenda', 'Quantidade'].sort(),
    );
    expect(montarEnvio(base)).not.toHaveProperty('HashLoja');
  });

  it('IdProduto sai inteiro, não texto', () => {
    const envio = montarEnvio(base);
    expect(envio.IdProduto).toBe(4321);
    expect(typeof envio.IdProduto).toBe('number');
  });

  it('IdProduto com zeros à esquerda vira inteiro', () => {
    expect(montarEnvio({ ...base, IdProduto: '007' }).IdProduto).toBe(7);
  });

  // `|| 0` no lugar de deixar NaN escapar: NaN vira `null` no JSON e o ERP rejeita.
  it('IdProduto ausente ou inválido vira 0', () => {
    expect(montarEnvio({ id: 'x' }).IdProduto).toBe(0);
    expect(montarEnvio({ id: 'x', IdProduto: 'ABC' }).IdProduto).toBe(0);
  });

  it('quantidade fracionária é arredondada', () => {
    expect(montarEnvio({ ...base, quantidade: 2.6 }).Quantidade).toBe(3);
  });

  it('quantidade negativa é grampeada em zero', () => {
    expect(montarEnvio({ ...base, quantidade: -5 }).Quantidade).toBe(0);
  });

  // Contagem zero é contagem. Não pode virar o físico legado nem sumir.
  it('quantidade zero é preservada', () => {
    expect(montarEnvio({ ...base, quantidade: 0 }).Quantidade).toBe(0);
  });

  it('quantidade explícita vence a do produto', () => {
    expect(montarEnvio(base, 40).Quantidade).toBe(40);
  });

  it('EstoqueMinimo é sempre 0, como no 1.x', () => {
    expect(montarEnvio(base).EstoqueMinimo).toBe(0);
  });

  it('preço em texto com vírgula vira número com duas casas', () => {
    const envio = montarEnvio({ ...base, PrecoVenda: '12,345', PrecoCusto: '8,5' });
    expect(envio.PrecoVenda).toBe(12.35);
    expect(envio.PrecoCusto).toBe(8.5);
  });

  it('preço ausente vira 0, não NaN', () => {
    const envio = montarEnvio(base);
    expect(envio.PrecoVenda).toBe(0);
    expect(envio.PrecoCusto).toBe(0);
  });

  it('aceita as grafias minúsculas do preço', () => {
    expect(montarEnvio({ ...base, precoVenda: 9.99 }).PrecoVenda).toBe(9.99);
  });

  it('produto sem código de barras envia string vazia, não quebra', () => {
    expect(montarEnvio({ ...base, codigoBarras: null }).CodigoBarras).toBe('');
  });

  it('usa a grafia legada do nome quando é a única', () => {
    expect(montarEnvio({ id: 'x', NomeProduto: 'Legado' }).NomeProduto).toBe('Legado');
  });
});
