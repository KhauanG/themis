import { useEffect, useMemo, useState } from 'react';
import {
  calcularEstatisticas,
  diferencaDe,
  fisicoDe,
  nomeDe,
  sistemaDe,
  statusDe,
  type Auditoria,
  type StatusAuditoria,
} from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Carregando } from '../../components/Carregando.js';
import { listarAuditorias } from '../../lib/auditorias-repo.js';
import { exportarContagemPDF, exportarValidadePDF } from '../../lib/pdf.js';
import { exportarPlanilha } from '../../lib/planilha.js';

type Fonte = 'ao-vivo' | string;

const CORES: Record<StatusAuditoria, string> = {
  CORRETO: 'pill pill--ok',
  ERRADO: 'pill pill--erro',
  CRITICO: 'pill pill--critico',
  'NÃO CONTADO': 'pill pill--neutro',
};

export function PainelAuditoria() {
  const { produtos, estoqueAtual, ciclo } = useEstoque();
  const { mostrar } = useToast();

  const [fonte, setFonte] = useState<Fonte>('ao-vivo');
  const [salvas, setSalvas] = useState<Auditoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [statusFiltro, setStatusFiltro] = useState<StatusAuditoria | 'TODOS'>('TODOS');
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    if (!estoqueAtual) return;
    setCarregando(true);
    listarAuditorias(estoqueAtual.id)
      .then(setSalvas)
      .catch((erro) => {
        console.warn('[auditoria] Não foi possível listar:', erro);
        mostrar('Não foi possível carregar as auditorias salvas.', 'error');
      })
      .finally(() => setCarregando(false));
  }, [estoqueAtual, mostrar]);

  const auditoriaSelecionada = fonte === 'ao-vivo' ? null : salvas.find((a) => a.id === fonte);

  // A auditoria salva já guarda status e diferença calculados; a visão ao vivo calcula
  // na hora. As duas usam a mesma regra de `@themis/shared`, então batem.
  const linhas = useMemo(() => {
    if (auditoriaSelecionada) {
      return auditoriaSelecionada.produtos.map((p) => ({
        id: p.id,
        nome: p.nome,
        sistema: p.estoqueSistema,
        contado: p.estoqueFisico,
        diferenca: p.diferenca,
        status: p.status,
        validade: p.dataValidade,
      }));
    }
    return produtos.map((p) => ({
      id: p.id,
      nome: nomeDe(p),
      sistema: sistemaDe(p),
      contado: fisicoDe(p),
      diferenca: diferencaDe(p),
      status: statusDe(p),
      validade: p.dataValidade ?? null,
    }));
  }, [auditoriaSelecionada, produtos]);

  const estatisticas = auditoriaSelecionada
    ? auditoriaSelecionada.estatisticas
    : calcularEstatisticas(produtos);

  const visiveis = useMemo(
    () =>
      (statusFiltro === 'TODOS' ? linhas : linhas.filter((l) => l.status === statusFiltro)).sort(
        (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
      ),
    [linhas, statusFiltro],
  );

  const contexto = {
    estoque: estoqueAtual?.nome ?? estoqueAtual?.id ?? 'estoque',
    ciclo: auditoriaSelecionada?.contagemCycle ?? ciclo,
  };

  /** Exportação usa os produtos ao vivo; auditoria salva exporta o snapshot dela. */
  async function exportar(qual: 'contagem' | 'validade' | 'planilha') {
    if (exportando) return;
    setExportando(true);
    try {
      if (qual === 'contagem') {
        await exportarContagemPDF(produtos, contexto, estatisticas);
      } else if (qual === 'validade') {
        const total = await exportarValidadePDF(produtos, contexto);
        if (total === 0) mostrar('Nenhum produto com validade preenchida.', 'info');
      } else {
        await exportarPlanilha(produtos, contexto.estoque);
      }
    } catch (erro) {
      console.error('[auditoria] Exportação falhou:', erro);
      mostrar('Não foi possível gerar o arquivo.', 'error');
    } finally {
      setExportando(false);
    }
  }

  if (carregando) return <Carregando texto="Carregando auditorias..." />;

  return (
    <section className="auditoria">
      <div className="auditoria__controles">
        <label className="campo">
          <span className="campo__rotulo">Contagem</span>
          <select className="campo__entrada" value={fonte} onChange={(e) => setFonte(e.target.value)}>
            <option value="ao-vivo">Ao vivo (ciclo {ciclo})</option>
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

      <ul className="cartoes">
        <li className="cartao">
          <span>Contados</span>
          <strong>{estatisticas.contados}</strong>
        </li>
        <li className="cartao">
          <span>Não contados</span>
          <strong>{estatisticas.naoContados}</strong>
        </li>
        <li className="cartao">
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

      <div className="tabela-rolagem">
        <table className="tabela">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Sistema</th>
              <th>Contado</th>
              <th>Dif.</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={l.id}>
                <td>{l.nome}</td>
                <td className="num">{l.sistema}</td>
                <td className="num">{l.status === 'NÃO CONTADO' ? '—' : l.contado}</td>
                <td className="num">{l.diferenca}</td>
                <td>
                  <span className={CORES[l.status]}>{l.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
