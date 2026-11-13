import { useState, type FormEvent } from 'react';
import { LIMITE_NOME_PERFIL, validarNomes } from '@themis/shared';
import { useAuth } from '../../contexts/AuthContext.js';
import { mensagemDoPrimeiroAcesso } from '../../lib/gestao-escrita.js';
import { completarPerfil } from '../../lib/usuarios-repo.js';

/**
 * Quem entrava só pelo site nunca ganhava documento em `users`. Esta tela só abre quando o
 * servidor confirmou que o perfil não existe ou está sem nome (ver `decidirPrimeiroAcesso`).
 */
export function PrimeiroAcesso() {
  const { usuario, sair, tentarPerfilDeNovo } = useAuth();
  const [nome, setNome] = useState('');
  const [sobrenome, setSobrenome] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    if (salvando || !usuario) return;
    setErro('');
    const v = validarNomes(nome, sobrenome);
    if (!v.ok) {
      setErro(v.mensagem);
      return;
    }
    setSalvando(true);
    try {
      await completarPerfil(usuario.uid, usuario.email ?? '', v.firstName, v.lastName);
      tentarPerfilDeNovo();
    } catch (erroGravacao) {
      setErro(mensagemDoPrimeiroAcesso(erroGravacao));
      setSalvando(false);
    }
  }

  return (
    <main className="login">
      <form className="login__caixa" onSubmit={aoEnviar}>
        <div className="login__marca">
          <img className="login__logo" src="/icons/icon-192.png" alt="" width={64} height={64} />
          <h1 className="login__titulo">Como você se chama?</h1>
          <p className="login__sub">Seu nome aparece nas contagens que você fizer.</p>
        </div>

        <label className="campo">
          <span className="campo__rotulo">Nome</span>
          <input
            className="campo__entrada"
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoComplete="given-name"
            maxLength={LIMITE_NOME_PERFIL}
            autoFocus
          />
        </label>

        <label className="campo">
          <span className="campo__rotulo">Sobrenome</span>
          <input
            className="campo__entrada"
            type="text"
            value={sobrenome}
            onChange={(e) => setSobrenome(e.target.value)}
            autoComplete="family-name"
            maxLength={LIMITE_NOME_PERFIL}
          />
        </label>

        {erro && (
          <p className="login__erro" role="alert">
            {erro}
          </p>
        )}

        <button className="botao botao--primario botao--g botao--largo" type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Confirmar'}
        </button>
        <button className="botao botao--secundario botao--largo" type="button" onClick={() => void sair()}>
          Sair
        </button>
      </form>
    </main>
  );
}

/** Sem resposta do servidor e sem perfil confirmado: o site não entra nem abre o formulário. */
export function PerfilIndisponivel() {
  const { sair, tentarPerfilDeNovo } = useAuth();
  return (
    <main className="login">
      <div className="login__caixa">
        <div className="login__marca">
          <img className="login__logo" src="/icons/icon-192.png" alt="" width={64} height={64} />
          <h1 className="login__titulo">Themis</h1>
        </div>
        <p className="aviso" role="alert">
          Não foi possível carregar seu perfil. Conecte-se à internet e tente novamente.
        </p>
        <button className="botao botao--primario botao--g botao--largo" type="button" onClick={tentarPerfilDeNovo}>
          Tentar de novo
        </button>
        <button className="botao botao--secundario botao--largo" type="button" onClick={() => void sair()}>
          Sair
        </button>
      </div>
    </main>
  );
}
