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

### Envio ao ERP

Passa pelo proxy da API. O `HashLoja` vem de `hashConfigs`. Item sem contagem não tem o que
corrigir e é ignorado. Ao fim, informa quantos foram e quantos falharam.

---

## Histórico

`features/historico/TelaHistorico.tsx` — auditor, admin, master.

Últimas 200 ações do estoque, com filtro por tipo. Cada evento mostra a etiqueta colorida
da ação, quem fez, quando e o aparelho.

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
