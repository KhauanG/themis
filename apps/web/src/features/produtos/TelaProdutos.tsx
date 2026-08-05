import { useRef, useState } from 'react';
import { fisicoDe, isItemContado, nomeDe, type Produto } from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Modal } from '../../components/Modal.js';
import { criarProduto, limparContagem } from '../../lib/produtos-repo.js';
import { lerPlanilha } from '../../lib/planilha.js';
import { enviarAoErp, hashDaLoja } from '../../lib/erp.js';
import { registrar } from '../../lib/historico.js';

export function TelaProdutos() {
  const { estoqueAtual, produtos, ciclo } = useEstoque();
  const { usuario, nome } = useAuth();
  const { mostrar } = useToast();

  const entradaArquivo = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState('');
  const [confirmarLimpeza, setConfirmarLimpeza] = useState(false);
  const [cadastrando, setCadastrando] = useState(false);
  const [novo, setNovo] = useState({ nome: '', codigoBarras: '', estoqueSistema: '' });

  const contexto = estoqueAtual && usuario
    ? {
        userId: usuario.uid,
        userEmail: usuario.email ?? '',
        userName: nome,
        inventoryId: estoqueAtual.id,
        inventoryName: estoqueAtual.nome ?? estoqueAtual.id,
      }
    : null;

  async function importar(arquivo: File) {
    if (!estoqueAtual) return;
    setOcupado('Lendo planilha...');
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

      // Uma criação por vez, com o teto de tempo de cada escrita. Um batch de 2000
      // linhas estouraria o limite de 500 operações do Firestore.
      let criados = 0;
      for (const [indice, linha] of linhas.entries()) {
        setOcupado(`Importando ${indice + 1} de ${linhas.length}...`);
        // Sem `productStatus`: "não contado" é a ausência do campo, e a regra só aceita
        // 'ATUALIZADO' ou 'CONFERIDO'. `codigoBarras` vai como string vazia porque a
        // regra exige `is string` e a chave é obrigatória.
        await criarProduto(estoqueAtual.id, {
          nome: linha.nome,
          NomeProduto: linha.nome,
          codigoBarras: linha.codigoBarras ?? '',
          quantidade: 0,
          estoqueSistema: linha.estoqueSistema,
          temCodigoBarras: linha.temCodigoBarras,
          ...(linha.IdProduto ? { IdProduto: linha.IdProduto } : {}),
        });
        criados++;
      }

      mostrar(
        `${criados} ${criados === 1 ? 'produto importado' : 'produtos importados'}${ignoradas > 0 ? `, ${ignoradas} linha(s) ignorada(s)` : ''}.`,
        'success',
      );
      if (contexto) void registrar('IMPORTAR_PLANILHA', contexto, { criados, ignoradas });
    } catch (erro) {
      console.error('[produtos] Importação falhou:', erro);
      mostrar('Não foi possível importar a planilha.', 'error');
    } finally {
      setOcupado('');
      if (entradaArquivo.current) entradaArquivo.current.value = '';
    }
  }

  async function cadastrar() {
    if (!estoqueAtual || !novo.nome.trim()) return;
    setOcupado('Cadastrando...');
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
      setOcupado('');
    }
  }

  async function limpar() {
    if (!estoqueAtual) return;
    setConfirmarLimpeza(false);
    setOcupado('Limpando contagem...');
    try {
      await limparContagem(estoqueAtual.id, produtos);
      mostrar('Contagem limpa.', 'success');
      if (contexto) void registrar('LIMPAR_CONTAGEM', contexto, { ciclo, total: produtos.length });
    } catch (erro) {
      console.error('[produtos] Limpeza falhou:', erro);
      mostrar('Não foi possível limpar a contagem.', 'error');
    } finally {
      setOcupado('');
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

    setOcupado('Consultando configuração da loja...');
    const hash = await hashDaLoja(estoqueAtual.id);
    if (!hash) {
      mostrar('Nenhum HashLoja configurado para este estoque.', 'error');
      setOcupado('');
      return;
    }

    let enviados = 0;
    const falhas: string[] = [];

    for (const [indice, p] of contados.entries()) {
      setOcupado(`Enviando ${indice + 1} de ${contados.length}...`);
      const resultado = await enviarAoErp({
        IdProduto: String(p.IdProduto),
        HashLoja: hash,
        Quantidade: fisicoDe(p),
        CodigoBarras: String(p.codigoBarras ?? p.CodigoBarras ?? ''),
      });
      if (resultado.ok) enviados++;
      else falhas.push(nomeDe(p));
    }

    setOcupado('');
    mostrar(
      falhas.length === 0
        ? `${enviados} ${enviados === 1 ? 'item enviado' : 'itens enviados'} ao ERP.`
        : `${enviados} enviados, ${falhas.length} com falha. Tente de novo os que faltaram.`,
      falhas.length === 0 ? 'success' : 'warning',
    );
    if (contexto) void registrar('CORRIGIR_ESTOQUE', contexto, { enviados, falhas: falhas.length });
  }

  return (
    <section className="produtos">
      <h2 className="secao__titulo">Gerenciar estoque</h2>
      <p className="secao__sub">
        {produtos.length} {produtos.length === 1 ? 'produto' : 'produtos'} em{' '}
        {estoqueAtual?.nome ?? '—'}
      </p>

      {ocupado && (
        <p className="aviso" role="status">
          {ocupado}
        </p>
      )}

      <div className="acoes-lista">
        <button className="botao botao--primario" type="button" onClick={() => setCadastrando(true)} disabled={Boolean(ocupado)}>
          Cadastrar produto
        </button>

        <button
          className="botao botao--neutro"
          type="button"
          onClick={() => entradaArquivo.current?.click()}
          disabled={Boolean(ocupado)}
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

        <button className="botao botao--neutro" type="button" onClick={() => void enviarContagemAoErp()} disabled={Boolean(ocupado)}>
          Enviar contagem ao ERP
        </button>

        <button
          className="botao botao--perigo"
          type="button"
          onClick={() => setConfirmarLimpeza(true)}
          disabled={Boolean(ocupado)}
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
              disabled={!novo.nome.trim() || Boolean(ocupado)}
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
