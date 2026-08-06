import { useRef, useState } from 'react';
import { sistemaDe, validadeDe, type Produto } from '@themis/shared';

interface Props {
  produto: Produto;
  onCancelar: () => void;
  onSalvar: (quantidade: number, validade: string) => Promise<boolean>;
  /** Só admin/master recebe; abre a edição de cadastro. */
  onEditar?: (() => void) | undefined;
  /** Estoque travado: mostra o motivo em vez de deixar o usuário tentar e falhar. */
  somenteLeitura?: boolean;
}

function marcaDeTempo(p: Produto): number {
  return p.lastModified instanceof Date ? p.lastModified.getTime() : 0;
}

/**
 * Formulário do card expandido.
 *
 * Componente separado de propósito: ele **monta** quando o card abre, então o valor
 * inicial dos campos é lido uma vez, no `useState`. Quando isso era um `useEffect` com
 * `produto` nas dependências, qualquer gravação de outro aparelho trocava a identidade do
 * objeto e apagava o que o funcionário estava digitando.
 */
export function FormContagem({
  produto,
  onCancelar,
  onSalvar,
  onEditar,
  somenteLeitura = false,
}: Props) {
  const [quantidade, setQuantidade] = useState(
    produto.quantidade != null ? String(produto.quantidade) : '',
  );
  const [validade, setValidade] = useState(validadeDe(produto) ?? '');
  const [salvando, setSalvando] = useState(false);

  // Marca de tempo de quando o formulário abriu. Se o documento mudar enquanto ele está
  // aberto, outro aparelho contou o mesmo item — avisar antes é melhor que deixar o
  // usuário salvar por cima e só então receber o erro de conflito.
  const abertoEm = useRef(marcaDeTempo(produto));
  const mudouNoServidor = marcaDeTempo(produto) > abertoEm.current;

  const valor = Number(quantidade.replace(',', '.'));
  const valido = quantidade.trim() !== '' && Number.isFinite(valor);
  const sistema = sistemaDe(produto);
  const diferenca = valido ? valor - sistema : null;

  async function salvar() {
    if (!valido || salvando) return;
    setSalvando(true);
    try {
      const ok = await onSalvar(valor, validade);
      if (ok) onCancelar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card__cascata">
      {mudouNoServidor && (
        <p className="aviso" role="alert" style={{ marginBottom: 'var(--e4)' }}>
          Outro aparelho alterou este produto agora. Confira antes de salvar.
        </p>
      )}

      <div className="card__campos">
        <label className="campo">
          <span className="campo__rotulo">Quantidade contada</span>
          <input
            className="campo__entrada campo__entrada--numero"
            type="number"
            inputMode="decimal"
            step="any"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void salvar();
            }}
            autoFocus
          />
          <span className="campo__ajuda">
            Sistema: {sistema}
            {diferenca !== null && diferenca !== 0 && (
              <> · diferença {diferenca > 0 ? `+${diferenca}` : diferenca}</>
            )}
          </span>
        </label>

        <label className="campo">
          <span className="campo__rotulo">Validade mais curta</span>
          <input
            className="campo__entrada"
            type="date"
            value={validade}
            onChange={(e) => setValidade(e.target.value)}
          />
          <span className="campo__ajuda">Opcional</span>
        </label>
      </div>

      {somenteLeitura && (
        <p className="aviso" role="status" style={{ marginBottom: 'var(--e4)' }}>
          Este estoque está em modo somente leitura. A contagem está travada.
        </p>
      )}

      <div className="card__acoes">
        {onEditar && (
          <button className="botao botao--secundario" type="button" onClick={onEditar}>
            Editar
          </button>
        )}
        <button className="botao botao--secundario" type="button" onClick={onCancelar}>
          Cancelar
        </button>
        <button
          className="botao botao--primario"
          type="button"
          onClick={() => void salvar()}
          disabled={!valido || salvando || somenteLeitura}
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
