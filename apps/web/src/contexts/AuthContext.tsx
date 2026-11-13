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
import {
  decidirPrimeiroAcesso,
  papelDe,
  perfilCompleto,
  permissoesDe,
  type EstadoPrimeiroAcesso,
  type LeituraDoServidor,
  type Papel,
  type Permissoes,
  type UserProfile,
} from '@themis/shared';
import { auth } from '../lib/firebase.js';
import { buscarPerfilDoServidor, nomeExibivel, ouvirPerfil } from '../lib/usuarios-repo.js';

interface AuthAPI {
  usuario: User | null;
  perfil: UserProfile | null;
  papel: Papel;
  permissoes: Permissoes;
  nome: string;
  carregando: boolean;
  /** Só `entra` deixa o app montar. Sem nome confirmado pelo servidor, o site pede o nome ou a internet. */
  primeiroAcesso: EstadoPrimeiroAcesso;
  tentarPerfilDeNovo: () => void;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
}

const Ctx = createContext<AuthAPI | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<UserProfile | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [servidor, setServidor] = useState<LeituraDoServidor>('pendente');
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let pararPerfil: (() => void) | null = null;

    const pararAuth = onAuthStateChanged(auth, (u) => {
      pararPerfil?.();
      pararPerfil = null;

      setUsuario(u);
      // Outra pessoa, outra leitura: a do servidor da anterior não vale.
      setServidor('pendente');
      if (!u) {
        setPerfil(null);
        setCarregando(false);
        return;
      }

      // Em tempo real: promover alguém, ou mudar os estoques que ele enxerga, passa a
      // valer no aparelho na hora — no 1.x só depois de fechar e abrir o app.
      //
      // Quem não tem perfil confirmado pelo servidor fica na tela de perfil (`primeiroAcesso`):
      // pedir o nome ou pedir internet, nunca entrar como comum sem documento.
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

  // Perfil ausente ou sem nome vindo do listener (que entrega o cache primeiro): só o servidor
  // decide se a tela "Como você se chama?" abre. Perfil completo nunca precisa disto.
  useEffect(() => {
    if (!usuario || carregando || perfilCompleto(perfil)) return;
    let vivo = true;
    setServidor('pendente');
    buscarPerfilDoServidor(usuario.uid).then(
      (lido) => {
        if (!vivo) return;
        if (lido && perfilCompleto(lido)) {
          setPerfil(lido);
          setServidor('completo');
        } else {
          setServidor('incompleto');
        }
      },
      () => {
        if (vivo) setServidor('falhou');
      },
    );
    return () => {
      vivo = false;
    };
  }, [usuario, carregando, perfil, tentativa]);

  const tentarPerfilDeNovo = useCallback(() => setTentativa((n) => n + 1), []);

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
      primeiroAcesso: decidirPrimeiroAcesso({ carregando, perfil, servidor }),
      tentarPerfilDeNovo,
      entrar,
      sair,
    }),
    [usuario, perfil, papel, carregando, servidor, tentarPerfilDeNovo, entrar, sair],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthAPI {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
