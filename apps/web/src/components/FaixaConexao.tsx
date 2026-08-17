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
  const { online, pendentes, sincronizar, contatoPerdido } = useEstoque();

  /*
    Contato perdido vem antes de tudo, inclusive de "sem conexão".

    É o estado mais perigoso dos três: o app *acha* que está conectado, mas a inscrição em
    tempo real caiu e a tela pode estar mostrando dado de meia hora atrás. Offline pelo
    menos o usuário sabe. Este era invisível, e a única saída conhecida era reabrir o app.
  */
  if (contatoPerdido) {
    return (
      <div className="faixa faixa--pendente" role="alert">
        <span>Sem atualização em tempo real — os dados podem estar desatualizados</span>
        <button className="faixa__acao" type="button" onClick={() => window.location.reload()}>
          Recarregar
        </button>
      </div>
    );
  }

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
