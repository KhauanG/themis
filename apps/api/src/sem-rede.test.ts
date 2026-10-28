import { describe, expect, it, vi } from 'vitest';

// Em 2026-10-28 um teste mandou uma requisição de verdade ao ERP de produção.
// `.invalid` nunca resolve: é a segunda proteção, se a guarda sumir.
describe('testes sem rede', () => {
  it('a guarda está ligada', () => {
    expect(globalThis.fetch.name).toBe('fetchSemRede');
    globalThis.hostsBloqueados.splice(0);
  });

  it('fetch sem falso falha em vez de sair para a rede', async () => {
    expect(globalThis.fetch.name).toBe('fetchSemRede');
    await expect(fetch('https://erp.invalid/apiv1/x')).rejects.toThrow(
      'Teste tentou acessar a rede sem fetch falso (erp.invalid).',
    );
    expect(globalThis.hostsBloqueados).toEqual(['erp.invalid']);
    globalThis.hostsBloqueados.splice(0);
  });

  it('unstubAllGlobals volta para a guarda, não para o fetch real', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
    vi.unstubAllGlobals();
    expect(globalThis.fetch.name).toBe('fetchSemRede');
    await expect(fetch('https://exemplo.invalid/')).rejects.toThrow('sem fetch falso');
    globalThis.hostsBloqueados.splice(0);
  });

  // O código do ERP engole o erro de rede e responde 502: só o afterEach da guarda pega isso.
  // O `fails` do Vitest 2.1.9 vira o resultado depois dos afterEach (@vitest/runner, dist/index.js:1085-1123).
  it.fails('fetch sem falso engolido pelo código ainda falha o teste', async () => {
    if (globalThis.fetch.name !== 'fetchSemRede') return; // sem guarda: passa, e o it.fails acusa sem sair para a rede
    await fetch('https://erp.invalid/apiv1/x').catch(() => undefined);
  });
});
