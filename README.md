# Themis 2.0

PWA de contagem e auditoria de estoque do Grupo Ice Beer. Reescrita do Themis 1.x
(Capacitor + JavaScript sem build) em Node/TypeScript.

**O banco é o mesmo.** Firestore do projeto `auditoria-icebeer`, mesmas coleções, mesmas
Security Rules. Nenhuma migração de dados — o 1.x e o 2.0 podem rodar em paralelo durante
a transição.

## Estrutura

```
apps/web/        PWA — React + Vite + TypeScript + vite-plugin-pwa
apps/api/        API — Fastify + TypeScript (proxy ERP, webhook, relatórios)
packages/shared/ Tipos e regras de negócio compartilhados
firestore/       Rules e índices versionados
```

## Rodando

```bash
npm install

cp apps/web/.env.example apps/web/.env    # preencher com o config do Firebase
cp apps/api/.env.example apps/api/.env    # preencher WEBHOOK_SECRET

npm run dev        # PWA em http://localhost:5173
npm run dev:api    # API em http://localhost:3000
```

Verificação:

```bash
npm run typecheck
npm run lint
npm test
```

## Decisões que não devem ser revertidas

**Contagem fala com o Firestore direto, sem passar pela API.**
A persistência offline do Firestore é o que faz o app funcionar em depósito com wifi
ruim. Colocar a API no caminho da contagem transformaria "servidor fora do ar" em "app
inutilizável". A API existe para o que precisa de servidor: ERP, webhook, relatório
pesado.

**Toda escrita no Firestore passa por `apps/web/src/lib/firestore-write.ts`.**
Com persistência offline, a promise de uma escrita só resolve quando o servidor confirma
— e em rede lenta ela nunca resolve nem rejeita. Um `await` direto trava a tela. Esse
módulo é o porte da correção 4.19.8 do Themis 1.x, que resolveu exatamente esse bug.
Detalhes no cabeçalho do arquivo.

**O cálculo de status vive só em `packages/shared/src/auditoria.ts`.**
No 1.x essa lógica estava duplicada em `app.js` e `auditoria.js` e as cópias divergiram:
uma nunca devolvia `CRITICO`. Auditoria salva pelo funcionário e pelo auditor davam
resultados diferentes. Há teste de regressão cobrindo isso.

**O service worker não cacheia tráfego do Firebase.**
O SDK já tem cache próprio em IndexedDB. Dois caches sobre o mesmo dado servem
informação velha achando que está fresca. Configurado como `NetworkOnly` no
`vite.config.ts`.

## Estado do porte

Feito:
- [x] Monorepo, TypeScript, lint, testes, CI
- [x] Tipos do domínio (`packages/shared`)
- [x] Cálculo de auditoria + estatísticas + snapshot, com testes
- [x] Firebase com cache persistente multi-aba
- [x] Escrita com teto de tempo (porte do 4.19.8)
- [x] API: proxy ERP, webhook autenticado, health
- [x] Deploy por push (GitHub Actions → Hostinger)

A portar (uma branch por item):
- [ ] Autenticação e papéis (`isMaster` / `isAdmin` / `isAuditor` / comum)
- [ ] Seleção de estoque e ciclo de contagem
- [ ] Tela de contagem: lista, filtros, card com quantidade e validade
- [ ] Leitor de código de barras (`BarcodeDetector` nativo)
- [ ] Fila offline de alterações + resolução de conflito
- [ ] Cadastro, importação e exportação de produtos (planilha)
- [ ] Painel de auditoria: estatísticas, filtros, correção
- [ ] Exportação PDF (contagem e validade)
- [ ] Histórico geral
- [ ] Finalizar e salvar contagem
- [ ] Integração ERP pelo proxy
- [ ] Migração dos usuários do APK para o PWA

## Deploy

Push na `main` dispara `.github/workflows/deploy.yml`.

Secrets necessários no repositório (Settings → Secrets → Actions):

| Secret | Para quê |
|---|---|
| `VITE_FIREBASE_*` (6) | Config do Firebase no build do PWA |
| `HOSTINGER_SSH_HOST` / `_USER` / `_PORT` / `_KEY` | Acesso SSH |
| `HOSTINGER_KNOWN_HOSTS` | Fingerprint do servidor (`ssh-keyscan -p PORTA HOST`) |
| `HOSTINGER_WEB_DIR` | Destino do PWA (ex: `~/public_html`) |
| `HOSTINGER_API_DIR` | Destino da API |
| `URL_HEALTHCHECK` | URL de `/api/health` para conferir o deploy |

O `.env` da API fica **no servidor**, nunca no repositório. O `rsync` da API é sem
`--delete` justamente para não apagá-lo.
