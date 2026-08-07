# Changelog

Formato: mais recente primeiro. Toda alteração de comportamento entra aqui.

Categorias: **Adicionado**, **Alterado**, **Corrigido**, **Removido**, **Segurança**.

---

## 2.10.0 — 2026-08-07

### Adicionado

- **Cabeçalhos da auditoria ordenam ao ser clicados.** Produto, Sistema, Contado, Dif. e
  Status. O primeiro clique aplica a ordem principal da coluna; clicar de novo inverte;
  clicar em outra coluna recomeça pela principal — herdar a direção da anterior surpreende
  quem clica em "Contado" esperando "maior primeiro".

  A seta indica a coluna ativa e `aria-sort` no `<th>` faz o leitor de tela anunciar a
  direção. O botão ocupa a célula inteira: no celular, mirar num texto de 11px é sorte, não
  interação.

  É o **mesmo** `filtro.ordem` do seletor, não uma segunda fonte de verdade — clicar no
  cabeçalho muda o seletor e vice-versa, e o PDF sai na ordem que está na tela.

- Ordenação por **Sistema** e por **Contado**, que não existiam, e o sentido invertido de
  nome e gravidade. `ROTULO_ORDEM` passou de 4 para 10 opções.

  ⚠️ Valor ausente (`sistema` de produto fora do ERP, `contado` de item não contado) vai
  **sempre para o fim**, nos dois sentidos. Ordenar crescente e receber 400 traços antes do
  primeiro número esconde exatamente o dado que se foi buscar.

  Toda ordenação desempata por nome: sem isso, duas linhas com o mesmo número trocam de
  lugar entre renderizações e a tabela treme sozinha.

### Corrigido

- **`npm run versao` quebrava em arquivo com CRLF.** Ele procurava `'
---

## '` literal;
  no Windows o changelog vive com `
`, nada casava e o script morria dizendo que o
  formato tinha mudado — enquanto o formato estava certo. Pior: a versão dos pacotes já
  tinha subido nesse ponto, então o projeto ficava em 2.10.0 com o changelog em 2.9.1.
  Quem percebeu foi a trava de `verificar-versao`, que existe para isso.

- O script também morria ao ser rodado de novo depois dessa falha, porque tratava "o pacote
  já está na versão alvo" como erro — justamente quando é preciso repetir.

---

## 2.9.1 — 2026-08-07

### Adicionado

- **Estimativa de tempo antes de confirmar a correção de estoque.** O envio é um item por
  vez, com 500 ms entre eles — cerca de um segundo por item. Com 1200 divergências são 20
  minutos de janela aberta, e sem aviso o usuário conclui que travou e fecha no meio,
  interrompendo o envio.

  O 1.x avisava disso num `confirm()` acima de 1000 itens; era a última diferença de
  comportamento do fluxo de envio. Aqui o número aparece junto do resto do diagnóstico,
  antes de confirmar, a partir de dois minutos estimados.

- A tela de confirmação passou a dizer explicitamente que o envio é **um por vez**.

### Verificação de paridade

Conferido contra o `corrigirEstoque` do 1.x, a pedido:

| | 1.x | 2.0 |
|---|---|---|
| O que é enviado | só os divergentes | só os divergentes (menos os fora do ERP) |
| Forma | `for` sequencial com `await` | idem |
| Pausa entre envios | 500 ms | 500 ms |
| Paralelismo | nenhum | nenhum |
| Itens corretos | só marcados `CONFERIDO` | idem |

Não existe `Promise.all` em nenhum caminho de envio ao ERP — o único do projeto carrega as
bibliotecas do PDF.

---

## 2.9.0 — 2026-08-07

### Adicionado

- **Status `FORA DO ERP`, e produto nessa situação deixa de ser contável.**

  Antes, um produto ausente da listagem do ERP continuava contável e continuava sendo
  comparado com o `estoqueSistema` da última importação. O PDF da auditoria imprimia
  `sistema 1 · contado 4 · +3 · ERRADO` para um produto que o ERP **não tem** — lido como
  "corrija o saldo", quando o que falta é cadastro. Com centenas de produtos nessa
  situação, o relatório vira uma lista de divergências fabricadas.

  `FORA DO ERP` não é grau de divergência: é ausência de base de comparação. Por isso vem
  antes de tudo em `statusDe()`.

  | Onde | O que muda |
  |---|---|
  | Card da contagem | não abre; etiqueta `fora do ERP` e explicação no lugar do formulário |
  | Quantidade e diferença no card | `—`, sem `ok` e sem `sistema N` |
  | Aba "A contar" | não entra — não dá para contá-lo |
  | Barra de progresso | fora do total, senão travaria abaixo de 100% para sempre |
  | Relatório e PDF | `sistema —`, `contado —`, `diferença —`, status `FORA DO ERP` |
  | Filtro de status da auditoria | opção própria |
  | Finalizar contagem | linha própria, fora do total, com aviso |
  | Estatísticas | `foraDoErp` separado; não entram em `naoContados` |

  O card **continua visível**: sumir com ele esconderia o problema, e o problema é real —
  o cadastro precisa ser resolvido no Nuvem3.

  A trava está no card, no leitor de código de barras e em `salvarContagem`. Os dois
  últimos porque o card não é o único caminho até a gravação.

### Alterado

- `LinhaRelatorio.sistema` passou a ser `number | '-'`, como `diferenca` já era. Imprimir um
  número que o ERP nunca confirmou afirma o que não sabemos.
- `filtrarLinhas` decide "contado" pela presença da contagem, não por
  `status !== 'NÃO CONTADO'` — que classificaria `FORA DO ERP` como contado.

---

## 2.8.0 — 2026-08-06

### Alterado

- **Produto fora da listagem do ERP não é mais enviado na correção de estoque.**

  Até aqui, um produto ausente da listagem entrava no envio como qualquer outro. O problema
  é o número contra o qual ele era comparado: como o ERP não devolve saldo para ele, a
  comparação usava o `estoqueSistema` da **última importação**. Mandar uma correção
  calculada sobre dado velho é escrever no estoque real da empresa a partir de uma
  comparação que não vale — e a verificação da fase 3 nunca confirmaria, porque o item
  continua ausente na releitura. Ele viraria pendência eterna.

  O que muda:

  - `diagnosticar()` devolve `foraDoErp`: os contados ausentes da listagem.
  - `executarCorrecao()` os exclui do envio e devolve `naoEnviadosForaDoErp` com os nomes.
  - O aviso aparece **antes de confirmar**, não só no resultado — saber depois que 40
    divergências não foram enviadas é tarde para mudar de ideia.
  - O resultado repete a lista. O item foi conferido e saiu da lista de trabalho, mas
    **continua divergente no ERP**; sem o aviso, ninguém iria atrás.

  Eles continuam sendo **conferidos normalmente**, com `corrigidoIncorreto` refletindo a
  divergência: ela existe, só não tem como ser corrigida daqui. O caminho é resolver o
  cadastro no Nuvem3.

  Diferente do 1.x, que enviava todos. A troca é deliberada: não escrever no ERP a partir de
  comparação inválida vale mais que a paridade. Registrado em
  [decisoes.md](decisoes.md) §17.

### Alterado (interno)

- A regra "o que significa ausente da listagem" virou `saldoDoErpPara()` em
  `@themis/shared`, com teste. Estava escrita em dois lugares — ao gravar `estoqueSistema` e
  ao montar o diagnóstico da correção. Duas cópias de uma regra divergem: no 1.x foi assim
  que o cálculo de status passou a nunca devolver `CRITICO` numa das telas.

---

## 2.7.3 — 2026-08-06

### Adicionado

- **Cruzamento do catálogo com a listagem do ERP** no script de diagnóstico:

  ```
  npx tsx scripts/diagnosticar-erp.mts <hashLoja> --planilha planilhaprodutos.xlsx
  ```

  Um produto ausente não diz nada; **o conjunto dos ausentes diz**. O cruzamento mostra
  quantos produtos do catálogo não estão na listagem e qual saldo a planilha registrava para
  eles. Se todos estavam zerados, o ERP filtra zerados. Se há ausentes com saldo positivo, o
  motivo é outro — produto de outra loja, inativado no ERP, ou `IdProduto` divergente.

  O script virou `.mts` para reaproveitar o leitor de planilha do app em vez de reimplementar
  a leitura do dialeto OOXML do ERP.

### Nota sobre a 2.7.2

Medição em campo mostrou que **a listagem desta loja traz produtos com saldo zero**. Logo
`omiteZerados` fica falso e o comportamento anterior é mantido: ausente continua marcado
como "fora do ERP". A regra da 2.7.2 não estava errada — ela é condicional à resposta e se
desligou sozinha, como projetado. Mas ela **não explica** o produto ausente que motivou a
investigação; a causa é outra, e o cruzamento acima é o que vai apontá-la.

---

## 2.7.2 — 2026-08-06

### Corrigido

- **Produto zerado no ERP mantinha o saldo da última importação.** A listagem
  `EstoqueQuantidadePorLojaListar` **não devolve produto com saldo zero** — ele
  simplesmente não vem. O app tratava a ausência como "o ERP não conhece este produto",
  marcava `apiNotFound` e deixava na tela o saldo antigo.

  São duas coisas diferentes que só por acaso se parecem:

  | Ausente da listagem | Significa | O que fazer |
  |---|---|---|
  | listagem traz saldos `<= 0` | o ERP não conhece o produto | marcar `apiNotFound` |
  | listagem só traz saldo `> 0` | o ERP tem **zero** do produto | gravar `estoqueSistema: 0` |

  Confundir os dois é grave justamente nos produtos que mais precisam de correção: o
  funcionário conta 5, o ERP está em 0, mas o app compara contra o saldo importado, acha
  que bate, e o item nunca entra na correção.

  A distinção sai da **própria resposta**: se numa amostra de 50+ itens nenhum vem com
  saldo `<= 0`, o ERP está filtrando. A conclusão se refaz a cada leitura — no dia em que o
  ERP passar a devolver zeros, o comportamento volta sozinho. Campo `omiteZerados`.

  `atualizarEstoqueSistema` devolve `zeradosPorOmissao` separado de `semCorrespondencia`, e
  a tela informa os dois.

### Adicionado

- O `diagnosticar-erp.mjs` responde a pergunta direto: conta saldos zero e negativos, mostra
  menor e maior, e conclui se a listagem só traz positivo.

---

## 2.7.1 — 2026-08-06

### Corrigido

- **"Buscar estoque" podia descartar a listagem inteira em silêncio.** O proxy lia só
  `idproduto` e `quantidade`. O `auditoria.js` do 1.x — a versão mais testada em campo —
  aceitava quatro grafias para o identificador (`idproduto`, `IdProduto`, `idProduto`,
  `IdProdutoERP`) e três para a quantidade (`quantidade`, `Quantidade`, `EstoqueAtual`),
  justamente porque a resposta varia. Com uma grafia só, nenhum produto casava e o saldo na
  tela continuava sendo o da última importação — que o usuário compara com o Nuvem3 e
  conclui que o ERP está errado.

- **A mensagem dizia o oposto do que tinha acontecido.** Com zero produtos casados, a tela
  mostrava *"Tudo já estava igual ao ERP"*. São duas situações opostas: "nada mudou porque
  já estava certo" e "nada mudou porque a sincronização não aconteceu". Agora
  `atualizarEstoqueSistema` devolve `casaram`, e nenhum casamento é **erro**, com o total de
  produtos e de itens do ERP na mensagem.

- **"Corrigir estoque" seguia adiante sem correspondência nenhuma.** Compararia a contagem
  com o saldo da última importação e mandaria ao ERP "correções" calculadas sobre dado
  velho. Agora aborta no diagnóstico, como o 1.x fazia.

- **Quantidade ilegível descartava o item.** O `parseQuantidade` do 1.x devolvia `0`.
  Descartar transforma "dado ruim" em "não existe no ERP" — problemas diferentes, respostas
  diferentes.

- **`EstoqueAtual` não acompanhava `estoqueSistema`.** O Themis 1.x continua em produção no
  mesmo banco e lê a grafia antiga; gravar só uma deixava os dois apps discordando do saldo.

### Adicionado

- **Diagnóstico na resposta da listagem**: `recebidos`, `semId` e `campos` — este último com
  **apenas os nomes das chaves** do primeiro item, nunca o conteúdo. Responde "o ERP mudou o
  nome do campo?" sem mandar nome de produto ou preço para o log.

- **`node scripts/diagnosticar-erp.mjs <hashLoja> [idProduto...]`** — mostra a resposta crua
  do ERP fora do app: quantos itens, quais campos, quantos sem identificador, e a quantidade
  de produtos específicos para comparar com o Nuvem3 aberto do lado. Também aponta
  identificadores repetidos, mostrando **última ocorrência** e **soma** — se o ERP manda uma
  linha por depósito, é aí que a diferença aparece. Só leitura.

---

## 2.7.0 — 2026-08-06

### Corrigido

- **A importação não lia a planilha do ERP.** O arquivo real da empresa vem num dialeto
  OOXML que o `exceljs` não abre: elementos com prefixo de namespace (`<x:worksheet>`) e
  alvo absoluto nas relações (`Target="/xl/..."`). As duas formas são válidas pela
  especificação; o parser do `exceljs` compara nome de elemento por igualdade literal e
  devolve `undefined`, e a leitura estourava com `Cannot set properties of undefined
  (setting 'sheetNo')` — mensagem que não diz nada sobre a causa. O 1.x lia normalmente
  porque usava SheetJS.

  `apps/web/src/lib/planilha-formato.ts` normaliza o pacote antes de entregá-lo ao
  `exceljs`, e só reempacota quando encontra alguma das duas formas. Verificado contra o
  arquivo do cliente: **1643 produtos, zero ignorados**.

- **Reimportar duplicava o catálogo inteiro.** A importação só criava. O 1.x fazia upsert
  por `IdProduto` e preservava a contagem em andamento; o 2.0 criaria uma segunda cópia de
  cada um dos 1600 produtos, com a contagem dividida entre a cópia velha e a nova.
  Agora `importarProdutos()` atualiza quem já existe, mantém `quantidade` e `productStatus`
  de quem já foi contado, e casa por nome quando a linha não tem `IdProduto` — caso em que
  o próprio 1.x duplicava.

- **A importação descartava preço e estoque mínimo.** São campos do payload que o ERP
  espera na correção de estoque (ver 2.6.2). Sem eles, toda correção mandaria `0` para
  produto que tem preço cadastrado. A planilha traz `PrecoCusto`, `PrecoPJ`, `PrecoVenda` e
  `EstoqueMinimo`, e agora eles são gravados.

- **No celular, digitar num modal jogava o foco no botão de fechar a cada letra.** O efeito
  do `Modal` tinha `onFechar` nas dependências, e quase toda chamada passa uma arrow inline
  — identidade nova a cada render do pai. Cada tecla remontava o efeito: a limpeza devolvia
  o foco para trás e a nova execução o mandava para o **primeiro focável**, que é o ✕ do
  cabeçalho. O teclado virtual fechava, e era preciso tocar no campo de novo para cada
  caractere. Atingia renomear estoque, cadastrar produto e o campo FINALIZAR.

  Agora o efeito depende só de `aberto`, com `onFechar` por referência, e o foco inicial vai
  para o primeiro **campo**, nunca para um botão.

### Adicionado

- **Contagem às cegas.** Quem só conta (papel `comum`) não vê mais o saldo do sistema nem a
  diferença durante a contagem. Ver o número faz o funcionário conferir em vez de contar:
  ele lê "sistema 12", encontra 11 e digita 12 — e o inventário deixa de medir justamente o
  erro que existe para pegar. Admin, master e auditor continuam vendo.

  Some para o papel `comum`: a diferença `+N`/`-N` e a etiqueta `ok` no card, o `sistema N`
  do item não contado, a linha "Sistema: N · diferença" no formulário, as abas "Corrigidos
  OK" e "Corrigidos com erro", e os totais "Corretos"/"Divergentes" ao finalizar.
  Nova permissão `verEstoqueSistema`.

  ⚠️ É desenho de processo, **não barreira de segurança**: o saldo vem no documento do
  produto e as regras o liberam para qualquer autenticado.

- **Versionamento de verdade.** A versão estava em quatro `package.json` e no changelog,
  mantidos à mão — e divergiram: os pacotes diziam `2.0.0` enquanto o changelog ia em
  `2.6.2`. O `/api/health` devolvia `'2.0.0'` escrito no código. Num PWA isso não é
  organização: o service worker guarda o build antigo no aparelho, e sem número confiável
  não dá para responder "a correção chegou no celular do funcionário?".

  - `npm run versao -- patch|minor|major|X.Y.Z` sincroniza os quatro pacotes e abre a seção
    do changelog.
  - `npm run versao:marcar` cria a tag git, depois do commit — a tag precisa apontar para o
    commit que **tem** o changelog escrito.
  - `npm run verificar-versao` falha se os pacotes divergirem, se faltar seção no changelog,
    se ela estiver vazia ou se o topo do changelog não for a versão atual. Roda dentro de
    `npm run verificar`.
  - Versão, commit e data do build entram no bundle (`define` do Vite e do esbuild),
    aparecem no rodapé do menu e em **`GET /api/versao`** — dá para conferir o que está no
    ar com um `curl`.

---

## 2.6.2 — 2026-08-06

Auditoria de paridade das chamadas ao ERP e ao Firestore contra o Themis 1.x. Sete
divergências, todas no caminho de "Buscar estoque" e "Corrigir estoque".

### Corrigido

- **O payload enviado ao ERP tinha metade dos campos.** O 1.x manda oito
  (`IdProduto`, `HashLoja`, `Quantidade`, `CodigoBarras`, `NomeProduto`, `EstoqueMinimo`,
  `PrecoVenda`, `PrecoCusto`); o 2.0 mandava quatro. Pior: `IdProduto` ia como **texto**,
  e o 1.x sempre enviou inteiro — API .NET recusa `"123"` num campo `int` por padrão.
  Agora existe `montarEnvio()` em `@themis/shared`, com 15 testes, e é o único caminho.

- **Produto sumia da correção por causa da grafia do id.** O mapa da leitura do ERP era
  indexado por uma grafia só. Um produto cadastrado com `IdProduto: 7` nunca alcançava a
  entrada `"007"` que o ERP devolveu — entrava como "sem correspondência", em silêncio.
  O 1.x indexava por todas as grafias (`buildApiStockMap`); agora o 2.0 também, e a
  consulta passa por `saldoNoErp()`.

- **Sem retry no envio.** O `sendStockUpdateSync` do 1.x tentava quatro vezes com 1s de
  intervalo. O 2.0 desistia na primeira. O retry agora mora na API, não no celular — é
  seguro repetir porque a chamada grava quantidade absoluta, não incremento. O teto do
  navegador subiu de 15s para 60s para cobrir o orçamento inteiro; com 15s ele abortava no
  meio da segunda tentativa e marcava como falha um item que o ERP ainda estava gravando.

- **HTTP 200 era tratado como aceite.** O ERP responde 200 com `{ success: false }` quando
  recusa por regra dele. O 1.x inspecionava o corpo (`extractBusinessError`); o porte tinha
  esquecido. Agora `erroDeNegocio()` na API, com 9 testes.

- **`apiNotFound` nunca era gravado.** A aba "Não encontrados na API" existe e lê esse
  campo — ficava permanentemente vazia. Volta a ser marcada em cada busca de estoque.

- **Saldo fracionário do ERP não era arredondado.** O `parseQuantidade` do 1.x arredondava.
  Sem isso, um saldo `4.5` nunca bateria com contagem inteira e viraria divergência eterna.

- **`CodigoBarras` vazio era recusado pelo nosso próprio schema.** Produto sem código de
  barras existe no cadastro e o 1.x o enviava normalmente.

### Alterado

- `ResultadoBusca` ganhou `itens` (produtos distintos). `estoque.size` deixou de servir
  como contagem — o mapa indexa cada produto por mais de uma chave.

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
