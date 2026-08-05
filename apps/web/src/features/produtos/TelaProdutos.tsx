import { useRef, useState } from 'react';
import { fisicoDe, isItemContado, nomeDe, type Produto } from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Modal } from '../../components/Modal.js';
import { criarProduto, criarProdutosEmLote, limparContagem } from '../../lib/produtos-repo.js';
import { lerPlanilha } from '../../lib/planilha.js';
import { enviarAoErp, hashDaLoja } from '../../lib/erp.js';
import { registrar } from '../../lib/historico.js';

interface Ocupado {
  texto: string;
  feitos?: number;
  total?: number;
}

export function TelaProdutos() {
  const { estoqueAtual, produtos, ciclo, contextoLog, progresso } = useEstoque();
  const { mostrar } = useToast();

  const entradaArquivo = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<Ocupado | null>(null);
  const [confirmarLimpeza, setConfirmarLimpeza] = useState(false);
  const [cadastrando, setCadastrando] = useState(false);
  const [novo, setNovo] = useState({ nome: '', codigoBarras: '', estoqueSistema: '' });

  const bloqueado = ocupado !== null;

  async function importar(arquivo: File) {
    if (!estoqueAtual) return;
    setOcupado({ texto: 'Lendo planilha...' });
    try {
      const { linhas, ignoradas, colunasFaltando } = await lerPlanilha(arquivo);

      if (colunasFaltando.length > 0) {
        mostrar(`A planilha não tem as colunas: ${colunasFaltando.join(', ')}.`, 'error');
        return;
      }
      if (linhas.length === 0) {
        mostrar('Nenhuma linha válida encontrada na planilha.', 'warning');
        return;
      }

      // Sem `productStatus`: "não contado" é a ausência do campo, e a regra só aceita
      // 'ATUALIZADO' ou 'CONFERIDO'. `codigoBarras` vai como string vazia porque a
      // regra exige `is string` e a chave é obrigatória.
      const criados = await criarProdutosEmLote(
        estoqueAtual.id,
        linhas.map((l) => ({
          nome: l.nome,
          NomeProduto: l.nome,
          codigoBarras: l.codigoBarras ?? '',
          quantidade: 0,
          estoqueSistema: l.estoqueSistema,
          temCodigoBarras: l.temCodigoBarras,
          ...(l.IdProduto ? { IdProduto: l.IdProduto } : {}),
        })),
        (feitos, total) => setOcupado({ texto: 'Importando', feitos, total }),
      );

      mostrar(
        `${criados} ${criados === 1 ? 'produto importado' : 'produtos importados'}${ignoradas > 0 ? `, ${ignoradas} linha(s) ignorada(s)` : ''}.`,
        'success',
      );
      if (contextoLog) void registrar('IMPORTAR_PLANILHA', contextoLog, { criados, ignoradas });
    } catch (erro) {
      console.error('[produtos] Importação falhou:', erro);
      mostrar('Não foi possível importar a planilha.', 'error');
    } finally {
      setOcupado(null);
      if (entradaArquivo.current) entradaArquivo.current.value = '';
    }
  }

  async function cadastrar() {
    if (!estoqueAtual || !novo.nome.trim()) return;
    setOcupado({ texto: 'Cadastrando...' });
    try {
      const codigo = novo.codigoBarras.trim();
      await criarProduto(estoqueAtual.id, {
        nome: novo.nome.trim(),
        NomeProduto: novo.nome.trim(),
        codigoBarras: codigo,
        quantidade: 0,
        estoqueSistema: Number(novo.estoqueSistema) || 0,
        temCodigoBarras: Boolean(codigo),
      });
      mostrar('Produto cadastrado.', 'success');
      setNovo({ nome: '', codigoBarras: '', estoqueSistema: '' });
      setCadastrando(false);
    } catch (erro) {
      console.error('[produtos] Cadastro falhou:', erro);
      mostrar('Não foi possível cadastrar.', 'error');
    } finally {
      setOcupado(null);
    }
  }

  async function limpar() {
    if (!estoqueAtual) return;
    setConfirmarLimpeza(false);
    setOcupado({ texto: 'Limpando contagem...' });
    try {
      await limparContagem(estoqueAtual.id, produtos);
      mostrar('Contagem limpa.', 'success');
      if (contextoLog) void registrar('LIMPAR_CONTAGEM', contextoLog, { ciclo, total: produtos.length });
    } catch (erro) {
      console.error('[produtos] Limpeza falhou:', erro);
      mostrar('Não foi possível limpar a contagem.', 'error');
    } finally {
      setOcupado(null);
    }
  }

  /** Envia ao ERP só o que foi contado. Item sem contagem não tem o que corrigir. */
  async function enviarContagemAoErp() {
    if (!estoqueAtual) return;
    const contados = produtos.filter((p: Produto) => isItemContado(p) && p.IdProduto);

    if (contados.length === 0) {
      mostrar('Nenhum item contado para enviar.', 'info');
      return;
    }

    setOcupado({ texto: 'Consultando configuração da loja...' });
    const hash = await hashDaLoja(estoqueAtual.id);
    if (!hash) {
      mostrar('Nenhum HashLoja configurado para este estoque.', 'error');
      setOcupado(null);
      return;
    }

    let enviados = 0;
    const falhas: string[] = [];

    for (const [indice, p] of contados.entries()) {
      setOcupado({ texto: 'Enviando ao ERP', feitos: indice + 1, total: contados.length });
      const resultado = await enviarAoErp({
        IdProduto: String(p.IdProduto),
        HashLoja: hash,
        Quantidade: fisicoDe(p),
        CodigoBarras: String(p.codigoBarras ?? p.CodigoBarras ?? ''),
      });
      if (resultado.ok) enviados++;
      else falhas.push(nomeDe(p));
    }

    setOcupado(null);
    mostrar(
      falhas.length === 0
        ? `${enviados} ${enviados === 1 ? 'item enviado' : 'itens enviados'} ao ERP.`
        : `${enviados} enviados, ${falhas.length} com falha. Tente de novo os que faltaram.`,
      falhas.length === 0 ? 'success' : 'warning',
    );
    if (contextoLog) void registrar('CORRIGIR_ESTOQUE', contextoLog, { enviados, falhas: falhas.length });
  }

  return (
    <section className="produtos">
      <h2 className="secao__titulo">Gerenciar estoque</h2>
      <p className="secao__sub">
        {estoqueAtual?.nome ?? '—'} · {produtos.length}{' '}
        {produtos.length === 1 ? 'produto' : 'produtos'} · {progresso.contados} contados no ciclo{' '}
        {ciclo}
      </p>

      {ocupado && (
        <div className="aviso" role="status" aria-live="polite">
          <p className="aviso__texto">
            {ocupado.texto}
            {ocupado.total ? ` ${ocupado.feitos} de ${ocupado.total}...` : ''}
          </p>
          {ocupado.total ? (
            <div className="progresso__trilha">
              <div
                className="progresso__barra"
                style={{ width: `${Math.round(((ocupado.feitos ?? 0) / ocupado.total) * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      )}

      <div className="acoes-lista">
        <button className="botao botao--primario" type="button" onClick={() => setCadastrando(true)} disabled={bloqueado}>
          Cadastrar produto
        </button>

        <button
          className="botao botao--neutro"
          type="button"
          onClick={() => entradaArquivo.current?.click()}
          disabled={bloqueado}
        >
          Importar planilha
        </button>
        <input
          ref={entradaArquivo}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) void importar(arquivo);
          }}
        />

        <button className="botao botao--neutro" type="button" onClick={() => void enviarContagemAoErp()} disabled={bloqueado}>
          Enviar contagem ao ERP
        </button>

        <button
          className="botao botao--perigo"
          type="button"
          onClick={() => setConfirmarLimpeza(true)}
          disabled={bloqueado}
        >
          Limpar contagem
        </button>
      </div>

      <Modal
        aberto={cadastrando}
        titulo="Cadastrar produto"
        onFechar={() => setCadastrando(false)}
        rodape={
          <>
            <button className="botao botao--neutro" type="button" onClick={() => setCadastrando(false)}>
              Cancelar
            </button>
            <button
              className="botao botao--primario"
              type="button"
              onClick={() => void cadastrar()}
              disabled={!novo.nome.trim() || bloqueado}
            >
              Cadastrar
            </button>
          </>
        }
      >
        <label className="campo">
          <span className="campo__rotulo">Nome</span>
          <input
            className="campo__entrada"
            value={novo.nome}
            onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
            autoFocus
          />
        </label>
        <label className="campo">
          <span className="campo__rotulo">Código de barras</span>
          <input
            className="campo__entrada"
            inputMode="numeric"
            value={novo.codigoBarras}
            onChange={(e) => setNovo({ ...novo, codigoBarras: e.target.value })}
          />
        </label>
        <label className="campo">
          <span className="campo__rotulo">Estoque do sistema</span>
          <input
            className="campo__entrada"
            type="number"
            value={novo.estoqueSistema}
            onChange={(e) => setNovo({ ...novo, estoqueSistema: e.target.value })}
          />
        </label>
      </Modal>

      <Modal
        aberto={confirmarLimpeza}
        titulo="Limpar contagem"
        onFechar={() => setConfirmarLimpeza(false)}
        rodape={
          <>
            <button className="botao botao--neutro" type="button" onClick={() => setConfirmarLimpeza(false)}>
              Cancelar
            </button>
            <button className="botao botao--perigo" type="button" onClick={() => void limpar()}>
              Limpar
            </button>
          </>
        }
      >
        <p>
          Apaga a quantidade contada, o status e a <strong>data de validade</strong> de todos os{' '}
          {produtos.length} produtos deste estoque. O estoque do sistema não é alterado.
        </p>
        <p className="aviso">Não dá para desfazer. Salve a auditoria antes se precisar do histórico.</p>
      </Modal>
    </section>
  );
}
