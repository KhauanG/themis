import { describe, expect, it } from 'vitest';
import { COR_ACAO, ROTULO_ACAO, descreverEvento } from './historico-descricao.js';
import type { AcaoHistorico } from './types.js';

describe('descreverEvento — contagem', () => {
  /**
   * O caso que motivou o módulo: antes o histórico mostrava `de: 12 · para: 15`, que não
   * responde "o que mudou".
   */
  it('mostra o produto e a quantidade de → para', () => {
    const r = descreverEvento('MODIFICAR_PRODUTO', {
      produto: 'Skol Lata 350ml',
      de: 12,
      para: 15,
      ciclo: 3,
    });

    expect(r.alvo).toBe('Skol Lata 350ml');
    expect(r.mudancas).toContainEqual({ campo: 'Quantidade', de: '12', para: '15' });
    expect(r.fatos).toContain('Ciclo 3');
  });

  it('primeira contagem mostra traço na origem', () => {
    const r = descreverEvento('MODIFICAR_PRODUTO', { produto: 'Brahma', de: null, para: 8 });
    expect(r.mudancas).toContainEqual({ campo: 'Quantidade', de: '—', para: '8' });
  });

  it('quantidade zero não vira traço — é contagem válida', () => {
    const r = descreverEvento('MODIFICAR_PRODUTO', { produto: 'Corona', de: 5, para: 0 });
    expect(r.mudancas).toContainEqual({ campo: 'Quantidade', de: '5', para: '0' });
  });

  it('validade sai em formato brasileiro', () => {
    const r = descreverEvento('MODIFICAR_PRODUTO', {
      produto: 'Heineken',
      validadeDe: null,
      validadePara: '2026-09-01',
    });
    expect(r.mudancas).toContainEqual({ campo: 'Validade', de: '—', para: '01/09/2026' });
  });

  it('não lista campo que não mudou', () => {
    const r = descreverEvento('MODIFICAR_PRODUTO', {
      produto: 'Itaipava',
      de: 10,
      para: 10,
      validadeDe: '2026-01-01',
      validadePara: '2026-01-01',
    });
    expect(r.mudancas).toHaveLength(0);
  });
});

describe('descreverEvento — cadastro', () => {
  it('edição lista só os campos alterados', () => {
    const r = descreverEvento('EDITAR_PRODUTO', {
      produto: 'Skol',
      nomeDe: 'Skol',
      nomePara: 'Skol Lata 350ml',
      sistemaDe: 100,
      sistemaPara: 100,
      idErpDe: null,
      idErpPara: '9912',
    });

    expect(r.mudancas.map((m) => m.campo)).toEqual(['Nome', 'Código no ERP']);
    expect(r.mudancas[1]).toEqual({ campo: 'Código no ERP', de: '—', para: '9912' });
  });

  it('exclusão avisa quando o item já estava contado', () => {
    const r = descreverEvento('EXCLUIR_PRODUTO', { produto: 'Corona', tinhaContagem: true });
    expect(r.alvo).toBe('Corona');
    expect(r.fatos).toContain('O item já estava contado neste ciclo');
  });
});

describe('descreverEvento — conferência', () => {
  it('distingue divergência confirmada de descartada', () => {
    const confirmada = descreverEvento('CONFERIR_ITEM', {
      produto: 'Brahma',
      divergenciaConfirmada: true,
    });
    expect(confirmada.fatos[0]).toContain('confirmada');

    const descartada = descreverEvento('CONFERIR_ITEM', {
      produto: 'Brahma',
      divergenciaConfirmada: false,
    });
    expect(descartada.fatos[0]).toContain('não se confirmou');
  });

  it('desfazer tem texto próprio', () => {
    const r = descreverEvento('CONFERIR_ITEM', { produto: 'Brahma', desfeito: true });
    expect(r.fatos[0]).toContain('desfeita');
  });
});

describe('descreverEvento — operações em massa', () => {
  it('limpar contagem diz o que foi apagado', () => {
    const r = descreverEvento('LIMPAR_CONTAGEM', { total: 1843, ciclo: 4 });
    expect(r.fatos).toContain('1843 produtos zerados');
    expect(r.fatos).toContain('Quantidade, status e validade apagados');
  });

  it('importação omite ignoradas quando não houve', () => {
    const r = descreverEvento('IMPORTAR_PLANILHA', { criados: 150, ignoradas: 0 });
    expect(r.fatos).toEqual(['150 produtos importados']);
  });

  it('buscar estoque diferencia nenhum saldo alterado', () => {
    const r = descreverEvento('BUSCAR_ESTOQUE', { recebidosDoErp: 900, atualizados: 0 });
    expect(r.fatos).toContain('Nenhum saldo mudou');
  });

  it('corrigir estoque relata o ciclo completo', () => {
    const r = descreverEvento('CORRIGIR_ESTOQUE', {
      conferidos: 40,
      divergentes: 12,
      enviadosAoErp: 12,
      confirmadosNoErp: 10,
      pendentesNoErp: 2,
      falhasNoEnvio: 0,
    });
    expect(r.fatos).toContain('40 itens conferidos');
    expect(r.fatos).toContain('2 não refletiram no ERP');
    // Zero falhas não vira linha: ausência de problema não é informação.
    expect(r.fatos.some((f) => f.includes('recusados'))).toBe(false);
  });

  it('exportação informa o recorte', () => {
    const r = descreverEvento('EXPORTAR_PLANILHA', { tipo: 'contagem', itens: 40, de: 2000 });
    expect(r.fatos).toContain('PDF da contagem');
    expect(r.fatos).toContain('40 de 2000 itens');
  });
});

describe('descreverEvento — singular e plural', () => {
  it('respeita o singular', () => {
    expect(descreverEvento('IMPORTAR_PLANILHA', { criados: 1 }).fatos).toEqual([
      '1 produto importado',
    ]);
  });
});

/**
 * Entradas gravadas pelo 1.x podem trazer chaves que o 2.0 não conhece. Esconder seria
 * pior que mostrar cru: registro parcial ainda é registro.
 */
describe('descreverEvento — ação desconhecida', () => {
  it('mostra os pares crus em vez de sumir com eles', () => {
    const r = descreverEvento('LIMPAR_ESTOQUE', { productsUpdated: 12, errors: 0 });
    expect(r.fatos).toEqual(['productsUpdated: 12', 'errors: 0']);
  });

  it('ignora objetos aninhados', () => {
    const r = descreverEvento('LIMPAR_ESTOQUE', { ok: 1, detalhe: { a: 1 } });
    expect(r.fatos).toEqual(['ok: 1']);
  });

  it('não quebra sem detalhes', () => {
    expect(descreverEvento('LOGIN')).toEqual({ mudancas: [], fatos: [] });
  });
});

describe('tabelas de rótulo e cor', () => {
  const acoes = Object.keys(ROTULO_ACAO) as AcaoHistorico[];

  it('toda ação tem rótulo e cor', () => {
    for (const a of acoes) {
      expect(ROTULO_ACAO[a], a).toBeTruthy();
      expect(COR_ACAO[a], a).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('ações destrutivas são vermelhas', () => {
    for (const a of ['LIMPAR_CONTAGEM', 'EXCLUIR_ESTOQUE', 'EXCLUIR_PRODUTO'] as AcaoHistorico[]) {
      expect(COR_ACAO[a], a).toBe('#b3261e');
    }
  });
});
