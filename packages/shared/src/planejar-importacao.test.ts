import { describe, expect, it } from 'vitest';
import {
  chaveDaLinha,
  planejarImportacao,
  type LinhaPlanilha,
  type ProdutoDoBanco,
} from './planejar-importacao.js';

const SKOL: ProdutoDoBanco = {
  id: 'p1', IdProduto: '7', nome: 'SKOL LATA', NomeProduto: 'SKOL LATA',
  codigoBarras: '789', CodigoBarras: '789', temCodigoBarras: true,
  NCM: '2203', PrecoVenda: 5, estoqueSistema: 10, EstoqueAtual: 10,
  quantidade: 3, productStatus: 'ATUALIZADO',
};
const linha = (over: Partial<LinhaPlanilha> = {}): LinhaPlanilha => ({ linha: 2, nome: 'SKOL LATA', IdProduto: '7', ...over });
const VAZIO = { criar: [], atualizar: [], semMudanca: 0, recusadas: [], ignoradas: 0, possiveisDuplicados: 0 };

describe('chaveDaLinha', () => {
  it('código sem zeros à esquerda, ou nome em minúsculas', () => {
    expect(chaveDaLinha(linha({ IdProduto: '007' }))).toBe('id:7');
    expect(chaveDaLinha({ linha: 2, nome: '  Açaí 500 ML ' })).toBe('nome:açaí 500 ml');
  });
});

describe('planejarImportacao — linhas que não entram', () => {
  it('linha sem nome conta em ignoradas', () => {
    expect(planejarImportacao([], [{ linha: 2 }, { linha: 3, IdProduto: '9', PrecoVenda: null }])).toEqual({ ...VAZIO, ignoradas: 2 });
  });

  it('nome com 300 letras entra, com 301 é recusado', () => {
    const plano = planejarImportacao([], [
      { linha: 2, nome: 'A'.repeat(300) },
      { linha: 3, nome: 'B'.repeat(301) },
    ]);
    expect(plano.criar).toHaveLength(1);
    expect(plano.recusadas).toEqual([{ linha: 3, motivo: 'nome com mais de 300 letras' }]);
  });

  it.each(['abc', '12abc', '0', '000', '1.5', '-7', '1e+21'])('código %s é inválido', (id) => {
    expect(planejarImportacao([], [linha({ IdProduto: id })]).recusadas).toEqual([
      { linha: 2, motivo: 'código do produto inválido' },
    ]);
  });

  it('número inválido leva o nome do campo', () => {
    expect(planejarImportacao([], [linha({ PrecoVenda: null }), linha({ linha: 3, IdProduto: '8', estoqueSistema: null })]).recusadas).toEqual([
      { linha: 2, motivo: 'número inválido em PrecoVenda' },
      { linha: 3, motivo: 'número inválido em EstoqueAtual' },
    ]);
  });

  it('preço ou mínimo negativo recusa; saldo negativo entra', () => {
    const plano = planejarImportacao([], [
      linha({ PrecoCusto: -3 }),
      linha({ linha: 3, IdProduto: '8', EstoqueMinimo: -1 }),
      linha({ linha: 4, IdProduto: '9', estoqueSistema: -3 }),
    ]);
    expect(plano.recusadas).toEqual([
      { linha: 2, motivo: 'preço ou mínimo negativo em PrecoCusto' },
      { linha: 3, motivo: 'preço ou mínimo negativo em EstoqueMinimo' },
    ]);
    expect(plano.criar[0]?.campos).toMatchObject({ estoqueSistema: -3, EstoqueAtual: -3 });
  });

  it('007 e 7 são a mesma chave: vale a primeira linha', () => {
    const plano = planejarImportacao([], [linha({ IdProduto: '7' }), linha({ linha: 3, IdProduto: '007', nome: 'OUTRO' })]);
    expect(plano.criar).toHaveLength(1);
    expect(plano.recusadas).toEqual([{ linha: 3, motivo: 'repetida: vale a linha 2' }]);
  });

  it('nomes iguais com caixa diferente são repetidos', () => {
    const plano = planejarImportacao([], [{ linha: 2, nome: 'Skol' }, { linha: 5, nome: 'SKOL' }]);
    expect(plano.recusadas).toEqual([{ linha: 5, motivo: 'repetida: vale a linha 2' }]);
  });

  it('repetida também vale para quem já existe no banco', () => {
    const plano = planejarImportacao([SKOL], [linha(), linha({ linha: 3, PrecoVenda: 9 })]);
    expect(plano.semMudanca).toBe(1);
    expect(plano.atualizar).toEqual([]);
    expect(plano.recusadas).toEqual([{ linha: 3, motivo: 'repetida: vale a linha 2' }]);
  });

  it('dá um motivo só, na ordem: nome, código, número, negativo, repetida', () => {
    expect(planejarImportacao([], [linha({ nome: 'C'.repeat(301), IdProduto: 'abc', PrecoVenda: null })]).recusadas).toEqual([
      { linha: 2, motivo: 'nome com mais de 300 letras' },
    ]);
    expect(planejarImportacao([], [linha({ IdProduto: 'abc', PrecoVenda: null })]).recusadas[0]?.motivo).toBe('código do produto inválido');
    expect(planejarImportacao([], [linha({ PrecoVenda: null, PrecoCusto: -1 })]).recusadas[0]?.motivo).toBe('número inválido em PrecoVenda');
  });

  it('códigos de 20 dígitos não colidem', () => {
    const plano = planejarImportacao([], [
      linha({ IdProduto: '12345678901234567890' }),
      linha({ linha: 3, IdProduto: '12345678901234567891', nome: 'OUTRO' }),
    ]);
    expect(plano.criar.map((c) => c.chave)).toEqual(['id:12345678901234567890', 'id:12345678901234567891']);
    expect(plano.recusadas).toEqual([]);
  });
});

describe('planejarImportacao — produto novo', () => {
  it('leva os campos presentes e os padrões que a regra exige', () => {
    const plano = planejarImportacao([], [
      { linha: 2, nome: 'PRODUTO TESTE 1', IdProduto: '007', codigoBarras: '7890000010016', PrecoVenda: 9.9, estoqueSistema: 4 },
      { linha: 3, nome: 'GRANEL' },
      { linha: 4, nome: 'SEM BARRAS', codigoBarras: 'INTERNO_123' },
    ]);
    expect(plano.criar).toEqual([
      { linha: 2, chave: 'id:7', campos: {
        nome: 'PRODUTO TESTE 1', NomeProduto: 'PRODUTO TESTE 1',
        codigoBarras: '7890000010016', CodigoBarras: '7890000010016', temCodigoBarras: true,
        IdProduto: '007', PrecoVenda: 9.9, quantidade: 0, estoqueSistema: 4, EstoqueAtual: 4,
      } },
      { linha: 3, chave: 'nome:granel', campos: {
        nome: 'GRANEL', NomeProduto: 'GRANEL', codigoBarras: '', CodigoBarras: '', temCodigoBarras: false,
        quantidade: 0, estoqueSistema: 0, EstoqueAtual: 0,
      } },
      { linha: 4, chave: 'nome:sem barras', campos: {
        nome: 'SEM BARRAS', NomeProduto: 'SEM BARRAS', codigoBarras: 'INTERNO_123', CodigoBarras: 'INTERNO_123', temCodigoBarras: false,
        quantidade: 0, estoqueSistema: 0, EstoqueAtual: 0,
      } },
    ]);
  });
});

describe('planejarImportacao — produto que existe', () => {
  // O defeito D1: célula vazia apagava código de barras e zerava preço.
  it('vazio não mexe: sem diferença, nenhuma escrita', () => {
    expect(planejarImportacao([SKOL], [linha()])).toEqual({ ...VAZIO, semMudanca: 1 });
  });

  it('grava só o que mudou, e nunca a quantidade contada', () => {
    const plano = planejarImportacao([SKOL], [linha({ nome: 'SKOL LATA 350', PrecoVenda: 6, NCM: '2203' })]);
    expect(plano.atualizar).toEqual([
      { linha: 2, id: 'p1', campos: { nome: 'SKOL LATA 350', NomeProduto: 'SKOL LATA 350', PrecoVenda: 6 } },
    ]);
  });

  it('saldo e código de barras gravam as duas grafias', () => {
    expect(planejarImportacao([SKOL], [linha({ estoqueSistema: 12 })]).atualizar[0]?.campos).toEqual({ estoqueSistema: 12, EstoqueAtual: 12 });
    expect(planejarImportacao([SKOL], [linha({ codigoBarras: '790' })]).atualizar[0]?.campos).toEqual({
      codigoBarras: '790', CodigoBarras: '790', temCodigoBarras: true,
    });
  });

  it('casa com zeros à esquerda e não regrava o código igual', () => {
    expect(planejarImportacao([{ ...SKOL, IdProduto: '007' }], [linha({ IdProduto: '7' })]).semMudanca).toBe(1);
    expect(planejarImportacao([{ ...SKOL, IdProduto: 7 }], [linha({ IdProduto: '007' })]).semMudanca).toBe(1);
  });

  it('acha o código nas três grafias e passa a gravar IdProduto', () => {
    const { IdProduto: _fora, ...semId } = SKOL;
    expect(planejarImportacao([{ ...semId, idProdut: 7 }], [linha()]).atualizar).toEqual([
      { linha: 2, id: 'p1', campos: { IdProduto: '7' } },
    ]);
    expect(planejarImportacao([{ ...semId, idProduto: '7' }], [linha()]).atualizar[0]?.id).toBe('p1');
  });

  it('linha sem código casa pelo nome em minúsculas', () => {
    const semId: ProdutoDoBanco = { id: 'p2', nome: 'Granel', codigoBarras: '', quantidade: 0 };
    expect(planejarImportacao([semId], [{ linha: 2, nome: 'Granel' }]).semMudanca).toBe(1);
    expect(planejarImportacao([semId], [{ linha: 2, nome: 'GRANEL' }]).atualizar).toEqual([
      { linha: 2, id: 'p2', campos: { nome: 'GRANEL', NomeProduto: 'GRANEL' } },
    ]);
  });

  it('duplicata no banco: o primeiro vence', () => {
    const plano = planejarImportacao([SKOL, { ...SKOL, id: 'p9' }], [linha({ NCM: '1' })]);
    expect(plano.atualizar.map((a) => a.id)).toEqual(['p1']);
  });

  it('legado sem quantidade: entra com o estoqueFisico, só junto de outra mudança', () => {
    const legado: ProdutoDoBanco = { id: 'p3', nome: 'ANTIGO', codigoBarras: '', estoqueFisico: 4 };
    expect(planejarImportacao([legado], [{ linha: 2, nome: 'ANTIGO' }]).semMudanca).toBe(1);
    expect(planejarImportacao([legado], [{ linha: 2, nome: 'ANTIGO', NCM: '1' }]).atualizar[0]?.campos).toEqual({ NCM: '1', quantidade: 4 });
    const { estoqueFisico: _fora, ...semFisico } = legado;
    expect(planejarImportacao([semFisico], [{ linha: 2, nome: 'ANTIGO', NCM: '1' }]).atualizar[0]?.campos).toEqual({ NCM: '1', quantidade: 0 });
  });

  // Um documento assim faz a regra negar o lote de 500 inteiro.
  it('produto do banco com campo inválido vira recusada', () => {
    const plano = planejarImportacao([{ ...SKOL, corrigidoIncorreto: null }], [linha({ NCM: '1' })]);
    expect(plano.atualizar).toEqual([]);
    expect(plano.recusadas).toEqual([{ linha: 2, motivo: 'produto do banco com campo inválido: corrigidoIncorreto' }]);
  });

  it('carimbos velhos inválidos não recusam: a gravação regrava os três', () => {
    const plano = planejarImportacao([{ ...SKOL, lastModified: 'ontem', lastImportDate: null, modifiedBy: 7 }], [linha({ NCM: '1' })]);
    expect(plano.atualizar).toHaveLength(1);
  });
});

describe('planejarImportacao — possíveis duplicados', () => {
  it('conta linha com código e produto sem código de mesmo nome, e o inverso; não junta', () => {
    const semId: ProdutoDoBanco = { id: 'p2', nome: 'Granel', codigoBarras: '', quantidade: 0 };
    const a = planejarImportacao([semId], [{ linha: 2, nome: 'GRANEL', IdProduto: '50' }]);
    expect(a.criar).toHaveLength(1);
    expect(a.possiveisDuplicados).toBe(1);
    const b = planejarImportacao([SKOL], [{ linha: 2, nome: 'skol lata' }]);
    expect(b.criar).toHaveLength(1);
    expect(b.possiveisDuplicados).toBe(1);
  });
});

describe('planejarImportacao — repetir', () => {
  it('reimportar o mesmo arquivo depois de gravar dá tudo sem mudança', () => {
    const linhas: LinhaPlanilha[] = [
      linha({ PrecoVenda: 6, estoqueSistema: 12 }),
      { linha: 3, nome: 'NOVO', IdProduto: '8', codigoBarras: '111', PrecoCusto: 1 },
      { linha: 4, nome: 'GRANEL' },
    ];
    const primeiro = planejarImportacao([SKOL], linhas);
    const banco: ProdutoDoBanco[] = [
      { ...SKOL, ...primeiro.atualizar[0]!.campos },
      ...primeiro.criar.map((c, i) => ({ id: `n${i}`, ...c.campos })),
    ];
    expect(planejarImportacao(banco, linhas)).toEqual({ ...VAZIO, semMudanca: 3 });
  });
});
