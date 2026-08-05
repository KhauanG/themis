/**
 * Linha de relatório — formato único para exportar contagem ao vivo e auditoria salva.
 *
 * Sem isto, cada exportação precisava saber de onde vinha o dado (produto do Firestore ou
 * snapshot gravado dentro da auditoria) e era fácil exportar a contagem atual achando que
 * estava exportando a auditoria antiga selecionada na tela.
 */
import type { Produto, ProdutoSnapshot, StatusAuditoria } from './types.js';
import { diferencaDe, statusDe } from './auditoria.js';
import { fisicoDe, isItemContado, nomeDe, sistemaDe, validadeDe } from './produto.js';

export interface LinhaRelatorio {
  id: string;
  nome: string;
  sistema: number;
  /** `null` quando o item não foi contado — diferente de zero, que é contagem válida. */
  contado: number | null;
  diferenca: number | '-';
  status: StatusAuditoria;
  validade: string | null;
}

export function linhasDeProdutos(produtos: readonly Produto[]): LinhaRelatorio[] {
  return produtos.map((p) => ({
    id: p.id,
    nome: nomeDe(p),
    sistema: sistemaDe(p),
    contado: isItemContado(p) ? fisicoDe(p) : null,
    diferenca: diferencaDe(p),
    status: statusDe(p),
    validade: validadeDe(p),
  }));
}

export function linhasDeSnapshot(snapshot: readonly ProdutoSnapshot[]): LinhaRelatorio[] {
  return snapshot.map((s) => ({
    id: s.id,
    nome: s.nome,
    sistema: s.estoqueSistema,
    contado: s.status === 'NÃO CONTADO' ? null : s.estoqueFisico,
    diferenca: s.diferenca,
    status: s.status,
    validade: s.dataValidade,
  }));
}

export function ordenarPorNome(linhas: readonly LinhaRelatorio[]): LinhaRelatorio[] {
  return [...linhas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
