import { useRef, useState } from 'react';
import { calcularEstatisticas } from '@themis/shared';
import { Modal } from '../../components/Modal.js';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { finalizarContagem, montarAuditoria } from '../../lib/auditorias-repo.js';
import { registrar } from '../../lib/historico.js';
import { isWriteTimeout } from '../../lib/firestore-write.js';

/** Palavra que precisa ser digitada. Evita finalizar sem querer no meio da contagem. */
const CONFIRMACAO = 'FINALIZAR';

interface Props {
  aberto: boolean;
  onFechar: () => void;
}

export function ModalFinalizar({ aberto, onFechar }: Props) {
  const { estoqueAtual, produtos, ciclo, contextoLog, contagemFechada, carregandoProdutos, conciliando, lote } =
    useEstoque();
  const { usuario, permissoes } = useAuth();
  const { mostrar } = useToast();

  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  /**
   * Estoque e ciclo do primeiro clique em Finalizar, mantidos até um resultado definitivo
   * (finalizada, já finalizada, ciclo mudou). Erro, com estouro ou não, mantém.
   *
   * Se a gravação estoura o tempo mas chega ao servidor, o listener já mostra o ciclo N+1. Sem
   * isto, o clique seguinte usaria o `ciclo` da tela (N+1) e finalizaria o ciclo seguinte, que
   * ninguém contou. Com o alvo, a transação acha a auditoria N e responde "já finalizada" — o
   * pior caso de um alvo mantido, e é verdade. Fechar e reabrir não o perde: o `Layout` mantém
   * este componente montado. Recarregar a página perde.
   */
  const alvo = useRef<{ inventoryId: string; ciclo: number } | null>(null);
  /**
   * Gravação em andamento. Ref, e não só `salvando`: Escape, fundo, X e um segundo clique
   * chegam com a closure do render anterior, e o estado só chega no render seguinte.
   */
  const gravando = useRef(false);

  const estatisticas = calcularEstatisticas(produtos);
  /**
   * Lista ainda não conciliada com o servidor.
   *
   * É a trava mais importante deste modal. Finalizar grava um **snapshot permanente** em
   * `auditorias` e incrementa o ciclo — as duas coisas difíceis de desfazer. Feito enquanto
   * o cache ainda tem os documentos de uma importação anterior, a auditoria nasce com
   * milhares de produtos fantasmas e estatísticas erradas, e vira o registro oficial
   * daquela contagem.
   *
   * O modal é alcançável pelo menu de **qualquer** tela, então não adianta a tela de
   * Produtos estar protegida: a trava precisa estar aqui.
   */
  const listaProvisoria = carregandoProdutos || conciliando;
  const confirmado = texto.trim().toUpperCase() === CONFIRMACAO;

  // Limpa só a palavra digitada: o alvo sobrevive ao fechamento.
  function encerrar() {
    setTexto('');
    onFechar();
  }

  /**
   * Fechamento pedido pelo usuário (Escape, fundo, X, Cancelar). Não fecha com a gravação em
   * andamento: ela continua mesmo com o modal fechado, e quem fechou acharia que cancelou.
   */
  function fechar() {
    if (!gravando.current) encerrar();
  }

  async function finalizar() {
    if (!confirmado || salvando || gravando.current || listaProvisoria || !estoqueAtual || !usuario) return;
    gravando.current = true;
    setSalvando(true);

    try {
      // Alvo de outro estoque não vale aqui; o deste estoque começa no ciclo da tela.
      if (alvo.current?.inventoryId !== estoqueAtual.id) alvo.current = { inventoryId: estoqueAtual.id, ciclo };
      const cicloDaTentativa = alvo.current.ciclo;
      // Nome pelo lote quando há: é o rótulo pelo qual a equipe procura a contagem.
      const rodada = lote ? `Lote ${lote}` : `Ciclo ${cicloDaTentativa}`;
      const nomeAuditoria = `${estoqueAtual.nome ?? estoqueAtual.id} - ${rodada}`;
      const auditoria = montarAuditoria({
        nome: nomeAuditoria,
        inventoryId: estoqueAtual.id,
        contagemCycle: cicloDaTentativa,
        produtos,
        lote,
      });

      // Uma transação só: a auditoria e o ciclo novo entram juntos, ou nenhum dos dois.
      const r = await finalizarContagem(auditoria);

      if (r.situacao === 'finalizada') {
        mostrar('Contagem finalizada e salva.', 'success');
        if (contextoLog) {
          void registrar('FINALIZAR_CONTAGEM', contextoLog, {
            auditoriaId: r.auditoriaId,
            ciclo: r.cicloFinalizado,
            contados: estatisticas.contados,
            naoContados: estatisticas.naoContados,
            incorretos: estatisticas.incorretos,
            foraDoErp: estatisticas.foraDoErp,
          });
        }
      } else if (r.situacao === 'ja-finalizada') {
        // Segundo clique depois de estouro, ou outro aparelho: já está salva, sem histórico novo.
        mostrar('Esta contagem já foi finalizada e está salva. Nada foi gravado de novo.', 'success');
      } else {
        mostrar(`Esta contagem já foi finalizada: o estoque está no ciclo ${r.cicloServidor}. Nada foi gravado.`, 'warning');
      }

      // As três situações são definitivas: o próximo Finalizar parte do ciclo da tela.
      alvo.current = null;
      // `encerrar`, não `fechar`: aqui a gravação ainda consta como em andamento.
      encerrar();
    } catch (erro) {
      console.error('[finalizar] Falhou:', erro);
      // O alvo fica: o próximo clique, agora ou depois de fechar e reabrir, tenta o MESMO ciclo.
      if (isWriteTimeout(erro)) {
        mostrar(
          'O servidor não respondeu a tempo. Confira a conexão e clique em Finalizar de novo: se a contagem já tiver sido salva, o app avisa.',
          'warning',
        );
      } else {
        mostrar('Não foi possível finalizar. Nada foi gravado. Verifique a conexão e tente de novo.', 'error');
      }
    } finally {
      gravando.current = false;
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
            disabled={!confirmado || salvando || listaProvisoria}
          >
            {salvando ? 'Salvando...' : 'Finalizar'}
          </button>
        </>
      }
    >
      <p>
        Isso salva {lote ? <>o <strong>Lote {lote}</strong></> : <>a contagem do <strong>ciclo {ciclo}</strong></>}{' '}
        como auditoria e <strong>encerra o lote</strong> — a próxima contagem vai pedir um
        lote novo.
      </p>

      {listaProvisoria && (
        <p className="aviso" role="alert">
          <strong>Aguarde a sincronização.</strong> A lista deste estoque ainda está sendo
          conciliada com o servidor, e finalizar agora gravaria a auditoria com números
          errados. Isso leva alguns segundos.
        </p>
      )}

      {/*
        Finalizar NÃO zera a contagem — nunca zerou, nem no 1.x. Ele salva o retrato e
        incrementa o contador; os produtos continuam com a quantidade e o status do ciclo
        anterior. Quem não souber disso abre o ciclo novo achando que está tudo por contar,
        vê a barra em 100% e a aba "A contar" vazia, e conclui que o app perdeu alguma
        coisa. O aviso é o que separa "funcionou" de "sumiu tudo".
      */}
      {estatisticas.contados > 0 && (
        <p className="aviso" role="status">
          <strong>Finalizar não apaga a contagem.</strong>{' '}
          {contagemFechada
            ? `Como já houve conferência, o ciclo ${ciclo + 1} nasce travado: ninguém conta até um administrador usar Produtos → Limpar contagem.`
            : `Os ${estatisticas.contados} itens contados continuam marcados no ciclo ${ciclo + 1}, e a barra vai mostrar 100%. Para começar do zero, um administrador usa Produtos → Limpar contagem.`}
        </p>
      )}

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
        {/* Fora do total: não são contáveis. Aparecem para o número bater com a tela. */}
        {estatisticas.foraDoErp > 0 && (
          <li>
            <span>Fora do ERP</span>
            <strong>{estatisticas.foraDoErp}</strong>
          </li>
        )}
      </ul>

      {estatisticas.foraDoErp > 0 && (
        <p className="aviso" role="status">
          {estatisticas.foraDoErp}{' '}
          {estatisticas.foraDoErp === 1
            ? 'produto não está na listagem do ERP e não pôde ser contado'
            : 'produtos não estão na listagem do ERP e não puderam ser contados'}
          . Não entram no total nem impedem o fechamento — o cadastro se resolve no Nuvem3.
        </p>
      )}

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
