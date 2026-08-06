import { useState } from 'react';
import {
  codigoBarrasDe,
  idProdutoDe,
  isItemContado,
  nomeDe,
  sistemaDe,
  type Produto,
} from '@themis/shared';
import { useAuth } from '../../contexts/AuthContext.js';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Modal } from '../../components/Modal.js';
import { atualizarCadastroProduto, excluirProduto } from '../../lib/produtos-repo.js';

interface Props {
  produto: Produto | null;
  onFechar: () => void;
}

/**
 * Edição de cadastro do produto.
 *
 * Cadastro e contagem são coisas separadas: aqui se altera nome, código de barras, saldo
 * do sistema e código do ERP. A quantidade contada não aparece — corrigir um nome não pode
 * apagar o trabalho do funcionário.
 */
export function ModalEditarProduto({ produto, onFechar }: Props) {
  const { permissoes } = useAuth();
  const { estoqueAtual } = useEstoque();
  const { mostrar } = useToast();

  const [form, setForm] = useState({ nome: '', codigoBarras: '', estoqueSistema: '', idProduto: '' });
  const [iniciado, setIniciado] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  // Preenche uma vez por produto, sem `useEffect`: assim o formulário não é reescrito
  // quando o listener do Firestore entrega um objeto novo enquanto o usuário digita.
  if (produto && iniciado !== produto.id) {
    setIniciado(produto.id);
    setConfirmandoExclusao(false);
    setForm({
      nome: nomeDe(produto),
      codigoBarras: codigoBarrasDe(produto) ?? '',
      estoqueSistema: String(sistemaDe(produto)),
      idProduto: String(idProdutoDe(produto) ?? ''),
    });
  }

  async function salvar() {
    if (!produto || !estoqueAtual || !form.nome.trim() || salvando) return;
    setSalvando(true);
    try {
      await atualizarCadastroProduto(estoqueAtual.id, produto.id, {
        nome: form.nome,
        codigoBarras: form.codigoBarras,
        estoqueSistema: Number(form.estoqueSistema) || 0,
        idProduto: form.idProduto,
      });
      mostrar('Produto atualizado.', 'success');
      onFechar();
    } catch (erro) {
      console.error('[produto] Edição falhou:', erro);
      mostrar('Não foi possível salvar. Só admin ou master pode editar o cadastro.', 'error');
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!produto || !estoqueAtual || salvando) return;
    setSalvando(true);
    try {
      await excluirProduto(estoqueAtual.id, produto.id);
      mostrar('Produto excluído.', 'success');
      onFechar();
    } catch (erro) {
      console.error('[produto] Exclusão falhou:', erro);
      mostrar('Não foi possível excluir. Só master pode apagar produto.', 'error');
    } finally {
      setSalvando(false);
    }
  }

  const contado = produto ? isItemContado(produto) : false;

  return (
    <Modal
      aberto={produto !== null}
      titulo="Editar produto"
      onFechar={onFechar}
      rodape={
        confirmandoExclusao ? (
          <>
            <button
              className="botao botao--secundario"
              type="button"
              onClick={() => setConfirmandoExclusao(false)}
            >
              Cancelar
            </button>
            <button
              className="botao botao--perigo"
              type="button"
              onClick={() => void excluir()}
              disabled={salvando}
            >
              Excluir mesmo assim
            </button>
          </>
        ) : (
          <>
            <button className="botao botao--secundario" type="button" onClick={onFechar}>
              Cancelar
            </button>
            <button
              className="botao botao--primario"
              type="button"
              onClick={() => void salvar()}
              disabled={!form.nome.trim() || salvando}
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </>
        )
      }
    >
      {confirmandoExclusao ? (
        <div className="pilha">
          <p>
            Apagar <strong>{nomeDe(produto!)}</strong> deste estoque?
          </p>
          {contado && (
            <p className="aviso">
              Este item já foi contado neste ciclo. A contagem some junto.
            </p>
          )}
          <p className="aviso aviso--perigo">
            Não dá para desfazer. As auditorias já salvas continuam mostrando o produto —
            elas guardam uma cópia própria.
          </p>
        </div>
      ) : (
        <div className="pilha">
          <label className="campo">
            <span className="campo__rotulo">Nome</span>
            <input
              className="campo__entrada"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              maxLength={300}
              autoFocus
            />
          </label>

          <label className="campo">
            <span className="campo__rotulo">Código de barras</span>
            <input
              className="campo__entrada"
              inputMode="numeric"
              value={form.codigoBarras}
              onChange={(e) => setForm({ ...form, codigoBarras: e.target.value })}
            />
          </label>

          <label className="campo">
            <span className="campo__rotulo">Estoque do sistema</span>
            <input
              className="campo__entrada"
              type="number"
              value={form.estoqueSistema}
              onChange={(e) => setForm({ ...form, estoqueSistema: e.target.value })}
            />
            <span className="campo__ajuda">
              O saldo do ERP. Buscar estoque sobrescreve este valor.
            </span>
          </label>

          <label className="campo">
            <span className="campo__rotulo">Código no ERP</span>
            <input
              className="campo__entrada"
              value={form.idProduto}
              onChange={(e) => setForm({ ...form, idProduto: e.target.value })}
              autoComplete="off"
            />
            <span className="campo__ajuda">
              Sem ele o produto não pode ser corrigido no ERP.
            </span>
          </label>

          {permissoes.gerenciarUsuarios && (
            <button
              className="botao botao--perigo botao--largo"
              type="button"
              onClick={() => setConfirmandoExclusao(true)}
              disabled={salvando}
            >
              Excluir produto
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
