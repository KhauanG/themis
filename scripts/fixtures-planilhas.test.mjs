import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planejarImportacao } from '@themis/shared';
import { ErroDePlanilha, idDeImportacao, lerPlanilha } from '../apps/web/src/lib/planilha.ts';

const PASTA = new URL('../fixtures/planilhas/', import.meta.url);
const ler = (nome) => readFileSync(new URL(nome, PASTA));
const json = (nome) => JSON.parse(ler(nome).toString('utf8'));

describe('casos.json — ids', () => {
  it.each(json('casos.json').ids)('$chave', async ({ chave, id }) => {
    expect(await idDeImportacao(chave)).toBe(id);
  });
});

/** Nomes das 21 planilhas da pasta, em ordem. Sem o 19-grande.xlsx. */
const planilhas = readdirSync(PASTA)
  .filter((n) => /\.(xlsx|xls)$/.test(n) && n !== '19-grande.xlsx')
  .sort();

const GRAVAR = process.env.GRAVAR_ESPERADO === '1';
const esperadoDe = (nome) => nome.replace(/\.(xlsx|xls)$/, '.esperado.json');

/** O que o site faz com o arquivo, já no formato do `.esperado.json` (Task 7). */
async function resultadoDe(nome) {
  try {
    const leitura = await lerPlanilha(new File([ler(nome)], nome));
    const plano = planejarImportacao(json('existentes.json'), leitura.linhas);
    return JSON.parse(JSON.stringify({ ...leitura, plano }));
  } catch (erro) {
    if (erro instanceof ErroDePlanilha) return { erro: erro.message };
    throw erro;
  }
}

describe('fixtures/planilhas — cada arquivo contra o esperado', { timeout: 30_000 }, () => {
  it.each(planilhas)('%s', async (nome) => {
    const real = await resultadoDe(nome);
    // Só cria o que falta. Nunca regrava um esperado que já existe.
    if (GRAVAR && !existsSync(new URL(esperadoDe(nome), PASTA))) {
      writeFileSync(new URL(esperadoDe(nome), PASTA), `${JSON.stringify(real, null, 2)}\n`);
    }
    expect(real).toEqual(json(esperadoDe(nome)));
  });
});

// Conferência à mão: o esperado (Task 7) é gerado pelo código, e estes fatos não.
describe('fixtures/planilhas — fatos-chave', { timeout: 30_000 }, () => {
  const PEDE_XLSX = { erro: 'Salve a planilha como .xlsx e tente de novo.' };
  const fatos = {
    '01-erp-dialeto.xlsx': (r) => {
      expect(Object.keys(r.mapa)).toHaveLength(12);
      expect(r.plano.atualizar).toEqual([{ linha: 2, id: 'e1', campos: {
        PrecoVenda: 6.5, estoqueSistema: 12, EstoqueAtual: 12, Categoria: 'BEBIDAS', Unidade: 'UN',
      } }]);
      expect(r.plano.criar.map((c) => c.chave)).toEqual(['id:2001']);
    },
    '02-excel-comum.xlsx': (r) => {
      expect(r.linhas[0].nome).toBe('PRODUTO TESTE 1');
      expect(r.plano.semMudanca).toBe(1);
      expect(r.plano.atualizar).toEqual([{ linha: 3, id: 'e2', campos: { estoqueSistema: 3, EstoqueAtual: 3 } }]);
    },
    '03a-produto-qtd-ean.xlsx': (r) => {
      expect(r.mapa).toEqual({ NomeProduto: 0, EstoqueAtual: 1, CodigoBarras: 2 });
      expect(r.plano.semMudanca).toBe(1);
    },
    '03b-id-nome-qtde.xlsx': (r) => {
      expect(r.mapa).toEqual({ IdProduto: 0, NomeProduto: 1, EstoqueAtual: 2 });
      expect(r.plano.semMudanca).toBe(1);
    },
    '03c-codigo-nome-saldo.xlsx': (r) => {
      expect(r.mapa).toEqual({ CodigoBarras: 0, NomeProduto: 1, EstoqueAtual: 2 });
      expect(r.plano.criar.map((c) => c.chave)).toEqual(['nome:produto novo c']);
    },
    '04-numeros-em-texto.xlsx': (r) => {
      expect(r.linhas.map((l) => l.PrecoVenda)).toEqual([12.5, 0.5, 12.5, 1234.56, 12.5, null, undefined]);
      expect(r.plano.recusadas).toEqual([{ linha: 7, motivo: 'número inválido em PrecoVenda' }]);
      expect(r.plano.criar).toHaveLength(6);
    },
    '05a-celulas-vazias.xlsx': (r) => {
      expect(r.plano.semMudanca).toBe(1);
      expect(r.plano.atualizar).toEqual([{ linha: 3, id: 'e4', campos: { IdProduto: '1004', NCM: '22030000', quantidade: 6 } }]);
    },
    '05b-sem-colunas-de-preco.xlsx': (r) => {
      expect(r.plano).toMatchObject({ criar: [], atualizar: [], semMudanca: 1 });
    },
    '06-id-repetido.xlsx': (r) => {
      expect(r.plano.recusadas).toEqual([
        { linha: 3, motivo: 'repetida: vale a linha 2' },
        { linha: 5, motivo: 'repetida: vale a linha 4' },
      ]);
      expect(r.plano.criar.map((c) => c.chave)).toEqual(['id:2002']);
      expect(r.plano.semMudanca).toBe(1);
    },
    '07-recusadas.xlsx': (r) => {
      expect(r.plano.recusadas).toEqual([
        { linha: 2, motivo: 'nome com mais de 300 letras' },
        { linha: 3, motivo: 'código do produto inválido' },
        { linha: 4, motivo: 'código do produto inválido' },
        { linha: 5, motivo: 'preço ou mínimo negativo em PrecoVenda' },
      ]);
      expect(r.plano.ignoradas).toBe(1);
      expect(r.plano.criar).toHaveLength(1);
      expect(r.plano.criar[0].campos.estoqueSistema).toBe(-3);
    },
    '08-sem-coluna-nome.xlsx': (r) => expect(r.colunasFaltando).toEqual(['nome do produto']),
    '09-cabecalho-com-buraco.xlsx': (r) => {
      expect(r.cabecalhos).toEqual(['Nome', '', 'Estoque']);
      expect(r.mapa).toEqual({ NomeProduto: 0, EstoqueAtual: 2 });
    },
    '10-validade-no-cabecalho.xlsx': (r) => {
      expect(r.mapa).toEqual({ NomeProduto: 0, EstoqueAtual: 2 });
      expect(r.plano.criar[0].campos.IdProduto).toBeUndefined();
    },
    '11a-capa-na-frente.xlsx': (r) => {
      expect(r.aba).toBe('Capa');
      expect(r.colunasFaltando).toEqual(['nome do produto']);
    },
    '11b-aba-oculta.xlsx': (r) => {
      expect(r.aba).toBe('Oculta');
      expect(r.linhas.map((l) => l.nome)).toEqual(['PRODUTO DA OCULTA']);
    },
    '12-so-cabecalho.xlsx': (r) => {
      expect(r.colunasFaltando).toEqual([]);
      expect(r.linhas).toEqual([]);
    },
    '13-antigo.xls': (r) => expect(r).toEqual(PEDE_XLSX),
    '14-csv-renomeado.xlsx': (r) => expect(r).toEqual(PEDE_XLSX),
    '15-codigos.xlsx': (r) => {
      expect(r.linhas.map((l) => l.codigoBarras)).toEqual([
        '7890000150019', '7890000150026', '0789000015003', '17890000150016', '1234567890123456',
      ]);
    },
    '16-formulas-e-formatado.xlsx': (r) => {
      expect(r.linhas[0]).toEqual({ linha: 2, nome: 'FORMULA OK', codigoBarras: 'INLINE123', PrecoVenda: 2, Unidade: 'UN' });
      expect(r.linhas[1]).toEqual({ linha: 3, nome: 'TEXTO EM PARTES', codigoBarras: 'true', PrecoVenda: 1 });
      expect(r.plano.recusadas).toEqual([
        { linha: 4, motivo: 'número inválido em PrecoVenda' },
        { linha: 5, motivo: 'número inválido em PrecoVenda' },
      ]);
    },
    '17-exportacao-site.xlsx': (r) => {
      expect(r.aba).toBe('Contagem');
      expect(r.mapa).toEqual({ NomeProduto: 0, EstoqueAtual: 1 });
      expect(r.plano.recusadas).toEqual([{ linha: 4, motivo: 'número inválido em EstoqueAtual' }]);
    },
  };

  it('são 21 arquivos', () => {
    expect(planilhas).toHaveLength(21);
  });

  it('todo arquivo tem fato-chave', () => {
    expect(Object.keys(fatos).sort()).toEqual(planilhas);
  });

  it.each(Object.entries(fatos))('%s', async (nome, conferir) => {
    conferir(await resultadoDe(nome));
  });
});

describe('fixtures/planilhas — SHA256SUMS', () => {
  it('confere cada arquivo da pasta, na ordem do nome', () => {
    const nomes = readdirSync(PASTA).filter((n) => n !== 'SHA256SUMS' && n !== '19-grande.xlsx').sort();
    const somas = nomes.map((n) => `${createHash('sha256').update(ler(n)).digest('hex')}  ${n}\n`).join('');
    if (GRAVAR) writeFileSync(new URL('SHA256SUMS', PASTA), somas);
    expect(somas).toBe(ler('SHA256SUMS').toString('utf8'));
  });
});
