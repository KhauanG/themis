/**
 * Entrega de arquivo gerado no navegador.
 *
 * Substitui `@capacitor/filesystem` + `@byteowls/capacitor-filesharer` do 1.x. No Android
 * o caminho preferido é o Web Share, que abre a mesma folha de compartilhamento nativa que
 * o app usava (WhatsApp, Drive, e-mail). O download é o fallback.
 */

export async function entregarArquivo(blob: Blob, nomeArquivo: string): Promise<void> {
  const arquivo = new File([blob], nomeArquivo, { type: blob.type });

  // `canShare` com `files` é o único teste confiável: alguns navegadores expõem
  // `navigator.share` mas recusam arquivo.
  if (navigator.canShare?.({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], title: nomeArquivo });
      return;
    } catch (erro) {
      // Cancelar o compartilhamento não é erro — e não deve virar download surpresa.
      if ((erro as { name?: string } | null)?.name === 'AbortError') return;
      console.warn('[arquivo] Compartilhamento falhou, baixando:', erro);
    }
  }

  baixar(blob, nomeArquivo);
}

export function baixar(blob: Blob, nomeArquivo: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revogar na hora cancelaria o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Marcas de acento isoladas pelo NFD (U+0300–U+036F). */
const ACENTOS = /[̀-ͯ]/g;

/** `contagem-deposito-central-2026-08-05.pdf`, sem caractere que quebre o sistema de arquivos. */
export function nomeDeArquivo(base: string, extensao: string): string {
  const limpo = base
    // NFD separa a letra do acento; sem remover o acento antes, "ção" viraria "c-a-o".
    .normalize('NFD')
    .replace(ACENTOS, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const data = new Date().toISOString().slice(0, 10);
  return `${limpo || 'themis'}-${data}.${extensao}`;
}
