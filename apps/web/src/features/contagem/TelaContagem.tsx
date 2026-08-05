import { useMemo, useState } from 'react';
import { FILTROS, filtrarProdutos, mensagemVazio, type FiltroContagem } from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { Carregando } from '../../components/Carregando.js';
import { CardProduto } from './CardProduto.js';
import { LeitorCodigo } from './LeitorCodigo.js';

/** Quantos itens a lista mostra por vez. Estoques passam de 2000 produtos. */
const PAGINA = 40;

export function TelaContagem() {
  const { produtos, carregandoProdutos, salvarContagem, atualizados, datasAlteracao } = useEstoque();

  const [filtro, setFiltro] = useState<FiltroContagem>('all');
  const [busca, setBusca] = useState('');
  const [expandido, setExpandido] = useState<string | null>(null);
  const [visiveis, setVisiveis] = useState(PAGINA);
  const [lendoCodigo, setLendoCodigo] = useState(false);

  const lista = useMemo(
    () =>
      filtrarProdutos(produtos, filtro, {
        atualizados,
        busca,
        // Na aba "Atualizados", o mais recente primeiro: é a ordem em que o
        // funcionário quer conferir o que acabou de contar.
        ...(filtro === 'updated' ? { ordenarPorData: datasAlteracao } : {}),
      }),
    [produtos, filtro, atualizados, busca, datasAlteracao],
  );

  const mostrados = lista.slice(0, visiveis);

  function trocarFiltro(novo: FiltroContagem) {
    setFiltro(novo);
    setVisiveis(PAGINA);
    setExpandido(null);
  }

  function aoLerCodigo(codigo: string) {
    setLendoCodigo(false);
    setBusca(codigo);
    setFiltro('all');
    setVisiveis(PAGINA);

    const achado = produtos.find(
      (p) => String(p.codigoBarras ?? p.CodigoBarras ?? '') === codigo,
    );
    // Abre direto o card do produto lido: é o passo que o funcionário faria em seguida.
    setExpandido(achado ? achado.id : null);
  }

  return (
    <section className="contagem">
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
          className="botao botao--neutro"
          type="button"
          onClick={() => setLendoCodigo(true)}
          aria-label="Ler código de barras"
        >
          Ler código
        </button>
      </div>

      <nav className="abas" aria-label="Filtros">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            className={filtro === f.id ? 'aba aba--ativa' : 'aba'}
            type="button"
            onClick={() => trocarFiltro(f.id)}
          >
            {f.rotulo}
          </button>
        ))}
      </nav>

      <p className="contagem__resumo">
        {lista.length} {lista.length === 1 ? 'produto' : 'produtos'}
      </p>

      {carregandoProdutos && produtos.length === 0 ? (
        <Carregando texto="Carregando produtos..." />
      ) : lista.length === 0 ? (
        <p className="vazio">{busca ? 'Nenhum produto encontrado para esta busca' : mensagemVazio(filtro)}</p>
      ) : (
        <>
          <ul className="lista">
            {mostrados.map((p) => (
              <CardProduto
                key={p.id}
                produto={p}
                expandido={expandido === p.id}
                onAlternar={() => setExpandido((atual) => (atual === p.id ? null : p.id))}
                onSalvar={(qtd, validade) => salvarContagem(p, qtd, validade)}
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

      {lendoCodigo && <LeitorCodigo onLer={aoLerCodigo} onFechar={() => setLendoCodigo(false)} />}
    </section>
  );
}
