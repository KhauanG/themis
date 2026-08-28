# Mapa do código

> ⚠️ **Gerado por `npm run mapa`. Não edite à mão** — a próxima geração apaga.
> Um mapa escrito à mão está errado no terceiro commit, e mapa errado é pior que mapa
> nenhum: quem confia nele procura no lugar errado e conclui que a função não existe.

Índice de `6853a91` · **106 arquivos**, 1104 símbolos (314 exportados), 3600 arestas.

## Para agentes: leia isto primeiro

Este documento serve para **se orientar** — descobrir onde uma coisa mora. Ele não traz
corpo de função, cadeia de chamadas nem raio de impacto, e não deve trazer: são 1.000+
símbolos e 3.000+ arestas, e markdown é o formato errado para isso.

Para o detalhe, consulte o índice — uma chamada devolve o fonte verbatim dos símbolos
relevantes, os caminhos de chamada entre eles e quem quebra se você mexer:

```
codegraph_explore(query: "<símbolos ou pergunta>", projectPath: "<raiz do projeto>")
```

Sem MCP, o mesmo pelo terminal: `codegraph explore "<símbolos ou pergunta>"`.

⚠️ **O índice não se atualiza sozinho.** Se as linhas abaixo não baterem com o código,
ele está velho — ver [desenvolvimento.md](desenvolvimento.md) §CodeGraph.

---

## Direção das dependências

Contagem de imports entre áreas. Serve para checar se a arquitetura ainda vale:
`features/` não importa `firebase/firestore` direto, e o domínio não importa ninguém.

| De | Para | Imports |
|---|---|---:|
| PWA · telas | Domínio compartilhado | 63 |
| PWA · telas | PWA · acesso a dados (lib) | 49 |
| PWA · acesso a dados (lib) | Domínio compartilhado | 42 |
| PWA · estado global | PWA · acesso a dados (lib) | 26 |
| PWA · telas | PWA · estado global | 26 |
| PWA · estado global | Domínio compartilhado | 17 |
| PWA · telas | PWA · componentes | 16 |
| PWA · raiz | PWA · telas | 7 |
| PWA · acesso a dados (lib) | Scripts de manutenção | 6 |
| PWA · raiz | PWA · estado global | 5 |
| PWA · raiz | PWA · componentes | 4 |
| PWA · componentes | PWA · estado global | 4 |
| PWA · componentes | Domínio compartilhado | 3 |
| Scripts de manutenção | PWA · acesso a dados (lib) | 3 |
| Scripts de manutenção | Domínio compartilhado | 2 |
| PWA · componentes | PWA · telas | 1 |
| PWA · componentes | PWA · raiz | 1 |
| Configuração | Scripts de manutenção | 1 |

---

## Símbolos mais usados

Contando só usos **de fora do próprio arquivo** — chamada interna não diz nada sobre
acoplamento. Mexer em qualquer um destes tem alcance largo.

| Símbolo | Onde | Usos |
|---|---|---:|
| `Produto` | packages/shared/src/types.ts | 62 |
| `problemasDeProduto` | packages/shared/src/validacao.ts | 27 |
| `registrar` | apps/web/src/lib/historico.ts | 22 |
| `descreverEvento` | packages/shared/src/historico-descricao.ts | 20 |
| `statusDe` | packages/shared/src/auditoria.ts | 19 |
| `montarEnvio` | packages/shared/src/erp-payload.ts | 19 |
| `filtrarProdutos` | packages/shared/src/filtros.ts | 19 |
| `normalizarItensDoErp` | apps/api/src/routes/erp.ts | 19 |
| `withWriteTimeout` | apps/web/src/lib/firestore-write.ts | 18 |
| `sistemaDe` | packages/shared/src/produto.ts | 16 |
| `filtrarLinhas` | packages/shared/src/relatorio.ts | 15 |
| `fisicoDe` | packages/shared/src/produto.ts | 15 |
| `nomeDe` | packages/shared/src/produto.ts | 15 |
| `erroDeNegocio` | apps/api/src/routes/erp.ts | 15 |
| `papelDe` | packages/shared/src/papeis.ts | 14 |
| `chavesDeIdProduto` | packages/shared/src/produto.ts | 14 |
| `carregarFila` | apps/web/src/lib/fila-offline.ts | 13 |
| `enfileirar` | apps/web/src/lib/fila-offline.ts | 13 |
| `isPermissaoNegada` | apps/web/src/lib/fila-offline.ts | 13 |
| `UserProfile` | packages/shared/src/types.ts | 12 |
| `deviceId` | apps/web/src/lib/dispositivo.ts | 12 |
| `useAuth` | apps/web/src/contexts/AuthContext.tsx | 12 |
| `useEstoque` | apps/web/src/contexts/EstoqueContext.tsx | 12 |
| `Papel` | packages/shared/src/types.ts | 11 |
| `isFalhaPermanente` | apps/web/src/lib/fila-offline.ts | 11 |

---

## O que cada módulo exporta

### Domínio compartilhado

**`packages/shared/src/acesso-estoque.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `estoquesPermitidos` | function | 26 | Lista limpa de estoques permitidos. |
| `semRestricaoDeEstoque` | function | 33 | true quando o usuário tem a lista aberta — enxerga tudo. |
| `podeAcessarEstoque` | function | 37 |  |
| `filtrarEstoquesPermitidos` | function | 54 | Filtra a lista de estoques pelo que o usuário pode ver. |

**`packages/shared/src/auditoria.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `statusDe` | function | 38 | Status de auditoria de um produto. |
| `diferencaDe` | function | 55 | Diferença físico - sistema. |
| `calcularEstatisticas` | function | 72 | Estatísticas da auditoria. |
| `montarSnapshotProdutos` | function | 120 | Snapshot dos produtos gravado dentro da auditoria. |

**`packages/shared/src/carregamento.ts`**

_Quando a lista de produtos pode ser mostrada como verdade._

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `ESPERA_SERVIDOR_MS` | constant | 35 |  |
| `ESPERA_CONCILIACAO_MS` | constant | 53 | Teto de espera para a lista de produtos. |
| `EstadoDoSnapshot` | interface | 55 |  |
| `podeLiberarTela` | function | 76 | A tela pode ser liberada para o usuário? |
| `TETO_CONCILIACAO_MS` | constant | 90 | Teto absoluto para continuar dizendo "sincronizando". |
| `EstadoConciliacao` | interface | 92 |  |
| `estaConciliando` | function | 126 | O app ainda deve esconder os totais e dizer "sincronizando"? |

**`packages/shared/src/consolidado.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `CicloConsolidado` | interface | 27 | Uma linha do relatório: o resumo de um ciclo. |
| `TotaisConsolidados` | interface | 50 |  |
| `RelatorioConsolidado` | interface | 66 |  |
| `percentual` | function | 73 | Uma casa decimal, como o resto do projeto. |
| `consolidarCiclos` | function | 116 | Consolida as auditorias escolhidas. |

**`packages/shared/src/erp-payload.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `EnvioEstoque` | interface | 17 | Os oito campos, com os tipos que o 1.x enviava. |
| `montarEnvio` | function | 47 | Monta o payload a partir do produto. |

**`packages/shared/src/filtros.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `OpcaoFiltro` | interface | 16 |  |
| `FILTROS` | constant | 30 |  |
| `filtrosVisiveis` | function | 52 | As abas que um papel pode ver. |
| `mensagemVazio` | function | 56 |  |
| `OpcoesFiltro` | interface | 85 |  |
| `filtrarProdutos` | function | 100 | Aplica filtro, busca e ordenação. |
| `contarPorFiltro` | function | 133 | Contagem de itens por aba, em uma passada e sem ordenar. |
| `ProgressoContagem` | interface | 162 |  |
| `contagemFechada` | function | 183 | A contagem deste estoque está fechada: existe ao menos um item conferido. |
| `progressoContagem` | function | 188 | Progresso da rodada atual, para a barra no topo da tela de contagem. |

**`packages/shared/src/historico-descricao.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `ROTULO_ACAO` | constant | 12 |  |
| `COR_ACAO` | constant | 35 | Cor da etiqueta. |
| `Mudanca` | interface | 58 | Uma alteração de valor. |
| `DescricaoEvento` | interface | 64 |  |
| `descreverEvento` | function | 104 |  |

**`packages/shared/src/papeis.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `papelDe` | function | 19 |  |
| `ROTULO_PAPEL` | constant | 27 |  |
| `Permissoes` | interface | 34 |  |
| `permissoesDe` | function | 76 |  |

**`packages/shared/src/planilha-colunas.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `CampoPlanilha` | type_alias | 17 | Detecção das colunas da planilha do ERP. |
| `normalizarCabecalho` | function | 72 | Minúsculo, sem acento, sem espaço nas pontas. |
| `MapaColunas` | type_alias | 81 | Índice (base 0) de cada campo encontrado nos cabeçalhos. |
| `mapearColunas` | function | 97 | Casa cabeçalhos com campos. |
| `numeroDeCelula` | function | 132 | Número a partir de célula da planilha. |
| `textoDeCelula` | function | 141 | Texto a partir de célula. |

**`packages/shared/src/produto.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `nomeDe` | function | 11 | Nome exibível do produto. |
| `idProdutoDe` | function | 16 | Identificador do produto no ERP. |
| `codigoBarrasDe` | function | 20 |  |
| `chavesDeIdProduto` | function | 31 | Formas em que o IdProduto pode aparecer, para casar com a listagem do ERP. |
| `saldoNoErp` | function | 52 | Saldo do produto na leitura do ERP, ou undefined se o ERP não o conhece. |
| `foraDoErp` | function | 74 | O produto não está na listagem da loja no ERP. |
| `saldoDoErpPara` | function | 94 | Saldo que o ERP atribui ao produto, já resolvida a ausência. |
| `fisicoDe` | function | 109 | Estoque físico: o que o funcionário contou. |
| `sistemaDe` | function | 114 | Estoque do sistema (ERP). |
| `statusContagemDe` | function | 118 |  |
| `isItemContado` | function | 126 | Item contado neste ciclo. |
| `validadeDe` | function | 132 | Data de validade normalizada (YYYY-MM-DD) ou null se ausente/malformada. |

**`packages/shared/src/reconexao.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `ESPERA_BASE_MS` | constant | 13 | Ritmo das retentativas de uma inscrição em tempo real que caiu. |
| `ESPERA_MAXIMA_MS` | constant | 16 | Teto da espera. |
| `FALHAS_ATE_AVISAR` | constant | 25 | Falhas seguidas antes de avisar o usuário. |
| `esperaDeReconexao` | function | 33 | Quanto esperar antes da próxima tentativa. |
| `deveAvisar` | function | 39 | Já falhou o bastante para valer a pena interromper o usuário? |

**`packages/shared/src/relatorio.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `LinhaRelatorio` | interface | 16 |  |
| `linhasDeProdutos` | function | 34 |  |
| `linhasDeSnapshot` | function | 49 |  |
| `ordenarPorNome` | function | 62 |  |
| `SituacaoRelatorio` | type_alias | 68 |  |
| `OrdemRelatorio` | type_alias | 77 | Ordenação do relatório. |
| `ColunaOrdenavel` | type_alias | 90 | Colunas que respondem ao clique no cabeçalho. |
| `ordemAoClicar` | function | 108 | Próxima ordenação ao clicar no cabeçalho da coluna. |
| `direcaoDaColuna` | function | 114 | Direção ativa da coluna, para a seta e o aria-sort. |
| `FiltroRelatorio` | interface | 124 |  |
| `FILTRO_PADRAO` | constant | 132 |  |
| `ROTULO_SITUACAO` | constant | 139 |  |
| `ROTULO_ORDEM` | constant | 145 |  |
| `filtrarLinhas` | function | 199 |  |
| `descreverFiltro` | function | 256 | Frase que descreve o recorte, para o cabeçalho do PDF. |
| `filtroEstaAtivo` | function | 269 | true quando o recorte esconde alguma coisa — o PDF avisa nesse caso. |

**`packages/shared/src/types.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `ProductStatus` | type_alias | 19 | Tipos do domínio do Themis. |
| `StatusAuditoria` | type_alias | 32 | corrigido pelo admin/master após auditoria Status calculado (nunca persistido no produto; vai no snapshot d… |
| `LIMITE_CRITICO` | constant | 35 | Diferença \|físico - sistema\| a partir da qual o item é CRITICO. |
| `Produto` | interface | 38 | estoques/{inventoryId}/produtos/{produtoId} |
| `FiltroContagem` | type_alias | 96 | Abas de filtro da tela de contagem. |
| `Inventory` | interface | 107 | inventories/{inventoryId} — metadados do estoque. |
| `UserProfile` | interface | 120 | users/{uid} — perfil e papéis. |
| `Papel` | type_alias | 135 |  |
| `ProdutoSnapshot` | interface | 138 | Snapshot de um produto dentro de uma auditoria salva. |
| `EstatisticasCorrigidos` | interface | 154 |  |
| `EstatisticasAuditoria` | interface | 161 |  |
| `Auditoria` | interface | 183 | auditorias/{auditoriaId} |
| `AcaoHistorico` | type_alias | 202 | Ações registradas no histórico. |
| `EntradaHistorico` | interface | 225 | historico_geral/{id} |

**`packages/shared/src/validacao.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `LIMITE_NOME_PRODUTO` | constant | 17 | Espelho de validProductData das Firestore Security Rules. |
| `STATUS_PERMITIDOS` | constant | 18 |  |
| `ProblemaProduto` | interface | 20 |  |
| `CAMPOS_OBRIGATORIOS` | constant | 80 |  |
| `descreverTipo` | function | 83 | Nome do tipo encontrado, para a mensagem do relatório. |
| `problemasDeProduto` | function | 95 | Lista o que impediria a gravação. |
| `sugestaoDeConserto` | function | 157 | Sugestão de conserto, para quem for aplicar a correção depois. |

### PWA · acesso a dados (lib)

**`apps/web/src/lib/api.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `API_BASE` | constant | 11 | Endereço base da API. |
| `urlApi` | function | 13 |  |

**`apps/web/src/lib/armazenamento.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `CHAVES` | constant | 9 | Acesso tipado ao localStorage. |
| `ler` | function | 16 |  |
| `gravar` | function | 27 |  |
| `remover` | function | 37 |  |
| `solicitarArmazenamentoPersistente` | function | 50 | Pede ao navegador para não despejar o storage sob pressão de espaço. |

**`apps/web/src/lib/arquivo.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `entregarArquivo` | function | 21 | Entrega de arquivo gerado no navegador. |
| `baixar` | function | 40 |  |
| `nomeDeArquivo` | function | 56 | contagem-deposito-central-2026-08-05.pdf, sem caractere que quebre o sistema de arquivos. |

**`apps/web/src/lib/assinatura.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `Desinscrever` | type_alias | 31 |  |
| `OpcoesAssinatura` | interface | 33 |  |
| `assinaturaResiliente` | function | 61 | Mantém uma inscrição de pé. |
| `marcarViva` | function | 72 | O primeiro snapshot depois de uma queda: zera o backoff e desfaz o aviso. |
| `reabrir` | function | 81 |  |
| `aoAcordar` | function | 113 | Volta da rede e volta do plano de fundo são os dois momentos em que a inscrição costuma estar morta. |

**`apps/web/src/lib/auditorias-repo.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `DadosNovaAuditoria` | interface | 34 |  |
| `montarAuditoria` | function | 41 |  |
| `salvarAuditoria` | function | 62 | Grava a auditoria e devolve o id. |
| `listarAuditorias` | function | 78 |  |
| `buscarAuditoria` | function | 86 |  |
| `excluirAuditoria` | function | 92 |  |

**`apps/web/src/lib/conectividade.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `verificarConexao` | function | 55 | Verifica conectividade real. |
| `OuvinteConexao` | type_alias | 71 |  |
| `monitorarConexao` | function | 77 | Monitora a conexão e chama o ouvinte só quando o estado muda. |

**`apps/web/src/lib/configuracoes-repo.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `Configuracoes` | interface | 19 |  |
| `CONFIGURACOES_PADRAO` | constant | 30 |  |
| `carregarConfiguracoes` | function | 44 |  |
| `ouvirConfiguracoes` | function | 49 |  |
| `salvarConfiguracoes` | function | 71 | Grava as duas chaves de uma vez. |

**`apps/web/src/lib/dispositivo.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `deviceId` | function | 16 |  |
| `deviceLabel` | function | 31 | Rótulo legível para o histórico. |

**`apps/web/src/lib/erp.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `ResultadoEnvio` | interface | 25 |  |
| `enviarAoErp` | function | 30 |  |
| `ResultadoBusca` | interface | 58 |  |
| `buscarEstoqueDoErp` | function | 91 | Lê o saldo atual da loja no ERP. |
| `carregarHashes` | function | 198 |  |
| `hashDaLoja` | function | 215 | Hash da loja ligada a um estoque. |
| `salvarHashes` | function | 226 | Grava o mapa inteiro. |
| `testarHash` | function | 245 | Testa se o hash responde no ERP. |

**`apps/web/src/lib/estoques-repo.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `carregarEstoques` | function | 67 |  |
| `ouvirEstoques` | function | 72 |  |
| `ResultadoFinalizacao` | interface | 87 |  |
| `finalizarCiclo` | function | 98 | Fecha o ciclo de contagem. |
| `criarEstoque` | function | 132 | Cria um estoque. |
| `renomearEstoque` | function | 153 | Renomeia o estoque. |
| `excluirEstoque` | function | 179 | Exclui o estoque e todos os seus produtos. |

**`apps/web/src/lib/fila-offline.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `REMOVER` | constant | 24 | Marcador de "remover este campo". |
| `AlteracaoPendente` | interface | 26 |  |
| `ConflitoProdutoError` | class | 43 |  |
| `isConflito` | function | 51 |  |
| `ProdutoAusenteError` | class | 66 | O documento do produto não existe mais no servidor. |
| `isProdutoAusente` | function | 74 |  |
| `isPermissaoNegada` | function | 91 | A gravação foi recusada pelas regras, não perdida pela rede. |
| `isFalhaPermanente` | function | 107 | A pendência nunca vai passar: insistir é desperdício. |
| `carregarFila` | function | 120 |  |
| `enfileirar` | function | 131 |  |
| `removerDaFila` | function | 160 |  |
| `limparFila` | function | 166 |  |
| `tamanhoFila` | function | 170 |  |
| `aplicarPendentes` | function | 187 | Sobrepõe as alterações da fila na lista vinda do Firestore. |

**`apps/web/src/lib/firebase.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `app` | constant | 45 |  |
| `db` | constant | 47 |  |
| `auth` | constant | 53 |  |

**`apps/web/src/lib/firestore-write.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `DEFAULT_WRITE_TIMEOUT_MS` | constant | 23 |  |
| `DEFAULT_TRANSACTION_TIMEOUT_MS` | constant | 24 |  |
| `markServerOk` | function | 35 |  |
| `markServerFail` | function | 39 |  |
| `lastServerOkAt` | function | 43 |  |
| `lastServerFailAt` | function | 47 |  |
| `WriteTimeoutOptions` | interface | 58 |  |
| `WriteResult` | interface | 63 |  |
| `WriteTimeoutError` | class | 69 | Erro de teto de tempo. |
| `isWriteTimeout` | function | 79 |  |
| `exigirGravacao` | function | 106 | Escrita que precisa da confirmação do servidor. |
| `withWriteTimeout` | function | 120 | Envolve uma escrita do Firestore com teto de tempo. |
| `runTransactionWithTimeout` | function | 168 | runTransaction com teto de tempo. |

**`apps/web/src/lib/historico.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `ContextoLog` | interface | 33 |  |
| `registrar` | function | 41 |  |
| `drenarHistorico` | function | 78 | Reenvia o histórico guardado. |
| `EntradaHistoricoLida` | interface | 109 |  |
| `consultarHistorico` | function | 122 |  |

**`apps/web/src/lib/pdf.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `ContextoRelatorio` | interface | 54 |  |
| `exportarContagemPDF` | function | 186 |  |
| `exportarValidadePDF` | function | 274 | Relatório de validades. |
| `exportarConsolidadoPDF` | function | 352 | Relatório consolidado de auditoria: vários ciclos do mesmo estoque, somados. |

**`apps/web/src/lib/planilha-formato.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `normalizarPacoteXlsx` | function | 64 | Devolve o pacote que o exceljs consegue abrir. |

**`apps/web/src/lib/planilha.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `LinhaImportada` | interface | 37 | Uma linha aproveitada da planilha. |
| `ResultadoImportacao` | interface | 53 |  |
| `lerPlanilha` | function | 69 |  |
| `exportarPlanilha` | function | 133 |  |

**`apps/web/src/lib/produtos-repo.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `colecaoProdutos` | function | 54 |  |
| `ouvirProdutos` | function | 86 | Escuta a coleção em tempo real. |
| `carregarProdutos` | function | 106 |  |
| `BaseCliente` | interface | 119 |  |
| `ResultadoGravacao` | interface | 125 |  |
| `atualizarProduto` | function | 189 | Grava a alteração de um produto. |
| `ResultadoDrenagem` | interface | 229 |  |
| `drenarFila` | function | 250 | Reenvia a fila offline. |
| `criarProduto` | function | 304 | Cria produto. |
| `criarProdutosEmLote` | function | 324 | Cria produtos em lote. |
| `marcarConferido` | function | 356 | Marca o item como conferido pelo admin após a auditoria. |
| `ProdutoDaPlanilha` | interface | 373 | Uma linha da planilha, no formato que a importação consome. |
| `ResultadoImportacaoProdutos` | interface | 389 |  |
| `importarProdutos` | function | 416 | Importa a planilha atualizando quem já existe, em vez de criar tudo de novo. |
| `OpcoesSincronia` | interface | 505 |  |
| `ResultadoSincronia` | interface | 513 |  |
| `atualizarEstoqueSistema` | function | 562 | Grava no Firestore o saldo lido do ERP, no campo estoqueSistema. |
| `ResultadoConferencia` | interface | 620 |  |
| `fecharConferencia` | function | 637 | Fecha a conferência de todos os itens contados, em lote. |
| `desfazerConferido` | function | 674 | Desfaz a conferência: volta o item para a lista de trabalho. |
| `CadastroProduto` | interface | 686 |  |
| `atualizarCadastroProduto` | function | 706 | Altera o cadastro do produto — nome, código de barras, saldo do sistema e código do ERP. |
| `excluirTodosProdutos` | function | 750 |  |
| `excluirProduto` | function | 774 |  |
| `limparContagem` | function | 794 | Zera a contagem do estoque. |

**`apps/web/src/lib/usuarios-repo.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `buscarPerfil` | function | 47 |  |
| `ouvirPerfil` | function | 60 | Acompanha o perfil em tempo real. |
| `salvarEstoquesPermitidos` | function | 89 | Estoques que o usuário pode ver. |
| `listarUsuarios` | function | 96 |  |
| `nomeExibivel` | function | 104 | Nome exibível. |
| `registrarUltimoEstoque` | function | 118 | Guarda o último estoque aberto, para reabrir o app já no lugar certo. |
| `salvarPapeis` | function | 130 | Altera papéis. |

### PWA · estado global

**`apps/web/src/contexts/AuthContext.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `AuthProvider` | function | 33 |  |
| `useAuth` | function | 100 |  |

**`apps/web/src/contexts/EstoqueContext.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `EstoqueProvider` | function | 88 |  |
| `useEstoque` | function | 631 |  |

**`apps/web/src/contexts/ToastContext.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `TipoToast` | type_alias | 3 |  |
| `Toast` | interface | 5 |  |
| `ToastProvider` | function | 27 |  |
| `useToast` | function | 60 |  |

### PWA · componentes

**`apps/web/src/components/Carregando.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `Carregando` | function | 7 |  |

**`apps/web/src/components/Esqueleto.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `Esqueleto` | function | 7 | Placeholder da lista enquanto os produtos carregam. |

**`apps/web/src/components/FaixaConexao.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `FaixaConexao` | function | 11 | Faixa fina de estado da conexão. |

**`apps/web/src/components/Icone.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `NomeIcone` | type_alias | 11 | Ícones em SVG inline. |
| `Icone` | function | 52 |  |

**`apps/web/src/components/Layout.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `Layout` | function | 16 |  |

**`apps/web/src/components/LimiteDeErro.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `LimiteDeErro` | class | 20 | Captura erro de renderização. |

**`apps/web/src/components/MenuPrincipal.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `MenuPrincipal` | function | 56 | Menu principal, em folha. |
| `acionar` | function | 198 |  |

**`apps/web/src/components/Modal.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `Modal` | function | 24 |  |

**`apps/web/src/components/Toasts.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `Toasts` | function | 10 | Avisos flutuantes. |

### PWA · telas

**`apps/web/src/features/auditoria/PainelAuditoria.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `PainelAuditoria` | function | 87 |  |

**`apps/web/src/features/auditoria/RelatorioConsolidado.tsx`**

_Relatório consolidado: escolhe ciclos do estoque e soma._

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `RelatorioConsolidado` | function | 31 |  |
| `alternar` | function | 49 |  |
| `exportar` | function | 60 |  |

**`apps/web/src/features/auth/Login.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `Login` | function | 27 |  |
| `aoEnviar` | function | 34 |  |

**`apps/web/src/features/contagem/CardProduto.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `CardProduto` | component | 216 | memo importa aqui: o listener do Firestore entrega um array novo a cada gravação, e sem isso os 40 cards da… |

**`apps/web/src/features/contagem/FormContagem.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `FormContagem` | function | 28 | Formulário do card expandido. |
| `salvar` | function | 53 |  |

**`apps/web/src/features/contagem/LeitorCodigo.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `LeitorCodigo` | function | 14 |  |
| `iniciar` | function | 26 |  |

**`apps/web/src/features/contagem/TelaContagem.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `TelaContagem` | function | 23 |  |

**`apps/web/src/features/estoques/TelaEstoques.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `TelaEstoques` | function | 17 |  |
| `salvarHashDoEstoque` | function | 45 | O hash vive num documento separado (hashConfigs/inventoryHashes), não no documento do estoque. |
| `alternarSomenteLeitura` | function | 54 | Travar ou destravar a contagem de um estoque. |
| `alternarModoContagem` | function | 71 |  |
| `testar` | function | 82 |  |
| `salvar` | function | 97 |  |
| `excluir` | function | 161 |  |

**`apps/web/src/features/finalizar/ModalFinalizar.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `ModalFinalizar` | function | 20 |  |
| `fechar` | function | 45 |  |
| `finalizar` | function | 50 |  |

**`apps/web/src/features/historico/TelaHistorico.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `TelaHistorico` | function | 41 |  |

**`apps/web/src/features/produtos/corrigir-estoque.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `Diagnostico` | interface | 42 |  |
| `PendenciaErp` | interface | 68 |  |
| `ResultadoCorrecao` | interface | 74 |  |
| `diagnosticar` | function | 103 | Fase 1. |
| `executarCorrecao` | function | 167 | Fases 2 e 3, mais o fechamento da conferência. |
| `reenviarPendentes` | function | 258 | Reenvia o que não refletiu, para o caso de ter sido só demora do ERP. |

**`apps/web/src/features/produtos/ModalCorrigirEstoque.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `ModalCorrigirEstoque` | function | 35 | Conduz o "Corrigir estoque" em três fases, com a confirmação no meio. |
| `reiniciar` | function | 45 |  |
| `rodarDiagnostico` | function | 53 |  |
| `rodarCorrecao` | function | 77 |  |
| `rodarReenvio` | function | 121 |  |

**`apps/web/src/features/produtos/ModalEditarProduto.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `ModalEditarProduto` | function | 29 | Edição de cadastro do produto. |
| `salvar` | function | 52 |  |
| `excluir` | function | 96 |  |

**`apps/web/src/features/produtos/TelaProdutos.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `TelaProdutos` | function | 41 |  |
| `importar` | function | 67 |  |
| `cadastrar` | function | 118 |  |
| `limpar` | function | 150 |  |
| `apagarTudo` | function | 177 | Apaga o catálogo inteiro deste estoque. |
| `buscarEstoque` | function | 215 | Buscar estoque — lê o saldo do ERP e grava em estoqueSistema, sem corrigir nada. |

**`apps/web/src/features/usuarios/TelaUsuarios.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `TelaUsuarios` | function | 42 |  |
| `trocarPapel` | function | 68 |  |
| `abrirAcesso` | function | 96 |  |
| `salvarAcesso` | function | 101 |  |
| `alternar` | function | 137 |  |

### PWA · raiz

**`apps/web/src/App.tsx`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `App` | function | 133 |  |

**`apps/web/src/versao.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `VERSAO` | constant | 19 |  |
| `COMMIT` | constant | 22 | SHA curto do commit. |
| `DATA_BUILD` | constant | 25 | ISO do momento da compilação. |
| `VERSAO_COMPLETA` | constant | 28 | 2.7.0 · a1b2c3d — o que aparece no rodapé do menu. |
| `dataBuildLegivel` | function | 31 | 06/08/2026 19:40, no fuso do aparelho. |

### API

**`apps/api/src/cabecalhos.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `registrarCabecalhos` | function | 62 |  |

**`apps/api/src/config.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `Escuta` | type_alias | 21 | Onde o servidor deve escutar: porta TCP ou caminho de socket Unix. |
| `config` | constant | 41 |  |

**`apps/api/src/estaticos.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `caminhoDoPwa` | function | 41 | dist/estaticos.js roda em apps/api/dist, e o PWA fica em apps/web/dist. |
| `registrarEstaticos` | function | 54 |  |

**`apps/api/src/routes/erp.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `EstoqueNormalizado` | interface | 116 |  |
| `normalizarItensDoErp` | function | 149 | Converte a lista crua do ERP no formato que o app consome. |
| `erroDeNegocio` | function | 213 | Procura erro de negócio no corpo da resposta. |
| `rotasErp` | function | 291 |  |

**`apps/api/src/routes/webhook.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `rotasWebhook` | function | 44 |  |

**`apps/api/src/versao.ts`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `VERSAO` | constant | 24 |  |
| `COMMIT` | constant | 25 |  |
| `DATA_BUILD` | constant | 26 |  |

### Scripts de manutenção

**`scripts/versionar.mjs`**

| Símbolo | Tipo | Linha | O quê |
|---|---|---:|---|
| `versaoAtual` | function | 48 |  |
| `proximaVersao` | function | 53 | 2.6.2 + minor = 2.7.0. |
| `hojeISO` | function | 65 | Data local em ISO. |
| `abrirSecao` | function | 82 | Insere a seção nova logo depois do cabeçalho do arquivo. |
