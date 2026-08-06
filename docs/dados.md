# Modelo de dados

Firestore, projeto **`auditoria-icebeer`**. O mesmo banco do Themis 1.x — não houve
migração, e os dois apps escrevem nele ao mesmo tempo.

## Coleções

```
estoques/{inventoryId}/produtos/{produtoId}   produtos (subcoleção)
estoques/{inventoryId}/updatedItems/{id}      legado do 1.x — o 2.0 não usa
inventories/{inventoryId}                     metadados e ciclo de contagem
auditorias/{auditoriaId}                      snapshot de contagem finalizada
historico_geral/{id}                          log de ações
users/{uid}                                   perfil e papéis
hashConfigs/{id}                              amarra estoque ↔ loja no ERP
appSettings/{id}                              configuração geral
userSettings/{uid}                            preferências do usuário
```

> **`estoques` e `inventories` são coisas diferentes.** Os produtos ficam sob `estoques`;
> o nome, o ciclo e as datas ficam em `inventories`. É assim desde o 1.x. O documento pai
> `estoques/{id}` pode nem existir — subcoleção existe sem o pai. Por isso o script de
> varredura busca os IDs em `inventories`.

---

## `produtos`

Caminho: `estoques/{inventoryId}/produtos/{produtoId}`

### Campos

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `nome` | string | **sim** | 1 a 300 caracteres |
| `quantidade` | number | **sim** | contagem do ciclo atual |
| `codigoBarras` | string | **sim** | string vazia quando não tem |
| `NomeProduto` | string | não | grafia alternativa de `nome` |
| `CodigoBarras` | string | não | grafia alternativa |
| `estoqueSistema` | number | não | saldo do ERP |
| `EstoqueAtual` | number | não | grafia alternativa |
| `IdProduto` / `idProduto` / `idProdut` | string ou number | não | identificador no ERP |
| `productStatus` | `'ATUALIZADO'` ou `'CONFERIDO'` | não | **ausência = não contado** |
| `corrigidoIncorreto` | bool | não | divergência confirmada pelo admin |
| `dataValidade` | string | não | `YYYY-MM-DD` |
| `temCodigoBarras` | bool | não | marcado na importação |
| `apiNotFound` | bool | não | ERP não reconheceu o produto |
| `lastModified` | timestamp | não | controle de concorrência |
| `modifiedBy` | string | não | `deviceId` de quem gravou |

### ⚠️ Regras de tipo — o erro mais caro do projeto

As Security Rules validam o **documento resultante** de qualquer update. Um produto com um
campo do tipo errado faz o funcionário receber `permission-denied` ao contar, **mesmo sem
encostar nesse campo**. Em campo o sintoma é "não salva".

**Nunca grave `null`.** Não existe `null is number` nem `null is string` nas regras.

| Quero | Errado | Certo |
|---|---|---|
| Zerar a contagem | `quantidade: null` | `quantidade: 0` |
| Produto sem código | `codigoBarras: null` | `codigoBarras: ''` |
| Marcar não contado | `productStatus: 'PENDENTE'` | `deleteField()` |
| Apagar validade | `dataValidade: null` | `deleteField()` |
| Limpar conferência | `corrigidoIncorreto: null` | `deleteField()` |

`'PENDENTE'` **não existe.** A regra só aceita `productStatus in ['ATUALIZADO','CONFERIDO']`.
"Não contado" é a ausência do campo.

O espelho dessas regras em código está em `packages/shared/src/validacao.ts`, com 21
testes. Para varrer o banco atrás de documentos legados que violem isso:

```powershell
npm run auditar-produtos
```

> **Última varredura: 2026-08-06 — nenhum documento violaria as regras.**
>
> Registrar a data importa: se "não salva" reaparecer em campo, saber que a base estava
> íntegra nesta data descarta o produto legado como causa e aponta para código novo.
> Rode de novo depois de qualquer importação grande ou escrita em massa.

### Marcador `REMOVER`

O sentinela `deleteField()` do Firestore é um objeto e **não sobrevive ao JSON** da fila
offline — uma alteração enfileirada chegaria ao servidor sem o campo removido. Por isso o
chamador usa a constante `REMOVER` de `produtos-repo.ts` (uma string), convertida para
`deleteField()` só na hora de gravar.

### Duas grafias

Herdado da importação do ERP. Documentos antigos usam `NomeProduto`, `EstoqueAtual`,
`CodigoBarras`; os novos usam minúsculas. **Toda leitura passa por
`packages/shared/src/produto.ts`** (`nomeDe`, `sistemaDe`, `codigoBarrasDe`, ...). Nenhum
outro módulo deve tocar nos campos crus.

Na escrita, o 2.0 grava as duas grafias de `nome` para o 1.x continuar lendo.

---

## `inventories`

| Campo | Tipo | Observação |
|---|---|---|
| `name` | string | **em inglês** — exigido por `validInventoryData`, 1 a 100 caracteres |
| `description` | string | **em inglês** |
| `contagemCycle` | number | ciclo corrente, começa em 1 |
| `lastFinalizedCycle` | number | último ciclo fechado |
| `lastFinalizedAt` | timestamp | |
| `createdAt` | timestamp | **nunca regenerar** — ver abaixo |
| `updatedAt` | timestamp | |

⚠️ **`name` e `description` são em inglês**, herdado do 1.x. O domínio usa `nome`/
`descricao`, e a tradução acontece em `estoques-repo.ts`, na fronteira. Ler `nome` direto
do documento devolve `undefined` — o app passa a mostrar o ID no lugar do nome, e é
exatamente o bug que produzia "estoques com nome genérico e números".

⚠️ **Excluir o documento não apaga a subcoleção.** `estoques/{id}/produtos` sobrevive ao
`inventories/{id}` e vira lixo invisível, cobrado na fatura. `excluirEstoque()` apaga os
produtos em lotes **antes** do documento.

⚠️ **Usuário comum só pode alterar os campos de ciclo**
(`contagemCycle`, `lastFinalizedCycle`, `lastFinalizedAt`, `updatedAt`). Qualquer campo a
mais no payload — inclusive um `createdAt` regenerado sem querer — faz a regra negar a
escrita **inteira**. Foi exatamente esse bug que travou o app 1.x em agosto de 2026:
`Timestamp` do Firestore não é `instanceof Date`, então o código caía no fallback
`new Date()` e reescrevia `createdAt` a cada gravação.

Converta com `.toDate()`. Nunca regenere.

---

## `auditorias`

Snapshot imutável de uma contagem finalizada. Formato idêntico ao do 1.x.

| Campo | Tipo |
|---|---|
| `nome` | string |
| `inventoryId` | string |
| `contagemCycle` | number |
| `data` | timestamp |
| `produtos` | array de `ProdutoSnapshot` |
| `estatisticas` | objeto — ver [regras-de-negocio.md](regras-de-negocio.md) |
| `createdBy` | string (`deviceId`) |
| `createdAt` | timestamp |

`ProdutoSnapshot` guarda `status` e `diferenca` **já calculados**. A auditoria é histórico:
o que ela mostra hoje precisa ser o que mostrava no dia em que foi salva, mesmo que a
regra de cálculo mude depois.

⚠️ **Gravação sem retry, de propósito.** Usa `doc()` + `setDoc()` (ID gerado localmente)
em vez de `addDoc()`. Repetir a gravação criaria auditorias duplicadas.

---

## `historico_geral`

| Campo | Tipo |
|---|---|
| `action` | uma de 11 ações — ver `AcaoHistorico` |
| `userId` / `userEmail` / `userName` | string |
| `inventoryId` / `inventoryName` | string |
| `timestamp` | timestamp do servidor |
| `localTimestamp` | ISO string, gravado no aparelho |
| `details` | objeto livre |
| `deviceId` / `deviceLabel` | string |

`localTimestamp` existe porque `timestamp` só é preenchido pelo servidor: entrada
enfileirada offline tem a hora local certa e o `timestamp` só quando sobe.

Log **nunca segura o fluxo do usuário**: teto de 5s e, se falhar, vai para o localStorage.

---

## `users`

| Campo | Tipo |
|---|---|
| `email`, `firstName`, `lastName`, `displayName` | string |
| `isMaster`, `isAdmin`, `isAuditor` | bool |
| `allowedInventories` | lista |
| `lastEstoque` | string |
| `createdAt`, `updatedAt` | timestamp |

⚠️ Documentos antigos gravaram as flags como **boolean, string `"true"` ou número `1`**.
`papelDe()` em `packages/shared/src/papeis.ts` tolera as três. Uma checagem estrita
deslogaria usuários com perfil legado.

---

## Índices

Cinco no total, em `firestore/firestore.indexes.json`. **Dois são do 1.x** e não podem ser
removidos. O arquivo precisa listar todos: o deploy oferece apagar o que não estiver nele.
Detalhes em [../firestore/README.md](../firestore/README.md).
