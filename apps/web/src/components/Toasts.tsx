import { useToast } from '../contexts/ToastContext.js';

/**
 * Avisos flutuantes.
 *
 * A cor fica num ponto de 8px, não no fundo do aviso: fundo colorido em tela cheia
 * compete com as etiquetas de status dos produtos, que é onde a cor precisa significar
 * alguma coisa.
 */
export function Toasts() {
  const { toasts, fechar } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast toast--${t.tipo}`}
          onClick={() => fechar(t.id)}
          type="button"
        >
          <span className="toast__marca" aria-hidden="true" />
          <span>{t.mensagem}</span>
        </button>
      ))}
    </div>
  );
}
