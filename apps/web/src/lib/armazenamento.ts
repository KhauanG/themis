/**
 * Acesso tipado ao localStorage.
 *
 * Todo acesso é protegido: em aba anônima, com cota estourada ou storage bloqueado por
 * política, `localStorage` lança. No 1.x cada ponto de uso tinha seu próprio try/catch —
 * e alguns não tinham, derrubando o app inteiro.
 */

export const CHAVES = {
  filaPendentes: 'themis_fila_pendentes_v1',
  historicoPendente: 'themis_historico_pendente_v1',
  dispositivo: 'themis_device_id_v1',
  estoqueAtual: 'themis_estoque_atual_v1',
} as const;

export function ler<T>(chave: string, padrao: T): T {
  try {
    const bruto = localStorage.getItem(chave);
    if (bruto === null) return padrao;
    return JSON.parse(bruto) as T;
  } catch (erro) {
    console.warn(`[armazenamento] Falha ao ler "${chave}":`, erro);
    return padrao;
  }
}

export function gravar(chave: string, valor: unknown): boolean {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
    return true;
  } catch (erro) {
    console.warn(`[armazenamento] Falha ao gravar "${chave}":`, erro);
    return false;
  }
}

export function remover(chave: string): void {
  try {
    localStorage.removeItem(chave);
  } catch (erro) {
    console.warn(`[armazenamento] Falha ao remover "${chave}":`, erro);
  }
}

/**
 * Pede ao navegador para não despejar o storage sob pressão de espaço.
 * Sem isso, um PWA pouco usado pode perder a fila offline. Não existe no app nativo —
 * é o preço de rodar no navegador, e o navegador oferece esta saída.
 */
export async function solicitarArmazenamentoPersistente(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
