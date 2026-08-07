import { describe, expect, it } from 'vitest';
import {
  FILTRO_PADRAO,
  descreverFiltro,
  direcaoDaColuna,
  filtrarLinhas,
  filtroEstaAtivo,
  ordemAoClicar,
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

/**
 * Ordenação pelo clique no cabeçalho.
 *
 * O ponto delicado é o valor ausente: `sistema` é `'-'` em produto fora do ERP e `contado`
 * é `null` em item não contado. Ordenar crescente e receber 400 traços antes do primeiro
 * número esconde exatamente o dado que se foi buscar.
 */
describe('ordenação por coluna', () => {
  const linhas: LinhaRelatorio[] = [
    linha({ id: 'a', nome: 'Antarctica', sistema: 5, contado: 9, diferenca: 4, status: 'ERRADO' }),
    linha({ id: 'b', nome: 'Brahma', sistema: 50, contado: 20, diferenca: -30, status: 'CRITICO' }),
    linha({ id: 'c', nome: 'Corona', sistema: 1, contado: 1, diferenca: 0, status: 'CORRETO' }),
  ];

  const ordenar = (ordem: FiltroRelatorio['ordem'], lista = linhas) =>
    filtrarLinhas(lista, { ...FILTRO_PADRAO, ordem }).map((l) => l.id);

  it('nome nos dois sentidos', () => {
    expect(ordenar('nome')).toEqual(['a', 'b', 'c']);
    expect(ordenar('nome-desc')).toEqual(['c', 'b', 'a']);
  });

  it('sistema nos dois sentidos', () => {
    expect(ordenar('maior-sistema')).toEqual(['b', 'a', 'c']);
    expect(ordenar('menor-sistema')).toEqual(['c', 'a', 'b']);
  });

  it('contado nos dois sentidos', () => {
    expect(ordenar('maior-contado')).toEqual(['b', 'a', 'c']);
    expect(ordenar('menor-contado')).toEqual(['c', 'a', 'b']);
  });

  it('gravidade nos dois sentidos', () => {
    expect(ordenar('status')).toEqual(['b', 'a', 'c']);
    expect(ordenar('status-desc')).toEqual(['c', 'a', 'b']);
  });

  // A regra que importa: ausente vai para o fim SEMPRE, nos dois sentidos.
  it('sistema ausente fica por último em qualquer direção', () => {
    const com = [...linhas, linha({ id: 'z', nome: 'Zz', sistema: '-', contado: null })];
    expect(ordenar('maior-sistema', com).at(-1)).toBe('z');
    expect(ordenar('menor-sistema', com).at(-1)).toBe('z');
  });

  it('contagem ausente fica por último em qualquer direção', () => {
    const com = [...linhas, linha({ id: 'z', nome: 'Aa', contado: null })];
    expect(ordenar('maior-contado', com).at(-1)).toBe('z');
    expect(ordenar('menor-contado', com).at(-1)).toBe('z');
  });

  // Sem desempate, duas linhas com o mesmo número trocam de lugar entre renderizações.
  it('empate desempata por nome', () => {
    const iguais = [
      linha({ id: 'z', nome: 'Zebra', sistema: 7 }),
      linha({ id: 'a', nome: 'Abelha', sistema: 7 }),
    ];
    expect(ordenar('maior-sistema', iguais)).toEqual(['a', 'z']);
    expect(ordenar('menor-sistema', iguais)).toEqual(['a', 'z']);
  });

  it('não muta a lista recebida', () => {
    const original = [...linhas];
    ordenar('maior-sistema');
    expect(linhas).toEqual(original);
  });
});

describe('ordemAoClicar e direcaoDaColuna', () => {
  it('primeiro clique aplica a ordem principal da coluna', () => {
    expect(ordemAoClicar('sistema', 'nome')).toBe('maior-sistema');
    expect(ordemAoClicar('diferenca', 'nome')).toBe('maior-diferenca');
  });

  it('clicar de novo na mesma coluna inverte', () => {
    expect(ordemAoClicar('sistema', 'maior-sistema')).toBe('menor-sistema');
  });

  // Herdar a direção da coluna anterior surpreende: o usuário clica em "Contado" esperando
  // "maior primeiro" e recebe "menor" porque a coluna de antes estava invertida.
  it('clicar em outra coluna recomeça pela principal', () => {
    expect(ordemAoClicar('contado', 'menor-sistema')).toBe('maior-contado');
  });

  it('terceiro clique volta ao início do par', () => {
    expect(ordemAoClicar('sistema', 'menor-sistema')).toBe('maior-sistema');
  });

  it('nome começa em A–Z; coluna numérica começa em maior', () => {
    expect(direcaoDaColuna('nome', 'nome')).toBe('ascending');
    expect(direcaoDaColuna('nome', 'nome-desc')).toBe('descending');
    expect(direcaoDaColuna('sistema', 'maior-sistema')).toBe('descending');
    expect(direcaoDaColuna('sistema', 'menor-sistema')).toBe('ascending');
  });

  it('coluna que não está ordenando não tem direção', () => {
    expect(direcaoDaColuna('sistema', 'nome')).toBeNull();
    expect(direcaoDaColuna('status', 'maior-diferenca')).toBeNull();
  });
});
