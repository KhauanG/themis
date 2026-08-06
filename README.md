# Themis 2.0

PWA de contagem e auditoria de estoque do Grupo Ice Beer. Reescrita do Themis 1.x
(Capacitor + JavaScript sem build) em Node/TypeScript.

**O banco é o mesmo.** Firestore do projeto `auditoria-icebeer`, mesmas coleções, mesmas
Security Rules. Nenhuma migração de dados — o 1.x e o 2.0 rodam em paralelo durante a
transição.

> ## 📚 A documentação fica em [`docs/`](docs/README.md)
>
> Comece por [docs/README.md](docs/README.md). Antes de mexer em qualquer coisa, leia
> [docs/armadilhas.md](docs/armadilhas.md) — cada item ali custou tempo real de alguém.
>
> **Alteração de comportamento sem alteração de documentação é alteração incompleta.**
>
> Agentes e ferramentas de IA: [CLAUDE.md](CLAUDE.md).

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

**"Contado nesta rodada" sai de `productStatus`, não de rastreamento local.**
O 1.x mantinha uma subcoleção `updatedItems` e um `Set` em memória só para a aba
"Contados". Era redundante — `productStatus === 'ATUALIZADO'` já é essa informação, vem do
servidor e é igual em todos os aparelhos. Guardar isso no aparelho fazia cada um dos 5
celulares ver só o que ele mesmo contou.

**Nunca gravar `null` nem `'PENDENTE'` em produto.**
As Security Rules exigem `quantidade is number`, `codigoBarras is string`, `dataValidade
is string` e `productStatus in ['ATUALIZADO','CONFERIDO']`. "Não contado" é a **ausência**
do campo: limpar contagem remove `productStatus`/`dataValidade`/`corrigidoIncorreto` com
`deleteField()` e deixa `quantidade: 0`. Como o sentinela `deleteField()` não sobrevive ao
JSON da fila offline, o chamador usa a constante `REMOVER` de `produtos-repo.ts` e a
conversão acontece na hora de gravar.

**Tela e exportação saem da mesma `LinhaRelatorio[]`.**
Contagem ao vivo e auditoria salva são normalizadas por `linhasDeProdutos` /
`linhasDeSnapshot` antes de chegar em tabela, PDF ou planilha. Quando cada saída lia sua
própria origem, selecionar uma auditoria antiga e exportar gerava o arquivo com a contagem
atual. Há teste de paridade entre os dois caminhos.

**A API é empacotada num arquivo único.**
`apps/api/build.mjs` roda o esbuild e produz `apps/api/dist/server.js` com todas as
dependências embutidas. Em produção, rodar o Themis precisa de exatamente dois caminhos —
esse arquivo e `apps/web/dist/` — sem `node_modules`, sem `npm install` no servidor e sem
resolução de workspace. A hospedagem compila num diretório e copia o resultado para outro;
quando o `node_modules` não sobrevivia à cópia, o processo morria no primeiro `import` e o
sintoma era `503 Service Unavailable` sem nada no log, porque nem chegava a existir logger.

## Avisos do `npm audit` que ficam abertos de propósito

`npm audit --omit=dev` acusa 4 (2 high). Os quatro foram avaliados e **não se aplicam** ao
nosso uso. Antes de "corrigir" qualquer um, leia aqui — as correções óbvias pioram a
situação.

**`react-router` / `react-router-dom` (high) — RSC Mode CSRF Bypass.**
Atinge o React Server Components mode com server actions. O Themis é SPA estático com
`BrowserRouter`: não há RSC, server action nem rota com `action`.

Fique em **`^7.18.2`**. Não baixe a versão. As faixas de aviso se cruzam: 7.11.0 escapa
deste, mas cai em 14 outros, entre eles *open redirect via backslash em `<Link>` e
`useNavigate`* e *open redirect leading to XSS* — esses **atingem SPA de verdade**, e
usamos `NavLink` e `Navigate`. Não existe versão 7.x livre dos dois grupos; a mais nova é
a menos exposta.

**`exceljs` / `uuid` (moderate) — falta de checagem de limites em `uuid` v3/v5/v6 quando
`buf` é passado.**
O `npm audit fix` sugere **baixar** `exceljs` de 4.4 para 3.4, o que é um retrocesso
grande. Nem nós nem o exceljs passamos `buf`. Fica como está até sair `exceljs` com `uuid`
atualizado.

## Estado do porte

Portado e verificado (typecheck + lint + 56 testes + build):
- [x] Monorepo, TypeScript, lint, testes, CI
- [x] Domínio compartilhado: tipos, status de auditoria, estatísticas, filtros, papéis
- [x] Firebase com cache persistente multi-aba
- [x] Escrita com teto de tempo (porte do 4.19.8)
- [x] Fila offline com detecção de conflito e deduplicação
- [x] Autenticação e papéis (`isMaster` / `isAdmin` / `isAuditor` / comum)
- [x] Seleção de estoque e ciclo de contagem
- [x] Tela de contagem: lista, filtros, busca, card com quantidade e validade
- [x] Leitor de código de barras (`BarcodeDetector` nativo)
- [x] Cadastro e importação de planilha
- [x] Painel de auditoria: ao vivo e auditorias salvas, estatísticas, filtro por status
- [x] Exportação PDF (contagem e validade) e planilha
- [x] Histórico geral
- [x] Finalizar e salvar contagem
- [x] Integração ERP pelo proxy da API
- [x] API: proxy ERP, webhook autenticado, health
- [x] Deploy por push (GitHub Actions → Hostinger)

- [x] Fluxo de conferência do admin (`CONFERIDO` / `corrigidoIncorreto`, com desfazer)
- [x] Gestão de papéis dos usuários (master)
- [x] Limite de erro, foco preso no modal, esqueletos de carga, barra de progresso

- [x] Varredura de produtos legados (`npm run auditar-produtos`, somente leitura)
- [x] Publicado em `themis.grupoicebeer.com.br` (2026-08-06)
- [x] Varredura rodada em produção — **base limpa**, nada a corrigir (2026-08-06)
- [x] Documentação completa em [`docs/`](docs/README.md)

- [x] Validado em celular Android real: câmera, instalação, rota de SPA, offline e
      drenagem da fila (2026-08-06)

Pendências, com o contexto para retomar: [docs/pendencias.md](docs/pendencias.md)

1. Migrar a equipe do APK para o PWA — **é o que fecha o projeto**
2. Cabeçalhos de segurança no Fastify
3. Criar e excluir usuário pelo app

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
