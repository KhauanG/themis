import { useCallback, useMemo, useState } from 'react';
import {
  FILTROS,
  contarPorFiltro,
  filtrarProdutos,
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

/** Quantos itens a lista mostra por vez. Estoques passam de 2000 produtos. */
const PAGINA = 40;

export function TelaContagem() {
  const { produtos, carregandoProdutos, salvarContagem, progresso, somenteLeitura } = useEstoque();
  const { permissoes } = useAuth();

  const [filtro, setFiltro] = useState<FiltroContagem>('all');
  const [busca, setBusca] = useState('');
  const [expandido, setExpandido] = useState<string | null>(null);
  const [visiveis, setVisiveis] = useState(PAGINA);
  const [lendoCodigo, setLendoCodigo] = useState(false);
  const [editando, setEditando] = useState<Produto | null>(null);

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

  const alternar = useCallback((produtoId: string) => {
    setExpandido((atual) => (atual === produtoId ? null : produtoId));
  }, []);

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

      const achado = produtos.find((p) => String(p.codigoBarras ?? p.CodigoBarras ?? '') === codigo);
      // Abre direto o card do produto lido: é o passo seguinte que o funcionário faria.
      setExpandido(achado ? achado.id : null);
    },
    [produtos],
  );

  const fecharLeitor = useCallback(() => setLendoCodigo(false), []);

  return (
    <section className="pilha-g">
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
            {FILTROS.map((f) => {
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

      {carregandoProdutos && produtos.length === 0 ? (
        <Esqueleto linhas={6} />
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

      <ModalEditarProduto produto={editando} onFechar={() => setEditando(null)} />
    </section>
  );
}
