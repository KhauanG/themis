import { useState, type FormEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext.js';

/** Traduz os códigos do Firebase Auth. As mensagens originais vêm em inglês. */
function mensagemDeErro(erro: unknown): string {
  const code = (erro as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'E-mail inválido.';
    case 'auth/user-disabled':
      return 'Este usuário foi desativado. Fale com o administrador.';
    // O Firebase unificou usuário inexistente e senha errada para não revelar
    // quais e-mails existem. Mensagem única aqui também.
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'E-mail ou senha incorretos.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    case 'auth/network-request-failed':
      return 'Sem conexão. O primeiro acesso precisa de internet.';
    default:
      return 'Não foi possível entrar. Tente novamente.';
  }
}

export function Login() {
  const { entrar } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setErro('');
    setEnviando(true);
    try {
      await entrar(email, senha);
    } catch (erroLogin) {
      setErro(mensagemDeErro(erroLogin));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="login">
      <form className="login__caixa" onSubmit={aoEnviar}>
        <div className="login__marca">
          <img className="login__logo" src="/icons/icon-192.png" alt="" width={64} height={64} />
          <h1 className="login__titulo">Themis</h1>
          <p className="login__sub">Contagem de estoque · Grupo Ice Beer</p>
        </div>

        <label className="campo">
          <span className="campo__rotulo">E-mail</span>
          <input
            className="campo__entrada"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            required
            autoFocus
          />
        </label>

        <label className="campo">
          <span className="campo__rotulo">Senha</span>
          <input
            className="campo__entrada"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {erro && (
          <p className="login__erro" role="alert">
            {erro}
          </p>
        )}

        <button
          className="botao botao--primario botao--g botao--largo"
          type="submit"
          disabled={enviando}
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
