import { useCallback, useEffect, useState } from 'react';
import {
  ROTULO_PAPEL,
  estoquesPermitidos,
  papelDe,
  semRestricaoDeEstoque,
  type Papel,
  type UserProfile,
} from '@themis/shared';
import { useAuth } from '../../contexts/AuthContext.js';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Esqueleto } from '../../components/Esqueleto.js';
import { Modal } from '../../components/Modal.js';
import {
  listarUsuarios,
  nomeExibivel,
  salvarEstoquesPermitidos,
  salvarPapeis,
} from '../../lib/usuarios-repo.js';
import { registrar } from '../../lib/historico.js';

const PAPEIS: Papel[] = ['comum', 'auditor', 'admin', 'master'];

/** Flags gravadas no documento para cada papel. Um papel, um conjunto — sem combinação. */
function flagsDoPapel(papel: Papel): Pick<UserProfile, 'isAdmin' | 'isAuditor' | 'isMaster'> {
  return {
    isMaster: papel === 'master',
    isAdmin: papel === 'admin',
    isAuditor: papel === 'auditor',
  };
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0]![0] ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1]![0] ?? '') : '';
  return (primeira + ultima).toUpperCase();
}

export function TelaUsuarios() {
  const { usuario } = useAuth();
  // A lista completa, sem o filtro de permissão: o master precisa poder conceder acesso
  // a estoques que ele mesmo não abriria no dia a dia.
  const { estoques, contextoLog } = useEstoque();
  const { mostrar } = useToast();

  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [editandoAcesso, setEditandoAcesso] = useState<UserProfile | null>(null);
  const [selecao, setSelecao] = useState<string[]>([]);

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
    const papelAnterior = papelDe(perfil);
    try {
      await salvarPapeis(perfil.uid, flagsDoPapel(papel));
      setUsuarios((atuais) =>
        atuais.map((u) => (u.uid === perfil.uid ? { ...u, ...flagsDoPapel(papel) } : u)),
      );

      if (contextoLog) {
        void registrar('ALTERAR_PAPEL', contextoLog, {
          usuario: `${nomeExibivel(perfil)} (${perfil.email ?? perfil.uid})`,
          papelDe: ROTULO_PAPEL[papelAnterior],
          papelPara: ROTULO_PAPEL[papel],
        });
      }

      mostrar(`${nomeExibivel(perfil)} agora é ${ROTULO_PAPEL[papel]}.`, 'success');
    } catch (erro) {
      console.error('[usuarios] Falha ao salvar papel:', erro);
      mostrar('Não foi possível alterar o papel. Só master pode fazer isso.', 'error');
      recarregar();
    } finally {
      setSalvando(null);
    }
  }

  function abrirAcesso(perfil: UserProfile) {
    setEditandoAcesso(perfil);
    setSelecao(estoquesPermitidos(perfil));
  }

  async function salvarAcesso() {
    if (!editandoAcesso) return;
    const alvo = editandoAcesso;
    setSalvando(alvo.uid);
    try {
      await salvarEstoquesPermitidos(alvo.uid, selecao);
      setUsuarios((atuais) =>
        atuais.map((u) => (u.uid === alvo.uid ? { ...u, allowedInventories: selecao } : u)),
      );

      if (contextoLog) {
        const nomes = selecao
          .map((id) => estoques.find((e) => e.id === id)?.nome ?? id)
          .join(', ');
        void registrar('ALTERAR_PAPEL', contextoLog, {
          usuario: `${nomeExibivel(alvo)} (${alvo.email ?? alvo.uid})`,
          papelDe: `${estoquesPermitidos(alvo).length || 'todos os'} estoques`,
          papelPara: selecao.length === 0 ? 'todos os estoques' : nomes,
        });
      }

      mostrar(
        selecao.length === 0
          ? `${nomeExibivel(alvo)} passa a ver todos os estoques.`
          : `${nomeExibivel(alvo)} passa a ver ${selecao.length} ${selecao.length === 1 ? 'estoque' : 'estoques'}.`,
        'success',
      );
      setEditandoAcesso(null);
    } catch (erro) {
      console.error('[usuarios] Falha ao salvar acesso:', erro);
      mostrar('Não foi possível salvar. Só master pode alterar isto.', 'error');
    } finally {
      setSalvando(null);
    }
  }

  function alternar(inventoryId: string) {
    setSelecao((atual) =>
      atual.includes(inventoryId)
        ? atual.filter((id) => id !== inventoryId)
        : [...atual, inventoryId],
    );
  }

  if (carregando) return <Esqueleto linhas={4} />;

  const alvoEhMaster = editandoAcesso ? papelDe(editandoAcesso) === 'master' : false;

  return (
    <section className="pilha-g">
      <div>
        <h1 className="titulo-tela">Usuários</h1>
        <p className="subtitulo">
          {usuarios.length} {usuarios.length === 1 ? 'usuário' : 'usuários'}. Criar e excluir conta
          continua no Console do Firebase.
        </p>
      </div>

      <ul className="pilha">
        {usuarios.map((u) => {
          const papel = papelDe(u);
          const euMesmo = u.uid === usuario?.uid;
          const nome = nomeExibivel(u);
          const permitidos = estoquesPermitidos(u);
          const tudo = semRestricaoDeEstoque(u, papel);

          return (
            <li key={u.uid} className="usuario usuario--coluna">
              <div className="usuario__linha">
                <span className="usuario__avatar" aria-hidden="true">
                  {iniciais(nome)}
                </span>

                <div className="usuario__info">
                  <p className="usuario__nome">{nome}</p>
                  <p className="usuario__email">{u.email ?? u.uid}</p>
                </div>

                <label className="usuario__papel">
                  <span className="oculto-visual">Papel de {nome}</span>
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
              </div>

              <div className="usuario__acesso">
                <span className={tudo ? 'etiqueta etiqueta--neutra' : 'etiqueta etiqueta--acento'}>
                  {papel === 'master'
                    ? 'Master vê todos'
                    : tudo
                      ? 'Todos os estoques'
                      : `${permitidos.length} ${permitidos.length === 1 ? 'estoque' : 'estoques'}`}
                </span>

                <button
                  className="botao botao--secundario botao--mini"
                  type="button"
                  onClick={() => abrirAcesso(u)}
                  disabled={salvando === u.uid}
                >
                  Estoques
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        aberto={editandoAcesso !== null}
        titulo={`Estoques de ${editandoAcesso ? nomeExibivel(editandoAcesso) : ''}`}
        onFechar={() => setEditandoAcesso(null)}
        rodape={
          <>
            <button
              className="botao botao--secundario"
              type="button"
              onClick={() => setEditandoAcesso(null)}
            >
              Cancelar
            </button>
            <button
              className="botao botao--primario"
              type="button"
              onClick={() => void salvarAcesso()}
              disabled={salvando !== null}
            >
              Salvar
            </button>
          </>
        }
      >
        <div className="pilha">
          <p className="subtitulo">
            Marque os estoques que esta pessoa deve ver. <strong>Nenhum marcado significa
            todos</strong> — é o padrão de quem nunca foi configurado.
          </p>

          {alvoEhMaster && (
            <p className="aviso">
              Master enxerga todos os estoques de qualquer forma. Esta lista só passa a valer
              se o papel mudar.
            </p>
          )}

          <ul className="pilha">
            {estoques.map((e) => {
              const marcado = selecao.includes(e.id);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    className={marcado ? 'alternador alternador--ligado' : 'alternador'}
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                    onClick={() => alternar(e.id)}
                    aria-pressed={marcado}
                  >
                    <span className="alternador__marca" aria-hidden="true" />
                    {e.nome}
                  </button>
                </li>
              );
            })}
          </ul>

          {selecao.length > 0 && (
            <p className="campo__ajuda">
              Verá {selecao.length} de {estoques.length} estoques.
            </p>
          )}

          <p className="aviso aviso--info">
            Isto organiza a visão de cada um — evita contar no estoque errado. Não é barreira
            de segurança: as regras do Firestore liberam qualquer estoque para quem está
            autenticado.
          </p>
        </div>
      </Modal>
    </section>
  );
}
