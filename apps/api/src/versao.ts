/**
 * Identidade do build da API.
 *
 * Os valores são gravados pelo esbuild (`define` em `build.mjs`) na hora de empacotar. Em
 * desenvolvimento (`tsx`) esses símbolos não existem, então há um fallback — sem ele o
 * `npm run dev:api` morreria no primeiro import com `__VERSAO__ is not defined`.
 *
 * Serve para responder **de fora** qual código está no ar:
 *
 *   curl https://o-dominio/api/versao
 *
 * Antes disso, `/api/health` devolvia `'2.0.0'` escrito à mão, que ficou parado enquanto o
 * projeto ia para 2.6.x. Número que não acompanha o código é pior que número nenhum:
 * responde com confiança a pergunta errada.
 */
declare const __VERSAO__: string | undefined;
declare const __COMMIT__: string | undefined;
declare const __DATA_BUILD__: string | undefined;

function ou(valor: string | undefined, padrao: string): string {
  return typeof valor === 'string' ? valor : padrao;
}

export const VERSAO = ou(typeof __VERSAO__ === 'undefined' ? undefined : __VERSAO__, 'dev');
export const COMMIT = ou(typeof __COMMIT__ === 'undefined' ? undefined : __COMMIT__, 'dev');
export const DATA_BUILD = ou(
  typeof __DATA_BUILD__ === 'undefined' ? undefined : __DATA_BUILD__,
  new Date().toISOString(),
);
