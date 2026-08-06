import { describe, expect, it } from 'vitest';
import type { Produto } from '@themis/shared';
import { REMOVER, aplicarPendentes, type AlteracaoPendente } from './fila-offline.js';

function produto(over: Partial<Produto> & { id: string }): Produto {
  return { nome: 'Skol', quantidade: 0, codigoBarras: '789', ...over };
}

function pendente(over: Partial<AlteracaoPendente> & { produtoId: string }): AlteracaoPendente {
  return {
    id: 'f1',
    tipo: 'update',
    inventoryId: 'e1',
    dados: {},
    enfileiradoEm: 1_700_000_000_000,
    ...over,
  };
}

const lista: Produto[] = [
  produto({ id: 'a', nome: 'Antarctica' }),
  produto({ id: 'b', nome: 'Brahma' }),
];

describe('aplicarPendentes', () => {
  it('devolve a lista intocada quando não há fila', () => {
    expect(aplicarPendentes(lista, [], 'e1')).toBe(lista);
  });

  /**
   * O bug que motivou isto: offline, `atualizarProduto` só enfileira e não escreve no
   * Firestore. Sem a sobreposição, o produto contado continuava aparecendo como não
   * contado, e o usuário recontava.
   */
  it('mostra como contado o produto alterado offline', () => {
    const fila = [
      pendente({
        produtoId: 'a',
        dados: { quantidade: 42, productStatus: 'ATUALIZADO' },
      }),
    ];

    const r = aplicarPendentes(lista, fila, 'e1');
    expect(r[0]).toMatchObject({ id: 'a', quantidade: 42, productStatus: 'ATUALIZADO' });
  });

  it('não encosta nos produtos sem pendência', () => {
    const fila = [pendente({ produtoId: 'a', dados: { quantidade: 42 } })];
    const r = aplicarPendentes(lista, fila, 'e1');
    expect(r[1]).toBe(lista[1]);
  });

  it('não muta a lista original', () => {
    const copia = structuredClone(lista);
    aplicarPendentes(lista, [pendente({ produtoId: 'a', dados: { quantidade: 42 } })], 'e1');
    expect(lista).toEqual(copia);
  });

  // O marcador existe porque `deleteField()` não sobrevive ao JSON da fila.
  it('remove o campo marcado com REMOVER', () => {
    const comValidade = [produto({ id: 'a', dataValidade: '2026-12-01' })];
    const fila = [pendente({ produtoId: 'a', dados: { dataValidade: REMOVER } })];

    const r = aplicarPendentes(comValidade, fila, 'e1');
    expect(r[0]).not.toHaveProperty('dataValidade');
  });

  it('ignora pendência de outro estoque', () => {
    const fila = [pendente({ produtoId: 'a', inventoryId: 'OUTRO', dados: { quantidade: 99 } })];
    expect(aplicarPendentes(lista, fila, 'e1')[0]?.quantidade).toBe(0);
  });

  it('ignora pendência de exclusão', () => {
    const fila = [pendente({ produtoId: 'a', tipo: 'delete', dados: { quantidade: 99 } })];
    expect(aplicarPendentes(lista, fila, 'e1')[0]?.quantidade).toBe(0);
  });

  // A aba "Contados" ordena por lastModified. Sem isso o item contado offline
  // apareceria no fim da lista, longe de onde o usuário acabou de trabalhar.
  it('usa a hora da edição como lastModified', () => {
    const fila = [pendente({ produtoId: 'a', dados: { quantidade: 5 }, enfileiradoEm: 12345 })];
    expect(aplicarPendentes(lista, fila, 'e1')[0]?.lastModified).toEqual(new Date(12345));
  });

  it('a última pendência do mesmo produto é a que vale', () => {
    const fila = [
      pendente({ id: 'f1', produtoId: 'a', dados: { quantidade: 10 } }),
      pendente({ id: 'f2', produtoId: 'a', dados: { quantidade: 20 } }),
    ];
    expect(aplicarPendentes(lista, fila, 'e1')[0]?.quantidade).toBe(20);
  });
});
