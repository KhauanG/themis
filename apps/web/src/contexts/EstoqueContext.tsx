import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ESPERA_CONCILIACAO_MS,
  ESPERA_SERVIDOR_MS,
  TETO_CONCILIACAO_MS,
  contagemFechada,
  estaConciliando,
  loteAtivo,
  loteDe,
  filtrarEstoquesPermitidos,
  foraDoErp,
  podeLiberarTela,
  progressoContagem,
  type Inventory,
  type Produto,
  type ProgressoContagem,
} from '@themis/shared';
import { abrirLote, carregarEstoques, ouvirEstoques } from '../lib/estoques-repo.js';
import { atualizarProduto, drenarFila, ouvirProdutos, type BaseCliente } from '../lib/produtos-repo.js';
import { drenarHistorico, registrar } from '../lib/historico.js';
import {
  REMOVER,
  aplicarPendentes,
  carregarFila,
  isConflito,
  isPermissaoNegada,
  type AlteracaoPendente,
} from '../lib/fila-offline.js';
import { monitorarConexao } from '../lib/conectividade.js';
import { CHAVES, gravar, ler, solicitarArmazenamentoPersistente } from '../lib/armazenamento.js';
import { registrarUltimoEstoque } from '../lib/usuarios-repo.js';
import {
  CONFIGURACOES_PADRAO,
  ouvirConfiguracoes,
  salvarConfiguracoes,
  type Configuracoes,
} from '../lib/configuracoes-repo.js';
import { useAuth } from './AuthContext.js';
import { useToast } from './ToastContext.js';

interface EstoqueAPI {
  estoques: Inventory[];
  /** A lista de estoques ainda está sendo carregada — a abertura do app depende dela. */
  carregandoEstoques: boolean;
  estoqueAtual: Inventory | null;
  trocarEstoque: (id: string) => void;
  produtos: Produto[];
  carregandoProdutos: boolean;
  ciclo: number;
  progresso: ProgressoContagem;
  online: boolean;
  pendentes: number;
  /** A inscrição em tempo real caiu; o que está na tela pode estar velho. */
  contatoPerdido: boolean;
  /** Lote em vigor, ou `null` quando a rodada ainda não tem um. */
  lote: string | null;
  /** Há lote aberto? Sem ele ninguém conta — ver `lote.ts`. */
  temLote: boolean;
  /** Abre o lote da rodada. Só admin/master passa na regra. */
  abrirLoteDaRodada: (lote: string) => Promise<void>;
  /** O Firestore ainda concilia cache e servidor — os totais não são confiáveis. */
  conciliando: boolean;
  salvarContagem: (produto: Produto, quantidade: number, validade: string) => Promise<boolean>;
  sincronizar: () => Promise<void>;
  /** Configurações globais, em tempo real. */
  configuracoes: Configuracoes;
  /** `true` quando o estoque aberto está travado para contagem. */
  somenteLeitura: boolean;
  /**
   * A rodada foi encerrada por uma conferência e ninguém mais conta neste estoque.
   * Destrava com "Limpar contagem" ou desfazendo as conferências.
   */
  contagemFechada: boolean;
  alterarConfiguracoes: (mudanca: Partial<Configuracoes>) => Promise<void>;
  /** Contexto pronto para `registrar()`. `null` enquanto não há usuário ou estoque. */
  contextoLog: {
    userId: string;
    userEmail: string;
    userName: string;
    inventoryId: string;
    inventoryName: string;
  } | null;
}

const Ctx = createContext<EstoqueAPI | null>(null);

export function EstoqueProvider({ children }: { children: ReactNode }) {
  const { usuario, perfil, papel, nome } = useAuth();
  const { mostrar } = useToast();

  const [estoquesBrutos, setEstoquesBrutos] = useState<Inventory[]>([]);
  /**
   * A lista de estoques ainda não chegou.
   *
   * Começa `true` porque a abertura do app depende dela: sem estoque escolhido não há
   * `estoqueId`, sem `estoqueId` o efeito dos produtos nem liga `carregandoProdutos`, e a
   * tela de contagem caía direto no estado vazio — mostrando "nenhum produto" para quem
   * só estava esperando o app abrir.
   */
  const [carregandoEstoques, setCarregandoEstoques] = useState(true);
  const [estoqueId, setEstoqueId] = useState<string | null>(null);
  const [produtosBrutos, setProdutosBrutos] = useState<Produto[]>([]);
  const [carregandoProdutos, setCarregandoProdutos] = useState(false);
  /**
   * A inscrição nos produtos caiu e não voltou nas primeiras tentativas.
   *
   * Não é o mesmo que estar offline: offline o app sabe que está sozinho e a contagem
   * segue normalmente pela fila. Aqui o app *acha* que está conectado, e a tela pode estar
   * mostrando dado velho sem nenhum sinal. Era o caso em que a única saída era reabrir.
   */
  const [contatoPerdido, setContatoPerdido] = useState(false);
  /**
   * O último snapshot ainda veio do cache: o Firestore não terminou de conciliar.
   *
   * Diferente de `carregandoProdutos`, que a tela solta no teto de 8s. Num estoque de
   * milhares de itens em wifi de loja a conciliação passa disso, e é aí que o total
   * aparece inflado e vai descendo — o cache tem os documentos da importação anterior, o
   * servidor entrega as exclusões aos poucos, e o número cai de 3300 para 1600 na frente
   * do funcionário.
   *
   * Enquanto isto for `true`, nenhum total vai para a tela.
   */
  /**
   * O último snapshot recebido veio do cache. **Dado bruto, não decisão.**
   *
   * A decisão é `conciliando`, mais abaixo, e passa por `estaConciliando`. A primeira
   * versão usava este booleano direto e ficava "sincronizando…" eterno offline — ver o
   * comentário daquela função.
   */
  const [snapshotDoCache, setSnapshotDoCache] = useState(false);
  /** O teto absoluto da conciliação estourou. */
  const [conciliacaoEsgotada, setConciliacaoEsgotada] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [fila, setFila] = useState<AlteracaoPendente[]>(() => carregarFila());
  const [configuracoes, setConfiguracoes] = useState<Configuracoes>(CONFIGURACOES_PADRAO);

  const sincronizando = useRef(false);

  // Escopo por usuário: quem só trabalha na Loja Centro não rola por seis depósitos para
  // achar o dele, nem conta no lugar errado por engano.
  const estoques = useMemo(
    () => filtrarEstoquesPermitidos(estoquesBrutos, perfil, papel),
    [estoquesBrutos, perfil, papel],
  );

  const estoqueAtual = useMemo(
    () => estoques.find((e) => e.id === estoqueId) ?? null,
    [estoques, estoqueId],
  );

  /**
   * O estoque aberto deixou de ser permitido — o master mudou a lista enquanto o app
   * estava aberto. Cai para o primeiro permitido em vez de deixar a tela sem contexto.
   */
  useEffect(() => {
    if (!estoqueId || estoques.length === 0) return;
    if (estoques.some((e) => e.id === estoqueId)) return;

    const destino = estoques[0]!;
    setEstoqueId(destino.id);
    gravar(CHAVES.estoqueAtual, destino.id);
    mostrar(`Você não tem mais acesso ao estoque anterior. Abrindo ${destino.nome}.`, 'info');
  }, [estoques, estoqueId, mostrar]);
  const ciclo = estoqueAtual?.contagemCycle ?? 1;

  // O que a tela vê: o Firestore mais o que está na fila esperando subir. Sem a
  // sobreposição, um produto contado offline continua aparecendo como não contado.
  const produtos = useMemo(
    () => (estoqueId ? aplicarPendentes(produtosBrutos, fila, estoqueId) : produtosBrutos),
    [produtosBrutos, fila, estoqueId],
  );

  const pendentes = fila.length;

  /*
    O lote substitui o Ciclo como referência da rodada. Sem lote aberto, a contagem fica
    travada — é o que o fluxo pede: depois de limpar ou reupar o estoque, alguém precisa
    dizer QUAL lote está sendo contado antes de o primeiro item ser tocado.
  */
  const lote = useMemo(() => loteDe(estoqueAtual), [estoqueAtual]);
  const temLote = useMemo(() => loteAtivo(estoqueAtual), [estoqueAtual]);

  /**
   * Ainda vale esconder os totais e dizer "sincronizando"?
   *
   * Derivado, e não um booleano vindo do snapshot: **"o snapshot do servidor não vem" é um
   * estado que não produz evento**. Offline, o primeiro snapshot chega do cache e nenhum
   * outro chega depois — não existiria nada para desligar o aviso, e ele ficava eterno.
   * A regra e o histórico estão em `estaConciliando`, com teste.
   */
  const conciliando = estaConciliando({
    snapshotDoCache,
    online,
    contatoPerdido,
    esgotou: conciliacaoEsgotada,
  });

  // Derivado dos produtos, não de rastreamento local: é a mesma verdade em todo aparelho.
  const progresso = useMemo(() => progressoContagem(produtos), [produtos]);

  useEffect(() => {
    void solicitarArmazenamentoPersistente();
  }, []);

  // Em tempo real: ligar o modo contagem no escritório precisa refletir no celular do
  // depósito sem ninguém recarregar nada.
  useEffect(() => {
    if (!usuario) return;
    return ouvirConfiguracoes(setConfiguracoes);
  }, [usuario]);

  /**
   * Registra o login uma vez por sessão de aparelho.
   *
   * Espera o estoque estar escolhido para o registro nascer com contexto — entrada de
   * histórico sem `inventoryId` não aparece em filtro nenhum e vira registro órfão.
   */
  const loginRegistrado = useRef<string | null>(null);
  useEffect(() => {
    if (!usuario || !estoqueAtual || loginRegistrado.current === usuario.uid) return;
    loginRegistrado.current = usuario.uid;
    void registrar('LOGIN', {
      userId: usuario.uid,
      userEmail: usuario.email ?? '',
      userName: nome,
      inventoryId: estoqueAtual.id,
      inventoryName: estoqueAtual.nome ?? estoqueAtual.id,
    });
  }, [usuario, estoqueAtual, nome]);

  const somenteLeitura = Boolean(estoqueId && configuracoes.somenteLeitura.includes(estoqueId));

  /**
   * Conferiu um item, fechou a rodada — para todo mundo, inclusive admin.
   *
   * Derivado dos produtos, como o progresso: é a mesma verdade em qualquer aparelho, sem
   * depender de um interruptor que alguém precise lembrar de ligar.
   */
  const rodadaFechada = useMemo(
    // Lista provisória não fecha rodada. Um produto CONFERIDO de um ciclo antigo, ainda no
    // cache, travaria a contagem do estoque inteiro com a mensagem "contagem encerrada" —
    // e o funcionário ficaria parado sem entender, até a conciliação terminar.
    //
    // Ser permissivo aqui é seguro: quem realmente impede alterar item conferido é
    // `podeAlterarStatusProduto` nas Security Rules. A interface esconde, a regra protege.
    () => !carregandoProdutos && !conciliando && contagemFechada(produtos),
    [produtos, carregandoProdutos, conciliando],
  );

  const alterarConfiguracoes = useCallback(
    async (mudanca: Partial<Configuracoes>) => {
      const novo = { ...configuracoes, ...mudanca };
      // Estado otimista: o listener confirma em seguida, mas o interruptor precisa
      // responder na hora ao toque.
      setConfiguracoes(novo);
      try {
        await salvarConfiguracoes(novo);
      } catch (erro) {
        console.error('[configuracoes] Falha ao salvar:', erro);
        setConfiguracoes(configuracoes);
        mostrar('Não foi possível salvar. Só admin ou master pode alterar isto.', 'error');
      }
    },
    [configuracoes, mostrar],
  );

  useEffect(() => {
    if (!usuario) {
      setEstoquesBrutos([]);
      setCarregandoEstoques(false);
      return;
    }
    // A carga inicial é assíncrona e pode terminar depois do desmonte; sem a trava,
    // ela sobrescreveria o estado de um provider que não existe mais.
    let vivo = true;
    setCarregandoEstoques(true);

    const pronto = () => {
      if (vivo) setCarregandoEstoques(false);
    };

    /*
      Teto de espera, pelo mesmo motivo dos produtos: rede lenta é pior que ausente. Sem
      ele, um aparelho que se acha online ficaria na tela de abertura para sempre — e o
      funcionário não teria nem como chegar na contagem offline.
    */
    const temporizador = setTimeout(pronto, ESPERA_SERVIDOR_MS);

    carregarEstoques()
      .then((lista) => {
        if (vivo) setEstoquesBrutos(lista);
      })
      .catch((erro) => console.warn('[estoque] Carga inicial falhou:', erro))
      // Falhou ou não, a abertura destrava: com falha o listener ainda pode trazer a lista,
      // e prender a tela num erro de rede não ajuda ninguém.
      .finally(() => {
        clearTimeout(temporizador);
        pronto();
      });

    const pararListener = ouvirEstoques((lista) => {
      if (!vivo) return;
      setEstoquesBrutos(lista);
      clearTimeout(temporizador);
      pronto();
    });

    return () => {
      vivo = false;
      clearTimeout(temporizador);
      pararListener();
    };
  }, [usuario]);

  // Escolha inicial do estoque: o último usado, senão o primeiro da lista.
  useEffect(() => {
    if (estoqueId || estoques.length === 0) return;
    const salvo = ler<string | null>(CHAVES.estoqueAtual, null) ?? perfil?.lastEstoque ?? null;
    const existe = salvo && estoques.some((e) => e.id === salvo);
    setEstoqueId(existe ? salvo : (estoques[0]?.id ?? null));
  }, [estoques, estoqueId, perfil]);

  /**
   * Acompanha os produtos do estoque aberto.
   *
   * Dois cuidados aqui, e os dois vieram de bug relatado em campo — "aparecem itens
   * duplicados e mais itens do que temos; ao recarregar, some".
   *
   * **1. Zerar a lista na troca.** `produtosBrutos` só é substituído quando o primeiro
   * snapshot do estoque novo chega. Sem o `setProdutosBrutos([])`, a lista do estoque
   * anterior fica na tela sob o nome do novo, durante todo o caminho de rede.
   *
   * **2. Não tratar o cache como verdade.** Com `persistentLocalCache`, o primeiro
   * snapshot vem do aparelho, não do servidor. Quem apaga o estoque e reimporta a planilha
   * gera IDs novos para os mesmos produtos; o aparelho que ainda tem os IDs antigos no
   * cache mostra os dois conjuntos ao mesmo tempo. A decisão de liberar mora em
   * `podeLiberarTela`, que é testada.
   */
  useEffect(() => {
    if (!estoqueId || !usuario) {
      setProdutosBrutos([]);
      setCarregandoProdutos(false);
      return;
    }

    setProdutosBrutos([]);
    setCarregandoProdutos(true);
    setSnapshotDoCache(true);
    setConciliacaoEsgotada(false);

    let esgotou = false;
    // Teto de espera: rede lenta é pior que rede ausente — o app se acha online e ficaria
    // na tela de carregamento para sempre. Estourado, mostra o cache: dado velho é melhor
    // que tela travada, e o snapshot do servidor ainda corrige quando chegar.
    const temporizador = setTimeout(() => {
      esgotou = true;
      setCarregandoProdutos(false);
    }, ESPERA_CONCILIACAO_MS);

    /*
      Teto absoluto, separado do que solta o esqueleto. A conciliação pode nunca terminar
      sem que nada avise — wifi de loja com portal cativo responde a tudo menos ao
      Firestore, e o app segue se achando online. Passado isto, os números voltam à tela
      mesmo provisórios: número atrasado é melhor que "…" eterno, que é o que faz o
      funcionário fechar e reabrir o app.
    */
    const tetoAbsoluto = setTimeout(() => setConciliacaoEsgotada(true), TETO_CONCILIACAO_MS);

    const parar = ouvirProdutos(
      estoqueId,
      (lista, doCache) => {
        setProdutosBrutos(lista);
        setContatoPerdido(false);
        // `doCache` só vira false quando a consulta está em dia com o servidor.
        setSnapshotDoCache(doCache);
        if (podeLiberarTela({ doCache, online: navigator.onLine, esgotou })) {
          clearTimeout(temporizador);
          setCarregandoProdutos(false);
        }
      },
      // Perdeu contato depois de várias tentativas. A inscrição continua tentando sozinha;
      // o que muda aqui é o usuário passar a saber que o que está na tela pode estar velho.
      // Antes, a tela congelava calada e a saída era reabrir o app.
      () => {
        clearTimeout(temporizador);
        setCarregandoProdutos(false);
        setContatoPerdido(true);
      },
      () => setContatoPerdido(false),
    );

    return () => {
      clearTimeout(temporizador);
      clearTimeout(tetoAbsoluto);
      parar();
    };
  }, [estoqueId, usuario, mostrar]);

  /**
   * Drena a fila. **Sempre dá retorno**, inclusive quando nada se move.
   *
   * O relato que motivou isto: "1 alteração aguardando envio", o usuário toca em Enviar
   * agora, o botão anima, e a faixa continua igual. Não havia mensagem nenhuma para o caso
   * `enviados === 0` — nem para sucesso parcial, nem para falha. Da cadeira do usuário, o
   * botão está quebrado.
   */
  const sincronizar = useCallback(async () => {
    if (!navigator.onLine) {
      mostrar('Sem conexão. As alterações sobem sozinhas quando a internet voltar.', 'info');
      return;
    }
    // Reentrância aqui reenviaria a mesma pendência duas vezes.
    if (sincronizando.current) return;
    sincronizando.current = true;

    try {
      const resultado = await drenarFila();
      await drenarHistorico();
      setFila(carregarFila());

      const { enviados, motivos, restantes } = resultado;

      if (enviados > 0) {
        mostrar(
          `${enviados} ${enviados === 1 ? 'alteração sincronizada' : 'alterações sincronizadas'}.`,
          'success',
        );
      }

      // Cada motivo pede uma ação diferente do usuário. Juntar tudo em "não foi aplicada"
      // — como era antes — manda conferir o que não precisa e esconde o que precisa.
      if (motivos.conflito > 0) {
        mostrar(
          `${motivos.conflito} ${motivos.conflito === 1 ? 'contagem foi descartada' : 'contagens foram descartadas'}: o mesmo item foi contado depois em outro aparelho. Confira esses produtos.`,
          'warning',
        );
      }
      if (motivos.semPermissao > 0) {
        mostrar(
          `${motivos.semPermissao} ${motivos.semPermissao === 1 ? 'contagem não pôde ser aplicada' : 'contagens não puderam ser aplicadas'}: os itens já foram conferidos e estão fechados.`,
          'warning',
        );
      }
      if (motivos.ausente > 0) {
        mostrar(
          `${motivos.ausente} ${motivos.ausente === 1 ? 'contagem foi descartada' : 'contagens foram descartadas'}: o produto não existe mais neste estoque. Costuma acontecer depois de reimportar a planilha.`,
          'warning',
        );
      }

      // O que sobrou só pode ser falha transitória — permanente já saiu da fila acima.
      if (restantes > 0) {
        mostrar(
          `${restantes} ${restantes === 1 ? 'alteração continua' : 'alterações continuam'} na fila: o servidor não respondeu a tempo. Tente de novo com sinal melhor.`,
          'warning',
        );
      } else if (enviados === 0 && resultado.descartados === 0) {
        // Fila vazia e nada a fazer: o contador estava desatualizado.
        mostrar('Nada pendente para enviar.', 'info');
      }
    } catch (erro) {
      console.warn('[estoque] Sincronização falhou:', erro);
      mostrar('Não foi possível sincronizar agora. Tente de novo em instantes.', 'error');
    } finally {
      sincronizando.current = false;
    }
  }, [mostrar]);

  useEffect(() => {
    return monitorarConexao((agoraOnline) => {
      setOnline(agoraOnline);
      if (agoraOnline) void sincronizar();
    });
  }, [sincronizar]);

  const trocarEstoque = useCallback(
    (id: string) => {
      setEstoqueId(id);
      gravar(CHAVES.estoqueAtual, id);
      if (usuario) void registrarUltimoEstoque(usuario.uid, id);
    },
    [usuario],
  );

  const contextoLog = useMemo(
    () =>
      usuario && estoqueAtual
        ? {
            userId: usuario.uid,
            userEmail: usuario.email ?? '',
            userName: nome,
            inventoryId: estoqueAtual.id,
            inventoryName: estoqueAtual.nome ?? estoqueAtual.id,
          }
        : null,
    [usuario, estoqueAtual, nome],
  );

  const abrirLoteDaRodada = useCallback(
    async (novo: string) => {
      if (!estoqueAtual) return;
      await abrirLote(estoqueAtual.id, novo, estoqueAtual.contagemCycle ?? 1);
      if (contextoLog) {
        void registrar('MODIFICAR_PRODUTO', contextoLog, {
          acao: 'ABRIR_LOTE',
          lote: novo,
          ciclo: estoqueAtual.contagemCycle ?? 1,
        });
      }
    },
    [estoqueAtual, contextoLog],
  );

  const salvarContagem = useCallback(
    async (produto: Produto, quantidade: number, validade: string): Promise<boolean> => {
      if (!estoqueId) return false;

      if (somenteLeitura) {
        mostrar('Este estoque está em modo somente leitura. Não é possível contar.', 'warning');
        return false;
      }

      /**
       * Trava também aqui, não só no card.
       *
       * O card é o caminho normal, mas não é o único: o leitor de código de barras abre o
       * produto pelo código, e a fila offline reenvia o que já estava pendente. Sem saldo do
       * ERP não há com o que comparar, e a contagem viraria divergência inventada no
       * relatório impresso.
       */
      /*
        Sem lote aberto não se conta. A tela já mostra o card antes de expandir o item, mas
        a trava precisa estar aqui também: o leitor de código de barras abre o produto por
        outro caminho, e a fila offline reenvia o que ficou pendente.
      */
      if (!temLote) {
        mostrar('Informe o lote que está sendo contado antes de lançar quantidades.', 'warning');
        return false;
      }

      if (rodadaFechada) {
        mostrar(
          'A contagem deste estoque foi encerrada pela conferência. Limpe a contagem para começar uma nova rodada.',
          'warning',
        );
        return false;
      }

      if (foraDoErp(produto)) {
        mostrar(
          'Produto fora do ERP: não há saldo para comparar. Resolva o cadastro no Nuvem3.',
          'warning',
        );
        return false;
      }

      const dados: Record<string, unknown> = {
        quantidade,
        productStatus: 'ATUALIZADO',
        // A regra exige `dataValidade is string`: apagar é remover o campo, não gravar null.
        dataValidade: validade || REMOVER,
      };
      const base: BaseCliente = {
        quantidade: produto.quantidade ?? null,
        codigoBarras: produto.codigoBarras ?? null,
      };

      try {
        const { sincronizado } = await atualizarProduto(estoqueId, produto.id, dados, base);
        // Releitura, não decremento: a fila pode ter deduplicado uma alteração anterior
        // do mesmo produto, e o tamanho não muda de forma previsível.
        setFila(carregarFila());

        if (sincronizado) mostrar('Contagem salva.', 'success');
        else mostrar('Sem conexão. Salvo no aparelho e enviado ao reconectar.', 'info');

        // Log nunca segura o retorno: o usuário já pode contar o próximo item.
        if (contextoLog) {
          void registrar('MODIFICAR_PRODUTO', contextoLog, {
            produto: produto.nome ?? produto.NomeProduto ?? produto.id,
            de: produto.quantidade ?? null,
            para: quantidade,
            validadeDe: produto.dataValidade ?? null,
            validadePara: validade || null,
            ciclo,
          });
        }

        return true;
      } catch (erro) {
        if (isConflito(erro)) {
          mostrar(
            'Este produto foi contado em outro aparelho. Recarregue e confira antes de salvar.',
            'warning',
          );
          return false;
        }
        // Recusa das regras não vai mais para a fila (ver fila-offline.ts): chega aqui, e
        // a tela precisa dizer que NÃO salvou, senão o usuário vai embora achando que sim.
        if (isPermissaoNegada(erro)) {
          mostrar(
            'Este item não pode mais ser alterado. Ele já foi conferido — peça para desfazer no painel de auditoria.',
            'warning',
          );
          return false;
        }
        console.error('[estoque] Falha ao salvar contagem:', erro);
        mostrar('Não foi possível salvar. Tente novamente.', 'error');
        return false;
      }
    },
    [estoqueId, ciclo, mostrar, contextoLog, somenteLeitura, rodadaFechada, temLote],
  );

  const valor = useMemo<EstoqueAPI>(
    () => ({
      estoques,
      carregandoEstoques,
      estoqueAtual,
      trocarEstoque,
      produtos,
      carregandoProdutos,
      ciclo,
      progresso,
      online,
      pendentes,
      contatoPerdido,
      conciliando,
      lote,
      temLote,
      abrirLoteDaRodada,
      salvarContagem,
      sincronizar,
      contextoLog,
      configuracoes,
      somenteLeitura,
      contagemFechada: rodadaFechada,
      alterarConfiguracoes,
    }),
    [
      estoques,
      carregandoEstoques,
      estoqueAtual,
      trocarEstoque,
      produtos,
      carregandoProdutos,
      ciclo,
      progresso,
      online,
      pendentes,
      contatoPerdido,
      conciliando,
      lote,
      temLote,
      abrirLoteDaRodada,
      salvarContagem,
      sincronizar,
      contextoLog,
      configuracoes,
      somenteLeitura,
      rodadaFechada,
      alterarConfiguracoes,
    ],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useEstoque(): EstoqueAPI {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEstoque precisa estar dentro de <EstoqueProvider>');
  return ctx;
}
