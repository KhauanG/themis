/**
 * Configurações globais — `appSettings/global`.
 *
 * O modo contagem muda o que a equipe pode fazer, e por isso vale para todo mundo ao mesmo
 * tempo, com listener em tempo real: ligar no escritório precisa refletir no celular do
 * depósito sem ninguém recarregar nada.
 *
 * ⚠️ A regra do Firestore confere o tipo de `modoContagem`, de `lastUpdated`, da versão do app
 * e do interruptor antigo do ciclo (que saiu do site: o campo fica no documento, sem efeito) —
 * e o campo de data chama `lastUpdated`, não `updatedAt`. Escrita exige admin ou master.
 */
import { Timestamp, doc, onSnapshot, setDoc, type DocumentData } from 'firebase/firestore';
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
}

export const CONFIGURACOES_PADRAO: Configuracoes = {
  modoContagem: false,
};

function paraConfiguracoes(dados: DocumentData | undefined): Configuracoes {
  if (!dados) return CONFIGURACOES_PADRAO;
  return { modoContagem: dados['modoContagem'] === true };
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
 * `merge` os apagava a cada ajuste.
 */
export async function salvarConfiguracoes(config: Configuracoes): Promise<void> {
  await withWriteTimeout(
    setDoc(
      doc(db, 'appSettings', DOC),
      {
        modoContagem: config.modoContagem,
        // A regra cobra `lastUpdated`; `updatedAt` seria negado.
        lastUpdated: Timestamp.fromDate(new Date()),
      },
      { merge: true },
    ),
    { label: 'salvar configurações' },
  );
}
