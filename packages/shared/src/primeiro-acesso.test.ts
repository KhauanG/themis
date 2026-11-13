import { describe, expect, it } from 'vitest';
import {
  capitalizarNome, dadosDoPrimeiroAcesso, decidirPrimeiroAcesso, perfilCompleto, validarNomes,
} from './primeiro-acesso.js';

describe('capitalizarNome', () => {
  it('só a primeira letra da frase, como o app', () => {
    expect(capitalizarNome('maria da silva')).toBe('Maria da silva');
    expect(capitalizarNome('  JOÃO  ')).toBe('João');
    expect(capitalizarNome('ávila')).toBe('Ávila');
    expect(capitalizarNome('   ')).toBe('');
  });
});

describe('validarNomes', () => {
  it('capitaliza os dois', () => {
    expect(validarNomes(' ana ', 'SOUZA lima')).toEqual({ ok: true, firstName: 'Ana', lastName: 'Souza lima' });
  });
  it('um dos dois em branco', () => {
    expect(validarNomes('Ana', '  ')).toEqual({ ok: false, mensagem: 'Por favor, preencha ambos os nomes.' });
    expect(validarNomes('', 'Souza')).toEqual({ ok: false, mensagem: 'Por favor, preencha ambos os nomes.' });
  });
  it('50 letras passa; 51 não', () => {
    expect(validarNomes('a'.repeat(50), 'b').ok).toBe(true);
    expect(validarNomes('a'.repeat(51), 'b')).toEqual({ ok: false, mensagem: 'Nome e sobrenome com no máximo 50 letras cada.' });
    expect(validarNomes('a', 'b'.repeat(51))).toEqual({ ok: false, mensagem: 'Nome e sobrenome com no máximo 50 letras cada.' });
  });
});

describe('perfilCompleto', () => {
  it('precisa dos dois nomes em texto não vazio', () => {
    expect(perfilCompleto({ firstName: 'Ana', lastName: 'Souza' })).toBe(true);
    expect(perfilCompleto({ firstName: 'Ana' })).toBe(false);
    expect(perfilCompleto({ firstName: 'Ana', lastName: '  ' })).toBe(false);
    expect(perfilCompleto({ firstName: 1, lastName: 'Souza' })).toBe(false);
    expect(perfilCompleto(null)).toBe(false);
  });
});

describe('decidirPrimeiroAcesso', () => {
  const completo = { firstName: 'Ana', lastName: 'Souza' };
  it('perfil ainda carregando: aguarda', () => {
    expect(decidirPrimeiroAcesso({ carregando: true, perfil: null, servidor: 'pendente' })).toBe('aguarda');
  });
  // Sem internet o listener entrega o perfil do cache. Quem já tem nome não vê a tela.
  it('perfil completo do listener entra mesmo sem servidor', () => {
    expect(decidirPrimeiroAcesso({ carregando: false, perfil: completo, servidor: 'falhou' })).toBe('entra');
    expect(decidirPrimeiroAcesso({ carregando: false, perfil: completo, servidor: 'pendente' })).toBe('entra');
  });
  it('perfil ausente e servidor ainda não respondeu: aguarda', () => {
    expect(decidirPrimeiroAcesso({ carregando: false, perfil: null, servidor: 'pendente' })).toBe('aguarda');
  });
  it('servidor confirma ausente ou sem nome: abre a tela', () => {
    expect(decidirPrimeiroAcesso({ carregando: false, perfil: null, servidor: 'incompleto' })).toBe('completar-nome');
    expect(decidirPrimeiroAcesso({ carregando: false, perfil: { firstName: 'Ana' }, servidor: 'incompleto' })).toBe('completar-nome');
  });
  // Documento ausente vindo só do cache nunca abre o formulário.
  it('leitura do servidor falhou: pede internet', () => {
    expect(decidirPrimeiroAcesso({ carregando: false, perfil: null, servidor: 'falhou' })).toBe('pede-internet');
  });
  it('servidor diz completo e o listener ainda não entregou: aguarda', () => {
    expect(decidirPrimeiroAcesso({ carregando: false, perfil: null, servidor: 'completo' })).toBe('aguarda');
  });
});

describe('dadosDoPrimeiroAcesso', () => {
  const agora = new Date(2026, 10, 13, 22, 0);
  const nomes = { firstName: 'Ana', lastName: 'Souza' };
  it('criação: nomes, e-mail, datas e as três flags falsas', () => {
    expect(dadosDoPrimeiroAcesso(nomes, 'ana@x.com', false, agora)).toEqual({
      firstName: 'Ana', lastName: 'Souza', displayName: 'Ana Souza', email: 'ana@x.com', updatedAt: agora,
      isAdmin: false, isAuditor: false, isMaster: false, createdAt: agora,
    });
  });
  // No update, mandar flags negaria (ou rebaixaria) quem já tem papel.
  it('documento já existe: sem flags e sem createdAt', () => {
    expect(dadosDoPrimeiroAcesso(nomes, 'ana@x.com', true, agora)).toEqual({
      firstName: 'Ana', lastName: 'Souza', displayName: 'Ana Souza', email: 'ana@x.com', updatedAt: agora,
    });
  });
});
