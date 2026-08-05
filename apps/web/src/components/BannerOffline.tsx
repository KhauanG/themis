import { useEstoque } from '../contexts/EstoqueContext.js';

/**
 * Faixa fina de aviso. Diferente do 1.x, não existe overlay bloqueando a tela: contar
 * offline é caso de uso normal, não erro. O banner informa sem atrapalhar.
 */
export function BannerOffline() {
  const { online, pendentes, sincronizar } = useEstoque();

  if (online && pendentes === 0) return null;

  return (
    <div className={online ? 'banner banner--pendente' : 'banner banner--offline'} role="status">
      {online ? (
        <>
          <span>
            {pendentes} {pendentes === 1 ? 'alteração aguardando envio' : 'alterações aguardando envio'}
          </span>
          <button className="banner__acao" type="button" onClick={() => void sincronizar()}>
            Enviar agora
          </button>
        </>
      ) : (
        <span>
          Sem conexão — pode continuar contando
          {pendentes > 0 && ` (${pendentes} na fila)`}
        </span>
      )}
    </div>
  );
}
