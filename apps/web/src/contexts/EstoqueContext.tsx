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
import {
  REMOVER,
  atualizarProduto,
  drenarFila,
  ouvirProdutos,
  type BaseCliente,
} from '../lib/produtos-repo.js';
import { drenarHistorico, registrar } from '../lib/historico.js';
import { carregarFila, isConflito } from '../lib/fila-offline.js';
import { monitorarConexao } from '../lib/conectividade.js';
import { CHAVES, gravar, ler, solicitarArmazenamentoPersistente } from '../lib/armazenamento.js';
import { registrarUltimoEstoque } from '../lib/usuarios-repo.js';
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
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [carregandoProdutos, setCarregandoProdutos] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendentes, setPendentes] = useState(() => carregarFila().length);

  const sincronizando = useRef(false);

  const estoqueAtual = useMemo(
    () => estoques.find((e) => e.id === estoqueId) ?? null,
    [estoques, estoqueId],
  );
  const ciclo = estoqueAtual?.contagemCycle ?? 1;

  // Derivado dos produtos, não de rastreamento local: é a mesma verdade em todo aparelho.
  const progresso = useMemo(() => progressoContagem(produtos), [produtos]);

  useEffect(() => {
    void solicitarArmazenamentoPersistente();
  }, []);

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
      setProdutos([]);
      return;
    }
    setCarregandoProdutos(true);
    return ouvirProdutos(
      estoqueId,
      (lista) => {
        setProdutos(lista);
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
      setPendentes(resultado.restantes);

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
        setPendentes(carregarFila().length);

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
    [estoqueId, ciclo, mostrar, contextoLog],
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
    ],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useEstoque(): EstoqueAPI {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEstoque precisa estar dentro de <EstoqueProvider>');
  return ctx;
}
