import { describe, expect, it } from 'vitest';
import { erroDeNegocio } from './erp.js';

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
