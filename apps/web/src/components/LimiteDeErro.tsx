import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  erro: Error | null;
}

/**
 * Captura erro de renderização.
 *
 * Sem isto, um erro em qualquer componente desmonta a árvore inteira e o funcionário vê
 * uma tela branca no meio da contagem, sem saber se o que contou foi salvo. Aqui ele ao
 * menos recebe a informação de que os dados estão no aparelho e um botão para recarregar.
 *
 * Precisa ser classe: React não expõe `componentDidCatch` para componentes de função.
 */
export class LimiteDeErro extends Component<Props, State> {
  override state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  override componentDidCatch(erro: Error, info: ErrorInfo): void {
    console.error('[app] Erro de renderização:', erro, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.erro) return this.props.children;

    return (
      <main className="falha" role="alert">
        <h1 className="falha__titulo">Algo quebrou nesta tela</h1>
        <p>
          Suas contagens estão salvas no aparelho e serão enviadas normalmente. Recarregar
          costuma resolver.
        </p>
        <button
          className="botao botao--primario botao--g botao--largo"
          type="button"
          onClick={() => window.location.reload()}
        >
          Recarregar
        </button>
        <details className="falha__detalhe">
          <summary>Detalhe técnico</summary>
          <pre>{this.state.erro.message}</pre>
        </details>
      </main>
    );
  }
}
