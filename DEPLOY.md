# Deploy do Themis 2.0

Passo a passo do zero até o app no ar, com deploy automático a cada `push` na `main`.

Faça na ordem. Cada passo assume o anterior concluído.

> **Qual terminal.** Blocos marcados `powershell` rodam no seu PC, **uma linha por vez**.
> O Windows PowerShell 5.1 **não aceita `&&`** — colar uma linha com `&&` devolve
> `O token '&&' não é um separador de instruções válido nesta versão`. Onde é preciso
> encadear, existe um script npm (dentro deles o `&&` funciona, porque o npm executa via
> `cmd.exe`). Blocos marcados `bash` rodam **no servidor**, depois do `ssh` — lá `&&` e
> heredoc funcionam normalmente.

---

## Antes de começar

Tenha em mãos:

- Conta GitHub com acesso para criar repositório privado
- Acesso ao hPanel da Hostinger (Business Premium, com Node.js e SSH)
- Domínio ou subdomínio para o app (ex.: `themis.grupoicebeer.com.br`)
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

O repositório local já existe, com o histórico completo. Falta o remoto.

**1.1** Crie o repositório em <https://github.com/new>:

- Nome: `themis` (ou `themis-2`)
- Visibilidade: **Private**
- **Não** marque "Add a README", "Add .gitignore" nem licença — o repositório local já
  tem tudo, e um commit inicial do GitHub causaria conflito no primeiro push

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
`verificar` do CI passe.

---

## Passo 2 — Firestore

O banco é o mesmo do Themis 1.x. **Nenhuma migração de dados.**

**2.1** Autentique a CLI:

```powershell
cd "C:\Projetos\Themis 2.0"
npx firebase-tools login
```

Abre o navegador para o login do Google. Use a conta com acesso ao projeto
`auditoria-icebeer`.

> **Por que `npx` e não `npm install -g firebase-tools`.** No Windows, o `npm -g` instala
> em `%APPDATA%\npm`, que frequentemente **não está no PATH** — aí o comando `firebase`
> devolve `O termo 'firebase' não é reconhecido...` mesmo com a instalação tendo dado
> certo. O `npx` resolve o binário sozinho e funciona em qualquer máquina.
>
> Se preferir o comando curto, adicione a pasta ao PATH do usuário (uma vez só) e
> **abra um terminal novo** depois:
>
> ```powershell
> [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';' + (npm config get prefix), 'User')
> ```

**2.2** Confira o que vai mudar antes de publicar:

- `firestore/firestore.rules` — cópia idêntica das regras que já estão publicadas em
  produção. O deploy deve ser um no-op. **Compare** com o que está no Console
  (Firestore → Regras) antes de mandar; se divergir, alguém alterou pelo Console e a
  versão do Console é a verdadeira.
- `firestore/firestore.indexes.json` — **isto é novo**. São 3 índices compostos que as
  telas de Histórico e Auditoria precisam. Sem eles, essas telas dão erro de consulta.

**2.3** Publique os índices (adicionar índice é operação aditiva e segura):

```powershell
cd "C:\Projetos\Themis 2.0"
npx firebase-tools deploy --only firestore:indexes
```

A construção leva de minutos a algumas horas conforme o volume. Acompanhe em
Firestore → Índices. Só teste o Histórico depois que ficarem "Ativado".

> **Se a CLI perguntar "Would you like to delete these indexes?", responda `N`.**
> Ela oferece apagar índices que existem no projeto mas não estão no arquivo. Responder
> `y` apaga índice em produção — os de `historico_geral` por `userId` e por `action` são
> do Themis 1.x, que continua no ar. Se a pergunta aparecer, alguém criou índice pelo
> Console: traga-o para `firestore/firestore.indexes.json` em vez de mandar apagar.
> Detalhes em `firestore/README.md`.

**2.4** As regras, **só se realmente divergirem**:

```powershell
npx firebase-tools deploy --only firestore:rules
```

> Publicar regra afeta os usuários do app 1.x **na hora**. Se estiverem idênticas, pule
> este passo. Em caso de problema, o Console tem histórico de versões com rollback.

**2.5 Varredura de produtos legados — faça antes de liberar para a equipe**

`validProductData` valida o documento **resultante** de qualquer update. Um produto antigo
com `corrigidoIncorreto: null` ou `lastModified` gravado como texto faz o funcionário
receber permission-denied ao contar, mesmo sem encostar nesse campo. O sintoma em campo é
"não salva", e é difícil de rastrear porque só acontece com alguns produtos.

O script é **somente leitura** — não altera nada:

```powershell
npm run auditar-produtos
```

Pede e-mail e senha de um usuário do Themis (leitura é liberada para qualquer autenticado,
não precisa de service account). Ao final:

- imprime o total por campo problemático
- grava `produtos-invalidos.csv` e `produtos-invalidos.json`, com a sugestão de conserto
  de cada caso

Se a saída for "Nenhum documento violaria as regras", siga em frente. Se listar produtos,
o conserto é escrita em produção — combine antes de aplicar.

> O CSV tem nomes de produto e está no `.gitignore` de propósito. Não versione.

**2.6** Autorize o domínio novo no Auth:
Firebase Console → Authentication → Settings → Authorized domains → adicione
`themis.grupoicebeer.com.br`. **Sem isso o login não funciona no domínio novo.**

---

## Passo 3 — Hostinger

**3.1 Subdomínio e SSL**

No hPanel: Domínios → Subdomínios → crie `themis`. Depois SSL → emita o certificado
gratuito e ative "Forçar HTTPS".

> HTTPS não é opcional: sem ele o service worker não registra e a câmera do leitor de
> código não abre. O PWA simplesmente não funciona em HTTP.

**3.2 Chave SSH dedicada**

Gere um par **só para o deploy** — não reaproveite sua chave pessoal:

```powershell
cd "C:\Projetos\Themis 2.0"
ssh-keygen -t ed25519 -C "github-actions-themis" -f themis_deploy -N '""'
```

O `-N '""'` define senha vazia. As aspas duplas dentro das simples são necessárias no
PowerShell: com `''` sozinho ele descarta o argumento e o `ssh-keygen` passa a **pedir**
a senha no terminal. Em bash o equivalente é `-N ''`.

Gera `themis_deploy` (privada) e `themis_deploy.pub` (pública).

No hPanel: Avançado → Acesso SSH → cole o conteúdo de **`themis_deploy.pub`**.
Anote host, usuário e porta que a tela mostra.

Teste a conexão e a versão do Node do servidor:

```powershell
ssh -p PORTA -i themis_deploy USUARIO@HOST "echo ok; node -v"
```

Precisa responder `ok` e uma versão do Node **20 ou maior**.

Guarde também o fingerprint do servidor — vira secret no passo 4:

```powershell
ssh-keyscan -p PORTA HOST
```

**3.3 Pastas no servidor**

Conecte e rode lá dentro (daqui em diante é bash, não PowerShell):

```bash
ssh -p PORTA -i themis_deploy USUARIO@HOST
mkdir -p ~/themis-api/dist
ls -d ~/domains/*/public_html
pwd
exit
```

Anote o caminho do `public_html` do subdomínio — é o `HOSTINGER_WEB_DIR`. O `pwd` mostra
o seu diretório home, que compõe o `HOSTINGER_API_DIR`.

**3.4 App Node no hPanel**

Avançado → Node.js:

- Versão: 20 ou superior
- Pasta da aplicação: `themis-api`
- Arquivo de inicialização: `dist/server.js`
- Anote a **porta** que o painel atribuir

Se o painel oferecer mapear o app para uma URL, mapeie para `/api` do mesmo subdomínio.
Se só permitir subdomínio separado (ex.: `api-themis.grupoicebeer.com.br`), tudo bem —
o passo 4 trata disso.

**3.5 `.env` da API — direto no servidor, nunca no repositório**

Gere o segredo do webhook na sua máquina:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

No servidor:

```bash
ssh -p PORTA -i themis_deploy USUARIO@HOST
cat > ~/themis-api/.env <<'FIM'
PORT=3000
NODE_ENV=production
CORS_ORIGINS=https://themis.grupoicebeer.com.br
ERP_API_URL=https://erp.nuvem3.com.br/apiv1/Estoque/EstoqueInventarioAtualizar
ERP_TIMEOUT_MS=10000
WEBHOOK_SECRET=cole-o-segredo-gerado-aqui
FIM
chmod 600 ~/themis-api/.env
exit
```

Ajuste `PORT` para a porta que o hPanel atribuiu e `CORS_ORIGINS` para o seu domínio real.

`chmod 600` importa: em hospedagem compartilhada o arquivo fica num sistema de arquivos
que outros processos podem enxergar.

**3.6 pm2**

```bash
ssh -p PORTA -i themis_deploy USUARIO@HOST
npm install -g pm2
pm2 startup   # rode o comando que ele imprimir, para a API voltar sozinha após reboot
exit
```

O workflow inicia o processo com `--node-args='--env-file=.env'`. Isso é obrigatório: o
pm2 executa `node dist/server.js` direto e **ignora** o script `start` do `package.json`,
que é onde vive o `--env-file`. Sem esse argumento a API sobe sem ler o `.env`, com CORS
errado e o webhook desligado — e sem nenhum erro visível.

Se o hPanel já gerencia o processo Node, o pm2 é dispensável — nesse caso troque o passo
de restart no workflow pelo comando de restart do painel, e garanta que ele passe o
`--env-file` ou que as variáveis estejam configuradas no próprio painel.

---

## Passo 4 — Secrets no GitHub

Settings → Secrets and variables → Actions → New repository secret.

| Secret | Valor |
|---|---|
| `VITE_FIREBASE_API_KEY` | de `apps/web/.env` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `auditoria-icebeer.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `auditoria-icebeer` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `auditoria-icebeer.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | de `apps/web/.env` |
| `VITE_FIREBASE_APP_ID` | de `apps/web/.env` |
| `HOSTINGER_SSH_HOST` | host do passo 3.2 |
| `HOSTINGER_SSH_USER` | usuário do passo 3.2 |
| `HOSTINGER_SSH_PORT` | porta do passo 3.2 |
| `HOSTINGER_SSH_KEY` | conteúdo **inteiro** de `themis_deploy`, com as linhas BEGIN/END |
| `HOSTINGER_KNOWN_HOSTS` | saída do `ssh-keyscan` do passo 3.2 |
| `HOSTINGER_WEB_DIR` | caminho do `public_html` do subdomínio |
| `HOSTINGER_API_DIR` | `/home/USUARIO/themis-api` |
| `URL_HEALTHCHECK` | `https://themis.grupoicebeer.com.br/api/health` |

O `HOSTINGER_KNOWN_HOSTS` não é burocracia: sem ele o deploy aceitaria qualquer servidor
que respondesse naquele endereço, e a chave privada iria junto.

`HOSTINGER_WEB_DIR` precisa apontar exatamente para o `public_html` do subdomínio: o envio
do PWA usa `rsync --delete` para remover assets antigos, e um caminho errado apaga a pasta
errada. O workflow recusa valores obviamente perigosos (`/`, `~`, `/home`), mas não tem
como adivinhar um caminho que existe e é o errado. **Confira este.**

**Só se a API ficar em subdomínio separado**, crie também `VITE_API_URL` com
`https://api-themis.grupoicebeer.com.br/api`. O workflow já lê esse secret; vazio, o PWA
usa `/api` na mesma origem. Nesse caso o `CORS_ORIGINS` do `.env` da API precisa conter a
origem do PWA, senão o navegador bloqueia a resposta.

Depois apague `themis_deploy` da sua máquina — ela já está no GitHub e no servidor.

---

## Passo 5 — Primeiro deploy

```powershell
git checkout main
git push origin main
```

Acompanhe em Actions. O workflow faz, nesta ordem:

1. `npm ci`
2. typecheck, lint e testes — publicar sem verificar não acontece
3. build do PWA e da API
4. confere que `index.html`, `sw.js`, `.htaccess` e `server.js` existem
5. valida o `HOSTINGER_WEB_DIR` antes do `rsync --delete`
6. envia o PWA e a API
7. `npm install --omit=dev` e restart do pm2 no servidor
8. chama `/api/health` em laço, até ~30s

Se o healthcheck falhar, veja o log no servidor:

```powershell
ssh -p PORTA -i themis_deploy USUARIO@HOST "pm2 logs themis-api --lines 50"
```

---

## Passo 6 — Conferir no celular

Abra `https://themis.grupoicebeer.com.br` **no Chrome do Android**:

1. Login com um usuário existente do Themis
2. O estoque carrega e a lista de produtos aparece
3. Contar um produto salva e o valor atualiza na hora
4. "Ler código" abre a câmera e reconhece um código de barras
5. Menu → "Instalar app" (ou "Adicionar à tela inicial") — abre sem barra do navegador
6. Modo avião: contar continua funcionando, aparece a faixa "Sem conexão"
7. Voltar a rede: a fila drena sozinha e aparece "alterações sincronizadas"
8. Auditoria → "PDF de validade" gera o arquivo
9. Histórico carrega (**só depois** dos índices do passo 2.3 ficarem Ativados)

Teste com **rede lenta** também (DevTools → Network → Slow 3G): a tela não pode travar em
nenhuma dessas etapas. Foi o bug que a 4.19.8 corrigiu e cuja proteção está portada.

---

## Passo 7 — Migrar quem usa o APK

Os dois apps leem o mesmo banco, então podem conviver. Migração sem susto:

1. Rode em paralelo por alguns dias com um ou dois funcionários no PWA
2. Confira que as contagens dos dois aparecem certas na auditoria
3. Mande o link com instrução de "Adicionar à tela inicial" para o resto da equipe
4. Só então desinstale o APK dos aparelhos

Não desative o app antigo antes de um ciclo de contagem inteiro fechado pelo PWA.

---

## Deploys seguintes

```powershell
git checkout desenvolvimento
# trabalhar, commitar
git push origin desenvolvimento
```

Abra pull request para `main`. O CI roda sozinho; ao aprovar e mesclar, o deploy acontece.

O usuário recebe a versão nova no próximo carregamento do app — sem loja, sem revisão,
sem esperar aprovação.

## Voltar atrás

```powershell
git revert HASH-DO-COMMIT-RUIM
git push origin main
```

O deploy roda de novo com o código anterior. Para reverter regra do Firestore, use o
histórico de versões no Console do Firebase.
