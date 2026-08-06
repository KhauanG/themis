# Funcionalidades

Uma seção por tela. Permissões em [regras-de-negocio.md](regras-de-negocio.md) §Permissões.

---

## Login

`features/auth/Login.tsx`

E-mail e senha, Firebase Auth. Mesmas contas do Themis 1.x.

Códigos do Firebase são traduzidos. Usuário inexistente e senha errada devolvem a **mesma
mensagem** — o Firebase unificou os dois para não revelar quais e-mails existem, e a
tradução mantém isso.

Falha ao carregar o perfil **não impede o login**: o usuário entra como comum, e o Firestore
nega o que ele não puder fazer de qualquer jeito.

⚠️ O primeiro acesso precisa de internet. Depois disso o Firebase Auth mantém a sessão.

---

## Contagem — a tela principal

`features/contagem/`

### Barra de progresso

`N de M contados` mais percentual. Vem de `progressoContagem(produtos)` — derivado dos
produtos, não de rastreamento local, então é igual em todos os aparelhos.

### Busca e abas

Busca por nome ou código de barras, sem diferenciar caixa nem acento.

Oito abas com contador. **Aba vazia some**, exceto "Todos" e a selecionada — aba zerada só
polui. Critérios em [regras-de-negocio.md](regras-de-negocio.md) §Filtros.

Lista paginada de 40 em 40, com "Mostrar mais". Estoques passam de 2000 produtos.

### Card do produto

Fechado mostra nome, código, etiqueta de validade, quantidade contada, estoque do sistema e
diferença. Borda esquerda verde = contado, azul = conferido.

Etiqueta de validade: **âmbar** a 30 dias do vencimento, **vermelha** se vencido.

Aberto, expande o formulário: **quantidade** (campo grande, centralizado, seleciona ao
focar) e **validade mais curta**. Enter salva.

⚠️ O formulário é componente separado (`FormContagem`) que monta ao abrir — ver
[armadilhas.md](armadilhas.md) §O campo perde o que está sendo digitado.

Se o produto mudar no servidor com o formulário aberto, aparece um aviso antes de salvar.

### Leitor de código de barras

`BarcodeDetector` nativo do Chrome Android. Formatos: EAN-13, EAN-8, UPC-A, UPC-E,
Code 128, Code 39, ITF. Varredura a cada 250ms; abaixo disso a CPU esquenta sem ganho.

Ao ler: vibra, fecha, busca o código e **abre direto o card** do produto encontrado.

Exige **HTTPS**. Sem contexto seguro a câmera não abre, e a mensagem explica isso.

---

## Finalizar e salvar contagem

`features/finalizar/ModalFinalizar.tsx` — no menu do topo. **Qualquer usuário.**

Mostra o resumo do ciclo e avisa quantos itens ficariam como NÃO CONTADO. Exige digitar
**FINALIZAR**.

Salva a auditoria, incrementa o ciclo, registra no histórico. Ordem e tratamento de falha
em [regras-de-negocio.md](regras-de-negocio.md) §Ciclo.

---

## Painel de auditoria

`features/auditoria/PainelAuditoria.tsx` — auditor, admin, master.

Seletor de origem: **ao vivo** (ciclo corrente) ou uma **auditoria salva**. Auditoria salva
é somente leitura, e a tela avisa isso.

Cartões de estatística, filtro por status, tabela com Produto / Sistema / Contado /
Diferença / Status.

### Conferência do admin

Só admin/master, e **só na visão ao vivo** — auditoria salva é histórico e não deve ser
editável.

Cada item divergente ganha dois botões:

- **OK** → `corrigidoIncorreto: false`. A contagem estava certa; a divergência não se
  confirmou.
- **Divergiu** → `corrigidoIncorreto: true`. Confirmada na conferência física.

Os dois marcam `productStatus: 'CONFERIDO'`, o que tira o item da lista de trabalho do
funcionário. **Desfazer** devolve para `ATUALIZADO`.

### Exportações

PDF da contagem, PDF de validade, planilha. As três saem da **mesma** `LinhaRelatorio[]`
que a tabela — ver [armadilhas.md](armadilhas.md) §Exportar gera o arquivo errado.

`jspdf` e `exceljs` entram por **import dinâmico** e ficam fora do precache: quem só conta
não baixa 1,5 MB de biblioteca de relatório.

Entrega por **Web Share** (abre a folha nativa do Android), com download como alternativa.

---

## Produtos

`features/produtos/TelaProdutos.tsx` — admin e master.

| Ação | O que faz |
|---|---|
| Cadastrar produto | Nome, código de barras, estoque do sistema |
| Importar planilha | `.xlsx`, em lotes de 500, com barra de progresso |
| Enviar contagem ao ERP | Só itens contados que tenham `IdProduto` |
| Limpar contagem | Zera a rodada — inclusive as validades |

### Importação

Aceita várias grafias de cabeçalho (`nome`/`produto`/`descrição`, `codigo de barras`/`ean`/
`gtin`, ...). Exige ao menos **nome** e **estoque do sistema**; linha sem nome é ignorada e
contabilizada.

⚠️ Em lotes de 500 (o limite do Firestore). Uma escrita por produto, com teto de 8s cada,
tornava a importação de 2000 linhas inviável.

### Corrigir estoque

Porte do fluxo homônimo do 1.x. **Três fases, e nenhuma é opcional.**

**1. Ler o ERP antes.** Busca o saldo atual e grava em `estoqueSistema`. Sem isso a
comparação usaria o saldo da última importação: o app mandaria "corrigir" itens que já
batiam e deixaria passar divergências surgidas desde então.

**2. Enviar as divergências.** Só elas. Item que bateu não tem o que corrigir, e mandar
todos seriam 2000 requisições para resolver 40 problemas. Pausa de 500 ms entre envios.

**3. Verificar se aplicou.** Espera 1,5 s, lê o ERP de novo e confere item a item se o
saldo ficou igual ao enviado. O que não refletiu vira pendência, listada com "enviado" e
"no ERP", com botão de **reenviar**.

> Sem a fase 3, um envio aceito pelo ERP mas não aplicado passa despercebido — e o estoque
> fica errado com todo mundo achando que foi corrigido.

Ao fim, **fecha a conferência** de todos os contados: `CONFERIDO`, com `corrigidoIncorreto`
e `corrigidoCritico` conforme o caso. Os itens saem da lista de trabalho do funcionário.

⚠️ O fechamento acontece **mesmo se o ERP falhar**: o usuário já confirmou que quer fechar,
e a conferência registra o que foi verificado, não o que o ERP aceitou.

A confirmação aparece **entre as fases 1 e 2**, com os números já corrigidos pela leitura.
Perguntar antes mostraria dados velhos.

Exige conexão: offline os lotes do Firestore ficariam pendentes para sempre.

O `HashLoja` vem de `hashConfigs`. Produtos que o ERP não conhece são contabilizados e
avisados — não dá para corrigir o que ele não tem.

---

## Histórico

`features/historico/TelaHistorico.tsx` — auditor, admin, master.

Trilha de auditoria. Últimas 200 ações do estoque, agrupadas por dia (Hoje, Ontem, data),
com filtro por tipo.

Cada evento mostra **o que exatamente mudou**, não um despejo de campos:

```
Contou produto                                    14:32
Skol Lata 350ml
QUANTIDADE          12  →  15
VALIDADE             —  →  01/09/2026
Ciclo 3
Khauan · Android SM-A536 (a3f091)
```

O valor antigo aparece riscado e o novo em destaque. A formatação vive em
`packages/shared/src/historico-descricao.ts`, é função pura e tem 20 testes — a tela só
desenha o que sai de lá.

### O que é registrado

| Ação | Detalhes guardados |
|---|---|
| Contou produto | produto, quantidade de → para, validade de → para, ciclo |
| Conferiu item | produto, se a divergência se confirmou, contado, sistema |
| Cadastrou produto | nome, código, saldo, origem |
| Editou produto | nome, código, saldo e código do ERP, cada um de → para |
| Excluiu produto | nome, se já estava contado |
| Buscou estoque | recebidos do ERP, saldos alterados, sem correspondência |
| Corrigiu estoque | conferidos, divergentes, enviados, confirmados, pendentes, recusados |
| Finalizou contagem | ciclo, contados, não contados, divergentes |
| Importou planilha | criados, linhas ignoradas |
| Exportou | tipo do arquivo e o recorte (`40 de 2000 itens`) |
| Limpou contagem | total zerado, ciclo |
| Criou/editou/excluiu estoque | nome, descrição, se o HashLoja mudou, produtos apagados |
| Alterou papel | usuário, papel de → para |
| Alterou configuração | modo contagem de → para, estoque travado ou liberado |
| Entrou no sistema | uma vez por sessão, quando o estoque já está escolhido |

⚠️ Ao gravar um "de → para", **capture o valor antigo antes da escrita**: depois dela o
objeto em memória já é o novo, e o histórico perde a origem.

⚠️ Guarde o **nome**, não só o id. Quem abre o histórico meses depois não sabe qual produto
era `xK92mFq`.

⚠️ Depende dos **índices compostos** do Firestore. Sem eles a consulta falha, e a mensagem
de erro diz isso.

---

## Usuários

`features/usuarios/TelaUsuarios.tsx` — **só master.**

Lista os usuários e permite trocar o papel de cada um. Um papel por vez — sem combinação.

⚠️ **Não permite alterar o próprio papel.** Rebaixar a si mesmo tiraria o acesso a esta
tela sem volta pelo app.

Criar e excluir conta continua no Console do Firebase.

---

## Transversais

### PWA

`registerType: 'autoUpdate'` — a versão nova entra no próximo carregamento. É o que
substitui a publicação na Play Store.

⚠️ O service worker **não cacheia tráfego do Firebase** (`NetworkOnly`). O SDK já tem cache
próprio em IndexedDB; dois caches sobre o mesmo dado servem informação velha achando que
está fresca.

Chunks de relatório ficam fora do precache e entram em cache no primeiro uso.

### Faixa de conexão

Ver [offline.md](offline.md) §O que o usuário vê.

### Limite de erro

`components/LimiteDeErro.tsx`. Erro de renderização não deixa mais tela branca no meio da
contagem: informa que os dados estão salvos no aparelho e oferece recarregar.

### Acessibilidade

Alvo de toque de 2,75rem (contagem é feita com o polegar, às vezes com luva). Modal com
foco preso e devolvido ao fechar. Foco visível em todos os controles. `prefers-reduced-motion`
respeitado.
