import { memo } from 'react';
import {
  codigoBarrasDe,
  fisicoDe,
  foraDoErp,
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
  /** Só admin/master recebe. */
  onEditar?: ((produto: Produto) => void) | undefined;
  somenteLeitura?: boolean;
  /**
   * Mostrar saldo do sistema e diferença. Falso para quem só conta — ver
   * `permissoes.verEstoqueSistema`.
   */
  verSistema?: boolean;
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

const LIMITE_CRITICO = 10;

function CardProdutoBase({
  produto,
  expandido,
  onAlternar,
  onSalvar,
  onEditar,
  somenteLeitura = false,
  verSistema = false,
}: Props) {
  const status = statusContagemDe(produto);
  const contado = status !== null;
  const conferido = status === 'CONFERIDO';

  /**
   * Produto que o ERP não conhece não é contável.
   *
   * Não é frescura de interface: sem saldo do ERP, a contagem seria comparada com o valor
   * da última importação e produziria uma divergência que ninguém confirmou — que vai parar
   * no relatório impresso pedindo correção de saldo, quando o que falta é cadastro no
   * Nuvem3. O card fica visível de propósito: sumir com ele esconderia o problema.
   */
  const fora = foraDoErp(produto);

  const fisico = fisicoDe(produto);
  const sistema = sistemaDe(produto);
  const diferenca = fisico - sistema;

  const validade = validadeDe(produto);
  const dias = validade ? diasAte(validade) : null;

  const classeEstado = conferido
    ? 'card__estado card__estado--conferido'
    : contado
      ? 'card__estado card__estado--contado'
      : 'card__estado';

  return (
    <li className={expandido ? 'card card--aberto' : fora ? 'card card--travado' : 'card'}>
      <button
        className="card__topo"
        type="button"
        onClick={() => !fora && onAlternar(produto.id)}
        aria-expanded={fora ? undefined : expandido}
        aria-disabled={fora || undefined}
        // `disabled` de verdade tiraria o card da navegação por teclado e do leitor de
        // tela. O motivo precisa ser anunciável — o funcionário tem que entender por que
        // aquele item não abre.
        title={fora ? 'Produto fora do ERP: não pode ser contado' : undefined}
      >
        <span className={classeEstado} aria-hidden="true" />

        <span className="card__info">
          <span className="card__nome">{nomeDe(produto)}</span>
          <span className="card__meta">
            <span className="card__codigo">{codigoBarrasDe(produto) || 'sem código'}</span>

            {validade && dias !== null && (
              <span
                className={
                  dias < 0
                    ? 'etiqueta etiqueta--critico'
                    : dias <= DIAS_ALERTA_VALIDADE
                      ? 'etiqueta etiqueta--alerta'
                      : 'etiqueta etiqueta--neutra'
                }
              >
                {dias < 0 ? 'vencido' : `val ${validadeCurta(validade)}`}
              </span>
            )}

            {conferido && <span className="etiqueta etiqueta--acento">conferido</span>}
            {fora && <span className="etiqueta etiqueta--acento">fora do ERP</span>}
          </span>
        </span>

        <span className="card__numeros">
          <span className={contado && !fora ? 'card__qtd' : 'card__qtd card__qtd--vazio'}>
            {contado && !fora ? fisico : '—'}
          </span>

          {/*
            Contagem às cegas: sem `verSistema`, nada aqui pode dizer se o número bateu.
            Nem a diferença, nem o "ok" — os dois entregam o saldo do sistema.
            Para quem conta, o retorno é "contado", e isso basta.
          */}
          {verSistema && !fora && contado && diferenca !== 0 && (
            <span
              className={
                Math.abs(diferenca) >= LIMITE_CRITICO
                  ? 'etiqueta etiqueta--critico'
                  : 'etiqueta etiqueta--alerta'
              }
            >
              {diferenca > 0 ? `+${diferenca}` : diferenca}
            </span>
          )}
          {verSistema && !fora && contado && diferenca === 0 && (
            <span className="etiqueta etiqueta--ok">ok</span>
          )}
          {verSistema && !fora && !contado && <span className="card__sistema">sistema {sistema}</span>}
          {!verSistema && !fora && contado && <span className="etiqueta etiqueta--neutra">contado</span>}
        </span>
      </button>

      {fora && (
        <p className="card__travado">
          Este produto não está na listagem do ERP desta loja, então não há saldo para
          comparar. Resolva o cadastro no Nuvem3 e busque o estoque de novo.
        </p>
      )}

      {expandido && !fora && (
        <FormContagem
          produto={produto}
          onCancelar={() => onAlternar(produto.id)}
          onSalvar={(quantidade, validadeNova) => onSalvar(produto, quantidade, validadeNova)}
          onEditar={onEditar ? () => onEditar(produto) : undefined}
          somenteLeitura={somenteLeitura}
          verSistema={verSistema}
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
