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
import { nomeExibivel, ouvirPerfil } from '../lib/usuarios-repo.js';

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
    let pararPerfil: (() => void) | null = null;

    const pararAuth = onAuthStateChanged(auth, (u) => {
      pararPerfil?.();
      pararPerfil = null;

      setUsuario(u);
      if (!u) {
        setPerfil(null);
        setCarregando(false);
        return;
      }

      // Em tempo real: promover alguém, ou mudar os estoques que ele enxerga, passa a
      // valer no aparelho na hora — no 1.x só depois de fechar e abrir o app.
      //
      // Falha aqui não impede o login: o usuário entra como comum, e o Firestore nega o
      // que ele não puder fazer de qualquer jeito.
      pararPerfil = ouvirPerfil(
        u.uid,
        (p) => {
          setPerfil(p);
          setCarregando(false);
        },
        () => setCarregando(false),
      );
    });

    return () => {
      pararPerfil?.();
      pararAuth();
    };
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
