import { describe, expect, it } from 'vitest';
import { erroDeNegocio, normalizarItensDoErp } from './erp.js';

/**
 * O ERP responde **HTTP 200 com erro no corpo** quando recusa a atualização por regra dele.
 * Sem esta checagem o app contava o item como enviado, e só a releitura da fase 3 do
 * "Corrigir estoque" perceberia — quando percebesse. O 1.x fazia isso em
 * `extractBusinessError`; o porte inicial tinha esquecido.
 */
describe('erroDeNegocio', () => {
  it('aceita resposta sem sinal de erro', () => {
    expect(erroDeNegocio({ id: 1, ok: true })).toBeNull();
  });

  it('aceita corpo que não é objeto', () => {
    expect(erroDeNegocio(null)).toBeNull();
    expect(erroDeNegocio('OK')).toBeNull();
    expect(erroDeNegocio(42)).toBeNull();
  });

  it('acusa success: false e usa a mensagem do corpo', () => {
    expect(erroDeNegocio({ success: false, message: 'Produto inexistente' })).toBe(
      'Produto inexistente',
    );
  });

  it('acusa success: false mesmo sem mensagem', () => {
    expect(erroDeNegocio({ success: false })).toBe('campo "success" = false');
  });

  it('reconhece as grafias em português', () => {
    expect(erroDeNegocio({ sucesso: false, mensagem: 'Loja inválida' })).toBe('Loja inválida');
  });

  it('acusa campo de erro preenchido', () => {
    expect(erroDeNegocio({ erro: 'HashLoja não encontrado' })).toBe('HashLoja não encontrado');
    expect(erroDeNegocio({ Error: 'falhou' })).toBe('falhou');
  });

  // Campo de erro vazio é o que a API devolve quando deu certo. Não é erro.
  it('ignora campo de erro vazio', () => {
    expect(erroDeNegocio({ erro: '' })).toBeNull();
    expect(erroDeNegocio({ error: '   ' })).toBeNull();
  });

  it('acusa status = error', () => {
    expect(erroDeNegocio({ status: 'error', message: 'timeout interno' })).toBe('timeout interno');
    expect(erroDeNegocio({ status: 'error' })).toBe('status = error');
  });

  // Conservador de propósito: 200 já é sinal de aceite, e falso positivo aqui faria o app
  // reenviar item que o ERP gravou — barulho sem ganho.
  it('não inventa erro em resposta desconhecida', () => {
    expect(erroDeNegocio({ resultado: 'algo', codigo: 7 })).toBeNull();
    expect(erroDeNegocio({ success: true, erro: null })).toBeNull();
  });
});

/**
 * O nome dos campos da listagem varia. Aceitar só `idproduto` fazia a resposta inteira ser
 * descartada em silêncio: nenhum produto casava, e o app mostrava o saldo da última
 * importação achando que tinha acabado de sincronizar com o ERP. O `auditoria.js` do 1.x
 * — a versão mais testada em campo — aceitava quatro grafias para o id e três para a
 * quantidade.
 */
describe('normalizarItensDoErp', () => {
  it('lê a grafia minúscula, que é a comum', () => {
    expect(normalizarItensDoErp([{ idproduto: '30289733', quantidade: 7 }]).itens).toEqual([
      { idProduto: '30289733', quantidade: 7 },
    ]);
  });

  it('lê as outras grafias do identificador', () => {
    const grafias = [
      { IdProduto: '1', quantidade: 5 },
      { idProduto: '2', quantidade: 5 },
      { IdProdutoERP: '3', quantidade: 5 },
      { idProdutoERP: '4', quantidade: 5 },
    ];
    expect(normalizarItensDoErp(grafias).itens.map((i) => i.idProduto)).toEqual(['1', '2', '3', '4']);
    expect(normalizarItensDoErp(grafias).semId).toBe(0);
  });

  it('lê as outras grafias da quantidade', () => {
    expect(normalizarItensDoErp([{ idproduto: '1', Quantidade: 9 }]).itens[0]?.quantidade).toBe(9);
    expect(normalizarItensDoErp([{ idproduto: '1', EstoqueAtual: 4 }]).itens[0]?.quantidade).toBe(4);
  });

  // Saldo fracionário nunca bateria com contagem inteira: viraria divergência eterna.
  it('arredonda a quantidade, como o parseQuantidade do 1.x', () => {
    expect(normalizarItensDoErp([{ idproduto: '1', quantidade: 4.6 }]).itens[0]?.quantidade).toBe(5);
    expect(normalizarItensDoErp([{ idproduto: '1', quantidade: '12' }]).itens[0]?.quantidade).toBe(12);
  });

  // Descartar transformaria "dado ruim" em "não existe no ERP" — problemas diferentes.
  it('quantidade ilegível vira 0, e o item continua na lista', () => {
    expect(normalizarItensDoErp([{ idproduto: '1', quantidade: 'abc' }]).itens[0]?.quantidade).toBe(0);
    expect(normalizarItensDoErp([{ idproduto: '1' }]).itens[0]?.quantidade).toBe(0);
  });

  it('quantidade zero é saldo válido, não ausência', () => {
    expect(normalizarItensDoErp([{ idproduto: '1', quantidade: 0 }]).itens[0]?.quantidade).toBe(0);
  });

  it('conta as linhas sem identificador em vez de fingir que não vieram', () => {
    const r = normalizarItensDoErp([
      { idproduto: '1', quantidade: 1 },
      { quantidade: 2 },
      { idproduto: '   ', quantidade: 3 },
      { idproduto: 'null', quantidade: 4 },
      null,
    ]);
    expect(r.itens).toHaveLength(1);
    expect(r.semId).toBe(4);
  });

  it('preserva zeros à esquerda para o casamento resolver depois', () => {
    expect(normalizarItensDoErp([{ idproduto: '007', quantidade: 3 }]).itens[0]?.idProduto).toBe('007');
  });

  // Só os nomes das chaves: nome de produto e preço não vão para log nenhum.
  it('reporta os campos do primeiro item, sem o conteúdo', () => {
    const r = normalizarItensDoErp([{ idproduto: '1', quantidade: 2, NomeProduto: 'CERVEJA' }]);
    expect(r.campos).toEqual(['idproduto', 'quantidade', 'NomeProduto']);
    expect(JSON.stringify(r.campos)).not.toContain('CERVEJA');
  });

  it('lista vazia não quebra', () => {
    expect(normalizarItensDoErp([])).toEqual({ itens: [], semId: 0, campos: [] });
  });
});
