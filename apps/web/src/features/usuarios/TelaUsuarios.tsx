import { useCallback, useEffect, useState } from 'react';
import { ROTULO_PAPEL, papelDe, type Papel, type UserProfile } from '@themis/shared';
import { useAuth } from '../../contexts/AuthContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Esqueleto } from '../../components/Esqueleto.js';
import { listarUsuarios, nomeExibivel, salvarPapeis } from '../../lib/usuarios-repo.js';

const PAPEIS: Papel[] = ['comum', 'auditor', 'admin', 'master'];

/** Flags gravadas no documento para cada papel. Um papel, um conjunto — sem combinação. */
function flagsDoPapel(papel: Papel): Pick<UserProfile, 'isAdmin' | 'isAuditor' | 'isMaster'> {
  return {
    isMaster: papel === 'master',
    isAdmin: papel === 'admin',
    isAuditor: papel === 'auditor',
  };
}

export function TelaUsuarios() {
  const { usuario } = useAuth();
  const { mostrar } = useToast();

  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    setCarregando(true);
    listarUsuarios()
      .then(setUsuarios)
      .catch((erro) => {
        console.warn('[usuarios] Listagem falhou:', erro);
        mostrar('Não foi possível carregar os usuários.', 'error');
      })
      .finally(() => setCarregando(false));
  }, [mostrar]);

  useEffect(recarregar, [recarregar]);

  async function trocarPapel(perfil: UserProfile, papel: Papel) {
    if (salvando) return;
    setSalvando(perfil.uid);
    try {
      await salvarPapeis(perfil.uid, flagsDoPapel(papel));
      setUsuarios((atuais) =>
        atuais.map((u) => (u.uid === perfil.uid ? { ...u, ...flagsDoPapel(papel) } : u)),
      );
      mostrar(`${nomeExibivel(perfil)} agora é ${ROTULO_PAPEL[papel]}.`, 'success');
    } catch (erro) {
      console.error('[usuarios] Falha ao salvar papel:', erro);
      mostrar('Não foi possível alterar o papel. Só master pode fazer isso.', 'error');
      recarregar();
    } finally {
      setSalvando(null);
    }
  }

  if (carregando) return <Esqueleto linhas={4} />;

  return (
    <section className="usuarios">
      <h2 className="secao__titulo">Usuários</h2>
      <p className="secao__sub">
        {usuarios.length} {usuarios.length === 1 ? 'usuário' : 'usuários'}. Criar e excluir conta
        continua no Console do Firebase; aqui só o papel.
      </p>

      <ul className="lista">
        {usuarios.map((u) => {
          const papel = papelDe(u);
          const euMesmo = u.uid === usuario?.uid;
          return (
            <li key={u.uid} className="usuario">
              <div className="usuario__info">
                <span className="usuario__nome">{nomeExibivel(u)}</span>
                <span className="usuario__email">{u.email ?? u.uid}</span>
              </div>

              <label className="usuario__papel">
                <span className="visualmente-oculto">Papel de {nomeExibivel(u)}</span>
                <select
                  className="campo__entrada"
                  value={papel}
                  disabled={salvando === u.uid || euMesmo}
                  // Rebaixar a si mesmo tira o acesso a esta tela e não há como voltar
                  // pelo app — só pelo Console.
                  title={euMesmo ? 'Você não pode alterar o próprio papel' : undefined}
                  onChange={(e) => void trocarPapel(u, e.target.value as Papel)}
                >
                  {PAPEIS.map((p) => (
                    <option key={p} value={p}>
                      {ROTULO_PAPEL[p]}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
