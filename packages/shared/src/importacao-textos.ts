// Textos e histórico da importação de planilha (Etapa 4). Ficam no shared para o site e o app dizerem a mesma frase.
import { TEXTO_FALHA, TEXTO_SEM_PERMISSAO } from './gestao.js';
import type { PlanoImportacao } from './planejar-importacao.js';

/** O que a gravação conseguiu. `criados` e `atualizados` são só os confirmados pelo servidor. */
export interface ResultadoDaImportacao {
  criados: number;
  atualizados: number;
  parou: null | 'teto' | 'recusa' | 'erro';
}

/** Linhas com nome: novas, atualizadas, sem mudança e recusadas. */
export function linhasComNome(plano: PlanoImportacao): number {
  return plano.criar.length + plano.atualizar.length + plano.semMudanca + plano.recusadas.length;
}

export function resumoDoPlano(plano: PlanoImportacao): string {
  return [
    `${plano.criar.length} novos`,
    `${plano.atualizar.length} atualizados`,
    `${plano.semMudanca} sem mudança`,
    `${plano.recusadas.length} recusadas`,
    `${plano.ignoradas} linhas sem nome`,
  ].join(' · ');
}

export function avisoDeDuplicados(plano: PlanoImportacao): string | null {
  return plano.possiveisDuplicados > 0
    ? `${plano.possiveisDuplicados} possíveis duplicados (mesmo nome, um deles sem código do produto)`
    : null;
}

export function mensagemDaImportacao(
  plano: PlanoImportacao,
  resultado: ResultadoDaImportacao,
): { texto: string; tipo: 'success' | 'warning' | 'error' } {
  const gravou = `Gravou ${resultado.criados + resultado.atualizados} de ${plano.criar.length + plano.atualizar.length}.`;
  switch (resultado.parou) {
    case null:
      return {
        texto: `Importação concluída: ${resultado.criados} novos, ${resultado.atualizados} atualizados, ${plano.semMudanca} sem mudança, ${plano.recusadas.length} recusadas.`,
        tipo: 'success',
      };
    case 'teto':
      return { texto: `${gravou} Importe o mesmo arquivo de novo para terminar.`, tipo: 'warning' };
    case 'recusa':
      return { texto: `Não foi possível importar. ${gravou} ${TEXTO_SEM_PERMISSAO}`, tipo: 'error' };
    case 'erro':
      return { texto: `Não foi possível importar. ${gravou} ${TEXTO_FALHA}`, tipo: 'error' };
  }
}

/** `details` do evento IMPORTAR_PLANILHA (desenho 5.3): só números e o nome do arquivo, nunca lista de produtos. */
export function detalhesDaImportacao(
  arquivo: string,
  plano: PlanoImportacao,
  resultado: ResultadoDaImportacao,
): Record<string, unknown> {
  return {
    arquivo,
    linhas: linhasComNome(plano),
    criados: resultado.criados,
    atualizados: resultado.atualizados,
    semMudanca: plano.semMudanca,
    recusadas: plano.recusadas.length,
    ignoradas: plano.ignoradas,
    parcial: resultado.parou !== null,
  };
}

/** Só registra o que o servidor aceitou, ou o lote que ficou na fila (teto). Desenho 5.2 e 5.3. */
export function deveRegistrarImportacao(resultado: ResultadoDaImportacao): boolean {
  return resultado.criados + resultado.atualizados > 0 || resultado.parou === 'teto';
}
