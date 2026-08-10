# Pendências

O que ficou de fora, com contexto suficiente para retomar sem redescobrir nada.

Cada item traz **por que não foi feito agora** e **quando passa a ser urgente** — sem isso,
uma pendência deliberada vira esquecimento acidental.

| # | Pendência | Esforço | Urgência |
|---|---|---|---|
| 1 | [Promover o CSP a bloqueio](#1-promover-o-csp-a-bloqueio) | 1 sessão de observação | baixa |
| 2 | [Criar e excluir usuário pelo app](#2-criar-e-excluir-usuário-pelo-app) | 1 sessão | baixa |
| 3 | [Normalizar as duas grafias de campo](#3-normalizar-as-duas-grafias-de-campo) | 1 sessão + varredura | baixa |

> A migração do APK para o PWA (2026-08-10) fechou três pendências de uma vez:
> `allowedInventories` virou barreira nas Security Rules, os cabeçalhos de segurança
> entraram, e dois índices mortos saíram. Registro na [CHANGELOG.md](CHANGELOG.md) §2.13.0.

---

## 1. Promover o CSP a bloqueio

**Situação.** Os cabeçalhos de segurança entraram na 2.13.0
(`apps/api/src/cabecalhos.ts`). Cinco deles bloqueiam de verdade. O **CSP está em
`Content-Security-Policy-Report-Only`**: relata no console o que *teria* bloqueado, sem
bloquear nada.

**Por que não foi feito agora.** Um CSP estrito demais quebra o app inteiro, para todo
mundo, na hora. A lista de origens do Firebase é longa e frágil, e acertá-la de primeira sem
observar o uso real é aposta.

**Como fazer.**

1. Usar o app um ou dois dias exercitando **tudo**: contar, ler código de barras, exportar
   PDF, exportar planilha, corrigir estoque, trabalhar offline e reconectar.
2. Olhar o console do navegador. Cada violação relatada é uma origem que falta na lista.
3. Console limpo → trocar `MODO_RELATO` para `false` em `apps/api/src/cabecalhos.ts`.

### Armadilhas conhecidas do CSP aqui

- **Firebase precisa de vários domínios** em `connect-src`: `*.googleapis.com`,
  `*.firebaseio.com`, `firestore.googleapis.com`, `identitytoolkit.googleapis.com`,
  `securetoken.googleapis.com`, e `wss:` para o canal de tempo real
- **`blob:` em `img-src` e `worker-src`** — PDF e planilha são entregues como blob, e o
  leitor de código de barras usa blob no vídeo
- **`worker-src 'self' blob:`** — senão o service worker não registra e o offline morre
- **`style-src` precisa de `'unsafe-inline'`** — usamos `style={{...}}` na barra de
  progresso (`TelaContagem`) e nas etiquetas do histórico (`TelaHistorico`). Alternativa:
  trocar por variáveis CSS e apertar o `style-src`
- Errar qualquer um destes com o CSP bloqueando = **tela branca em produção, para todos, na
  hora**

**Quando fica urgente.** Se o app passar a ser acessível fora da rede da empresa, ou se
algum campo de texto passar a aceitar conteúdo de fora sem passar pelo React.

---

## 2. Criar e excluir usuário pelo app

**Situação.** A tela de usuários (`features/usuarios/`) troca papéis, mas criar e excluir
conta continua no Console do Firebase.

**Por que não foi feito agora.** Criar usuário exige o **Firebase Admin SDK**, que precisa
de service account — um segredo novo no servidor, com poder total sobre o projeto. Não
valia introduzir isso para uma operação que acontece poucas vezes por ano.

**Como fazer.**

1. Service account no servidor, fora do repositório, com permissão mínima
2. Rota `POST /api/usuarios` na API, **só para master** (verificar o ID token no servidor,
   não confiar no cliente)
3. Criar no Auth e o documento em `users/{uid}` na mesma operação — usuário no Auth sem
   documento em `users` entra no app como comum e ninguém entende por quê
4. Excluir precisa apagar nos dois lugares

⚠️ Hoje **nenhum segredo com poder administrativo** existe no servidor. Isso é uma
qualidade, não um acaso: se a hospedagem for comprometida, o atacante não ganha controle do
projeto Firebase. Introduzir o Admin SDK muda esse cálculo — pese antes.

⚠️ Desde a 2.13.0 há um efeito novo: usuário no Auth **sem** documento em `users/` passa em
`podeAcessarEstoque` (é uma das três portas abertas, para não trancar ninguém fora). Criar
conta sem criar o documento não é mais só confuso — é permissivo.

**Quando fica urgente.** Se a rotatividade da equipe crescer a ponto de o Console virar
gargalo.

---

## 3. Normalizar as duas grafias de campo

**Situação.** O banco guarda o mesmo dado em duas grafias, herdadas do 1.x: `nome` e
`NomeProduto`, `codigoBarras` e `CodigoBarras`, `estoqueSistema` e `EstoqueAtual`. O 2.0
**lê as duas e grava as duas**.

**Por que não foi feito na 2.13.0.** O 1.x saiu do ar, mas os **dados** dele continuam.
Parar de gravar a grafia antiga criaria documentos novos incompatíveis com os antigos, que
seguem no acervo — inconsistência sem ganho. Só faz sentido junto de uma passada que
normalize o que já existe.

**Como fazer, nesta ordem:**

1. Script de varredura (nos moldes de `auditar-produtos.mjs`) que reporte quantos documentos
   têm cada grafia, e **quantos têm as duas divergindo entre si** — este último número é o
   que decide se dá para escolher uma cegamente.
2. Migração em lote: grava a grafia canônica, remove a legada.
3. Só então: parar de gravar a legada no app, e simplificar `nomeDe`, `codigoBarrasDe` e
   `sistemaDe` em `packages/shared/src/produto.ts`.

⚠️ A leitura tolerante precisa continuar até o passo 2 terminar **e** ser conferida. É ela
que impede o produto de aparecer sem nome na tela do funcionário.

**Quando fica urgente.** Não fica. É dívida cosmética: custa alguns bytes por documento e um
`??` em três funções. O ganho é legibilidade, não comportamento.

**O que mais vai junto.** A tolerância a flags legadas em `papelDe()` (`isAuditor` como
`true`, `"true"` ou `1`) tem o mesmo formato de problema e cabe na mesma migração.

---

## Como usar este documento

- Ao concluir um item, mova o registro para o [CHANGELOG.md](CHANGELOG.md) e apague daqui
- Ao decidir **não** fazer, mova para [decisoes.md](decisoes.md) com o motivo — pendência
  descartada em silêncio volta como ideia nova seis meses depois
- Ao adicionar, siga o formato: situação, por que não agora, como fazer, armadilhas, quando
  fica urgente
