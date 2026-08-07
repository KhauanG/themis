import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FILTRO_PADRAO,
  ROTULO_ORDEM,
  ROTULO_SITUACAO,
  direcaoDaColuna,
  ordemAoClicar,
  calcularEstatisticas,
  filtrarLinhas,
  linhasDeProdutos,
  linhasDeSnapshot,
  type Auditoria,
  type FiltroRelatorio,
  type LinhaRelatorio,
  type ColunaOrdenavel,
  type OrdemRelatorio,
  type SituacaoRelatorio,
  type StatusAuditoria,
} from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Esqueleto } from '../../components/Esqueleto.js';
import { Icone } from '../../components/Icone.js';
import { listarAuditorias } from '../../lib/auditorias-repo.js';
import { desfazerConferido, marcarConferido } from '../../lib/produtos-repo.js';
import { exportarContagemPDF, exportarValidadePDF, type ContextoRelatorio } from '../../lib/pdf.js';
import { exportarPlanilha } from '../../lib/planilha.js';
import { registrar } from '../../lib/historico.js';

interface PropsTh {
  coluna: ColunaOrdenavel;
  rotulo: string;
  /** Alinha à direita, como o resto da coluna numérica. */
  numerica?: boolean;
  ordem: OrdemRelatorio;
  aoOrdenar: (coluna: ColunaOrdenavel) => void;
}

/**
 * Cabeçalho que ordena ao ser clicado.
 *
 * `aria-sort` no `<th>` é o que faz o leitor de tela anunciar "coluna ordenada em ordem
 * crescente" — sem ele, o usuário cego ouve um botão que aparentemente não faz nada. A
 * seta é redundante de propósito: quem enxerga não deveria precisar clicar para descobrir
 * qual coluna manda na ordem.
 */
function ThOrdenavel({ coluna, rotulo, numerica = false, ordem, aoOrdenar }: PropsTh) {
  const direcao = direcaoDaColuna(coluna, ordem);
  const seta = direcao === 'ascending' ? '▲' : direcao === 'descending' ? '▼' : '';

  return (
    <th
      className={numerica ? 'num' : undefined}
      aria-sort={direcao ?? 'none'}
      scope="col"
    >
      <button
        type="button"
        className={direcao ? 'th-ordem th-ordem--ativa' : 'th-ordem'}
        onClick={() => aoOrdenar(coluna)}
        title={`Ordenar por ${rotulo.toLowerCase()}`}
      >
        {rotulo}
        <span className="th-ordem__seta" aria-hidden="true">
          {seta}
        </span>
      </button>
    </th>
  );
}

const CLASSE_STATUS: Record<StatusAuditoria, string> = {
  CORRETO: 'etiqueta etiqueta--ok',
  ERRADO: 'etiqueta etiqueta--alerta',
  CRITICO: 'etiqueta etiqueta--critico',
  'NÃO CONTADO': 'etiqueta etiqueta--neutra',
  // Não é grau de divergência: é falta de cadastro no ERP. Cor própria para não ser lido
  // como "errado" nem como "ok".
  'FORA DO ERP': 'etiqueta etiqueta--acento',
};

export function PainelAuditoria() {
  const { produtos, estoqueAtual, ciclo, contextoLog } = useEstoque();
  const { permissoes } = useAuth();
  const { mostrar } = useToast();

  const [fonte, setFonte] = useState('ao-vivo');
  const [salvas, setSalvas] = useState<Auditoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<FiltroRelatorio>(FILTRO_PADRAO);
  const [exportando, setExportando] = useState(false);
  const [corrigindo, setCorrigindo] = useState<string | null>(null);

  /**
   * Depende do **id**, não do objeto `estoqueAtual`.
   *
   * O objeto ganha identidade nova toda vez que o listener de `inventories` re-emite — o
   * que acontece quando a conexão se restabelece, e em wifi de depósito isso é frequente.
   * Com o objeto na dependência, a lista era rebuscada e o esqueleto piscava na tela sem
   * nada ter mudado de fato.
   */
  const estoqueId = estoqueAtual?.id;

  /** Último estoque já carregado. Distingue primeira carga de rebusca. */
  const carregado = useRef<string | null>(null);

  useEffect(() => {
    if (!estoqueId) return;
    let vivo = true;

    // Esqueleto só na primeira carga deste estoque. Numa rebusca, mantém o que já está na
    // tela: trocar dado bom por esqueleto é perder informação, não ganhar.
    if (carregado.current !== estoqueId) {
      setCarregando(true);
      setSalvas([]);
    }

    listarAuditorias(estoqueId)
      .then((lista) => {
        if (!vivo) return;
        setSalvas(lista);
        carregado.current = estoqueId;
      })
      .catch((erro) => {
        console.warn('[auditoria] Não foi possível listar:', erro);
        mostrar('Não foi possível carregar as auditorias salvas.', 'error');
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });

    return () => {
      vivo = false;
    };
  }, [estoqueId, mostrar]);

  const auditoria = fonte === 'ao-vivo' ? null : salvas.find((a) => a.id === fonte);
  const aoVivo = !auditoria;

  // Uma origem só para tela e exportação: antes a tabela mostrava a auditoria salva e a
  // exportação gerava o arquivo com a contagem ao vivo.
  const todas: LinhaRelatorio[] = useMemo(
    () => (auditoria ? linhasDeSnapshot(auditoria.produtos) : linhasDeProdutos(produtos)),
    [auditoria, produtos],
  );

  // O que a tabela mostra e o que o arquivo leva: a mesma função, o mesmo recorte.
  const visiveis = useMemo(() => filtrarLinhas(todas, filtro), [todas, filtro]);

  const estatisticas = useMemo(
    () => (auditoria ? auditoria.estatisticas : calcularEstatisticas(produtos)),
    [auditoria, produtos],
  );

  const contexto: ContextoRelatorio = useMemo(
    () => ({
      estoque: estoqueAtual?.nome ?? estoqueAtual?.id ?? 'estoque',
      ciclo: auditoria?.contagemCycle ?? ciclo,
      filtro,
      totalSemFiltro: todas.length,
      ...(auditoria ? { quando: auditoria.data } : {}),
    }),
    [estoqueAtual, auditoria, ciclo, filtro, todas.length],
  );

  const ajustar = useCallback(
    (mudanca: Partial<FiltroRelatorio>) => setFiltro((atual) => ({ ...atual, ...mudanca })),
    [],
  );

  /**
   * Clique no cabeçalho: aplica a ordem da coluna, e inverte se já era ela.
   *
   * Mexe no mesmo `filtro.ordem` que o seletor — não há duas fontes de verdade. Clicar no
   * cabeçalho muda o seletor, e vice-versa.
   */
  const ordenarPor = useCallback(
    (coluna: ColunaOrdenavel) => {
      setFiltro((atual) => ({ ...atual, ordem: ordemAoClicar(coluna, atual.ordem) }));
    },
    [],
  );

  const exportar = useCallback(
    async (qual: 'contagem' | 'validade' | 'planilha') => {
      if (exportando) return;
      if (visiveis.length === 0) {
        mostrar('O recorte atual não tem nenhum item para exportar.', 'warning');
        return;
      }
      setExportando(true);
      try {
        if (qual === 'contagem') {
          await exportarContagemPDF(visiveis, contexto, estatisticas);
        } else if (qual === 'validade') {
          const total = await exportarValidadePDF(visiveis, contexto);
          if (total === 0) mostrar('Nenhum item do recorte tem validade preenchida.', 'info');
        } else {
          await exportarPlanilha(visiveis, contexto.estoque);
        }
        if (contextoLog) {
          void registrar('EXPORTAR_PLANILHA', contextoLog, {
            tipo: qual,
            origem: fonte,
            itens: visiveis.length,
            de: todas.length,
          });
        }
      } catch (erro) {
        console.error('[auditoria] Exportação falhou:', erro);
        mostrar('Não foi possível gerar o arquivo.', 'error');
      } finally {
        setExportando(false);
      }
    },
    [exportando, visiveis, contexto, estatisticas, mostrar, contextoLog, fonte, todas.length],
  );

  /** Conferência do admin: confirma ou descarta a divergência de um item. */
  const conferir = useCallback(
    async (produtoId: string, divergenciaConfirmada: boolean) => {
      if (!estoqueAtual || corrigindo) return;
      setCorrigindo(produtoId);
      try {
        await marcarConferido(estoqueAtual.id, produtoId, divergenciaConfirmada);
        mostrar(
          divergenciaConfirmada ? 'Divergência confirmada.' : 'Item conferido como correto.',
          'success',
        );
        if (contextoLog) {
          // O nome, não só o id: o histórico é lido meses depois, quando ninguém sabe
          // qual produto era `xK92mFq`.
          const linha = todas.find((l) => l.id === produtoId);
          // `todas`, não `visiveis`: o filtro pode ter escondido a linha entre o clique e
          // o registro, e o histórico ficaria com o id cru no lugar do nome.
          void registrar('CONFERIR_ITEM', contextoLog, {
            produto: linha?.nome ?? produtoId,
            divergenciaConfirmada,
            contado: linha?.contado ?? null,
            sistema: linha?.sistema ?? null,
            ciclo,
          });
        }
      } catch (erro) {
        console.error('[auditoria] Conferência falhou:', erro);
        mostrar('Não foi possível marcar o item.', 'error');
      } finally {
        setCorrigindo(null);
      }
    },
    [estoqueAtual, corrigindo, mostrar, contextoLog, ciclo, todas],
  );

  const desfazer = useCallback(
    async (produtoId: string) => {
      if (!estoqueAtual || corrigindo) return;
      setCorrigindo(produtoId);
      try {
        await desfazerConferido(estoqueAtual.id, produtoId);
        if (contextoLog) {
          void registrar('CONFERIR_ITEM', contextoLog, {
            produto: todas.find((l) => l.id === produtoId)?.nome ?? produtoId,
            desfeito: true,
            ciclo,
          });
        }
        mostrar('Conferência desfeita. O item voltou para a lista.', 'info');
      } catch (erro) {
        console.error('[auditoria] Desfazer falhou:', erro);
        mostrar('Não foi possível desfazer.', 'error');
      } finally {
        setCorrigindo(null);
      }
    },
    [estoqueAtual, corrigindo, mostrar, contextoLog, ciclo, todas],
  );

  // Conferir altera o documento do produto: só faz sentido na contagem corrente.
  // Auditoria salva é histórico e não deve ser editável.
  const podeConferir = permissoes.corrigirContagem && aoVivo;
  const statusPorId = useMemo(
    () => new Map(produtos.map((p) => [p.id, p.productStatus ?? null])),
    [produtos],
  );

  if (carregando) return <Esqueleto linhas={5} />;

  return (
    <section className="pilha-g">
      <div>
        <h1 className="titulo-tela">Auditoria</h1>
        <p className="subtitulo">
          {aoVivo
            ? `Contagem em andamento · ciclo ${ciclo}`
            : `Salva em ${auditoria.data.toLocaleString('pt-BR')} · somente leitura`}
        </p>
      </div>

      <div className="barra-filtros">
        <label className="campo">
          <span className="campo__rotulo">Contagem</span>
          <select className="campo__entrada" value={fonte} onChange={(e) => setFonte(e.target.value)}>
            <option value="ao-vivo">Ao vivo — ciclo {ciclo}</option>
            {salvas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome} — {a.data.toLocaleDateString('pt-BR')}
              </option>
            ))}
          </select>
        </label>

        <div className="barra-filtros__linha">
          <label className="campo">
            <span className="campo__rotulo">Situação</span>
            <select
              className="campo__entrada"
              value={filtro.situacao}
              onChange={(e) => ajustar({ situacao: e.target.value as SituacaoRelatorio })}
            >
              {(Object.keys(ROTULO_SITUACAO) as SituacaoRelatorio[]).map((s) => (
                <option key={s} value={s}>
                  {ROTULO_SITUACAO[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="campo">
            <span className="campo__rotulo">Status</span>
            <select
              className="campo__entrada"
              value={filtro.status}
              onChange={(e) => ajustar({ status: e.target.value as StatusAuditoria | 'TODOS' })}
            >
              <option value="TODOS">Todos</option>
              <option value="CORRETO">Corretos</option>
              <option value="ERRADO">Errados</option>
              <option value="CRITICO">Críticos</option>
              <option value="NÃO CONTADO">Não contados</option>
              <option value="FORA DO ERP">Fora do ERP</option>
            </select>
          </label>
        </div>

        <label className="campo">
          <span className="campo__rotulo">Ordenar por</span>
          <select
            className="campo__entrada"
            value={filtro.ordem}
            onChange={(e) => ajustar({ ordem: e.target.value as OrdemRelatorio })}
          >
            {(Object.keys(ROTULO_ORDEM) as OrdemRelatorio[]).map((o) => (
              <option key={o} value={o}>
                {ROTULO_ORDEM[o]}
              </option>
            ))}
          </select>
        </label>

        <div className="barra-filtros__rodape">
          <button
            type="button"
            className={filtro.somenteDivergentes ? 'alternador alternador--ligado' : 'alternador'}
            onClick={() => ajustar({ somenteDivergentes: !filtro.somenteDivergentes })}
            aria-pressed={filtro.somenteDivergentes}
          >
            <span className="alternador__marca" aria-hidden="true" />
            Só divergências
          </button>

          <p className="barra-filtros__contagem">
            <strong>{visiveis.length}</strong> de {todas.length} itens
            {visiveis.length !== todas.length && ' · o arquivo sai igual'}
          </p>
        </div>
      </div>

      <ul className="metricas">
        <li className="metrica">
          <span className="metrica__rotulo">Contados</span>
          <strong className="metrica__valor">{estatisticas.contados}</strong>
        </li>
        <li className="metrica">
          <span className="metrica__rotulo">A contar</span>
          <strong className="metrica__valor">{estatisticas.naoContados}</strong>
        </li>
        <li className="metrica metrica--ok">
          <span className="metrica__rotulo">Corretos</span>
          <strong className="metrica__valor">{estatisticas.corretos}</strong>
        </li>
        <li className="metrica metrica--alerta">
          <span className="metrica__rotulo">Divergentes</span>
          <strong className="metrica__valor">{estatisticas.incorretos}</strong>
        </li>
        <li className="metrica">
          <span className="metrica__rotulo">Divergência</span>
          <strong className="metrica__valor">{estatisticas.percentualIncorretos}%</strong>
        </li>
        {estatisticas.corrigidos.total > 0 && (
          <li className="metrica">
            <span className="metrica__rotulo">Conferidos</span>
            <strong className="metrica__valor">{estatisticas.corrigidos.total}</strong>
          </li>
        )}
      </ul>

      <div>
        <p className="rotulo-secao" style={{ marginBottom: 'var(--e2)' }}>
          Exportar o recorte atual
        </p>
        <div className="acoes-lista">
          <button className="acao" type="button" onClick={() => void exportar('contagem')} disabled={exportando}>
            <span className="acao__icone">
              <Icone nome="baixar" />
            </span>
            <span className="acao__texto">
              <span className="acao__titulo">PDF da contagem</span>
              <span className="acao__descricao">
                {visiveis.length} {visiveis.length === 1 ? 'item' : 'itens'}, na ordem escolhida
              </span>
            </span>
          </button>

          <button className="acao" type="button" onClick={() => void exportar('validade')} disabled={exportando}>
            <span className="acao__icone">
              <Icone nome="baixar" />
            </span>
            <span className="acao__texto">
              <span className="acao__titulo">PDF de validade</span>
              <span className="acao__descricao">Do vencimento mais próximo ao mais distante</span>
            </span>
          </button>

          <button className="acao" type="button" onClick={() => void exportar('planilha')} disabled={exportando}>
            <span className="acao__icone">
              <Icone nome="baixar" />
            </span>
            <span className="acao__texto">
              <span className="acao__titulo">Planilha</span>
              <span className="acao__descricao">Formato .xlsx para análise</span>
            </span>
          </button>
        </div>
      </div>

      {visiveis.length === 0 ? (
        <div className="vazio">
          <p className="vazio__titulo">Nenhum item neste recorte</p>
          <p>Ajuste os filtros acima para ver mais.</p>
        </div>
      ) : (
        <div className="tabela-caixa">
          <div className="rolagem-h">
            <table className="tabela">
              <thead>
                <tr>
                  <ThOrdenavel coluna="nome" rotulo="Produto" ordem={filtro.ordem} aoOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="sistema" rotulo="Sistema" numerica ordem={filtro.ordem} aoOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="contado" rotulo="Contado" numerica ordem={filtro.ordem} aoOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="diferenca" rotulo="Dif." numerica ordem={filtro.ordem} aoOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="status" rotulo="Status" ordem={filtro.ordem} aoOrdenar={ordenarPor} />
                  {podeConferir && <th>Conferência</th>}
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => {
                  const conferido = statusPorId.get(l.id) === 'CONFERIDO';
                  return (
                    <tr key={l.id} className={conferido ? 'linha--conferida' : undefined}>
                      <td>{l.nome}</td>
                      <td className="num">{l.sistema}</td>
                      <td className="num">{l.contado ?? '—'}</td>
                      <td className="num">{l.diferenca}</td>
                      <td>
                        <span className={CLASSE_STATUS[l.status]}>{l.status}</span>
                      </td>
                      {podeConferir && (
                        <td>
                          {conferido ? (
                            <button
                              className="botao botao--secundario botao--mini"
                              type="button"
                              onClick={() => void desfazer(l.id)}
                              disabled={corrigindo === l.id}
                            >
                              Desfazer
                            </button>
                          ) : l.status === 'CORRETO' ||
                            l.status === 'NÃO CONTADO' ||
                            l.status === 'FORA DO ERP' ? (
                            <span className="suave">—</span>
                          ) : (
                            <span className="acoes-linha">
                              <button
                                className="botao botao--secundario botao--mini"
                                type="button"
                                onClick={() => void conferir(l.id, false)}
                                disabled={corrigindo === l.id}
                                title="A contagem estava certa; a divergência não se confirmou"
                              >
                                OK
                              </button>
                              <button
                                className="botao botao--perigo botao--mini"
                                type="button"
                                onClick={() => void conferir(l.id, true)}
                                disabled={corrigindo === l.id}
                                title="A divergência se confirmou na conferência física"
                              >
                                Divergiu
                              </button>
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
