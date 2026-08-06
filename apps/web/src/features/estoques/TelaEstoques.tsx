import { useCallback, useEffect, useState } from 'react';
import type { Inventory } from '@themis/shared';
import { useAuth } from '../../contexts/AuthContext.js';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Icone } from '../../components/Icone.js';
import { Modal } from '../../components/Modal.js';
import { criarEstoque, excluirEstoque, renomearEstoque } from '../../lib/estoques-repo.js';
import { carregarHashes, salvarHashes, testarHash } from '../../lib/erp.js';
import { registrar } from '../../lib/historico.js';

type Formulario = { id: string | null; nome: string; descricao: string; hashLoja: string };

const VAZIO: Formulario = { id: null, nome: '', descricao: '', hashLoja: '' };

export function TelaEstoques() {
  const { permissoes } = useAuth();
  const { estoques, estoqueAtual, trocarEstoque, contextoLog } = useEstoque();
  const { mostrar } = useToast();

  const [form, setForm] = useState<Formulario | null>(null);
  const [excluindo, setExcluindo] = useState<Inventory | null>(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [hashes, setHashes] = useState<Map<string, string>>(new Map());
  const [testando, setTestando] = useState(false);

  const editando = form?.id != null;

  const recarregarHashes = useCallback(() => {
    carregarHashes()
      .then(setHashes)
      .catch((erro) => console.warn('[estoques] Não foi possível ler os hashes:', erro));
  }, []);

  useEffect(recarregarHashes, [recarregarHashes]);

  /**
   * O hash vive num documento separado (`hashConfigs/inventoryHashes`), não no documento
   * do estoque. Salvar os dois juntos aqui evita que alguém crie um estoque e só descubra
   * na hora de corrigir que falta a amarração com o ERP.
   */
  async function salvarHashDoEstoque(inventoryId: string, hash: string) {
    const novo = new Map(hashes);
    if (hash.trim() === '') novo.delete(inventoryId);
    else novo.set(inventoryId, hash.trim());
    await salvarHashes(novo);
    setHashes(novo);
  }

  async function testar() {
    const hash = form?.hashLoja.trim();
    if (!hash) return;
    setTestando(true);
    try {
      const r = await testarHash(hash);
      if (r.ok) mostrar(`Hash válido — o ERP devolveu ${r.itens} produtos.`, 'success');
      else if (r.erro) mostrar(`Falha ao consultar o ERP: ${r.erro}`, 'error');
      // Hash errado devolve lista vazia em vez de erro; por isso a mensagem é específica.
      else mostrar('O ERP respondeu, mas não devolveu nenhum produto. Confira o hash.', 'warning');
    } finally {
      setTestando(false);
    }
  }

  async function salvar() {
    if (!form || !form.nome.trim()) return;
    setOcupado(editando ? 'Salvando…' : 'Criando…');
    try {
      if (form.id) {
        await renomearEstoque(form.id, form.nome, form.descricao);
        await salvarHashDoEstoque(form.id, form.hashLoja);
        mostrar('Estoque atualizado.', 'success');
      } else {
        const id = await criarEstoque(form.nome, form.descricao);
        await salvarHashDoEstoque(id, form.hashLoja);
        mostrar('Estoque criado. Importe a planilha para começar.', 'success');
        trocarEstoque(id);
      }
      setForm(null);
    } catch (erro) {
      console.error('[estoques] Falha ao salvar:', erro);
      mostrar('Não foi possível salvar. Só admin ou master pode alterar estoques.', 'error');
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
                  {e.descricao ? `${e.descricao} · ` : ''}Ciclo {e.contagemCycle ?? 1}
                  {' · '}
                  {hashes.has(e.id) ? (
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
                      nome: e.nome ?? '',
                      descricao: e.descricao ?? '',
                      hashLoja: hashes.get(e.id) ?? '',
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

          <label className="campo">
            <span className="campo__rotulo">HashLoja (ERP)</span>
            <input
              className="campo__entrada"
              value={form?.hashLoja ?? ''}
              onChange={(e) => setForm((f) => (f ? { ...f, hashLoja: e.target.value } : f))}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="campo__ajuda">
              É o que amarra este estoque à loja no ERP. Sem ele, Buscar estoque e Corrigir
              estoque não funcionam.
            </span>
          </label>

          {form?.hashLoja.trim() && (
            <button
              className="botao botao--secundario botao--largo"
              type="button"
              onClick={() => void testar()}
              disabled={testando}
            >
              {testando ? 'Consultando o ERP…' : 'Testar hash'}
            </button>
          )}

          {!editando && (
            <p className="aviso aviso--info">
              O estoque nasce vazio, no ciclo 1. Importe a planilha em Produtos para
              carregar os itens.
            </p>
          )}
        </div>
      </Modal>

      <Modal
        aberto={excluindo !== null}
        titulo="Excluir estoque"
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
            <strong>todos os produtos dentro dele</strong>, incluindo as contagens do ciclo
            atual.
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
