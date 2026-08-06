import { useEffect, useMemo, useState } from 'react';
import { COR_ACAO, ROTULO_ACAO, descreverEvento, type AcaoHistorico } from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Esqueleto } from '../../components/Esqueleto.js';
import { consultarHistorico, type EntradaHistoricoLida } from '../../lib/historico.js';

/** Ações na ordem em que fazem sentido no seletor: rotina primeiro, gestão depois. */
const ORDEM_ACOES: AcaoHistorico[] = [
  'MODIFICAR_PRODUTO',
  'CONFERIR_ITEM',
  'FINALIZAR_CONTAGEM',
  'BUSCAR_ESTOQUE',
  'CORRIGIR_ESTOQUE',
  'IMPORTAR_PLANILHA',
  'EXPORTAR_PLANILHA',
  'LIMPAR_CONTAGEM',
  'CRIAR_PRODUTO',
  'EDITAR_PRODUTO',
  'EXCLUIR_PRODUTO',
  'CRIAR_ESTOQUE',
  'EDITAR_ESTOQUE',
  'EXCLUIR_ESTOQUE',
  'ALTERAR_PAPEL',
  'ALTERAR_CONFIGURACAO',
  'LOGIN',
];

/** Hoje, ontem, ou a data — reduz ruído numa lista longa. */
function agrupamento(quando: Date): string {
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);

  const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mesmoDia(quando, hoje)) return 'Hoje';
  if (mesmoDia(quando, ontem)) return 'Ontem';
  return quando.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function TelaHistorico() {
  const { estoqueAtual } = useEstoque();
  const { mostrar } = useToast();

  const [entradas, setEntradas] = useState<EntradaHistoricoLida[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [acao, setAcao] = useState<AcaoHistorico | 'TODAS'>('TODAS');

  useEffect(() => {
    if (!estoqueAtual) return;
    let vivo = true;
    setCarregando(true);
    consultarHistorico({
      inventoryId: estoqueAtual.id,
      ...(acao === 'TODAS' ? {} : { acao }),
      maximo: 200,
    })
      .then((lista) => {
        if (vivo) setEntradas(lista);
      })
      .catch((erro) => {
        console.warn('[histórico] Consulta falhou:', erro);
        // Consulta com filtro composto exige índice no Firestore. A mensagem diz o que fazer.
        mostrar('Não foi possível carregar o histórico. Pode faltar índice no Firestore.', 'error');
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [estoqueAtual, acao, mostrar]);

  // Agrupa por dia mantendo a ordem que veio do Firestore (mais recente primeiro).
  const grupos = useMemo(() => {
    const mapa = new Map<string, EntradaHistoricoLida[]>();
    for (const e of entradas) {
      const chave = agrupamento(e.quando);
      const lista = mapa.get(chave);
      if (lista) lista.push(e);
      else mapa.set(chave, [e]);
    }
    return [...mapa.entries()];
  }, [entradas]);

  return (
    <section className="pilha-g">
      <div>
        <h1 className="titulo-tela">Histórico</h1>
        <p className="subtitulo">Últimas 200 ações em {estoqueAtual?.nome ?? '—'}</p>
      </div>

      <label className="campo">
        <span className="campo__rotulo">Ação</span>
        <select
          className="campo__entrada"
          value={acao}
          onChange={(e) => setAcao(e.target.value as AcaoHistorico | 'TODAS')}
        >
          <option value="TODAS">Todas</option>
          {ORDEM_ACOES.map((a) => (
            <option key={a} value={a}>
              {ROTULO_ACAO[a]}
            </option>
          ))}
        </select>
      </label>

      {carregando ? (
        <Esqueleto linhas={5} />
      ) : entradas.length === 0 ? (
        <div className="vazio">
          <p className="vazio__titulo">Nenhum registro</p>
          <p>Nada foi registrado para este filtro.</p>
        </div>
      ) : (
        grupos.map(([dia, doDia]) => (
          <div key={dia} className="pilha">
            <p className="rotulo-secao">{dia}</p>

            <ul className="linha-tempo">
              {doDia.map((e) => {
                const desc = descreverEvento(e.action, e.details);
                return (
                  <li key={e.id} className="evento">
                    <span
                      className="evento__marca"
                      style={{ backgroundColor: COR_ACAO[e.action] ?? 'var(--texto-3)' }}
                      aria-hidden="true"
                    />

                    <div className="evento__corpo">
                      <div className="evento__cabecalho">
                        <span className="evento__acao">{ROTULO_ACAO[e.action] ?? e.action}</span>
                        <span className="evento__quando">
                          {e.quando.toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      {desc.alvo && <p className="evento__alvo">{desc.alvo}</p>}

                      {desc.mudancas.length > 0 && (
                        <ul className="mudancas">
                          {desc.mudancas.map((m) => (
                            <li key={m.campo} className="mudanca">
                              <span className="mudanca__campo">{m.campo}</span>
                              <span className="mudanca__de">{m.de}</span>
                              <span className="mudanca__seta" aria-label="para">
                                →
                              </span>
                              <span className="mudanca__para">{m.para}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {desc.fatos.length > 0 && (
                        <p className="evento__detalhe">{desc.fatos.join(' · ')}</p>
                      )}

                      <p className="evento__quem">
                        {e.userName || e.userEmail}
                        {e.deviceLabel && <span className="evento__aparelho"> · {e.deviceLabel}</span>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
