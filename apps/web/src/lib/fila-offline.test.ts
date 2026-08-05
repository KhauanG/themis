import { beforeEach, describe, expect, it } from 'vitest';
import { carregarFila, enfileirar, limparFila, removerDaFila, tamanhoFila } from './fila-offline.js';

/** localStorage mínimo — o teste roda em Node, sem DOM. */
function instalarLocalStorage() {
  const dados = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
    clear: () => dados.clear(),
    key: (i: number) => [...dados.keys()][i] ?? null,
    get length() {
      return dados.size;
    },
  } as Storage;
}

const base = {
  tipo: 'update' as const,
  produtoId: 'p1',
  inventoryId: 'e1',
  dados: { quantidade: 10 },
  baseQuantidade: 5,
  baseCodigoBarras: '789',
};

describe('fila offline', () => {
  beforeEach(() => {
    instalarLocalStorage();
    limparFila();
  });

  it('enfileira e persiste', () => {
    enfileirar(base);
    expect(tamanhoFila()).toBe(1);
    expect(carregarFila()[0]?.dados).toEqual({ quantidade: 10 });
  });

  it('sobrevive a uma releitura do armazenamento', () => {
    enfileirar(base);
    // Simula reabrir o app: só o que está serializado volta.
    expect(carregarFila()[0]?.produtoId).toBe('p1');
  });

  // Reenviar contagens intermediárias não muda o resultado e alonga a drenagem.
  it('substitui alteração anterior do mesmo produto', () => {
    enfileirar(base);
    enfileirar({ ...base, dados: { quantidade: 20 } });

    const fila = carregarFila();
    expect(fila).toHaveLength(1);
    expect(fila[0]?.dados).toEqual({ quantidade: 20 });
  });

  // O que importa para detectar conflito é o valor que o servidor tinha quando o
  // aparelho perdeu contato, não o da última edição local.
  it('preserva a base da PRIMEIRA edição ao substituir', () => {
    enfileirar(base);
    enfileirar({ ...base, dados: { quantidade: 20 }, baseQuantidade: 10, baseCodigoBarras: '000' });

    const item = carregarFila()[0];
    expect(item?.baseQuantidade).toBe(5);
    expect(item?.baseCodigoBarras).toBe('789');
  });

  it('mantém produtos diferentes separados', () => {
    enfileirar(base);
    enfileirar({ ...base, produtoId: 'p2' });
    expect(tamanhoFila()).toBe(2);
  });

  it('mantém o mesmo produto em estoques diferentes separados', () => {
    enfileirar(base);
    enfileirar({ ...base, inventoryId: 'e2' });
    expect(tamanhoFila()).toBe(2);
  });

  it('remove por id', () => {
    enfileirar(base);
    const id = carregarFila()[0]!.id;
    removerDaFila(id);
    expect(tamanhoFila()).toBe(0);
  });

  it('descarta entrada corrompida em vez de derrubar o app', () => {
    localStorage.setItem(
      'themis_fila_pendentes_v1',
      JSON.stringify([{ tipo: 'update' }, null, base]),
    );
    expect(carregarFila()).toHaveLength(1);
  });

  it('devolve fila vazia quando o armazenamento tem lixo', () => {
    localStorage.setItem('themis_fila_pendentes_v1', 'isto não é json');
    expect(carregarFila()).toEqual([]);
  });

  // O marcador de remoção é string justamente para atravessar o JSON.
  it('preserva o marcador de remoção de campo', () => {
    enfileirar({ ...base, dados: { dataValidade: '__themis_remover_campo__' } });
    expect(carregarFila()[0]?.dados['dataValidade']).toBe('__themis_remover_campo__');
  });
});
