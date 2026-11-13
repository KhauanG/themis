import { useState } from 'react';
import { buscarNoCadastro, codigoBarrasDe, idProdutoDe, nomeDe, type Produto } from '@themis/shared';

const DICA_BUSCA = 'Buscar por nome, código de barras ou código no ERP';

interface Props {
  produtos: readonly Produto[];
  onEditar: (produtoId: string) => void;
}

/** Lista do cadastro com busca. Mostra no máximo 50 linhas; o resto se acha refinando a busca. */
export function ListaProdutos({ produtos, onEditar }: Props) {
  const [termo, setTermo] = useState('');
  const { linhas, total } = buscarNoCadastro(produtos, termo);

  return (
    <div className="pilha" style={{ marginTop: 'var(--e6)' }}>
      <p className="rotulo-secao">Lista de produtos</p>
      <input
        className="campo__entrada"
        type="search"
        placeholder={DICA_BUSCA}
        aria-label={DICA_BUSCA}
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
      />
      {total > linhas.length && (
        <p className="campo__ajuda">Mostrando {linhas.length} de {total}. Refine a busca.</p>
      )}
      {total === 0 && <p className="campo__ajuda">Nenhum produto encontrado.</p>}
      <ul className="acoes-lista">
        {linhas.map((p) => (
          <li key={p.id} className="acao" style={{ cursor: 'default' }}>
            <span className="acao__texto">
              <span className="acao__titulo">{nomeDe(p)}</span>
              <span className="acao__descricao">
                Código {codigoBarrasDe(p) || '—'} · ERP {String(idProdutoDe(p) ?? '') || '—'}
              </span>
            </span>
            <button className="botao botao--secundario botao--mini" type="button" onClick={() => onEditar(p.id)}>
              Editar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
