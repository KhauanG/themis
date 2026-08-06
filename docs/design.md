# Sistema de design

Referência: interfaces empresariais da Apple. Restrição, hierarquia por tipografia, cor
com significado.

Os arquivos ficam em `apps/web/src/estilos/`, importados em ordem por `styles.css`:

```
tokens.css       variáveis — cores, tipografia, espaçamento, forma
base.css         reset, tipografia, primitivos de layout
componentes.css  peças reutilizáveis
telas.css        estilos de uma área específica
```

A ordem importa: cada arquivo usa o anterior. Inverter faz variável não resolver.

---

## Os três princípios

### 1. Cor só com significado

Cinzas carregam a interface. Cor aparece quando comunica **estado** (correto, divergente,
crítico) ou **ação primária**.

Um cartão colorido "porque fica bonito" rouba atenção de um cartão que está avisando de
divergência. Numa tela de auditoria, isso não é questão de gosto — é o auditor não ver o
problema.

Antes de usar cor, pergunte: se tudo aqui ficasse cinza, o que se perderia?

### 2. Hierarquia por peso e espaço, não por caixa

Antes de desenhar borda ou fundo, tente resolver com tamanho, peso da fonte e respiro.

O rótulo em caixa alta com espaçamento (`.rotulo-secao`) separa blocos sem desenhar nada.
É o recurso mais usado do sistema.

### 3. Linhas de cabelo

Separadores de 1px em cinza claro, não blocos de fundo. Uma tabela com régua fina embaixo
de cada linha lê melhor que uma tabela zebrada.

---

## Tokens

Todos em `tokens.css`, com equivalente calibrado para o tema escuro.

| Grupo | Uso |
|---|---|
| `--fundo`, `--superficie`, `--superficie-2/3` | camadas, do fundo da página ao elemento elevado |
| `--borda`, `--borda-suave` | régua visível e régua discreta |
| `--texto`, `--texto-2`, `--texto-3` | principal, apoio, terciário |
| `--acento` | ação primária e seleção |
| `--ok`, `--alerta`, `--critico` | estado, sempre com `-fundo` correspondente |
| `--t-micro` … `--t-display` | escala tipográfica, 11px a 36px |
| `--e1` … `--e12` | espaçamento, escala de 4px |
| `--raio-p/-/-g/-total` | forma |
| `--toque`, `--toque-g` | alvo mínimo de toque |

### Claro é o padrão

Depósito é ambiente iluminado. O escuro é suportado de verdade via
`prefers-color-scheme` — **não é inversão automática**: as cores de estado são
recalibradas, porque os tons do modo claro não têm contraste suficiente em fundo escuro.

`--ok` sai de `#00875a` para `#30d158`; `--critico` de `#c9252d` para `#ff453a`.

### Duas fontes

`--fonte` para texto, `--fonte-numero` (arredondada) para números. Todo número em posição
de comparação leva `font-variant-numeric: tabular-nums` — sem isso as colunas dançam
enquanto o usuário lê.

---

## Componentes

| Classe | Onde |
|---|---|
| `.botao` + `--primario/--secundario/--perigo/--texto` | ações |
| `.campo` + `.campo__rotulo/__entrada/__ajuda` | formulários |
| `.segmentado` | filtros da contagem |
| `.etiqueta` + `--ok/--alerta/--critico/--neutra/--acento` | estado |
| `.acao` | item de lista com ícone, título e descrição |
| `.metrica` | número grande com rótulo |
| `.cartao`, `.tabela-caixa`, `.modal`, `.toast` | contêineres |

`.botao--perigo` usa texto vermelho sobre fundo claro, não fundo vermelho sólido: fundo
vermelho grita antes da hora, e a confirmação é que precisa ser séria.

---

## Ícones

`components/Icone.tsx` — 14 traçados SVG inline. Sem biblioteca: qualquer pacote custaria
mais em peso do que isso. Herdam `currentColor`, então funcionam nos dois temas sem
duplicação.

Traço 1.75 com pontas arredondadas: o suficiente para não sumir na tela do celular sem
pesar ao lado de texto de 15px.

---

## Hierarquia da navegação

**Abas** carregam só o que se visita repetidamente:

| Papel | Abas |
|---|---|
| comum | nenhuma — só a contagem |
| auditor | Contagem · Auditoria |
| admin, master | Contagem · Auditoria · Produtos |

**Menu** é o mapa completo, agrupado por finalidade: Contagem, Relatórios, Gestão, Conta.

Histórico e Usuários vivem só no menu. Com eles nas abas, um master teria cinco abas
disputando a largura do celular.

⚠️ **Item que o papel não permite não aparece** — nem desabilitado, nem com cadeado. O menu
de um funcionário comum não tem seções bloqueadas; simplesmente não tem o que ele não pode
fazer. Item inacessível é ruído, não informação.

---

## PDF

`lib/pdf.ts` usa a mesma linguagem: neutros carregam a página, cor só onde comunica
estado, régua fina no lugar de zebrado ou grade.

A paleta em `COR` espelha os tokens. **Se `tokens.css` mudar, ela muda junto.**

Relatório costuma ser lido em reunião: ruído visual atrapalha mais no papel que na tela.

---

## Acessibilidade

- Alvo de toque de 2,75rem (3,25rem nas ações principais). Contagem é feita com o polegar,
  às vezes com luva
- Foco visível **só para teclado** (`:focus-visible`) — no toque o anel só polui
- Modal e menu prendem o foco e devolvem ao fechar
- `prefers-reduced-motion` zera as transições

---

## Ao mexer

- [ ] A cor nova comunica estado, ou é decoração?
- [ ] Dá para resolver com peso e espaço em vez de borda ou fundo?
- [ ] Funciona nos dois temas? Teste com o aparelho no escuro
- [ ] O alvo de toque tem pelo menos `--toque`?
- [ ] Números em coluna estão com `tabular-nums`?
- [ ] Mexeu na paleta? Atualize `COR` em `lib/pdf.ts`
