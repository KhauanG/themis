/**
 * Configurações globais — `appSettings/global`.
 *
 * São dois interruptores que mudam o que a equipe pode fazer, e por isso valem para todo
 * mundo ao mesmo tempo, com listener em tempo real: ligar o modo contagem no escritório
 * precisa refletir no celular do depósito sem ninguém recarregar nada.
 *
 * ⚠️ A regra do Firestore aceita **apenas** `modoContagem`, `readonlyInventories` e
 * `lastUpdated` — e o campo de data chama `lastUpdated`, não `updatedAt`. Qualquer campo
 * a mais faz a escrita inteira ser negada. Escrita exige admin ou master.
 */
import { Timestamp, doc, getDoc, onSnapshot, setDoc, type DocumentData } from 'firebase/firestore';
import { db } from './firebase.js';
import { withWriteTimeout } from './firestore-write.js';

const DOC = 'global';

export interface Configuracoes {
  /**
   * Trava as ações em massa (importar, limpar, exportar) **mesmo para admin**, enquanto
   * uma contagem está em andamento. Existe para ninguém apagar a contagem por engano no
   * meio da operação.
   */
  modoContagem: boolean;
  /** Estoques onde ninguém pode contar nem editar produto. */
  somenteLeitura: string[];
}

export const CONFIGURACOES_PADRAO: Configuracoes = {
  modoContagem: false,
  somenteLeitura: [],
};

function paraConfiguracoes(dados: DocumentData | undefined): Configuracoes {
  if (!dados) return CONFIGURACOES_PADRAO;
  const lista = dados['readonlyInventories'];
  return {
    modoContagem: dados['modoContagem'] === true,
    somenteLeitura: Array.isArray(lista) ? lista.map(String) : [],
  };
}

export async function carregarConfiguracoes(): Promise<Configuracoes> {
  const snap = await getDoc(doc(db, 'appSettings', DOC));
  return paraConfiguracoes(snap.exists() ? snap.data() : undefined);
}

export function ouvirConfiguracoes(aoMudar: (c: Configuracoes) => void): () => void {
  return onSnapshot(
    doc(db, 'appSettings', DOC),
    (snap) => aoMudar(paraConfiguracoes(snap.exists() ? snap.data() : undefined)),
    (erro) => console.warn('[configuracoes] Listener falhou:', erro),
  );
}

/**
 * Grava as duas chaves de uma vez.
 *
 * Sempre as duas, nunca só uma: `setDoc` sem `merge` apagaria a outra, e com `merge` numa
 * lista o Firestore substitui o array inteiro de qualquer forma. Enviar o estado completo
 * deixa explícito o que fica gravado.
 */
export async function salvarConfiguracoes(config: Configuracoes): Promise<void> {
  await withWriteTimeout(
    setDoc(doc(db, 'appSettings', DOC), {
      modoContagem: config.modoContagem,
      readonlyInventories: config.somenteLeitura,
      // A regra cobra `lastUpdated`; `updatedAt` seria negado.
      lastUpdated: Timestamp.fromDate(new Date()),
    }),
    { label: 'salvar configurações' },
  );
}
