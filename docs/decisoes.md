# Decisões

Registro do **porquê**. Sem isto, uma decisão bem pensada vira "código estranho" seis meses
depois, e alguém a desfaz.

Formato: contexto → decisão → consequência.

---

## 1. Manter o Firestore

**Contexto.** A reescrita podia ter trocado o banco por Postgres com API própria.

**Decisão.** Manter o Firestore, mesmo projeto, mesmas coleções.

**Por quê.** A persistência offline do SDK é o que faz o app funcionar em depósito com wifi
ruim, e ela está depurada há anos. Reconstruir isso (IndexedDB + outbox + resolução de
conflito) é a parte mais difícil do sistema, e o benefício seria indireto.

**Consequência.** Zero migração de dados. Os dois apps convivem. Em troca, carregamos as
duas grafias de campo e a rigidez das regras.

---

## 2. Contagem fala com o Firestore direto

**Decisão.** A API **não** fica no caminho da contagem.

**Por quê.** Passar por ela transformaria "servidor fora do ar" em "app inutilizável", e
mataria o offline.

**Consequência.** A API só existe para o que exige servidor: proxy do ERP, webhook, e
servir os arquivos.

**Não reverter.** Se aparecer a ideia de "centralizar tudo na API", ela custa o offline.

---

## 3. PWA no lugar de app Android

**Por quê.** Fim do ciclo de build + revisão da loja: push na `main` chega no próximo
carregamento. E `BarcodeDetector` nativo dispensa 750 KB de biblioteca.

**Consequência.** Sem listagem na Play Store — instalação por URL. Sem iOS (nenhum auditor
usa). Se um dia precisar da loja de volta, **TWA/Bubblewrap** embrulha o PWA sem reescrever
nada.

---

## 4. Monorepo com `packages/shared`

**Por quê.** No 1.x o cálculo de status estava duplicado e as cópias divergiram — uma nunca
devolvia `CRITICO`. Auditoria salva pelo funcionário e pelo auditor davam resultados
diferentes.

**Consequência.** Uma implementação, com teste. O pacote é puro (sem DOM, Firebase ou rede),
então testa sem mock e serve tanto o PWA quanto scripts Node.

---

## 5. Teto de tempo em toda escrita

**Contexto.** Com persistência offline, a promise de uma escrita não significa "salvou" — e
sem servidor **nunca resolve nem rejeita**.

**Decisão.** Toda escrita passa por `withWriteTimeout` ou `runTransactionWithTimeout`.

**Por quê.** Um `await` direto trava a tela em rede lenta. Foi a classe de bug mais séria
do 1.x.

**Consequência.** Escrita comum resolve no estouro (o dado está no cache); transação
rejeita (transação exige servidor). Detalhes em [offline.md](offline.md).

**Não reverter.** Remover o teto reintroduz o bug de forma silenciosa.

---

## 6. "Contado" sai de `productStatus`, não de rastreamento local

**Contexto.** O 1.x mantinha uma subcoleção `updatedItems` e um `Set` em memória só para a
aba "Contados". A primeira versão do 2.0 copiou isso para o `localStorage`.

**Decisão.** Derivar de `productStatus === 'ATUALIZADO'`.

**Por quê.** Era redundante — o campo já é essa informação, e vem do servidor. Guardar no
aparelho fazia cada um dos 5 celulares ver só o que ele mesmo contou.

**Consequência.** Uma chave de storage a menos, ~40 linhas a menos, e a lista passa a ser
igual em todos os aparelhos. Ordenação por data usa `lastModified` do documento.

---

## 7. Marcador `REMOVER` em vez de `deleteField()` na fila

**Contexto.** As regras exigem tipos estritos: apagar um campo é removê-lo, não gravar
`null`. Mas `deleteField()` é um objeto e vira `{}` no `JSON.stringify` da fila offline.

**Decisão.** O chamador usa a string `REMOVER`; a conversão acontece na hora de gravar.

**Consequência.** A intenção de remover sobrevive ao localStorage. Há teste.

---

## 8. Tela e exportação saem da mesma `LinhaRelatorio[]`

**Contexto.** A tabela lia o snapshot da auditoria e a exportação lia os produtos ao vivo.
Selecionar uma auditoria antiga e exportar gerava o arquivo com a contagem atual,
silenciosamente.

**Decisão.** Normalizar as duas origens com `linhasDeProdutos` / `linhasDeSnapshot`.

**Consequência.** Impossível divergirem. Há teste de paridade.

---

## 9. Bundle da API num arquivo `.mjs`

**Contexto.** A Hostinger compila num diretório e copia o resultado. Quando o
`node_modules` não sobrevivia à cópia, o processo morria no primeiro `import` — 503 sem log,
porque nem chegava a existir logger.

**Decisão.** esbuild empacota tudo em `apps/api/dist/server.mjs`.

**Por que `.mjs` e não `.js`.** O bundle é ESM. Num arquivo `.js`, o Node decide o formato
pelo `package.json` mais próximo; se ele não for copiado, o Node 20 assume CommonJS e morre
com `Cannot use import statement outside a module`. `.mjs` é ESM por especificação, em
qualquer versão.

**Consequência.** Rodar precisa de exatamente dois caminhos: o bundle e `apps/web/dist/`.
Sem `node_modules`, sem `npm install` no servidor.

---

## 10. `.npmrc` com `include=dev`

**Contexto.** `NODE_ENV=production` — necessário para o logger — faz o npm omitir
`devDependencies`. O TypeScript é dev, e o build morria com `tsc: command not found`.

**Decisão.** `.npmrc` na raiz com `include=dev`.

**Por quê.** `include` tem precedência sobre `omit` qualquer que seja a ordem, então vale
mesmo se a plataforma passar `--omit=dev` na linha de comando. Mexer no comando de build
não resolveria: a Hostinger ignora esse campo e roda `npm run build`.

**Não remover.**

---

## 11. Service worker não cacheia o Firebase

**Decisão.** `NetworkOnly` para `googleapis.com` e `/api/`.

**Por quê.** O SDK já tem cache próprio em IndexedDB. Dois caches sobre o mesmo dado servem
informação velha achando que está fresca.

Chunks de relatório ficam **fora do precache** e entram em cache no primeiro uso: quem só
conta não baixa 1,5 MB de biblioteca. Precache caiu de 2,79 MB para 1,08 MB.

---

## 12. Sem overlay bloqueante quando offline

**Contexto.** O 1.x cobria a tela com um aviso de "sem conexão".

**Decisão.** Faixa fina, não bloqueante.

**Por quê.** Contar offline é caso de uso **normal**, não erro. O overlay tratava o normal
como exceção e atrapalhava.

---

## 13. React em vez de SvelteKit ou Next

**Por quê.** O caminho offline-first é resolvido e documentado em React + Vite +
`vite-plugin-pwa`. SvelteKit e Next são SSR-first e brigam com offline; Next ainda sofre em
hospedagem compartilhada.

---

## 14. Qualquer usuário pode finalizar a contagem

**Contexto.** No 1.x só o auditor fechava o ciclo, pelo painel.

**Decisão.** Liberar para todos, protegido pela digitação de **FINALIZAR**.

**Por quê.** Quem contou é quem sabe que acabou. A confirmação por digitação evita o
acidente.

---

## 15. Auditoria de múltiplos estoques não será portada

**Contexto.** O painel do auditor do 1.x tem `toggleMultiploEstoquesBtn`, que consolida
vários estoques numa auditoria só.

**Decisão.** Não portar.

**Por quê.** O usuário confirmou que **nunca foi usado**. Portar custaria mudar o formato
da auditoria salva, que hoje tem um `inventoryId` só — e todo o cálculo de estatísticas
assume um estoque.

**Quando reconsiderar.** Se a operação passar a contar depósito e lojas como um inventário
único. Aí vale rever o modelo de `auditorias` antes de qualquer código.

---

## 16. Papéis toleram flag em três formatos

**Contexto.** Documentos antigos gravaram `isAuditor` como boolean, string `"true"` e
número `1`.

**Decisão.** `papelDe()` aceita os três.

**Por quê.** Checagem estrita deslogaria usuários com perfil legado. É dívida do banco, não
do código — mas quem paga seria o usuário.

**Quando remover.** Depois de normalizar os documentos e confirmar que nenhum perfil usa os
formatos antigos.

---

## 17. Produto fora da listagem do ERP não entra na correção

**Contexto.** A listagem `EstoqueQuantidadePorLojaListar` não traz todos os produtos do
catálogo. Alguns simplesmente não aparecem — cadastrados em outra loja, inativados no ERP,
ou com `IdProduto` divergente. O 1.x enviava esses itens junto com os demais.

**Decisão.** Eles ficam **fora do envio**. Continuam sendo conferidos, com
`corrigidoIncorreto` refletindo a divergência, e aparecem numa lista própria antes e depois
da confirmação.

**Por quê.** O ERP não devolveu saldo para eles, então a comparação usa o `estoqueSistema`
da última importação. Mandar uma correção calculada sobre isso é escrever no estoque real da
empresa a partir de uma comparação que não vale. E a verificação da fase 3 nunca
confirmaria: o item continua ausente na releitura, e vira pendência que ninguém consegue
resolver reenviando.

**O que se perde.** Paridade com o 1.x, e a chance de que o ERP aceitasse o envio e
corrigisse o cadastro sozinho. Julgamos que não escrever a partir de comparação inválida
vale mais — sobretudo porque o efeito de errar aqui é silencioso.

**Como se contorna.** Resolver o cadastro no Nuvem3. Para saber quantos produtos estão nessa
situação e se têm algo em comum:

```
npx tsx scripts/diagnosticar-erp.mts <hashLoja> --planilha <arquivo>
```

**Quando revisar.** Se o cruzamento mostrar que os ausentes são poucos e todos legítimos, ou
se o ERP passar a aceitar atualização de produto fora da listagem.
