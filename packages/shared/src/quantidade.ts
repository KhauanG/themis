// Contagem é número inteiro de 0 a 999.999: o teto existe porque um código de barras lido
// pelo leitor físico no campo da quantidade (13 dígitos + Enter) nunca pode passar como contagem.

export const LIMITE_QUANTIDADE = 999_999;

/** Textos compartilhados com o app nativo (spec, seção 5, A8): mudou aqui, muda lá. */
export const MENSAGEM_QUANTIDADE = {
  obrigatoria: 'Quantidade é obrigatória!',
  inteiro: 'Quantidade deve ser um número inteiro, sem vírgula nem ponto.',
  muitoAlta:
    'Quantidade muito alta (acima de 999.999). Se um código de barras foi lido no campo, apague e digite a quantidade contada.',
  invalida: 'Quantidade inválida!',
} as const;

export type ResultadoQuantidade = { ok: true; valor: number } | { ok: false; mensagem: string };

export function validarQuantidade(texto: string): ResultadoQuantidade {
  const t = texto.trim();
  if (t === '') return { ok: false, mensagem: MENSAGEM_QUANTIDADE.obrigatoria };
  if (/^\d+$/.test(t)) {
    const valor = Number(t);
    return valor > LIMITE_QUANTIDADE
      ? { ok: false, mensagem: MENSAGEM_QUANTIDADE.muitoAlta }
      : { ok: true, valor };
  }
  // "2,5", "2.5", "1.234", "1.234,5": parece número, mas não é inteiro.
  if (/^\d+([.,]\d+)+$/.test(t)) return { ok: false, mensagem: MENSAGEM_QUANTIDADE.inteiro };
  return { ok: false, mensagem: MENSAGEM_QUANTIDADE.invalida };
}
