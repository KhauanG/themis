/**
 * Normalização do pacote XLSX antes de entregá-lo ao `exceljs`.
 *
 * ## Por que isto existe
 *
 * O ERP da Nuvem3 gera o arquivo num dialeto OOXML que é **válido pela especificação** e
 * que o `exceljs` **não lê**. O Themis 1.x nunca esbarrou nisso porque usava SheetJS, que
 * trata os dois casos. O porte trocou de biblioteca e a importação passou a falhar com o
 * arquivo real da empresa — enquanto funcionava com qualquer planilha salva pelo Excel.
 *
 * Duas diferenças, as duas corrigidas aqui:
 *
 * 1. **Prefixo de namespace nos elementos.** O ERP escreve `<x:worksheet>`, `<x:row>`,
 *    `<x:c>`. O parser do `exceljs` compara o nome do elemento por igualdade literal
 *    (`node.name === 'worksheet'` em `worksheet-xform.js`), sem resolver namespace. Com o
 *    prefixo, nada casa, o xform devolve `undefined` e a leitura estoura com
 *    `Cannot set properties of undefined (setting 'sheetNo')` — mensagem que não diz nada
 *    sobre a causa.
 *
 * 2. **Alvo absoluto nas relações.** O ERP escreve `Target="/xl/worksheets/sheet1.xml"`.
 *    O `exceljs` resolve o alvo relativo ao diretório do `.rels`.
 *
 * ## Custo
 *
 * Só reempacota quando encontra alguma das duas formas. Planilha salva pelo Excel passa
 * direto, sem recompressão.
 */
const NS_PLANILHA = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** Prefixo ligado ao namespace de planilha, se o documento usar um. */
function prefixoDoNamespace(xml: string): string | null {
  const achado = new RegExp(`xmlns:([A-Za-z0-9_.-]+)="${NS_PLANILHA}"`).exec(xml);
  return achado?.[1] ?? null;
}

/** Tira o prefixo dos nomes de elemento e promove o namespace a padrão. */
function semPrefixo(xml: string): string {
  const p = prefixoDoNamespace(xml);
  if (!p) return xml;

  return (
    xml
      // Só em nome de elemento (depois de `<` ou `</`). Atributos como `r:id` continuam
      // intactos — o `exceljs` depende deles para achar a planilha.
      .replace(new RegExp(`<(/?)${p}:`, 'g'), '<$1')
      // Sem promover a declaração, os elementos ficariam sem namespace nenhum.
      .replace(new RegExp(` xmlns:${p}="${NS_PLANILHA}"`, 'g'), ` xmlns="${NS_PLANILHA}"`)
  );
}

/** Converte `Target="/xl/algo.xml"` em `Target="algo.xml"`, relativo à pasta do `.rels`. */
function comAlvosRelativos(xml: string, caminhoDoRels: string): string {
  const base = caminhoDoRels.replace(/_rels\/[^/]*$/, '');
  return xml.replace(/Target="\/([^"]*)"/g, (todo, alvo: string) =>
    alvo.startsWith(base) ? `Target="${alvo.slice(base.length)}"` : todo,
  );
}

/**
 * Devolve o pacote que o `exceljs` consegue abrir.
 *
 * Se nada precisou mudar, devolve o buffer original — sem recompressão.
 */
export async function normalizarPacoteXlsx(dados: ArrayBuffer): Promise<ArrayBuffer> {
  const { default: JSZip } = await import('jszip');
  let zip;

  try {
    zip = await JSZip.loadAsync(dados);
  } catch {
    // Não é um zip: `.xls` antigo, `.csv` renomeado, arquivo corrompido. Deixa o `exceljs`
    // falhar com a mensagem dele, que é mais específica do que qualquer coisa daqui.
    return dados;
  }

  let mexeu = false;

  for (const nome of Object.keys(zip.files)) {
    const arquivo = zip.file(nome);
    if (!arquivo || arquivo.dir) continue;
    if (!nome.endsWith('.xml') && !nome.endsWith('.rels')) continue;

    const original = await arquivo.async('string');
    const novo = nome.endsWith('.rels')
      ? comAlvosRelativos(original, nome)
      : semPrefixo(original);

    if (novo !== original) {
      zip.file(nome, novo);
      mexeu = true;
    }
  }

  if (!mexeu) return dados;

  // `warn` de propósito: não é problema, mas é o rastro que explica uma importação
  // estranha. Se ela falhar, esta linha no console diz por onde começar.
  console.warn('[planilha] Pacote no dialeto do ERP; normalizado para leitura.');
  return zip.generateAsync({ type: 'arraybuffer' });
}
