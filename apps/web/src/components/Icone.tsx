/**
 * Ícones em SVG inline.
 *
 * Sem biblioteca: são 14 traçados, e qualquer pacote de ícones custaria mais que isso só
 * em peso. Herdam `currentColor`, então funcionam nos dois temas sem duplicação.
 *
 * Traço de 1.75 e pontas arredondadas — o suficiente para não sumir na tela do celular
 * sem pesar ao lado de texto de 15px.
 */

export type NomeIcone =
  | 'contagem'
  | 'auditoria'
  | 'produtos'
  | 'historico'
  | 'usuarios'
  | 'finalizar'
  | 'trocar'
  | 'sair'
  | 'menu'
  | 'codigo'
  | 'fechar'
  | 'seta'
  | 'baixar'
  | 'aviso'
  | 'lixeira';

const TRACADOS: Record<NomeIcone, string> = {
  contagem: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  auditoria: 'M3 3v18h18M7 15l4-5 3 3 5-7',
  produtos: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  historico: 'M12 8v4l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  usuarios: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 100 8 4 4 0 000-8z',
  finalizar: 'M9 12l2 2 4-4M12 3a9 9 0 100 18 9 9 0 000-18z',
  trocar: 'M7 4L3 8l4 4M3 8h13a4 4 0 014 4M17 20l4-4-4-4M21 16H8a4 4 0 01-4-4',
  sair: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M3 6h18M3 12h18M3 18h18',
  lixeira: 'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6',
  codigo: 'M3 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14',
  fechar: 'M18 6L6 18M6 6l12 12',
  seta: 'M6 9l6 6 6-6',
  baixar: 'M12 3v12M7 11l5 5 5-5M4 21h16',
  aviso: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
};

interface Props {
  nome: NomeIcone;
  /** Em `em`, para acompanhar o tamanho da fonte ao redor. */
  tamanho?: number;
}

export function Icone({ nome, tamanho = 1.15 }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={`${tamanho}em`}
      height={`${tamanho}em`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={TRACADOS[nome]} />
    </svg>
  );
}
