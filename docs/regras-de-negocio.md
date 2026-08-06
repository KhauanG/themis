# Regras de negócio

Tudo neste documento vive em `packages/shared/`, é função pura e tem teste. Se você
precisar de um destes números em algum lugar novo, **importe** — não recalcule.

---

## Item contado

```
contado  ⟺  productStatus ∈ { 'ATUALIZADO', 'CONFERIDO' }
```

`CONFERIDO` conta como contado: é um item que passou pela conferência do admin.

**Quantidade não define contagem.** `quantidade: 0` é contagem legítima (o produto acabou),
e é também o estado que "limpar contagem" deixa. O que separa os dois é a presença do
`productStatus`.

Função: `isItemContado(produto)` em `produto.ts`.

## Estoque físico e do sistema

```
físico   = quantidade  (se não for null/undefined)  senão  estoqueFisico  senão  0
sistema  = estoqueSistema  ??  EstoqueAtual  ??  0
```

`quantidade: 0` cai no primeiro ramo, não no fallback. Confundir isso trocaria uma
contagem zerada pelo valor antigo.

Funções: `fisicoDe`, `sistemaDe`.

---

## Status de auditoria

```
não contado                     → 'NÃO CONTADO'
físico == sistema               → 'CORRETO'
|físico - sistema| >= 10        → 'CRITICO'
caso contrário                  → 'ERRADO'
```

O limite é `LIMITE_CRITICO = 10`, em `types.ts`. Diferença de exatamente 10 é **crítica**.

> **Histórico.** No 1.x esta lógica estava duplicada, e a cópia de `app.js` nunca devolvia
> `CRITICO` — só `CORRETO` ou `ERRADO`. A mesma contagem gerava auditorias diferentes
> conforme quem salvasse. Há teste de regressão cobrindo o limite nos dois sentidos.

Função: `statusDe(produto)` em `auditoria.ts`.

## Diferença

```
não contado  → '-'
contado      → físico - sistema   (com sinal)
```

Função: `diferencaDe(produto)`.

---

## Estatísticas

```
naContagem  = contados E NÃO conferidos

contados    = |naContagem|
corretos    = |naContagem onde físico == sistema|
incorretos  = contados - corretos
naoContados = total - contados
percentual  = incorretos / contados * 100     (0 se contados == 0)

corrigidos  = itens com productStatus == 'CONFERIDO'
   incorreto  se corrigidoIncorreto == true
   correto    se físico == sistema
   incorreto  caso contrário
```

⚠️ **Itens `CONFERIDO` saem das contagens principais** e entram só no bloco `corrigidos`.
Sem isso uma correção contaria duas vezes. Regra herdada do painel do auditor do 1.x.

`contados + naoContados == total` sempre. Há teste.

⚠️ A marcação explícita do admin (`corrigidoIncorreto`) **vence o cálculo automático**. Se
o admin diz que a divergência se confirmou, é isso, mesmo que os números batam.

Função: `calcularEstatisticas(produtos)`.

---

## Ciclo de contagem

`inventories/{id}.contagemCycle` — começa em 1 e sobe a cada finalização.

Finalizar faz, **nesta ordem**:

1. Monta o snapshot e grava em `auditorias`
2. Incrementa o ciclo em transação
3. Registra `FINALIZAR_CONTAGEM` no histórico

A ordem importa: se o passo 2 falhar, a auditoria **já está salva**. O contrário perderia
o trabalho todo. Quando o passo 2 estoura o teto de tempo, o usuário recebe "auditoria
salva, mas o ciclo não fechou" e pode repetir.

O incremento é em **transação com leitura no servidor**: com 5 aparelhos, ler o ciclo da
tela e somar 1 perderia incrementos.

⚠️ A transação grava **só** os quatro campos de ciclo. Qualquer campo a mais faz a regra
negar — ver [dados.md](dados.md) §inventories.

Confirmação por digitação: o usuário precisa escrever **FINALIZAR**. Evita fechar o ciclo
sem querer no meio da contagem.

**Qualquer usuário pode finalizar** (decisão da 4.19.7): quem contou é quem sabe que
acabou.

---

## Limpar contagem

Zera a rodada, preservando o estoque do sistema:

```
quantidade         → 0
productStatus      → removido
corrigidoIncorreto → removido
dataValidade       → removido
```

Só remove o que existe: `deleteField()` num campo ausente entra no diff da regra à toa.

⚠️ **A validade é apagada junto**, por decisão do produto (4.19.5). Validade sem contagem
correspondente é dado órfão, e o relatório a mostraria como atual.

Em lotes de 500 — o limite do Firestore.

---

## Data de validade

- Formato `YYYY-MM-DD`, string. Nunca `Date`, nunca `null`.
- **Sem quantidade associada** — só a data do lote mais curto (decisão da 4.19.5).
- Valor malformado é descartado na leitura (`validadeDe`), não propagado.
- Comparação é lexicográfica: em ISO, ordem alfabética é ordem cronológica. Nada de
  `new Date()`, que desloca o fuso.
- No card: âmbar a 30 dias do vencimento, vermelho se vencido.

---

## Filtros da tela de contagem

| Aba | Critério |
|---|---|
| Todos | tudo |
| A contar | `productStatus == null` |
| Contados | `productStatus == 'ATUALIZADO'` |
| Sem código | `!temCodigoBarras` |
| Negativos | `físico < 0` |
| Corrigidos OK | `CONFERIDO` e `corrigidoIncorreto != true` |
| Corrigidos com erro | `CONFERIDO` e `corrigidoIncorreto == true` |
| Fora do ERP | `apiNotFound == true` |

⚠️ **"Contados" esconde `CONFERIDO`**: item já resolvido pelo admin sai da lista de
trabalho do funcionário, senão ele recontaria algo decidido.

⚠️ **"Corrigidos OK" e "Corrigidos com erro" não aparecem para o papel `comum`** — dizem se
a contagem bateu com o sistema, que é a diferença por outro nome. Ver §Contagem às cegas.

A aba sai de `productStatus`, que vem do servidor — não de rastreamento local. Com 5
celulares, todos veem a mesma lista.

`contarPorFiltro()` conta as abas em **uma passada, sem ordenar**. Chamar o filtro completo
uma vez por aba custava 8 ordenações `localeCompare` sobre a lista inteira a cada snapshot.
Há teste garantindo que os dois concordam.

---

## Permissões

| Ação | Comum | Auditor | Admin | Master |
|---|:---:|:---:|:---:|:---:|
| Contar | ✓ | ✓ | ✓ | ✓ |
| Finalizar contagem | ✓ | ✓ | ✓ | ✓ |
| Ver auditoria | | ✓ | ✓ | ✓ |
| Ver histórico | | ✓ | ✓ | ✓ |
| Ver estoque do sistema | | ✓ | ✓ | ✓ |
| Conferir divergência | | | ✓ | ✓ |
| Gerenciar produtos e estoque | | | ✓ | ✓ |
| Gerenciar papéis | | | | ✓ |

Isto governa **só a interface**. Esconder botão não protege nada — quem decide é a Security
Rule. Ver [seguranca.md](seguranca.md).

Função: `permissoesDe(papel)` em `papeis.ts`.

---

## Contagem às cegas

**Quem só conta não vê o saldo do sistema nem a diferença.**

O motivo não é sigilo, é qualidade do dado. Mostrar o número faz o funcionário *conferir* em
vez de *contar*: ele lê "sistema 12", encontra 11 na prateleira e digita 12. A contagem
deixa de medir o estoque e passa a confirmar o que o ERP já achava — que é exatamente o erro
que o inventário existe para pegar.

Some para o papel `comum`:

| Onde | O que some |
|---|---|
| Card do produto | a diferença `+N`/`-N`, a etiqueta `ok`, o `sistema N` do não contado |
| Formulário de contagem | a linha `Sistema: N · diferença` |
| Abas | "Corrigidos OK" e "Corrigidos com erro" |
| Finalizar contagem | os totais "Corretos" e "Divergentes" |

Fica: quantidade contada, etiqueta `contado`, `Contados`/`Não contados` no fechamento. São
progresso, não comparação.

Auditor vê tudo — comparar contagem com sistema é o trabalho dele.

⚠️ **Não é barreira de segurança.** O saldo vem no documento do produto e as Security Rules
o liberam para qualquer autenticado; um usuário determinado lê pelo console. Serve para o
processo funcionar, e vale enquanto a tela obedecer.

Permissão: `verEstoqueSistema`. Abas: `filtrosVisiveis(verSistema)` em `filtros.ts`.
