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
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${nome} deve ser um número positivo`);
  return n;
}

export const config = {
  port: inteiro('PORT', 3000),
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
