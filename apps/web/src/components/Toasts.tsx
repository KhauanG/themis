import { useToast, type TipoToast } from '../contexts/ToastContext.js';

const ICONE: Record<TipoToast, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
};

export function Toasts() {
  const { toasts, fechar } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast--${t.tipo}`} onClick={() => fechar(t.id)} type="button">
          <span className="toast__icone" aria-hidden="true">
            {ICONE[t.tipo]}
          </span>
          <span className="toast__texto">{t.mensagem}</span>
        </button>
      ))}
    </div>
  );
}
