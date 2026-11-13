/**
 * Coleção `users`: perfil e papéis.
 *
 * Cada um lê o próprio documento; a lista completa é de admin e master (regra `users`), e só
 * master grava papel e estoques de outra pessoa. O app 1.x tolerava flags gravadas como string
 * ou número — `papelDe` em `@themis/shared` mantém essa tolerância para não deslogar perfis antigos.
 */
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { estoquesPermitidos, flagsDoPapel, papelDe, type Papel, type ResultadoGestao, type UserProfile } from '@themis/shared';
import { db } from './firebase.js';
import { assinaturaResiliente } from './assinatura.js';
import { withWriteTimeout } from './firestore-write.js';
import { gravarCampoDeGestao } from './gestao-escrita.js';

const COLECAO = 'users';

function paraData(valor: unknown): Date | null {
  return valor instanceof Timestamp ? valor.toDate() : null;
}

function paraPerfil(id: string, d: DocumentData): UserProfile {
  return {
    uid: id,
    email: d['email'] as string | undefined,
    firstName: d['firstName'] as string | undefined,
    lastName: d['lastName'] as string | undefined,
    displayName: d['displayName'] as string | undefined,
    isMaster: d['isMaster'] as boolean | undefined,
    isAdmin: d['isAdmin'] as boolean | undefined,
    isAuditor: d['isAuditor'] as boolean | undefined,
    allowedInventories: d['allowedInventories'] as string[] | undefined,
    lastEstoque: d['lastEstoque'] as string | undefined,
    createdAt: paraData(d['createdAt']),
    updatedAt: paraData(d['updatedAt']),
  };
}

export async function buscarPerfil(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, COLECAO, uid));
  if (!snap.exists()) return null;
  return paraPerfil(snap.id, snap.data());
}

/**
 * Acompanha o perfil em tempo real.
 *
 * No 1.x o perfil era lido uma vez no login: promover alguém, ou mudar os estoques que ele
 * enxerga, só valia depois de fechar e abrir o app — e ninguém avisava o usuário disso.
 * Com o listener, a alteração feita pelo master chega ao celular na hora.
 */
export function ouvirPerfil(
  uid: string,
  aoMudar: (perfil: UserProfile | null) => void,
  aoFalhar?: (erro: unknown) => void,
): () => void {
  /*
    A queda deste listener é a mais traiçoeira das quatro: sem perfil, `papelDe()` devolve
    'comum', e o master perde os itens de menu sem entender por quê. Por isso ele também
    reabre sozinho — e `aoFalhar` continua sendo chamado, para o login não ficar preso na
    tela de carregamento enquanto as retentativas acontecem.
  */
  return assinaturaResiliente(
    (viva, falhou) =>
      onSnapshot(
        doc(db, COLECAO, uid),
        (snap) => {
          viva();
          aoMudar(snap.exists() ? paraPerfil(snap.id, snap.data()) : null);
        },
        (erro) => {
          aoFalhar?.(erro);
          falhou(erro);
        },
      ),
    { label: `perfil/${uid}` },
  );
}

/** Estoques que o usuário pode ver. Lista vazia = todos. Só master pode alterar. `abertura` é a lista que a tela abriu. */
export function salvarEstoquesPermitidos(
  uid: string,
  estoques: string[],
  abertura: string[],
): Promise<ResultadoGestao<string[]>> {
  return gravarCampoDeGestao({
    ref: doc(db, COLECAO, uid),
    rotulo: 'salvar estoques permitidos',
    abertura,
    pedido: estoques,
    ler: (dados) => estoquesPermitidos({ allowedInventories: dados?.['allowedInventories'] }),
    dados: (lista) => ({ allowedInventories: [...lista], updatedAt: new Date() }),
    exigeDocumento: true,
  });
}

export async function listarUsuarios(): Promise<UserProfile[]> {
  const snap = await getDocs(collection(db, COLECAO));
  return snap.docs
    .map((s: QueryDocumentSnapshot<DocumentData>) => paraPerfil(s.id, s.data()))
    .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? '', 'pt-BR'));
}

/** Nome exibível. Cai para o e-mail e, por último, para um rótulo genérico. */
export function nomeExibivel(perfil: UserProfile | null, emailAuth?: string | null): string {
  if (perfil) {
    const completo = [perfil.firstName, perfil.lastName].filter(Boolean).join(' ').trim();
    if (completo) return completo;
    if (perfil.displayName) return perfil.displayName;
    if (perfil.email) return perfil.email;
  }
  return emailAuth ?? 'Usuário';
}

/**
 * Guarda o último estoque aberto, para reabrir o app já no lugar certo.
 * Nunca bloqueia a interface: teto curto e falha silenciosa.
 */
export async function registrarUltimoEstoque(uid: string, inventoryId: string): Promise<void> {
  try {
    await withWriteTimeout(
      setDoc(doc(db, COLECAO, uid), { lastEstoque: inventoryId, updatedAt: new Date() }, { merge: true }),
      { ms: 3_000, label: 'último estoque' },
    );
  } catch (erro) {
    console.warn('[usuarios] Não foi possível registrar o último estoque:', erro);
  }
}

/** Altera o papel. Só master — a regra nega para os demais. `abertura` é o papel que a tela abriu. */
export function salvarPapeis(uid: string, papel: Papel, abertura: Papel): Promise<ResultadoGestao<Papel>> {
  return gravarCampoDeGestao({
    ref: doc(db, COLECAO, uid),
    rotulo: 'salvar papel',
    abertura,
    pedido: papel,
    ler: (dados) => papelDe(dados ?? null),
    dados: (p) => ({ ...flagsDoPapel(p), updatedAt: new Date() }),
    exigeDocumento: true,
  });
}
