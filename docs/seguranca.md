# Segurança

## Princípio

**A interface esconde; a regra protege.**

`permissoesDe()` decide o que aparece na tela. Isso é conveniência — evita o usuário tentar
algo que vai ser negado. Quem realmente protege os dados são as **Firestore Security
Rules**, que rodam no servidor e não podem ser contornadas pelo cliente.

Nunca trate uma checagem de permissão no PWA como barreira de segurança.

---

## Papéis

Definidos por flags booleanas em `users/{uid}`:

| Papel | Flag |
|---|---|
| master | `isMaster: true` |
| admin | `isAdmin: true` |
| auditor | `isAuditor: true` |
| comum | nenhuma flag |

Precedência: master > admin > auditor > comum.

⚠️ Documentos antigos gravaram as flags como boolean, string `"true"` ou número `1`.
`papelDe()` tolera as três — uma checagem estrita deslogaria perfis legados.

⚠️ Elevação de papel é **só master**, e a regra impede que qualquer um se promova
(`rolesAreNotElevatedOnCreate`, `ownRoleFieldsUnchanged`).

---

## Estoques por usuário — agora é barreira de verdade

`users/{uid}.allowedInventories` define em quais estoques a pessoa pode **escrever**. Desde
a 2.13.0, isso vale nas Security Rules — não só na interface.

Antes valia só na tela: qualquer autenticado escrevia em qualquer estoque, e a lista apenas
escondia os outros do seletor. Era assim porque as regras eram compartilhadas com o Themis
1.x. Com o 1.x fora do ar, virou controle de acesso.

**O que a regra cobre:** escrita em `estoques/{id}/produtos` (contar, importar, corrigir,
limpar) e atualização de `inventories/{id}` (inclusive fechar ciclo).

**O que continua liberado:** *leitura* de qualquer estoque, para qualquer autenticado. É
deliberado — o app lista todos para montar o seletor e filtra do lado do cliente. Fechar a
leitura quebraria o seletor e cobraria um `get()` por documento lido.

### As três portas abertas, e por que existem

`podeAcessarEstoque` libera em três casos, e **inverter qualquer um deles tranca a equipe no
meio de um inventário**:

| Caso | Resultado | Motivo |
|---|---|---|
| Master | passa sempre | precisa alcançar tudo para administrar |
| Sem documento de perfil | passa | falha de leitura não pode parar a contagem |
| Lista vazia | passa | é o padrão de quem nunca foi configurado |
| Lista preenchida | só os da lista | o caso que a regra existe para cobrir |

A ordem dos `||` importa: o curto-circuito faz o master nem chegar a olhar a lista. E os
`get()` repetidos para o mesmo caminho são **cacheados** pelo motor de regras — custa uma
leitura por avaliação, não quatro. Num lote de 500 escritas, é **uma** leitura, não 500.

### Antes de publicar esta regra

⚠️ Regra errada aqui tranca a equipe fora no meio de uma contagem.

**Jeito automatizado, preferível:**

```
npm run testar-regras
```

Sobe o emulador do Firestore local, roda `firestore/regras.test.ts` e derruba. Nada toca o
projeto de verdade. Exige **JDK 21 ou superior** — o `firebase-tools` recusa versões
anteriores:

```
winget install Microsoft.OpenJDK.21
```

O arquivo cobre os seis casos abaixo mais conferência, exclusões, `hashConfigs`,
`validProductData` e quem lê o histórico.

**Sem o JDK**, à mão no **Rules Playground** do Console:

| Cenário | Operação | Esperado |
|---|---|---|
| Master, qualquer estoque | update em `estoques/X/produtos/1` | ✅ permite |
| Comum sem `allowedInventories` | update em `estoques/X/produtos/1` | ✅ permite |
| Comum com `allowedInventories: []` | update em `estoques/X/produtos/1` | ✅ permite |
| Comum com `allowedInventories: ['X']` | update em `estoques/X/produtos/1` | ✅ permite |
| Comum com `allowedInventories: ['Y']` | update em `estoques/X/produtos/1` | ❌ **nega** |
| Comum sem documento em `users/` | update em `estoques/X/produtos/1` | ✅ permite |

O quinto é o que a mudança existe para fazer. Os outros cinco são o que ela **não** pode
quebrar.

**Rollback:** publicar de volta a versão anterior do arquivo pelo Console ou por
`git checkout <commit-anterior> -- firestore/firestore.rules && npm run deploy-rules`.

## Security Rules

Arquivo versionado: `firestore/firestore.rules`. É **cópia do que está publicado** — não um
arquivo novo. Antes de publicar, compare com o Console; se divergir, a versão do Console é
a verdadeira.

### O que cada papel pode

| Coleção | Ler | Criar | Atualizar | Excluir |
|---|---|---|---|---|
| `estoques/*/produtos` | autenticado | admin+ | autenticado¹ | master |
| `inventories` | autenticado | admin+ | admin+ ou ciclo² | master |
| `auditorias` | autenticado | autenticado | master | master |
| `hashConfigs` | admin+ | master | master | master |
| `historico_geral` | admin+ | autenticado | — | — |
| `users` | próprio ou master | próprio³ | próprio³ ou master | master |

¹ com `validProductData` e `podeAlterarStatusProduto`
² usuário comum só os campos da rodada: os quatro do ciclo mais `lote` e `loteCiclo`
³ sem elevar o próprio papel

### `podeAlterarStatusProduto`

Usuário comum:
- **não** pode tocar em `corrigidoIncorreto` nem `corrigidoCritico`
- só pode marcar `productStatus` como `'ATUALIZADO'`
- **não** pode alterar item que já está `'CONFERIDO'`

Ou seja: o funcionário conta, o admin confere, e a conferência não é desfeita por engano.

### `validProductData`

Valida tipos de todos os campos do documento **resultante**. É a fonte da armadilha mais
cara do projeto — ver [dados.md](dados.md) §Regras de tipo.

Espelho testável em `packages/shared/src/validacao.ts`. **Se a regra mudar, esse arquivo
muda junto.**

### Avisos esperados na compilação

```
[W] Invalid function name: get.
[W] Invalid variable name: request.
[W] Unused function: isAuditorOrMaster.
```

Os dois primeiros são ruído do analisador; o arquivo compila e é o que roda em produção. O
terceiro é real e inofensivo.

---

## Segredos

| Segredo | Onde vive | Observação |
|---|---|---|
| Config do Firebase (`VITE_*`) | painel da Hostinger + `apps/web/.env` local | **público por projeto** — vai no bundle do navegador |
| `WEBHOOK_SECRET` | painel da Hostinger | 64 caracteres hex |
| Senhas de usuário | Firebase Auth | nunca tocadas pelo app |

### Config do Firebase não é segredo

Credencial web do Firebase é pública por design: está no bundle que qualquer um baixa, e
estava no APK. Quem protege os dados são as Security Rules e o Auth.

Mesmo assim fica em `.env` (versionado só o `.env.example`) para não convidar a scraping.

### `.env` nunca vai para o repositório

`.gitignore` cobre `.env` e `.env.*` exceto `.env.example`. Confira antes de publicar:

```powershell
git ls-files | Select-String "\.env$"
```

Não pode retornar nada.

---

## Webhook

`POST /api/webhook/estoque` exige o header `x-themis-webhook-secret`.

- Comparação em **tempo constante** (`timingSafeEqual`) — `===` vaza o tamanho do prefixo
  correto.
- Com `WEBHOOK_SECRET` vazio, devolve **503** de propósito. Endpoint aberto que escreve
  estoque deixaria qualquer um na internet alterar contagem.
- Tentativa com segredo inválido é registrada com o IP.

Gerar um novo:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## API

| Proteção | Onde |
|---|---|
| Rate limit 120/min por IP | `/api/*` apenas — o PWA carrega dezenas de arquivos e seria bloqueado |
| `trustProxy` | sem isso `req.ip` vira o IP do proxy e o limite vale para todos juntos |
| CORS restrito | `CORS_ORIGINS`; mesma origem dispensa, mas fica para o caso de subdomínio |
| Validação de schema | Fastify, em toda rota `POST` |
| Timeout no ERP | 45s por tentativa, com 502/504 separados |
| Log sem URL | `log-respostas.ts`: método, padrão da rota, status e tempo; nunca URL, corpo nem cabeçalho. `/api/erp/estoque/<x>` vira `***` em qualquer linha |

O endereço do ERP fica só no servidor, fora do bundle.

### Cabeçalhos

`estaticos.ts` define cache. `X-Content-Type-Options`, `Referrer-Policy` e
`Permissions-Policy: camera=(self)` estão no `.htaccess`, que **só vale se houver Apache na
frente** — na configuração atual (Node servindo direto) eles não são aplicados.

> **Pendência conhecida**, com o plano de execução e as armadilhas do CSP em
> [pendencias.md](pendencias.md#2-cabeçalhos-de-segurança-no-fastify). Não é bloqueador: o
> app é de rede interna, autenticado, e não incorpora conteúdo de terceiros. O ganho
> concreto mais próximo é `frame-ancestors`, contra clickjacking.

---

## Varredura de produtos legados

```powershell
npm run auditar-produtos
```

Somente leitura. Usa o SDK cliente com login normal — as regras liberam leitura para
qualquer autenticado, então **não precisa de service account**.

O relatório gerado (`produtos-invalidos.csv`) contém nomes de produto e está no
`.gitignore`. Não versione.

---

## Auditoria de dependências

Quatro avisos ficam abertos de propósito, com o raciocínio registrado no
[../README.md](../README.md). **Leia antes de rodar `npm audit fix`** — neste projeto ele
piora a situação em dois dos quatro casos.
