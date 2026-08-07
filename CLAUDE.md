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
5. Se a tarefa for uma pendência conhecida: [docs/pendencias.md](docs/pendencias.md) já traz
   o plano e as armadilhas

## Depois de escrever código

```powershell
npm run verificar
```

Versionamento, typecheck, lint, testes e build. **Precisa passar.** Um comando por linha: o
Windows PowerShell 5.1 não aceita `&&`.

Mudou comportamento? Suba a versão **antes** de commitar:

```powershell
npm run versao -- patch
```

`patch` corrige, `minor` acrescenta, `major` quebra compatibilidade. O script sincroniza os
quatro `package.json` e abre a seção do changelog; escreva o que mudou e por quê — a trava
recusa seção vazia. Detalhes em [docs/desenvolvimento.md](docs/desenvolvimento.md)
§Versionamento.

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

**Operação em lote anunciada ao usuário usa `exigirGravacao`, não `withWriteTimeout`.**
O segundo resolve com `timedOut: true` sem lançar. Ignorar isso fez o aparelho do admin
mostrar tudo conferido a partir do cache enquanto o servidor não tinha nada — e a equipe
vendo outra coisa. Estouro é "não confirmado", nunca "não salvou".

**Cálculo de domínio mora em `packages/shared`, com teste.**
No 1.x isso estava duplicado e as cópias divergiram: uma nunca devolvia `CRITICO`.

**`features/` não importa `firebase/firestore` direto.**
Todo acesso passa por `apps/web/src/lib/*-repo.ts`.

**O service worker não cacheia tráfego do Firebase.**
O SDK já tem cache próprio. Dois caches sobre o mesmo dado servem informação velha.

**Não remova `.npmrc`.**
`include=dev` é o que faz o `tsc` existir no build da hospedagem.

**A interface nunca é mais permissiva que a Security Rule.**
Quando é, o usuário vê o botão, clica e leva `permission-denied` — promessa que o banco não
cumpre. Mudou `permissoesDe` ou criou botão novo? Confira a regra correspondente em
`firestore/firestore.rules` antes. Os que exigem **master**, e não admin: `historico_geral`
(leitura), `hashConfigs` (escrita), exclusão de `inventories` e de `produtos`.

**Formato gravado precisa continuar legível pelo Themis 1.x.**
Os dois apps convivem no mesmo banco.

**Quem só conta não vê o saldo do sistema nem a diferença.**
Ver o número faz conferir em vez de contar, e o inventário deixa de medir o erro que existe
para pegar. Componente novo na tela de contagem recebe `verSistema` e o respeita.

**Toda alteração de comportamento sobe a versão e entra no changelog.**
O service worker guarda o build antigo no aparelho; sem número confiável não dá para saber
se a correção chegou no celular do funcionário.

**Efeito não depende de callback vindo de prop, nem de objeto de listener.**
Os dois ganham identidade nova a cada render e remontam o efeito — um fechava o teclado
virtual a cada letra digitada, o outro recarregava a tela sozinha. Use `useRef` para o
callback e o **id** para o objeto.

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
