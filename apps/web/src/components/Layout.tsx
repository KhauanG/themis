import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ROTULO_PAPEL } from '@themis/shared';
import { useAuth } from '../contexts/AuthContext.js';
import { useEstoque } from '../contexts/EstoqueContext.js';
import { BannerOffline } from './BannerOffline.js';
import { ModalFinalizar } from '../features/finalizar/ModalFinalizar.js';

export function Layout() {
  const { nome, papel, permissoes, sair } = useAuth();
  const { estoques, estoqueAtual, trocarEstoque, ciclo, progresso } = useEstoque();
  const [finalizando, setFinalizando] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="app">
      <header className="topo">
        <div className="topo__linha">
          <select
            className="topo__estoque"
            value={estoqueAtual?.id ?? ''}
            onChange={(e) => trocarEstoque(e.target.value)}
            aria-label="Estoque"
          >
            {estoques.length === 0 && <option value="">Carregando...</option>}
            {estoques.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome ?? e.id}
              </option>
            ))}
          </select>

          <button
            className="topo__menu"
            type="button"
            onClick={() => setMenuAberto((a) => !a)}
            aria-expanded={menuAberto}
            aria-label="Menu"
          >
            ☰
          </button>
        </div>

        <p className="topo__ciclo">
          Ciclo {ciclo}
          {progresso.total > 0 && (
            <>
              {' · '}
              {progresso.contados}/{progresso.total} contados
            </>
          )}
        </p>

        {menuAberto && (
          <div className="menu">
            <p className="menu__usuario">
              {nome}
              <span className="menu__papel">{ROTULO_PAPEL[papel]}</span>
            </p>

            {permissoes.finalizarContagem && (
              <button
                className="menu__item"
                type="button"
                onClick={() => {
                  setMenuAberto(false);
                  setFinalizando(true);
                }}
              >
                Finalizar e salvar contagem
              </button>
            )}

            <button className="menu__item menu__item--sair" type="button" onClick={() => void sair()}>
              Sair
            </button>
          </div>
        )}
      </header>

      <BannerOffline />

      <nav className="navegacao" aria-label="Seções">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav nav--ativa' : 'nav')}>
          Contagem
        </NavLink>
        {permissoes.verAuditoria && (
          <NavLink to="/auditoria" className={({ isActive }) => (isActive ? 'nav nav--ativa' : 'nav')}>
            Auditoria
          </NavLink>
        )}
        {permissoes.gerenciarProdutos && (
          <NavLink to="/produtos" className={({ isActive }) => (isActive ? 'nav nav--ativa' : 'nav')}>
            Produtos
          </NavLink>
        )}
        {permissoes.verHistorico && (
          <NavLink to="/historico" className={({ isActive }) => (isActive ? 'nav nav--ativa' : 'nav')}>
            Histórico
          </NavLink>
        )}
        {permissoes.gerenciarUsuarios && (
          <NavLink to="/usuarios" className={({ isActive }) => (isActive ? 'nav nav--ativa' : 'nav')}>
            Usuários
          </NavLink>
        )}
      </nav>

      <main className="conteudo">
        <Outlet />
      </main>

      <ModalFinalizar aberto={finalizando} onFechar={() => setFinalizando(false)} />
    </div>
  );
}
