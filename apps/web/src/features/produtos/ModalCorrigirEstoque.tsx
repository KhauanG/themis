import { useState } from 'react';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Modal } from '../../components/Modal.js';
import { registrar } from '../../lib/historico.js';
import {
  diagnosticar,
  executarCorrecao,
  reenviarPendentes,
  type Diagnostico,
  type ResultadoCorrecao,
} from './corrigir-estoque.js';

interface Props {
  aberto: boolean;
  onFechar: () => void;
}

type Etapa = 'inicio' | 'diagnosticando' | 'confirmar' | 'executando' | 'resultado';

interface Progresso {
  texto: string;
  feitos?: number;
  total?: number;
}

/**
 * Conduz o "Corrigir estoque" em três fases, com a confirmação **no meio**.
 *
 * A confirmação vem depois do diagnóstico de propósito: perguntar antes de ler o ERP
 * mostraria números da última importação, e o usuário decidiria com dado velho. É o mesmo
 * desenho de duas confirmações do 1.x.
 */
export function ModalCorrigirEstoque({ aberto, onFechar }: Props) {
  const { estoqueAtual, produtos, ciclo, contextoLog, online } = useEstoque();
  const { mostrar } = useToast();

  const [etapa, setEtapa] = useState<Etapa>('inicio');
  const [progresso, setProgresso] = useState<Progresso>({ texto: '' });
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null);
  const [resultado, setResultado] = useState<ResultadoCorrecao | null>(null);

  function reiniciar() {
    setEtapa('inicio');
    setDiagnostico(null);
    setResultado(null);
    setProgresso({ texto: '' });
    onFechar();
  }

  async function rodarDiagnostico() {
    if (!estoqueAtual) return;
    setEtapa('diagnosticando');
    try {
      const d = await diagnosticar(estoqueAtual.id, produtos, (texto) => setProgresso({ texto }));
      setDiagnostico(d);
      setEtapa('confirmar');
    } catch (erro) {
      console.error('[corrigir] Diagnóstico falhou:', erro);
      mostrar((erro as Error).message || 'Não foi possível ler o estoque do ERP.', 'error');
      setEtapa('inicio');
    }
  }

  async function rodarCorrecao() {
    if (!estoqueAtual || !diagnostico) return;
    setEtapa('executando');
    try {
      const r = await executarCorrecao(estoqueAtual.id, diagnostico, (texto, feitos, total) =>
        setProgresso({ texto, feitos, total }),
      );
      setResultado(r);
      setEtapa('resultado');

      if (contextoLog) {
        void registrar('CORRIGIR_ESTOQUE', contextoLog, {
          ciclo,
          conferidos: r.conferidos,
          divergentes: r.divergentesConferidos,
          enviadosAoErp: r.enviados,
          confirmadosNoErp: r.confirmados,
          pendentesNoErp: r.pendentes.length,
          falhasNoEnvio: r.falhasNoEnvio.length,
        });
      }
    } catch (erro) {
      console.error('[corrigir] Correção falhou:', erro);
      mostrar('A correção não foi concluída. Verifique a conexão e tente de novo.', 'error');
      setEtapa('confirmar');
    }
  }

  async function rodarReenvio() {
    if (!diagnostico || !resultado) return;
    setEtapa('executando');
    setProgresso({ texto: 'Reenviando pendências' });
    try {
      const ok = await reenviarPendentes(
        diagnostico.hashLoja,
        diagnostico.divergentes,
        resultado.pendentes,
        (feitos, total) => setProgresso({ texto: 'Reenviando pendências', feitos, total }),
      );
      mostrar(
        `Reenviados ${ok} de ${resultado.pendentes.length}. Confira no ERP em alguns minutos.`,
        ok === resultado.pendentes.length ? 'success' : 'warning',
      );
      reiniciar();
    } catch (erro) {
      console.error('[corrigir] Reenvio falhou:', erro);
      mostrar('Não foi possível reenviar.', 'error');
      setEtapa('resultado');
    }
  }

  const emAndamento = etapa === 'diagnosticando' || etapa === 'executando';

  return (
    <Modal
      aberto={aberto}
      titulo="Corrigir estoque"
      onFechar={emAndamento ? () => undefined : reiniciar}
      rodape={
        etapa === 'inicio' ? (
          <>
            <button className="botao botao--secundario" type="button" onClick={reiniciar}>
              Cancelar
            </button>
            <button
              className="botao botao--primario"
              type="button"
              onClick={() => void rodarDiagnostico()}
              disabled={!online}
            >
              Ler o ERP
            </button>
          </>
        ) : etapa === 'confirmar' ? (
          <>
            <button className="botao botao--secundario" type="button" onClick={reiniciar}>
              Cancelar
            </button>
            <button
              className="botao botao--primario"
              type="button"
              onClick={() => void rodarCorrecao()}
              disabled={(diagnostico?.contados.length ?? 0) === 0}
            >
              {diagnostico && diagnostico.divergentes.length > 0 ? 'Corrigir e conferir' : 'Conferir'}
            </button>
          </>
        ) : etapa === 'resultado' ? (
          <>
            {resultado && resultado.pendentes.length > 0 && (
              <button className="botao botao--secundario" type="button" onClick={() => void rodarReenvio()}>
                Reenviar pendências
              </button>
            )}
            <button className="botao botao--primario" type="button" onClick={reiniciar}>
              Concluir
            </button>
          </>
        ) : undefined
      }
    >
      {etapa === 'inicio' && (
        <div className="pilha">
          <p>
            O Themis vai ler o saldo atual no ERP, comparar com o que foi contado, enviar as
            divergências e conferir se o ERP aplicou.
          </p>
          <p className="aviso aviso--info">
            A leitura acontece antes de qualquer envio, para a comparação usar o saldo de
            agora — não o da última importação.
          </p>
          {!online && (
            <p className="aviso aviso--perigo">
              Sem conexão. Corrigir estoque precisa de internet, dos dois lados.
            </p>
          )}
        </div>
      )}

      {emAndamento && (
        <div className="pilha">
          <p className="subtitulo">
            {progresso.texto}
            {progresso.total ? ` · ${progresso.feitos} de ${progresso.total}` : '…'}
          </p>
          {progresso.total ? (
            <div className="progresso__trilha">
              <div
                className="progresso__barra"
                style={{ width: `${Math.round(((progresso.feitos ?? 0) / progresso.total) * 100)}%` }}
              />
            </div>
          ) : (
            <div className="carregando">
              <span className="carregando__giro" aria-hidden="true" />
            </div>
          )}
          <p className="campo__ajuda">Não feche esta janela.</p>
        </div>
      )}

      {etapa === 'confirmar' && diagnostico && (
        <div className="pilha">
          <ul className="resumo">
            <li>
              <span>Contados</span>
              <strong>{diagnostico.contados.length}</strong>
            </li>
            <li>
              <span>Divergentes</span>
              <strong>{diagnostico.divergentes.length}</strong>
            </li>
          </ul>

          {diagnostico.saldosAtualizados > 0 && (
            <p className="aviso aviso--info">
              {diagnostico.saldosAtualizados}{' '}
              {diagnostico.saldosAtualizados === 1 ? 'saldo estava' : 'saldos estavam'} diferente do
              ERP e {diagnostico.saldosAtualizados === 1 ? 'foi corrigido' : 'foram corrigidos'}.
            </p>
          )}

          {diagnostico.semCorrespondencia > 0 && (
            <p className="aviso">
              {diagnostico.semCorrespondencia} produtos não existem no ERP e não podem ser
              corrigidos.
            </p>
          )}

          {diagnostico.contados.length === 0 ? (
            <p className="aviso">Nenhum item com contagem em aberto para conferir.</p>
          ) : diagnostico.divergentes.length === 0 ? (
            <p>
              Tudo bate com o ERP. Nada será enviado — os {diagnostico.contados.length} itens
              serão apenas marcados como conferidos.
            </p>
          ) : (
            <p>
              As {diagnostico.divergentes.length} divergências vão para o ERP. Depois, os{' '}
              {diagnostico.contados.length} itens contados são marcados como conferidos e saem
              da lista de trabalho.
            </p>
          )}
        </div>
      )}

      {etapa === 'resultado' && resultado && (
        <div className="pilha">
          <ul className="resumo">
            <li>
              <span>Conferidos</span>
              <strong>{resultado.conferidos}</strong>
            </li>
            <li>
              <span>Enviados</span>
              <strong>{resultado.enviados}</strong>
            </li>
            {resultado.enviados > 0 && (
              <li>
                <span>Confirmados</span>
                <strong>{resultado.confirmados}</strong>
              </li>
            )}
            {resultado.pendentes.length > 0 && (
              <li>
                <span>Não refletiram</span>
                <strong>{resultado.pendentes.length}</strong>
              </li>
            )}
          </ul>

          {resultado.falhasNoEnvio.length > 0 && (
            <p className="aviso aviso--perigo">
              {resultado.falhasNoEnvio.length} itens não foram aceitos pelo ERP. A conferência
              foi fechada mesmo assim — reenvie depois.
            </p>
          )}

          {resultado.verificacaoIndisponivel && (
            <p className="aviso">
              Não foi possível reler o ERP para conferir. O envio foi feito, mas não dá para
              afirmar que foi aplicado.
            </p>
          )}

          {resultado.pendentes.length > 0 && (
            <>
              <p className="aviso">
                Estes itens foram aceitos mas o saldo no ERP ainda não bate. Pode ser demora
                do ERP.
              </p>
              <div className="tabela-caixa">
                <div className="rolagem-h">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th className="num">Enviado</th>
                        <th className="num">No ERP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.pendentes.map((p) => (
                        <tr key={p.nome}>
                          <td>{p.nome}</td>
                          <td className="num">{p.enviado}</td>
                          <td className="num">{Number.isNaN(p.noSistema) ? '—' : p.noSistema}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {resultado.pendentes.length === 0 &&
            resultado.falhasNoEnvio.length === 0 &&
            !resultado.verificacaoIndisponivel && (
              <p>Tudo certo. O ERP confirmou todas as correções enviadas.</p>
            )}
        </div>
      )}
    </Modal>
  );
}
