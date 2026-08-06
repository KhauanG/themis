import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROTULO_PAPEL, type Papel, type Permissoes } from '@themis/shared';
import { Icone, type NomeIcone } from './Icone.js';

interface ItemMenu {
  id: string;
  icone: NomeIcone;
  titulo: string;
  descricao: string;
  /** Rota para navegar, ou ação a executar. */
  rota?: string;
  acao?: () => void;
  perigo?: boolean;
}

interface Grupo {
  rotulo: string;
  itens: ItemMenu[];
}

interface Props {
  aberto: boolean;
  onFechar: () => void;
  nome: string;
  email: string;
  papel: Papel;
  permissoes: Permissoes;
  onFinalizar: () => void;
  onTrocarEstoque: () => void;
  onSair: () => void;
  online: boolean;
  pendentes: number;
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0]![0] ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1]![0] ?? '') : '';
  return (primeira + ultima).toUpperCase();
}

/**
 * Menu principal, em folha.
 *
 * É o mapa completo do app: tudo que o usuário pode fazer aparece aqui, agrupado por
 * finalidade. As abas do topo carregam só o que se visita repetidamente — sem isso, um
 * master teria cinco abas disputando espaço num celular.
 *
 * Os grupos são montados a partir das permissões: o menu de um funcionário comum não tem
 * seções desabilitadas nem cadeados, simplesmente não tem o que ele não pode fazer.
 * Item que não se aplica é ruído, não informação.
 */
export function MenuPrincipal({
  aberto,
  onFechar,
  nome,
  email,
  papel,
  permissoes,
  onFinalizar,
  onTrocarEstoque,
  onSair,
  online,
  pendentes,
}: Props) {
  const navegar = useNavigate();
  const caixa = useRef<HTMLDivElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberto) return;

    focoAnterior.current = document.activeElement as HTMLElement | null;

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    document.addEventListener('keydown', aoTeclar);

    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    caixa.current?.querySelector<HTMLElement>('button, a')?.focus();

    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
      focoAnterior.current?.focus();
    };
  }, [aberto, onFechar]);

  if (!aberto) return null;

  const grupos: Grupo[] = [];

  if (permissoes.finalizarContagem) {
    grupos.push({
      rotulo: 'Contagem',
      itens: [
        {
          id: 'finalizar',
          icone: 'finalizar',
          titulo: 'Finalizar e salvar',
          descricao: 'Fecha o ciclo e grava a auditoria',
          acao: onFinalizar,
        },
        {
          id: 'trocar',
          icone: 'trocar',
          titulo: 'Trocar estoque',
          descricao: 'Escolher outro depósito ou loja',
          acao: onTrocarEstoque,
        },
      ],
    });
  }

  const relatorios: ItemMenu[] = [];
  if (permissoes.verAuditoria) {
    relatorios.push({
      id: 'auditoria',
      icone: 'auditoria',
      titulo: 'Auditoria',
      descricao: 'Divergências, conferência e exportações',
      rota: '/auditoria',
    });
  }
  if (permissoes.verHistorico) {
    relatorios.push({
      id: 'historico',
      icone: 'historico',
      titulo: 'Histórico',
      descricao: 'Quem fez o quê, e quando',
      rota: '/historico',
    });
  }
  if (relatorios.length > 0) grupos.push({ rotulo: 'Relatórios', itens: relatorios });

  const gestao: ItemMenu[] = [];
  if (permissoes.gerenciarProdutos) {
    gestao.push({
      id: 'produtos',
      icone: 'produtos',
      titulo: 'Produtos',
      descricao: 'Cadastro, planilha, corrigir estoque e limpeza',
      rota: '/produtos',
    });
  }
  if (permissoes.gerenciarEstoque) {
    gestao.push({
      id: 'estoques',
      icone: 'trocar',
      titulo: 'Estoques',
      descricao: 'Criar, renomear e excluir depósitos e lojas',
      rota: '/estoques',
    });
  }
  if (permissoes.gerenciarUsuarios) {
    gestao.push({
      id: 'usuarios',
      icone: 'usuarios',
      titulo: 'Usuários',
      descricao: 'Papéis e permissões da equipe',
      rota: '/usuarios',
    });
  }
  if (gestao.length > 0) grupos.push({ rotulo: 'Gestão', itens: gestao });

  grupos.push({
    rotulo: 'Conta',
    itens: [
      {
        id: 'sair',
        icone: 'sair',
        titulo: 'Sair',
        descricao: 'Encerrar a sessão neste aparelho',
        acao: onSair,
        perigo: true,
      },
    ],
  });

  function acionar(item: ItemMenu) {
    onFechar();
    if (item.rota) navegar(item.rota);
    else item.acao?.();
  }

  return (
    <div
      className="menu-fundo"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="menu" ref={caixa} role="dialog" aria-modal="true" aria-label="Menu">
        <div className="menu__alca" aria-hidden="true" />

        <header className="menu__usuario">
          <span className="menu__avatar" aria-hidden="true">
            {iniciais(nome)}
          </span>
          <div className="menu__dados">
            <p className="menu__nome">{nome}</p>
            <p className="menu__email">{email}</p>
          </div>
          <span className="etiqueta etiqueta--acento">{ROTULO_PAPEL[papel]}</span>
        </header>

        <div className="menu__lista">
          {grupos.map((grupo) => (
            <section key={grupo.rotulo}>
              <p className="menu__grupo rotulo-secao">{grupo.rotulo}</p>
              {grupo.itens.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.perigo ? 'menu__item menu__item--perigo' : 'menu__item'}
                  onClick={() => acionar(item)}
                >
                  <span className="menu__icone">
                    <Icone nome={item.icone} />
                  </span>
                  <span className="menu__texto">
                    {item.titulo}
                    <span className="menu__descricao">{item.descricao}</span>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>

        <footer className="menu__rodape">
          <span>Themis 2.0</span>
          <span>
            {online
              ? pendentes > 0
                ? `${pendentes} aguardando envio`
                : 'Sincronizado'
              : 'Sem conexão'}
          </span>
        </footer>
      </div>
    </div>
  );
}
