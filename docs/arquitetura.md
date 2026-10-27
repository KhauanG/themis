# Arquitetura

## Visão de 10 segundos

```
                    themis.grupoicebeer.com.br
                              │
                    ┌─────────▼─────────┐
                    │  Node (Fastify)   │  um processo só
                    │  server.mjs       │
                    └────┬─────────┬────┘
                         │         │
              /  ────────┘         └──────── /api/*
              │                                 │
        apps/web/dist                     proxy ERP
        (PWA, arquivos)                   webhook
                                          health
              │
              │ contagem NÃO passa pela API
              ▼
        ┌───────────┐
        │ Firestore │  auditoria-icebeer
        └───────────┘
```

**A contagem fala com o Firestore direto.** É a persistência offline do SDK que faz o app
funcionar em depósito com wifi ruim. Pôr a API nesse caminho transformaria "servidor fora
do ar" em "app inutilizável". A API existe só para o que exige servidor.

## Estrutura de pastas

```
apps/
  web/                    PWA — React + Vite + vite-plugin-pwa
    src/
      components/         peças reutilizáveis (Modal, Toasts, Layout, ...)
      contexts/           estado global (Auth, Estoque, Toast)
      features/           uma pasta por tela
        auth/  contagem/  auditoria/  produtos/  historico/  usuarios/  finalizar/
      lib/                acesso a dados e utilidades sem UI
      types/              declarações de tipo de APIs do navegador
  api/                    Fastify + TypeScript
    src/
      routes/             erp.ts, webhook.ts
      config.ts           leitura das variáveis de ambiente
      estaticos.ts        serve o PWA
      server.ts           montagem e escuta
    build.mjs             empacota tudo num arquivo com esbuild

packages/
  shared/                 domínio puro — sem DOM, sem Firebase, sem rede
    src/                  types, produto, auditoria, filtros, papeis, relatorio, validacao

firestore/                rules e índices versionados
scripts/                  manutenção (auditar-produtos.mjs)
docs/                     esta documentação
```

### Por que `packages/shared` existe

No 1.x o cálculo de status estava duplicado em `app.js` e `auditoria.js`. As duas cópias
divergiram: a de `app.js` nunca devolvia `CRITICO`. Auditoria salva pelo funcionário e pelo
auditor davam resultados diferentes para os mesmos produtos.

Regra: **cálculo de domínio mora em `packages/shared` e tem teste.** Se dois lugares
precisam do mesmo número, eles importam a mesma função.

O pacote é puro de propósito — sem DOM, sem Firebase, sem rede. Isso o torna testável sem
mocks e utilizável tanto pelo PWA quanto por scripts Node.

## As três camadas do PWA

```
features/          ← telas. Sabem de UI e chamam contexts.
   │
contexts/          ← estado global. Orquestram lib/ e expõem para as telas.
   │
lib/               ← acesso a dados. Falam com Firestore/API. Zero UI.
```

Regra: **`features/` não importa `firebase/firestore` direto.** Todo acesso a dados passa
por `lib/*-repo.ts`. Assim o teto de tempo, a fila offline e o tratamento de conflito
acontecem num lugar só.

### Contexts

| Context | Guarda |
|---|---|
| `AuthContext` | usuário, perfil, papel, permissões |
| `EstoqueContext` | estoque atual, produtos em tempo real, ciclo, progresso, conexão, fila |
| `ToastContext` | mensagens ao usuário |

`EstoqueContext` é o maior (532 linhas) porque concentra o listener do Firestore, a
sincronização da fila e a gravação de contagem. Ele expõe `contextoLog`, pronto para
`registrar()`, para as telas não remontarem esse objeto.

### lib/

| Arquivo | Papel |
|---|---|
| `firebase.ts` | inicialização, cache persistente multi-aba |
| `firestore-write.ts` | **teto de tempo em toda escrita** — ver [offline.md](offline.md) |
| `produtos-repo.ts` | contagem, criação, lote, limpeza, conferência |
| `estoques-repo.ts` | metadados e ciclo |
| `auditorias-repo.ts` | snapshots salvos |
| `usuarios-repo.ts` | perfil e papéis |
| `historico.ts` | log de ações, com fila local |
| `fila-offline.ts` | alterações pendentes em localStorage |
| `conectividade.ts` | detecção de conexão real |
| `assinatura.ts` | **mantém os listeners de pé** — `onSnapshot` morre no primeiro erro |
| `pdf.ts` / `planilha.ts` | relatórios, por import dinâmico |
| `arquivo.ts` | dois caminhos: download (PDF) e Web Share (planilha) |
| `erp.ts` | cliente da API |

## A API

Três motivos para existir:

1. **Proxy do ERP** — tira o endereço do ERP do bundle e põe timeout, **retry** e
   tratamento de erro do lado do servidor. O retry (2 tentativas de 45s, 1s entre elas) é
   segurado pelo servidor, não pelo celular do funcionário no depósito. Repetir é seguro: a
   chamada grava quantidade absoluta, não incremento.
2. **Webhook** — recebe eventos do ERP; substitui o `webhook-server.js` do 1.x, que
   declarava um servidor HTTP mas rodava no navegador e nunca recebeu requisição
3. **Servir o PWA** — na Hostinger não há Apache na frente, então rota de SPA e cabeçalhos
   de cache acontecem no Fastify (`estaticos.ts`)

### O bundle

`apps/api/build.mjs` usa esbuild para produzir **`apps/api/dist/server.mjs`** com todas as
dependências embutidas. Rodar em produção precisa de exatamente dois caminhos:

```
apps/api/dist/server.mjs
apps/web/dist/
```

Sem `node_modules`, sem `npm install` no servidor, sem resolução de workspace. O motivo
está em [armadilhas.md](armadilhas.md) §503 sem log.

A extensão `.mjs` não é estética: ver [decisoes.md](decisoes.md) §Bundle em .mjs.

## Fluxo de uma contagem

```
funcionário digita e toca Salvar
   │
FormContagem.salvar()
   │
EstoqueContext.salvarContagem(produto, quantidade, validade)
   │
produtos-repo.atualizarProduto()
   │
   ├─ sem rede? → fila-offline.enfileirar() → devolve { sincronizado: false }
   │
   └─ com rede → runTransactionWithTimeout()
         │
         ├─ confere se outro aparelho gravou por cima → ConflitoProdutoError
         ├─ teto de 12s estourou → cai na fila
         └─ sucesso → { sincronizado: true }
   │
listener onSnapshot devolve o produto atualizado
   │
lista re-renderiza; historico.registrar() roda em segundo plano
```

O passo do log **não é aguardado**: o usuário já pode contar o próximo item.

## Publicação

`themis.grupoicebeer.com.br`, aplicação **Node.js** na Hostinger. O deploy é **disparado por
push no GitHub** — não há passo manual no painel.

```
git push origin main
      │
      ▼  a Hostinger detecta o push (source_type: git)
npm ci --include=dev && npm run build      ← build_script: build
      │
      ▼
node apps/api/dist/server.mjs              ← entry_file
      │
      ▼  ~2 a 3 minutos depois
themis.grupoicebeer.com.br no ar
```

| Ajuste | Valor |
|---|---|
| Node no servidor | **20** (local é 24 — ver o aviso do `npm run mapa`) |
| Script de build | `build` |
| Ponto de entrada | `apps/api/dist/server.mjs` |
| Origem | git |

Para confirmar que uma versão subiu:

```powershell
curl.exe https://themis.grupoicebeer.com.br/api/versao
```

Devolve versão, **commit** e data do build — o commit é o que responde com precisão qual
código está rodando.

⚠️ **O ponto de entrada é `.mjs`, não `.js`.** As quatro únicas implantações que já falharam
neste projeto (06/08/2026) foram todas por isso, antes de o caminho ser corrigido no painel.
Desde então são 17 seguidas sem falha. O motivo da extensão está em
[decisoes.md](decisoes.md) §Bundle em .mjs.

---

## Build

```
npm run build
  ├─ @themis/shared   tsc --build
  ├─ @themis/web      tsc --build && vite build   → apps/web/dist
  └─ @themis/api      tsc --build && node build.mjs → apps/api/dist/server.mjs
```

`tsc` no pacote da API roda só para checagem de tipos (emite em `dist-types`); quem produz
o executável é o esbuild.
