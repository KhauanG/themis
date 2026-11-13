import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COR_ACAO,
  ORDEM_ACOES,
  ROTULO_ACAO,
  descreverEvento,
  dividirFiltro,
  subtituloDoHistorico,
  type AcaoHistorico,
  type FiltroDaTela,
  type UserProfile,
} from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { Esqueleto } from '../../components/Esqueleto.js';
import { varrerHistorico, type CursorHistorico, type EntradaHistoricoLida } from '../../lib/historico.js';
import { listarUsuarios, nomeExibivel } from '../../lib/usuarios-repo.js';

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
  const { estoqueAtual, todosEstoques } = useEstoque();

  const [filtro, setFiltro] = useState<FiltroDaTela>(() => ({
    inventoryId: estoqueAtual?.id ?? 'TODOS',
    action: 'TODAS',
    userId: 'TODOS',
    de: '',
    ate: '',
  }));
  const [eventos, setEventos] = useState<EntradaHistoricoLida[]>([]);
  const [ultimo, setUltimo] = useState<CursorHistorico | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [varridos, setVarridos] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);

  /** Cada primeira carga abre uma geração nova; a resposta de um filtro que já mudou é descartada. */
  const geracao = useRef(0);

  const { filtraNoNavegador } = dividirFiltro(filtro);

  const carregar = useCallback(
    async (depois: CursorHistorico | null) => {
      const { servidor, navegador } = dividirFiltro(filtro);
      const minha = depois === null ? ++geracao.current : geracao.current;
      if (depois === null) {
        setCarregando(true);
        setCarregandoMais(false);
        setErro(null);
        setEventos([]);
        setVarridos(0);
        setTemMais(false);
      } else {
        setCarregandoMais(true);
      }
      try {
        const r = await varrerHistorico(servidor, navegador, depois);
        if (minha !== geracao.current) return;
        setEventos((atual) => (depois === null ? r.eventos : [...atual, ...r.eventos]));
        setVarridos((v) => v + r.varridos);
        setUltimo(r.ultimo);
        setTemMais(r.temMais);
      } catch (e) {
        if (minha !== geracao.current) return;
        console.warn('[histórico] Consulta falhou:', e);
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (minha === geracao.current) {
          setCarregando(false);
          setCarregandoMais(false);
        }
      }
    },
    [filtro],
  );

  useEffect(() => {
    void carregar(null);
  }, [carregar]);

  useEffect(() => {
    let vivo = true;
    listarUsuarios()
      .then((lista) => vivo && setUsuarios(lista))
      .catch((e) => console.warn('[histórico] Não foi possível listar os usuários:', e));
    return () => {
      vivo = false;
    };
  }, []);

  const mudar = <K extends keyof FiltroDaTela>(campo: K, valor: FiltroDaTela[K]) =>
    setFiltro((f) => ({ ...f, [campo]: valor }));

  // Agrupa por dia mantendo a ordem que veio do Firestore (mais recente primeiro).
  const grupos = useMemo(() => {
    const mapa = new Map<string, EntradaHistoricoLida[]>();
    for (const e of eventos) {
      const chave = agrupamento(e.quando);
      const lista = mapa.get(chave);
      if (lista) lista.push(e);
      else mapa.set(chave, [e]);
    }
    return [...mapa.entries()];
  }, [eventos]);

  const mostrandoLista = !carregando && !erro;

  return (
    <section className="pilha-g">
      <div>
        <h1 className="titulo-tela">Histórico</h1>
        <p className="subtitulo">
          {carregando ? 'Carregando…' : subtituloDoHistorico(eventos.length, varridos, filtraNoNavegador)}
        </p>
      </div>

      <div className="pilha">
        <label className="campo">
          <span className="campo__rotulo">Estoque</span>
          <select
            className="campo__entrada"
            value={filtro.inventoryId}
            onChange={(e) => mudar('inventoryId', e.target.value)}
          >
            <option value="TODOS">Todos</option>
            {todosEstoques.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome || x.id}
              </option>
            ))}
          </select>
        </label>

        <label className="campo">
          <span className="campo__rotulo">Ação</span>
          <select
            className="campo__entrada"
            value={filtro.action}
            onChange={(e) => mudar('action', e.target.value as AcaoHistorico | 'TODAS')}
          >
            <option value="TODAS">Todas</option>
            {ORDEM_ACOES.map((a) => (
              <option key={a} value={a}>
                {ROTULO_ACAO[a]}
              </option>
            ))}
          </select>
        </label>

        <label className="campo">
          <span className="campo__rotulo">Usuário</span>
          <select
            className="campo__entrada"
            value={filtro.userId}
            onChange={(e) => mudar('userId', e.target.value)}
          >
            <option value="TODOS">Todos</option>
            {usuarios.map((u) => (
              <option key={u.uid} value={u.uid}>
                {nomeExibivel(u)}
              </option>
            ))}
          </select>
        </label>

        <label className="campo">
          <span className="campo__rotulo">De</span>
          <input
            type="date"
            className="campo__entrada"
            value={filtro.de}
            onChange={(e) => mudar('de', e.target.value)}
          />
        </label>

        <label className="campo">
          <span className="campo__rotulo">Até</span>
          <input
            type="date"
            className="campo__entrada"
            value={filtro.ate}
            onChange={(e) => mudar('ate', e.target.value)}
          />
        </label>
      </div>

      {carregando ? (
        <Esqueleto linhas={5} />
      ) : erro ? (
        <div className="pilha">
          <p className="aviso aviso--perigo" role="alert">
            Não foi possível carregar o histórico.
            <br />
            {erro}
          </p>
          <button type="button" className="botao botao--secundario" onClick={() => void carregar(null)}>
            Tentar de novo
          </button>
        </div>
      ) : eventos.length === 0 && !temMais ? (
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
                        <span className="evento__acao">{desc.rotulo ?? ROTULO_ACAO[e.action] ?? e.action}</span>
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
                        {filtro.inventoryId === 'TODOS' && e.inventoryName ? ` · ${e.inventoryName}` : ''}
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

      {mostrandoLista && temMais && (
        <button
          type="button"
          className="botao botao--secundario botao--largo"
          disabled={carregandoMais}
          onClick={() => void carregar(ultimo)}
        >
          {carregandoMais ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
      {mostrandoLista && !temMais && eventos.length > 0 && <p className="campo__ajuda">Fim do histórico.</p>}
    </section>
  );
}
