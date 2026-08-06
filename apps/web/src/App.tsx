import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.js';
import { EstoqueProvider } from './contexts/EstoqueContext.js';
import { ToastProvider } from './contexts/ToastContext.js';
import { Toasts } from './components/Toasts.js';
import { Carregando } from './components/Carregando.js';
import { Layout } from './components/Layout.js';
import { Login } from './features/auth/Login.js';
import { TelaContagem } from './features/contagem/TelaContagem.js';
import { PainelAuditoria } from './features/auditoria/PainelAuditoria.js';
import { TelaProdutos } from './features/produtos/TelaProdutos.js';
import { TelaHistorico } from './features/historico/TelaHistorico.js';
import { TelaUsuarios } from './features/usuarios/TelaUsuarios.js';
import { TelaEstoques } from './features/estoques/TelaEstoques.js';
import { LimiteDeErro } from './components/LimiteDeErro.js';

/** Bloqueia a rota quando a permissão não existe. A regra do Firestore é a defesa real. */
function Protegida({ permitido, children }: { permitido: boolean; children: React.ReactNode }) {
  if (!permitido) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Rotas() {
  const { usuario, carregando, permissoes } = useAuth();

  if (carregando) return <Carregando texto="Entrando..." tela />;
  if (!usuario) return <Login />;

  return (
    <EstoqueProvider>
      <Router>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<TelaContagem />} />
            <Route
              path="auditoria"
              element={
                <Protegida permitido={permissoes.verAuditoria}>
                  <PainelAuditoria />
                </Protegida>
              }
            />
            <Route
              path="produtos"
              element={
                <Protegida permitido={permissoes.gerenciarProdutos}>
                  <TelaProdutos />
                </Protegida>
              }
            />
            <Route
              path="historico"
              element={
                <Protegida permitido={permissoes.verHistorico}>
                  <TelaHistorico />
                </Protegida>
              }
            />
            <Route
              path="estoques"
              element={
                <Protegida permitido={permissoes.gerenciarEstoque}>
                  <TelaEstoques />
                </Protegida>
              }
            />
            <Route
              path="usuarios"
              element={
                <Protegida permitido={permissoes.gerenciarUsuarios}>
                  <TelaUsuarios />
                </Protegida>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Router>
    </EstoqueProvider>
  );
}

export function App() {
  return (
    <LimiteDeErro>
      <ToastProvider>
        <AuthProvider>
          <Rotas />
          <Toasts />
        </AuthProvider>
      </ToastProvider>
    </LimiteDeErro>
  );
}
