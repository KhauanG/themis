/** Leitura e validação das variáveis de ambiente. Falha cedo se algo obrigatório faltar. */

function texto(nome: string, padrao?: string): string {
  const valor = process.env[nome] ?? padrao;
  if (valor === undefined) throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  return valor;
}

function inteiro(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (!bruto) return padrao;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[config] ${nome}="${bruto}" não é um número positivo; usando ${padrao}.`);
    return padrao;
  }
  return n;
}

/** Onde o servidor deve escutar: porta TCP ou caminho de socket Unix. */
export type Escuta = { tipo: 'porta'; porta: number } | { tipo: 'socket'; caminho: string };

/**
 * Resolve o alvo de escuta a partir de `PORT`.
 *
 * O Passenger — usado pela Hostinger para apps Node — costuma passar um **caminho de
 * socket Unix** em `PORT`, não um número. Tratar isso como erro derrubava o processo
 * antes de ele subir, e o resultado visível era um `503 Service Unavailable` sem nenhuma
 * pista, porque o servidor web nunca chegava a falar com o app.
 */
function resolverEscuta(): Escuta {
  const bruto = process.env['PORT'];
  if (!bruto) return { tipo: 'porta', porta: 3000 };

  const n = Number(bruto);
  if (Number.isInteger(n) && n > 0 && n < 65_536) return { tipo: 'porta', porta: n };

  return { tipo: 'socket', caminho: bruto };
}

export const config = {
  escuta: resolverEscuta(),
  isProd: process.env['NODE_ENV'] === 'production',

  corsOrigins: texto('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  erp: {
    url: texto('ERP_API_URL', 'https://erp.nuvem3.com.br/apiv1/Estoque/EstoqueInventarioAtualizar'),
    timeoutMs: inteiro('ERP_TIMEOUT_MS', 10_000),
  },

  /** Vazio desabilita o webhook — ver comentário em .env.example. */
  webhookSecret: process.env['WEBHOOK_SECRET'] ?? '',
} as const;
