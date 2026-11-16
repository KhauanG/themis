import { describe, expect, it } from 'vitest';
import {
  avisoDeDuplicados,
  detalhesDaImportacao,
  deveRegistrarImportacao,
  linhasComNome,
  mensagemDaImportacao,
  resumoDoPlano,
} from './importacao-textos.js';
import type { PlanoImportacao } from './planejar-importacao.js';

const campos = { nome: 'X' };
const plano: PlanoImportacao = {
  criar: [{ linha: 2, chave: 'id:1', campos }, { linha: 3, chave: 'id:2', campos }],
  atualizar: [{ linha: 4, id: 'p1', campos }],
  semMudanca: 5,
  recusadas: [{ linha: 6, motivo: 'código do produto inválido' }],
  ignoradas: 3,
  possiveisDuplicados: 0,
};

describe('textos da prévia', () => {
  it('resumo', () => {
    expect(resumoDoPlano(plano)).toBe('2 novos · 1 atualizados · 5 sem mudança · 1 recusadas · 3 linhas sem nome');
    expect(linhasComNome(plano)).toBe(9);
  });

  it('aviso de duplicados só quando há', () => {
    expect(avisoDeDuplicados(plano)).toBeNull();
    expect(avisoDeDuplicados({ ...plano, possiveisDuplicados: 4 })).toBe(
      '4 possíveis duplicados (mesmo nome, um deles sem código do produto)',
    );
  });
});

describe('mensagemDaImportacao', () => {
  it('sucesso', () => {
    expect(mensagemDaImportacao(plano, { criados: 2, atualizados: 1, parou: null })).toEqual({
      texto: 'Importação concluída: 2 novos, 1 atualizados, 5 sem mudança, 1 recusadas.',
      tipo: 'success',
    });
  });

  it('teto: diz quanto gravou e manda repetir', () => {
    expect(mensagemDaImportacao(plano, { criados: 0, atualizados: 1, parou: 'teto' })).toEqual({
      texto: 'Gravou 1 de 3. Importe o mesmo arquivo de novo para terminar.',
      tipo: 'warning',
    });
  });

  // A importação não tem texto próprio na tabela do desenho 5.2: vale o geral.
  it('recusa da regra', () => {
    expect(mensagemDaImportacao(plano, { criados: 0, atualizados: 0, parou: 'recusa' })).toEqual({
      texto: 'Não foi possível importar. Gravou 0 de 3. Sem permissão para esta ação.',
      tipo: 'error',
    });
  });

  it('outro erro', () => {
    expect(mensagemDaImportacao(plano, { criados: 1, atualizados: 1, parou: 'erro' })).toEqual({
      texto: 'Não foi possível importar. Gravou 2 de 3. Não foi possível salvar. Tente de novo.',
      tipo: 'error',
    });
  });
});

describe('detalhesDaImportacao', () => {
  it('leva as 8 chaves do desenho, com os números confirmados', () => {
    expect(detalhesDaImportacao('produtos.xlsx', plano, { criados: 1, atualizados: 1, parou: 'teto' })).toEqual({
      arquivo: 'produtos.xlsx', linhas: 9, criados: 1, atualizados: 1,
      semMudanca: 5, recusadas: 1, ignoradas: 3, parcial: true,
    });
    expect(detalhesDaImportacao('a.xlsx', plano, { criados: 2, atualizados: 1, parou: null })['parcial']).toBe(false);
  });
});

// Desenho 5.2: nenhuma tela registra histórico antes de o servidor aceitar.
describe('deveRegistrarImportacao', () => {
  it('registra quando algo foi confirmado, com ou sem parada', () => {
    expect(deveRegistrarImportacao({ criados: 2, atualizados: 1, parou: null })).toBe(true);
    expect(deveRegistrarImportacao({ criados: 0, atualizados: 500, parou: 'erro' })).toBe(true);
    expect(deveRegistrarImportacao({ criados: 1, atualizados: 0, parou: 'recusa' })).toBe(true);
  });

  it('teto com zero confirmado registra: o lote está na fila e pode subir', () => {
    expect(deveRegistrarImportacao({ criados: 0, atualizados: 0, parou: 'teto' })).toBe(true);
  });

  it('recusa, erro ou plano vazio com zero confirmado não registra', () => {
    expect(deveRegistrarImportacao({ criados: 0, atualizados: 0, parou: 'recusa' })).toBe(false);
    expect(deveRegistrarImportacao({ criados: 0, atualizados: 0, parou: 'erro' })).toBe(false);
    expect(deveRegistrarImportacao({ criados: 0, atualizados: 0, parou: null })).toBe(false);
  });
});
