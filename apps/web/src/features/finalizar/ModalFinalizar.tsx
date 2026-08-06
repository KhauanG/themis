import { useState } from 'react';
import { calcularEstatisticas } from '@themis/shared';
import { Modal } from '../../components/Modal.js';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { montarAuditoria, salvarAuditoria } from '../../lib/auditorias-repo.js';
import { finalizarCiclo } from '../../lib/estoques-repo.js';
import { registrar } from '../../lib/historico.js';
import { isWriteTimeout } from '../../lib/firestore-write.js';

/** Palavra que precisa ser digitada. Evita finalizar sem querer no meio da contagem. */
const CONFIRMACAO = 'FINALIZAR';

interface Props {
  aberto: boolean;
  onFechar: () => void;
}

export function ModalFinalizar({ aberto, onFechar }: Props) {
  const { estoqueAtual, produtos, ciclo, contextoLog } = useEstoque();
  const { usuario, permissoes } = useAuth();
  const { mostrar } = useToast();

  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  const estatisticas = calcularEstatisticas(produtos);
  const confirmado = texto.trim().toUpperCase() === CONFIRMACAO;

  function fechar() {
    setTexto('');
    onFechar();
  }

  async function finalizar() {
    if (!confirmado || salvando || !estoqueAtual || !usuario) return;
    setSalvando(true);

    try {
      const nomeAuditoria = `${estoqueAtual.nome ?? estoqueAtual.id} - Ciclo ${ciclo}`;
      const auditoria = montarAuditoria({
        nome: nomeAuditoria,
        inventoryId: estoqueAtual.id,
        contagemCycle: ciclo,
        produtos,
      });

      // A auditoria é salva primeiro. Se o ciclo não fechar depois, o dado da contagem
      // já está guardado — o contrário perderia o trabalho todo.
      const auditoriaId = await salvarAuditoria(auditoria);

      try {
        await finalizarCiclo(estoqueAtual.id, ciclo);
        mostrar('Contagem finalizada e salva.', 'success');
      } catch (erroCiclo) {
        if (isWriteTimeout(erroCiclo)) {
          mostrar(
            'Auditoria salva, mas o ciclo não fechou por falta de conexão. Finalize de novo quando a internet voltar.',
            'warning',
          );
        } else {
          throw erroCiclo;
        }
      }

      if (contextoLog) {
        void registrar('FINALIZAR_CONTAGEM', contextoLog, {
          auditoriaId,
          ciclo,
          contados: estatisticas.contados,
          naoContados: estatisticas.naoContados,
          incorretos: estatisticas.incorretos,
        });
      }

      fechar();
    } catch (erro) {
      console.error('[finalizar] Falhou:', erro);
      mostrar('Não foi possível finalizar. Verifique a conexão e tente de novo.', 'error');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo="Finalizar e salvar contagem"
      onFechar={fechar}
      rodape={
        <>
          <button className="botao botao--secundario" type="button" onClick={fechar} disabled={salvando}>
            Cancelar
          </button>
          <button
            className="botao botao--perigo"
            type="button"
            onClick={() => void finalizar()}
            disabled={!confirmado || salvando}
          >
            {salvando ? 'Salvando...' : 'Finalizar'}
          </button>
        </>
      }
    >
      <p>
        Isso salva a contagem do <strong>ciclo {ciclo}</strong> como auditoria e abre um novo ciclo.
        A contagem atual deixa de ser editável.
      </p>

      <ul className="resumo">
        <li>
          <span>Contados</span>
          <strong>{estatisticas.contados}</strong>
        </li>
        <li>
          <span>Não contados</span>
          <strong>{estatisticas.naoContados}</strong>
        </li>
        {/*
          Contagem às cegas: "corretos" e "divergentes" comparam com o saldo do sistema.
          Quem só conta não vê — nem no fim. Saber "errei 40" no fechamento é a mesma
          informação que a contagem às cegas existe para não dar. Contado e não contado
          ficam: são progresso, não comparação.
        */}
        {permissoes.verEstoqueSistema && (
          <>
            <li>
              <span>Corretos</span>
              <strong>{estatisticas.corretos}</strong>
            </li>
            <li>
              <span>Divergentes</span>
              <strong>{estatisticas.incorretos}</strong>
            </li>
          </>
        )}
      </ul>

      {estatisticas.naoContados > 0 && (
        <p className="aviso" role="alert">
          Ainda há {estatisticas.naoContados} {estatisticas.naoContados === 1 ? 'item' : 'itens'} sem
          contagem. Eles serão salvos como NÃO CONTADO.
        </p>
      )}

      <label className="campo">
        <span className="campo__rotulo">
          Digite <strong>{CONFIRMACAO}</strong> para confirmar
        </span>
        <input
          className="campo__entrada"
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
        />
      </label>
    </Modal>
  );
}
