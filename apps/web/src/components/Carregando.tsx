interface Props {
  texto?: string;
  /** Cobre a tela inteira. Use só em operação que realmente bloqueia o uso. */
  tela?: boolean;
}

export function Carregando({ texto = 'Carregando...', tela = false }: Props) {
  return (
    <div className={tela ? 'carregando carregando--tela' : 'carregando'} role="status" aria-live="polite">
      <span className="carregando__giro" aria-hidden="true" />
      <span>{texto}</span>
    </div>
  );
}
