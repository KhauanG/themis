/**
 * Histórico geral de ações (`historico_geral`).
 *
 * Log nunca segura o fluxo do usuário: teto curto e segue. Se falhar, a entrada vai para
 * o localStorage e sobe na próxima drenagem. Perder um registro de log é aceitável;
 * travar a contagem por causa dele não é.
 */
import {
  Timestamp,
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  filtrarEventos,
  restricoesDoHistorico,
  type AcaoHistorico,
  type EntradaHistorico,
  type FiltroHistorico,
  type FiltroNoNavegador,
} from '@themis/shared';
// Rótulos e cores vivem em `@themis/shared` junto do formatador — assim tela e testes
// leem a mesma tabela, e uma ação nova não fica sem nome.
export { COR_ACAO, ROTULO_ACAO } from '@themis/shared';
import { db } from './firebase.js';
import { withWriteTimeout } from './firestore-write.js';
import { CHAVES, gravar, ler, remover } from './armazenamento.js';
import { deviceId, deviceLabel } from './dispositivo.js';
import { isPermissaoNegada } from './fila-offline.js';

const COLECAO = 'historico_geral';
const TETO_LOG_MS = 5_000;

export interface ContextoLog {
  userId: string;
  userEmail: string;
  userName: string;
  inventoryId: string;
  inventoryName: string;
}

/** Quem fez, sem estoque: para ações que não são de um estoque só. */
export type AutorLog = Pick<ContextoLog, 'userId' | 'userEmail' | 'userName'>;

/** Contexto das ações globais (configurações), que não pertencem a um estoque. */
export const CONTEXTO_GLOBAL = { inventoryId: 'global', inventoryName: 'Todos os estoques' } as const;

export async function registrar(
  acao: AcaoHistorico,
  contexto: ContextoLog,
  detalhes: Record<string, unknown> = {},
): Promise<void> {
  const entrada: EntradaHistorico = {
    action: acao,
    ...contexto,
    localTimestamp: new Date().toISOString(),
    details: detalhes,
    deviceId: deviceId(),
    deviceLabel: deviceLabel(),
  };

  if (!navigator.onLine) {
    guardarLocal(entrada);
    return;
  }

  try {
    await withWriteTimeout(
      addDoc(collection(db, COLECAO), { ...entrada, timestamp: serverTimestamp() }),
      { ms: TETO_LOG_MS, label: 'histórico' },
    );
  } catch (erro) {
    // Recusa da regra nunca vai passar: guardar só travaria a fila.
    if (isPermissaoNegada(erro)) {
      console.warn('[histórico] Recusado pela regra, descartado:', erro);
      return;
    }
    console.warn('[histórico] Falhou, guardando local:', erro);
    guardarLocal(entrada);
  }
}

function guardarLocal(entrada: EntradaHistorico): void {
  const pendentes = ler<EntradaHistorico[]>(CHAVES.historicoPendente, []);
  pendentes.push(entrada);
  gravar(CHAVES.historicoPendente, pendentes);
}

/**
 * Reenvia o histórico guardado. A fila é do aparelho: só sobem as entradas de `userId` (a regra
 * recusaria as de quem usou antes). Uma falha não para o laço; recusa da regra descarta a entrada;
 * o resto fica na fila, na ordem original. No fim a fila é relida e só saem dela as entradas
 * enviadas ou descartadas: o `registrar` pode ter guardado outra enquanto esperávamos o servidor.
 */
export async function drenarHistorico(userId: string): Promise<number> {
  const pendentes = ler<EntradaHistorico[]>(CHAVES.historicoPendente, []);
  if (pendentes.length === 0) return 0;

  // Quantas vezes cada entrada (pelo conteúdo) saiu da fila; a releitura gera objetos novos.
  const saiu = new Map<string, number>();
  const sair = (entrada: EntradaHistorico) => {
    const chave = JSON.stringify(entrada);
    saiu.set(chave, (saiu.get(chave) ?? 0) + 1);
  };
  let enviados = 0;

  for (const entrada of pendentes) {
    if (entrada.userId !== userId || !navigator.onLine) continue;
    try {
      await withWriteTimeout(
        addDoc(collection(db, COLECAO), { ...entrada, timestamp: serverTimestamp() }),
        { ms: TETO_LOG_MS, label: 'histórico pendente' },
      );
      enviados++;
      sair(entrada);
    } catch (erro) {
      if (!isPermissaoNegada(erro)) continue;
      console.warn('[histórico] Recusado pela regra, descartado:', erro);
      sair(entrada);
    }
  }

  const restantes = ler<EntradaHistorico[]>(CHAVES.historicoPendente, []).filter((entrada) => {
    const chave = JSON.stringify(entrada);
    const n = saiu.get(chave) ?? 0;
    if (n > 0) saiu.set(chave, n - 1);
    return n === 0;
  });
  if (restantes.length === 0) remover(CHAVES.historicoPendente);
  else gravar(CHAVES.historicoPendente, restantes);

  return enviados;
}

export interface EntradaHistoricoLida extends EntradaHistorico {
  id: string;
  quando: Date;
}

function paraEntrada(snap: QueryDocumentSnapshot<DocumentData>): EntradaHistoricoLida {
  const d = snap.data();
  const ts = d['timestamp'];
  const quando =
    ts instanceof Timestamp ? ts.toDate() : new Date((d['localTimestamp'] as string) ?? Date.now());
  return { ...(d as EntradaHistorico), id: snap.id, quando };
}

export const PAGINA_HISTORICO = 200;
export const LINHAS_POR_CARGA = 50;
export const TETO_VARREDURA = 2_000;

export type CursorHistorico = QueryDocumentSnapshot<DocumentData>;

export interface PaginaHistorico {
  eventos: EntradaHistoricoLida[];
  /** Último documento devolvido; `null` quando a página veio vazia. */
  ultimo: CursorHistorico | null;
  temMais: boolean;
}

/**
 * Uma página do histórico, mais recentes primeiro. Pede um a mais para saber se há outra. Estoque,
 * ação (com estoque) e datas vão ao servidor, só com os índices de hoje (`firestore.indexes.json`).
 * Molde: `listarAuditorias`.
 */
export async function consultarHistorico(
  filtro: FiltroHistorico,
  tamanho = PAGINA_HISTORICO,
  depois?: CursorHistorico | null,
): Promise<PaginaHistorico> {
  const restricoes = restricoesDoHistorico(filtro).map((r) =>
    where(r.campo, r.op, r.valor instanceof Date ? Timestamp.fromDate(r.valor) : r.valor),
  );
  const snap = await getDocs(
    query(
      collection(db, COLECAO),
      ...restricoes,
      orderBy('timestamp', 'desc'),
      ...(depois ? [startAfter(depois)] : []),
      limit(tamanho + 1),
    ),
  );
  const docs = snap.docs.slice(0, tamanho);
  return { eventos: docs.map(paraEntrada), ultimo: docs.at(-1) ?? null, temMais: snap.docs.length > tamanho };
}

export interface VarreduraHistorico extends PaginaHistorico {
  varridos: number;
}

/** Busca páginas até juntar LINHAS_POR_CARGA que passam no filtro do navegador, varrer TETO_VARREDURA ou o servidor acabar. */
export async function varrerHistorico(
  servidor: FiltroHistorico,
  navegador: FiltroNoNavegador,
  depois: CursorHistorico | null,
  consultar: typeof consultarHistorico = consultarHistorico,
): Promise<VarreduraHistorico> {
  const eventos: EntradaHistoricoLida[] = [];
  let cursor = depois;
  let temMais = true;
  let varridos = 0;
  do {
    const pagina = await consultar(servidor, PAGINA_HISTORICO, cursor);
    varridos += pagina.eventos.length;
    eventos.push(...filtrarEventos(pagina.eventos, navegador));
    cursor = pagina.ultimo ?? cursor;
    temMais = pagina.temMais;
  } while (temMais && eventos.length < LINHAS_POR_CARGA && varridos < TETO_VARREDURA);
  return { eventos, ultimo: cursor, temMais, varridos };
}
