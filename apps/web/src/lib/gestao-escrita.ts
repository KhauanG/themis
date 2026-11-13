/**
 * Gravação de um campo de gestão (Etapa 4, desenho 5.2): lê o servidor, confere e grava só as
 * chaves do campo, tudo numa transação. Sem servidor a transação não acontece, e o chamador
 * só mostra sucesso e só registra o histórico depois que ela volta.
 */
import type { DocumentData, DocumentReference } from 'firebase/firestore';
import {
  TEXTO_FALHA,
  TEXTO_SEM_CONFIRMACAO,
  TEXTO_SEM_PERMISSAO,
  decidirRepeticao,
  type ResultadoGestao,
  type ValorGestao,
} from '@themis/shared';
import { isPermissaoNegada } from './fila-offline.js';
import { isWriteTimeout, runTransactionWithTimeout } from './firestore-write.js';

/** Criar com id estável: criou; o documento já estava lá com o mesmo nome (reenvio); ou está lá com outro nome. */
export type ResultadoCriacao = 'CRIADO' | 'JA_EXISTIA' | 'CONFLITO';

/** O documento que a gravação exigia não existe no servidor. */
export class DocumentoAusenteError extends Error {
  constructor() {
    super('Documento ausente no servidor.');
    this.name = 'DocumentoAusenteError';
  }
}

export async function gravarCampoDeGestao<T extends ValorGestao>(opcoes: {
  ref: DocumentReference;
  rotulo: string;
  abertura: T;
  pedido: T;
  /** Valor do campo no documento do servidor. `undefined` = o documento não existe. */
  ler: (dados: DocumentData | undefined) => T;
  /** As chaves a gravar, com merge. Só as do campo e a data. */
  dados: (pedido: T) => Record<string, unknown>;
  /** `true`: documento ausente lança `DocumentoAusenteError`. */
  exigeDocumento?: boolean;
}): Promise<ResultadoGestao<T>> {
  const { ref, rotulo, abertura, pedido } = opcoes;
  // Sem mudança em relação ao que a tela abriu: nem vale falar com o servidor.
  if (decidirRepeticao(abertura, pedido, abertura) === 'NADA_MUDOU') {
    return { resultado: 'NADA_MUDOU', de: abertura };
  }
  return runTransactionWithTimeout(
    async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists() && opcoes.exigeDocumento) throw new DocumentoAusenteError();
      const servidor = opcoes.ler(snap.exists() ? snap.data() : undefined);
      const resultado = decidirRepeticao(abertura, pedido, servidor);
      // Outro aparelho já gravou o pedido (ou a resposta anterior se perdeu): não regrava.
      if (resultado !== 'GRAVAR') return { resultado, de: abertura };
      tx.set(ref, opcoes.dados(pedido), { merge: true });
      return { resultado, de: servidor };
    },
    { label: rotulo },
  );
}

/** Recusa da regra → `textos.recusa` ou TEXTO_SEM_PERMISSAO. Teto → `textos.teto` ou TEXTO_SEM_CONFIRMACAO. Resto → TEXTO_FALHA. */
export function mensagemDeFalha(erro: unknown, textos: { recusa?: string; teto?: string } = {}): string {
  if (isPermissaoNegada(erro)) return textos.recusa ?? TEXTO_SEM_PERMISSAO;
  if (isWriteTimeout(erro)) return textos.teto ?? TEXTO_SEM_CONFIRMACAO;
  return TEXTO_FALHA;
}

/** Mensagem do primeiro acesso: recusa da regra = campo fora do padrão; teto ou rede = sem internet. */
export function mensagemDoPrimeiroAcesso(erro: unknown): string {
  if (isPermissaoNegada(erro)) return 'Seu perfil tem um campo fora do padrão. Avise o dono.';
  if (isWriteTimeout(erro) || (erro as { code?: string } | null)?.code === 'unavailable') return 'Sem internet, tente de novo.';
  return TEXTO_FALHA;
}
