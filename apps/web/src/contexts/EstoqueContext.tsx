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
import type { Inventory, Produto } from '@themis/shared';
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
  online: boolean;
  pendentes: number;
  /** IDs alterados no ciclo corrente — alimenta a aba "Atualizados". */
  atualizados: Set<string>;
  datasAlteracao: Map<string, number>;
  salvarContagem: (produto: Produto, quantidade: number, validade: string) => Promise<boolean>;
  sincronizar: () => Promise<void>;
}

const Ctx = createContext<EstoqueAPI | null>(null);

interface MarcacoesCiclo {
  ciclo: number;
  ids: Record<string, number>;
}

function chaveAtualizados(inventoryId: string): string {
  return `${CHAVES.itensAtualizados}:${inventoryId}`;
}

/** Marcações de "item contado nesta rodada" morrem quando o ciclo vira. */
function lerMarcacoes(inventoryId: string, ciclo: number): Record<string, number> {
  const guardado = ler<MarcacoesCiclo | null>(chaveAtualizados(inventoryId), null);
  if (!guardado || guardado.ciclo !== ciclo) return {};
  return guardado.ids ?? {};
}

export function EstoqueProvider({ children }: { children: ReactNode }) {
  const { usuario, perfil, nome } = useAuth();
  const { mostrar } = useToast();

  const [estoques, setEstoques] = useState<Inventory[]>([]);
  const [estoqueId, setEstoqueId] = useState<string | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [carregandoProdutos, setCarregandoProdutos] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendentes, setPendentes] = useState(() => carregarFila().length);
  const [marcacoes, setMarcacoes] = useState<Record<string, number>>({});

  const sincronizando = useRef(false);

  const estoqueAtual = useMemo(
    () => estoques.find((e) => e.id === estoqueId) ?? null,
    [estoques, estoqueId],
  );
  const ciclo = estoqueAtual?.contagemCycle ?? 1;

  useEffect(() => {
    void solicitarArmazenamentoPersistente();
  }, []);

  // Lista de estoques
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

  // Produtos do estoque corrente, em tempo real.
  useEffect(() => {
    if (!estoqueId || !usuario) {
      setProdutos([]);
      return;
    }
    setCarregandoProdutos(true);
    const parar = ouvirProdutos(
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
    return parar;
  }, [estoqueId, usuario, mostrar]);

  useEffect(() => {
    if (!estoqueId) return;
    setMarcacoes(lerMarcacoes(estoqueId, ciclo));
  }, [estoqueId, ciclo]);

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

        // Marca localmente mesmo sem ack: o dado está salvo no cache e a aba
        // "Atualizados" precisa refletir o trabalho do funcionário na hora.
        const novas = { ...marcacoes, [produto.id]: Date.now() };
        setMarcacoes(novas);
        gravar(chaveAtualizados(estoqueId), { ciclo, ids: novas } satisfies MarcacoesCiclo);
        setPendentes(carregarFila().length);

        if (sincronizado) mostrar('Contagem salva.', 'success');
        else mostrar('Sem conexão. Salvo no aparelho e enviado ao reconectar.', 'info');

        // Log nunca segura o retorno: o usuário já pode contar o próximo item.
        if (usuario) {
          void registrar(
            'MODIFICAR_PRODUTO',
            {
              userId: usuario.uid,
              userEmail: usuario.email ?? '',
              userName: nome,
              inventoryId: estoqueId,
              inventoryName: estoqueAtual?.nome ?? estoqueId,
            },
            {
              produto: produto.nome ?? produto.NomeProduto ?? produto.id,
              de: produto.quantidade ?? null,
              para: quantidade,
              validadeDe: produto.dataValidade ?? null,
              validadePara: validade || null,
              ciclo,
            },
          );
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
    [estoqueId, estoqueAtual, ciclo, marcacoes, mostrar, usuario, nome],
  );

  const valor = useMemo<EstoqueAPI>(
    () => ({
      estoques,
      estoqueAtual,
      trocarEstoque,
      produtos,
      carregandoProdutos,
      ciclo,
      online,
      pendentes,
      atualizados: new Set(Object.keys(marcacoes)),
      datasAlteracao: new Map(Object.entries(marcacoes)),
      salvarContagem,
      sincronizar,
    }),
    [
      estoques,
      estoqueAtual,
      trocarEstoque,
      produtos,
      carregandoProdutos,
      ciclo,
      online,
      pendentes,
      marcacoes,
      salvarContagem,
      sincronizar,
    ],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useEstoque(): EstoqueAPI {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEstoque precisa estar dentro de <EstoqueProvider>');
  return ctx;
}
