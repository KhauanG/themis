# Firestore — regras e índices

Estes arquivos são publicados com a CLI do Firebase, no projeto `auditoria-icebeer`.

```powershell
npx firebase-tools deploy --only firestore:indexes
npx firebase-tools deploy --only firestore:rules
```

## `firestore.indexes.json` precisa listar TODOS os índices do projeto

O `deploy --only firestore:indexes` trata este arquivo como a verdade. Índice que existe
no projeto mas **não** está aqui faz a CLI perguntar:

```
The following indexes are defined in your project but are not present in your firestore indexes file:
    (historico_geral) -- (userId,ASCENDING) (timestamp,DESCENDING)
? Would you like to delete these indexes?
```

**Responder `y` apaga índice em produção.** Os dois de `historico_geral` por `userId` e
por `action` são do **Themis 1.x**, que continua no ar enquanto os dois apps convivem —
apagá-los quebra a tela de histórico do app antigo.

Por isso os cinco estão listados: dois do 1.x e três do 2.0. A pergunta não deve mais
aparecer. Se aparecer, alguém criou índice pelo Console — **traga-o para este arquivo em
vez de mandar apagar.**

| Índice | Usado por |
|---|---|
| `historico_geral`: userId, timestamp↓ | 1.x — histórico por usuário |
| `historico_geral`: action, timestamp↓ | 1.x — histórico por ação |
| `historico_geral`: inventoryId, timestamp↓ | 2.0 — `TelaHistorico` sem filtro |
| `historico_geral`: inventoryId, action, timestamp↓ | 2.0 — `TelaHistorico` com filtro |
| `auditorias`: inventoryId, data↓ | 2.0 — `PainelAuditoria` |

## `firestore.rules` é cópia do que está publicado

Não é um arquivo novo: é o mesmo conteúdo que já está em produção, versionado aqui para
parar de viver só no Console. Antes de publicar, **compare** com o Console — se divergir,
alguém editou por lá e a versão do Console é a verdadeira.

### Avisos esperados na compilação

```
[W] 29:9  - Invalid function name: get.
[W] 29:21 - Invalid variable name: request.
[W] 36:14 - Unused function: isAuditorOrMaster.
```

Os dois primeiros são ruído do analisador com `get(userDoc(request.auth.uid))` dentro de
função auxiliar; o arquivo compila e a regra funciona — é o que roda em produção hoje. O
terceiro é real e inofensivo: `isAuditorOrMaster` está definida e não é usada. Remover
mexeria nas regras de produção sem ganho, então fica como está.
