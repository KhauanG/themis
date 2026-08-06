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
import { progressoContagem, type Inventory, type Produto, type ProgressoContagem } from '@themis/shared';
import { carregarEstoques, ouvirEstoques } from '../lib/estoques-repo.js';
import { atualizarProduto, drenarFila, ouvirProdutos, type BaseCliente } from '../lib/produtos-repo.js';
import { drenarHistorico, registrar } from '../lib/historico.js';
import {
  REMOVER,
  aplicarPendentes,
  carregarFila,
  isConflito,
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
  estoqueAtual: Inventory | null;
  trocarEstoque: (id: string) => void;
  produtos: Produto[];
  carregandoProdutos: boolean;
  ciclo: number;
  progresso: ProgressoContagem;
  online: boolean;
  pendentes: number;
  salvarContagem: (produto: Produto, quantidade: number, validade: string) => Promise<boolean>;
  sincronizar: () => Promise<void>;
  /** Configurações globais, em tempo real. */
  configuracoes: Configuracoes;
  /** `true` quando o estoque aberto está travado para contagem. */
  somenteLeitura: boolean;
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
  const { usuario, perfil, nome } = useAuth();
  const { mostrar } = useToast();

  const [estoques, setEstoques] = useState<Inventory[]>([]);
  const [estoqueId, setEstoqueId] = useState<string | null>(null);
  const [produtosBrutos, setProdutosBrutos] = useState<Produto[]>([]);
  const [carregandoProdutos, setCarregandoProdutos] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [fila, setFila] = useState<AlteracaoPendente[]>(() => carregarFila());
  const [configuracoes, setConfiguracoes] = useState<Configuracoes>(CONFIGURACOES_PADRAO);

  const sincronizando = useRef(false);

  const estoqueAtual = useMemo(
    () => estoques.find((e) => e.id === estoqueId) ?? null,
    [estoques, estoqueId],
  );
  const ciclo = estoqueAtual?.contagemCycle ?? 1;

  // O que a tela vê: o Firestore mais o que está na fila esperando subir. Sem a
  // sobreposição, um produto contado offline continua aparecendo como não contado.
  const produtos = useMemo(
    () => (estoqueId ? aplicarPendentes(produtosBrutos, fila, estoqueId) : produtosBrutos),
    [produtosBrutos, fila, estoqueId],
  );

  const pendentes = fila.length;

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
      setEstoques([]);
      return;
    }
    // A carga inicial é assíncrona e pode terminar depois do desmonte; sem a trava,
    // ela sobrescreveria o estado de um provider que não existe mais.
    let vivo = true;
    carregarEstoques()
      .then((lista) => {
        if (vivo) setEstoques(lista);
      })
      .catch((erro) => console.warn('[estoque] Carga inicial falhou:', erro));

    const pararListener = ouvirEstoques((lista) => {
      if (vivo) setEstoques(lista);
    });

    return () => {
      vivo = false;
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

  useEffect(() => {
    if (!estoqueId || !usuario) {
      setProdutosBrutos([]);
      return;
    }
    setCarregandoProdutos(true);
    return ouvirProdutos(
      estoqueId,
      (lista) => {
        setProdutosBrutos(lista);
        setCarregandoProdutos(false);
      },
      () => {
        setCarregandoProdutos(false);
        mostrar('Não foi possível acompanhar as alterações do estoque.', 'error');
      },
    );
  }, [estoqueId, usuario, mostrar]);

  const sincronizar = useCallback(async () => {
    // Reentrância aqui reenviaria a mesma pendência duas vezes.
    if (sincronizando.current || !navigator.onLine) return;
    sincronizando.current = true;
    try {
      const resultado = await drenarFila();
      await drenarHistorico();
      setFila(carregarFila());

      if (resultado.enviados > 0) {
        mostrar(
          `${resultado.enviados} ${resultado.enviados === 1 ? 'alteração sincronizada' : 'alterações sincronizadas'}.`,
          'success',
        );
      }
      if (resultado.descartados > 0) {
        mostrar(
          `${resultado.descartados} ${resultado.descartados === 1 ? 'alteração não foi aplicada' : 'alterações não foram aplicadas'} porque o produto mudou em outro aparelho. Confira os itens.`,
          'warning',
        );
      }
    } catch (erro) {
      console.warn('[estoque] Sincronização falhou:', erro);
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

  const salvarContagem = useCallback(
    async (produto: Produto, quantidade: number, validade: string): Promise<boolean> => {
      if (!estoqueId) return false;

      if (somenteLeitura) {
        mostrar('Este estoque está em modo somente leitura. Não é possível contar.', 'warning');
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
        console.error('[estoque] Falha ao salvar contagem:', erro);
        mostrar('Não foi possível salvar. Tente novamente.', 'error');
        return false;
      }
    },
    [estoqueId, ciclo, mostrar, contextoLog, somenteLeitura],
  );

  const valor = useMemo<EstoqueAPI>(
    () => ({
      estoques,
      estoqueAtual,
      trocarEstoque,
      produtos,
      carregandoProdutos,
      ciclo,
      progresso,
      online,
      pendentes,
      salvarContagem,
      sincronizar,
      contextoLog,
      configuracoes,
      somenteLeitura,
      alterarConfiguracoes,
    }),
    [
      estoques,
      estoqueAtual,
      trocarEstoque,
      produtos,
      carregandoProdutos,
      ciclo,
      progresso,
      online,
      pendentes,
      salvarContagem,
      sincronizar,
      contextoLog,
      configuracoes,
      somenteLeitura,
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
