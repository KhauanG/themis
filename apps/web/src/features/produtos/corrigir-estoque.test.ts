import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Produto } from '@themis/shared';
import { atualizarEstoqueSistema, fecharConferencia } from '../../lib/produtos-repo.js';
import { buscarEstoqueDoErp, enviarAoErp, type ResultadoBusca } from '../../lib/erp.js';
import { diagnosticar, executarCorrecao } from './corrigir-estoque.js';

// Sem carregar o Firebase: só o contrato com `fecharConferencia` e o ERP importa aqui.
vi.mock('../../lib/produtos-repo.js', () => ({
  atualizarEstoqueSistema: vi.fn(async () => ({ atualizados: 0, semCorrespondencia: 0, zeradosPorOmissao: 0, casaram: 3 })),
  fecharConferencia: vi.fn(async (_id: string, produtos: readonly Produto[]) => ({ divergentes: produtos.length, corretos: 0 })),
}));
vi.mock('../../lib/erp.js', () => ({ enviarAoErp: vi.fn(), buscarEstoqueDoErp: vi.fn() }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

const leitura = (pares: Array<[string, number]>): ResultadoBusca => ({
  ok: true, estoque: new Map(pares), itens: pares.length, recebidos: pares.length, semId: 0, campos: [], omiteZerados: false,
});

const item = (id: string, nome: string, IdProduto: number, quantidade: number, estoqueSistema: number): Produto => ({
  id, nome, IdProduto, quantidade, estoqueSistema, codigoBarras: '', productStatus: 'ATUALIZADO',
});

describe('diagnosticar — para antes de gravar', () => {
  const produtos = [item('a', 'A', 1, 5, 3), item('b', 'B', 2, 7, 1)];

  it('lê o ERP pela loja e só então grava', async () => {
    vi.mocked(buscarEstoqueDoErp).mockResolvedValue(leitura([['1', 5], ['2', 1]]));
    const d = await diagnosticar('E1', produtos, () => {});
    expect(buscarEstoqueDoErp).toHaveBeenCalledWith('E1');
    expect(atualizarEstoqueSistema).toHaveBeenCalledTimes(1);
    expect(d).not.toHaveProperty('hashLoja');
    expect(d.inventoryId).toBe('E1');
  });

  it.each([
    ['listagem vazia', leitura([]),
      'O ERP não devolveu nenhum produto para esta loja. Nada foi gravado. Confira o HashLoja do estoque.'],
    ['nenhum ID casa', leitura([['98', 1], ['99', 1]]),
      'Nenhum dos 2 produtos casou com os 2 itens do ERP. Nada foi gravado. Confira o HashLoja do estoque.'],
  ] as const)('%s: rejeita e não grava nada', async (_nome, resposta, mensagem) => {
    vi.mocked(buscarEstoqueDoErp).mockResolvedValue(resposta);
    await expect(diagnosticar('E1', produtos, () => {})).rejects.toThrow(mensagem);
    expect(atualizarEstoqueSistema).not.toHaveBeenCalled();
  });
});

describe('executarCorrecao — fechamento da conferência', () => {
  it('só vira CONFERIDO o que bateu e o que o ERP aceitou', async () => {
    vi.useFakeTimers();
    const a = item('a', 'Aceito', 1, 5, 3);
    const b = item('b', 'Recusado', 2, 7, 1);
    const c = item('c', 'Bateu', 3, 4, 4);
    const d = { ...item('d', 'SemId', 0, 9, 2), IdProduto: undefined };
    const e = item('e', 'ForaDoErp', 5, 6, 1);
    vi.mocked(enviarAoErp).mockImplementation(async (_inventoryId, envio) =>
      envio.IdProduto === 2 ? { ok: false, erro: 'ERP recusou: x' } : { ok: true });
    vi.mocked(buscarEstoqueDoErp).mockResolvedValue({
      ok: true, estoque: new Map([['1', 5], ['2', 1], ['3', 4]]), itens: 3, recebidos: 3, semId: 0, campos: [], omiteZerados: false,
    });

    const promessa = executarCorrecao('E1', {
      inventoryId: 'E1', contados: [a, b, c, d, e], divergentes: [a, b, d, e], foraDoErp: [e], semCorrespondencia: 0, saldosAtualizados: 0,
    }, () => {});
    await vi.runAllTimersAsync();
    const r = await promessa;

    expect(vi.mocked(fecharConferencia).mock.calls[0]![1].map((p) => p.id)).toEqual(['a', 'c']);
    expect(r.falhasNoEnvio).toEqual(['Recusado', 'SemId (sem ID do ERP)']);
    expect(r.enviados).toBe(1);
    // O recusado não pode aparecer também como "aceito mas não refletiu" (nem entre os confirmados).
    expect(r.pendentes).toEqual([]);
    expect(r.confirmados).toBe(1);
    vi.useRealTimers();
  });

  // Estouro ou 504 do proxy: o ERP aplicou e a API respondeu falha. Sem a releitura do
  // recusado, o item ficava ATUALIZADO, a correção seguinte o via como "bateu" e o conferia
  // com corrigidoIncorreto false. Mesmo caminho do recusado cujo saldo antigo já era o enviado.
  it('recusado com o saldo enviado na releitura conta como aceito', async () => {
    vi.useFakeTimers();
    const a = item('a', 'Aplicou', 1, 5, 3);
    const b = item('b', 'NaoAplicou', 2, 7, 1);
    vi.mocked(enviarAoErp).mockResolvedValue({ ok: false, erro: 'Tempo esgotado ao contatar o ERP' });
    vi.mocked(buscarEstoqueDoErp).mockResolvedValue({
      ok: true, estoque: new Map([['1', 5], ['2', 1]]), itens: 2, recebidos: 2, semId: 0, campos: [], omiteZerados: false,
    });

    const promessa = executarCorrecao('E1', {
      inventoryId: 'E1', contados: [a, b], divergentes: [a, b], foraDoErp: [], semCorrespondencia: 0, saldosAtualizados: 0,
    }, () => {});
    await vi.runAllTimersAsync();
    const r = await promessa;

    const [, fechados, idsDivergentes] = vi.mocked(fecharConferencia).mock.lastCall!;
    expect(fechados.map((p) => p.id)).toEqual(['a']);
    expect(idsDivergentes.has('a')).toBe(true);
    expect(r.falhasNoEnvio).toEqual(['NaoAplicou']);
    expect(r.confirmados).toBe(1);
    expect(r.enviados).toBe(1);
    expect(r.pendentes).toEqual([]);
    vi.useRealTimers();
  });

  it('releitura vazia não grava e deixa a verificação indisponível', async () => {
    vi.useFakeTimers();
    const a = item('a', 'Aceito', 1, 5, 3);
    vi.mocked(enviarAoErp).mockResolvedValue({ ok: true });
    vi.mocked(buscarEstoqueDoErp).mockResolvedValue(leitura([]));

    const promessa = executarCorrecao('E1', {
      inventoryId: 'E1', contados: [a], divergentes: [a], foraDoErp: [], semCorrespondencia: 0, saldosAtualizados: 0,
    }, () => {});
    await vi.runAllTimersAsync();
    const r = await promessa;

    const [loja, envio] = vi.mocked(enviarAoErp).mock.calls[0]!;
    expect(loja).toBe('E1');
    expect(envio).not.toHaveProperty('HashLoja');
    expect(buscarEstoqueDoErp).toHaveBeenCalledWith('E1');
    expect(atualizarEstoqueSistema).not.toHaveBeenCalled();
    expect(r.verificacaoIndisponivel).toBe(true);
    expect(r.pendentes).toEqual([]);
    expect(vi.mocked(fecharConferencia).mock.lastCall![1].map((p) => p.id)).toEqual(['a']);
  });
});
