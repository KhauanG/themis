import { useCallback, useMemo, useState } from 'react';
import {
  contarPorFiltro,
  foraDoErp,
  statusContagemDe,
  filtrarProdutos,
  filtrosVisiveis,
  mensagemVazio,
  type FiltroContagem,
  type Produto,
} from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { Esqueleto } from '../../components/Esqueleto.js';
import { Icone } from '../../components/Icone.js';
import { ModalEditarProduto } from '../produtos/ModalEditarProduto.js';
import { CardProduto } from './CardProduto.js';
import { LeitorCodigo } from './LeitorCodigo.js';
import { CardLote } from './CardLote.js';

/** Quantos itens a lista mostra por vez. Estoques passam de 2000 produtos. */
const PAGINA = 40;

export function TelaContagem() {
  const {
    produtos,
    carregandoProdutos,
    conciliando,
    temLote,
    lote,
    salvarContagem,
    progresso,
    somenteLeitura,
    contagemFechada,
  } = useEstoque();
  const { permissoes } = useAuth();

  const [filtro, setFiltro] = useState<FiltroContagem>('all');
  const [busca, setBusca] = useState('');
  const [expandido, setExpandido] = useState<string | null>(null);
  const [visiveis, setVisiveis] = useState(PAGINA);
  const [lendoCodigo, setLendoCodigo] = useState(false);
  const [editando, setEditando] = useState<Produto | null>(null);
  const [pedindoLote, setPedindoLote] = useState(false);

  const lista = useMemo(
    () =>
      filtrarProdutos(produtos, filtro, {
        busca,
        // Na aba "Contados", o mais recente primeiro: é a ordem em que o funcionário
        // quer conferir o que acabou de contar.
        maisRecentesPrimeiro: filtro === 'updated',
      }),
    [produtos, filtro, busca],
  );

  const mostrados = useMemo(() => lista.slice(0, visiveis), [lista, visiveis]);
  const contagens = useMemo(() => contarPorFiltro(produtos), [produtos]);

  /**
   * Contagem às cegas: as abas "Corrigidos OK" e "Corrigidos com erro" dizem se a contagem
   * bateu com o sistema — é a diferença dita de outro jeito. Somem para quem só conta.
   */
  const verSistema = permissoes.verEstoqueSistema;

  /**
   * O **booleano**, não o objeto `permissoes`, nas dependências do callback do leitor.
   *
   * O objeto ganha identidade nova toda vez que o perfil re-emite — e desde a 2.6.0 o
   * perfil é acompanhado em tempo real. Com ele na lista, o callback seria recriado, o
   * efeito do leitor remontaria e a câmera reabriria sozinha. Ver armadilhas.md §A câmera
   * do leitor reabre sem parar.
   */
  const podeReabrirConferido = permissoes.corrigirContagem;
  const abas = useMemo(() => filtrosVisiveis(verSistema), [verSistema]);

  /*
    O toque no item é onde o lote é cobrado. Sem lote aberto, em vez de expandir o card do
    produto, abre o pedido do lote — é o fluxo pedido: depois de limpar ou reupar o estoque,
    o primeiro toque pergunta qual lote está sendo contado.

    Fechar um card já aberto continua funcionando sem lote: é só recolher, não conta nada.
  */
  const alternar = useCallback(
    (produtoId: string) => {
      setExpandido((atual) => {
        if (atual === produtoId) return null;
        if (!temLote) {
          setPedindoLote(true);
          return atual;
        }
        return produtoId;
      });
    },
    [temLote],
  );

  const trocarFiltro = useCallback((novo: FiltroContagem) => {
    setFiltro(novo);
    setVisiveis(PAGINA);
    setExpandido(null);
  }, []);

  // Estável de propósito: o efeito do leitor tem esta função nas dependências, e um
  // callback recriado a cada render reabriria a câmera sem parar.
  const aoLerCodigo = useCallback(
    (codigo: string) => {
      setLendoCodigo(false);
      setBusca(codigo);
      setFiltro('all');
      setVisiveis(PAGINA);

      // O leitor abre o produto por fora do `alternar`; sem esta checagem ele seria a
      // porta dos fundos para contar sem lote.
      if (!temLote) {
        setPedindoLote(true);
        return;
      }

      const achado = produtos.find((p) => String(p.codigoBarras ?? p.CodigoBarras ?? '') === codigo);
      // Abre direto o card do produto lido: é o passo seguinte que o funcionário faria.
      // Produto fora do ERP não abre — o card explica o motivo no lugar do formulário.
      const travado =
        achado &&
        (foraDoErp(achado) ||
          (statusContagemDe(achado) === 'CONFERIDO' && !podeReabrirConferido));
      setExpandido(achado && !travado ? achado.id : null);
    },
    [produtos, podeReabrirConferido, temLote],
  );

  const fecharLeitor = useCallback(() => setLendoCodigo(false), []);

  return (
    <section className="pilha-g">
      {/*
        Conferiu, fechou. O aviso vem antes de tudo porque explica por que os cards não
        abrem — sem ele o funcionário toca item por item achando que o app travou.
      */}
      {!temLote && !carregandoProdutos && (
        <p className="aviso" role="status">
          <strong>Sem lote aberto.</strong> Toque em qualquer item para informar o lote desta
          rodada — é por ele que a contagem será localizada depois.
        </p>
      )}

      {temLote && lote && (
        <p className="contagem__lote">
          Contando o <strong>Lote {lote}</strong>
        </p>
      )}

      {contagemFechada && (
        <p className="aviso" role="status">
          <strong>Contagem encerrada.</strong> Este estoque já teve itens conferidos, então
          ninguém conta nele até a rodada ser reaberta. Um administrador reabre em Produtos →
          Limpar contagem, ou desfazendo as conferências no painel de auditoria.
        </p>
      )}

      {/*
        O painel inteiro espera o dado conciliar.

        Ele ficava fora do esqueleto, que cobria só a lista. Com o cache ainda segurando os
        documentos de uma importação anterior, o total entrava alto e ia descendo na frente
        do funcionário — 3300 até 1600 — junto com a barra de progresso andando para trás.
        Número que se move sozinho não é informação, é ruído que gera desconfiança na
        contagem inteira.
      */}
      {carregandoProdutos || conciliando ? (
        <div className="painel-progresso">
          <p className="painel-progresso__numero">
            <span className="painel-progresso__total">sincronizando…</span>
          </p>
        </div>
      ) : (
      <div className="painel-progresso">
        <div className="painel-progresso__topo">
          <p className="painel-progresso__numero">
            {progresso.contados}
            <span className="painel-progresso__total"> / {progresso.total}</span>
          </p>
          <p className="painel-progresso__pct">{progresso.percentual}%</p>
        </div>

        <div
          className="progresso__trilha"
          role="progressbar"
          aria-valuenow={progresso.percentual}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso da contagem"
        >
          <div className="progresso__barra" style={{ width: `${progresso.percentual}%` }} />
        </div>

        <div className="painel-progresso__rodape">
          <span>{progresso.contados} contados</span>
          <span>{progresso.pendentes} a contar</span>
        </div>
      </div>
      )}

      <div className="pilha">
        <div className="busca">
          <input
            className="campo__entrada"
            type="search"
            placeholder="Buscar por nome ou código"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setVisiveis(PAGINA);
            }}
          />
          <button
            className="botao botao--primario botao--icone"
            type="button"
            onClick={() => setLendoCodigo(true)}
            aria-label="Ler código de barras"
            title="Ler código de barras"
          >
            <Icone nome="codigo" tamanho={1.25} />
          </button>
        </div>

        <div className="rolagem-h">
          <nav className="segmentado" aria-label="Filtros">
            {abas.map((f) => {
              const total = contagens[f.id];
              // Aba sem item só polui; some, exceto "Todos" e a que está selecionada.
              if (total === 0 && f.id !== filtro && f.id !== 'all') return null;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={
                    filtro === f.id ? 'segmentado__item segmentado__item--ativo' : 'segmentado__item'
                  }
                  onClick={() => trocarFiltro(f.id)}
                  aria-pressed={filtro === f.id}
                >
                  {f.rotulo}
                  <span className="segmentado__contador">{total}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/*
        `carregandoProdutos` sozinho, sem `&& produtos.length === 0`.

        A condição antiga nunca era verdadeira ao reabrir o app: o cache do Firestore já
        tinha a lista, então o esqueleto não aparecia e a tela liberava com dado do
        aparelho. Era o que fazia surgir item duplicado e contagem inflada até o servidor
        responder. Ver `podeLiberarTela` em @themis/shared.
      */}
      {carregandoProdutos ? (
        <Esqueleto linhas={6} texto="Sincronizando os produtos com o servidor…" />
      ) : lista.length === 0 ? (
        <div className="vazio">
          <p className="vazio__titulo">
            {busca ? 'Nada encontrado' : mensagemVazio(filtro)}
          </p>
          {busca && <p>Nenhum produto corresponde a “{busca}”.</p>}
        </div>
      ) : (
        <div className="pilha">
          <p className="contagem__resumo">
            {lista.length} {lista.length === 1 ? 'produto' : 'produtos'}
          </p>

          <ul className="lista">
            {mostrados.map((p) => (
              <CardProduto
                key={p.id}
                produto={p}
                expandido={expandido === p.id}
                onAlternar={alternar}
                onSalvar={salvarContagem}
                onEditar={permissoes.gerenciarProdutos ? setEditando : undefined}
                somenteLeitura={somenteLeitura}
                verSistema={verSistema}
                podeReabrirConferido={podeReabrirConferido}
                contagemFechada={contagemFechada}
              />
            ))}
          </ul>

          {visiveis < lista.length && (
            <button
              className="botao botao--secundario botao--largo"
              type="button"
              onClick={() => setVisiveis((v) => v + PAGINA)}
            >
              Mostrar mais · {lista.length - visiveis} restantes
            </button>
          )}
        </div>
      )}

      {lendoCodigo && <LeitorCodigo onLer={aoLerCodigo} onFechar={fecharLeitor} />}

      <CardLote aberto={pedindoLote} onFechar={() => setPedindoLote(false)} />

      <ModalEditarProduto produto={editando} onFechar={() => setEditando(null)} />
    </section>
  );
}
