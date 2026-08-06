import { describe, expect, it } from 'vitest';
import {
  FILTRO_PADRAO,
  descreverFiltro,
  filtrarLinhas,
  filtroEstaAtivo,
  type FiltroRelatorio,
  type LinhaRelatorio,
} from './relatorio.js';

function linha(over: Partial<LinhaRelatorio> & { id: string }): LinhaRelatorio {
  return {
    nome: 'Produto',
    sistema: 10,
    contado: 10,
    diferenca: 0,
    status: 'CORRETO',
    validade: null,
    ...over,
  };
}

const linhas: LinhaRelatorio[] = [
  linha({ id: 'correto', nome: 'Brahma', diferenca: 0, status: 'CORRETO' }),
  linha({ id: 'errado', nome: 'Antarctica', contado: 13, diferenca: 3, status: 'ERRADO' }),
  linha({ id: 'critico', nome: 'Corona', contado: 40, diferenca: 30, status: 'CRITICO' }),
  linha({ id: 'critico2', nome: 'Devassa', contado: 0, diferenca: -15, status: 'CRITICO' }),
  linha({ id: 'sem', nome: 'Eisenbahn', contado: null, diferenca: '-', status: 'NÃO CONTADO' }),
];

const com = (over: Partial<FiltroRelatorio>): FiltroRelatorio => ({ ...FILTRO_PADRAO, ...over });

describe('filtrarLinhas — situação', () => {
  it('todos devolve tudo', () => {
    expect(filtrarLinhas(linhas, FILTRO_PADRAO)).toHaveLength(5);
  });

  /**
   * Motivo do recurso: um PDF com 1900 linhas de "NÃO CONTADO" enterra as 40 que
   * precisam de ação.
   */
  it('contados tira os não contados', () => {
    const r = filtrarLinhas(linhas, com({ situacao: 'contados' }));
    expect(r.map((l) => l.id)).not.toContain('sem');
    expect(r).toHaveLength(4);
  });

  it('nao-contados deixa só quem falta contar', () => {
    expect(filtrarLinhas(linhas, com({ situacao: 'nao-contados' })).map((l) => l.id)).toEqual(['sem']);
  });
});

describe('filtrarLinhas — divergências', () => {
  it('somenteDivergentes tira corretos e não contados', () => {
    const r = filtrarLinhas(linhas, com({ somenteDivergentes: true }));
    expect(r.map((l) => l.id).sort()).toEqual(['critico', 'critico2', 'errado']);
  });

  it('somenteDivergentes vence a situação', () => {
    // Pedir "todos" e "só divergências" ao mesmo tempo não pode trazer os corretos.
    const r = filtrarLinhas(linhas, com({ situacao: 'todos', somenteDivergentes: true }));
    expect(r.map((l) => l.id)).not.toContain('correto');
  });
});

describe('filtrarLinhas — status', () => {
  it('filtra por um status específico', () => {
    expect(filtrarLinhas(linhas, com({ status: 'CRITICO' })).map((l) => l.id).sort()).toEqual([
      'critico',
      'critico2',
    ]);
  });

  it('combina status com situação', () => {
    expect(filtrarLinhas(linhas, com({ status: 'CRITICO', situacao: 'nao-contados' }))).toHaveLength(0);
  });
});

describe('filtrarLinhas — ordem', () => {
  it('nome usa ordenação portuguesa', () => {
    expect(filtrarLinhas(linhas, com({ ordem: 'nome' })).map((l) => l.nome)).toEqual([
      'Antarctica',
      'Brahma',
      'Corona',
      'Devassa',
      'Eisenbahn',
    ]);
  });

  // Ordena pelo MÓDULO: uma falta de 30 é tão grave quanto uma sobra de 30.
  it('maior diferença usa o valor absoluto', () => {
    expect(filtrarLinhas(linhas, com({ ordem: 'maior-diferenca' })).map((l) => l.id)).toEqual([
      'critico',
      'critico2',
      'errado',
      'correto',
      'sem',
    ]);
  });

  it('menor diferença começa pelo não contado, que não tem diferença', () => {
    expect(filtrarLinhas(linhas, com({ ordem: 'menor-diferenca' }))[0]?.id).toBe('sem');
  });

  it('gravidade traz o que precisa de ação primeiro', () => {
    expect(filtrarLinhas(linhas, com({ ordem: 'status' })).map((l) => l.status)).toEqual([
      'CRITICO',
      'CRITICO',
      'ERRADO',
      'NÃO CONTADO',
      'CORRETO',
    ]);
  });

  it('empate na ordenação cai para o nome', () => {
    const r = filtrarLinhas(linhas, com({ ordem: 'status' }));
    expect([r[0]?.nome, r[1]?.nome]).toEqual(['Corona', 'Devassa']);
  });

  it('não muta a lista recebida', () => {
    const copia = [...linhas];
    filtrarLinhas(linhas, com({ ordem: 'maior-diferenca' }));
    expect(linhas).toEqual(copia);
  });
});

/**
 * O PDF imprime esta frase. Sem ela, quem recebe um relatório filtrado não tem como saber
 * que ele é parcial, e conclui que o estoque tem 40 itens quando tem 2000.
 */
describe('descreverFiltro', () => {
  it('descreve o recorte padrão', () => {
    expect(descreverFiltro(FILTRO_PADRAO)).toBe('Todos os itens');
  });

  it('descreve situação', () => {
    expect(descreverFiltro(com({ situacao: 'contados' }))).toBe('Somente contados');
  });

  it('divergências vence a situação na descrição', () => {
    expect(descreverFiltro(com({ situacao: 'contados', somenteDivergentes: true }))).toBe(
      'Somente divergências',
    );
  });

  it('junta situação e status', () => {
    expect(descreverFiltro(com({ situacao: 'contados', status: 'CRITICO' }))).toBe(
      'Somente contados · Status CRITICO',
    );
  });
});

describe('filtroEstaAtivo', () => {
  it('padrão não esconde nada', () => {
    expect(filtroEstaAtivo(FILTRO_PADRAO)).toBe(false);
  });

  it('ordem sozinha não é recorte', () => {
    // Reordenar não esconde item nenhum; o PDF não precisa avisar.
    expect(filtroEstaAtivo(com({ ordem: 'maior-diferenca' }))).toBe(false);
  });

  it('qualquer recorte de conteúdo conta', () => {
    expect(filtroEstaAtivo(com({ situacao: 'contados' }))).toBe(true);
    expect(filtroEstaAtivo(com({ status: 'ERRADO' }))).toBe(true);
    expect(filtroEstaAtivo(com({ somenteDivergentes: true }))).toBe(true);
  });
});
