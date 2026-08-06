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
