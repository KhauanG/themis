import { useCallback, useEffect, useState } from 'react';
import {
  ROTULO_PAPEL,
  TEXTO_NADA_MUDOU,
  estoquesExistentes,
  estoquesPermitidos,
  flagsDoPapel,
  papelDe,
  semNenhumEstoque,
  textoEstoquesPermitidos,
  type Inventory,
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
import { CONTEXTO_GLOBAL, registrar } from '../../lib/historico.js';
import { mensagemDeFalha } from '../../lib/gestao-escrita.js';

const PAPEIS: Papel[] = ['comum', 'auditor', 'admin', 'master'];

const RECUSA = 'Sem permissão, ou o perfil desta pessoa tem um campo fora do padrão. Avise o dono.';

/** A etiqueta da linha: o que a pessoa enxerga. Id de estoque excluído não conta. */
function etiquetaDeAcesso(papel: Papel, permitidos: string[], estoques: Inventory[]): { texto: string; classe: string } {
  if (papel === 'master') return { texto: 'Master vê todos', classe: 'etiqueta--neutra' };
  if (permitidos.length === 0) return { texto: 'Todos os estoques', classe: 'etiqueta--neutra' };
  if (semNenhumEstoque(permitidos, estoques)) return { texto: 'Nenhum estoque', classe: 'etiqueta--critico' };
  const n = estoquesExistentes(permitidos, estoques).length;
  return { texto: `${n} ${n === 1 ? 'estoque' : 'estoques'}`, classe: 'etiqueta--acento' };
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
  // Só master abre esta tela, e master enxerga todos os estoques.
  const { estoques, autorLog } = useEstoque();
  const { mostrar } = useToast();

  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [editandoAcesso, setEditandoAcesso] = useState<UserProfile | null>(null);
  const [selecao, setSelecao] = useState<string[]>([]);
  // A lista do perfil como veio, com os ids de estoques excluídos: é o "de" da gravação.
  const [aberturaAcesso, setAberturaAcesso] = useState<string[]>([]);

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
      const r = await salvarPapeis(perfil.uid, papel, papelDe(perfil));
      if (r.resultado === 'NADA_MUDOU') {
        mostrar(TEXTO_NADA_MUDOU, 'info');
        return;
      }
      setUsuarios((atuais) =>
        atuais.map((u) => (u.uid === perfil.uid ? { ...u, ...flagsDoPapel(papel) } : u)),
      );

      // O histórico só sai depois do aceite do servidor, com o "de" que ele tinha.
      if (autorLog) {
        void registrar('ALTERAR_PAPEL', { ...autorLog, ...CONTEXTO_GLOBAL }, {
          usuario: `${nomeExibivel(perfil)} (${perfil.email ?? perfil.uid})`,
          papelDe: ROTULO_PAPEL[r.de],
          papelPara: ROTULO_PAPEL[papel],
        });
      }

      mostrar(`${nomeExibivel(perfil)} agora é ${ROTULO_PAPEL[papel]}.`, 'success');
    } catch (erro) {
      console.error('[usuarios] Falha ao salvar papel:', erro);
      mostrar(mensagemDeFalha(erro, { recusa: RECUSA }), 'error');
      recarregar();
    } finally {
      setSalvando(null);
    }
  }

  function abrirAcesso(perfil: UserProfile) {
    const abertura = estoquesPermitidos(perfil);
    setEditandoAcesso(perfil);
    setAberturaAcesso(abertura);
    // Id de estoque excluído não volta para a lista: a seleção começa só com os que existem.
    setSelecao(estoquesExistentes(abertura, estoques));
  }

  async function salvarAcesso() {
    if (!editandoAcesso) return;
    const alvo = editandoAcesso;
    // Quem tem ids mortos e vivos e não mexeu em nada ganharia um registro com "de" e "para"
    // iguais. Sem nenhum vivo a regra não vale: "Salvar sem marcar nada" tem de gravar.
    const vivos = estoquesExistentes(aberturaAcesso, estoques);
    if (vivos.length > 0 && JSON.stringify(selecao) === JSON.stringify(vivos)) {
      mostrar(TEXTO_NADA_MUDOU, 'info');
      setEditandoAcesso(null);
      return;
    }
    setSalvando(alvo.uid);
    try {
      const r = await salvarEstoquesPermitidos(alvo.uid, selecao, aberturaAcesso);
      if (r.resultado === 'NADA_MUDOU') {
        mostrar(TEXTO_NADA_MUDOU, 'info');
        setEditandoAcesso(null);
        return;
      }
      setUsuarios((atuais) =>
        atuais.map((u) => (u.uid === alvo.uid ? { ...u, allowedInventories: selecao } : u)),
      );

      if (autorLog) {
        void registrar('ALTERAR_PAPEL', { ...autorLog, ...CONTEXTO_GLOBAL }, {
          usuario: `${nomeExibivel(alvo)} (${alvo.email ?? alvo.uid})`,
          estoquesDe: textoEstoquesPermitidos(r.de, estoques),
          estoquesPara: textoEstoquesPermitidos(selecao, estoques),
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
      mostrar(mensagemDeFalha(erro, { recusa: RECUSA }), 'error');
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
          const acesso = etiquetaDeAcesso(papel, estoquesPermitidos(u), estoques);

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
                <span className={`etiqueta ${acesso.classe}`}>{acesso.texto}</span>

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

          {semNenhumEstoque(aberturaAcesso, estoques) && (
            <p className="aviso">
              Esta pessoa está sem nenhum estoque: os que ela tinha foram excluídos. Salvar sem
              marcar nada libera todos.
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
            Isto limita onde a pessoa conta e o que ela vê. As regras do servidor barram a
            gravação fora da lista.
          </p>
        </div>
      </Modal>
    </section>
  );
}
