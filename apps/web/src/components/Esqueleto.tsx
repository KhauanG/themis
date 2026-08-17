/**
 * Placeholder da lista enquanto os produtos carregam.
 *
 * Melhor que um spinner aqui: mostra de imediato o formato do que vem, então a tela não
 * "pula" quando os dados chegam. Em rede de loja isso pode levar alguns segundos.
 */
export function Esqueleto({ linhas = 5, texto }: { linhas?: number; texto?: string }) {
  return (
    <>
      {/*
        O rótulo existe porque a espera da lista de produtos pode passar de vinte segundos
        num catálogo grande em wifi de loja. Esqueleto mudo por esse tempo lê como
        travamento, e o funcionário fecha e reabre o app — que é justamente o hábito que
        estas telas existem para desfazer. `role="status"` faz o leitor de tela anunciar.
      */}
      {texto && (
        <p className="esqueleto__texto" role="status">
          {texto}
        </p>
      )}
      <ul className="lista" aria-hidden="true">
        {Array.from({ length: linhas }, (_, i) => (
          <li key={i} className="esqueleto">
            <div className="esqueleto__linha esqueleto__linha--titulo" />
            <div className="esqueleto__linha esqueleto__linha--meta" />
          </li>
        ))}
      </ul>
    </>
  );
}
