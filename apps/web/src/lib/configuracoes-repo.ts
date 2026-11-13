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
import { Timestamp, doc, onSnapshot, type DocumentData } from 'firebase/firestore';
import type { ResultadoGestao } from '@themis/shared';
import { db } from './firebase.js';
import { assinaturaResiliente } from './assinatura.js';
import { gravarCampoDeGestao } from './gestao-escrita.js';

const DOC = 'global';

export interface Configuracoes {
  /**
   * Bloqueia cadastrar, importar, editar cadastro, limpar contagem e apagar produtos, mesmo
   * para admin, enquanto uma contagem está em andamento. Só na tela.
   */
  modoContagem: boolean;
  /** Versão mais nova do app nativo (`latestNativeAppVersion`). Vazio desliga o aviso de app desatualizado. */
  versaoApp: string;
}

export const CONFIGURACOES_PADRAO: Configuracoes = {
  modoContagem: false,
  versaoApp: '',
};

export function paraConfiguracoes(dados: DocumentData | undefined): Configuracoes {
  if (!dados) return CONFIGURACOES_PADRAO;
  const versao = dados['latestNativeAppVersion'];
  return {
    modoContagem: dados['modoContagem'] === true,
    // O Console aceita número (5.4); o app lê texto.
    versaoApp: typeof versao === 'string' ? versao : typeof versao === 'number' ? String(versao) : '',
  };
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

/** Cada ajuste grava só a própria chave (e `lastUpdated`, que a regra cobra) numa transação: o resto do documento nunca é regravado. */
const ref = () => doc(db, 'appSettings', DOC);
const agora = () => Timestamp.fromDate(new Date());

export function salvarModoContagem(valor: boolean, abertura: boolean): Promise<ResultadoGestao<boolean>> {
  return gravarCampoDeGestao({
    ref: ref(),
    rotulo: 'salvar modo contagem',
    abertura,
    pedido: valor,
    ler: (d) => paraConfiguracoes(d).modoContagem,
    dados: (v) => ({ modoContagem: v, lastUpdated: agora() }),
  });
}

export function salvarVersaoApp(versao: string, abertura: string): Promise<ResultadoGestao<string>> {
  return gravarCampoDeGestao({
    ref: ref(),
    rotulo: 'salvar versão do app',
    abertura,
    pedido: versao.trim(),
    ler: (d) => paraConfiguracoes(d).versaoApp,
    // A regra cobra `lastUpdated`; `updatedAt` seria negado.
    dados: (v) => ({ latestNativeAppVersion: v, lastUpdated: agora() }),
  });
}
