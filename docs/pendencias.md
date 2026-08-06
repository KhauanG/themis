# Pendências

O que ficou de fora, com contexto suficiente para retomar sem redescobrir nada.

Cada item traz **por que não foi feito agora** e **quando passa a ser urgente** — sem isso,
uma pendência deliberada vira esquecimento acidental.

| # | Pendência | Esforço | Urgência |
|---|---|---|---|
| 1 | [Migrar a equipe do APK](#1-migrar-a-equipe-do-apk) | dias, quase todo de espera | **é o que fecha o projeto** |
| 2 | [Cabeçalhos de segurança no Fastify](#2-cabeçalhos-de-segurança-no-fastify) | 1 sessão + validação | baixa |
| 3 | [Gerenciar usuários pelo app](#3-criar-e-excluir-usuário-pelo-app) | 1 sessão | baixa |

---

## 1. Migrar a equipe do APK

**Situação.** O Themis 1.x (APK Android) e o 2.0 (PWA) leem o mesmo banco e estão no ar ao
mesmo tempo. A equipe ainda usa o APK.

**Por que não foi feito agora.** Exige tempo de calendário, não de código: precisa de ciclos
de contagem reais para confiar.

**Como fazer.** Roteiro em [../DEPLOY.md](../DEPLOY.md) §Passo 8:

1. Um ou dois funcionários no PWA por alguns dias, o resto no APK
2. Conferir no painel de auditoria que as contagens dos dois aparecem certas
3. Liberar o link para a equipe, com instrução de "Adicionar à tela inicial"
4. Só então desinstalar o APK

⚠️ **Não desative o app antigo antes de um ciclo de contagem inteiro fechado pelo PWA.**

**Quando fica urgente.** Já é o próximo passo. Enquanto os dois convivem, carregamos
restrições que só existem por causa do 1.x: índices que não podem sumir, regras que não
podem endurecer, campos com duas grafias.

**O que destrava depois.** Poder normalizar as duas grafias de campo no banco, remover a
tolerância a flags legadas em `papelDe()` e apertar as Security Rules.

---

## 2. Cabeçalhos de segurança no Fastify

**Situação.** Os cabeçalhos existem em `apps/web/public/.htaccess`, mas **não são
aplicados**: na configuração atual o Node serve o site direto, sem Apache na frente. O
arquivo fica no repositório caso um dia haja servidor web na frente.

**Por que não foi feito agora.** Não tapa buraco conhecido — é defesa em profundidade. E o
único cabeçalho de peso (CSP) quebra o app inteiro, para todo mundo e na hora, se ficar
estrito demais.

### O que cada um resolve, no nosso caso

| Cabeçalho | Contra | Risco de quebrar |
|---|---|---|
| `X-Content-Type-Options: nosniff` | navegador adivinhar tipo de arquivo | nenhum |
| `Referrer-Policy: strict-origin-when-cross-origin` | vazar URL completa em link externo | nenhum |
| `Permissions-Policy: camera=(self), geolocation=(), microphone=()` | limitar recursos à própria página | nenhum |
| `frame-ancestors 'none'` | **clickjacking** | nenhum |
| `Strict-Transport-Security` | forçar HTTPS | baixo (max-age é difícil de desfazer) |
| `Content-Security-Policy` | limitar o estrago de um XSS | ⚠️ **alto** |

**Os dois ganhos concretos:**

- **Clickjacking.** Hoje qualquer site pode embutir o Themis num iframe invisível e induzir
  um funcionário logado a clicar em "Limpar contagem" achando que clica noutra coisa.
  `frame-ancestors 'none'` resolve, com custo zero. É o único risco real que existe hoje.
- **CSP como rede.** O React escapa texto, então XSS é improvável — mas nomes de produto
  vêm do ERP e de planilha, dado que não controlamos. O CSP protege contra o erro que ainda
  não cometemos.

### Como fazer — duas etapas, nunca uma

**Etapa 1.** Publicar os cinco cabeçalhos seguros, e o CSP em modo
**`Content-Security-Policy-Report-Only`**. O navegador não bloqueia nada, só reporta o que
*teria* bloqueado. Usar o app um ou dois dias e olhar o console.

**Etapa 2.** Console limpo → trocar para o modo que bloqueia de fato.

### Armadilhas conhecidas do CSP aqui

- **Firebase precisa de vários domínios** em `connect-src`: `*.googleapis.com`,
  `*.firebaseio.com`, `firestore.googleapis.com`, `identitytoolkit.googleapis.com`,
  `securetoken.googleapis.com`, e `wss:` para o canal de tempo real
- **`blob:` em `img-src` e `object-src`** — PDF e planilha são entregues como blob
- **`worker-src 'self'`** — senão o service worker não registra e o offline morre
- **`style-src` precisa de `'unsafe-inline'`** — usamos `style={{...}}` na barra de
  progresso (`TelaContagem`) e nas etiquetas do histórico (`TelaHistorico`). Alternativa:
  trocar por variáveis CSS e manter o `style-src` estrito
- Errar qualquer um destes = **tela branca em produção, para todos, na hora**

**Esforço.** ~60 linhas num plugin Fastify, mais teste conferindo cada cabeçalho na
resposta. Nenhuma mudança em código de tela.

**Quando fica urgente.** Se o app passar a ser acessível fora da rede da empresa, ou se
algum campo de texto passar a aceitar conteúdo de fora sem passar pelo React.

---

## 3. Criar e excluir usuário pelo app

**Situação.** A tela de usuários (`features/usuarios/`) troca papéis, mas criar e excluir
conta continua no Console do Firebase.

**Por que não foi feito agora.** Criar usuário exige o **Firebase Admin SDK**, que precisa
de service account — um segredo novo no servidor, com poder total sobre o projeto. Não
valia introduzir isso para uma operação que acontece poucas vezes por ano.

**Como fazer.**

1. Service account no servidor, fora do repositório, com permissão mínima
2. Rota `POST /api/usuarios` na API, **só para master** (verificar o ID token no servidor,
   não confiar no cliente)
3. Criar no Auth e o documento em `users/{uid}` na mesma operação — usuário no Auth sem
   documento em `users` entra no app como comum e ninguém entende por quê
4. Excluir precisa apagar nos dois lugares

⚠️ Hoje **nenhum segredo com poder administrativo** existe no servidor. Isso é uma
qualidade, não um acaso: se a hospedagem for comprometida, o atacante não ganha controle do
projeto Firebase. Introduzir o Admin SDK muda esse cálculo — pese antes.

**Quando fica urgente.** Se a rotatividade da equipe crescer a ponto de o Console virar
gargalo.

---

## 4. Fazer `allowedInventories` valer nas Security Rules

**Situação.** Os estoques permitidos por usuário filtram a **interface**, não o acesso.
Qualquer autenticado ainda alcança `estoques/{qualquer}/produtos` montando a requisição na
mão. Detalhes em [seguranca.md](seguranca.md).

**Por que não foi feito agora.** A regra é compartilhada com o Themis 1.x, que está em
produção. Endurecer agora quebraria o app antigo para quem tiver a lista preenchida — e o
1.x não trata `permission-denied` na leitura de produtos.

**Como fazer.** Nas regras de `estoques/{estoqueId}/produtos`, trocar `signedIn()` por algo
como:

```
function podeVerEstoque(estoqueId) {
  let perfil = get(userDoc(request.auth.uid)).data;
  return isMaster() ||
    !('allowedInventories' in perfil) ||
    perfil.allowedInventories.size() == 0 ||
    estoqueId in perfil.allowedInventories;
}
```

⚠️ Isso adiciona um `get()` por operação — conta como leitura cobrada e tem limite de 10
por requisição. Medir o impacto numa importação de 2000 produtos antes de publicar.

**Quando fica urgente.** Quando o 1.x sair do ar, ou se a operação passar a ter dados que
uma loja não pode ver da outra.

---

## Como usar este documento

- Ao concluir um item, mova o registro para o [CHANGELOG.md](CHANGELOG.md) e apague daqui
- Ao decidir **não** fazer, mova para [decisoes.md](decisoes.md) com o motivo — pendência
  descartada em silêncio volta como ideia nova seis meses depois
- Ao adicionar, siga o formato: situação, por que não agora, como fazer, armadilhas, quando
  fica urgente
