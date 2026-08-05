import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type TipoToast = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  mensagem: string;
  tipo: TipoToast;
}

interface ToastAPI {
  mostrar: (mensagem: string, tipo?: TipoToast) => void;
  toasts: Toast[];
  fechar: (id: number) => void;
}

const Ctx = createContext<ToastAPI | null>(null);

const DURACAO: Record<TipoToast, number> = {
  success: 3_000,
  info: 4_000,
  warning: 6_000,
  // Erro fica mais tempo: costuma pedir ação do usuário.
  error: 8_000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const proximoId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const fechar = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((atuais) => atuais.filter((t) => t.id !== id));
  }, []);

  const mostrar = useCallback(
    (mensagem: string, tipo: TipoToast = 'info') => {
      const id = proximoId.current++;
      // Limite de 3: numa importação de planilha com erro, dezenas de toasts
      // empilhados cobriam a tela inteira.
      setToasts((atuais) => [...atuais.slice(-2), { id, mensagem, tipo }]);
      timers.current.set(
        id,
        setTimeout(() => fechar(id), DURACAO[tipo]),
      );
    },
    [fechar],
  );

  const valor = useMemo(() => ({ mostrar, toasts, fechar }), [mostrar, toasts, fechar]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useToast(): ToastAPI {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>');
  return ctx;
}
