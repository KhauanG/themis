# Changelog

Formato: mais recente primeiro. Toda alteração de comportamento entra aqui.

Categorias: **Adicionado**, **Alterado**, **Corrigido**, **Removido**, **Segurança**.

---

## 2.6.1 — 2026-08-06

### Corrigido

- **Auditoria e Histórico recarregavam sozinhos.** O `useEffect` dependia do objeto
  `estoqueAtual`, não do id. O objeto ganha identidade nova toda vez que o listener de
  `inventories` re-emite — o que acontece quando a conexão se restabelece, e em wifi de
  depósito isso é frequente. O id nunca mudava; só a referência.

  Agora dependem do id. E a rebusca não troca mais dado bom por esqueleto: ele só aparece
  quando o recorte muda de verdade.

---

## 2.6.0 — 2026-08-06

### Adicionado

- **Estoques permitidos por usuário**, como no 1.x. O master marca quais estoques cada
  pessoa enxerga, na tela de Usuários. Lista vazia = todos, que é o padrão de quem nunca
  foi configurado — inverter isso trancaria a equipe inteira para fora no dia da migração.
- 16 testes de `acesso-estoque.ts`.

### Alterado

- **O perfil passou a ser acompanhado em tempo real.** No 1.x, promover alguém ou mudar
  seus estoques só valia depois de fechar e abrir o app, e ninguém avisava o usuário. Agora
  a alteração feita pelo master chega ao celular na hora.
- Se o estoque aberto deixar de ser permitido, o app troca para o primeiro permitido e
  avisa — em vez de ficar sem contexto.

### Nota de segurança

⚠️ Isto é **escopo de interface, não barreira de segurança**: as Security Rules liberam
qualquer estoque para quem está autenticado, e são compartilhadas com o 1.x. Serve para
evitar erro humano — contar no estoque errado —, não para impedir acesso. Registrado em
[seguranca.md](seguranca.md), com o caminho para endurecer em [pendencias.md](pendencias.md).

---

## 2.5.0 — 2026-08-06

### Adicionado

- **Histórico vira trilha de auditoria de verdade.** Antes mostrava `de: 12 · para: 15`,
  que não responde "o que mudou". Agora cada evento traz o alvo e as alterações no formato
  `QUANTIDADE 12 → 15`, com o valor antigo riscado e o novo em destaque. Agrupado por dia.
- `packages/shared/src/historico-descricao.ts` — formatação de todas as ações, função pura
  com 20 testes. A tela só desenha o que sai de lá.
- **Oito ações que não eram registradas passaram a ser**: `LOGIN`, `CRIAR_PRODUTO`,
  `EDITAR_PRODUTO`, `EXCLUIR_PRODUTO`, `CRIAR_ESTOQUE`, `EDITAR_ESTOQUE`, `CONFERIR_ITEM`,
  `ALTERAR_PAPEL` e `ALTERAR_CONFIGURACAO`. Alterar o papel de um usuário, travar um
  estoque ou apagar um produto não deixava rastro nenhum.

### Alterado

- A conferência do admin virou `CONFERIR_ITEM` e grava o **nome** do produto, não só o id
  — quem abre o histórico meses depois não sabe qual produto era `xK92mFq`.
- Ações destrutivas ganharam cor vermelha na etiqueta; a paleta acompanha os tokens.

---

## 2.4.0 — 2026-08-06

### Corrigido

- **`hashConfigs` era lido no formato errado.** No banco é **um documento só**
  (`hashConfigs/inventoryHashes`) com um mapa `{ inventoryId: hash }`; o código procurava
  documentos soltos com campo `hashLoja`. Nunca achava nada, e "Corrigir estoque" falhava
  sempre com "Nenhum HashLoja configurado", mesmo com tudo certo no banco.

### Adicionado

- **HashLoja na tela de estoques**, com botão de testar. Hash errado devolve lista vazia
  em vez de erro, então o teste só passa se o ERP devolver ao menos um produto. A lista
  mostra `ERP ligado` ou `sem HashLoja` em cada estoque. ⚠️ Editar o hash exige **master** —
  é o que a regra do Firestore permite.
- **Buscar estoque** como ação própria: lê o saldo do ERP e grava em `estoqueSistema`, sem
  enviar nada. É a primeira fase do Corrigir estoque, isolada — serve para conferir a
  divergência antes de decidir corrigir.
- **Editar e excluir produto**, pelo card da contagem (admin) e exclusão só para master.
  Altera nome, código de barras, saldo do sistema e código do ERP. Não toca em
  `quantidade` nem `productStatus`: corrigir um nome não pode apagar o trabalho do
  funcionário.
- **Modo contagem** (`appSettings/global`): bloqueia importar planilha e limpar contagem
  **mesmo para admin**, para ninguém apagar a contagem no meio da operação. Em tempo real —
  ligar no escritório reflete no celular do depósito sem recarregar.
- **Estoques somente leitura**: trava a contagem por estoque, com etiqueta na lista e
  aviso no card.

---

## 2.3.0 — 2026-08-06

### Adicionado

- **Corrigir estoque completo, com as três fases do 1.x.** A versão anterior só enviava as
  divergências; faltavam as duas leituras do ERP.

  1. **Ler antes** — busca o saldo atual e grava em `estoqueSistema`. Sem isso a comparação
     usaria o saldo da última importação: mandaria corrigir item que já batia e deixaria
     passar divergência surgida desde então.
  2. **Enviar** só as divergências, com pausa de 500 ms.
  3. **Verificar depois** — espera 1,5 s, relê o ERP e confere item a item se o saldo ficou
     igual ao enviado. O que não refletiu vira pendência listada com "enviado" e "no ERP",
     com botão de reenviar.

  Sem a fase 3, um envio aceito pelo ERP mas não aplicado passava despercebido, e o estoque
  ficava errado com todo mundo achando que tinha sido corrigido.

  A confirmação passou para **entre as fases 1 e 2**, com os números já corrigidos pela
  leitura — perguntar antes mostrava dado velho.

- `GET /api/erp/estoque/:hashLoja` — proxy da listagem de estoque do ERP, com timeout de
  45 s e desembrulho dos três formatos de resposta que o ERP usa (`array`, `{data}`,
  `{items}`).
- `chavesDeIdProduto()` — casa o produto com a listagem do ERP tolerando `"007"`, `"7"` e
  `7` como o mesmo identificador. Sem isso o app concluiria que metade do estoque não
  existe no ERP.
- 13 testes de `produto.ts`, cobrindo o casamento de identificador e os campos legados.

---

## 2.2.0 — 2026-08-06

### Corrigido

- **O nome do estoque aparecia como o ID.** No banco os campos são `name` e `description`,
  em inglês — herdado do 1.x, e é o que `validInventoryData` exige. O repositório lia
  `nome`/`descricao`, caía no fallback e mostrava o identificador gerado. Era a origem dos
  "nomes genéricos com números".

### Adicionado

- **Filtros da auditoria no cabeçalho**: situação (todos / contados / não contados),
  status, ordenação (nome, maior diferença, menor diferença, gravidade) e um interruptor
  de "só divergências".
- **A exportação leva o recorte da tela.** PDF e planilha saem com os mesmos itens, na
  mesma ordem. O PDF **declara o recorte** no cabeçalho, em faixa azul gelo, com "40 de
  2000 itens" — sem isso, quem recebe um relatório parcial conclui que o estoque tem 40
  itens.
- **Corrigir estoque** (`TelaProdutos`), porte do fluxo do 1.x: envia ao ERP **só os itens
  divergentes** e depois fecha a conferência de **todos** os contados, marcando
  `CONFERIDO` com `corrigidoIncorreto` e `corrigidoCritico`. Substitui "Enviar contagem ao
  ERP", que só fazia a primeira metade e mandava tudo — 2000 requisições para resolver 40
  problemas.
- **Tela de estoques**: criar, renomear e excluir. Exclusão apaga os produtos em lote
  antes do documento — o Firestore não remove subcoleções junto com o pai, e apagar só o
  estoque deixaria milhares de produtos órfãos, invisíveis e cobrados para sempre. Exige
  digitar o nome, é só para master, e não permite excluir o estoque aberto.
- 20 testes do filtro de relatório.

### Alterado

- **Paleta da marca**: azul escuro, azul gelo e amarelo, nos dois temas. O amarelo é o
  alerta — encaixa no significado em vez de ser decoração. Nunca como texto sobre branco:
  fica como preenchimento, com âmbar escuro por cima.
- Logo do Themis no cabeçalho.
- PDF com faixa da marca no topo e paleta acompanhando os tokens.

---

## 2.1.0 — 2026-08-06

Reconstrução visual completa. Identidade empresarial, referência nas interfaces da Apple.
Sem mudança de comportamento: nenhuma regra de negócio, gravação ou permissão foi alterada.

### Adicionado

- **Sistema de design** em `apps/web/src/estilos/` — tokens, base, componentes, telas.
  Documentado em [design.md](design.md)
- **Tema claro como padrão, escuro de verdade.** Não é inversão automática: as cores de
  estado são recalibradas, porque os tons do modo claro não têm contraste em fundo escuro
- **Menu principal em folha**, agrupado por finalidade (Contagem, Relatórios, Gestão,
  Conta), montado a partir das permissões. Item que o papel não permite não aparece —
  nem desabilitado, nem com cadeado
- **14 ícones SVG inline** (`components/Icone.tsx`), sem biblioteca
- Seletor de estoque em modal, no lugar do `<select>` no cabeçalho
- Painel de progresso com número grande, barra e contagem de pendentes
- Diferença calculada ao vivo no formulário, enquanto o usuário digita

### Alterado

- **Abas por papel**: comum não vê aba nenhuma (só a contagem); auditor vê duas; admin e
  master, três. Histórico e Usuários passam a viver só no menu — com eles nas abas, um
  master teria cinco disputando a largura do celular
- Filtros viraram controle segmentado com contador
- Card de produto: barra de estado fina à esquerda no lugar de borda colorida; etiquetas
  de validade e diferença no lugar de texto solto
- Telas de produtos e auditoria: ações viraram lista com ícone, título e descrição —
  "Limpar contagem" agora diz o que apaga antes de ser tocado
- **PDFs redesenhados**: régua fina no lugar de zebrado, resumo em métricas, cor só na
  coluna de status, rodapé com paginação
- `theme_color` e `background_color` do manifesto acompanham o tema claro; o HTML declara
  `theme-color` por esquema de cor

### Removido

- `BannerOffline` — substituído por `FaixaConexao`, que some quando está tudo em dia.
  Faixa permanente vira mobília e ninguém mais lê

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
