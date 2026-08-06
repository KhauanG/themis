import { useRef, useState } from 'react';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Icone } from '../../components/Icone.js';
import { Modal } from '../../components/Modal.js';
import {
  atualizarEstoqueSistema,
  criarProduto,
  criarProdutosEmLote,
  limparContagem,
} from '../../lib/produtos-repo.js';
import { buscarEstoqueDoErp, hashDaLoja } from '../../lib/erp.js';
import { lerPlanilha } from '../../lib/planilha.js';
import { registrar } from '../../lib/historico.js';
import { ModalCorrigirEstoque } from './ModalCorrigirEstoque.js';

interface Ocupado {
  texto: string;
  feitos?: number;
  total?: number;
}

export function TelaProdutos() {
  const { estoqueAtual, produtos, ciclo, contextoLog, progresso, configuracoes, somenteLeitura } =
    useEstoque();
  const { mostrar } = useToast();

  const entradaArquivo = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<Ocupado | null>(null);
  const [confirmarLimpeza, setConfirmarLimpeza] = useState(false);
  const [corrigindo, setCorrigindo] = useState(false);
  const [cadastrando, setCadastrando] = useState(false);
  const [novo, setNovo] = useState({ nome: '', codigoBarras: '', estoqueSistema: '' });

  const bloqueado = ocupado !== null;

  async function importar(arquivo: File) {
    if (!estoqueAtual) return;
    setOcupado({ texto: 'Lendo planilha' });
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
    setOcupado({ texto: 'Cadastrando' });
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
      if (contextoLog) {
        void registrar('CRIAR_PRODUTO', contextoLog, {
          produto: novo.nome.trim(),
          codigoBarras: codigo,
          estoqueSistema: Number(novo.estoqueSistema) || 0,
          origem: 'Cadastro avulso',
        });
      }
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
    setOcupado({ texto: 'Limpando contagem' });
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

  /**
   * Buscar estoque — lê o saldo do ERP e grava em `estoqueSistema`, sem corrigir nada.
   *
   * É a primeira fase do Corrigir estoque, isolada. Serve para conferir a divergência
   * antes de decidir corrigir, e para atualizar o saldo depois de movimentação no ERP.
   */
  async function buscarEstoque() {
    if (!estoqueAtual) return;
    setOcupado({ texto: 'Consultando a configuração da loja' });
    try {
      const hash = await hashDaLoja(estoqueAtual.id);
      if (!hash) {
        mostrar('Nenhum HashLoja configurado. Configure em Estoques.', 'error');
        return;
      }

      setOcupado({ texto: 'Buscando o estoque no ERP' });
      const leitura = await buscarEstoqueDoErp(hash);
      if (!leitura.ok) {
        mostrar(leitura.erro ?? 'Não foi possível ler o estoque do ERP.', 'error');
        return;
      }

      setOcupado({ texto: 'Gravando os saldos' });
      const r = await atualizarEstoqueSistema(estoqueAtual.id, produtos, leitura.estoque);

      mostrar(
        r.atualizados === 0
          ? 'Tudo já estava igual ao ERP.'
          : `${r.atualizados} ${r.atualizados === 1 ? 'saldo atualizado' : 'saldos atualizados'}.${
              r.semCorrespondencia > 0 ? ` ${r.semCorrespondencia} sem correspondência no ERP.` : ''
            }`,
        'success',
      );

      if (contextoLog) {
        void registrar('BUSCAR_ESTOQUE', contextoLog, {
          // `itens`, não `estoque.size`: o mapa indexa cada produto por várias grafias.
          recebidosDoErp: leitura.itens,
          atualizados: r.atualizados,
          semCorrespondencia: r.semCorrespondencia,
        });
      }
    } catch (erro) {
      console.error('[produtos] Buscar estoque falhou:', erro);
      mostrar('Não foi possível buscar o estoque.', 'error');
    } finally {
      setOcupado(null);
    }
  }

  const pct = ocupado?.total ? Math.round(((ocupado.feitos ?? 0) / ocupado.total) * 100) : null;

  return (
    <section className="pilha-g">
      <div>
        <h1 className="titulo-tela">Produtos e estoque</h1>
        <p className="subtitulo">
          {estoqueAtual?.nome ?? '—'} · {produtos.length}{' '}
          {produtos.length === 1 ? 'produto' : 'produtos'} · {progresso.contados} contados no ciclo{' '}
          {ciclo}
        </p>
      </div>

      {ocupado && (
        <div className="cartao">
          <div className="cartao__corpo pilha">
            <p className="subtitulo">
              {ocupado.texto}
              {ocupado.total ? ` · ${ocupado.feitos} de ${ocupado.total}` : '…'}
            </p>
            {pct !== null && (
              <div className="progresso__trilha">
                <div className="progresso__barra" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {configuracoes.modoContagem && (
        <p className="aviso">
          Modo contagem ligado. Importar planilha e limpar contagem ficam bloqueados até
          alguém desligar em Estoques — é o que impede apagar a contagem no meio da operação.
        </p>
      )}

      {somenteLeitura && (
        <p className="aviso">
          Este estoque está em modo somente leitura. Ninguém consegue contar nele.
        </p>
      )}

      <div hidden={configuracoes.modoContagem}>
        <p className="rotulo-secao" style={{ marginBottom: 'var(--e2)' }}>
          Cadastro
        </p>
        <div className="acoes-lista">
          <button className="acao" type="button" onClick={() => setCadastrando(true)} disabled={bloqueado}>
            <span className="acao__icone">
              <Icone nome="produtos" />
            </span>
            <span className="acao__texto">
              <span className="acao__titulo">Cadastrar produto</span>
              <span className="acao__descricao">Adicionar um item avulso ao estoque</span>
            </span>
          </button>

          <button
            className="acao"
            type="button"
            onClick={() => entradaArquivo.current?.click()}
            disabled={bloqueado}
          >
            <span className="acao__icone">
              <Icone nome="baixar" />
            </span>
            <span className="acao__texto">
              <span className="acao__titulo">Importar planilha</span>
              <span className="acao__descricao">Arquivo .xlsx com nome e estoque do sistema</span>
            </span>
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
        </div>
      </div>

      <div>
        <p className="rotulo-secao" style={{ marginBottom: 'var(--e2)' }}>
          Integração
        </p>
        <div className="acoes-lista">
          <button className="acao" type="button" onClick={() => void buscarEstoque()} disabled={bloqueado}>
            <span className="acao__icone">
              <Icone nome="baixar" />
            </span>
            <span className="acao__texto">
              <span className="acao__titulo">Buscar estoque</span>
              <span className="acao__descricao">
                Só atualiza o saldo do sistema com o do ERP. Não envia nada
              </span>
            </span>
          </button>

          <button className="acao" type="button" onClick={() => setCorrigindo(true)} disabled={bloqueado}>
            <span className="acao__icone">
              <Icone nome="trocar" />
            </span>
            <span className="acao__texto">
              <span className="acao__titulo">Corrigir estoque</span>
              <span className="acao__descricao">
                Lê o ERP, envia as divergências, confere se aplicou e fecha a conferência
              </span>
            </span>
          </button>
        </div>
      </div>

      <div hidden={configuracoes.modoContagem}>
        <p className="rotulo-secao" style={{ marginBottom: 'var(--e2)' }}>
          Zona de risco
        </p>
        <div className="acoes-lista">
          <button
            className="acao acao--perigo"
            type="button"
            onClick={() => setConfirmarLimpeza(true)}
            disabled={bloqueado}
          >
            <span className="acao__icone">
              <Icone nome="aviso" />
            </span>
            <span className="acao__texto">
              <span className="acao__titulo">Limpar contagem</span>
              <span className="acao__descricao">Zera quantidade, status e validade de todos</span>
            </span>
          </button>
        </div>
      </div>

      <Modal
        aberto={cadastrando}
        titulo="Cadastrar produto"
        onFechar={() => setCadastrando(false)}
        rodape={
          <>
            <button className="botao botao--secundario" type="button" onClick={() => setCadastrando(false)}>
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
        <div className="pilha">
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
            <span className="campo__ajuda">Opcional</span>
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
        </div>
      </Modal>

      <ModalCorrigirEstoque aberto={corrigindo} onFechar={() => setCorrigindo(false)} />

      <Modal
        aberto={confirmarLimpeza}
        titulo="Limpar contagem"
        onFechar={() => setConfirmarLimpeza(false)}
        rodape={
          <>
            <button className="botao botao--secundario" type="button" onClick={() => setConfirmarLimpeza(false)}>
              Cancelar
            </button>
            <button className="botao botao--perigo" type="button" onClick={() => void limpar()}>
              Limpar
            </button>
          </>
        }
      >
        <div className="pilha">
          <p>
            Apaga a quantidade contada, o status e a <strong>data de validade</strong> de todos os{' '}
            {produtos.length} produtos deste estoque. O estoque do sistema não é alterado.
          </p>
          <p className="aviso aviso--perigo">
            Não dá para desfazer. Salve a auditoria antes se precisar do histórico.
          </p>
        </div>
      </Modal>
    </section>
  );
}
