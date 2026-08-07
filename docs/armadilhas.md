# Armadilhas

Cada item aqui custou tempo real de alguém. Leia antes de mexer na área correspondente.

Formato: **sintoma** → **causa** → **como evitar**.

---

## Firestore

### "Não salva" para alguns produtos, e só para alguns

**Sintoma.** O funcionário conta, toca Salvar, nada acontece. Fecha e abre o app e o valor
está lá — ou nem isso. Só com certos produtos.

**Causa.** As Security Rules validam o documento **resultante** de qualquer update. Um
produto legado com `corrigidoIncorreto: null` ou `lastModified` gravado como texto é
recusado, **mesmo que o campo alterado seja outro**.

**Evitar.** Nunca gravar `null`. Rodar `npm run auditar-produtos` antes de liberar para a
equipe. Detalhes em [dados.md](dados.md) §Regras de tipo.

### `productStatus: 'PENDENTE'` é negado

**Causa.** A regra só aceita `['ATUALIZADO', 'CONFERIDO']`. Parece razoável ter um
`'PENDENTE'`, e é justamente o que quebra.

**Evitar.** "Não contado" é a **ausência** do campo. Use `deleteField()`.

### A escrita de metadados do estoque é negada para usuário comum

**Sintoma.** A partir de um deploy de regras, nenhum funcionário comum consegue mais
gravar. Antes funcionava.

**Causa.** `Timestamp` do Firestore **não é `instanceof Date`**. O código caía no fallback
`new Date()` e reescrevia `createdAt` a cada gravação. A regra libera só os campos de ciclo
para usuário comum; o `createdAt` no payload fazia o `hasOnly` falhar e negava tudo.

**Evitar.** Converter com `.toDate()`, nunca regenerar. Enviar **só** os campos que a regra
libera.

### `deleteField()` desaparece na fila offline

**Sintoma.** Alteração feita offline sobe ao reconectar, mas o campo que deveria sumir
continua lá.

**Causa.** `deleteField()` é um objeto. `JSON.stringify` o transforma em `{}`.

**Evitar.** Usar a constante `REMOVER` (string) de `produtos-repo.ts`. A conversão para
`deleteField()` acontece só na hora de gravar. Há teste.

### O deploy de índices oferece apagar índices do 1.x

**Sintoma.** `Would you like to delete these indexes?` listando `historico_geral` por
`userId` e por `action`.

**Causa.** O arquivo de índices é tratado como a verdade. O que existe no projeto e não
está nele é oferecido para remoção.

**Evitar.** Responder **`N`**. Os dois são do Themis 1.x, que continua em produção. Já
estão listados no arquivo; se a pergunta voltar, alguém criou índice pelo Console —
traga-o para o arquivo.

---

## ERP

### `net::ERR_BLOCKED_BY_CLIENT` no Firestore

**Sintoma.** No console, `POST .../google.firestore.v1.Firestore/Write/channel` falha com
`ERR_BLOCKED_BY_CLIENT`. Gravações estouram o teto (`Teto de 20000ms atingido em "importar
planilha"`). O app parece funcionar porque a persistência local aceita tudo.

**Causa.** **Não é o código.** `ERR_BLOCKED_BY_CLIENT` só existe quando algo no navegador
cancela a requisição: bloqueador de anúncios, escudo do Brave, antivírus com filtro web,
extensão de privacidade. `firestore.googleapis.com` entra em várias listas de bloqueio.

**Por que é perigoso.** A escrita fica no cache local e o `onSnapshot` dispara: **a tela
mostra o valor novo**. Só que ele nunca chegou ao servidor, ninguém mais vê, e um `clear
site data` apaga o trabalho.

**Evitar.** Testar em aba anônima sem extensões, ou liberar `firestore.googleapis.com` e
`*.googleapis.com` no bloqueador. O aviso de `firestore-write.ts` é o sintoma correto sendo
reportado — não o silencie.

### "Buscar estoque" traz saldo diferente do Nuvem3

**Sintoma.** O saldo na tela não bate com o que o Nuvem3 mostra, conferindo lado a lado.

**Causa mais provável.** A listagem foi descartada e ninguém percebeu. O nome dos campos da
resposta **varia** — `idproduto`, `IdProduto`, `idProduto`, `IdProdutoERP` para o id;
`quantidade`, `Quantidade`, `EstoqueAtual` para a quantidade. Lendo só uma grafia, nada
casa, o saldo continua sendo o da **última importação**, e a comparação com o Nuvem3 acusa a
diferença — que é real, só que a culpa não é do ERP.

**Evitar.** Ver a resposta crua antes de teorizar:

```
npx tsx scripts/diagnosticar-erp.mts <hashLoja> 30289733
npx tsx scripts/diagnosticar-erp.mts <hashLoja> --planilha planilhaprodutos.xlsx
```

A primeira forma mostra quantos itens vieram, **quais campos** existem, quantos ficaram sem
identificador, e a quantidade dos produtos consultados. O HashLoja está na tela Estoques.

A segunda cruza o catálogo inteiro: **um produto ausente não diz nada; o conjunto dos
ausentes diz.** Se todos estavam zerados na planilha, o ERP filtra zerados. Se há ausentes
com saldo positivo, o motivo é outro.

Outras causas que o script separa:

- **Produto zerado no ERP não vem na listagem.** `EstoqueQuantidadePorLojaListar` só devolve
  saldo positivo. Ausência aí significa **zero**, não "desconhecido" — e tratar como
  desconhecido deixa o saldo da última importação na tela justamente nos produtos que mais
  precisam de correção. O app deduz isso da própria resposta (`omiteZerados`: 50+ itens e
  nenhum com saldo `<= 0`) e grava `estoqueSistema: 0`. O script imprime a contagem de zeros
  e negativos e diz a conclusão.
- **HashLoja errado** — devolve lista vazia em vez de erro.
- **Identificador repetido** — se o ERP manda uma linha por depósito, o app grava a última
  ocorrência (como o 1.x) e o Nuvem3 pode estar mostrando a soma. O script imprime as duas.
- **`IdProduto` do catálogo diferente do da listagem** — aparece como "fora do ERP".

⚠️ Zero produtos casados é **erro**, nunca "tudo já estava igual". A tela já disse a segunda
coisa quando era a primeira; é por isso que `atualizarEstoqueSistema` devolve `casaram`
separado de `atualizados`.

### O payload do ERP não é negociável

**Sintoma.** O envio falha com 400, ou é aceito e não reflete no sistema.

**Causa.** O contrato tem **oito campos** e o `IdProduto` é **inteiro**. O porte inicial
mandava quatro campos e o id em texto. API .NET recusa `"123"` num campo `int` por padrão,
e campo omitido pode significar "não mexe" ou "zera" — a diferença entre os dois é o preço
do produto no sistema.

**Evitar.** Montar sempre com `montarEnvio()` de `@themis/shared`. Nunca escrever o objeto
à mão. A referência é o `sendToERP` do 1.x, que rodou anos em produção — é a única prova
que temos do que a Nuvem3 aceita, e não dá para descobrir o resto testando contra o estoque
real da empresa.

### Produto some da correção sem aparecer em lugar nenhum

**Sintoma.** Um item divergente não é enviado ao ERP e não aparece como erro. Some. O
contador de "sem correspondência no ERP" está alto sem explicação.

**Causa.** `"007"`, `"7"` e `7` são o mesmo produto. O mapa da leitura estava indexado por
uma grafia só, então `chavesDeIdProduto(7)` (que é `["7"]`) nunca alcançava a entrada
`"007"`. O 1.x indexava por **todas** as grafias no `buildApiStockMap`.

**Evitar.** Consultar o mapa do ERP **só** por `saldoNoErp()`. `estoque.get(String(id))` é
o bug. E o mapa tem mais entradas do que produtos: para contar, use `leitura.itens`, nunca
`estoque.size`.

### HTTP 200 do ERP não quer dizer que ele aceitou

**Causa.** Ele responde `200` com `{ success: false }` ou `{ erro: "..." }` quando recusa
por regra de negócio.

**Evitar.** `erroDeNegocio()` inspeciona o corpo antes de declarar sucesso. Conservador de
propósito: só acusa quando o corpo sinaliza explicitamente, porque falso positivo faria o
app reenviar item que o ERP já gravou.

### O teto do navegador precisa cobrir o retry do servidor

**Sintoma.** Itens entram como falha de envio, mas aparecem corretos no ERP depois.

**Causa.** O retry mora na API (4 tentativas × 10s + pausas ≈ 43s). Com o teto de 15s no
navegador, o `fetch` abortava no meio da segunda tentativa — o servidor seguia trabalhando
e o app já tinha contado como erro.

**Evitar.** Mexeu no orçamento de retry da API? Ajuste `TIMEOUT_MS` em `lib/erp.ts` junto.
Os dois números são um só.

---

## Planilha

### `Cannot set properties of undefined (setting 'sheetNo')`

**Sintoma.** A importação estoura com essa mensagem. A planilha abre normalmente no Excel.
Planilha salva pelo Excel importa sem problema; a do ERP não.

**Causa.** O ERP gera OOXML em duas formas que o `exceljs` não implementa, e as duas são
válidas pela especificação:

1. **Prefixo de namespace nos elementos** — `<x:worksheet>`, `<x:row>`, `<x:c>`. O parser
   compara nome de elemento por igualdade literal (`node.name === 'worksheet'` em
   `worksheet-xform.js`), sem resolver namespace. Nada casa, o xform devolve `undefined`, e
   o erro que aparece é sobre `sheetNo`.
2. **Alvo absoluto nas relações** — `Target="/xl/worksheets/sheet1.xml"`. O `exceljs`
   resolve o alvo relativo à pasta do `.rels`.

O 1.x nunca esbarrou nisso porque usava SheetJS, que trata as duas.

**Evitar.** `planilha-formato.ts` normaliza o pacote antes de entregá-lo ao `exceljs`. Se
aparecer uma terceira forma, ela entra lá — não troque de biblioteca sem medir.

Para conferir contra uma planilha de verdade, sem tocar no Firestore:

```
npx tsx scripts/verificar-planilha.mts planilhaprodutos.xlsx
```

⚠️ Planilhas do ERP são o catálogo da empresa: `.xlsx`, `.xls` e `.csv` estão no
`.gitignore`. Não versione a do cliente para usar em teste — o teste automatizado monta um
arquivo sintético no mesmo dialeto.

### Reimportar duplica o catálogo

**Causa.** Importação que só cria. O 1.x fazia upsert por `IdProduto`.

**Evitar.** `importarProdutos()` atualiza quem já existe e **preserva a contagem em
andamento**. Produto contado mantém `quantidade` e `productStatus`; a planilha atualiza o
cadastro, não a contagem.

### A importação precisa trazer preço

Parece dado inútil — o Themis não mostra preço em tela nenhuma. Mas `PrecoVenda`,
`PrecoCusto` e `EstoqueMinimo` **fazem parte do payload que o ERP espera** na correção de
estoque. Descartá-los na importação faz toda correção mandar `0` para produto que tem preço
cadastrado. Ver [funcionalidades.md](funcionalidades.md) §O contrato com o ERP.

---

## Interface

### O campo perde o que está sendo digitado

**Sintoma.** O funcionário digita a quantidade e o campo zera sozinho.

**Causa.** Um `useEffect` que preenchia os campos dependia do objeto `produto`. A identidade
dele muda a cada snapshot do Firestore — bastava **outro aparelho** salvar **qualquer**
item.

**Evitar.** Formulário em componente separado, que **monta** ao abrir e lê o valor inicial
uma vez no `useState`. É o que `FormContagem` faz.

### Produto contado offline aparece como não contado

**Sintoma.** Em modo avião o funcionário conta, o toast diz "salvo no aparelho", mas o card
continua mostrando traço e a aba "A contar" não diminui. Ao voltar a rede, os produtos
"pulam" para o valor certo.

**Causa.** Offline, `atualizarProduto` **só enfileira** — não escreve no Firestore. O cache
local não muda, o `onSnapshot` não dispara, a tela fica com o valor antigo. Acontece
também online com rede lenta, quando a transação estoura o teto.

**Por que é grave.** O usuário não tem como saber se a contagem entrou. Ele reconta — e o
trabalho dobra, exatamente no cenário em que o app precisa ser confiável.

**Evitar.** `aplicarPendentes()` sobrepõe a fila na lista antes de renderizar. Qualquer
caminho novo que enfileire sem escrever no Firestore precisa passar por lá.

### A tela recarrega sozinha, sem ninguém mexer

**Sintoma.** A auditoria (ou o histórico) termina de carregar e, do nada, o esqueleto volta
e ela recarrega. Ninguém tocou em nada.

**Causa.** O `useEffect` dependia do **objeto** `estoqueAtual`, não do id. Esse objeto ganha
identidade nova toda vez que o listener de `inventories` re-emite — o que acontece quando a
conexão se restabelece. Em wifi de depósito, isso é frequente. O id nunca mudou; só a
referência.

**Evitar.** Em dependência de efeito, use o **id** (`estoqueAtual?.id`), não o objeto.
Objeto vindo de listener do Firestore nunca é estável.

E, na rebusca, **não troque dado bom por esqueleto**: mostre o esqueleto só quando o
recorte muda de verdade. Um `useRef` com a última chave carregada resolve.

⚠️ Não faça essa checagem dentro de um atualizador de estado (`setX(atual => {...})`) —
atualizador precisa ser puro, e o StrictMode o invoca duas vezes.

### No celular, cada letra digitada fecha o teclado

**Sintoma.** Num modal (renomear estoque, cadastrar produto, digitar FINALIZAR), o usuário
toca uma tecla do teclado virtual e o foco pula para o **botão de fechar**. O teclado some.
Para escrever "Depósito" é preciso tocar no campo antes de cada letra.

**Causa.** Duas, somadas:

1. O `useEffect` do `Modal` tinha `onFechar` nas dependências. Quase toda chamada passa uma
   arrow inline (`onFechar={() => setForm(null)}`), que ganha identidade nova a cada render
   do pai. Como o valor do campo é estado do pai, **cada tecla** re-renderizava, remontava o
   efeito, e a limpeza + reexecução mexiam no foco.
2. O foco inicial ia para `querySelector(FOCAVEIS)` — o **primeiro focável**, que é o ✕ do
   cabeçalho, por vir antes no DOM.

**Evitar.** Duas regras, e valem para qualquer efeito:

- Callback vindo de prop **não entra nas dependências** de um efeito que só deve rodar ao
  montar. Guarde num `useRef` e chame `ref.current()`. É a mesma família do bug de
  [objeto de listener na dependência](#a-tela-recarrega-sozinha-sem-ninguém-mexer).
- Foco inicial vai para o primeiro **campo** (`input`/`textarea`/`select`), nunca para o
  primeiro focável. Mandar o usuário para o botão de cancelar a própria ação é o oposto do
  que ele quer.

### Um item recusado trava a fila offline inteira

**Sintoma.** Contagens param de subir. A tela diz "salvo no aparelho" e o contador de
pendentes só cresce. Nada de errado com a rede.

**Causa.** Gravação negada por `permission-denied` era tratada como falha de rede e ia para
a fila. E `drenarFila` **para no primeiro erro** — de propósito, para não queimar bateria
com a rede caída. Um item recusado bloqueava tudo o que viesse depois, para sempre.

Acontece de verdade: funcionário comum tentando recontar item já `CONFERIDO`.

**Evitar.** `isPermissaoNegada()` separa "a rede falhou" de "as regras recusaram". Recusa
sobe como erro na gravação e é descartada na drenagem. **Qualquer erro novo que entre na
fila precisa passar por essa pergunta** — se tentar de novo não vai adiantar, não enfileire.

### A câmera do leitor reabre sem parar

**Causa.** O callback passado ao leitor não era memoizado e estava nas dependências do
`useEffect` que inicia o vídeo. Cada render recriava a função e reiniciava a câmera.

**Evitar.** `useCallback` em qualquer função passada para componente com efeito.

### Exportar gera o arquivo errado

**Sintoma.** O usuário seleciona uma auditoria salva, exporta, e recebe a contagem atual.
Silenciosamente.

**Causa.** A tabela lia o snapshot e a exportação lia os produtos ao vivo.

**Evitar.** Tela e exportação saem da mesma `LinhaRelatorio[]`
(`linhasDeProdutos` / `linhasDeSnapshot`). Há teste de paridade entre os dois caminhos.

### A lista trava com muitos produtos

**Causa.** Contar as abas rodava o filtro completo 8 vezes, com 8 ordenações
`localeCompare` sobre 2000 produtos, a cada snapshot.

**Evitar.** `contarPorFiltro()` conta em uma passada, sem ordenar. `CardProduto` é `memo` e
recebe callbacks estáveis.

---

## Deploy e ambiente

### `sh: line 1: tsc: command not found`

**Causa.** `NODE_ENV=production` faz o npm **omitir `devDependencies`** na instalação. O
TypeScript é dev.

**Evitar.** O `.npmrc` na raiz tem `include=dev`. `include` tem precedência sobre `omit`
qualquer que seja a ordem. **Não remova esse arquivo.**

### 503 Service Unavailable, com build impecável

**Sintoma.** O log de build passa por completo. O domínio devolve 503. O log de aplicação
está vazio.

**Causas possíveis, em ordem de probabilidade:**

1. **A hospedagem não copiou o resultado do build.** O campo "Diretório de saída" precisa
   ser `.` — vazio, ela pode não copiar nada.
2. **`node_modules` não sobrevive à cópia.** Resolvido: a API é um bundle único sem
   dependências em runtime.
3. **Bundle ESM em arquivo `.js`.** O Node decide o formato pelo `package.json` mais
   próximo; se ele não for copiado, Node 20 assume CommonJS e morre com
   `Cannot use import statement outside a module`. Resolvido: o bundle é **`.mjs`**.
4. **`PORT` não numérico.** O Passenger passa um caminho de socket Unix. Tratar isso como
   erro derrubava o processo antes de existir logger. Resolvido: `config.ts` aceita os dois.

**Evitar.** Os `process.on('uncaughtException')` em `server.ts` garantem que qualquer falha
de inicialização apareça no log da aplicação.

### O teste local passa e a produção quebra

**Causa.** Node local v24 detecta ESM automaticamente; a hospedagem roda Node 20, que não
necessariamente. O teste isolado passou por causa da versão, não do código.

**Evitar.** Ao testar comportamento que depende do runtime, conferir a versão dos dois
lados. Preferir construções sem ambiguidade (`.mjs`).

### `firebase: o termo não é reconhecido`

**Causa.** No Windows, `npm install -g` instala em `%APPDATA%\npm`, que frequentemente não
está no PATH.

**Evitar.** Usar `npx firebase-tools`.

### `O token '&&' não é um separador de instruções válido`

**Causa.** Windows PowerShell 5.1 não tem operadores de encadeamento.

**Evitar.** Um comando por linha, ou um script npm (dentro deles `&&` funciona, porque o
npm executa via `cmd.exe`).

### `Set-Content -Encoding utf8` corrompe JSON

**Sintoma.** Depois de editar um `package.json` por script, o build falha com
`Unexpected token '﻿'`.

**Causa.** No PowerShell 5.1, `-Encoding utf8` grava **com BOM**.

**Evitar.** Editar arquivos com ferramenta de edição, não com redirecionamento de shell.

---

## Dependências

### `npm audit fix` piora a situação

Dois casos reais neste projeto:

- **exceljs**: o "fix" sugerido é **baixar** de 4.4 para 3.4.
- **react-router**: as faixas de aviso se cruzam. Sair de uma joga em 14 outras, entre
  elas *open redirect* que **atinge SPA de verdade**.

**Evitar.** Ler o aviso antes de aplicar. O raciocínio dos quatro avisos abertos está no
[../README.md](../README.md).
