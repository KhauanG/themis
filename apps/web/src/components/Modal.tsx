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

/**
 * O que merece o foco ao abrir: o primeiro campo de digitação.
 *
 * **Não** o primeiro focável — esse é o botão de fechar, que vem antes no DOM por estar no
 * cabeçalho. Mandar o foco para ele ao abrir um modal de renomear é mandar o usuário para
 * o botão de cancelar a própria ação.
 */
const CAMPOS = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])';

export function Modal({ aberto, titulo, onFechar, children, rodape }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);

  /**
   * `onFechar` fora das dependências do efeito, por referência.
   *
   * Quase toda chamada passa uma arrow inline (`onFechar={() => setAberto(false)}`), que
   * ganha identidade nova a cada render do pai. Com ela nas dependências, **cada tecla
   * digitada** remontava o efeito: a limpeza devolvia o foco ao elemento de trás e a nova
   * execução o jogava no primeiro focável — o botão de fechar. No celular isso fechava o
   * teclado virtual a cada letra, e era preciso tocar no campo de novo para digitar a
   * próxima. Ver docs/armadilhas.md.
   */
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  useEffect(() => {
    if (!aberto) return;

    // Guarda quem tinha o foco para devolver no fechamento — sem isso o leitor de tela
    // volta para o topo da página e o usuário de teclado perde o lugar.
    focoAnterior.current = document.activeElement as HTMLElement | null;

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        fechar.current();
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

    // Campo primeiro; se o modal não tem nenhum, o próprio diálogo. Nunca o botão fechar.
    const alvo = caixa.current?.querySelector<HTMLElement>(CAMPOS) ?? caixa.current;
    alvo?.focus({ preventScroll: true });

    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
      focoAnterior.current?.focus({ preventScroll: true });
    };
    // Só `aberto`: ver o comentário de `fechar`. Digitar não pode remontar isto.
  }, [aberto]);

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
