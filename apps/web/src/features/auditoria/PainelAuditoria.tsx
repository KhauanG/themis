import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  calcularEstatisticas,
  linhasDeProdutos,
  linhasDeSnapshot,
  type Auditoria,
  type LinhaRelatorio,
  type StatusAuditoria,
} from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Esqueleto } from '../../components/Esqueleto.js';
import { listarAuditorias } from '../../lib/auditorias-repo.js';
import { desfazerConferido, marcarConferido } from '../../lib/produtos-repo.js';
import { exportarContagemPDF, exportarValidadePDF, type ContextoRelatorio } from '../../lib/pdf.js';
import { exportarPlanilha } from '../../lib/planilha.js';
import { registrar } from '../../lib/historico.js';

const CLASSE_STATUS: Record<StatusAuditoria, string> = {
  CORRETO: 'pill pill--ok',
  ERRADO: 'pill pill--erro',
  CRITICO: 'pill pill--critico',
  'NÃO CONTADO': 'pill pill--neutro',
};

export function PainelAuditoria() {
  const { produtos, estoqueAtual, ciclo, contextoLog } = useEstoque();
  const { permissoes } = useAuth();
  const { mostrar } = useToast();

  const [fonte, setFonte] = useState('ao-vivo');
  const [salvas, setSalvas] = useState<Auditoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [statusFiltro, setStatusFiltro] = useState<StatusAuditoria | 'TODOS'>('TODOS');
  const [exportando, setExportando] = useState(false);
  const [corrigindo, setCorrigindo] = useState<string | null>(null);

  useEffect(() => {
    if (!estoqueAtual) return;
    let vivo = true;
    setCarregando(true);
    listarAuditorias(estoqueAtual.id)
      .then((lista) => {
        if (vivo) setSalvas(lista);
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
  }, [estoqueAtual, mostrar]);

  const auditoria = fonte === 'ao-vivo' ? null : salvas.find((a) => a.id === fonte);
  const aoVivo = auditoria === null || auditoria === undefined;

  // Uma origem só para tela e exportação: antes a tabela mostrava a auditoria salva e a
  // exportação gerava o arquivo com a contagem ao vivo.
  const linhas: LinhaRelatorio[] = useMemo(
    () => (auditoria ? linhasDeSnapshot(auditoria.produtos) : linhasDeProdutos(produtos)),
    [auditoria, produtos],
  );

  const estatisticas = useMemo(
    () => (auditoria ? auditoria.estatisticas : calcularEstatisticas(produtos)),
    [auditoria, produtos],
  );

  const visiveis = useMemo(
    () =>
      (statusFiltro === 'TODOS' ? linhas : linhas.filter((l) => l.status === statusFiltro)).sort(
        (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
      ),
    [linhas, statusFiltro],
  );

  const contexto: ContextoRelatorio = useMemo(
    () => ({
      estoque: estoqueAtual?.nome ?? estoqueAtual?.id ?? 'estoque',
      ciclo: auditoria?.contagemCycle ?? ciclo,
      ...(auditoria ? { quando: auditoria.data } : {}),
    }),
    [estoqueAtual, auditoria, ciclo],
  );

  const exportar = useCallback(
    async (qual: 'contagem' | 'validade' | 'planilha') => {
      if (exportando) return;
      setExportando(true);
      try {
        if (qual === 'contagem') {
          await exportarContagemPDF(linhas, contexto, estatisticas);
        } else if (qual === 'validade') {
          const total = await exportarValidadePDF(linhas, contexto);
          if (total === 0) mostrar('Nenhum produto com validade preenchida.', 'info');
        } else {
          await exportarPlanilha(linhas, contexto.estoque);
        }
        if (contextoLog) void registrar('EXPORTAR_PLANILHA', contextoLog, { tipo: qual, origem: fonte });
      } catch (erro) {
        console.error('[auditoria] Exportação falhou:', erro);
        mostrar('Não foi possível gerar o arquivo.', 'error');
      } finally {
        setExportando(false);
      }
    },
    [exportando, linhas, contexto, estatisticas, mostrar, contextoLog, fonte],
  );

  /** Conferência do admin: confirma ou descarta a divergência de um item. */
  const conferir = useCallback(
    async (produtoId: string, divergenciaConfirmada: boolean) => {
      if (!estoqueAtual || corrigindo) return;
      setCorrigindo(produtoId);
      try {
        await marcarConferido(estoqueAtual.id, produtoId, divergenciaConfirmada);
        mostrar(divergenciaConfirmada ? 'Divergência confirmada.' : 'Item conferido como correto.', 'success');
        if (contextoLog) {
          void registrar('CORRIGIR_ESTOQUE', contextoLog, { produtoId, divergenciaConfirmada, ciclo });
        }
      } catch (erro) {
        console.error('[auditoria] Conferência falhou:', erro);
        mostrar('Não foi possível marcar o item.', 'error');
      } finally {
        setCorrigindo(null);
      }
    },
    [estoqueAtual, corrigindo, mostrar, contextoLog, ciclo],
  );

  const desfazer = useCallback(
    async (produtoId: string) => {
      if (!estoqueAtual || corrigindo) return;
      setCorrigindo(produtoId);
      try {
        await desfazerConferido(estoqueAtual.id, produtoId);
        mostrar('Conferência desfeita. O item voltou para a lista.', 'info');
      } catch (erro) {
        console.error('[auditoria] Desfazer falhou:', erro);
        mostrar('Não foi possível desfazer.', 'error');
      } finally {
        setCorrigindo(null);
      }
    },
    [estoqueAtual, corrigindo, mostrar],
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
    <section className="auditoria">
      <div className="auditoria__controles">
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

        <label className="campo">
          <span className="campo__rotulo">Status</span>
          <select
            className="campo__entrada"
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value as StatusAuditoria | 'TODOS')}
          >
            <option value="TODOS">Todos</option>
            <option value="CORRETO">Corretos</option>
            <option value="ERRADO">Errados</option>
            <option value="CRITICO">Críticos</option>
            <option value="NÃO CONTADO">Não contados</option>
          </select>
        </label>
      </div>

      {!aoVivo && (
        <p className="aviso aviso--compacto">
          Auditoria salva em {auditoria.data.toLocaleString('pt-BR')} — somente leitura.
        </p>
      )}

      <ul className="cartoes">
        <li className="cartao">
          <span>Contados</span>
          <strong>{estatisticas.contados}</strong>
        </li>
        <li className="cartao">
          <span>Não contados</span>
          <strong>{estatisticas.naoContados}</strong>
        </li>
        <li className="cartao cartao--ok">
          <span>Corretos</span>
          <strong>{estatisticas.corretos}</strong>
        </li>
        <li className="cartao cartao--alerta">
          <span>Divergentes</span>
          <strong>{estatisticas.incorretos}</strong>
        </li>
        <li className="cartao">
          <span>% divergência</span>
          <strong>{estatisticas.percentualIncorretos}%</strong>
        </li>
        {estatisticas.corrigidos.total > 0 && (
          <li className="cartao">
            <span>Conferidos</span>
            <strong>{estatisticas.corrigidos.total}</strong>
          </li>
        )}
      </ul>

      <div className="auditoria__acoes">
        <button className="botao botao--neutro" type="button" onClick={() => void exportar('contagem')} disabled={exportando}>
          PDF da contagem
        </button>
        <button className="botao botao--neutro" type="button" onClick={() => void exportar('validade')} disabled={exportando}>
          PDF de validade
        </button>
        <button className="botao botao--neutro" type="button" onClick={() => void exportar('planilha')} disabled={exportando}>
          Planilha
        </button>
      </div>

      <p className="contagem__resumo">
        {visiveis.length} {visiveis.length === 1 ? 'item' : 'itens'}
      </p>

      {visiveis.length === 0 ? (
        <p className="vazio">Nenhum item com este status</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Sistema</th>
                <th className="num">Contado</th>
                <th className="num">Dif.</th>
                <th>Status</th>
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
                            className="botao botao--mini"
                            type="button"
                            onClick={() => void desfazer(l.id)}
                            disabled={corrigindo === l.id}
                          >
                            Desfazer
                          </button>
                        ) : l.status === 'CORRETO' || l.status === 'NÃO CONTADO' ? (
                          <span className="suave">—</span>
                        ) : (
                          <span className="acoes-linha">
                            <button
                              className="botao botao--mini botao--ok"
                              type="button"
                              onClick={() => void conferir(l.id, false)}
                              disabled={corrigindo === l.id}
                              title="A contagem estava certa; a divergência não se confirmou"
                            >
                              OK
                            </button>
                            <button
                              className="botao botao--mini botao--erro"
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
      )}
    </section>
  );
}
