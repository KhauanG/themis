import { useEffect, useState } from 'react';
import {
  codigoBarrasDe,
  fisicoDe,
  isItemContado,
  nomeDe,
  sistemaDe,
  statusContagemDe,
  validadeDe,
  type Produto,
} from '@themis/shared';

interface Props {
  produto: Produto;
  expandido: boolean;
  onAlternar: () => void;
  onSalvar: (quantidade: number, validade: string) => Promise<boolean>;
}

/** `YYYY-MM-DD` para `DD/MM/AAAA` sem passar por `new Date`, que desloca o fuso. */
function formatarValidade(iso: string | null): string {
  if (!iso) return '';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function classeDiferenca(diferenca: number): string {
  if (diferenca === 0) return 'card__dif card__dif--ok';
  return Math.abs(diferenca) >= 10 ? 'card__dif card__dif--critico' : 'card__dif card__dif--erro';
}

export function CardProduto({ produto, expandido, onAlternar, onSalvar }: Props) {
  const contado = isItemContado(produto);
  const conferido = statusContagemDe(produto) === 'CONFERIDO';

  const [quantidade, setQuantidade] = useState('');
  const [validade, setValidade] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Recarrega os campos ao abrir e sempre que o produto mudar por baixo (outro aparelho
  // contou o mesmo item). Sem isso o formulário mostraria um valor já vencido.
  useEffect(() => {
    if (!expandido) return;
    setQuantidade(produto.quantidade != null ? String(produto.quantidade) : '');
    setValidade(validadeDe(produto) ?? '');
  }, [expandido, produto]);

  const fisico = fisicoDe(produto);
  const sistema = sistemaDe(produto);
  const diferenca = fisico - sistema;

  async function aoSalvar() {
    if (salvando) return;

    const valor = Number(quantidade.replace(',', '.'));
    if (quantidade.trim() === '' || !Number.isFinite(valor)) return;

    setSalvando(true);
    try {
      const ok = await onSalvar(valor, validade);
      if (ok) onAlternar();
    } finally {
      setSalvando(false);
    }
  }

  const validadeSalva = validadeDe(produto);

  return (
    <li className={`card${contado ? ' card--contado' : ''}${conferido ? ' card--conferido' : ''}`}>
      <button className="card__topo" type="button" onClick={onAlternar} aria-expanded={expandido}>
        <div className="card__info">
          <span className="card__nome">{nomeDe(produto)}</span>
          <span className="card__meta">
            {codigoBarrasDe(produto) ?? 'sem código de barras'}
            {validadeSalva && ` · val. ${formatarValidade(validadeSalva)}`}
          </span>
        </div>
        <div className="card__numeros">
          <span className="card__qtd">{produto.quantidade != null ? produto.quantidade : '—'}</span>
          <span className="card__sistema">sist. {sistema}</span>
          {contado && <span className={classeDiferenca(diferenca)}>{diferenca > 0 ? `+${diferenca}` : diferenca}</span>}
        </div>
      </button>

      {expandido && (
        <div className="card__cascata">
          <div className="card__campos">
            <label className="campo">
              <span className="campo__rotulo">Quantidade contada</span>
              <input
                className="campo__entrada"
                type="number"
                inputMode="decimal"
                step="any"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void aoSalvar();
                }}
                autoFocus
              />
            </label>

            <label className="campo">
              <span className="campo__rotulo">Validade mais curta</span>
              <input
                className="campo__entrada"
                type="date"
                value={validade}
                onChange={(e) => setValidade(e.target.value)}
              />
            </label>
          </div>

          <div className="card__acoes">
            <button className="botao botao--neutro" type="button" onClick={onAlternar}>
              Cancelar
            </button>
            <button
              className="botao botao--primario"
              type="button"
              onClick={() => void aoSalvar()}
              disabled={salvando || quantidade.trim() === ''}
            >
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
