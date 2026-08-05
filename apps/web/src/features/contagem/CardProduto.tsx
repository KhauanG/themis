import { memo } from 'react';
import {
  codigoBarrasDe,
  fisicoDe,
  nomeDe,
  sistemaDe,
  statusContagemDe,
  validadeDe,
  type Produto,
} from '@themis/shared';
import { FormContagem } from './FormContagem.js';

interface Props {
  produto: Produto;
  expandido: boolean;
  /** Recebe o id para que a lista possa passar um callback estável e o `memo` valer. */
  onAlternar: (produtoId: string) => void;
  onSalvar: (produto: Produto, quantidade: number, validade: string) => Promise<boolean>;
}

/** `YYYY-MM-DD` para `DD/MM`, sem passar por `new Date`, que desloca o fuso. */
function validadeCurta(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

const DIAS_ALERTA_VALIDADE = 30;

function diasAte(iso: string): number {
  const hoje = new Date().toISOString().slice(0, 10);
  // Comparação em ISO evita fuso: a diferença é calculada em UTC dos dois lados.
  return Math.round((Date.parse(iso) - Date.parse(hoje)) / 86_400_000);
}

function CardProdutoBase({ produto, expandido, onAlternar, onSalvar }: Props) {
  const status = statusContagemDe(produto);
  const contado = status !== null;
  const conferido = status === 'CONFERIDO';

  const fisico = fisicoDe(produto);
  const sistema = sistemaDe(produto);
  const diferenca = fisico - sistema;
  const critico = Math.abs(diferenca) >= 10;

  const validade = validadeDe(produto);
  const dias = validade ? diasAte(validade) : null;

  return (
    <li
      className={[
        'card',
        contado ? 'card--contado' : '',
        conferido ? 'card--conferido' : '',
        expandido ? 'card--aberto' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        className="card__topo"
        type="button"
        onClick={() => onAlternar(produto.id)}
        aria-expanded={expandido}
      >
        <div className="card__info">
          <span className="card__nome">{nomeDe(produto)}</span>
          <span className="card__meta">
            <span className="card__codigo">{codigoBarrasDe(produto) || 'sem código'}</span>
            {validade && dias !== null && (
              <span
                className={
                  dias < 0
                    ? 'etiqueta etiqueta--vencido'
                    : dias <= DIAS_ALERTA_VALIDADE
                      ? 'etiqueta etiqueta--alerta'
                      : 'etiqueta'
                }
              >
                {dias < 0 ? 'vencido' : `val. ${validadeCurta(validade)}`}
              </span>
            )}
          </span>
        </div>

        <div className="card__numeros">
          <span className={contado ? 'card__qtd' : 'card__qtd card__qtd--vazio'}>
            {contado ? fisico : '—'}
          </span>
          <span className="card__sistema">sist. {sistema}</span>
          {contado && diferenca !== 0 && (
            <span className={critico ? 'card__dif card__dif--critico' : 'card__dif card__dif--erro'}>
              {diferenca > 0 ? `+${diferenca}` : diferenca}
            </span>
          )}
          {contado && diferenca === 0 && <span className="card__dif card__dif--ok">ok</span>}
        </div>
      </button>

      {expandido && (
        <FormContagem
          produto={produto}
          onCancelar={() => onAlternar(produto.id)}
          onSalvar={(quantidade, validade) => onSalvar(produto, quantidade, validade)}
        />
      )}
    </li>
  );
}

/**
 * `memo` importa aqui: o listener do Firestore entrega um array novo a cada gravação, e
 * sem isso os 40 cards da página re-renderizam toda vez que alguém conta um item.
 */
export const CardProduto = memo(CardProdutoBase);
