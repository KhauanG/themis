import { describe, expect, it } from 'vitest';
import { problemasDeProduto, sugestaoDeConserto } from './validacao.js';

/** Documento mínimo que passa: as três chaves obrigatórias com os tipos certos. */
function valido(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { nome: 'Skol Lata', quantidade: 0, codigoBarras: '789', ...extra };
}

/** Timestamp do Firestore não é importável aqui; o formato é o que a checagem usa. */
function timestamp(): unknown {
  return { seconds: 1_700_000_000, nanoseconds: 0, toDate: () => new Date() };
}

describe('problemasDeProduto', () => {
  it('aceita o documento mínimo', () => {
    expect(problemasDeProduto(valido())).toEqual([]);
  });

  it('aceita quantidade zero e código de barras vazio', () => {
    // É o estado depois de limpar contagem, e de produto cadastrado sem código.
    expect(problemasDeProduto(valido({ quantidade: 0, codigoBarras: '' }))).toEqual([]);
  });

  it('cobra as três chaves obrigatórias', () => {
    const problemas = problemasDeProduto({});
    expect(problemas.map((p) => p.campo).sort()).toEqual(['codigoBarras', 'nome', 'quantidade']);
    expect(problemas.every((p) => p.encontrado === 'ausente')).toBe(true);
  });

  // O caso que motivou o script: null não é número nem texto para as regras.
  it('acusa null nos campos obrigatórios', () => {
    expect(problemasDeProduto(valido({ quantidade: null }))).toEqual([
      { campo: 'quantidade', encontrado: 'null', esperado: 'número' },
    ]);
    expect(problemasDeProduto(valido({ codigoBarras: null }))).toEqual([
      { campo: 'codigoBarras', encontrado: 'null', esperado: 'texto' },
    ]);
  });

  it('acusa null em campo opcional presente', () => {
    expect(problemasDeProduto(valido({ corrigidoIncorreto: null }))).toEqual([
      { campo: 'corrigidoIncorreto', encontrado: 'null', esperado: 'booleano' },
    ]);
  });

  it('ignora campo opcional ausente', () => {
    expect(problemasDeProduto(valido())).toEqual([]);
  });

  it('aceita corrigidoIncorreto booleano', () => {
    expect(problemasDeProduto(valido({ corrigidoIncorreto: false }))).toEqual([]);
    expect(problemasDeProduto(valido({ corrigidoIncorreto: true }))).toEqual([]);
  });

  it('recusa quantidade como texto, mesmo parecendo número', () => {
    expect(problemasDeProduto(valido({ quantidade: '12' }))).toEqual([
      { campo: 'quantidade', encontrado: 'string', esperado: 'número' },
    ]);
  });

  // NaN é um double válido no Firestore e passa no `is number`. Este módulo responde
  // "a regra recusaria?", então precisa concordar com ela — mesmo sendo dado ruim.
  it('aceita NaN, porque a regra aceita', () => {
    expect(problemasDeProduto(valido({ quantidade: Number.NaN }))).toEqual([]);
  });

  it('recusa nome vazio e nome longo demais', () => {
    expect(problemasDeProduto(valido({ nome: '' }))[0]).toMatchObject({ encontrado: 'vazio' });
    expect(problemasDeProduto(valido({ nome: 'x'.repeat(301) }))[0]).toMatchObject({
      esperado: 'até 300',
    });
  });

  it('aceita nome no limite exato', () => {
    expect(problemasDeProduto(valido({ nome: 'x'.repeat(300) }))).toEqual([]);
  });

  it('só aceita ATUALIZADO e CONFERIDO em productStatus', () => {
    expect(problemasDeProduto(valido({ productStatus: 'ATUALIZADO' }))).toEqual([]);
    expect(problemasDeProduto(valido({ productStatus: 'CONFERIDO' }))).toEqual([]);
    // 'PENDENTE' parece razoável e é justamente o que a regra recusa.
    expect(problemasDeProduto(valido({ productStatus: 'PENDENTE' }))[0]).toMatchObject({
      campo: 'productStatus',
      esperado: 'ATUALIZADO ou CONFERIDO',
    });
  });

  it('aceita timestamp do Firestore e Date em lastModified', () => {
    expect(problemasDeProduto(valido({ lastModified: timestamp() }))).toEqual([]);
    expect(problemasDeProduto(valido({ lastModified: new Date() }))).toEqual([]);
  });

  it('recusa data gravada como texto', () => {
    expect(problemasDeProduto(valido({ lastModified: '2026-08-05' }))).toEqual([
      { campo: 'lastModified', encontrado: 'string', esperado: 'timestamp' },
    ]);
  });

  it('recusa Date inválida', () => {
    expect(problemasDeProduto(valido({ createdAt: new Date('nada') }))[0]).toMatchObject({
      campo: 'createdAt',
      esperado: 'timestamp',
    });
  });

  it('aceita IdProduto como texto ou número', () => {
    expect(problemasDeProduto(valido({ IdProduto: 'A99' }))).toEqual([]);
    expect(problemasDeProduto(valido({ IdProduto: 99 }))).toEqual([]);
    expect(problemasDeProduto(valido({ IdProduto: null }))[0]?.campo).toBe('IdProduto');
  });

  it('recusa dataValidade como Date, que a regra espera em texto', () => {
    expect(problemasDeProduto(valido({ dataValidade: new Date() }))[0]).toMatchObject({
      campo: 'dataValidade',
      esperado: 'texto',
    });
  });

  it('acumula todos os problemas do documento', () => {
    const problemas = problemasDeProduto({
      nome: '',
      quantidade: null,
      codigoBarras: 123,
      corrigidoIncorreto: null,
      productStatus: 'PENDENTE',
    });
    expect(problemas).toHaveLength(5);
  });
});

describe('sugestaoDeConserto', () => {
  it('null vira remover ou converter', () => {
    expect(sugestaoDeConserto({ campo: 'corrigidoIncorreto', encontrado: 'null', esperado: 'booleano' })).toContain(
      'remover',
    );
  });

  it('quantidade ausente sugere zero', () => {
    expect(sugestaoDeConserto({ campo: 'quantidade', encontrado: 'ausente', esperado: 'número' })).toBe(
      'gravar 0',
    );
  });

  it('tipo errado sugere conversão', () => {
    expect(sugestaoDeConserto({ campo: 'lastModified', encontrado: 'string', esperado: 'timestamp' })).toBe(
      'converter para timestamp',
    );
  });
});
