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
  /**
   * Mostrar o número do ciclo ao lado do lote, na auditoria e nos relatórios.
   *
   * Existe para a transição: auditoria salva antes do lote só tem o ciclo, e durante as
   * primeiras semanas as pessoas ainda procuram pelo número antigo. Quando a equipe estiver
   * usando só lote, um master desliga — e o ciclo some da tela, continuando como número
   * interno.
   *
   * **Ligado por padrão**, e é o certo: o custo de mostrar um número a mais é ruído; o de
   * esconder cedo demais é alguém não achar a contagem que procura.
   */
  mostrarCiclo: boolean;
}

export const CONFIGURACOES_PADRAO: Configuracoes = {
  modoContagem: false,
  somenteLeitura: [],
  mostrarCiclo: true,
};

function paraConfiguracoes(dados: DocumentData | undefined): Configuracoes {
  if (!dados) return CONFIGURACOES_PADRAO;
  const lista = dados['readonlyInventories'];
  return {
    modoContagem: dados['modoContagem'] === true,
    // `!== false` e não `=== true`: o documento existente não tem a chave, e a
    // ausência precisa significar "mostrar", não "esconder".
    mostrarCiclo: dados['mostrarCiclo'] !== false,
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
      mostrarCiclo: config.mostrarCiclo,
      // A regra cobra `lastUpdated`; `updatedAt` seria negado.
      lastUpdated: Timestamp.fromDate(new Date()),
    }),
    { label: 'salvar configurações' },
  );
}
