/**
 * Acesso à coleção de produtos: `estoques/{inventoryId}/produtos`.
 *
 * Regra de ouro: a contagem fala com o Firestore direto, nunca pela API. É a persistência
 * offline do SDK que faz o app funcionar em depósito com wifi ruim.
 */
import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  LIMITE_CRITICO,
  chavesDeIdProduto,
  fisicoDe,
  idProdutoDe,
  nomeDe,
  saldoNoErp,
  sistemaDe,
  type Produto,
} from '@themis/shared';
import { db } from './firebase.js';
import { deviceId } from './dispositivo.js';
import { runTransactionWithTimeout, withWriteTimeout } from './firestore-write.js';
import {
  ConflitoProdutoError,
  REMOVER,
  carregarFila,
  enfileirar,
  isConflito,
  removerDaFila,
  type AlteracaoPendente,
} from './fila-offline.js';

export function colecaoProdutos(inventoryId: string) {
  return collection(db, 'estoques', inventoryId, 'produtos');
}

function paraProduto(snap: QueryDocumentSnapshot<DocumentData>): Produto {
  const d = snap.data();
  const lastModified =
    d['lastModified'] instanceof Timestamp
      ? d['lastModified'].toDate()
      : d['lastModified'] instanceof Date
        ? d['lastModified']
        : null;
  return { ...d, id: snap.id, lastModified } as Produto;
}

/**
 * Escuta a coleção em tempo real.
 * `includeMetadataChanges: false` de propósito: sem isso cada escrita local dispara dois
 * snapshots (cache e servidor) e a lista pisca a cada produto contado.
 */
export function ouvirProdutos(
  inventoryId: string,
  aoMudar: (produtos: Produto[]) => void,
  aoFalhar?: (erro: Error) => void,
): () => void {
  return onSnapshot(
    colecaoProdutos(inventoryId),
    (snap) => aoMudar(snap.docs.map(paraProduto)),
    (erro) => {
      console.error('[produtos] Listener falhou:', erro);
      aoFalhar?.(erro);
    },
  );
}

export async function carregarProdutos(inventoryId: string): Promise<Produto[]> {
  const snap = await getDocs(colecaoProdutos(inventoryId));
  return snap.docs.map(paraProduto);
}

function paraFirestore(dados: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(dados)) {
    saida[chave] = valor === REMOVER ? deleteField() : valor;
  }
  return saida;
}

export interface BaseCliente {
  /** Quantidade que estava na tela quando o usuário começou a editar. */
  quantidade?: number | null;
  codigoBarras?: string | null;
}

export interface ResultadoGravacao {
  /** `false` quando a alteração foi para a fila offline em vez de chegar ao servidor. */
  sincronizado: boolean;
}

/**
 * Detecta se outro aparelho gravou por cima entre a leitura e a gravação.
 *
 * Só é conflito se o servidor divergir do valor base **e** do valor novo. Se o servidor
 * já está com o valor que estamos escrevendo, alguém aplicou a mesma alteração (ou a
 * nossa própria, reenviada pela fila) — reaplicar é inofensivo.
 */
function houveAlteracaoRemota(
  atual: unknown,
  base: unknown | undefined,
  novo: unknown,
): boolean {
  if (base === undefined) return false;
  return atual !== base && atual !== novo;
}

async function gravarComTransacao(
  inventoryId: string,
  produtoId: string,
  dados: Record<string, unknown>,
  base: BaseCliente,
  rotulo: string,
): Promise<void> {
  const ref = doc(colecaoProdutos(inventoryId), produtoId);

  await runTransactionWithTimeout(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Produto não encontrado');

    const atual = snap.data();

    const quantidadeMudou = houveAlteracaoRemota(
      atual['quantidade'],
      base.quantidade,
      dados['quantidade'],
    );
    const codigoMudou = houveAlteracaoRemota(
      atual['codigoBarras'],
      base.codigoBarras,
      dados['codigoBarras'],
    );

    if (quantidadeMudou || codigoMudou) {
      throw new ConflitoProdutoError(
        'Este produto foi alterado em outro dispositivo. Reabra o produto e salve novamente.',
      );
    }

    tx.update(ref, { ...paraFirestore(dados), lastModified: new Date(), modifiedBy: deviceId() });
  }, { label: rotulo });
}

/**
 * Grava a alteração de um produto.
 *
 * Sem rede, ou se a transação estourar o teto, a alteração vai para a fila offline e o
 * chamador recebe `sincronizado: false` — a interface segue normalmente. Conflito real
 * (outro aparelho contou o mesmo item) sobe como erro, porque exige decisão do usuário.
 */
export async function atualizarProduto(
  inventoryId: string,
  produtoId: string,
  dados: Record<string, unknown>,
  base: BaseCliente = {},
): Promise<ResultadoGravacao> {
  const paraFila = () => {
    enfileirar({
      tipo: 'update',
      produtoId,
      inventoryId,
      dados,
      baseQuantidade: base.quantidade ?? null,
      baseCodigoBarras: base.codigoBarras ?? null,
    });
    return { sincronizado: false };
  };

  if (!navigator.onLine) return paraFila();

  try {
    await gravarComTransacao(inventoryId, produtoId, dados, base, 'salvar produto');
    return { sincronizado: true };
  } catch (erro) {
    // Conflito é decisão do usuário, não falha de rede: não vai para a fila.
    if (isConflito(erro)) throw erro;
    console.warn('[produtos] Gravação não confirmada, enfileirando:', erro);
    return paraFila();
  }
}

export interface ResultadoDrenagem {
  enviados: number;
  descartados: number;
  restantes: number;
}

/**
 * Reenvia a fila offline. Para no primeiro erro de rede e deixa o resto para a próxima
 * tentativa — insistir com a rede caída só queima bateria.
 */
export async function drenarFila(): Promise<ResultadoDrenagem> {
  let enviados = 0;
  let descartados = 0;

  for (const item of carregarFila()) {
    try {
      await aplicarPendente(item);
      removerDaFila(item.id);
      enviados++;
    } catch (erro) {
      if (isConflito(erro)) {
        // Contagem mais recente de outro aparelho vence: descartar é o certo.
        console.warn('[produtos] Pendência descartada por conflito:', item.produtoId);
        removerDaFila(item.id);
        descartados++;
        continue;
      }
      break;
    }
  }

  return { enviados, descartados, restantes: carregarFila().length };
}

async function aplicarPendente(item: AlteracaoPendente): Promise<void> {
  if (item.tipo === 'delete') {
    await withWriteTimeout(deleteDoc(doc(colecaoProdutos(item.inventoryId), item.produtoId)), {
      label: 'remover produto',
    });
    return;
  }

  await gravarComTransacao(
    item.inventoryId,
    item.produtoId,
    item.dados,
    { quantidade: item.baseQuantidade, codigoBarras: item.baseCodigoBarras },
    'sincronizar pendência',
  );
}

/** Cria produto. `doc()` gera o ID localmente — disponível mesmo sem ack do servidor. */
export async function criarProduto(
  inventoryId: string,
  dados: Omit<Produto, 'id'>,
): Promise<string> {
  const ref = doc(colecaoProdutos(inventoryId));
  await withWriteTimeout(
    setDoc(ref, { ...dados, lastModified: new Date(), modifiedBy: deviceId() }),
    { label: 'cadastrar produto' },
  );
  return ref.id;
}

/**
 * Cria produtos em lote.
 *
 * Uma escrita por produto, com teto de 8s cada, deixava a importação de 2000 itens
 * inviável na prática. Em lotes de 500 (o limite do Firestore) são 4 requisições.
 * `aoProgredir` alimenta a barra da tela — sem retorno visual, uma importação longa
 * parece travamento.
 */
export async function criarProdutosEmLote(
  inventoryId: string,
  produtos: readonly Omit<Produto, 'id'>[],
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<number> {
  const agora = new Date();
  const autor = deviceId();
  let criados = 0;

  for (let i = 0; i < produtos.length; i += LIMITE_BATCH) {
    const fatia = produtos.slice(i, i + LIMITE_BATCH);
    const lote = writeBatch(db);

    for (const p of fatia) {
      lote.set(doc(colecaoProdutos(inventoryId)), { ...p, lastModified: agora, modifiedBy: autor });
    }

    await withWriteTimeout(lote.commit(), { ms: 20_000, label: 'importar produtos' });
    criados += fatia.length;
    aoProgredir?.(criados, produtos.length);
  }

  return criados;
}

/**
 * Marca o item como conferido pelo admin após a auditoria.
 *
 * `corrigidoIncorreto` diz se a divergência se confirmou depois da conferência física.
 * As Security Rules só deixam admin/master tocar neste campo (`podeAlterarStatusProduto`),
 * e itens `CONFERIDO` saem da lista de trabalho do funcionário.
 */
export async function marcarConferido(
  inventoryId: string,
  produtoId: string,
  divergenciaConfirmada: boolean,
): Promise<void> {
  await withWriteTimeout(
    updateDoc(doc(colecaoProdutos(inventoryId), produtoId), {
      productStatus: 'CONFERIDO',
      corrigidoIncorreto: divergenciaConfirmada,
      lastModified: new Date(),
      modifiedBy: deviceId(),
    }),
    { label: 'marcar conferido' },
  );
}

/** Uma linha da planilha, no formato que a importação consome. */
export interface ProdutoDaPlanilha {
  nome: string;
  codigoBarras: string;
  IdProduto: string | null;
  estoqueSistema: number;
  temCodigoBarras: boolean;
  CodigoInterno: string;
  NCM: string;
  PrecoCusto: number;
  PrecoPJ: number;
  PrecoVenda: number;
  EstoqueMinimo: number;
  Categoria: string;
  Unidade: string;
}

export interface ResultadoImportacaoProdutos {
  criados: number;
  atualizados: number;
}

/** Chave de casamento do produto do banco com a linha da planilha. */
function chavesDeCasamento(p: Produto): string[] {
  const porId = chavesDeIdProduto(idProdutoDe(p) ?? p.idProdut);
  // Sem IdProduto, o nome é o que resta. Sem isso, cada reimportação criaria de novo todo
  // produto cadastrado à mão — que é justamente quem não tem id do ERP.
  return porId.length > 0 ? porId : [`nome:${nomeDe(p).trim().toLowerCase()}`];
}

/**
 * Importa a planilha **atualizando quem já existe**, em vez de criar tudo de novo.
 *
 * É o `processImportData` do 1.x. A versão anterior do 2.0 só criava: reimportar o catálogo
 * duplicava os 1600 produtos, e a contagem em andamento ficava dividida entre a cópia velha
 * e a nova.
 *
 * ⚠️ **A contagem já feita é preservada.** Produto contado neste ciclo mantém `quantidade`
 * e `productStatus`. A planilha atualiza o cadastro; ela não tem opinião sobre a contagem.
 * Quem não foi contado vai a `quantidade: 0` — as regras exigem `quantidade is number`, e
 * produto legado sem o campo seria recusado no update.
 *
 * `estoqueSistema` só é sobrescrito quando a planilha traz coluna de saldo.
 */
export async function importarProdutos(
  inventoryId: string,
  linhas: readonly ProdutoDaPlanilha[],
  temColunaEstoque: boolean,
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<ResultadoImportacaoProdutos> {
  const existentes = await carregarProdutos(inventoryId);

  // Primeiro a vencer fica: duplicata no banco não deve fazer a segunda roubar a linha.
  const porChave = new Map<string, Produto>();
  for (const p of existentes) {
    for (const chave of chavesDeCasamento(p)) if (!porChave.has(chave)) porChave.set(chave, p);
  }

  const agora = new Date();
  const autor = deviceId();
  let criados = 0;
  let atualizados = 0;

  /** Campos que vêm da planilha, iguais para criação e atualização. */
  const doCadastro = (l: ProdutoDaPlanilha): Record<string, unknown> => ({
    nome: l.nome,
    // A grafia legada acompanha: o Themis 1.x lê `NomeProduto`, e enquanto os dois apps
    // convivem gravar só uma faria o produto aparecer sem nome no app velho.
    NomeProduto: l.nome,
    codigoBarras: l.codigoBarras,
    CodigoBarras: l.codigoBarras,
    temCodigoBarras: l.temCodigoBarras,
    CodigoInterno: l.CodigoInterno,
    NCM: l.NCM,
    // Preço e mínimo não aparecem em tela nenhuma — vão para o payload do ERP.
    PrecoCusto: l.PrecoCusto,
    PrecoPJ: l.PrecoPJ,
    PrecoVenda: l.PrecoVenda,
    EstoqueMinimo: l.EstoqueMinimo,
    Categoria: l.Categoria,
    Unidade: l.Unidade,
    lastImportDate: agora,
    lastModified: agora,
    modifiedBy: autor,
    ...(l.IdProduto ? { IdProduto: l.IdProduto } : {}),
  });

  for (let i = 0; i < linhas.length; i += LIMITE_BATCH) {
    const fatia = linhas.slice(i, i + LIMITE_BATCH);
    const lote = writeBatch(db);

    for (const l of fatia) {
      const chaves =
        l.IdProduto === null
          ? [`nome:${l.nome.trim().toLowerCase()}`]
          : chavesDeIdProduto(l.IdProduto);
      const existente = chaves.map((c) => porChave.get(c)).find((p) => p !== undefined);

      if (existente) {
        const contado =
          existente.productStatus === 'ATUALIZADO' ||
          existente.productStatus === 'CONFERIDO' ||
          fisicoDe(existente) > 0;

        lote.update(doc(colecaoProdutos(inventoryId), existente.id), {
          ...doCadastro(l),
          quantidade: contado ? fisicoDe(existente) : 0,
          ...(temColunaEstoque
            ? { estoqueSistema: l.estoqueSistema, EstoqueAtual: l.estoqueSistema }
            : {}),
        });
        atualizados++;
      } else {
        lote.set(doc(colecaoProdutos(inventoryId)), {
          ...doCadastro(l),
          quantidade: 0,
          estoqueSistema: l.estoqueSistema,
          EstoqueAtual: l.estoqueSistema,
          inventoryId,
          createdAt: agora,
        });
        criados++;
      }
    }

    await withWriteTimeout(lote.commit(), { ms: 20_000, label: 'importar planilha' });
    aoProgredir?.(Math.min(i + fatia.length, linhas.length), linhas.length);
  }

  return { criados, atualizados };
}

export interface OpcoesSincronia {
  /**
   * A listagem do ERP só traz saldo positivo — **ausente significa zerado**, não
   * desconhecido. Vem de `omiteZerados` na resposta da API, deduzido da própria listagem.
   */
  omiteZerados?: boolean;
}

export interface ResultadoSincronia {
  /** Produtos cujo `estoqueSistema` mudou. É o número que a tela mostra. */
  atualizados: number;
  /** Produtos que o ERP não conhece. Ficam marcados com `apiNotFound`. */
  semCorrespondencia: number;
  /**
   * Produtos ausentes da listagem que foram **zerados**, porque o ERP omite saldo zero.
   *
   * Contado à parte de `semCorrespondencia`: são situações diferentes que só por acaso se
   * parecem. Um é "o ERP não sabe o que é isso"; o outro é "o ERP tem zero disso".
   */
  zeradosPorOmissao: number;
  /**
   * Produtos que casaram com a listagem, tendo mudado o saldo ou não.
   *
   * Separado de `atualizados` porque **zero atualizados significa duas coisas opostas**:
   * "tudo já estava igual ao ERP" (ótimo) e "nada casou com o ERP" (a sincronização não
   * aconteceu). Sem este número a tela dizia a primeira quando era a segunda, e o usuário
   * ficava olhando o saldo da última importação achando que era o do ERP.
   */
  casaram: number;
}

/**
 * Grava no Firestore o saldo lido do ERP, no campo `estoqueSistema`.
 *
 * Só escreve quem mudou: reescrever 2000 produtos com o mesmo valor gasta cota e polui o
 * `lastModified` de todo mundo, o que atrapalha a ordenação da aba "Contados".
 *
 * ⚠️ Não toca em `quantidade` nem em `productStatus` — o saldo do ERP é o lado "sistema"
 * da comparação, nunca a contagem do funcionário.
 *
 * Também marca `apiNotFound`, como o `buscarEstoqueSemConfirmacao` do 1.x. A aba
 * "Não encontrados na API" lê exatamente esse campo: sem gravá-lo, ela ficava vazia para
 * sempre e ninguém descobria que um produto do catálogo não existe no ERP.
 *
 * ## Produto ausente da listagem
 *
 * Significa duas coisas diferentes, e `omiteZerados` distingue:
 *
 * | Listagem | Ausente quer dizer | O que fazemos |
 * |---|---|---|
 * | traz saldos `<= 0` | o ERP não conhece o produto | marca `apiNotFound` |
 * | só traz saldo `> 0` | o ERP tem **zero** do produto | grava `estoqueSistema: 0` |
 *
 * Tratar o segundo caso como o primeiro é o que deixava na tela o saldo da última
 * importação: o produto zerado no ERP aparecia com o saldo antigo, saía da correção, e o
 * funcionário que contou 5 nunca via aquilo chegar no ERP.
 */
export async function atualizarEstoqueSistema(
  inventoryId: string,
  produtos: readonly Produto[],
  estoqueErp: ReadonlyMap<string, number>,
  opcoes: OpcoesSincronia = {},
): Promise<ResultadoSincronia> {
  const mudancas: Array<{ id: string; dados: Record<string, unknown> }> = [];
  let atualizados = 0;
  let semCorrespondencia = 0;
  let zeradosPorOmissao = 0;
  let casaram = 0;

  for (const p of produtos) {
    const naListagem = saldoNoErp(estoqueErp, p);
    // Ausente numa listagem que só traz positivos é zero, não desconhecido.
    const saldo = naListagem ?? (opcoes.omiteZerados ? 0 : undefined);
    const dados: Record<string, unknown> = {};

    if (saldo === undefined) {
      semCorrespondencia++;
      if (p.apiNotFound !== true) dados['apiNotFound'] = true;
    } else {
      if (naListagem === undefined) zeradosPorOmissao++;
      else casaram++;

      if (sistemaDe(p) !== saldo) {
        dados['estoqueSistema'] = saldo;
        // `EstoqueAtual` acompanha porque o Themis 1.x continua em produção no mesmo banco
        // e lê a grafia antiga. Gravar só uma deixaria os dois apps discordando do saldo.
        dados['EstoqueAtual'] = saldo;
        atualizados++;
      }
      if (p.apiNotFound === true) dados['apiNotFound'] = false;
    }

    // Nada mudou: não escreve. Reescrever 2000 produtos com o mesmo valor gasta cota e
    // embaralha o `lastModified` de todo mundo.
    if (Object.keys(dados).length > 0) mudancas.push({ id: p.id, dados });
  }

  const agora = new Date();
  const autor = deviceId();

  for (let i = 0; i < mudancas.length; i += LIMITE_BATCH) {
    const lote = writeBatch(db);
    for (const m of mudancas.slice(i, i + LIMITE_BATCH)) {
      lote.update(doc(colecaoProdutos(inventoryId), m.id), {
        ...m.dados,
        lastModified: agora,
        modifiedBy: autor,
      });
    }
    await withWriteTimeout(lote.commit(), { ms: 20_000, label: 'sincronizar estoque do ERP' });
  }

  return { atualizados, semCorrespondencia, zeradosPorOmissao, casaram };
}

export interface ResultadoConferencia {
  /** Itens divergentes marcados como conferidos com a divergência confirmada. */
  divergentes: number;
  /** Itens que bateram e foram apenas fechados. */
  corretos: number;
}

/**
 * Fecha a conferência de todos os itens contados, em lote.
 *
 * É a segunda metade do "Corrigir Estoque" do 1.x: depois de mandar as divergências ao
 * ERP, **todo** item `ATUALIZADO` vira `CONFERIDO`, com `corrigidoIncorreto` dizendo se a
 * divergência existia. Sem esse fechamento, os itens continuariam na lista de trabalho do
 * funcionário e seriam recontados.
 *
 * `corrigidoCritico` acompanha, para paridade com o 1.x: diferença de 10 ou mais.
 */
export async function fecharConferencia(
  inventoryId: string,
  produtos: readonly Produto[],
  idsDivergentes: ReadonlySet<string>,
): Promise<ResultadoConferencia> {
  const alvos = produtos.filter((p) => p.productStatus === 'ATUALIZADO');
  const agora = new Date();
  const autor = deviceId();
  let divergentes = 0;
  let corretos = 0;

  for (let i = 0; i < alvos.length; i += LIMITE_BATCH) {
    const lote = writeBatch(db);

    for (const p of alvos.slice(i, i + LIMITE_BATCH)) {
      const incorreto = idsDivergentes.has(p.id);
      const diferenca = fisicoDe(p) - sistemaDe(p);

      lote.update(doc(colecaoProdutos(inventoryId), p.id), {
        productStatus: 'CONFERIDO',
        corrigidoIncorreto: incorreto,
        corrigidoCritico: incorreto && Math.abs(diferenca) >= LIMITE_CRITICO,
        lastModified: agora,
        modifiedBy: autor,
      });

      if (incorreto) divergentes++;
      else corretos++;
    }

    await withWriteTimeout(lote.commit(), { ms: 20_000, label: 'fechar conferência' });
  }

  return { divergentes, corretos };
}

/** Desfaz a conferência: volta o item para a lista de trabalho. */
export async function desfazerConferido(inventoryId: string, produtoId: string): Promise<void> {
  await withWriteTimeout(
    updateDoc(doc(colecaoProdutos(inventoryId), produtoId), {
      productStatus: 'ATUALIZADO',
      corrigidoIncorreto: deleteField(),
      lastModified: new Date(),
      modifiedBy: deviceId(),
    }),
    { label: 'desfazer conferência' },
  );
}

export interface CadastroProduto {
  nome: string;
  codigoBarras: string;
  estoqueSistema: number;
  idProduto: string;
}

/**
 * Altera o cadastro do produto — nome, código de barras, saldo do sistema e código do ERP.
 *
 * Não toca em `quantidade` nem em `productStatus`: cadastro e contagem são coisas
 * diferentes, e misturá-las faria uma correção de nome apagar o trabalho do funcionário.
 *
 * `NomeProduto` acompanha `nome` porque o Themis 1.x lê a grafia antiga — enquanto os dois
 * apps convivem, gravar só uma faria o produto aparecer sem nome no app velho.
 *
 * `IdProduto` vazio é **removido**, não gravado como string vazia: a regra aceita string,
 * mas um identificador vazio faria o produto casar errado com a listagem do ERP.
 */
export async function atualizarCadastroProduto(
  inventoryId: string,
  produtoId: string,
  cadastro: CadastroProduto,
): Promise<void> {
  const codigo = cadastro.codigoBarras.trim();
  const idErp = cadastro.idProduto.trim();

  const dados: Record<string, unknown> = {
    nome: cadastro.nome.trim(),
    NomeProduto: cadastro.nome.trim(),
    codigoBarras: codigo,
    temCodigoBarras: codigo !== '',
    estoqueSistema: cadastro.estoqueSistema,
    IdProduto: idErp === '' ? deleteField() : idErp,
    lastModified: new Date(),
    modifiedBy: deviceId(),
  };

  await withWriteTimeout(updateDoc(doc(colecaoProdutos(inventoryId), produtoId), dados), {
    label: 'editar produto',
  });
}

export async function excluirProduto(inventoryId: string, produtoId: string): Promise<void> {
  await withWriteTimeout(deleteDoc(doc(colecaoProdutos(inventoryId), produtoId)), {
    label: 'excluir produto',
  });
}

/** O Firestore limita um batch a 500 operações. */
const LIMITE_BATCH = 500;

/**
 * Zera a contagem do estoque.
 *
 * "Não contado" é a **ausência** de `productStatus`, não um valor. As Security Rules
 * exigem `quantidade is number` e só aceitam `productStatus in ['ATUALIZADO',
 * 'CONFERIDO']` — gravar `null` ou `'PENDENTE'` faria a regra negar o batch inteiro.
 * Por isso: quantidade vai a `0` e os demais campos são removidos com `deleteField()`.
 *
 * A validade é apagada junto de propósito (decisão do produto na 4.19.5): validade sem
 * contagem correspondente é dado órfão que o relatório mostraria como atual.
 */
export async function limparContagem(inventoryId: string, produtos: readonly Produto[]): Promise<void> {
  for (let i = 0; i < produtos.length; i += LIMITE_BATCH) {
    const lote = writeBatch(db);

    for (const p of produtos.slice(i, i + LIMITE_BATCH)) {
      const limpeza: Record<string, unknown> = {
        // Zera até quem já estava em 0: o que importa é remover o status junto.
        quantidade: 0,
        lastModified: new Date(),
        modifiedBy: deviceId(),
      };
      // Só remove o que existe: `deleteField()` num campo ausente entra no diff da
      // regra à toa e pode derrubar a validação.
      if (p.productStatus != null) limpeza['productStatus'] = deleteField();
      if (p.corrigidoIncorreto != null) limpeza['corrigidoIncorreto'] = deleteField();
      if (p.dataValidade != null) limpeza['dataValidade'] = deleteField();

      lote.update(doc(colecaoProdutos(inventoryId), p.id), limpeza);
    }

    await withWriteTimeout(lote.commit(), { label: 'limpar contagem' });
  }
}
