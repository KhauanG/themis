// Contrato do cadastro de produto (Etapa 4). Os casos de packages/shared/casos/produto.json são os mesmos do app.
import { chaveNomeEstoque, type Repeticao } from './gestao.js';
import { chavesDeIdProduto, codigoBarrasDe, idProdutoDe, nomeDe } from './produto.js';
import type { Produto } from './types.js';

/** `type`, não `interface`: precisa caber em `Record<string, ValorGestao>` do `decidirEdicao`. */
export type CamposCadastro = { nome: string; codigoBarras: string; idErp: string };
export type ValidacaoCadastro = { ok: true; campos: CamposCadastro } | { ok: false; mensagem: string };

const NOME_MAX = 300;
const MSG_ID_ERP = 'Código no ERP: só números, maior que zero.';

/** `codigo != '' && !codigo.startsWith('INTERNO_')`. Igual ao app. */
export function temCodigoBarrasDe(codigo: string): boolean {
  return codigo !== '' && !codigo.startsWith('INTERNO_');
}

/** Código no ERP digitado: aparado, casa `^[1-9]\d*$`. */
export function idErpValido(texto: string): boolean {
  return /^[1-9]\d*$/.test(texto.trim());
}

/** Os três campos como estão no produto: nome (sem o "Sem nome" de exibição), código de barras e IdProduto em texto aparado. */
export function camposDoProduto(p: Produto): CamposCadastro {
  return {
    nome: (p.nome || p.NomeProduto || '').trim(),
    codigoBarras: (codigoBarrasDe(p) ?? '').trim(),
    idErp: String(idProdutoDe(p) ?? '').trim(),
  };
}

/** `abertura` é `null` no cadastro novo. `outros` são os produtos do estoque, sem o do formulário. */
export function validarCadastroProduto(
  digitado: CamposCadastro,
  abertura: CamposCadastro | null,
  outros: readonly Produto[],
): ValidacaoCadastro {
  const nome = digitado.nome.trim();
  if (nome === '') return { ok: false, mensagem: 'Nome do produto é obrigatório!' };
  if (nome.length > NOME_MAX) return { ok: false, mensagem: `Nome do produto com no máximo ${NOME_MAX} letras!` };

  const codigoBarras = digitado.codigoBarras.trim();
  if (codigoBarras === '') {
    // Código que existia não se apaga; o que já era vazio continua podendo ser.
    if (abertura && abertura.codigoBarras.trim() !== '') return { ok: false, mensagem: 'Código de barras é obrigatório!' };
  } else if (codigoBarras !== abertura?.codigoBarras.trim()) {
    if (outros.some((o) => codigoBarrasDe(o) === codigoBarras)) {
      return { ok: false, mensagem: 'Este código de barras já existe em outro produto!' };
    }
  }

  const idErp = digitado.idErp.trim();
  // ID que não mudou não é revalidado: produto antigo com "007" ou "12abc" continua editável.
  if (idErp !== abertura?.idErp.trim()) {
    if (!idErpValido(idErp)) return { ok: false, mensagem: MSG_ID_ERP };
    const chaves = chavesDeIdProduto(idErp);
    if (outros.some((o) => chavesDeIdProduto(idProdutoDe(o)).some((c) => chaves.includes(c)))) {
      return { ok: false, mensagem: 'Este código no ERP já existe em outro produto!' };
    }
  }

  return { ok: true, campos: { nome, codigoBarras, idErp } };
}

/** Documento novo, sem as datas e sem modifiedBy (o repositório põe). */
export function dadosDeCadastro(campos: CamposCadastro, inventoryId: string): Record<string, unknown> {
  return {
    nome: campos.nome,
    NomeProduto: campos.nome,
    codigoBarras: campos.codigoBarras,
    CodigoBarras: campos.codigoBarras,
    temCodigoBarras: temCodigoBarrasDe(campos.codigoBarras),
    IdProduto: campos.idErp,
    quantidade: 0,
    estoqueSistema: 0,
    EstoqueAtual: 0,
    inventoryId,
  };
}

/** Edição: só o que mudou. `remover` são chaves a apagar do documento. */
export function dadosDeEdicao(
  pedido: CamposCadastro,
  campos: Record<keyof CamposCadastro, Repeticao>,
  grafias: { idProduto: boolean; idProdut: boolean },
): { gravar: Record<string, unknown>; remover: string[] } {
  const gravar: Record<string, unknown> = {};
  const remover: string[] = [];
  if (campos.nome === 'GRAVAR') {
    gravar.nome = pedido.nome;
    gravar.NomeProduto = pedido.nome;
  }
  if (campos.codigoBarras === 'GRAVAR') {
    gravar.codigoBarras = pedido.codigoBarras;
    gravar.CodigoBarras = pedido.codigoBarras;
    gravar.temCodigoBarras = temCodigoBarrasDe(pedido.codigoBarras);
  }
  if (campos.idErp === 'GRAVAR') {
    if (pedido.idErp === '') remover.push('IdProduto');
    else gravar.IdProduto = pedido.idErp;
    // As grafias antigas saem junto, senão `idProdutoDe` ainda acharia o ID velho.
    if (grafias.idProduto) remover.push('idProduto');
    if (grafias.idProdut) remover.push('idProdut');
  }
  return { gravar, remover };
}

/** Busca da lista de produtos: nome (sem acento), código de barras ou código no ERP. Ordena por nome. */
export function buscarNoCadastro(
  produtos: readonly Produto[],
  termo: string,
  limite = 50,
): { linhas: Produto[]; total: number } {
  const texto = termo.trim();
  const chave = chaveNomeEstoque(texto);
  const casados = produtos
    .filter(
      (p) =>
        texto === '' ||
        chaveNomeEstoque(nomeDe(p)).includes(chave) ||
        (codigoBarrasDe(p) ?? '').includes(texto) ||
        String(idProdutoDe(p) ?? '').includes(texto),
    )
    .sort((a, b) => nomeDe(a).localeCompare(nomeDe(b), 'pt-BR'));
  return { linhas: casados.slice(0, limite), total: casados.length };
}
