import { useEffect, useState } from 'react';
import {
  TEXTO_NADA_MUDOU,
  camposDoProduto,
  isItemContado,
  nomeDe,
  validarCadastroProduto,
  type CamposCadastro,
} from '@themis/shared';
import { useAuth } from '../../contexts/AuthContext.js';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Modal } from '../../components/Modal.js';
import { editarCadastroProduto, excluirProduto } from '../../lib/produtos-repo.js';
import { mensagemDeFalha } from '../../lib/gestao-escrita.js';
import { registrar } from '../../lib/historico.js';

const RECUSA_CADASTRO = 'Sem permissão. Só admin ou master com acesso a este estoque edita o cadastro.';
const AVISO_ID_MUDOU = 'Produto atualizado. Busque o estoque de novo para atualizar o saldo.';

const VAZIO: CamposCadastro = { nome: '', codigoBarras: '', idErp: '' };

interface Props {
  produtoId: string | null;
  onFechar: () => void;
}

/**
 * Edição de cadastro do produto: nome, código de barras e código no ERP.
 *
 * Cadastro e contagem são coisas separadas: a quantidade contada e o saldo do sistema não
 * aparecem aqui — corrigir um nome não pode apagar o trabalho do funcionário.
 *
 * O produto é o **vivo** da lista, achado pelo id. A abertura (o que o formulário mostrou)
 * é guardada uma vez por abertura do modal, e o listener nunca reescreve o formulário nem ela.
 */
export function ModalEditarProduto({ produtoId, onFechar }: Props) {
  const { permissoes } = useAuth();
  const { estoqueAtual, contextoLog, produtos } = useEstoque();
  const { mostrar } = useToast();

  const produto = produtoId === null ? undefined : produtos.find((p) => p.id === produtoId);

  const [form, setForm] = useState<CamposCadastro>(VAZIO);
  const [abertura, setAbertura] = useState<CamposCadastro>(VAZIO);
  const [iniciado, setIniciado] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  // Preenche uma vez por abertura, sem `useEffect`: assim o formulário não é reescrito
  // quando o listener do Firestore entrega um objeto novo enquanto o usuário digita.
  // Fechar zera `iniciado`, senão reabrir o mesmo produto mostraria o formulário velho.
  if (produtoId === null && iniciado !== null) setIniciado(null);
  if (produto && iniciado !== produto.id) {
    const campos = camposDoProduto(produto);
    setIniciado(produto.id);
    setConfirmandoExclusao(false);
    setAbertura(campos);
    setForm(campos);
  }

  // Outro aparelho excluiu o produto com o modal aberto: não há mais o que editar.
  useEffect(() => {
    if (produtoId !== null && produto === undefined) onFechar();
  }, [produtoId, produto, onFechar]);

  async function salvar() {
    if (!produto || !estoqueAtual || salvando) return;
    const v = validarCadastroProduto(form, abertura, produtos.filter((p) => p.id !== produto.id));
    if (!v.ok) {
      mostrar(v.mensagem, 'error');
      return;
    }
    setSalvando(true);
    try {
      const r = await editarCadastroProduto(estoqueAtual.id, produto.id, v.campos, abertura);
      if (r.resultado === 'NADA_MUDOU') {
        mostrar(TEXTO_NADA_MUDOU, 'info');
        return;
      }

      // Só depois do aceite do servidor, e só os campos que não são "nada mudou".
      if (contextoLog) {
        void registrar('EDITAR_PRODUTO', contextoLog, {
          produto: r.de.nome,
          productId: produto.id,
          ...(r.campos.nome !== 'NADA_MUDOU' && { nomeDe: r.de.nome, nomePara: v.campos.nome }),
          ...(r.campos.codigoBarras !== 'NADA_MUDOU' && {
            codigoDe: r.de.codigoBarras,
            codigoPara: v.campos.codigoBarras,
          }),
          ...(r.campos.idErp !== 'NADA_MUDOU' && { idErpDe: r.de.idErp, idErpPara: v.campos.idErp }),
        });
      }

      mostrar(r.campos.idErp !== 'NADA_MUDOU' ? AVISO_ID_MUDOU : 'Produto atualizado.', 'success');
      onFechar();
    } catch (erro) {
      console.error('[produto] Edição falhou:', erro);
      mostrar(mensagemDeFalha(erro, { recusa: RECUSA_CADASTRO }), 'error');
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!produto || !estoqueAtual || salvando) return;
    setSalvando(true);
    try {
      await excluirProduto(estoqueAtual.id, produto.id);

      if (contextoLog) {
        void registrar('EXCLUIR_PRODUTO', contextoLog, {
          produto: nomeDe(produto),
          productId: produto.id,
          tinhaContagem: isItemContado(produto),
        });
      }

      mostrar('Produto excluído.', 'success');
      onFechar();
    } catch (erro) {
      console.error('[produto] Exclusão falhou:', erro);
      mostrar(mensagemDeFalha(erro), 'error');
    } finally {
      setSalvando(false);
    }
  }

  const contado = produto ? isItemContado(produto) : false;

  return (
    <Modal
      aberto={produto !== undefined}
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
            Apagar <strong>{produto ? nomeDe(produto) : ''}</strong> deste estoque?
          </p>
          {contado && (
            <p className="aviso">
              Este item já foi contado nesta rodada. A contagem some junto.
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
            <span className="campo__rotulo">Código no ERP</span>
            <input
              className="campo__entrada"
              inputMode="numeric"
              value={form.idErp}
              onChange={(e) => setForm({ ...form, idErp: e.target.value })}
              autoComplete="off"
            />
            <span className="campo__ajuda">É o código do produto no Nuvem3. Só números.</span>
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
