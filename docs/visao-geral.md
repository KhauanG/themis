# Visão geral

## O que é

Aplicativo de **contagem e auditoria de estoque** do Grupo Ice Beer. Funcionários percorrem
o depósito contando produto por produto; auditores e administradores conferem as
divergências contra o estoque do ERP.

## Quem usa

| Papel | Quem é | O que faz |
|---|---|---|
| **Comum** | Funcionário de loja/depósito | Conta produtos, registra validade, finaliza a contagem |
| **Auditor** | Conferência | Lê o painel de auditoria e o histórico |
| **Admin** | Gerência | Tudo do auditor, mais gerenciar produtos, corrigir contagem, enviar ao ERP |
| **Master** | Administração do sistema | Tudo, mais gerenciar papéis de usuário |

## O contexto que explica quase todas as decisões

O app é usado **em pé, no depósito, com uma mão, em celular Android, com wifi ruim**.

Disso decorre praticamente todo o resto:

- **Offline é caso de uso normal, não exceção.** Contar não pode parar porque a rede caiu.
- **Rede lenta é pior que rede ausente.** Offline o app detecta e enfileira; lenta ele se
  acha online e espera para sempre. Ver [offline.md](offline.md).
- **Vários aparelhos contam o mesmo estoque ao mesmo tempo.** 4 ou 5 celulares. Toda
  decisão de estado precisa considerar concorrência.
- **Alvo de toque grande.** Às vezes com luva.
- **A tela nunca pode travar.** Se o funcionário não sabe se a contagem salvou, ele
  reconta — e o trabalho dobra.

## Como se relaciona com o Themis 1.x

O 1.x é um app Android (Capacitor + JavaScript sem build) que **continua em produção**.

Os dois leem e escrevem o **mesmo banco Firestore**, com as mesmas coleções e as mesmas
Security Rules. Não houve migração de dados.

Consequências práticas:

- Formato gravado precisa continuar legível pelo 1.x
- Índices do Firestore usados pelo 1.x não podem ser removidos
- Regras não podem ser endurecidas sem quebrar o app antigo
- Campos com duas grafias (`nome`/`NomeProduto`) precisam continuar sendo aceitos

A transição está descrita em [../DEPLOY.md](../DEPLOY.md) §Migrar quem usa o APK.

## O que mudou do 1.x para o 2.0

| | 1.x | 2.0 |
|---|---|---|
| Distribuição | APK/AAB na Play Store | PWA, instalável pelo navegador |
| Atualização | Build + revisão da loja | Push na `main`, chega no próximo carregamento |
| Código | JavaScript sem build, `app.js` com 8.339 linhas | TypeScript, módulos, 77 testes |
| Leitor de código | zxing + html5-qrcode (750 KB) | `BarcodeDetector` nativo |
| Backend | nenhum | Fastify servindo PWA e API |
| Bundle inicial | ~2,5 MB de bibliotecas soltas | 826 KB (219 KB comprimido) |

## Fora de escopo

- **iOS.** Nenhum auditor usa iPhone. `BarcodeDetector` e Web Share de arquivo não
  funcionam de forma confiável no Safari.
- **Cadastro de usuário pelo app.** Continua no Console do Firebase.
- **Substituir o ERP.** O Themis conta e reporta; quem manda no estoque é o ERP.
