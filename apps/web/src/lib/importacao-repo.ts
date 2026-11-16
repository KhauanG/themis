/**
 * Gravação da importação de planilha (Etapa 4), em lotes de 500 e sem nunca lançar.
 *
 * Cada lote espera o servidor (`exigirGravacao`): com o cache offline ligado, `commit()` só
 * resolve com a confirmação, e sem ela a tela diria "concluído" com o servidor vazio.
 * Produto novo ganha id fixo (`idDeImportacao`), então repetir o mesmo arquivo não duplica.
 */
import { doc, documentId, getDocsFromServer, query, where, writeBatch } from 'firebase/firestore';
import type { PlanoImportacao, ProdutoDoBanco, ResultadoDaImportacao } from '@themis/shared';
import { db } from './firebase.js';
import { deviceId } from './dispositivo.js';
import { isPermissaoNegada } from './fila-offline.js';
import { exigirGravacao, isWriteTimeout } from './firestore-write.js';
import { idDeImportacao } from './planilha.js';
import { colecaoProdutos } from './produtos-repo.js';

const LIMITE_BATCH = 500;
/** Limite do servidor para `in` com `documentId()`: provado no emulador (firestore/regras.test.ts). */
const IDS_POR_CONSULTA = 30;
const TETO_MS = 20_000;

/**
 * Lê do servidor, nunca do cache. Lança se o servidor não responder em 20 s.
 * (O `console.warn` do `exigirGravacao` no estouro fala em "cache local": numa leitura, é falso.)
 */
export async function lerProdutosDoServidor(inventoryId: string): Promise<ProdutoDoBanco[]> {
  const snap = await exigirGravacao(getDocsFromServer(colecaoProdutos(inventoryId)), {
    ms: TETO_MS,
    label: 'ler produtos',
  });
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

/** Quais destes ids já existem no servidor. Um lote que estourou o teto antes pode ter subido depois. */
async function idsQueJaExistem(inventoryId: string, ids: string[]): Promise<Set<string>> {
  const consultas: Array<Promise<{ docs: Array<{ id: string }> }>> = [];
  for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) {
    const grupo = ids.slice(i, i + IDS_POR_CONSULTA);
    consultas.push(
      exigirGravacao(
        getDocsFromServer(query(colecaoProdutos(inventoryId), where(documentId(), 'in', grupo))),
        { ms: TETO_MS, label: 'reler produtos novos' },
      ),
    );
  }
  return new Set((await Promise.all(consultas)).flatMap((snap) => snap.docs.map((d) => d.id)));
}

/** Nunca lança: uma parada volta em `parou`, com o que o servidor confirmou até ali. */
export async function gravarImportacao(
  inventoryId: string,
  plano: PlanoImportacao,
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<ResultadoDaImportacao> {
  const agora = new Date();
  const autor = deviceId();
  const total = plano.atualizar.length + plano.criar.length;
  const carimbos = { lastImportDate: agora, lastModified: agora, modifiedBy: autor };
  const colecao = colecaoProdutos(inventoryId);
  let criados = 0;
  let atualizados = 0;

  try {
    for (let i = 0; i < plano.atualizar.length; i += LIMITE_BATCH) {
      const lote = writeBatch(db);
      for (const { id, campos } of plano.atualizar.slice(i, i + LIMITE_BATCH)) {
        lote.update(doc(colecao, id), { ...campos, ...carimbos });
      }
      await exigirGravacao(lote.commit(), { ms: TETO_MS, label: 'importar planilha' });
      atualizados += Math.min(LIMITE_BATCH, plano.atualizar.length - i);
      aoProgredir?.(atualizados + criados, total);
    }

    for (let i = 0; i < plano.criar.length; i += LIMITE_BATCH) {
      const itens = plano.criar.slice(i, i + LIMITE_BATCH);
      const ids = await Promise.all(itens.map((item) => idDeImportacao(item.chave)));

      let existentes: Set<string>;
      try {
        existentes = await idsQueJaExistem(inventoryId, ids);
      } catch (erro) {
        // Sem a releitura não dá para saber se o lote já subiu: para como no teto.
        console.error('[importação] Parou:', erro);
        return { criados, atualizados, parou: 'teto' };
      }
      criados += existentes.size;

      const lote = writeBatch(db);
      let novos = 0;
      itens.forEach(({ campos }, k) => {
        const id = ids[k]!;
        if (existentes.has(id)) return;
        lote.set(doc(colecao, id), { ...campos, inventoryId, createdAt: agora, ...carimbos });
        novos++;
      });
      if (novos > 0) {
        await exigirGravacao(lote.commit(), { ms: TETO_MS, label: 'importar planilha' });
        criados += novos;
      }
      aoProgredir?.(atualizados + criados, total);
    }
  } catch (erro) {
    console.error('[importação] Parou:', erro);
    const parou = isWriteTimeout(erro) ? 'teto' : isPermissaoNegada(erro) ? 'recusa' : 'erro';
    return { criados, atualizados, parou };
  }
  return { criados, atualizados, parou: null };
}
