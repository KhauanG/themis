/**
 * Configurações globais — `appSettings/global`.
 *
 * São dois interruptores que mudam o que a equipe pode fazer, e por isso valem para todo
 * mundo ao mesmo tempo, com listener em tempo real: ligar o modo contagem no escritório
 * precisa refletir no celular do depósito sem ninguém recarregar nada.
 *
 * ⚠️ A regra do Firestore confere o tipo de `modoContagem`, `readonlyInventories`, `lastUpdated`
 * e do interruptor antigo do ciclo (que saiu do site: o campo fica no documento, sem efeito) —
 * e o campo de data chama `lastUpdated`, não `updatedAt`. Escrita exige admin ou master.
 */
import { Timestamp, doc, getDoc, onSnapshot, setDoc, type DocumentData } from 'firebase/firestore';
import { db } from './firebase.js';
import { assinaturaResiliente } from './assinatura.js';
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
  return assinaturaResiliente(
    (viva, falhou) =>
      onSnapshot(
        doc(db, 'appSettings', DOC),
        (snap) => {
          viva();
          aoMudar(paraConfiguracoes(snap.exists() ? snap.data() : undefined));
        },
        falhou,
      ),
    { label: 'configuracoes' },
  );
}

/**
 * Grava as chaves que a tela conhece, de uma vez.
 *
 * Com `merge`, porque o documento tem campos que esta tela não conhece
 * (`latestNativeAppVersion`, posto à mão no Console e lido pelo app nativo): `setDoc` sem
 * `merge` os apagava a cada ajuste. A lista vai inteira, porque com `merge` o array é
 * substituído, não somado.
 */
export async function salvarConfiguracoes(config: Configuracoes): Promise<void> {
  await withWriteTimeout(
    setDoc(
      doc(db, 'appSettings', DOC),
      {
        modoContagem: config.modoContagem,
        readonlyInventories: config.somenteLeitura,
        // A regra cobra `lastUpdated`; `updatedAt` seria negado.
        lastUpdated: Timestamp.fromDate(new Date()),
      },
      { merge: true },
    ),
    { label: 'salvar configurações' },
  );
}
