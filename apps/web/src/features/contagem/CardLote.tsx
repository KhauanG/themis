import { useState, type FormEvent } from 'react';
import { MAX_LOTE, loteValido, normalizarLote } from '@themis/shared';
import { Modal } from '../../components/Modal.js';
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
 * **Qualquer um que possa contar neste estoque abre o lote.** Na 2.17 era só admin, por
 * limitação da regra; a 2.18 acrescentou `lote` e `loteCiclo` ao conjunto que o usuário
 * comum pode alterar em `inventories`, e a trava caiu — quem conta é quem sabe qual lote
 * está na mão.
 *
 * A restrição que **continua** valendo é `podeAcessarEstoque`: ninguém abre lote em estoque
 * que não pode contar.
 */
export function CardLote({ aberto, onFechar }: Props) {
  const { abrirLoteDaRodada, estoqueAtual, ciclo } = useEstoque();
  const { mostrar } = useToast();

  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

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
            Cancelar
          </button>
          <button
            className="botao botao--primario"
            type="button"
            onClick={(e) => void abrir(e)}
            disabled={!pronto || salvando}
          >
            {salvando ? 'Abrindo…' : 'Abrir lote'}
          </button>
        </>
      }
    >
      <p>
        A contagem de <strong>{estoqueAtual?.nome ?? 'este estoque'}</strong> ainda não tem lote.
        O lote identifica esta rodada e é por ele que a contagem será localizada depois.
      </p>

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

      <p className="campo__ajuda">Ciclo interno {ciclo} · usado só para o histórico.</p>
    </Modal>
  );
}
