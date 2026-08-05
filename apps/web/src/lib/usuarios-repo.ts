/**
 * Coleção `users`: perfil e papéis.
 *
 * As Security Rules permitem que cada um leia o próprio documento; a lista completa é só
 * para master. O app 1.x tolerava flags gravadas como string ou número — `papelDe` em
 * `@themis/shared` mantém essa tolerância para não deslogar perfis antigos.
 */
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { UserProfile } from '@themis/shared';
import { db } from './firebase.js';
import { withWriteTimeout } from './firestore-write.js';

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

/** Altera papéis. Só master — a regra nega para os demais. */
export async function salvarPapeis(
  uid: string,
  papeis: Pick<UserProfile, 'isAdmin' | 'isAuditor' | 'isMaster'>,
): Promise<void> {
  await withWriteTimeout(
    setDoc(doc(db, COLECAO, uid), { ...papeis, updatedAt: new Date() }, { merge: true }),
    { label: 'salvar permissões' },
  );
}
