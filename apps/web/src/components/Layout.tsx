import { useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { useEstoque } from '../contexts/EstoqueContext.js';
import { FaixaConexao } from './FaixaConexao.js';
import { Icone } from './Icone.js';
import { MenuPrincipal } from './MenuPrincipal.js';
import { Modal } from './Modal.js';
import { ModalFinalizar } from '../features/finalizar/ModalFinalizar.js';

interface Aba {
  para: string;
  rotulo: string;
}

export function Layout() {
  const { nome, papel, permissoes, usuario, sair } = useAuth();
  const { estoques, estoqueAtual, trocarEstoque, ciclo, progresso, online, pendentes } =
    useEstoque();

  const [menuAberto, setMenuAberto] = useState(false);
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [finalizando, setFinalizando] = useState(false);

  /**
   * As abas carregam só o que se visita repetidamente. Histórico e Usuários vivem no
   * menu: com eles aqui, um master teria cinco abas disputando a largura do celular.
   */
  const abas = useMemo<Aba[]>(() => {
    const lista: Aba[] = [{ para: '/', rotulo: 'Contagem' }];
    if (permissoes.verAuditoria) lista.push({ para: '/auditoria', rotulo: 'Auditoria' });
    if (permissoes.gerenciarProdutos) lista.push({ para: '/produtos', rotulo: 'Produtos' });
    return lista;
  }, [permissoes]);

  return (
    <div className="app">
      <header className="topo">
        <div className="topo__barra">
          <div className="topo__identidade">
            <button
              type="button"
              className="topo__estoque"
              onClick={() => setSeletorAberto(true)}
              disabled={estoques.length <= 1}
              aria-label="Trocar de estoque"
            >
              <span>{estoqueAtual?.nome ?? estoqueAtual?.id ?? 'Carregando…'}</span>
              {estoques.length > 1 && (
                <span className="topo__seta">
                  <Icone nome="seta" tamanho={1} />
                </span>
              )}
            </button>

            <p className="topo__contexto">
              <span>Ciclo {ciclo}</span>
              {progresso.total > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {progresso.contados} de {progresso.total} contados
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="topo__acoes">
            <button
              type="button"
              className="topo__botao"
              onClick={() => setMenuAberto(true)}
              aria-label="Abrir menu"
            >
              <Icone nome="menu" tamanho={1.35} />
            </button>
          </div>
        </div>

        {abas.length > 1 && (
          <nav className="navegacao" aria-label="Seções">
            <div className="navegacao__interno">
              {abas.map((aba) => (
                <NavLink
                  key={aba.para}
                  to={aba.para}
                  end={aba.para === '/'}
                  className={({ isActive }) => (isActive ? 'nav nav--ativa' : 'nav')}
                >
                  {aba.rotulo}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </header>

      <FaixaConexao />

      <main className="conteudo">
        <Outlet />
      </main>

      <MenuPrincipal
        aberto={menuAberto}
        onFechar={() => setMenuAberto(false)}
        nome={nome}
        email={usuario?.email ?? ''}
        papel={papel}
        permissoes={permissoes}
        onFinalizar={() => setFinalizando(true)}
        onTrocarEstoque={() => setSeletorAberto(true)}
        onSair={() => void sair()}
        online={online}
        pendentes={pendentes}
      />

      <Modal
        aberto={seletorAberto}
        titulo="Estoque"
        onFechar={() => setSeletorAberto(false)}
      >
        <ul className="acoes-lista">
          {estoques.map((e) => {
            const atual = e.id === estoqueAtual?.id;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className="acao"
                  onClick={() => {
                    trocarEstoque(e.id);
                    setSeletorAberto(false);
                  }}
                  aria-current={atual ? 'true' : undefined}
                >
                  <span className="acao__icone">
                    <Icone nome={atual ? 'finalizar' : 'produtos'} />
                  </span>
                  <span className="acao__texto">
                    <span className="acao__titulo">{e.nome ?? e.id}</span>
                    <span className="acao__descricao">Ciclo {e.contagemCycle ?? 1}</span>
                  </span>
                  {atual && <span className="etiqueta etiqueta--acento">Atual</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </Modal>

      <ModalFinalizar aberto={finalizando} onFechar={() => setFinalizando(false)} />
    </div>
  );
}
