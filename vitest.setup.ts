import { afterEach } from 'vitest';

// Em 2026-10-28 um teste mandou uma requisição de verdade ao ERP de produção.
declare global {
  var hostsBloqueados: string[];
}
globalThis.hostsBloqueados = [];

// Atribuição direta, não `vi.stubGlobal`: assim o `unstubAllGlobals` volta para a guarda.
// A mensagem leva só o host, porque a URL do ERP leva o hash.
globalThis.fetch = async function fetchSemRede(entrada: RequestInfo | URL): Promise<Response> {
  const texto = entrada instanceof Request ? entrada.url : String(entrada);
  const host = URL.canParse(texto) ? new URL(texto).host : texto;
  globalThis.hostsBloqueados.push(host);
  throw new Error(`Teste tentou acessar a rede sem fetch falso (${host}).`);
};

// O código do ERP captura o erro de rede e responde 502. Sem isto, o teste falharia por
// outro motivo, ou até passaria.
afterEach(() => {
  const hosts = globalThis.hostsBloqueados.splice(0);
  if (hosts.length > 0) {
    throw new Error(
      `Teste tentou acessar a rede sem fetch falso: ${hosts.join(', ')}. Use vi.stubGlobal('fetch', ...).`,
    );
  }
});
