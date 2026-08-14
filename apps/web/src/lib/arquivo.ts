/**
 * Entrega de arquivo gerado no navegador. **Dois caminhos, escolhidos por quem chama.**
 *
 * | Função | Comportamento | Quem usa |
 * |---|---|---|
 * | `baixar` | sempre cai na pasta de downloads | os dois PDFs |
 * | `entregarArquivo` | folha de compartilhamento, com download de reserva | a planilha |
 *
 * ⚠️ A escolha é deliberada e já foi trocada uma vez — não unifique sem perguntar.
 *
 * `entregarArquivo` substituiu `@capacitor/filesystem` + `@byteowls/capacitor-filesharer`
 * do 1.x: no celular abre a mesma folha nativa que o app antigo abria (WhatsApp, Drive,
 * e-mail). Faz sentido para a planilha, que quase sempre é mandada para alguém.
 *
 * Para os relatórios em PDF, não fazia: o usuário toca em "PDF da contagem" esperando um
 * arquivo, e recebia um seletor de aplicativo. Quem só quer guardar o relatório tinha que
 * escolher um app para "compartilhar" consigo mesmo. Por isso os PDFs chamam `baixar`
 * direto.
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
