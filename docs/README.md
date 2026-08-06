# Documentação do Themis 2.0

Mapa do projeto. Comece por aqui.

> ## A regra
>
> **Alteração de comportamento sem alteração de documentação é alteração incompleta.**
>
> A documentação não é um resumo do código — o código já se descreve. Ela guarda o que o
> código **não consegue dizer**: por que a decisão foi essa, o que já foi tentado e deu
> errado, qual armadilha espera quem mexer ali. Essa informação não está em lugar nenhum
> além daqui, e some junto com a memória de quem escreveu.
>
> Ao encerrar qualquer tarefa, antes de commitar:
>
> 1. Mudou comportamento visível? → [funcionalidades.md](funcionalidades.md)
> 2. Mudou cálculo, status ou ciclo? → [regras-de-negocio.md](regras-de-negocio.md)
> 3. Mudou campo, coleção ou regra do Firestore? → [dados.md](dados.md) e [seguranca.md](seguranca.md)
> 4. Escolheu entre dois caminhos? → [decisoes.md](decisoes.md)
> 5. Perdeu tempo com uma pegadinha? → [armadilhas.md](armadilhas.md) **(o mais valioso)**
> 6. Sempre → [CHANGELOG.md](CHANGELOG.md)

---

## Índice

| Documento | Responde |
|---|---|
| [visao-geral.md](visao-geral.md) | O que é o Themis, para quem, em que contexto roda |
| [arquitetura.md](arquitetura.md) | Como o projeto é montado e por quê |
| [dados.md](dados.md) | Coleções do Firestore, campos, tipos, armadilhas do modelo |
| [funcionalidades.md](funcionalidades.md) | Cada tela, o que faz, quem pode |
| [design.md](design.md) | Sistema visual: tokens, componentes, hierarquia |
| [regras-de-negocio.md](regras-de-negocio.md) | Status, estatísticas, ciclo, validade |
| [offline.md](offline.md) | Conexão, fila, escrita com teto de tempo |
| [seguranca.md](seguranca.md) | Papéis, Security Rules, segredos |
| [desenvolvimento.md](desenvolvimento.md) | Rodar, testar, convenções de código |
| [decisoes.md](decisoes.md) | Registro das escolhas e do motivo de cada uma |
| [armadilhas.md](armadilhas.md) | O que já custou caro. Leia antes de mexer |
| [pendencias.md](pendencias.md) | O que ficou de fora, e o contexto para retomar |
| [CHANGELOG.md](CHANGELOG.md) | Histórico de alterações |
| [../DEPLOY.md](../DEPLOY.md) | Publicar em produção |

## Caminhos rápidos

**Vou mexer na contagem** → [regras-de-negocio.md](regras-de-negocio.md) e [offline.md](offline.md)

**Vou gravar algo no Firestore** → [dados.md](dados.md) §Tipos e [offline.md](offline.md) §Escrita com teto

**Vou mexer na auditoria** → [regras-de-negocio.md](regras-de-negocio.md) §Status

**Algo quebrou em produção** → [armadilhas.md](armadilhas.md)

**Sou um agente e vou trabalhar aqui** → [../CLAUDE.md](../CLAUDE.md)

## Estado atual

| | |
|---|---|
| Versão | 2.0.0 |
| No ar em | `https://themis.grupoicebeer.com.br` |
| Firestore | projeto `auditoria-icebeer` — **o mesmo do Themis 1.x** |
| Testes | 77 |
| Código-fonte | ~5.700 linhas |
| Convivendo com | Themis 1.x (APK Android), lendo o mesmo banco |
