/**
 * Corrigir estoque — porte do fluxo homônimo do Themis 1.x.
 *
 * Três fases, e **nenhuma delas é opcional**:
 *
 *  1. BUSCAR ANTES. Lê o saldo atual no ERP e grava em `estoqueSistema`. Sem isto, a
 *     comparação usaria o saldo da última importação: o app mandaria "corrigir" itens que
 *     já batiam e deixaria passar divergências surgidas desde então.
 *
 *  2. ENVIAR. Só os itens divergentes. Item que bateu não tem o que corrigir, e mandar
 *     todos seriam 2000 requisições para resolver 40 problemas.
 *
 *  3. VERIFICAR DEPOIS. Espera o ERP processar, lê o saldo de novo e confere item a item
 *     se ficou igual ao que foi enviado. O que não refletiu vira pendência com opção de
 *     reenvio — é o "fallback robusto" do 1.x. Sem ele, um envio aceito pelo ERP mas não
 *     aplicado passa despercebido, e o estoque fica errado achando que foi corrigido.
 *
 * O fechamento da conferência acontece **mesmo se o ERP falhar**: o usuário já confirmou
 * que quer fechar, e a conferência registra o que foi verificado, não o que o ERP aceitou.
 *
 * Exige conexão. Offline, os lotes do Firestore ficariam pendentes para sempre.
 */
import {
  fisicoDe,
  idProdutoDe,
  montarEnvio,
  nomeDe,
  saldoNoErp,
  sistemaDe,
  type Produto,
} from '@themis/shared';
import { atualizarEstoqueSistema, fecharConferencia } from '../../lib/produtos-repo.js';
import { buscarEstoqueDoErp, enviarAoErp, hashDaLoja } from '../../lib/erp.js';

/** Tempo para o ERP processar antes da releitura de verificação. */
const ESPERA_PROCESSAMENTO_MS = 1500;

/** Pausa entre envios, para não afogar o ERP. Mesmo valor do 1.x. */
const PAUSA_ENTRE_ENVIOS_MS = 500;

export interface Diagnostico {
  hashLoja: string;
  contados: Produto[];
  divergentes: Produto[];
  /** Produtos do estoque que o ERP não conhece — não dá para corrigir o que ele não tem. */
  semCorrespondencia: number;
  /** Quantos tiveram o saldo do sistema corrigido pela leitura. */
  saldosAtualizados: number;
}

export interface PendenciaErp {
  nome: string;
  enviado: number;
  noSistema: number;
}

export interface ResultadoCorrecao {
  enviados: number;
  falhasNoEnvio: string[];
  /** Itens cujo saldo no ERP passou a bater com o que foi enviado. */
  confirmados: number;
  /** Enviados que o ERP aceitou mas não refletiu. */
  pendentes: PendenciaErp[];
  conferidos: number;
  divergentesConferidos: number;
  /** A verificação não rodou (falha de leitura). Não é erro de correção. */
  verificacaoIndisponivel: boolean;
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fase 1. Lê o ERP, grava os saldos e devolve o diagnóstico.
 *
 * Separada da execução de propósito: o usuário confirma **com os números certos** na mão,
 * não com a estimativa baseada em dado velho.
 */
export async function diagnosticar(
  inventoryId: string,
  produtos: readonly Produto[],
  aoProgredir: (texto: string) => void,
): Promise<Diagnostico> {
  aoProgredir('Consultando a configuração da loja');
  const hashLoja = await hashDaLoja(inventoryId);
  if (!hashLoja) throw new Error('Nenhum HashLoja configurado para este estoque.');

  aoProgredir('Buscando o estoque no ERP');
  const leitura = await buscarEstoqueDoErp(hashLoja);
  if (!leitura.ok) throw new Error(leitura.erro ?? 'Não foi possível ler o estoque do ERP.');

  aoProgredir('Atualizando os saldos do sistema');
  const sincronia = await atualizarEstoqueSistema(inventoryId, produtos, leitura.estoque);

  // Reaplica o saldo lido na cópia em memória: o listener do Firestore ainda não trouxe
  // a gravação, e o diagnóstico precisa dos números novos agora.
  const frescos = produtos.map((p) => {
    const atualizado = saldoNoErp(leitura.estoque, p);
    return atualizado === undefined ? p : { ...p, estoqueSistema: atualizado };
  });

  const contados = frescos.filter((p) => p.productStatus === 'ATUALIZADO');

  return {
    hashLoja,
    contados,
    divergentes: contados.filter((p) => fisicoDe(p) !== sistemaDe(p)),
    semCorrespondencia: sincronia.semCorrespondencia,
    saldosAtualizados: sincronia.atualizados,
  };
}

/** Fases 2 e 3, mais o fechamento da conferência. */
export async function executarCorrecao(
  inventoryId: string,
  diagnostico: Diagnostico,
  aoProgredir: (texto: string, feitos?: number, total?: number) => void,
): Promise<ResultadoCorrecao> {
  const { contados, divergentes, hashLoja } = diagnostico;
  const paraOErp = divergentes.filter((p) => idProdutoDe(p) != null);

  let enviados = 0;
  const falhasNoEnvio: string[] = [];

  // ---------- Fase 2: enviar as divergências ----------
  for (const [indice, p] of paraOErp.entries()) {
    aoProgredir('Enviando divergências ao ERP', indice + 1, paraOErp.length);

    // `montarEnvio` monta os oito campos que o ERP espera. Não montar o objeto aqui:
    // foi assim que o payload acabou com metade dos campos e o id em texto.
    const resultado = await enviarAoErp(montarEnvio(p, hashLoja));

    if (resultado.ok) enviados++;
    else falhasNoEnvio.push(nomeDe(p));

    if (indice < paraOErp.length - 1) await pausa(PAUSA_ENTRE_ENVIOS_MS);
  }

  // ---------- Fase 3: verificar se o ERP aplicou ----------
  let confirmados = 0;
  const pendentes: PendenciaErp[] = [];
  let verificacaoIndisponivel = false;

  if (enviados > 0) {
    aoProgredir('Aguardando o ERP processar');
    await pausa(ESPERA_PROCESSAMENTO_MS);

    aoProgredir('Conferindo se a correção foi aplicada');
    const releitura = await buscarEstoqueDoErp(hashLoja);

    if (!releitura.ok) {
      // Não conseguir verificar não invalida o envio; só não dá para afirmar que deu certo.
      verificacaoIndisponivel = true;
    } else {
      for (const p of paraOErp) {
        // O valor **como foi enviado** (inteiro, nunca negativo), não o físico cru: é ele
        // que o ERP recebeu, e é contra ele que a comparação faz sentido.
        const enviado = montarEnvio(p, hashLoja).Quantidade;
        const noSistema = saldoNoErp(releitura.estoque, p);

        if (noSistema === undefined) {
          pendentes.push({ nome: nomeDe(p), enviado, noSistema: NaN });
        } else if (noSistema === enviado) {
          confirmados++;
        } else {
          pendentes.push({ nome: nomeDe(p), enviado, noSistema });
        }
      }

      await atualizarEstoqueSistema(inventoryId, contados, releitura.estoque);
    }
  }

  // ---------- Fechamento da conferência ----------
  aoProgredir('Fechando a conferência');
  const idsDivergentes = new Set(divergentes.map((p) => p.id));
  const fechados = await fecharConferencia(inventoryId, contados, idsDivergentes);

  return {
    enviados,
    falhasNoEnvio,
    confirmados,
    pendentes,
    conferidos: fechados.divergentes + fechados.corretos,
    divergentesConferidos: fechados.divergentes,
    verificacaoIndisponivel,
  };
}

/** Reenvia o que não refletiu, para o caso de ter sido só demora do ERP. */
export async function reenviarPendentes(
  hashLoja: string,
  produtos: readonly Produto[],
  pendentes: readonly PendenciaErp[],
  aoProgredir: (feitos: number, total: number) => void,
): Promise<number> {
  const porNome = new Map(produtos.map((p) => [nomeDe(p), p]));
  let reenviados = 0;

  for (const [indice, pendencia] of pendentes.entries()) {
    aoProgredir(indice + 1, pendentes.length);

    const p = porNome.get(pendencia.nome);
    if (!p) continue;

    // A quantidade enviada da primeira vez, não a atual: é ela que precisa entrar.
    const resultado = await enviarAoErp(montarEnvio(p, hashLoja, pendencia.enviado));

    if (resultado.ok) reenviados++;
    if (indice < pendentes.length - 1) await pausa(PAUSA_ENTRE_ENVIOS_MS);
  }

  return reenviados;
}
