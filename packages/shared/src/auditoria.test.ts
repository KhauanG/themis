import { describe, expect, it } from 'vitest';
import { calcularEstatisticas, diferencaDe, montarSnapshotProdutos, statusDe } from './auditoria.js';
import type { Produto } from './types.js';

function produto(over: Partial<Produto> = {}): Produto {
  return { id: 'p1', nome: 'Cerveja', productStatus: 'ATUALIZADO', ...over };
}

describe('statusDe', () => {
  it('NÃO CONTADO quando o item não foi contado no ciclo', () => {
    expect(statusDe(produto({ productStatus: 'PENDENTE' }))).toBe('NÃO CONTADO');
    expect(statusDe(produto({ productStatus: null }))).toBe('NÃO CONTADO');
  });

  it('CORRETO quando físico bate com sistema', () => {
    expect(statusDe(produto({ quantidade: 40, estoqueSistema: 40 }))).toBe('CORRETO');
  });

  it('ERRADO quando diverge menos que o limite crítico', () => {
    expect(statusDe(produto({ quantidade: 45, estoqueSistema: 40 }))).toBe('ERRADO');
    expect(statusDe(produto({ quantidade: 31, estoqueSistema: 40 }))).toBe('ERRADO');
  });

  // Regressão: no Themis 1.x esta lógica estava duplicada e a cópia de app.js
  // nunca devolvia CRITICO — a mesma contagem gerava auditorias diferentes.
  it('CRITICO quando |diferença| >= 10, nos dois sentidos', () => {
    expect(statusDe(produto({ quantidade: 50, estoqueSistema: 40 }))).toBe('CRITICO');
    expect(statusDe(produto({ quantidade: 30, estoqueSistema: 40 }))).toBe('CRITICO');
  });

  it('trata 10 exato como CRITICO e 9 como ERRADO', () => {
    expect(statusDe(produto({ quantidade: 10, estoqueSistema: 0 }))).toBe('CRITICO');
    expect(statusDe(produto({ quantidade: 9, estoqueSistema: 0 }))).toBe('ERRADO');
  });

  it('CONFERIDO conta como item contado', () => {
    expect(statusDe(produto({ productStatus: 'CONFERIDO', quantidade: 5, estoqueSistema: 5 }))).toBe(
      'CORRETO',
    );
  });

  it('contagem zero é contagem válida, não ausência de contagem', () => {
    expect(statusDe(produto({ quantidade: 0, estoqueFisico: 99, estoqueSistema: 0 }))).toBe('CORRETO');
  });

  it('usa as grafias legadas quando as novas faltam', () => {
    expect(statusDe(produto({ estoqueFisico: 7, EstoqueAtual: 7 }))).toBe('CORRETO');
  });
});

describe('diferencaDe', () => {
  it('devolve traço para item não contado', () => {
    expect(diferencaDe(produto({ productStatus: 'PENDENTE' }))).toBe('-');
  });

  it('devolve a diferença com sinal', () => {
    expect(diferencaDe(produto({ quantidade: 12, estoqueSistema: 5 }))).toBe(7);
    expect(diferencaDe(produto({ quantidade: 5, estoqueSistema: 12 }))).toBe(-7);
    expect(diferencaDe(produto({ quantidade: 5, estoqueSistema: 5 }))).toBe(0);
  });
});

describe('calcularEstatisticas', () => {
  it('separa contados, não contados e corrigidos sem contar em dobro', () => {
    const produtos: Produto[] = [
      produto({ id: 'a', quantidade: 10, estoqueSistema: 10 }),
      produto({ id: 'b', quantidade: 3, estoqueSistema: 10 }),
      produto({ id: 'c', productStatus: 'PENDENTE' }),
      produto({ id: 'd', productStatus: 'CONFERIDO', quantidade: 8, estoqueSistema: 8 }),
      produto({ id: 'e', productStatus: 'CONFERIDO', quantidade: 8, estoqueSistema: 8, corrigidoIncorreto: true }),
    ];

    const est = calcularEstatisticas(produtos);

    expect(est.total).toBe(5);
    expect(est.contados).toBe(2);
    expect(est.naoContados).toBe(3); // 1 pendente + 2 conferidos
    expect(est.corretos).toBe(1);
    expect(est.incorretos).toBe(1);
    expect(est.percentualIncorretos).toBe(50.0);

    expect(est.corrigidos.total).toBe(2);
    expect(est.corrigidos.corretos).toBe(1);
    // corrigidoIncorreto marcado pelo admin vence o cálculo automático
    expect(est.corrigidos.incorretos).toBe(1);
    expect(est.corrigidos.percentualIncorretos).toBe(50.0);
  });

  it('não divide por zero quando nada foi contado', () => {
    const est = calcularEstatisticas([produto({ productStatus: 'PENDENTE' })]);
    expect(est.percentualIncorretos).toBe(0.0);
    expect(est.corrigidos.percentualIncorretos).toBe(0.0);
  });

  it('contados + naoContados sempre fecha com o total', () => {
    const produtos: Produto[] = [
      produto({ id: 'a', quantidade: 1, estoqueSistema: 1 }),
      produto({ id: 'b', productStatus: 'CONFERIDO' }),
      produto({ id: 'c', productStatus: 'PENDENTE' }),
    ];
    const est = calcularEstatisticas(produtos);
    expect(est.contados + est.naoContados).toBe(est.total);
  });
});

describe('montarSnapshotProdutos', () => {
  it('preserva o formato gravado pelo Themis 1.x', () => {
    const snap = montarSnapshotProdutos([
      produto({
        id: 'x1',
        NomeProduto: 'Skol Lata',
        nome: undefined,
        IdProduto: 998,
        CodigoBarras: '789123',
        quantidade: 25,
        EstoqueAtual: 10,
        dataValidade: '2026-08-01',
      }),
    ]);

    expect(snap[0]).toEqual({
      id: 'x1',
      nome: 'Skol Lata',
      NomeProduto: 'Skol Lata',
      IdProduto: 998,
      codigoBarras: '789123',
      estoqueFisico: 25,
      estoqueSistema: 10,
      status: 'CRITICO',
      diferenca: 15,
      productStatus: 'ATUALIZADO',
      corrigidoIncorreto: null,
      dataValidade: '2026-08-01',
    });
  });

  it('descarta validade malformada em vez de propagar lixo', () => {
    const snap = montarSnapshotProdutos([produto({ dataValidade: '01/08/2026' })]);
    expect(snap[0]?.dataValidade).toBeNull();
  });
});
