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

**Responder `y` apaga índice em produção.** Os dois de `historico_geral` por `userId` e por `action` vieram do **Themis 1.x**, que saiu de produção em 2026-08-10. Eles **não** estão em `firestore.indexes.json`: o arquivo tem só os três do 2.0. Por isso `npm run deploy-indexes` ainda pergunta se pode apagá-los: responda `N`. Trazer os dois para o arquivo, ou apagá-los de vez, é decisão do dono.

| Índice | Usado por |
|---|---|
| `historico_geral`: userId, timestamp↓ | ninguém hoje (era do 1.x) |
| `historico_geral`: action, timestamp↓ | ninguém hoje (era do 1.x) |
| `historico_geral`: inventoryId, timestamp↓ | 2.0 — Histórico filtrado por um estoque |
| `historico_geral`: inventoryId, action, timestamp↓ | 2.0 — Histórico filtrado por estoque e ação |
| `auditorias`: inventoryId, data↓ | 2.0 — `PainelAuditoria` |

O Histórico em "Todos" usa só o índice automático de `timestamp`. Usuário e, em "Todos", ação são filtrados no navegador.

## `firestore.rules`: a partir da 2.25.0 é a regra nova

A partir do 2.25.0, `firestore/firestore.rules` é a regra **nova**. `npm run deploy-rules` publica ela. Só rode com as condições da seção 7.4 do desenho da Etapa 4 e o OK do dono.

- A regra publicada até a 2.24.0 está guardada, byte a byte, em `firestore/anteriores/firestore-2.24.0.rules`.
- Qual das duas está publicada: **a da 2.24.0**. Quem publicar a nova atualiza esta linha.
- Antes de publicar, compare o Console com a guardada. Se não bater, alguém editou por lá: pare.
- `npm run testar-regras` testa a nova. `npm run testar-regras-anterior` testa a guardada. As duas têm de passar.
- Voltar atrás: `npm run deploy-rules-anterior` publica a guardada. Também só com o OK do dono.

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

Os números de linha dos avisos mudaram com a regra nova.
