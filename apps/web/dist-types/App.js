import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Shell inicial do Themis 2.0.
 *
 * Existe para provar que a base sobe de ponta a ponta: Firebase conecta, cache
 * persistente liga, service worker registra. As telas (contagem, produtos,
 * auditoria, validade, histórico) entram em `src/features/` conforme o plano
 * de porte — ver README.
 */
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './lib/firebase.js';
export function App() {
    const [estado, setEstado] = useState({ carregando: true });
    useEffect(() => {
        return onAuthStateChanged(auth, (usuario) => setEstado({ carregando: false, usuario }));
    }, []);
    return (_jsxs("main", { className: "shell", children: [_jsx("h1", { children: "Themis 2.0" }), _jsx("p", { className: "shell__sub", children: "Contagem de estoque \u2014 Grupo Ice Beer" }), _jsxs("section", { className: "shell__status", children: [_jsx(Linha, { rotulo: "Firebase", valor: "conectado", ok: true }), _jsx(Linha, { rotulo: "Sess\u00E3o", valor: estado.carregando
                            ? 'verificando…'
                            : estado.usuario
                                ? (estado.usuario.email ?? 'autenticado')
                                : 'não autenticado', ok: !estado.carregando && estado.usuario !== null }), _jsx(Linha, { rotulo: "Service worker", valor: 'serviceWorker' in navigator ? 'suportado' : 'indisponível', ok: 'serviceWorker' in navigator }), _jsx(Linha, { rotulo: "Leitor de c\u00F3digo", valor: 'BarcodeDetector' in window ? 'nativo' : 'indisponível neste navegador', ok: 'BarcodeDetector' in window })] })] }));
}
function Linha({ rotulo, valor, ok }) {
    return (_jsxs("div", { className: "linha", children: [_jsx("span", { className: "linha__rotulo", children: rotulo }), _jsx("span", { className: ok ? 'linha__valor linha__valor--ok' : 'linha__valor', children: valor })] }));
}
//# sourceMappingURL=App.js.map