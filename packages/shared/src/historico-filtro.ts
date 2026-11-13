// Filtro do histórico (Etapa 4). O servidor filtra só o que os índices de hoje permitem; o resto fica no navegador.
import type { AcaoHistorico } from './types.js';

/** As 19 ações, na ordem do seletor: rotina primeiro, gestão depois. */
export const ORDEM_ACOES: readonly AcaoHistorico[] = [
  'MODIFICAR_PRODUTO',
  'CONFERIR_ITEM',
  'FINALIZAR_CONTAGEM',
  'BUSCAR_ESTOQUE',
  'CORRIGIR_ESTOQUE',
  'IMPORTAR_PLANILHA',
  'EXPORTAR_PLANILHA',
  'ABRIR_AUDITORIA',
  'LIMPAR_CONTAGEM',
  'LIMPAR_ESTOQUE',
  'CRIAR_PRODUTO',
  'EDITAR_PRODUTO',
  'EXCLUIR_PRODUTO',
  'CRIAR_ESTOQUE',
  'EDITAR_ESTOQUE',
  'EXCLUIR_ESTOQUE',
  'ALTERAR_PAPEL',
  'ALTERAR_CONFIGURACAO',
  'LOGIN',
];

/** O que vai ao servidor. Sem índice novo: `action` só é usado junto de `inventoryId`. */
export interface FiltroHistorico {
  inventoryId?: string;
  action?: AcaoHistorico;
  de?: Date;
  ate?: Date;
}

export type RestricaoHistorico =
  | { campo: 'inventoryId' | 'action'; op: '=='; valor: string }
  | { campo: 'timestamp'; op: '>=' | '<'; valor: Date };

/** Ordem: estoque; ação (só com estoque); `de`; `ate`. */
export function restricoesDoHistorico(filtro: FiltroHistorico): RestricaoHistorico[] {
  const r: RestricaoHistorico[] = [];
  if (filtro.inventoryId) r.push({ campo: 'inventoryId', op: '==', valor: filtro.inventoryId });
  if (filtro.inventoryId && filtro.action) r.push({ campo: 'action', op: '==', valor: filtro.action });
  if (filtro.de) r.push({ campo: 'timestamp', op: '>=', valor: filtro.de });
  if (filtro.ate) r.push({ campo: 'timestamp', op: '<', valor: filtro.ate });
  return r;
}

export interface FiltroNoNavegador {
  userId?: string;
  action?: AcaoHistorico;
}

export function filtrarEventos<T extends { userId?: string; action?: string }>(
  eventos: readonly T[],
  filtro: FiltroNoNavegador,
): T[] {
  return eventos.filter(
    (e) => (!filtro.userId || e.userId === filtro.userId) && (!filtro.action || e.action === filtro.action),
  );
}

/** O que a tela escolheu. `''` nas datas = sem data. */
export interface FiltroDaTela {
  inventoryId: string | 'TODOS';
  action: AcaoHistorico | 'TODAS';
  userId: string | 'TODOS';
  de: string;
  ate: string;
}

/** `AAAA-MM-DD` para a data local do dia (mais `diasAMais`). Nunca `new Date(texto)`, que é UTC. */
function diaLocal(texto: string, diasAMais = 0): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + diasAMais) : undefined;
}

/** Divide o filtro da tela entre servidor e navegador. "De" é 00:00 local do dia; "Até" é 00:00 local do dia seguinte. */
export function dividirFiltro(tela: FiltroDaTela): {
  servidor: FiltroHistorico;
  navegador: FiltroNoNavegador;
  filtraNoNavegador: boolean;
} {
  const servidor: FiltroHistorico = {};
  const navegador: FiltroNoNavegador = {};
  const acao = tela.action === 'TODAS' ? undefined : tela.action;
  if (tela.inventoryId !== 'TODOS') {
    servidor.inventoryId = tela.inventoryId;
    if (acao) servidor.action = acao;
  } else if (acao) {
    navegador.action = acao;
  }
  if (tela.userId !== 'TODOS') navegador.userId = tela.userId;
  const de = diaLocal(tela.de);
  const ate = diaLocal(tela.ate, 1);
  if (de) servidor.de = de;
  if (ate) servidor.ate = ate;
  return { servidor, navegador, filtraNoNavegador: Object.keys(navegador).length > 0 };
}

export function subtituloDoHistorico(registros: number, varridos: number, filtraNoNavegador: boolean): string {
  const base = `${registros} ${registros === 1 ? 'registro' : 'registros'}.`;
  return filtraNoNavegador ? `${base} Procurei em ${varridos}.` : base;
}
