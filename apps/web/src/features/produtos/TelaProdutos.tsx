import { useRef, useState } from 'react';
import {
  TEXTO_FALHA,
  avisoDeDuplicados,
  descreverColunas,
  detalhesDaImportacao,
  deveRegistrarImportacao,
  gestaoDeCadastroBloqueada,
  linhasComNome,
  mensagemDaImportacao,
  planejarImportacao,
  resumoDoPlano,
  rotuloDaRodada,
  travaAntesDeGravar,
  validarCadastroProduto,
  type PlanoImportacao,
  type ProdutoDoBanco,
} from '@themis/shared';
import { useEstoque } from '../../contexts/EstoqueContext.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { useToast } from '../../contexts/ToastContext.js';
import { Icone } from '../../components/Icone.js';
import { Modal } from '../../components/Modal.js';
import { Esqueleto } from '../../components/Esqueleto.js';
import {
  atualizarEstoqueSistema,
  cadastrarProduto,
  excluirTodosProdutos,
  limparContagem,
  novoIdDeProduto,
} from '../../lib/produtos-repo.js';
import { encerrarLote } from '../../lib/estoques-repo.js';
import { buscarEstoqueDoErp } from '../../lib/erp.js';
import { gravarImportacao, lerProdutosDoServidor } from '../../lib/importacao-repo.js';
import { ErroDePlanilha, lerPlanilha, type LeituraPlanilha } from '../../lib/planilha.js';
import { registrar } from '../../lib/historico.js';
import { isWriteTimeout } from '../../lib/firestore-write.js';
import { mensagemDeFalha } from '../../lib/gestao-escrita.js';
import { ListaProdutos } from './ListaProdutos.js';
import { ModalCorrigirEstoque } from './ModalCorrigirEstoque.js';
import { ModalEditarProduto } from './ModalEditarProduto.js';

/**
 * Mensagem de teto de tempo em operação de lote.
 *
 * Estouro **não** é falha: o lote está no cache local e sobe ao reconectar. Só que este
 * aparelho já mostra o resultado (o listener lê do cache) e os outros não. Dizer "não
 * salvou" faria o usuário repetir; dizer "concluído" faria confiar no que a equipe não vê.
 */
const AVISO_NAO_CONFIRMADO =
  'Gravado neste aparelho, mas o servidor não confirmou. Os outros celulares só vão ver ' +
  'quando a conexão voltar — não repita a operação.';

/** Limpar a contagem é repetível: reaplicar zera de novo o que já está zerado, sem perder nada. */
const AVISO_LIMPEZA_NAO_TERMINOU = 'A limpeza não terminou. Pode repetir: nada se perde.';

/** Palavra da confirmação. Evita apagar 1600 produtos com um toque errado. */
const PALAVRA_APAGAR = 'APAGAR';

const RECUSA_CADASTRO = 'Sem permissão. Só admin ou master com acesso a este estoque edita o cadastro.';

interface Ocupado {
  texto: string;
  feitos?: number;
  total?: number;
}

export function TelaProdutos() {
  const {
    estoqueAtual,
    produtos,
    carregandoProdutos,
    conciliando,
    ciclo,
    contextoLog,
    progresso,
    configuracoes,
  } = useEstoque();
  const { mostrar } = useToast();
  const { permissoes } = useAuth();

  const entradaArquivo = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<Ocupado | null>(null);
  const [confirmarLimpeza, setConfirmarLimpeza] = useState(false);
  const [apagandoTudo, setApagandoTudo] = useState(false);
  const [textoApagar, setTextoApagar] = useState('');
  const [corrigindo, setCorrigindo] = useState(false);
  const [cadastrando, setCadastrando] = useState(false);
  // O id nasce quando o formulário abre: reenviar depois de um "Sem confirmação" não duplica o produto.
  const [novo, setNovo] = useState({ id: '', nome: '', codigoBarras: '', idErp: '' });
  const [editando, setEditando] = useState<string | null>(null);
  // `inventoryId`: o estoque em que a prévia foi montada. `plano` é só o que a prévia mostra.
  const [previa, setPrevia] = useState<{
    inventoryId: string;
    arquivo: string;
    leitura: LeituraPlanilha;
    plano: PlanoImportacao;
  } | null>(null);
  const [verTodasRecusadas, setVerTodasRecusadas] = useState(false);

  const bloqueado = ocupado !== null;
  const cadastroBloqueado = gestaoDeCadastroBloqueada(configuracoes);

  async function importar(arquivo: File) {
    if (!estoqueAtual) return;
    if (!navigator.onLine) {
      mostrar('Sem internet. A importação precisa de conexão.', 'error');
      if (entradaArquivo.current) entradaArquivo.current.value = '';
      return;
    }
    setOcupado({ texto: 'Lendo planilha' });
    try {
      const leitura = await lerPlanilha(arquivo);
      if (leitura.colunasFaltando.length > 0) {
        mostrar(`A planilha não tem as colunas: ${leitura.colunasFaltando.join(', ')}.`, 'error');
        return;
      }

      // Do servidor, nunca do cache: planejar em cima de lista velha recriaria produto.
      let existentes: ProdutoDoBanco[];
      try {
        existentes = await lerProdutosDoServidor(estoqueAtual.id);
      } catch (erro) {
        console.error('[produtos] Leitura do servidor falhou:', erro);
        mostrar('Não foi possível ler os produtos do servidor. Nada foi importado.', 'error');
        return;
      }

      const plano = planejarImportacao(existentes, leitura.linhas);
      if (linhasComNome(plano) === 0) {
        mostrar('Nenhuma linha válida encontrada na planilha.', 'warning');
        return;
      }
      setVerTodasRecusadas(false);
      setPrevia({ inventoryId: estoqueAtual.id, arquivo: arquivo.name, leitura, plano });
    } catch (erro) {
      console.error('[produtos] Leitura da planilha falhou:', erro);
      mostrar(erro instanceof ErroDePlanilha ? erro.message : 'Não foi possível importar a planilha.', 'error');
    } finally {
      setOcupado(null);
      if (entradaArquivo.current) entradaArquivo.current.value = '';
    }
  }

  // O estoque vem de quem chama: a prévia (Task 8) guarda o estoque em que foi montada.
  async function gravarPlano(inventoryId: string, arquivo: string, plano: PlanoImportacao) {
    setOcupado({ texto: 'Importando' });
    try {
      const resultado = await gravarImportacao(inventoryId, plano, (feitos, total) =>
        setOcupado({ texto: 'Importando', feitos, total }),
      );
      const { texto, tipo } = mensagemDaImportacao(plano, resultado);
      mostrar(texto, tipo);
      // Só o que o servidor aceitou, ou o lote que ficou na fila (teto). Recusa com zero
      // gravado não vira "Importou planilha" no histórico (desenho 5.2).
      if (contextoLog && deveRegistrarImportacao(resultado)) {
        void registrar('IMPORTAR_PLANILHA', contextoLog, detalhesDaImportacao(arquivo, plano, resultado));
      }
    } finally {
      setOcupado(null);
    }
  }

  async function confirmarImportacao() {
    if (!previa) return;
    if (!navigator.onLine) {
      mostrar('Sem internet. A importação precisa de conexão.', 'error');
      return;
    }
    const { inventoryId, arquivo, leitura } = previa;
    setPrevia(null);
    // O estoque aberto mudou com a prévia na tela: não grava os produtos de um no outro.
    if (inventoryId !== estoqueAtual?.id) {
      mostrar('Não foi possível importar a planilha.', 'error');
      return;
    }
    // Relê e refaz o plano. O da prévia pode ter minutos: uma contagem feita nesse meio
    // num produto legado sem `quantidade` seria regravada pelo `estoqueFisico` velho.
    setOcupado({ texto: 'Importando' });
    let plano: PlanoImportacao;
    try {
      plano = planejarImportacao(await lerProdutosDoServidor(inventoryId), leitura.linhas);
    } catch (erro) {
      console.error('[produtos] Leitura do servidor falhou:', erro);
      mostrar('Não foi possível ler os produtos do servidor. Nada foi importado.', 'error');
      setOcupado(null);
      return;
    }
    await gravarPlano(inventoryId, arquivo, plano);
  }

  async function cadastrar() {
    if (!estoqueAtual) return;
    // O próprio id fica fora: reenvio depois de um "Sem confirmação" que gravou não é duplicado.
    const v = validarCadastroProduto(novo, null, produtos.filter((p) => p.id !== novo.id));
    if (!v.ok) {
      mostrar(v.mensagem, 'error');
      return;
    }
    setOcupado({ texto: 'Cadastrando' });
    try {
      const r = await cadastrarProduto(estoqueAtual.id, novo.id, v.campos);
      if (r === 'CONFLITO') {
        // O id é de outro produto: o formulário segue aberto, agora com um id novo.
        mostrar(TEXTO_FALHA, 'error');
        setNovo({ ...novo, id: novoIdDeProduto(estoqueAtual.id) });
        return;
      }
      // Só depois do aceite do servidor.
      if (contextoLog) {
        void registrar('CRIAR_PRODUTO', contextoLog, {
          produto: v.campos.nome,
          productId: novo.id,
          codigoBarras: v.campos.codigoBarras,
          idErp: v.campos.idErp,
          origem: 'Cadastro avulso',
        });
      }
      mostrar('Produto cadastrado.', 'success');
      setCadastrando(false);
    } catch (erro) {
      console.error('[produtos] Cadastro falhou:', erro);
      mostrar(mensagemDeFalha(erro, { recusa: RECUSA_CADASTRO }), 'error');
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
      /*
        Encerra o lote junto, e é o ponto do fluxo novo: limpar a contagem reinicia a
        rodada, então o próximo toque num item volta a perguntar qual lote está sendo
        contado. Sem isto a contagem nova entraria com o rótulo da anterior.
      */
      await encerrarLote(estoqueAtual.id);
      mostrar('Contagem limpa e lote encerrado. O próximo item vai pedir o lote novo.', 'success');
      if (contextoLog) void registrar('LIMPAR_CONTAGEM', contextoLog, { ciclo, total: produtos.length });
    } catch (erro) {
      console.error('[produtos] Limpeza falhou:', erro);
      mostrar(
        isWriteTimeout(erro) ? AVISO_LIMPEZA_NAO_TERMINOU : 'Não foi possível limpar a contagem.',
        isWriteTimeout(erro) ? 'warning' : 'error',
      );
    } finally {
      setOcupado(null);
    }
  }

  /**
   * Apaga o catálogo inteiro deste estoque.
   *
   * Existe para recomeçar do zero antes de reimportar, quando o catálogo saiu de sincronia
   * a ponto de não valer reconciliar. Exige digitar a palavra porque é irreversível e o
   * alvo é o estoque inteiro — um toque errado num botão de "limpar" apaga 1600 produtos e
   * a contagem em andamento junto.
   */
  async function apagarTudo() {
    if (!estoqueAtual || textoApagar.trim().toUpperCase() !== PALAVRA_APAGAR) return;

    const total = produtos.length;
    setApagandoTudo(false);
    setTextoApagar('');
    setOcupado({ texto: 'Apagando produtos', feitos: 0, total });

    try {
      const apagados = await excluirTodosProdutos(estoqueAtual.id, (feitos) =>
        setOcupado({ texto: 'Apagando produtos', feitos, total }),
      );

      mostrar(
        apagados === 0
          ? 'O estoque já estava vazio.'
          : `${apagados} ${apagados === 1 ? 'produto apagado' : 'produtos apagados'}. Pode importar a planilha.`,
        'success',
      );
      if (contextoLog) void registrar('LIMPAR_ESTOQUE', contextoLog, { apagados });
    } catch (erro) {
      console.error('[produtos] Exclusão total falhou:', erro);
      // Parcial e irreversível: o usuário precisa saber que sobrou coisa.
      mostrar(
        'A exclusão não terminou. Parte dos produtos pode ter sido apagada — confira a lista e repita.',
        'error',
      );
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
    setOcupado({ texto: 'Buscando o estoque no ERP' });
    try {
      const leitura = await buscarEstoqueDoErp(estoqueAtual.id);
      if (!leitura.ok) {
        mostrar(leitura.erro ?? 'Não foi possível ler o estoque do ERP.', 'error');
        return;
      }

      // Sem casamento, o saldo na tela seguiria o da última importação, lido como se fosse o do ERP.
      const trava = travaAntesDeGravar(leitura.itens, leitura.estoque, produtos);
      if (trava) {
        console.error('[erp] Buscar parado antes de gravar. Campos do ERP:', leitura.campos);
        mostrar(trava, 'error');
        return;
      }

      setOcupado({ texto: 'Gravando os saldos' });
      const r = await atualizarEstoqueSistema(estoqueAtual.id, produtos, leitura.estoque, {
        omiteZerados: leitura.omiteZerados,
      });

      const parte = (n: number, um: string, muitos: string) =>
        `${n} ${n === 1 ? um : muitos}`;
      mostrar(
        [
          r.atualizados === 0
            ? `Saldo já estava igual ao ERP em ${parte(r.casaram, 'produto', 'produtos')}.`
            : `${parte(r.atualizados, 'saldo atualizado', 'saldos atualizados')} de ${r.casaram} que casaram.`,
          // O ERP não devolve saldo zero: ausência da listagem é zero, não desconhecido.
          r.zeradosPorOmissao > 0
            ? `${parte(r.zeradosPorOmissao, 'produto zerado', 'produtos zerados')} (não vêm na listagem do ERP).`
            : null,
          r.semCorrespondencia > 0
            ? `${parte(r.semCorrespondencia, 'produto', 'produtos')} fora do ERP.`
            : null,
        ]
          .filter(Boolean)
          .join(' '),
        r.semCorrespondencia > r.casaram ? 'warning' : 'success',
      );

      if (contextoLog) {
        void registrar('BUSCAR_ESTOQUE', contextoLog, {
          // `itens`, não `estoque.size`: o mapa indexa cada produto por várias grafias.
          recebidosDoErp: leitura.itens,
          casaram: r.casaram,
          atualizados: r.atualizados,
          zeradosPorOmissao: r.zeradosPorOmissao,
          semCorrespondencia: r.semCorrespondencia,
        });
      }
    } catch (erro) {
      console.error('[produtos] Buscar estoque falhou:', erro);
      mostrar(
        isWriteTimeout(erro) ? AVISO_NAO_CONFIRMADO : 'Não foi possível buscar o estoque.',
        isWriteTimeout(erro) ? 'warning' : 'error',
      );
    } finally {
      setOcupado(null);
    }
  }

  const pct = ocupado?.total ? Math.round(((ocupado.feitos ?? 0) / ocupado.total) * 100) : null;

  /*
    Segura a tela inteira enquanto a lista não é confiável.

    Aqui não é só estética: esta tela mostra `produtos.length` ao lado de "Apagar todos os
    produtos" e alimenta o "Corrigir estoque". Agir sobre uma contagem vinda do cache — que
    pode estar dias atrasada, ou conter os produtos de uma importação anterior — é caro de
    um jeito que não dá para desfazer. Ver `podeLiberarTela` em @themis/shared.
  */
  if (carregandoProdutos || conciliando) {
    return (
      <section className="pilha-g">
        <div>
          <h1 className="titulo-tela">Produtos e estoque</h1>
          <p className="subtitulo">{estoqueAtual?.nome ?? '—'} · carregando…</p>
        </div>
        <Esqueleto linhas={6} texto="Sincronizando os produtos com o servidor…" />
      </section>
    );
  }

  const colunas = previa ? descreverColunas(previa.leitura.cabecalhos, previa.leitura.mapa) : null;

  return (
    <section className="pilha-g">
      <div>
        <h1 className="titulo-tela">Produtos e estoque</h1>
        <p className="subtitulo">
          {estoqueAtual?.nome ?? '—'} · {produtos.length}{' '}
          {produtos.length === 1 ? 'produto' : 'produtos'} · {progresso.contados} contados · {rotuloDaRodada(estoqueAtual)}
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

      {cadastroBloqueado && (
        <p className="aviso">
          Modo contagem ligado. Cadastrar, importar,
          editar cadastro, limpar contagem e apagar produtos ficam bloqueados até alguém desligar em Estoques.
        </p>
      )}

      <div hidden={cadastroBloqueado}>
        <p className="rotulo-secao" style={{ marginBottom: 'var(--e2)' }}>
          Cadastro
        </p>
        <div className="acoes-lista">
          <button
            className="acao"
            type="button"
            onClick={() => {
              if (!estoqueAtual) return;
              setNovo({ id: novoIdDeProduto(estoqueAtual.id), nome: '', codigoBarras: '', idErp: '' });
              setCadastrando(true);
            }}
            disabled={bloqueado}
          >
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
            accept=".xlsx"
            hidden
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) void importar(arquivo);
            }}
          />
        </div>

        <ListaProdutos produtos={produtos} onEditar={setEditando} />
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

      <div hidden={cadastroBloqueado}>
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
              <span className="acao__titulo">Limpar contagem e reiniciar lote</span>
              <span className="acao__descricao">Zera quantidade, status e validade de todos</span>
            </span>
          </button>

          {/*
            Só master: a regra do Firestore exige (`allow delete: if isMaster()`). Admin
            tentando receberia `permission-denied` no meio do lote, com parte do catálogo
            já apagada — pior que não ter o botão.
          */}
          {permissoes.gerenciarUsuarios && (
            <button
              className="acao acao--perigo"
              type="button"
              onClick={() => setApagandoTudo(true)}
              disabled={bloqueado || produtos.length === 0}
            >
              <span className="acao__icone">
                <Icone nome="lixeira" />
              </span>
              <span className="acao__texto">
                <span className="acao__titulo">Apagar todos os produtos</span>
                <span className="acao__descricao">
                  Esvazia o catálogo para reimportar do zero
                </span>
              </span>
            </button>
          )}
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
            <span className="campo__rotulo">Código no ERP</span>
            <input
              className="campo__entrada"
              inputMode="numeric"
              value={novo.idErp}
              onChange={(e) => setNovo({ ...novo, idErp: e.target.value })}
              autoComplete="off"
            />
            <span className="campo__ajuda">É o código do produto no Nuvem3. Só números.</span>
          </label>
        </div>
      </Modal>

      {/* Fora do <div hidden> do Cadastro: o `cadastroBloqueado` no botão cobre o modo contagem ligado com a prévia aberta. */}
      <Modal
        aberto={previa !== null}
        titulo="Conferir a planilha"
        onFechar={() => setPrevia(null)}
        rodape={
          <>
            <button className="botao botao--secundario" type="button" onClick={() => setPrevia(null)}>
              Cancelar
            </button>
            <button
              className="botao botao--primario"
              type="button"
              onClick={() => void confirmarImportacao()}
              disabled={
                !previa ||
                bloqueado ||
                cadastroBloqueado ||
                previa.plano.criar.length + previa.plano.atualizar.length === 0
              }
            >
              Importar
            </button>
          </>
        }
      >
        {previa && colunas && (
          <div className="pilha">
            <p className="subtitulo">
              {previa.arquivo} · aba "{previa.leitura.aba}"
            </p>
            <div>
              <p className="rotulo-secao">Colunas</p>
              <ul className="lista-simples">
                {colunas.usadas.map((c, i) => (
                  <li key={`${c.coluna}-${i}`}>
                    {c.coluna} → {c.rotulo}
                  </li>
                ))}
              </ul>
              {colunas.semUso.length > 0 && <p className="subtitulo">Sem uso: {colunas.semUso.join(', ')}</p>}
            </div>
            <p>{resumoDoPlano(previa.plano)}</p>
            {avisoDeDuplicados(previa.plano) !== null && (
              <p className="aviso">{avisoDeDuplicados(previa.plano)}</p>
            )}
            {previa.plano.recusadas.length > 0 && (
              <div>
                <p className="rotulo-secao">Recusadas</p>
                <ul
                  className="lista-simples"
                  style={verTodasRecusadas ? { maxHeight: '40vh', overflowY: 'auto' } : undefined}
                >
                  {(verTodasRecusadas ? previa.plano.recusadas : previa.plano.recusadas.slice(0, 5)).map((r, i) => (
                    <li key={`${r.linha}-${i}`}>
                      linha {r.linha}: {r.motivo}
                    </li>
                  ))}
                </ul>
                {!verTodasRecusadas && previa.plano.recusadas.length > 5 && (
                  <button className="botao botao--secundario" type="button" onClick={() => setVerTodasRecusadas(true)}>
                    Ver todas
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      <ModalCorrigirEstoque aberto={corrigindo} onFechar={() => setCorrigindo(false)} />

      <Modal
        aberto={confirmarLimpeza}
        titulo="Limpar contagem e reiniciar lote"
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

      <Modal
        aberto={apagandoTudo}
        titulo="Apagar todos os produtos"
        onFechar={() => {
          setApagandoTudo(false);
          setTextoApagar('');
        }}
        rodape={
          <>
            <button
              className="botao botao--secundario"
              type="button"
              onClick={() => {
                setApagandoTudo(false);
                setTextoApagar('');
              }}
            >
              Cancelar
            </button>
            <button
              className="botao botao--perigo"
              type="button"
              onClick={() => void apagarTudo()}
              disabled={textoApagar.trim().toUpperCase() !== PALAVRA_APAGAR}
            >
              Apagar tudo
            </button>
          </>
        }
      >
        <div className="pilha">
          <p>
            Remove os <strong>{produtos.length} produtos</strong> de{' '}
            <strong>{estoqueAtual?.nome ?? 'este estoque'}</strong>. O estoque em si continua
            existindo, vazio, pronto para receber a planilha.
          </p>
          <p className="aviso aviso--perigo">
            Não dá para desfazer — o Firestore não tem lixeira. A contagem em andamento vai
            junto. Se ela importa, finalize e salve a auditoria antes.
          </p>
          <label className="campo">
            <span className="campo__rotulo">
              Digite <strong>{PALAVRA_APAGAR}</strong> para confirmar
            </span>
            <input
              className="campo__entrada"
              type="text"
              value={textoApagar}
              onChange={(e) => setTextoApagar(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
            />
          </label>
        </div>
      </Modal>

      <ModalEditarProduto produtoId={editando} onFechar={() => setEditando(null)} />
    </section>
  );
}
