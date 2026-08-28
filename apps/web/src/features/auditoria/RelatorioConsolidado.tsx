import { useMemo, useState } from 'react';
import { consolidarCiclos, type Auditoria } from '@themis/shared';
import { Icone } from '../../components/Icone.js';
import { useToast } from '../../contexts/ToastContext.js';
import { exportarConsolidadoPDF } from '../../lib/pdf.js';

interface Props {
  /** Auditorias salvas do estoque aberto, como vieram do Firestore. */
  salvas: readonly Auditoria[];
  estoque: string;
  /** Chamado após exportar, para o histórico registrar. */
  aoExportar?: (ciclos: number) => void;
}

/**
 * Relatório consolidado: escolhe ciclos do estoque e soma.
 *
 * ## O que este relatório mede
 *
 * Acurácia da contagem ao longo do tempo. Cada ciclo é uma **medição**: de todas as
 * contagens feitas no período, quantas bateram com o saldo do sistema.
 *
 * ⚠️ Um produto contado em três ciclos aparece **três vezes** no total. É o que a pergunta
 * pede — mas é também o mal-entendido natural de quem lê o número solto, por isso a tela
 * diz "medições" em vez de "itens" e traz o aviso na frente. Ver o topo de
 * `packages/shared/src/consolidado.ts`.
 *
 * O cálculo mora em `consolidarCiclos`, no domínio, e é testado lá. Aqui só há escolha e
 * apresentação.
 */
export function RelatorioConsolidado({ salvas, estoque, aoExportar }: Props) {
  const { mostrar } = useToast();

  // Todos marcados na abertura: quem entra aqui quer o quadro completo, e desmarcar o que
  // não interessa é menos trabalho que marcar um por um num estoque com vinte ciclos.
  const [escolhidos, setEscolhidos] = useState<Set<string>>(
    () => new Set(salvas.map((a) => a.id ?? '')),
  );
  const [exportando, setExportando] = useState(false);

  const selecionadas = useMemo(
    () => salvas.filter((a) => escolhidos.has(a.id ?? '')),
    [salvas, escolhidos],
  );

  const relatorio = useMemo(() => consolidarCiclos(selecionadas), [selecionadas]);
  const { totais } = relatorio;

  function alternar(id: string) {
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  const todosMarcados = escolhidos.size === salvas.length && salvas.length > 0;

  async function exportar() {
    if (exportando || selecionadas.length === 0) return;
    setExportando(true);
    try {
      await exportarConsolidadoPDF(relatorio, estoque);
      aoExportar?.(selecionadas.length);
    } catch (erro) {
      console.error('[consolidado] Exportação falhou:', erro);
      mostrar('Não foi possível gerar o relatório.', 'error');
    } finally {
      setExportando(false);
    }
  }

  if (salvas.length === 0) {
    return (
      <div className="vazio">
        <p className="vazio__titulo">Nenhuma contagem finalizada</p>
        <p>
          O relatório consolidado soma ciclos já finalizados. Finalize uma contagem para ela
          aparecer aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="pilha-g">
      <div>
        <div className="consolidado__topo">
          <p className="rotulo-secao">Ciclos somados</p>
          <button
            className="botao botao--texto botao--mini"
            type="button"
            onClick={() =>
              setEscolhidos(todosMarcados ? new Set() : new Set(salvas.map((a) => a.id ?? '')))
            }
          >
            {todosMarcados ? 'Desmarcar todos' : 'Marcar todos'}
          </button>
        </div>

        <ul className="consolidado__ciclos">
          {salvas.map((a) => {
            const id = a.id ?? '';
            const marcado = escolhidos.has(id);
            return (
              <li key={id}>
                <label className={marcado ? 'ciclo-chip ciclo-chip--ativo' : 'ciclo-chip'}>
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() => alternar(id)}
                    aria-label={`Ciclo ${a.contagemCycle} de ${a.data.toLocaleDateString('pt-BR')}`}
                  />
                  <span className="ciclo-chip__numero">Ciclo {a.contagemCycle}</span>
                  <span className="ciclo-chip__data">{a.data.toLocaleDateString('pt-BR')}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {selecionadas.length === 0 ? (
        <div className="vazio">
          <p className="vazio__titulo">Nenhum ciclo selecionado</p>
          <p>Marque ao menos um ciclo para ver o consolidado.</p>
        </div>
      ) : (
        <>
          {/*
            O aviso vem antes dos números, não depois. Lido depois, o estrago já aconteceu:
            "1.700 medições" num estoque de 850 produtos é interpretado como erro do sistema
            ou como se a loja tivesse 1.700 itens.
          */}
          <p className="aviso" role="status">
            <strong>Cada ciclo é uma medição.</strong> Um produto contado em dois ciclos entra
            duas vezes no total — é assim que se mede acurácia ao longo do tempo, e não é a
            quantidade de produtos do estoque.
          </p>

          <ul className="resumo">
            <li>
              <span>Medições</span>
              <strong>{totais.contados}</strong>
            </li>
            <li>
              <span>Corretas</span>
              <strong>{totais.corretos}</strong>
            </li>
            <li>
              <span>Divergentes</span>
              <strong>{totais.incorretos}</strong>
            </li>
            <li>
              <span>Acerto</span>
              <strong>{totais.percentualCorretos}%</strong>
            </li>
            <li>
              <span>Divergência</span>
              <strong>{totais.percentualIncorretos}%</strong>
            </li>
            {totais.corrigidos > 0 && (
              <li>
                <span>Conferidos</span>
                <strong>{totais.corrigidos}</strong>
              </li>
            )}
          </ul>

          <div className="tabela-caixa">
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">Ciclo</th>
                  <th scope="col">Data</th>
                  <th scope="col" className="num">Contáveis</th>
                  <th scope="col" className="num">Medições</th>
                  <th scope="col" className="num">Cobertura</th>
                  <th scope="col" className="num">Corretas</th>
                  <th scope="col" className="num">Divergentes</th>
                  <th scope="col" className="num">Acerto</th>
                </tr>
              </thead>
              <tbody>
                {relatorio.ciclos.map((c) => (
                  <tr key={c.auditoriaId}>
                    <td>{c.ciclo}</td>
                    <td>{c.data.toLocaleDateString('pt-BR')}</td>
                    <td className="num">{c.total}</td>
                    <td className="num">{c.contados}</td>
                    <td className="num">{c.percentualCobertura}%</td>
                    <td className="num">{c.corretos}</td>
                    <td className="num">{c.incorretos}</td>
                    <td className="num">{c.percentualCorretos}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>
                    <strong>
                      Total · {totais.ciclos} {totais.ciclos === 1 ? 'ciclo' : 'ciclos'}
                    </strong>
                  </td>
                  <td className="num"><strong>{totais.total}</strong></td>
                  <td className="num"><strong>{totais.contados}</strong></td>
                  <td className="num"><strong>{totais.percentualCobertura}%</strong></td>
                  <td className="num"><strong>{totais.corretos}</strong></td>
                  <td className="num"><strong>{totais.incorretos}</strong></td>
                  <td className="num"><strong>{totais.percentualCorretos}%</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <button
            className="botao botao--primario botao--largo"
            type="button"
            onClick={() => void exportar()}
            disabled={exportando}
          >
            <Icone nome="baixar" />
            {exportando ? ' Gerando…' : ' Baixar relatório em PDF'}
          </button>
        </>
      )}
    </div>
  );
}
