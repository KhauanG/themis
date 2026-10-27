import { describe, expect, it, vi } from 'vitest';
import type { Produto } from '@themis/shared';
import { fecharConferencia } from '../../lib/produtos-repo.js';
import { buscarEstoqueDoErp, enviarAoErp } from '../../lib/erp.js';
import { executarCorrecao } from './corrigir-estoque.js';

// Sem carregar o Firebase: só o contrato com `fecharConferencia` e o ERP importa aqui.
vi.mock('../../lib/produtos-repo.js', () => ({
  atualizarEstoqueSistema: vi.fn(async () => ({ atualizados: 0, semCorrespondencia: 0, zeradosPorOmissao: 0, casaram: 3 })),
  fecharConferencia: vi.fn(async (_id: string, produtos: readonly Produto[]) => ({ divergentes: produtos.length, corretos: 0 })),
}));
vi.mock('../../lib/erp.js', () => ({ enviarAoErp: vi.fn(), buscarEstoqueDoErp: vi.fn(), hashDaLoja: vi.fn() }));

const item = (id: string, nome: string, IdProduto: number, quantidade: number, estoqueSistema: number): Produto => ({
  id, nome, IdProduto, quantidade, estoqueSistema, codigoBarras: '', productStatus: 'ATUALIZADO',
});

describe('executarCorrecao — fechamento da conferência', () => {
  it('só vira CONFERIDO o que bateu e o que o ERP aceitou', async () => {
    vi.useFakeTimers();
    const a = item('a', 'Aceito', 1, 5, 3);
    const b = item('b', 'Recusado', 2, 7, 1);
    const c = item('c', 'Bateu', 3, 4, 4);
    const d = { ...item('d', 'SemId', 0, 9, 2), IdProduto: undefined };
    const e = item('e', 'ForaDoErp', 5, 6, 1);
    vi.mocked(enviarAoErp).mockImplementation(async (envio) =>
      envio.IdProduto === 2 ? { ok: false, erro: 'ERP recusou: x' } : { ok: true });
    vi.mocked(buscarEstoqueDoErp).mockResolvedValue({
      ok: true, estoque: new Map([['1', 5], ['2', 1], ['3', 4]]), itens: 3, recebidos: 3, semId: 0, campos: [], omiteZerados: false,
    });

    const promessa = executarCorrecao('E1', {
      hashLoja: 'H', contados: [a, b, c, d, e], divergentes: [a, b, d, e], foraDoErp: [e], semCorrespondencia: 0, saldosAtualizados: 0,
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
});
