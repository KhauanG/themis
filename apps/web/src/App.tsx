/**
 * Shell inicial do Themis 2.0.
 *
 * Existe para provar que a base sobe de ponta a ponta: Firebase conecta, cache
 * persistente liga, service worker registra. As telas (contagem, produtos,
 * auditoria, validade, histórico) entram em `src/features/` conforme o plano
 * de porte — ver README.
 */
import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './lib/firebase.js';

type EstadoAuth = { carregando: true } | { carregando: false; usuario: User | null };

export function App() {
  const [estado, setEstado] = useState<EstadoAuth>({ carregando: true });

  useEffect(() => {
    return onAuthStateChanged(auth, (usuario) => setEstado({ carregando: false, usuario }));
  }, []);

  return (
    <main className="shell">
      <h1>Themis 2.0</h1>
      <p className="shell__sub">Contagem de estoque — Grupo Ice Beer</p>

      <section className="shell__status">
        <Linha rotulo="Firebase" valor="conectado" ok />
        <Linha
          rotulo="Sessão"
          valor={
            estado.carregando
              ? 'verificando…'
              : estado.usuario
                ? (estado.usuario.email ?? 'autenticado')
                : 'não autenticado'
          }
          ok={!estado.carregando && estado.usuario !== null}
        />
        <Linha
          rotulo="Service worker"
          valor={'serviceWorker' in navigator ? 'suportado' : 'indisponível'}
          ok={'serviceWorker' in navigator}
        />
        <Linha
          rotulo="Leitor de código"
          valor={'BarcodeDetector' in window ? 'nativo' : 'indisponível neste navegador'}
          ok={'BarcodeDetector' in window}
        />
      </section>
    </main>
  );
}

function Linha({ rotulo, valor, ok }: { rotulo: string; valor: string; ok: boolean }) {
  return (
    <div className="linha">
      <span className="linha__rotulo">{rotulo}</span>
      <span className={ok ? 'linha__valor linha__valor--ok' : 'linha__valor'}>{valor}</span>
    </div>
  );
}
