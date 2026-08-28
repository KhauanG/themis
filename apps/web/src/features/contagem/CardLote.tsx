import { useState, type FormEvent } from 'react';
import { MAX_LOTE, loteValido, normalizarLote } from '@themis/shared';
import { Modal } from '../../components/Modal.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { isPermissaoNegada } from '../../lib/fila-offline.js';

interface Props {
  aberto: boolean;
  onFechar: () => void;
}

/**
 * Pede o lote antes de a contagem começar.
 *
 * Aparece ao tocar num item quando a rodada ainda não tem lote — depois de limpar a
 * contagem, de reupar o estoque, ou de finalizar (que expira o lote ao avançar o ciclo).
 *
 * ⚠️ **Só admin e master conseguem abrir.** Não é escolha de interface: a regra de
 * `inventories` só aceita campo fora dos quatro de ciclo pelo ramo `isAdminOrMaster()`.
 * Deixar o botão para todos criaria a promessa que o banco não cumpre — o mesmo erro que o
 * Histórico teve antes da 2.12. Para o funcionário comum, o card explica a quem pedir.
 *
 * Abrir o lote é coerente com quem já inicia a rodada: limpar a contagem e reupar o estoque
 * também são ações de admin.
 */
export function CardLote({ aberto, onFechar }: Props) {
  const { abrirLoteDaRodada, estoqueAtual, ciclo } = useEstoque();
  const { permissoes } = useAuth();
  const { mostrar } = useToast();

  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  const podeAbrir = permissoes.gerenciarEstoque;
  const pronto = loteValido(texto);

  async function abrir(e: FormEvent) {
    e.preventDefault();
    if (!pronto || salvando) return;
    setSalvando(true);
    try {
      await abrirLoteDaRodada(normalizarLote(texto));
      mostrar(`Lote ${normalizarLote(texto)} aberto. Pode contar.`, 'success');
      setTexto('');
      onFechar();
    } catch (erro) {
      console.error('[lote] Falha ao abrir:', erro);
      mostrar(
        isPermissaoNegada(erro)
          ? 'Seu usuário não pode abrir lote. Peça a um administrador.'
          : 'Não foi possível abrir o lote. Verifique a conexão.',
        'error',
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo="Insira o Lote que está contando"
      onFechar={onFechar}
      rodape={
        <>
          <button className="botao botao--secundario" type="button" onClick={onFechar} disabled={salvando}>
            {podeAbrir ? 'Cancelar' : 'Entendi'}
          </button>
          {podeAbrir && (
            <button
              className="botao botao--primario"
              type="button"
              onClick={(e) => void abrir(e)}
              disabled={!pronto || salvando}
            >
              {salvando ? 'Abrindo…' : 'Abrir lote'}
            </button>
          )}
        </>
      }
    >
      <p>
        A contagem de <strong>{estoqueAtual?.nome ?? 'este estoque'}</strong> ainda não tem lote.
        O lote identifica esta rodada e é por ele que a contagem será localizada depois.
      </p>

      {podeAbrir ? (
        <form onSubmit={(e) => void abrir(e)}>
          <label className="campo">
            <span className="campo__rotulo">Lote</span>
            <input
              className="campo__entrada"
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={MAX_LOTE}
              autoComplete="off"
              placeholder="Ex.: 2026-08 A"
              required
              autoFocus
            />
            <span className="campo__ajuda">
              Vale para todo mundo que contar este estoque nesta rodada.
            </span>
          </label>
        </form>
      ) : (
        /*
          Sem permissão, o card não vira beco sem saída: diz quem resolve. A alternativa —
          mostrar o campo e deixar a regra negar — devolveria um "permission-denied" que não
          explica nada a quem só queria contar.
        */
        <p className="aviso" role="status">
          <strong>Peça a um administrador para abrir o lote.</strong> Só admin ou master pode
          iniciar a rodada. Assim que o lote for aberto, a contagem libera para todos — não é
          preciso recarregar.
        </p>
      )}

      <p className="campo__ajuda">Ciclo interno {ciclo} · usado só para o histórico.</p>
    </Modal>
  );
}
