import { useCallback, useEffect, useState } from 'react';
import { rotuloDaRodada, type Inventory } from '@themis/shared';
import { useAuth } from '../../contexts/AuthContext.js';
import { isPermissaoNegada } from '../../lib/fila-offline.js';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Icone } from '../../components/Icone.js';
import { Modal } from '../../components/Modal.js';
import { criarEstoque, excluirEstoque, renomearEstoque } from '../../lib/estoques-repo.js';
import { apagarHashDaLoja, lerHashesConfigurados, salvarHashDaLoja, testarHash, tomDoTeste } from '../../lib/erp.js';
import { registrar } from '../../lib/historico.js';

type Formulario = { id: string | null; nome: string; descricao: string; hashLoja: string };

const VAZIO: Formulario = { id: null, nome: '', descricao: '', hashLoja: '' };

export function TelaEstoques() {
  const { permissoes, papel } = useAuth();
  // papelDe aceita "true" e 1, e a API não. O C2 garante que nenhum perfil está assim.
  const ehMaster = papel === 'master';
  const { estoques, estoqueAtual, trocarEstoque, contextoLog, configuracoes, alterarConfiguracoes } =
    useEstoque();
  const { mostrar } = useToast();

  const [form, setForm] = useState<Formulario | null>(null);
  const [excluindo, setExcluindo] = useState<Inventory | null>(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [configurados, setConfigurados] = useState<Set<string>>(new Set());
  const [testando, setTestando] = useState(false);
  // A leitura falhou: o selo "sem HashLoja" pode estar errado.
  const [erroHashes, setErroHashes] = useState(false);

  const editando = form?.id != null;

  const recarregarHashes = useCallback(() => {
    lerHashesConfigurados()
      .then((lidos) => {
        setConfigurados(lidos);
        setErroHashes(false);
      })
      .catch((erro) => {
        console.warn('[estoques] Não foi possível ler os hashes:', erro);
        setErroHashes(true);
      });
  }, []);

  useEffect(recarregarHashes, [recarregarHashes]);

  /** Travar ou destravar a contagem de um estoque. Reflete em todos os aparelhos. */
  async function alternarSomenteLeitura(inventoryId: string) {
    const atual = configuracoes.somenteLeitura;
    const travando = !atual.includes(inventoryId);
    const novo = travando
      ? [...atual, inventoryId]
      : atual.filter((id) => id !== inventoryId);

    await alterarConfiguracoes({ somenteLeitura: novo });

    if (contextoLog) {
      const nome = estoques.find((e) => e.id === inventoryId)?.nome ?? inventoryId;
      void registrar('ALTERAR_CONFIGURACAO', contextoLog, {
        [travando ? 'estoqueTravado' : 'estoqueLiberado']: nome,
      });
    }
  }

  async function alternarMostrarCiclo() {
    await alterarConfiguracoes({ mostrarCiclo: !configuracoes.mostrarCiclo });
  }

  async function alternarModoContagem() {
    const antes = configuracoes.modoContagem;
    await alterarConfiguracoes({ modoContagem: !antes });
    if (contextoLog) {
      void registrar('ALTERAR_CONFIGURACAO', contextoLog, {
        modoContagemDe: antes,
        modoContagemPara: !antes,
      });
    }
  }

  async function testar() {
    if (!form?.id) return;
    setTestando(true);
    try {
      // Sem texto no campo, a API testa o hash salvo.
      const r = await testarHash(form.id, form.hashLoja.trim() || undefined);
      mostrar(r.mensagem, tomDoTeste(r));
    } finally {
      setTestando(false);
    }
  }

  async function salvar() {
    if (!form || !form.nome.trim()) return;
    setOcupado(editando ? 'Salvando…' : 'Criando…');
    try {
      if (form.id) {
        const id = form.id;
        const antes = estoques.find((e) => e.id === id);
        const novoHash = form.hashLoja.trim();
        await renomearEstoque(id, form.nome, form.descricao);

        // Vazio mantém o hash atual. Para a API, `''` apagaria.
        const hash = ehMaster && novoHash !== '' ? await salvarHashDaLoja(id, novoHash) : null;
        if (hash?.ok) setConfigurados((s) => new Set(s).add(id));

        if (contextoLog) {
          void registrar('EDITAR_ESTOQUE', contextoLog, {
            estoque: antes?.nome ?? form.nome,
            nomeDe: antes?.nome ?? '',
            nomePara: form.nome.trim(),
            descricaoDe: antes?.descricao ?? '',
            descricaoPara: form.descricao.trim(),
            hashAlterado: hash?.ok === true,
          });
        }
        if (hash && !hash.ok) {
          // O nome já mudou. O modal fica aberto, com o hash digitado, para tentar de novo.
          mostrar(`Estoque salvo, mas o HashLoja não: ${hash.erro}`, 'error');
          return;
        }
        mostrar('Estoque atualizado.', 'success');
      } else {
        const id = await criarEstoque(form.nome, form.descricao);

        if (contextoLog) {
          void registrar('CRIAR_ESTOQUE', contextoLog, {
            estoque: form.nome.trim(),
            descricao: form.descricao.trim(),
          });
        }
        mostrar('Estoque criado. Importe a planilha para começar.', 'success');
        trocarEstoque(id);
      }
      setForm(null);
    } catch (erro) {
      console.error('[estoques] Falha ao salvar:', erro);
      mostrar(
        isPermissaoNegada(erro)
          ? 'Sem permissão. Alterar estoque exige admin.'
          : 'Não foi possível salvar. Verifique a conexão e tente de novo.',
        'error',
      );
    } finally {
      setOcupado('');
    }
  }

  async function excluir() {
    if (!excluindo) return;
    const alvo = excluindo;
    setExcluindo(null);
    setConfirmacao('');
    setOcupado('Apagando produtos…');
    try {
      const total = await excluirEstoque(alvo.id, (feitos, tudo) =>
        setOcupado(`Apagando produtos… ${feitos} de ${tudo}`),
      );
      // Só depois da exclusão (spec 4.7). Se falhar, a chave fica órfã, ninguém a lê, e a limpeza do dono a tira.
      const r = await apagarHashDaLoja(alvo.id);
      if (!r.ok) console.warn('[estoques] O HashLoja do estoque excluído ficou no servidor:', r.erro);
      setConfigurados((s) => { const n = new Set(s); n.delete(alvo.id); return n; });
      mostrar(`Estoque excluído, com ${total} ${total === 1 ? 'produto' : 'produtos'}.`, 'success');
      if (contextoLog) {
        void registrar('EXCLUIR_ESTOQUE', contextoLog, { estoque: alvo.nome, produtos: total });
      }
    } catch (erro) {
      console.error('[estoques] Exclusão falhou:', erro);
      mostrar('Não foi possível excluir. Só master pode apagar estoques.', 'error');
    } finally {
      setOcupado('');
    }
  }

  const nomeConfere = excluindo ? confirmacao.trim() === (excluindo.nome ?? '').trim() : false;

  return (
    <section className="pilha-g">
      <div>
        <h1 className="titulo-tela">Estoques</h1>
        <p className="subtitulo">
          {estoques.length} {estoques.length === 1 ? 'estoque' : 'estoques'} cadastrados
        </p>
      </div>

      {ocupado && (
        <p className="aviso aviso--info" role="status">
          {ocupado}
        </p>
      )}

      {erroHashes && (
        <p className="aviso aviso--perigo" role="alert">
          Não foi possível ler quais estoques têm HashLoja. A lista pode mostrar "sem HashLoja" por
          engano. Recarregue a página.
        </p>
      )}

      <div className="cartao">
        <div className="cartao__corpo pilha">
          <p className="rotulo-secao">Configurações globais</p>

          <button
            type="button"
            className={configuracoes.modoContagem ? 'alternador alternador--ligado' : 'alternador'}
            onClick={() => void alternarModoContagem()}
            aria-pressed={configuracoes.modoContagem}
          >
            <span className="alternador__marca" aria-hidden="true" />
            Modo contagem
          </button>

          <p className="campo__ajuda">
            Ligado, bloqueia importar planilha e limpar contagem — <strong>mesmo para
            admin</strong>. Serve para ninguém apagar a contagem no meio da operação. Vale
            para todos os aparelhos, na hora.
          </p>

          {/*
            Interruptor de transição. Nasce ligado e a ideia é desligá-lo quando a equipe
            estiver usando só lote — por isso o texto diz o que acontece ao desligar, e não
            só o que ele é.
          */}
          <button
            type="button"
            className={configuracoes.mostrarCiclo ? 'alternador alternador--ligado' : 'alternador'}
            onClick={() => void alternarMostrarCiclo()}
            aria-pressed={configuracoes.mostrarCiclo}
          >
            <span className="alternador__marca" aria-hidden="true" />
            Mostrar o ciclo junto do lote
          </button>

          <p className="campo__ajuda">
            Ligado, a auditoria mostra <strong>Lote X · Ciclo N</strong>. Serve para a
            transição: quem procura uma contagem antiga ainda tem o número do ciclo na
            cabeça. Desligue quando a equipe estiver usando só o lote — o ciclo some da tela
            e continua existindo como número interno. Contagem salva antes do lote mostra o
            ciclo de qualquer jeito: é a única identificação que ela tem.
          </p>
        </div>
      </div>

      <button
        className="botao botao--primario botao--largo"
        type="button"
        onClick={() => setForm(VAZIO)}
        disabled={Boolean(ocupado)}
      >
        Novo estoque
      </button>

      <ul className="acoes-lista">
        {estoques.map((e) => {
          const atual = e.id === estoqueAtual?.id;
          const travado = configuracoes.somenteLeitura.includes(e.id);
          return (
            <li key={e.id} className="acao" style={{ cursor: 'default' }}>
              <span className="acao__icone">
                <Icone nome="produtos" />
              </span>

              <span className="acao__texto">
                <span className="acao__titulo">
                  {e.nome}
                  {atual && (
                    <span className="etiqueta etiqueta--acento" style={{ marginLeft: 'var(--e2)' }}>
                      Atual
                    </span>
                  )}
                </span>
                <span className="acao__descricao">
                  {e.descricao ? `${e.descricao} · ` : ''}{rotuloDaRodada(e)}
                  {' · '}
                  {configurados.has(e.id) ? (
                    <span className="etiqueta etiqueta--ok">ERP ligado</span>
                  ) : (
                    <span className="etiqueta etiqueta--alerta">sem HashLoja</span>
                  )}
                  {travado && (
                    <>
                      {' '}
                      <span className="etiqueta etiqueta--critico">somente leitura</span>
                    </>
                  )}
                </span>
              </span>

              <span className="acoes-linha">
                <button
                  className={
                    travado
                      ? 'botao botao--perigo botao--mini'
                      : 'botao botao--secundario botao--mini'
                  }
                  type="button"
                  onClick={() => void alternarSomenteLeitura(e.id)}
                  disabled={Boolean(ocupado)}
                  title={
                    travado
                      ? 'Destravar: a equipe volta a poder contar'
                      : 'Travar: ninguém consegue contar neste estoque'
                  }
                >
                  {travado ? 'Travado' : 'Travar'}
                </button>

                <button
                  className="botao botao--secundario botao--mini"
                  type="button"
                  onClick={() =>
                    setForm({
                      id: e.id,
                      nome: e.nome ?? '',
                      descricao: e.descricao ?? '',
                      hashLoja: '',
                    })
                  }
                  disabled={Boolean(ocupado)}
                >
                  Editar
                </button>
                {permissoes.gerenciarUsuarios && (
                  <button
                    className="botao botao--perigo botao--mini"
                    type="button"
                    onClick={() => setExcluindo(e)}
                    // Excluir o estoque aberto deixaria o app sem contexto no meio da
                    // operação. Troque de estoque antes.
                    disabled={Boolean(ocupado) || atual}
                    title={atual ? 'Troque de estoque antes de excluir este' : undefined}
                  >
                    Excluir
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <Modal
        aberto={form !== null}
        titulo={editando ? 'Renomear estoque' : 'Novo estoque'}
        onFechar={() => setForm(null)}
        rodape={
          <>
            <button className="botao botao--secundario" type="button" onClick={() => setForm(null)}>
              Cancelar
            </button>
            <button
              className="botao botao--primario"
              type="button"
              onClick={() => void salvar()}
              disabled={!form?.nome.trim() || Boolean(ocupado)}
            >
              {editando ? 'Salvar' : 'Criar'}
            </button>
          </>
        }
      >
        <div className="pilha">
          <label className="campo">
            <span className="campo__rotulo">Nome</span>
            <input
              className="campo__entrada"
              value={form?.nome ?? ''}
              onChange={(e) => setForm((f) => (f ? { ...f, nome: e.target.value } : f))}
              maxLength={100}
              autoFocus
            />
            <span className="campo__ajuda">É o que aparece no topo do app. Até 100 caracteres.</span>
          </label>

          <label className="campo">
            <span className="campo__rotulo">Descrição</span>
            <input
              className="campo__entrada"
              value={form?.descricao ?? ''}
              onChange={(e) => setForm((f) => (f ? { ...f, descricao: e.target.value } : f))}
            />
            <span className="campo__ajuda">Opcional. Ex.: endereço ou responsável.</span>
          </label>

          {/* `form?.id != null` é o `editando`, com o tipo estreitado. */}
          {form?.id != null && ehMaster && (
            <label className="campo">
              <span className="campo__rotulo">Novo HashLoja (ERP)</span>
              {/* O Chrome ignora `off` em campo de senha e ofereceria salvar o hash como senha. */}
              <input
                className="campo__entrada"
                type="password"
                value={form.hashLoja}
                onChange={(e) => setForm((f) => (f ? { ...f, hashLoja: e.target.value } : f))}
                autoComplete="one-time-code"
                spellCheck={false}
              />
              <span className="campo__ajuda">
                {!erroHashes &&
                  (configurados.has(form.id)
                    ? 'Este estoque já tem HashLoja. '
                    : 'Este estoque ainda não tem HashLoja. ')}
                Por segurança, o salvo nunca aparece. Cole um novo só para trocar; vazio mantém o
                atual.
              </span>
            </label>
          )}

          {/* Sem hash salvo, a API responde 409. Com a leitura falha, a tela não sabe. */}
          {form?.id != null &&
            (form.hashLoja.trim() !== '' || configurados.has(form.id) || erroHashes) && (
              <button
                className="botao botao--secundario botao--largo"
                type="button"
                onClick={() => void testar()}
                disabled={testando}
              >
                {testando
                  ? 'Consultando o ERP…'
                  : form.hashLoja.trim() !== ''
                    ? 'Testar o hash digitado'
                    : 'Testar o hash salvo'}
              </button>
            )}

          {!editando && (
            <p className="aviso aviso--info">
              O estoque nasce vazio e sem lote. Importe a planilha em Produtos para
              carregar os itens. Ele nasce sem HashLoja; o master cola o hash depois, em Editar.
            </p>
          )}
        </div>
      </Modal>

      <Modal
        aberto={excluindo !== null}
        titulo="Excluir estoque e reiniciar Lote"
        onFechar={() => {
          setExcluindo(null);
          setConfirmacao('');
        }}
        rodape={
          <>
            <button
              className="botao botao--secundario"
              type="button"
              onClick={() => {
                setExcluindo(null);
                setConfirmacao('');
              }}
            >
              Cancelar
            </button>
            <button
              className="botao botao--perigo"
              type="button"
              onClick={() => void excluir()}
              disabled={!nomeConfere}
            >
              Excluir
            </button>
          </>
        }
      >
        <div className="pilha">
          <p>
            Apaga <strong>{excluindo?.nome}</strong> e{' '}
            <strong>todos os produtos dentro dele</strong>, incluindo a contagem em andamento.
          </p>
          <p className="aviso aviso--perigo">
            Não dá para desfazer. As auditorias já salvas continuam existindo — elas guardam
            uma cópia própria dos produtos.
          </p>

          <label className="campo">
            <span className="campo__rotulo">
              Digite <strong>{excluindo?.nome}</strong> para confirmar
            </span>
            <input
              className="campo__entrada"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              autoComplete="off"
            />
          </label>
        </div>
      </Modal>
    </section>
  );
}
