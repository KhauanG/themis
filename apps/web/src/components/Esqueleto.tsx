/**
 * Placeholder da lista enquanto os produtos carregam.
 *
 * Melhor que um spinner aqui: mostra de imediato o formato do que vem, então a tela não
 * "pula" quando os dados chegam. Em rede de loja isso pode levar alguns segundos.
 */
export function Esqueleto({ linhas = 5 }: { linhas?: number }) {
  return (
    <ul className="lista" aria-hidden="true">
      {Array.from({ length: linhas }, (_, i) => (
        <li key={i} className="esqueleto">
          <div className="esqueleto__linha esqueleto__linha--titulo" />
          <div className="esqueleto__linha esqueleto__linha--meta" />
        </li>
      ))}
    </ul>
  );
}
