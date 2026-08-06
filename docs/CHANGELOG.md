# Changelog

Formato: mais recente primeiro. Toda alteração de comportamento entra aqui.

Categorias: **Adicionado**, **Alterado**, **Corrigido**, **Removido**, **Segurança**.

---

## 2.0.1 — 2026-08-06

Validado em celular Android real contra o Firestore de produção: login, contagem, leitor
de código de barras, instalação como app, rota de SPA, modo avião e drenagem da fila ao
reconectar.

### Corrigido

- **Produto contado offline aparecia como não contado.** Em modo avião o toast dizia
  "salvo no aparelho", mas o card seguia com traço e a aba "A contar" não diminuía; ao
  voltar a rede os valores "pulavam" para o certo.

  Offline, `atualizarProduto` só enfileira — não escreve no Firestore. O cache local não
  muda, o `onSnapshot` não dispara e a tela fica com o valor antigo. O mesmo acontecia
  online com rede lenta, quando a transação estoura o teto.

  Grave porque o usuário não tinha como saber se a contagem entrou, e recontaria — o
  oposto do que o app precisa fazer justamente quando a rede está ruim.

  `aplicarPendentes()` passa a sobrepor a fila na lista antes de renderizar. O
  `lastModified` exibido vem da hora da edição, para o item não cair no fim da aba
  "Contados". 9 testes.

### Alterado

- `REMOVER` e `aplicarPendentes` saíram de `produtos-repo.ts` para `fila-offline.ts`. Os
  dois existem por causa da serialização da fila, não do Firestore — e assim são testáveis
  sem variáveis de ambiente.

---

## 2.0.0 — 2026-08-06

Primeira versão no ar em `themis.grupoicebeer.com.br`. Reescrita completa do Themis 1.x
(Capacitor + JavaScript sem build) como PWA em Node/TypeScript.

**O banco não mudou.** Mesmo projeto Firestore `auditoria-icebeer`, mesmas coleções, mesmas
Security Rules. O 1.x continua em produção lendo o mesmo banco.

### Adicionado

- PWA instalável, com atualização automática no próximo carregamento
- Leitor de código de barras com `BarcodeDetector` nativo do Chrome Android
- Barra de progresso da contagem e contador por aba
- Aba "A contar", que não existia no 1.x
- Etiqueta de validade no card: âmbar a 30 dias, vermelha se vencida
- Fluxo de conferência do admin no painel de auditoria, com desfazer
- Tela de gestão de papéis de usuário (master)
- Limite de erro: falha de renderização não deixa mais tela branca
- Esqueletos de carga no lugar de spinner
- API Fastify: proxy do ERP, webhook autenticado, healthcheck
- `scripts/auditar-produtos.mjs` — varredura de produtos legados que as regras recusariam
- 77 testes automatizados (o 1.x tinha zero)
- CI: typecheck, lint e testes em cada pull request

### Alterado

- Distribuição: de APK/AAB na Play Store para PWA por URL
- Bundle inicial: de ~2,5 MB de bibliotecas soltas para 826 KB (219 KB comprimido)
- `jspdf` e `exceljs` por import dinâmico, fora do precache — precache de 2,79 MB para 1,08 MB
- Cache do Firestore: de `enablePersistence` single-tab para `persistentMultipleTabManager`
- Aviso de offline: de overlay bloqueante para faixa fina
- Um processo Node serve o PWA e a API na mesma origem

### Corrigido

Herdados do 1.x:

- **`CRITICO` sumia da auditoria** salva pela tela do funcionário. A lógica estava
  duplicada e as cópias divergiram. Agora existe em um lugar só, com teste de regressão.
- **Aba "Contados" era por aparelho.** Com 5 celulares, cada um via só o que ele mesmo
  contou. Agora sai de `productStatus`, que vem do servidor.

Encontrados durante o porte:

- **O campo perdia o que estava sendo digitado** quando qualquer outro aparelho salvava
- **A câmera do leitor reabria sem parar** a cada render
- **Exportar com auditoria salva selecionada** gerava o arquivo com a contagem ao vivo
- **Importação de planilha inviável**: uma escrita por produto, com teto de 8s cada. Agora
  em lotes de 500
- **Vazamento de estado** no `EstoqueProvider`: a carga inicial podia resolver depois do
  desmonte
- **Contagem das abas** rodava 8 ordenações sobre a lista inteira a cada snapshot

De implantação:

- **`tsc: command not found`** — `NODE_ENV=production` fazia o npm omitir devDependencies.
  Resolvido com `.npmrc` `include=dev`
- **503 sem log** — `node_modules` não sobrevivia à cópia da hospedagem. A API virou bundle
  único sem dependências em runtime
- **Bundle ESM em `.js`** — Node 20 assumiria CommonJS sem o `package.json` vizinho.
  Passou a ser `.mjs`
- **`PORT` não numérico** derrubava o processo antes de existir logger. Passa a aceitar
  socket Unix

### Segurança

- Webhook com segredo comparado em tempo constante; 503 quando não configurado
- Rate limit em `/api/*`, isentando os arquivos do PWA
- Endereço do ERP sai do bundle do navegador
- `react-router-dom` fixado em `^7.18.2` — ver o raciocínio no README

### Não portado

- Cadastro e exclusão de usuário pelo app — continua no Console do Firebase
- Suporte a iOS — nenhum auditor usa iPhone

---

## Modelo para a próxima entrada

```markdown
## X.Y.Z — AAAA-MM-DD

### Adicionado
- 

### Alterado
- 

### Corrigido
- **Sintoma.** Causa e correção.

### Segurança
- 
```
