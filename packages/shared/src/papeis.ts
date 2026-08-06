/**
 * Papéis e permissões.
 *
 * As flags no documento `users/{uid}` são a fonte da verdade, e as Firestore Security
 * Rules decidem de fato o que passa. O que está aqui só governa a interface: esconder um
 * botão não protege nada, apenas evita que o usuário tente algo que a regra vai negar.
 */
import type { Papel, UserProfile } from './types.js';

/**
 * O 1.x aceitava `isAuditor` como boolean, string "true" ou 1 — documentos antigos foram
 * gravados de formas diferentes. Mantido para não deslogar quem tem perfil legado.
 */
function flagLigada(valor: unknown): boolean {
  if (valor === true || valor === 1) return true;
  return typeof valor === 'string' && valor.toLowerCase() === 'true';
}

export function papelDe(perfil: Pick<UserProfile, 'isMaster' | 'isAdmin' | 'isAuditor'> | null): Papel {
  if (!perfil) return 'comum';
  if (flagLigada(perfil.isMaster)) return 'master';
  if (flagLigada(perfil.isAdmin)) return 'admin';
  if (flagLigada(perfil.isAuditor)) return 'auditor';
  return 'comum';
}

export const ROTULO_PAPEL: Record<Papel, string> = {
  master: 'Master',
  admin: 'Administrador',
  auditor: 'Auditor',
  comum: 'Contagem',
};

export interface Permissoes {
  /** Contar produtos e gravar quantidade/validade. */
  contar: boolean;
  /** Cadastrar, editar e excluir produto. */
  gerenciarProdutos: boolean;
  /** Importar planilha, limpar estoque, corrigir estoque. */
  gerenciarEstoque: boolean;
  /** Abrir o painel de auditoria e ver auditorias salvas. */
  verAuditoria: boolean;
  /** Marcar item como CONFERIDO / corrigidoIncorreto. */
  corrigirContagem: boolean;
  /** Salvar auditoria e fechar o ciclo. Liberado para todos desde a 4.19.7. */
  finalizarContagem: boolean;
  /** Gerenciar usuários e papéis. */
  gerenciarUsuarios: boolean;
  /** Ver o histórico geral de ações. */
  verHistorico: boolean;
  /**
   * Ver o saldo do sistema e a diferença **durante a contagem**.
   *
   * Quem só conta, conta **às cegas**. Mostrar o número do sistema faz o funcionário
   * conferir em vez de contar: ele vê "sistema 12", encontra 11, e digita 12. A contagem
   * deixa de medir o estoque e passa a confirmar o que o ERP já achava — que é exatamente
   * o erro que o inventário existe para pegar.
   *
   * Não é regra de segurança: o dado vem no documento do produto e as regras o liberam para
   * qualquer autenticado. É desenho de processo, e vale enquanto a tela obedecer.
   */
  verEstoqueSistema: boolean;
}

export function permissoesDe(papel: Papel): Permissoes {
  const admin = papel === 'admin' || papel === 'master';
  return {
    contar: true,
    gerenciarProdutos: admin,
    gerenciarEstoque: admin,
    verAuditoria: admin || papel === 'auditor',
    corrigirContagem: admin,
    // Decisão do produto na 4.19.7: qualquer usuário fecha a contagem, protegido pela
    // confirmação de digitar FINALIZAR — o funcionário que contou é quem sabe que acabou.
    finalizarContagem: true,
    gerenciarUsuarios: papel === 'master',
    verHistorico: admin || papel === 'auditor',
    // Auditor vê: o trabalho dele é justamente comparar contagem com sistema.
    verEstoqueSistema: admin || papel === 'auditor',
  };
}
