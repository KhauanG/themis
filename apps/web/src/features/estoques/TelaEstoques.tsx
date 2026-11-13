import { useCallback, useEffect, useState } from 'react';
import {
  TEXTO_FALHA,
  TEXTO_NADA_MUDOU,
  nomeEstoqueRepetido,
  podeAcessarEstoque,
  rotuloDaRodada,
  versaoAppValida,
  type Inventory,
} from '@themis/shared';
import { useAuth } from '../../contexts/AuthContext.js';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Icone } from '../../components/Icone.js';
import { Modal } from '../../components/Modal.js';
import {
  criarEstoque,
  excluirEstoque,
  novoIdDeEstoque,
  renomearEstoque,
  type CamposEstoque,
} from '../../lib/estoques-repo.js';
import { apagarHashDaLoja, lerHashesConfigurados, salvarHashDaLoja, testarHash, tomDoTeste } from '../../lib/erp.js';
import { salvarVersaoApp } from '../../lib/configuracoes-repo.js';
import { mensagemDeFalha } from '../../lib/gestao-escrita.js';
import { CONTEXTO_GLOBAL, registrar } from '../../lib/historico.js';

/** `abertura`: nome e descrição como a tela abriu. O id de um estoque novo nasce com o formulário e vale para todo "Criar". */
type Formulario = {
  id: string;
  novo: boolean;
  nome: string;
  descricao: string;
  hashLoja: string;
  abertura: CamposEstoque;
};

export function TelaEstoques() {
  const { permissoes, papel, perfil } = useAuth();
  // papelDe aceita "true" e 1, e a API não. O C2 garante que nenhum perfil está assim.
  const ehMaster = papel === 'master';
  const {
    estoques,
    todosEstoques,
    estoqueAtual,
    trocarEstoque,
    contextoLog,
    configuracoes,
    alterarModoContagem,
    autorLog,
  } = useEstoque();
  const { mostrar } = useToast();

  const [form, setForm] = useState<Formulario | null>(null);
  const [excluindo, setExcluindo] = useState<Inventory | null>(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [configurados, setConfigurados] = useState<Set<string>>(new Set());
  const [testando, setTestando] = useState(false);
  // A leitura falhou: o selo "sem HashLoja" pode estar errado.
  const [erroHashes, setErroHashes] = useState(false);
  const [salvandoModo, setSalvandoModo] = useState(false);
  // Campo da versão do app: `versaoAberta` é o último valor vindo do banco; `versaoSuja`, a pessoa digitou.
  const [versao, setVersao] = useState('');
  const [versaoAberta, setVersaoAberta] = useState('');
  const [versaoSuja, setVersaoSuja] = useState(false);
  const [salvandoVersao, setSalvandoVersao] = useState(false);
  // O estoque criado ainda pode não estar na lista (a transação não passa pelo cache): a troca espera.
  const [abrirQuandoChegar, setAbrirQuandoChegar] = useState<string | null>(null);

  const editando = form !== null && !form.novo;

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

  // `trocarEstoque` com o id fora da lista volta para o primeiro estoque e avisa de acesso perdido.
  useEffect(() => {
    if (abrirQuandoChegar && estoques.some((e) => e.id === abrirQuandoChegar)) {
      trocarEstoque(abrirQuandoChegar);
      setAbrirQuandoChegar(null);
    }
  }, [abrirQuandoChegar, estoques, trocarEstoque]);

  // Quem está digitando não perde o texto quando o listener entrega outro valor.
  useEffect(() => {
    if (versaoSuja) return;
    setVersao(configuracoes.versaoApp);
    setVersaoAberta(configuracoes.versaoApp);
  }, [configuracoes.versaoApp, versaoSuja]);

  async function alternarModoContagem() {
    setSalvandoModo(true);
    try {
      // O contexto grava, registra o histórico e avisa o erro.
      await alterarModoContagem(!configuracoes.modoContagem);
    } finally {
      setSalvandoModo(false);
    }
  }

  async function salvarVersao() {
    const texto = versao.trim();
    if (!versaoAppValida(texto)) {
      mostrar('Use números e pontos, como 5.4.0.', 'error');
      return;
    }
    setSalvandoVersao(true);
    try {
      const r = await salvarVersaoApp(texto, versaoAberta);
      if (r.resultado === 'NADA_MUDOU') {
        mostrar(TEXTO_NADA_MUDOU, 'info');
        return;
      }
      // O histórico só sai depois do aceite do servidor.
      if (autorLog) {
        void registrar('ALTERAR_CONFIGURACAO', { ...autorLog, ...CONTEXTO_GLOBAL }, {
          versaoAppDe: r.de,
          versaoAppPara: texto,
        });
      }
      mostrar('Versão mais nova do app salva.', 'success');
      setVersaoAberta(texto);
      setVersaoSuja(false);
    } catch (erro) {
      console.error('[configuracoes] Falha ao salvar a versão do app:', erro);
      mostrar(mensagemDeFalha(erro), 'error');
    } finally {
      setSalvandoVersao(false);
    }
  }

  async function testar() {
    if (!form || form.novo) return;
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
    const nome = form.nome.trim();
    const descricao = form.descricao.trim();
    if (nomeEstoqueRepetido(nome, todosEstoques, form.id)) {
      mostrar('Já existe um estoque com este nome.', 'error');
      return;
    }
    setOcupado(editando ? 'Salvando…' : 'Criando…');
    try {
      if (form.novo) {
        const r = await criarEstoque(form.id, nome, descricao);
        if (r === 'CONFLITO') {
          // O id é de outro estoque: o formulário segue aberto, com id novo.
          mostrar(TEXTO_FALHA, 'error');
          setForm((f) => (f ? { ...f, id: novoIdDeEstoque() } : f));
          return;
        }
        // CRIADO ou JA_EXISTIA (um reenvio depois de "Sem confirmação" que gravou): o histórico sai uma vez.
        if (autorLog) {
          void registrar('CRIAR_ESTOQUE', { ...autorLog, inventoryId: form.id, inventoryName: nome }, {
            estoque: nome,
            descricao,
          });
        }
        if (podeAcessarEstoque(perfil, papel, form.id)) {
          mostrar('Estoque criado. Importe a planilha para começar.', 'success');
          setAbrirQuandoChegar(form.id);
        } else {
          mostrar('Estoque criado. Peça a um master para liberar este estoque para você.', 'info');
        }
      } else {
        const id = form.id;
        const novoHash = form.hashLoja.trim();
        const r = await renomearEstoque(id, { nome, descricao }, form.abertura);

        // Vazio mantém o hash atual. Para a API, `''` apagaria.
        const hash = ehMaster && novoHash !== '' ? await salvarHashDaLoja(id, novoHash) : null;
        if (hash?.ok) setConfigurados((s) => new Set(s).add(id));

        if ((r.resultado !== 'NADA_MUDOU' || hash?.ok) && autorLog) {
          void registrar('EDITAR_ESTOQUE', { ...autorLog, inventoryId: id, inventoryName: nome }, {
            estoque: r.de.nome,
            nomeDe: r.de.nome,
            nomePara: nome,
            descricaoDe: r.de.descricao,
            descricaoPara: descricao,
            hashAlterado: hash?.ok === true,
          });
        }
        // O servidor aceitou: um segundo "Salvar" (hash que falhou) não renomeia nem registra o nome de novo.
        setForm((f) => (f ? { ...f, abertura: { nome, descricao } } : f));
        if (hash && !hash.ok) {
          // O nome já mudou. O modal fica aberto, com o hash digitado, para tentar de novo.
          mostrar(`Estoque salvo, mas o HashLoja não: ${hash.erro}`, 'error');
          return;
        }
        if (r.resultado === 'NADA_MUDOU' && !hash) {
          mostrar(TEXTO_NADA_MUDOU, 'info');
          return;
        }
        mostrar('Estoque atualizado.', 'success');
      }
      setForm(null);
    } catch (erro) {
      console.error('[estoques] Falha ao salvar:', erro);
      mostrar(
        mensagemDeFalha(
          erro,
          editando ? { recusa: 'Sem permissão. Renomear exige admin com acesso a este estoque.' } : {},
        ),
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
          {estoques.length} {estoques.length === 1 ? 'estoque cadastrado' : 'estoques cadastrados'}
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
            disabled={salvandoModo}
          >
            <span className="alternador__marca" aria-hidden="true" />
            Modo contagem
          </button>

          <p className="campo__ajuda">
            Ligado, bloqueia cadastrar, importar, editar cadastro, limpar contagem e apagar
            produtos — <strong>mesmo para admin</strong>. Serve para ninguém mexer no cadastro no
            meio da operação. Vale para todos os aparelhos, na hora.
          </p>

          <label className="campo">
            <span className="campo__rotulo">Versão mais nova do app</span>
            <input
              className="campo__entrada"
              value={versao}
              onChange={(e) => {
                setVersao(e.target.value);
                setVersaoSuja(true);
              }}
              inputMode="decimal"
              autoComplete="off"
            />
            <span className="campo__ajuda">
              Quem estiver numa versão menor vê o aviso de app desatualizado. Use números e
              pontos, como 5.4.0. Vazio desliga o aviso.
            </span>
          </label>
          <button
            className="botao botao--secundario"
            type="button"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => void salvarVersao()}
            disabled={salvandoVersao}
          >
            Salvar
          </button>
        </div>
      </div>

      <button
        className="botao botao--primario botao--largo"
        type="button"
        onClick={() =>
          setForm({
            id: novoIdDeEstoque(),
            novo: true,
            nome: '',
            descricao: '',
            hashLoja: '',
            abertura: { nome: '', descricao: '' },
          })
        }
        disabled={Boolean(ocupado)}
      >
        Novo estoque
      </button>

      <ul className="acoes-lista">
        {estoques.map((e) => {
          const atual = e.id === estoqueAtual?.id;
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
                </span>
              </span>

              <span className="acoes-linha">
                <button
                  className="botao botao--secundario botao--mini"
                  type="button"
                  onClick={() =>
                    setForm({
                      id: e.id,
                      novo: false,
                      nome: e.nome ?? '',
                      descricao: e.descricao ?? '',
                      hashLoja: '',
                      abertura: { nome: e.nome ?? '', descricao: e.descricao ?? '' },
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

          {/* `form && !form.novo` é o `editando`, com o tipo estreitado. */}
          {form && !form.novo && ehMaster && (
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
          {form && !form.novo &&
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
