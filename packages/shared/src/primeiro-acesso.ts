/**
 * Primeiro acesso (Etapa 4, desenho 6.4): quem entrava só pelo site nunca ganhava documento em
 * `users`. O site pergunta o nome, como o app, mas só quando o servidor confirma que o perfil
 * não existe ou está sem nome. Documento ausente vindo só do cache nunca abre o formulário.
 */

export const LIMITE_NOME_PERFIL = 50;

/** Igual ao app, defeito incluso: apara, primeira letra maiúscula, o resto minúsculo. */
export function capitalizarNome(nome: string): string {
  const limpo = nome.trim();
  if (!limpo) return '';
  return limpo[0]!.toLocaleUpperCase('pt-BR') + limpo.slice(1).toLocaleLowerCase('pt-BR');
}

export type ValidacaoNomes = { ok: true; firstName: string; lastName: string } | { ok: false; mensagem: string };

export function validarNomes(nome: string, sobrenome: string): ValidacaoNomes {
  const firstName = capitalizarNome(nome);
  const lastName = capitalizarNome(sobrenome);
  if (!firstName || !lastName) return { ok: false, mensagem: 'Por favor, preencha ambos os nomes.' };
  if (firstName.length > LIMITE_NOME_PERFIL || lastName.length > LIMITE_NOME_PERFIL) {
    return { ok: false, mensagem: `Nome e sobrenome com no máximo ${LIMITE_NOME_PERFIL} letras cada.` };
  }
  return { ok: true, firstName, lastName };
}

const textoNaoVazio = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/** Tem `firstName` e `lastName` em texto não vazio. */
export function perfilCompleto(perfil: { firstName?: unknown; lastName?: unknown } | null | undefined): boolean {
  return textoNaoVazio(perfil?.firstName) && textoNaoVazio(perfil?.lastName);
}

export type LeituraDoServidor = 'pendente' | 'completo' | 'incompleto' | 'falhou';
export type EstadoPrimeiroAcesso = 'aguarda' | 'entra' | 'completar-nome' | 'pede-internet';

export function decidirPrimeiroAcesso(e: {
  carregando: boolean;
  perfil: { firstName?: unknown; lastName?: unknown } | null;
  servidor: LeituraDoServidor;
}): EstadoPrimeiroAcesso {
  if (e.carregando) return 'aguarda';
  if (perfilCompleto(e.perfil)) return 'entra';
  if (e.servidor === 'incompleto') return 'completar-nome';
  if (e.servidor === 'falhou') return 'pede-internet';
  return 'aguarda';
}

/** O que a transação grava. Flags e createdAt só quando o documento não existe. */
export function dadosDoPrimeiroAcesso(
  nomes: { firstName: string; lastName: string }, email: string, existe: boolean, agora: Date,
): Record<string, unknown> {
  const dados: Record<string, unknown> = {
    firstName: nomes.firstName,
    lastName: nomes.lastName,
    displayName: `${nomes.firstName} ${nomes.lastName}`,
    email,
    updatedAt: agora,
  };
  if (!existe) Object.assign(dados, { isAdmin: false, isAuditor: false, isMaster: false, createdAt: agora });
  return dados;
}
