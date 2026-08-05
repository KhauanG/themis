import { useCallback, useMemo, useState } from 'react';
import {
  FILTROS,
  contarPorFiltro,
  filtrarProdutos,
  mensagemVazio,
  type FiltroContagem,
} from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { Esqueleto } from '../../components/Esqueleto.js';
import { CardProduto } from './CardProduto.js';
import { LeitorCodigo } from './LeitorCodigo.js';

/** Quantos itens a lista mostra por vez. Estoques passam de 2000 produtos. */
const PAGINA = 40;

export function TelaContagem() {
  const { produtos, carregandoProdutos, salvarContagem, progresso } = useEstoque();

  const [filtro, setFiltro] = useState<FiltroContagem>('all');
  const [busca, setBusca] = useState('');
  const [expandido, setExpandido] = useState<string | null>(null);
  const [visiveis, setVisiveis] = useState(PAGINA);
  const [lendoCodigo, setLendoCodigo] = useState(false);

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

  const alternar = useCallback((produtoId: string) => {
    setExpandido((atual) => (atual === produtoId ? null : produtoId));
  }, []);

  const trocarFiltro = useCallback((novo: FiltroContagem) => {
    setFiltro(novo);
    setVisiveis(PAGINA);
    setExpandido(null);
  }, []);

  // Estável de propósito: o `useEffect` do leitor tem esta função nas dependências, e um
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

  const contagens = useMemo(() => contarPorFiltro(produtos), [produtos]);

  return (
    <section className="contagem">
      <div className="progresso" role="group" aria-label="Progresso da contagem">
        <div className="progresso__texto">
          <strong>{progresso.contados}</strong> de {progresso.total} contados
          <span className="progresso__pct">{progresso.percentual}%</span>
        </div>
        <div
          className="progresso__trilha"
          role="progressbar"
          aria-valuenow={progresso.percentual}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progresso__barra" style={{ width: `${progresso.percentual}%` }} />
        </div>
      </div>

      <div className="contagem__busca">
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
          ▐▌▍
        </button>
      </div>

      <nav className="abas" aria-label="Filtros">
        {FILTROS.map((f) => {
          const total = contagens[f.id];
          // Aba sem nenhum item só polui: some, exceto a que está selecionada.
          if (total === 0 && f.id !== filtro && f.id !== 'all') return null;
          return (
            <button
              key={f.id}
              className={filtro === f.id ? 'aba aba--ativa' : 'aba'}
              type="button"
              onClick={() => trocarFiltro(f.id)}
            >
              {f.rotulo}
              <span className="aba__contador">{total}</span>
            </button>
          );
        })}
      </nav>

      {carregandoProdutos && produtos.length === 0 ? (
        <Esqueleto linhas={6} />
      ) : lista.length === 0 ? (
        <p className="vazio">
          {busca ? `Nada encontrado para "${busca}"` : mensagemVazio(filtro)}
        </p>
      ) : (
        <>
          <ul className="lista">
            {mostrados.map((p) => (
              <CardProduto
                key={p.id}
                produto={p}
                expandido={expandido === p.id}
                onAlternar={alternar}
                onSalvar={salvarContagem}
              />
            ))}
          </ul>

          {visiveis < lista.length && (
            <button
              className="botao botao--neutro botao--largo"
              type="button"
              onClick={() => setVisiveis((v) => v + PAGINA)}
            >
              Mostrar mais ({lista.length - visiveis} restantes)
            </button>
          )}
        </>
      )}

      {lendoCodigo && <LeitorCodigo onLer={aoLerCodigo} onFechar={fecharLeitor} />}
    </section>
  );
}
