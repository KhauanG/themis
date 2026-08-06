# Deploy do Themis 2.0

Passo a passo do zero até o app no ar, com deploy automático a cada `push` na `main`.

Faça na ordem. Cada passo assume o anterior concluído.

> **Qual terminal.** Blocos marcados `powershell` rodam no seu PC, **uma linha por vez**.
> O Windows PowerShell 5.1 **não aceita `&&`** — colar uma linha com `&&` devolve
> `O token '&&' não é um separador de instruções válido nesta versão`. Onde é preciso
> encadear, existe um script npm (dentro deles o `&&` funciona, porque o npm executa via
> `cmd.exe`).

## Como o deploy funciona

A Hostinger publica o app Node **direto do GitHub**: a cada push na `main` ela clona,
roda o build e reinicia o processo.

Um único processo Node atende tudo:

```
themis.grupoicebeer.com.br
├── /            → PWA (apps/web/dist, servido pelo Fastify)
└── /api/*       → API (proxy do ERP, webhook, health)
```

Mesma origem tem consequências boas: nenhum preflight de CORS no caminho da contagem,
`/api` resolve sem configurar nada, e não existe passo de rsync nem chave SSH de deploy.

O `.github/workflows/deploy.yml` (deploy por SSH) fica **desativado**, só com disparo
manual, como plano B caso a integração da Hostinger falhe. O `ci.yml` continua rodando
typecheck, lint e testes em cada PR.

---

## Antes de começar

Tenha em mãos:

- Conta GitHub com acesso para criar repositório privado
- Acesso ao hPanel da Hostinger (Business Premium, com Node.js)
- Subdomínio para o app (ex.: `themis.grupoicebeer.com.br`)
- Acesso de Editor/Owner no projeto Firebase `auditoria-icebeer`

Confira que a base está sã antes de publicar qualquer coisa:

```powershell
cd "C:\Projetos\Themis 2.0"
npm ci
npm run verificar
```

`verificar` roda typecheck, lint, testes e build em sequência e para no primeiro erro.
Se falhar, **pare** — não publique.

---

## Passo 1 — Repositório no GitHub

**1.1** Crie o repositório em <https://github.com/new>:

- Nome: `themis`
- Visibilidade: **Private**
- **Não** marque "Add a README", "Add .gitignore" nem licença — o repositório local já
  tem o histórico, e um commit inicial do GitHub causaria conflito no primeiro push

**1.2** Ligue o local ao remoto e envie:

```powershell
cd "C:\Projetos\Themis 2.0"
git remote add origin https://github.com/SEU-USUARIO/themis.git
git push -u origin main
```

**1.3** Confirme que nenhum segredo subiu:

```powershell
git ls-files | Select-String "\.env$"
```

Não pode retornar nada. Os `.env.example` sobem; os `.env` reais, não.

**1.4** Crie a branch de trabalho — a `main` passa a ser só o que está publicado:

```powershell
git checkout -b desenvolvimento
git push -u origin desenvolvimento
```

Proteja a `main` (Settings → Branches → Add rule): exigir pull request e exigir que o job
`verificar` do CI passe. **Push direto na `main` publica em produção.**

---

## Passo 2 — Firestore

O banco é o mesmo do Themis 1.x. **Nenhuma migração de dados.**

**2.1** Autentique a CLI:

```powershell
cd "C:\Projetos\Themis 2.0"
npx firebase-tools login
```

> **Por que `npx`.** No Windows o `npm install -g` instala em `%APPDATA%\npm`, que
> frequentemente **não está no PATH** — aí `firebase` devolve
> `O termo 'firebase' não é reconhecido...` mesmo com a instalação tendo dado certo.

**2.2** Compare `firestore/firestore.rules` com o Console (Firestore → Regras). Deve ser
idêntico. Se divergir, alguém editou por lá e **a versão do Console é a verdadeira**.

**2.3** Publique os índices:

```powershell
npx firebase-tools deploy --only firestore:indexes
```

> **Se a CLI perguntar "Would you like to delete these indexes?", responda `N`.**
> Ela oferece apagar índices que existem no projeto mas não estão no arquivo. Responder
> `y` apaga índice em produção. Se a pergunta aparecer, alguém criou índice pelo Console:
> traga-o para `firestore/firestore.indexes.json`. Detalhes em `firestore/README.md`.

Acompanhe em Firestore → Índices. Só teste o Histórico quando ficarem **Ativado**.

**2.4** As regras, **só se realmente divergirem**:

```powershell
npx firebase-tools deploy --only firestore:rules
```

> Publicar regra afeta os usuários do app 1.x **na hora**. O Console tem histórico de
> versões com rollback.

**2.5 Varredura de produtos legados — faça antes de liberar para a equipe**

`validProductData` valida o documento **resultante** de qualquer update. Um produto antigo
com `corrigidoIncorreto: null` ou `lastModified` gravado como texto faz o funcionário
receber permission-denied ao contar, mesmo sem encostar nesse campo. O sintoma em campo é
"não salva", e é difícil de rastrear porque só acontece com alguns produtos.

Somente leitura — não altera nada:

```powershell
npm run auditar-produtos
```

Se listar produtos, o conserto é escrita em produção — combine antes de aplicar.

> O CSV tem nomes de produto e está no `.gitignore`. Não versione.

**2.6** Autorize o domínio no Auth: Firebase Console → Authentication → Settings →
Authorized domains → adicione `themis.grupoicebeer.com.br`.
**Sem isso o login não funciona no domínio novo.**

---

## Passo 3 — Subdomínio e SSL

hPanel → Domínios → Subdomínios → crie `themis`.
Depois SSL → emita o certificado gratuito e ative **Forçar HTTPS**.

> HTTPS não é opcional: sem ele o service worker não registra e a câmera do leitor de
> código não abre. O PWA simplesmente não funciona em HTTP.

---

## Passo 4 — App Node na Hostinger

hPanel → Avançado → **Node.js** → criar aplicação → importar do GitHub.

Autorize o acesso ao repositório `themis` (privado) quando ele pedir.

### Campos

| Campo | Valor |
|---|---|
| Configuração predefinida | `Other` |
| Branch | `main` |
| Versão do node | `20.x` (ou maior) |
| Diretório raiz | `./` |

`./` é proposital: o build precisa da raiz do monorepo para o `npm ci` instalar os
workspaces.

### Configurações de compilação e saída → Personalizado

| Campo | Valor |
|---|---|
| Instalação | `npm ci` |
| Compilação | `npm run build` |
| Iniciar | `npm start` |
| Diretório de saída | deixe vazio |

`npm start` na raiz executa `node apps/api/dist/server.js`. O diretório de saída fica
vazio porque quem serve os arquivos é o Node, não o servidor web.

**Não configure `PORT`.** A Hostinger injeta a porta e o `config.ts` a lê de
`process.env.PORT`. Fixar um valor faz o app escutar na porta errada e o domínio
responder 502.

---

## Passo 5 — Variáveis de ambiente

No mesmo painel, em **Variáveis de ambiente**.

### Build — o PWA precisa delas para compilar

Copie os valores de `apps/web/.env`:

| Variável | Valor |
|---|---|
| `VITE_FIREBASE_API_KEY` | de `apps/web/.env` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `auditoria-icebeer.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `auditoria-icebeer` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `auditoria-icebeer.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | de `apps/web/.env` |
| `VITE_FIREBASE_APP_ID` | de `apps/web/.env` |

Faltando qualquer uma, o build passa mas o app mostra
`Variável de ambiente VITE_... não definida` ao abrir — a checagem é proposital, para o
erro aparecer com nome em vez de virar "Firebase não conecta".

### Execução

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | `https://themis.grupoicebeer.com.br` |
| `ERP_API_URL` | `https://erp.nuvem3.com.br/apiv1/Estoque/EstoqueInventarioAtualizar` |
| `ERP_TIMEOUT_MS` | `10000` |
| `WEBHOOK_SECRET` | segredo gerado abaixo |

Gere o segredo do webhook:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Enquanto `WEBHOOK_SECRET` estiver vazio o endpoint devolve 503 de propósito: um endpoint
aberto que escreve estoque deixaria qualquer um na internet alterar contagem.

---

## Passo 6 — Publicar e conferir

Dispare o deploy pelo painel (ou faça um push na `main`). Acompanhe o log de build.

Quando terminar:

```powershell
curl.exe https://themis.grupoicebeer.com.br/api/health
```

Resposta esperada:

```json
{"ok":true,"versao":"2.0.0","pwa":true}
```

`"pwa": true` confirma que o Node encontrou `apps/web/dist` e está servindo o site. Se vier
`false`, o build do PWA não rodou — confira o comando de compilação do passo 4.

---

## Passo 7 — Conferir no celular

Chrome do **Android**, em `https://themis.grupoicebeer.com.br`:

1. Login com um usuário existente do Themis
2. Estoque carrega e a lista de produtos aparece
3. Contar um produto salva e o valor atualiza na hora
4. "Ler código" abre a câmera e reconhece um código de barras
5. Recarregar em `/auditoria` **não** pode dar 404 (rota de SPA)
6. Menu → Instalar app → abre sem barra do navegador
7. **Modo avião**: contar continua funcionando, aparece a faixa "Sem conexão"
8. Voltar a rede: a fila drena sozinha, aparece "alterações sincronizadas"
9. Auditoria → "PDF de validade" gera o arquivo
10. Histórico carrega — **só depois** dos índices do 2.3 ficarem Ativados

Repita o item 3 com **Slow 3G** (DevTools → Network). A tela não pode travar em nenhuma
etapa. Foi o bug que a 4.19.8 corrigiu e cuja proteção está portada.

---

## Passo 8 — Migrar quem usa o APK

Os dois apps leem o mesmo banco e podem conviver.

1. Rode em paralelo alguns dias, com um ou dois funcionários no PWA
2. Confira que as contagens dos dois aparecem certas na auditoria
3. Mande o link para o resto da equipe, com instrução de "Adicionar à tela inicial"
4. Só então desinstale o APK dos aparelhos

**Não desative o app antigo antes de um ciclo de contagem inteiro fechado pelo PWA.**

---

## Deploys seguintes

```powershell
git checkout desenvolvimento
# trabalhar, commitar
git push origin desenvolvimento
```

Abra pull request para `main`. O CI roda sozinho; ao mesclar, a Hostinger publica.

O usuário recebe a versão nova no próximo carregamento do app — sem loja, sem revisão,
sem esperar aprovação.

## Voltar atrás

```powershell
git revert HASH-DO-COMMIT-RUIM
git push origin main
```

A Hostinger publica de novo com o código anterior. Para reverter regra do Firestore, use o
histórico de versões no Console do Firebase.
