# Offline e conexão

O assunto mais delicado do projeto. Já custou uma versão inteira de correção (4.19.8 do
1.x) e é onde um erro sutil vira "o app perdeu minha contagem".

---

## A verdade que muda tudo

Com persistência offline habilitada, a promise de uma escrita no Firestore
(`setDoc`/`updateDoc`/`addDoc`/`batch.commit`) **não significa "salvou"**.

```
dado gravado no cache local  →  IMEDIATO   ← aqui já está seguro
promise resolve              →  quando o SERVIDOR confirma
```

E, sem servidor alcançável, ela **nunca resolve — e nunca rejeita**. Fica pendurada para
sempre. Não é erro: é sincronização pendente.

Consequência: `await` numa escrita, no meio do fluxo da interface, **trava a tela**. Sem
toast, sem re-render. O usuário conclui que não salvou e reconta.

## Rede lenta é pior que rede ausente

| Situação | O que acontece |
|---|---|
| **Sem rede** | O app detecta, enfileira, avisa. Funciona. |
| **Rede lenta** | O app se acha online e espera para sempre. Trava. |

Todo o desenho abaixo existe por causa da segunda linha.

---

## Escrita com teto de tempo

`apps/web/src/lib/firestore-write.ts` — porte direto da correção 4.19.8.

### `withWriteTimeout(promise, { ms, label })`

Teto de **8s**. No estouro **resolve** com `{ timedOut: true }` e segue: o dado está no
cache local e sincroniza depois. Nunca lança por causa do teto — erro real continua subindo.

### `runTransactionWithTimeout(fn, { ms, label })`

Teto de **12s**. No estouro **rejeita** com `WriteTimeoutError` (`deadline-exceeded`,
`isWriteTimeout: true`).

A diferença não é capricho: **transação exige servidor e não grava no cache.** Ou fala com
o servidor, ou não aconteceu. O chamador precisa tratar como falha e enfileirar.

### Regra

> Toda escrita no Firestore passa por um destes dois. Sem exceção.

Tetos menores em operações que não podem segurar a interface: histórico 5s, `userSettings`
3s, importação em lote 20s.

---

## Fila offline

`apps/web/src/lib/fila-offline.ts`, persistida em `localStorage`.

### Por que existe, se o Firestore já tem cache

Porque a gravação de produto é feita em **transação**, e transação não funciona a partir do
cache. Quando ela estoura o teto, a alteração cai aqui e é reaplicada ao reconectar.

### Deduplicação

Alteração mais nova do mesmo produto **substitui** a anterior. Reenviar contagens
intermediárias não muda o resultado e só alonga a drenagem.

⚠️ **Mas a base de comparação preservada é a da PRIMEIRA edição offline.** O que detecta
conflito é o valor que o servidor tinha quando o aparelho perdeu contato, não o da última
edição local. Há teste cobrindo isso.

### Drenagem

Ao reconectar, `EstoqueContext.sincronizar()`:

- **Conflito real** → descarta a pendência e avisa. Contagem mais recente de outro aparelho
  vence.
- **Falha de rede** → para a drenagem e mantém o resto para a próxima tentativa. Insistir
  com a rede caída só queima bateria.
- Uma trava de reentrância impede reenviar a mesma pendência duas vezes.

### Idempotência

Se uma transação estoura o teto mas o servidor confirma depois, a fila reaplica o **mesmo
valor**. A checagem de conflito não acusa divergência. Inofensivo.

---

## Detecção de conflito

Antes de gravar, a transação compara o valor no servidor com o que o cliente viu:

```
conflito  ⟺  servidor != base_do_cliente  E  servidor != valor_novo
```

A segunda condição importa: se o servidor já está com o valor que estamos escrevendo,
alguém aplicou a mesma alteração (ou a nossa, reenviada pela fila). Reaplicar é inofensivo.

Campos verificados: `quantidade` e `codigoBarras`.

---

## Detecção de conectividade

`navigator.onLine` só diz se existe interface de rede — responde `true` num wifi de loja
que não passa tráfego.

Ordem de confiança em `conectividade.ts`:

1. **Resultado real da última operação Firestore** (janela de 30s). É a única evidência de
   que o servidor que importa está respondendo.
2. **`navigator.onLine` como negativo forte** — se ele diz offline, está offline.
3. **Probe HTTP** como desempate, por último. `generate_204` é bloqueado em muita rede de
   loja e produzia falso-offline e, pior, **falso-online** — que era a pré-condição de
   todos os travamentos.

`markServerOk()` / `markServerFail()` são alimentados por `firestore-write.ts`. Recusa de
regra conta como **sucesso de conexão**: prova que o servidor respondeu.

---

## O que o usuário vê

| Situação | Interface |
|---|---|
| Salvou com ack | "Contagem salva." |
| Salvou local | "Sem conexão. Salvo no aparelho e enviado ao reconectar." |
| Offline | Faixa fina no topo, com o número na fila |
| Fila pendente com rede | Faixa com botão "Enviar agora" |
| Drenou | "N alterações sincronizadas." |
| Conflito | "Este produto foi contado em outro aparelho. Recarregue e confira." |

⚠️ **Não existe overlay bloqueando a tela quando offline.** Contar offline é caso de uso
normal, não erro. O 1.x tinha esse overlay e ele atrapalhava.

---

## Ao mexer aqui

- [ ] A escrita passa por `withWriteTimeout` ou `runTransactionWithTimeout`?
- [ ] Se estourar o teto, o fluxo continua ou trava?
- [ ] Algum `await` de escrita está antes de um re-render ou toast?
- [ ] Valor sentinela (`deleteField`) sobrevive ao JSON da fila? Use `REMOVER`.
- [ ] Testou com DevTools → Network → **Slow 3G**, não só offline?

O relatório original da investigação está em `documentacao/RELATORIO_CORRECAO_CONEXAO_LENTA.md`
no repositório do Themis 1.x.
