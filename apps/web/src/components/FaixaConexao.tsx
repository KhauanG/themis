import { useEstoque } from '../contexts/EstoqueContext.js';

/**
 * Faixa fina de estado da conexão.
 *
 * Não bloqueia nada de propósito: contar offline é caso de uso normal, não erro. O 1.x
 * cobria a tela com um aviso, e isso atrapalhava exatamente quem estava trabalhando.
 *
 * Some quando está tudo em dia — faixa permanente vira mobília e ninguém mais lê.
 */
export function FaixaConexao() {
  const { online, pendentes, sincronizar } = useEstoque();

  if (online && pendentes === 0) return null;

  const plural = pendentes === 1 ? 'alteração' : 'alterações';

  return (
    <div className={online ? 'faixa faixa--pendente' : 'faixa faixa--offline'} role="status">
      {online ? (
        <>
          <span>
            {pendentes} {plural} aguardando envio
          </span>
          <button className="faixa__acao" type="button" onClick={() => void sincronizar()}>
            Enviar agora
          </button>
        </>
      ) : (
        <span>
          Sem conexão — pode continuar contando
          {pendentes > 0 && ` · ${pendentes} na fila`}
        </span>
      )}
    </div>
  );
}
