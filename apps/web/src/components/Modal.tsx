import { useEffect, useRef, type ReactNode } from 'react';
import { Icone } from './Icone.js';

interface Props {
  aberto: boolean;
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
}

const FOCAVEIS =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function Modal({ aberto, titulo, onFechar, children, rodape }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberto) return;

    // Guarda quem tinha o foco para devolver no fechamento — sem isso o leitor de tela
    // volta para o topo da página e o usuário de teclado perde o lugar.
    focoAnterior.current = document.activeElement as HTMLElement | null;

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onFechar();
        return;
      }
      // Prende o Tab dentro do modal: sem isso o foco escapa para a lista atrás,
      // e o usuário passa a editar campos que não consegue ver.
      if (e.key !== 'Tab' || !caixa.current) return;

      const alvos = [...caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)];
      if (alvos.length === 0) return;

      const primeiro = alvos[0]!;
      const ultimo = alvos[alvos.length - 1]!;
      const ativo = document.activeElement;

      if (e.shiftKey && ativo === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && ativo === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };

    document.addEventListener('keydown', aoTeclar);

    // Trava o scroll do fundo: no celular, rolar o modal arrastava a lista atrás dele.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const primeiroCampo = caixa.current?.querySelector<HTMLElement>(FOCAVEIS);
    (primeiroCampo ?? caixa.current)?.focus();

    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
      focoAnterior.current?.focus();
    };
  }, [aberto, onFechar]);

  if (!aberto) return null;

  return (
    <div
      className="modal-fundo"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="modal" ref={caixa} role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1}>
        <header className="modal__cabecalho">
          <h2 className="modal__titulo">{titulo}</h2>
          <button className="modal__fechar" onClick={onFechar} type="button" aria-label="Fechar">
            <Icone nome="fechar" tamanho={0.95} />
          </button>
        </header>
        <div className="modal__corpo">{children}</div>
        {rodape && <footer className="modal__rodape">{rodape}</footer>}
      </div>
    </div>
  );
}
