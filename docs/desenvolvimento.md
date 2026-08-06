# Desenvolvimento

## Preparar

```powershell
cd "C:\Projetos\Themis 2.0"
npm ci
```

Copie os `.env` (só na primeira vez):

```powershell
Copy-Item apps\web\.env.example apps\web\.env
Copy-Item apps\api\.env.example apps\api\.env
```

Preencha `apps/web/.env` com a config do Firebase e `apps/api/.env` com o `WEBHOOK_SECRET`.

> **PowerShell 5.1 não aceita `&&`.** Um comando por linha. Onde precisa encadear, existe
> script npm — dentro deles funciona, porque o npm executa via `cmd.exe`.

## Rodar

```powershell
npm run dev        # PWA em http://localhost:5173
npm run dev:api    # API em http://localhost:3000
```

O Vite faz proxy de `/api` para a API local, então não há CORS em desenvolvimento.

Para testar o modo de produção — um processo servindo PWA e API:

```powershell
npm run build
npm start
```

## Verificar

```powershell
npm run verificar
```

Roda **versionamento**, typecheck, lint, testes e build, e para no primeiro erro. **É o que
precisa passar antes de qualquer commit.**

Individualmente:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:watch
```

---

## Convenções

### Idioma

**Código, comentários e documentação em português.** Nomes de bibliotecas, APIs do
navegador e campos do Firestore ficam como são (`productStatus`, `BarcodeDetector`).

Commits em português, sem acento — o histórico atravessa terminais com codificação
duvidosa.

### Comentários

Comentário explica **por quê**, não o quê. O código já diz o que faz.

```ts
// ❌ Incrementa o ciclo
ciclo++;

// ✅ Em transação porque 5 aparelhos podem finalizar quase ao mesmo tempo:
// ler o ciclo da tela e somar 1 perderia incrementos.
```

Regra de ouro: se você descobriu algo pesquisando ou apanhando, isso vira comentário —
ou entra em [armadilhas.md](armadilhas.md).

### Onde colocar cada coisa

| O quê | Onde |
|---|---|
| Cálculo de domínio | `packages/shared/` — puro, com teste |
| Acesso ao Firestore | `apps/web/src/lib/*-repo.ts` |
| Estado global | `apps/web/src/contexts/` |
| Tela | `apps/web/src/features/<área>/` |
| Peça reutilizável | `apps/web/src/components/` |

⚠️ **`features/` não importa `firebase/firestore` direto.** Todo acesso passa por `lib/`,
para o teto de tempo e a fila offline acontecerem num lugar só.

### Testes

Cobrimos o que **quebra silenciosamente**: cálculo de domínio, filtros, papéis, fila
offline, validação de tipos. Não cobrimos renderização — é caro e frágil.

Todo teste tem nome em português que descreve o comportamento, não a função:

```ts
it('quantidade sozinha não torna o item contado', ...)
it('preserva a base da PRIMEIRA edição ao substituir', ...)
```

Bug corrigido ganha teste de regressão, com comentário dizendo o que aconteceu.

### TypeScript

`strict` ligado, mais `noUncheckedIndexedAccess`. Índice de array devolve `T | undefined` —
é chato e já evitou bug.

Sem `any`. Para dado externo (Firestore, planilha), use `unknown` e valide.

---

## Git

```
main               o que está publicado. Push aqui = deploy.
desenvolvimento    trabalho do dia a dia
```

Fluxo:

```powershell
git checkout desenvolvimento
# trabalhar, commitar
git push origin desenvolvimento
```

Pull request para `main`. O CI roda typecheck, lint e testes. Ao mesclar, a Hostinger
publica.

### Antes de commitar

- [ ] `npm run verificar` passou
- [ ] Documentação atualizada — ver [README.md](README.md) §A regra
- [ ] `CHANGELOG.md` atualizado
- [ ] Confirmou a branch (`git rev-parse --abbrev-ref HEAD`)

O último item está aqui porque já aconteceu: quatro commits foram parar em
`desenvolvimento` quando deveriam ir para `main`, e o `git push origin main` respondia
"tudo atualizado".

### Mensagem de commit

Assunto no imperativo, uma linha. Corpo explicando **por quê** e, quando for correção, qual
era o sintoma.

```
Corrige o build na Hostinger: instalacao sem devDependencies derrubava o tsc

O NODE_ENV=production faz o npm omitir devDependencies, e o TypeScript e dev.
O .npmrc com include=dev resolve independentemente do que a plataforma decidir,
porque include tem precedencia sobre omit.
```

---

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | PWA em desenvolvimento |
| `npm run dev:api` | API em desenvolvimento |
| `npm run build` | build completo |
| `npm start` | roda o build de produção |
| `npm run verificar` | versionamento + typecheck + lint + testes + build |
| `npm test` | testes |
| `npm run versao -- patch` | sobe a versão e abre a seção do changelog |
| `npm run versao:marcar` | cria a tag git da versão atual |
| `npm run verificar-versao` | confere versão x changelog |
| `npm run auditar-produtos` | varredura de produtos legados (só leitura) |
| `npx tsx scripts/verificar-planilha.mts <arquivo>` | testa a leitura de uma planilha real |
| `npm run deploy-rules` | publica as Security Rules |
| `npm run deploy-indexes` | publica os índices |

---

## Versionamento

**Toda alteração de comportamento sobe a versão.** Não é burocracia: o PWA guarda o build
antigo no aparelho pelo service worker, e sem um número confiável na tela não dá para
responder *"a correção chegou no celular do funcionário?"*. Já aconteceu de os pacotes
dizerem `2.0.0` enquanto o changelog ia em `2.6.2` — número que não acompanha o código
responde com confiança a pergunta errada.

### Qual casa subir

| | Quando | Exemplo |
|---|---|---|
| **patch** `2.7.0 → 2.7.1` | corrigir sem mudar o que o usuário faz | foco do modal |
| **minor** `2.7.0 → 2.8.0` | funcionalidade nova, compatível | contagem às cegas |
| **major** `2.7.0 → 3.0.0` | quebra de compatibilidade | formato de dado no Firestore |

### O ciclo

```powershell
npm run versao -- minor      # sincroniza os 4 package.json e abre a seção no changelog
# escreva o changelog: o que mudou, e por quê
npm run verificar            # a trava recusa seção vazia
git add -A
git commit
npm run versao:marcar        # tag, depois do commit
git push origin desenvolvimento
```

A tag vem **depois** do commit de propósito: ela precisa apontar para o commit que já tem o
changelog escrito. Tag movida depois é pior que tag nenhuma — quem já clonou fica com outra
ideia do que aquela versão significa.

### O que a trava cobra

`npm run verificar-versao` falha se:

- os quatro `package.json` divergirem;
- faltar seção da versão atual no `docs/CHANGELOG.md`;
- a seção estiver vazia (o esqueleto que o script abre não passa);
- o topo do changelog não for a versão atual.

### Onde a versão aparece

| Onde | Como ver |
|---|---|
| Rodapé do menu | `Themis 2.7.0`; o `title` traz commit e data do build |
| API | `curl https://o-dominio/api/versao` |
| `/api/health` | campo `versao` |

Versão, commit e data entram no bundle na compilação (`define` do Vite e do esbuild). Fora
de um repositório git — a hospedagem compila numa cópia — o commit fica `desconhecido` em
vez de quebrar o build.

## Estrutura de referência

Detalhes em [arquitetura.md](arquitetura.md). Resumo:

```
apps/web       PWA        ~2.900 linhas
apps/api       API          ~360 linhas
packages/shared domínio     ~570 linhas + ~470 de teste
```
