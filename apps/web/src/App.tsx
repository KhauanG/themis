import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.js';
import { EstoqueProvider, useEstoque } from './contexts/EstoqueContext.js';
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

/**
 * Segura a abertura do app até a lista de estoques chegar.
 *
 * Sem isto havia um vão: o login terminava, o `EstoqueProvider` montava com a lista vazia,
 * e como ainda não existia `estoqueId` o efeito dos produtos nem chegava a ligar
 * `carregandoProdutos`. A tela de contagem caía direto no estado vazio e mostrava
 * **"nenhum produto"** para quem só estava esperando o app abrir — em rede de loja, por
 * vários segundos.
 *
 * Cobre os três momentos em que o app monta do zero: primeira abertura, recarregar a
 * página, e voltar depois de o sistema ter matado o app em segundo plano. Voltar de um app
 * apenas suspenso **não** passa por aqui, e não deve mesmo: o React não remonta, os dados
 * já estão na tela, e cobri-los com um carregando seria piscar à toa. Aquele caso é do
 * `assinatura.ts`, que reabre o listener se ele tiver caído.
 */
function AguardaEstoques({ children }: { children: React.ReactNode }) {
  const { carregandoEstoques, estoques } = useEstoque();
  const { permissoes } = useAuth();

  if (carregandoEstoques) return <Carregando texto="Carregando estoques..." tela />;

  /*
    Sem estoque não há o que contar, e a tela de contagem vazia não explica por quê.

    ⚠️ Só para quem NÃO pode criar estoque. Quem pode precisa atravessar para chegar em
    Estoques e criar o primeiro — barrar aqui trancaria o master fora do próprio app num
    projeto novo, sem outra saída além do Console do Firebase.
  */
  if (estoques.length === 0 && !permissoes.gerenciarEstoque) {
    return (
      <main className="login">
        <div className="login__caixa">
          <div className="login__marca">
            <img className="login__logo" src="/icons/icon-192.png" alt="" width={64} height={64} />
            <h1 className="login__titulo">Nenhum estoque</h1>
          </div>
          <p className="aviso" role="status">
            Seu usuário não tem nenhum estoque liberado. Peça a um administrador para liberar
            o acesso em <strong>Usuários</strong>.
          </p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}

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
      <AguardaEstoques>
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
      </AguardaEstoques>
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
