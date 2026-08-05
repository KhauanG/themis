/**
 * Varredura de produtos legados que as Security Rules recusariam.
 *
 * SOMENTE LEITURA. Não grava nada, não corrige nada — lista.
 *
 * Por que existe: `validProductData` valida o documento **resultante** de qualquer
 * update. Se um produto antigo tem `corrigidoIncorreto: null` ou `lastModified` gravado
 * como texto, o funcionário que tentar contá-lo recebe permission-denied — mesmo sem
 * encostar nesse campo. Em campo o sintoma é "não salva", e é difícil de diagnosticar
 * porque só acontece com alguns produtos.
 *
 * A validação vive em `@themis/shared` (`validacao.ts`) e é coberta por testes; este
 * script só percorre o banco e formata o relatório.
 *
 * Autenticação: SDK cliente com o login normal do app. As regras liberam leitura para
 * qualquer usuário autenticado, então não é preciso service account.
 *
 * Uso (o `npm run build` precisa ter rodado antes, para o @themis/shared existir):
 *   npm run build
 *   node --env-file=apps/web/.env scripts/auditar-produtos.mjs
 *
 * Credenciais por variável de ambiente (opcional; sem elas o script pergunta):
 *   THEMIS_EMAIL=...  THEMIS_SENHA=...
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { writeFile } from 'node:fs/promises';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, getDocs, getFirestore } from 'firebase/firestore';
import { problemasDeProduto, sugestaoDeConserto } from '@themis/shared';

function config() {
  const faltando = [];
  const pegar = (nome) => {
    const v = process.env[nome];
    if (!v) faltando.push(nome);
    return v;
  };
  const cfg = {
    apiKey: pegar('VITE_FIREBASE_API_KEY'),
    authDomain: pegar('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: pegar('VITE_FIREBASE_PROJECT_ID'),
    appId: pegar('VITE_FIREBASE_APP_ID'),
  };
  if (faltando.length > 0) {
    console.error(`Faltam variáveis: ${faltando.join(', ')}`);
    console.error('Rode com: node --env-file=apps/web/.env scripts/auditar-produtos.mjs');
    process.exit(1);
  }
  return cfg;
}

async function credenciais() {
  if (process.env.THEMIS_EMAIL && process.env.THEMIS_SENHA) {
    return { email: process.env.THEMIS_EMAIL, senha: process.env.THEMIS_SENHA };
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const email = await rl.question('E-mail do Themis: ');
    const senha = await rl.question('Senha: ');
    return { email: email.trim(), senha };
  } finally {
    rl.close();
  }
}

const COLUNAS = ['estoque', 'produtoId', 'nome', 'campo', 'encontrado', 'esperado', 'sugestao'];

function paraCsv(linhas) {
  const escapar = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [
    COLUNAS.join(','),
    ...linhas.map((l) => COLUNAS.map((c) => escapar(l[c])).join(',')),
  ].join('\n');
}

async function principal() {
  const app = initializeApp(config());
  const auth = getAuth(app);
  const db = getFirestore(app);

  const { email, senha } = await credenciais();
  console.log(`\nAutenticando ${email}...`);
  await signInWithEmailAndPassword(auth, email, senha);
  console.log('OK. Lendo o banco (nada será alterado).\n');

  // Os IDs vêm de `inventories`: a subcoleção de produtos pode existir sem que o
  // documento pai `estoques/{id}` exista, e aí listar `estoques` não devolveria nada.
  const inventarios = await getDocs(collection(db, 'inventories'));
  if (inventarios.empty) {
    console.log('Nenhum estoque encontrado em `inventories`.');
    return;
  }

  const achados = [];
  let totalProdutos = 0;

  for (const inv of inventarios.docs) {
    const nomeEstoque = inv.data().nome ?? inv.id;
    const produtos = await getDocs(collection(db, 'estoques', inv.id, 'produtos'));
    totalProdutos += produtos.size;

    let comProblema = 0;
    for (const prod of produtos.docs) {
      const dados = prod.data();
      const problemas = problemasDeProduto(dados);
      if (problemas.length === 0) continue;
      comProblema++;
      for (const p of problemas) {
        achados.push({
          estoque: nomeEstoque,
          produtoId: prod.id,
          nome: typeof dados.nome === 'string' ? dados.nome : (dados.NomeProduto ?? '(sem nome)'),
          campo: p.campo,
          encontrado: p.encontrado,
          esperado: p.esperado,
          sugestao: sugestaoDeConserto(p),
        });
      }
    }

    console.log(
      `${nomeEstoque}: ${produtos.size} produtos — ${comProblema === 0 ? 'ok' : `${comProblema} com problema`}`,
    );
  }

  console.log(`\n${totalProdutos} produtos verificados.`);

  if (achados.length === 0) {
    console.log('Nenhum documento violaria as regras. Nada a corrigir.');
    return;
  }

  const porCampo = new Map();
  for (const a of achados) porCampo.set(a.campo, (porCampo.get(a.campo) ?? 0) + 1);

  const afetados = new Set(achados.map((a) => `${a.estoque}/${a.produtoId}`)).size;
  console.log(`\n${afetados} produtos seriam recusados pelas regras. Por campo:\n`);
  for (const [campo, total] of [...porCampo].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(total).padStart(5)}  ${campo}`);
  }

  await writeFile('produtos-invalidos.csv', paraCsv(achados), 'utf8');
  await writeFile('produtos-invalidos.json', JSON.stringify(achados, null, 2), 'utf8');
  console.log('\nRelatório: produtos-invalidos.csv e produtos-invalidos.json');
  console.log('Nada foi alterado no banco.');
}

principal().then(
  () => process.exit(0),
  (erro) => {
    console.error('\nFalhou:', erro?.code ?? '', erro?.message ?? erro);
    process.exit(1);
  },
);
