# Instruções para agentes

Leia antes de alterar qualquer coisa. Vale para Claude Code, Copilot, Cursor e qualquer
outra ferramenta que trabalhe neste repositório.

## O projeto em cinco linhas

Themis 2.0 — PWA de contagem e auditoria de estoque do Grupo Ice Beer, no ar em
`themis.grupoicebeer.com.br`. Monorepo npm: `apps/web` (React + Vite), `apps/api`
(Fastify), `packages/shared` (domínio puro). Banco Firestore `auditoria-icebeer`,
**compartilhado com o app Themis 1.x, que continua em produção**.

## Antes de escrever código

1. Leia [docs/README.md](docs/README.md) — é o mapa
2. Leia [docs/armadilhas.md](docs/armadilhas.md) — cada item ali custou tempo real
3. Se for mexer em dados: [docs/dados.md](docs/dados.md) §Regras de tipo
4. Se for mexer em gravação: [docs/offline.md](docs/offline.md)

## Depois de escrever código

```powershell
npm run verificar
```

Typecheck, lint, testes e build. **Precisa passar.** Um comando por linha: o Windows
PowerShell 5.1 não aceita `&&`.

## A regra da documentação

**Alteração de comportamento sem alteração de documentação é alteração incompleta.**

| Mudou | Atualize |
|---|---|
| Comportamento visível | `docs/funcionalidades.md` |
| Cálculo, status, ciclo | `docs/regras-de-negocio.md` |
| Campo, coleção, regra do Firestore | `docs/dados.md` e `docs/seguranca.md` |
| Escolha entre dois caminhos | `docs/decisoes.md` |
| Pegadinha que custou tempo | `docs/armadilhas.md` |
| Qualquer coisa | `docs/CHANGELOG.md` |

A documentação guarda o que o código não consegue dizer: por que a decisão foi essa, o que
já foi tentado e falhou. Essa informação some junto com a memória de quem escreveu.

## Invariantes — não quebre sem discutir

**Contagem fala com o Firestore direto, nunca pela API.**
É a persistência offline do SDK que faz o app funcionar em depósito com wifi ruim. Pôr a
API nesse caminho mata o offline.

**Toda escrita passa por `withWriteTimeout` ou `runTransactionWithTimeout`.**
Com persistência offline, a promise de uma escrita não significa "salvou" — e sem servidor
ela nunca resolve nem rejeita. Um `await` direto trava a tela em rede lenta.

**Nunca grave `null` em produto.**
As regras exigem `quantidade is number`, `codigoBarras is string`, `dataValidade is string`,
`productStatus in ['ATUALIZADO','CONFERIDO']`. "Não contado" é a **ausência** do campo:
`deleteField()`, ou a constante `REMOVER` quando o valor puder passar pela fila offline.
`'PENDENTE'` não existe.

**Cálculo de domínio mora em `packages/shared`, com teste.**
No 1.x isso estava duplicado e as cópias divergiram: uma nunca devolvia `CRITICO`.

**`features/` não importa `firebase/firestore` direto.**
Todo acesso passa por `apps/web/src/lib/*-repo.ts`.

**O service worker não cacheia tráfego do Firebase.**
O SDK já tem cache próprio. Dois caches sobre o mesmo dado servem informação velha.

**Não remova `.npmrc`.**
`include=dev` é o que faz o `tsc` existir no build da hospedagem.

**Formato gravado precisa continuar legível pelo Themis 1.x.**
Os dois apps convivem no mesmo banco.

## Convenções

- **Português** em código, comentários, documentação e commits (commits sem acento)
- Comentário explica **por quê**, não o quê
- `strict` + `noUncheckedIndexedAccess`. Sem `any`; para dado externo, `unknown` + validação
- Teste cobre o que quebra silenciosamente: domínio, filtros, papéis, fila, validação.
  Não cobrimos renderização
- Bug corrigido ganha teste de regressão, com comentário dizendo o que aconteceu

## Git

`main` é o que está publicado — **push nela dispara deploy em produção**. Trabalhe em
`desenvolvimento` e abra pull request.

Confirme a branch antes de commitar:

```powershell
git rev-parse --abbrev-ref HEAD
```

Já aconteceu de quatro commits irem para a branch errada e o `push origin main` responder
"tudo atualizado".

## O que exige aprovação humana

- Publicar Security Rules ou índices (`npm run deploy-rules` / `deploy-indexes`) — afeta o
  app 1.x na hora
- Qualquer escrita em massa no banco de produção
- `push origin main` — é deploy
- Corrigir produtos legados encontrados por `npm run auditar-produtos`

## Ambiente

Windows, PowerShell 5.1. Sem `&&`, sem `-Encoding utf8` para JSON (grava BOM e corrompe o
arquivo). Use as ferramentas de edição, não redirecionamento de shell.
