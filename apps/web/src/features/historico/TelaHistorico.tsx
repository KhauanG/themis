import { useEffect, useState } from 'react';
import type { AcaoHistorico } from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Carregando } from '../../components/Carregando.js';
import {
  COR_ACAO,
  ROTULO_ACAO,
  consultarHistorico,
  type EntradaHistoricoLida,
} from '../../lib/historico.js';

/** Renderiza os detalhes de forma legível. Cada ação grava um formato diferente. */
function descrever(entrada: EntradaHistoricoLida): string {
  const d = entrada.details ?? {};

  if (entrada.action === 'MODIFICAR_PRODUTO') {
    const partes: string[] = [];
    if (d['produto']) partes.push(String(d['produto']));
    if (d['de'] !== undefined || d['para'] !== undefined) {
      partes.push(`${d['de'] ?? '—'} → ${d['para'] ?? '—'}`);
    }
    if (d['validadeDe'] !== undefined || d['validadePara'] !== undefined) {
      partes.push(`validade ${d['validadeDe'] ?? '(sem)'} → ${d['validadePara'] ?? '(sem)'}`);
    }
    return partes.join(' · ');
  }

  const pares = Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`);
  return pares.join(' · ');
}

export function TelaHistorico() {
  const { estoqueAtual } = useEstoque();
  const { mostrar } = useToast();

  const [entradas, setEntradas] = useState<EntradaHistoricoLida[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [acao, setAcao] = useState<AcaoHistorico | 'TODAS'>('TODAS');

  useEffect(() => {
    if (!estoqueAtual) return;
    setCarregando(true);
    consultarHistorico({
      inventoryId: estoqueAtual.id,
      ...(acao === 'TODAS' ? {} : { acao }),
      maximo: 200,
    })
      .then(setEntradas)
      .catch((erro) => {
        console.warn('[histórico] Consulta falhou:', erro);
        // Consulta com filtro composto exige índice no Firestore. A mensagem diz o que fazer.
        mostrar('Não foi possível carregar o histórico. Pode faltar índice no Firestore.', 'error');
      })
      .finally(() => setCarregando(false));
  }, [estoqueAtual, acao, mostrar]);

  return (
    <section className="historico">
      <label className="campo">
        <span className="campo__rotulo">Ação</span>
        <select
          className="campo__entrada"
          value={acao}
          onChange={(e) => setAcao(e.target.value as AcaoHistorico | 'TODAS')}
        >
          <option value="TODAS">Todas</option>
          {(Object.keys(ROTULO_ACAO) as AcaoHistorico[]).map((a) => (
            <option key={a} value={a}>
              {ROTULO_ACAO[a]}
            </option>
          ))}
        </select>
      </label>

      {carregando ? (
        <Carregando texto="Carregando histórico..." />
      ) : entradas.length === 0 ? (
        <p className="vazio">Nenhum registro para este filtro</p>
      ) : (
        <ul className="linha-tempo">
          {entradas.map((e) => (
            <li key={e.id} className="evento">
              <span className="evento__tag" style={{ backgroundColor: COR_ACAO[e.action] }}>
                {ROTULO_ACAO[e.action]}
              </span>
              <div className="evento__corpo">
                <p className="evento__quem">
                  {e.userName || e.userEmail}
                  <span className="evento__quando">{e.quando.toLocaleString('pt-BR')}</span>
                </p>
                {descrever(e) && <p className="evento__detalhe">{descrever(e)}</p>}
                {e.deviceLabel && <p className="evento__aparelho">{e.deviceLabel}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
