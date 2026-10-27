/**
 * Testes das Security Rules, contra o emulador do Firestore.
 *
 * ## Por que existem
 *
 * As regras são o **único** controle de acesso real do Themis — esconder botão não protege
 * nada. E são o tipo de código que ninguém exercita até o dia em que tranca a equipe fora
 * no meio de um inventário. Até aqui a única verificação era o Rules Playground do Console,
 * feito à mão, seis casos, sem repetição garantida.
 *
 * ## Como rodar
 *
 * ```
 * npm run testar-regras
 * ```
 *
 * ⚠️ Exige **JDK 21 ou superior** — o emulador do Firestore roda em Java, e o
 * `firebase-tools` recusa versões anteriores. Instalação no Windows:
 *
 * ```
 * winget install Microsoft.OpenJDK.21
 * ```
 *
 * Nada aqui toca o projeto de verdade: o emulador sobe local, em memória, e some no fim.
 *
 * ## O que NÃO está coberto
 *
 * Só o que a regra decide. A tolerância a flags legadas (`isAuditor` como `"true"` ou `1`)
 * mora em `papelDe()`, no app, e é testada em `papeis.test.ts` — a regra compara com `true`
 * estrito e é assim mesmo.
 */
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let ambiente: RulesTestEnvironment;

/** Produto mínimo que passa em `validProductData`. Faltar campo aqui mascara o teste. */
const PRODUTO_VALIDO = { nome: 'Cerveja Lata', quantidade: 0, codigoBarras: '789' };

beforeAll(async () => {
  ambiente = await initializeTestEnvironment({
    projectId: 'themis-regras-teste',
    firestore: {
      rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await ambiente?.cleanup();
});

/**
 * Semeia perfis e produtos **por fora das regras**.
 *
 * `withSecurityRulesDisabled` existe para isto: montar o cenário sem que o próprio setup
 * dependa do que está sendo testado. Semear com as regras ligadas faria um teste falhar por
 * causa do outro.
 */
beforeEach(async () => {
  await ambiente.clearFirestore();

  await ambiente.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'users/master'), { firstName: 'M', lastName: 'M', isMaster: true });
    await setDoc(doc(db, 'users/admin'), { firstName: 'A', lastName: 'A', isAdmin: true });
    await setDoc(doc(db, 'users/semLista'), { firstName: 'S', lastName: 'L' });
    await setDoc(doc(db, 'users/listaVazia'), {
      firstName: 'L',
      lastName: 'V',
      allowedInventories: [],
    });
    await setDoc(doc(db, 'users/soLojaX'), {
      firstName: 'X',
      lastName: 'X',
      allowedInventories: ['X'],
    });
    await setDoc(doc(db, 'users/soLojaY'), {
      firstName: 'Y',
      lastName: 'Y',
      allowedInventories: ['Y'],
    });

    // `semDoc` de propósito não existe em `users/`.

    await setDoc(doc(db, 'estoques/X/produtos/p1'), PRODUTO_VALIDO);
    await setDoc(doc(db, 'estoques/Y/produtos/p1'), PRODUTO_VALIDO);
    await setDoc(doc(db, 'inventories/X'), { name: 'Loja X', contagemCycle: 1 });
  });
});

/** Firestore autenticado como `uid`. */
function como(uid: string) {
  return ambiente.authenticatedContext(uid).firestore();
}

/**
 * O caso que a 2.13.0 existe para criar, e os cinco que ela não pode quebrar.
 *
 * As três portas abertas — master, sem documento de perfil, lista vazia — são deliberadas.
 * Cada uma evita trancar alguém fora, e inverter qualquer uma para no meio de um inventário.
 */
describe('podeAcessarEstoque — escrita em produtos', () => {
  const contar = (db: ReturnType<typeof como>, estoque: string) =>
    updateDoc(doc(db, `estoques/${estoque}/produtos/p1`), {
      ...PRODUTO_VALIDO,
      quantidade: 7,
      productStatus: 'ATUALIZADO',
    });

  it('master escreve em qualquer estoque', async () => {
    await assertSucceeds(contar(como('master'), 'X'));
    await assertSucceeds(contar(como('master'), 'Y'));
  });

  it('sem allowedInventories escreve em qualquer estoque', async () => {
    await assertSucceeds(contar(como('semLista'), 'X'));
  });

  it('lista vazia significa todos, não nenhum', async () => {
    await assertSucceeds(contar(como('listaVazia'), 'X'));
  });

  it('lista com o estoque permite', async () => {
    await assertSucceeds(contar(como('soLojaX'), 'X'));
  });

  // O ponto da mudança. Se este passar a permitir, a barreira sumiu.
  it('lista SEM o estoque nega', async () => {
    await assertFails(contar(como('soLojaX'), 'Y'));
    await assertFails(contar(como('soLojaY'), 'X'));
  });

  // Falha ao ler o perfil não pode parar a contagem.
  it('usuário sem documento de perfil escreve', async () => {
    await assertSucceeds(contar(como('semDoc'), 'X'));
  });

  it('não autenticado não escreve', async () => {
    await assertFails(contar(ambiente.unauthenticatedContext().firestore(), 'X'));
  });
});

/**
 * A leitura continua liberada de propósito: o app lista todos os estoques para montar o
 * seletor e filtra do lado do cliente. Fechar aqui quebraria o seletor.
 */
describe('leitura de produtos permanece aberta', () => {
  it('lê estoque fora da própria lista', async () => {
    await assertSucceeds(getDoc(doc(como('soLojaX'), 'estoques/Y/produtos/p1')));
  });

  it('não autenticado não lê', async () => {
    await assertFails(
      getDoc(doc(ambiente.unauthenticatedContext().firestore(), 'estoques/X/produtos/p1')),
    );
  });
});

/** Fechar o ciclo de um estoque que a pessoa não pode contar é tão errado quanto contar. */
describe('podeAcessarEstoque — ciclo em inventories', () => {
  const fecharCiclo = (db: ReturnType<typeof como>, id: string) =>
    updateDoc(doc(db, `inventories/${id}`), {
      contagemCycle: 2,
      lastFinalizedCycle: 1,
      lastFinalizedAt: new Date(),
      updatedAt: new Date(),
    });

  it('permitido no estoque fecha o ciclo', async () => {
    await assertSucceeds(fecharCiclo(como('soLojaX'), 'X'));
  });

  it('não permitido não fecha o ciclo', async () => {
    await assertFails(fecharCiclo(como('soLojaY'), 'X'));
  });
});

/**
 * Lote da rodada, em `inventories`.
 *
 * Na 2.17 só admin abria, por limitação da própria regra. A 2.18 acrescentou `lote` e
 * `loteCiclo` ao conjunto que o usuário comum pode alterar — quem conta é quem sabe qual
 * lote está na mão. Estes testes fixam o que ele ganhou **e o que continua barrado**.
 */
describe('lote em inventories', () => {
  const abrir = (db: ReturnType<typeof como>, id: string, lote: string) =>
    updateDoc(doc(db, `inventories/${id}`), { lote, loteCiclo: 1, updatedAt: new Date() });

  it('usuário comum abre o lote do estoque que pode contar', async () => {
    await assertSucceeds(abrir(como('semLista'), 'X', 'LOTE A'));
  });

  it('master também abre', async () => {
    await assertSucceeds(abrir(como('master'), 'X', 'LOTE A'));
  });

  // A barreira que continua de pé: lote é da rodada daquele estoque.
  it('não abre lote em estoque que não pode contar', async () => {
    await assertFails(abrir(como('soLojaY'), 'X', 'LOTE A'));
  });

  it('não autenticado não abre', async () => {
    await assertFails(abrir(ambiente.unauthenticatedContext().firestore(), 'X', 'LOTE A'));
  });

  /*
    O ramo do usuário comum é `hasOnly`. Liberar o lote não pode ter aberto a porta para o
    resto do documento — renomear o estoque continua sendo de admin.
  */
  it('não usa o lote como carona para renomear o estoque', async () => {
    await assertFails(
      updateDoc(doc(como('semLista'), 'inventories/X'), {
        lote: 'LOTE A',
        loteCiclo: 1,
        name: 'Nome Roubado',
      }),
    );
  });

  it('recusa lote que não é texto', async () => {
    await assertFails(
      updateDoc(doc(como('semLista'), 'inventories/X'), { lote: 42, loteCiclo: 1 }),
    );
  });

  // Sem teto, um cliente adulterado grava um romance no documento do estoque.
  it('recusa lote acima do limite', async () => {
    await assertFails(
      updateDoc(doc(como('semLista'), 'inventories/X'), { lote: 'x'.repeat(41), loteCiclo: 1 }),
    );
  });

  it('aceita exatamente o limite', async () => {
    await assertSucceeds(
      updateDoc(doc(como('semLista'), 'inventories/X'), { lote: 'x'.repeat(40), loteCiclo: 1 }),
    );
  });

  // Finalizar e abrir lote no mesmo payload continua cabendo no conjunto da rodada.
  it('fecha o ciclo e abre o lote na mesma escrita', async () => {
    await assertSucceeds(
      updateDoc(doc(como('soLojaX'), 'inventories/X'), {
        contagemCycle: 2,
        lastFinalizedCycle: 1,
        lastFinalizedAt: new Date(),
        updatedAt: new Date(),
        lote: 'LOTE B',
        loteCiclo: 2,
      }),
    );
  });
});


/**
 * Item conferido sai da lista de trabalho e não volta pela mão de quem só conta. É a regra
 * que sustenta o travamento da rodada — a interface só acompanha.
 */
describe('podeAlterarStatusProduto', () => {
  beforeEach(async () => {
    await ambiente.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'estoques/X/produtos/conferido'), {
        ...PRODUTO_VALIDO,
        productStatus: 'CONFERIDO',
        corrigidoIncorreto: true,
      });
    });
  });

  it('comum não reabre item conferido', async () => {
    await assertFails(
      updateDoc(doc(como('semLista'), 'estoques/X/produtos/conferido'), {
        ...PRODUTO_VALIDO,
        productStatus: 'ATUALIZADO',
      }),
    );
  });

  it('comum não mexe em corrigidoIncorreto', async () => {
    await assertFails(
      updateDoc(doc(como('semLista'), 'estoques/X/produtos/p1'), {
        ...PRODUTO_VALIDO,
        corrigidoIncorreto: true,
      }),
    );
  });

  it('admin reabre item conferido', async () => {
    await assertSucceeds(
      updateDoc(doc(como('admin'), 'estoques/X/produtos/conferido'), {
        ...PRODUTO_VALIDO,
        productStatus: 'ATUALIZADO',
      }),
    );
  });
});

/**
 * Os tipos que o app grava precisam passar. `null` e `'PENDENTE'` são os dois erros que já
 * custaram tempo real — ver docs/armadilhas.md.
 */
describe('validProductData', () => {
  const gravar = (dados: Record<string, unknown>) =>
    updateDoc(doc(como('master'), 'estoques/X/produtos/p1'), dados);

  it('recusa quantidade nula', async () => {
    await assertFails(gravar({ ...PRODUTO_VALIDO, quantidade: null }));
  });

  it("recusa productStatus 'PENDENTE'", async () => {
    await assertFails(gravar({ ...PRODUTO_VALIDO, productStatus: 'PENDENTE' }));
  });

  it('recusa nome vazio', async () => {
    await assertFails(gravar({ ...PRODUTO_VALIDO, nome: '' }));
  });

  it('aceita o payload normal da contagem', async () => {
    await assertSucceeds(
      gravar({ ...PRODUTO_VALIDO, quantidade: 3, productStatus: 'ATUALIZADO', dataValidade: '2026-12-31' }),
    );
  });
});

/** Quem lê o histórico. Decisão registrada em docs/decisoes.md §18. */
describe('historico_geral', () => {
  beforeEach(async () => {
    await ambiente.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'historico_geral/e1'), {
        action: 'LOGIN',
        userId: 'admin',
        userEmail: 'a@b.c',
        userName: 'A',
        timestamp: new Date(),
      });
    });
  });

  it('só master lê', async () => {
    await assertSucceeds(getDoc(doc(como('master'), 'historico_geral/e1')));
    await assertFails(getDoc(doc(como('admin'), 'historico_geral/e1')));
    await assertFails(getDoc(doc(como('semLista'), 'historico_geral/e1')));
  });

  // Todo mundo escreve o próprio rastro, senão o histórico não registra a operação.
  it('qualquer autenticado grava o próprio registro', async () => {
    await assertSucceeds(
      setDoc(doc(como('semLista'), 'historico_geral/novo'), {
        action: 'MODIFICAR_PRODUTO',
        userId: 'semLista',
        userEmail: 'a@b.c',
        userName: 'S',
        timestamp: new Date(),
      }),
    );
  });

  it('não grava registro em nome de outro', async () => {
    await assertFails(
      setDoc(doc(como('semLista'), 'historico_geral/falso'), {
        action: 'MODIFICAR_PRODUTO',
        userId: 'master',
        userEmail: 'a@b.c',
        userName: 'S',
        timestamp: new Date(),
      }),
    );
  });
});

/** Exclusão é sempre de master — inclusive a de "Apagar todos os produtos". */
describe('exclusões exigem master', () => {
  it('admin não apaga produto', async () => {
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(como('admin'), 'estoques/X/produtos/p1')));
  });

  it('master apaga produto', async () => {
    const { deleteDoc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(como('master'), 'estoques/X/produtos/p1')));
  });
});

/** `hashConfigs` é master-only — foi o que fazia todo save de admin parecer que falhou. */
describe('hashConfigs exige master', () => {
  it('admin não grava hash', async () => {
    await assertFails(
      setDoc(doc(como('admin'), 'hashConfigs/inventoryHashes'), { hashes: { X: 'abc' } }),
    );
  });

  it('master grava hash', async () => {
    await assertSucceeds(
      setDoc(doc(como('master'), 'hashConfigs/inventoryHashes'), { hashes: { X: 'abc' } }),
    );
  });

  it('só cargo alto lê hash', async () => {
    const ler = (uid: string) => getDoc(doc(como(uid), 'hashConfigs/inventoryHashes'));
    await assertSucceeds(ler('master'));
    await assertSucceeds(ler('admin'));
    await assertFails(ler('semLista'));
    await assertFails(ler('semDoc'));
  });
});

/** Prova que o Firestore e a regra fazem o que `salvarHashDaLoja` supõe, no mesmo formato. */
describe('hashConfigs com merge por chave', () => {
  it('gravar ou apagar uma chave não mexe nas outras', async () => {
    const ref = (uid: string) => doc(como(uid), 'hashConfigs/inventoryHashes');
    await ambiente.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'hashConfigs/inventoryHashes'), { hashes: { X: 'a', Y: 'b' } });
    });
    await assertSucceeds(setDoc(ref('master'), { hashes: { Z: 'c' }, updatedAt: new Date() }, { merge: true }));
    await assertSucceeds(setDoc(ref('master'), {
      hashes: { X: deleteField() }, inventoryHashes: { X: deleteField() }, updatedAt: new Date(),
    }, { merge: true }));
    const dados = (await getDoc(ref('master'))).data();
    expect(dados?.['hashes']).toEqual({ Y: 'b', Z: 'c' });
    // Ausente ou mapa vazio servem: os dois são lidos como "nada" por carregarHashes.
    expect(dados?.['inventoryHashes'] ?? {}).toEqual({});
  });
});

// O id fixo só evita duplicata porque a regra não deixa quem não é master regravar.
describe('auditoria com id fixo', () => {
  it('quem só conta cria a auditoria do ciclo, mas não a regrava', async () => {
    const dados = {
      nome: 'Loja X - Ciclo 1', inventoryId: 'X', data: new Date(), produtos: [], estatisticas: {}, contagemCycle: 1,
    };
    await assertSucceeds(setDoc(doc(como('semLista'), 'auditorias/X_1'), dados));
    await assertFails(setDoc(doc(como('semLista'), 'auditorias/X_1'), dados));
  });
});
