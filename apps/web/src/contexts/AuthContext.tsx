import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { papelDe, permissoesDe, type Papel, type Permissoes, type UserProfile } from '@themis/shared';
import { auth } from '../lib/firebase.js';
import { buscarPerfil, nomeExibivel } from '../lib/usuarios-repo.js';

interface AuthAPI {
  usuario: User | null;
  perfil: UserProfile | null;
  papel: Papel;
  permissoes: Permissoes;
  nome: string;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
}

const Ctx = createContext<AuthAPI | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<UserProfile | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUsuario(u);
      if (!u) {
        setPerfil(null);
        setCarregando(false);
        return;
      }
      // O perfil traz os papéis. Falha de rede aqui não impede o login: o usuário
      // entra como comum e o Firestore nega o que ele não puder fazer de qualquer jeito.
      buscarPerfil(u.uid)
        .then(setPerfil)
        .catch((erro) => {
          console.warn('[auth] Não foi possível carregar o perfil:', erro);
          setPerfil(null);
        })
        .finally(() => setCarregando(false));
    });
  }, []);

  const entrar = useCallback(async (email: string, senha: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), senha);
  }, []);

  const sair = useCallback(async () => {
    await signOut(auth);
  }, []);

  const papel = useMemo(() => papelDe(perfil), [perfil]);

  const valor = useMemo<AuthAPI>(
    () => ({
      usuario,
      perfil,
      papel,
      permissoes: permissoesDe(papel),
      nome: nomeExibivel(perfil, usuario?.email),
      carregando,
      entrar,
      sair,
    }),
    [usuario, perfil, papel, carregando, entrar, sair],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthAPI {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
