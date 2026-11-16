import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanoImportacao } from '@themis/shared';
import { gravarImportacao, lerProdutosDoServidor } from './importacao-repo.js';
import { WriteTimeoutError } from './firestore-write.js';

interface Operacao { op: 'set' | 'update'; id: string; dados: Record<string, unknown> }

/** Servidor falso. `falharNoCommit` conta a partir de 1. */
const servidor = vi.hoisted(() => ({
  existentes: new Set<string>(),
  documentos: [] as Array<{ id: string; dados: Record<string, unknown> }>,
  lotes: [] as Operacao[][],
  consultas: [] as string[][],
  commits: 0,
  falharNoCommit: 0,
  erroDoCommit: null as unknown,
  erroDaLeitura: null as unknown,
}));

vi.mock('./firebase.js', () => ({ db: {} }));
vi.mock('./dispositivo.js', () => ({ deviceId: () => 'aparelho-teste' }));
vi.mock('./produtos-repo.js', () => ({ colecaoProdutos: (id: string) => ({ colecao: id }) }));
vi.mock('./firestore-write.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./firestore-write.js')>()),
  exigirGravacao: (p: Promise<unknown>) => p,
}));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  doc: (_colecao: unknown, id: string) => ({ id }),
  documentId: () => '__id__',
  where: (_campo: unknown, _op: string, ids: string[]) => ids,
  query: (_colecao: unknown, ids: string[]) => ids,
  getDocsFromServer: async (alvo: unknown) => {
    if (servidor.erroDaLeitura) throw servidor.erroDaLeitura;
    if (!Array.isArray(alvo)) {
      return { docs: servidor.documentos.map((d) => ({ id: d.id, data: () => d.dados })) };
    }
    servidor.consultas.push(alvo as string[]);
    return { docs: (alvo as string[]).filter((id) => servidor.existentes.has(id)).map((id) => ({ id })) };
  },
  writeBatch: () => {
    const ops: Operacao[] = [];
    return {
      set: (ref: { id: string }, dados: Record<string, unknown>) => ops.push({ op: 'set', id: ref.id, dados }),
      update: (ref: { id: string }, dados: Record<string, unknown>) => ops.push({ op: 'update', id: ref.id, dados }),
      commit: async () => {
        servidor.commits++;
        if (servidor.commits === servidor.falharNoCommit) throw servidor.erroDoCommit;
        servidor.lotes.push(ops);
      },
    };
  },
}));

beforeEach(() => {
  Object.assign(servidor, {
    existentes: new Set<string>(), documentos: [], lotes: [], consultas: [],
    commits: 0, falharNoCommit: 0, erroDoCommit: null, erroDaLeitura: null,
  });
});

const ID_7 = 'imp-cbf7819ddb9b767284c9a6a21461e9d5';
const NOVO = { nome: 'N', NomeProduto: 'N', codigoBarras: '', CodigoBarras: '', temCodigoBarras: false, quantidade: 0, estoqueSistema: 0, EstoqueAtual: 0 };

function plano(atualizar: number, chaves: string[] = []): PlanoImportacao {
  return {
    atualizar: Array.from({ length: atualizar }, (_, i) => ({ linha: i + 2, id: `p${i}`, campos: { NCM: '1' } })),
    criar: chaves.map((chave, i) => ({ linha: i + 2, chave, campos: NOVO })),
    semMudanca: 0, recusadas: [], ignoradas: 0, possiveisDuplicados: 0,
  };
}

describe('lerProdutosDoServidor', () => {
  it('devolve os documentos crus, com o id', async () => {
    servidor.documentos = [{ id: 'p1', dados: { nome: 'SKOL', quantidade: 3 } }];
    expect(await lerProdutosDoServidor('E1')).toEqual([{ id: 'p1', nome: 'SKOL', quantidade: 3 }]);
  });

  it('servidor fora: lança, para ninguém planejar em cima do cache', async () => {
    servidor.erroDaLeitura = { code: 'unavailable' };
    await expect(lerProdutosDoServidor('E1')).rejects.toEqual({ code: 'unavailable' });
  });
});

describe('gravarImportacao', () => {
  it('grava atualizar antes de criar, com os carimbos', async () => {
    expect(await gravarImportacao('E1', plano(1, ['id:7']))).toEqual({ criados: 1, atualizados: 1, parou: null });
    expect(servidor.lotes).toHaveLength(2);

    const [atualizacao] = servidor.lotes[0]!;
    expect(atualizacao).toMatchObject({ op: 'update', id: 'p0', dados: { NCM: '1', modifiedBy: 'aparelho-teste' } });
    expect(Object.keys(atualizacao!.dados).sort()).toEqual(['NCM', 'lastImportDate', 'lastModified', 'modifiedBy']);
    expect(atualizacao!.dados['lastModified']).toBeInstanceOf(Date);

    const [criacao] = servidor.lotes[1]!;
    expect(criacao).toMatchObject({ op: 'set', id: ID_7, dados: { ...NOVO, inventoryId: 'E1', modifiedBy: 'aparelho-teste' } });
    expect(Object.keys(criacao!.dados).sort()).toEqual(
      [...Object.keys(NOVO), 'createdAt', 'inventoryId', 'lastImportDate', 'lastModified', 'modifiedBy'].sort(),
    );
  });

  it('501 atualizações: lotes de 500 e 1, com progresso', async () => {
    const progresso: Array<[number, number]> = [];
    await gravarImportacao('E1', plano(501), (feitos, total) => progresso.push([feitos, total]));
    expect(servidor.lotes.map((l) => l.length)).toEqual([500, 1]);
    expect(progresso).toEqual([[500, 501], [501, 501]]);
  });

  it('antes de criar, relê os ids em grupos de 30', async () => {
    await gravarImportacao('E1', plano(0, Array.from({ length: 61 }, (_, i) => `id:${i + 1}`)));
    expect(servidor.consultas.map((c) => c.length)).toEqual([30, 30, 1]);
  });

  // Um lote que estourou o teto na tentativa anterior pode ter subido depois. Regravar o
  // documento inteiro com quantidade 0 apagaria uma contagem feita no meio.
  it('id que já existe no servidor sai do lote e conta como criado', async () => {
    servidor.existentes.add(ID_7);
    expect(await gravarImportacao('E1', plano(0, ['id:7', 'id:8']))).toEqual({ criados: 2, atualizados: 0, parou: null });
    expect(servidor.lotes).toHaveLength(1);
    expect(servidor.lotes[0]!.map((o) => o.id)).not.toContain(ID_7);
    expect(servidor.lotes[0]).toHaveLength(1);
  });

  it('todos já existem: nenhum commit', async () => {
    servidor.existentes.add(ID_7);
    expect(await gravarImportacao('E1', plano(0, ['id:7']))).toEqual({ criados: 1, atualizados: 0, parou: null });
    expect(servidor.commits).toBe(0);
  });

  it('teto num lote para e devolve o que confirmou', async () => {
    Object.assign(servidor, { falharNoCommit: 2, erroDoCommit: new WriteTimeoutError('importar planilha') });
    expect(await gravarImportacao('E1', plano(1001, ['id:7']))).toEqual({ criados: 0, atualizados: 500, parou: 'teto' });
    expect(servidor.lotes).toHaveLength(1);
    expect(servidor.consultas).toEqual([]);
  });

  it('recusa da regra', async () => {
    Object.assign(servidor, { falharNoCommit: 1, erroDoCommit: { code: 'permission-denied' } });
    expect(await gravarImportacao('E1', plano(1))).toEqual({ criados: 0, atualizados: 0, parou: 'recusa' });
  });

  // Produto apagado por um master entre a prévia e a gravação: o update não acha o documento.
  it('outro erro para e devolve o que confirmou', async () => {
    Object.assign(servidor, { falharNoCommit: 2, erroDoCommit: { code: 'not-found' } });
    expect(await gravarImportacao('E1', plano(501))).toEqual({ criados: 0, atualizados: 500, parou: 'erro' });
  });

  it('releitura que falha para como no teto, sem gravar o lote', async () => {
    servidor.erroDaLeitura = { code: 'unavailable' };
    expect(await gravarImportacao('E1', plano(0, ['id:7']))).toEqual({ criados: 0, atualizados: 0, parou: 'teto' });
    expect(servidor.commits).toBe(0);
  });

  it('plano vazio não fala com o servidor', async () => {
    expect(await gravarImportacao('E1', plano(0))).toEqual({ criados: 0, atualizados: 0, parou: null });
    expect(servidor.commits).toBe(0);
  });
});
