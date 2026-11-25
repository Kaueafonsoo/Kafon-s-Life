/* Testes de js/validacoes.js. Rodar: node scripts/testar-validacoes.js */
const assert = require('assert');
const v = require('../js/validacoes.js');

let ok = 0;
function t(nome, fn) { fn(); ok++; console.log('  ok  ' + nome); }

t('repetidas: ignora maiúsculas, acentos e espaços a mais; fica a primeira grafia', () => {
  assert.deepStrictEqual(v.removerRepetidas(['Saúde', 'saude', 'SAÚDE ', 'Lazer', 'lazer']), ['Saúde', 'Lazer']);
  assert.deepStrictEqual(v.removerRepetidas(['Cartão de Crédito', 'cartao  de   credito', 'Pix']), ['Cartão de Crédito', 'Pix']);
  assert.deepStrictEqual(v.removerRepetidas(['Educação', 'Educacao', 'EDUCAÇÃO']), ['Educação']);
});

t('repetidas: mantém a ordem, tira linhas vazias e não confunde nomes parecidos', () => {
  assert.deepStrictEqual(v.removerRepetidas(['B', '', 'A', '  ', 'b']), ['B', 'A']);
  assert.deepStrictEqual(v.removerRepetidas(['Casa', 'Casal', 'Carro']), ['Casa', 'Casal', 'Carro']);
  assert.deepStrictEqual(v.removerRepetidas([]), []);
});

t('dia padrão do lançamento: hoje, limitado ao último dia do mês exibido', () => {
  assert.strictEqual(v.diaPadraoDoMes(15, 2026, 10), 15);   // 15 de novembro
  assert.strictEqual(v.diaPadraoDoMes(31, 2026, 10), 30);   // novembro tem 30 dias
  assert.strictEqual(v.diaPadraoDoMes(31, 2027, 1), 28);    // fevereiro de 2027 (não bissexto)
  assert.strictEqual(v.diaPadraoDoMes(31, 2028, 1), 29);    // fevereiro de 2028 (bissexto)
  assert.strictEqual(v.diaPadraoDoMes(29, 2027, 0), 29);    // janeiro: o dia 29 é usado de verdade, não cortado em 28
  assert.strictEqual(v.diaPadraoDoMes(30, 2026, 11), 30);   // dezembro
  assert.strictEqual(v.diaPadraoDoMes(1, 2026, 1), 1);
});

/* ---------- Excluir conta: a ordem das exclusões (api/excluir-conta.js) ---------- */

const path = require('path');
const comumPath = path.join(__dirname, '..', 'api', '_comum.js');

/** Carrega o endpoint com um Supabase de mentira que anota cada chamada, na ordem em que acontecem. */
function carregarEndpoint({ falharEm } = {}) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-teste';
  const chamadas = [];
  const fake = {
    auth: {
      getUser: async (token) => (token === 'token-valido' ? { data: { user: { id: 'usuario-do-token' } }, error: null } : { data: null, error: { message: 'invalido' } }),
      admin: { deleteUser: async (id) => { chamadas.push({ passo: 'auth.deleteUser', id }); return { error: null }; } },
    },
    from(tabela) {
      return { delete() { return { eq: async (coluna, valor) => {
        chamadas.push({ passo: tabela, coluna, valor });
        return { error: falharEm === tabela ? { message: 'violates foreign key constraint' } : null };
      } }; } };
    },
  };
  require.cache[require.resolve(comumPath)] = { id: comumPath, filename: comumPath, loaded: true, exports: { criarSupabase: () => fake } };
  delete require.cache[require.resolve('../api/excluir-conta.js')];
  return { handler: require('../api/excluir-conta.js'), chamadas };
}

async function chamarEndpoint(handler, corpo = { confirmar: true }) {
  const res = { status(c) { this.codigo = c; return this; }, json(o) { this.corpo = o; return this; }, setHeader() {}, end() { return this; } };
  await handler({ method: 'POST', headers: { authorization: 'Bearer token-valido' }, body: corpo }, res);
  return res;
}

async function testesAssincronos() {
  const ta = async (nome, fn) => { await fn(); ok++; console.log('  ok  ' + nome); };

  await ta('excluir conta: transferências são apagadas PRIMEIRO, e o usuário do Auth por ÚLTIMO', async () => {
    const { handler, chamadas } = carregarEndpoint();
    const res = await chamarEndpoint(handler);
    assert.strictEqual(res.codigo, 200);
    const passos = chamadas.map(c => c.passo);
    assert.strictEqual(passos[0], 'transferencias', 'a primeira exclusão tem que ser a das transferências');
    assert.strictEqual(passos[passos.length - 1], 'auth.deleteUser', 'o usuário do Auth só sai depois de todos os dados');
  });

  await ta('excluir conta: faturas e lançamentos saem antes de cartões e contas (filhos antes dos pais)', async () => {
    const { handler, chamadas } = carregarEndpoint();
    await chamarEndpoint(handler);
    const pos = (t) => chamadas.findIndex(c => c.passo === t);
    assert.ok(pos('transferencias') < pos('contas'), 'transferências antes das contas (a trava "restrict" aponta pra elas)');
    assert.ok(pos('faturas') < pos('cartoes'));
    assert.ok(pos('lancamentos') < pos('cartoes'));
    assert.ok(pos('cartoes') < pos('contas'));
  });

  await ta('excluir conta: apaga as 10 tabelas do usuário, cada uma uma vez, só as linhas dele (id vem do token)', async () => {
    const { handler, chamadas } = carregarEndpoint();
    await chamarEndpoint(handler, { confirmar: true, user_id: 'OUTRA-PESSOA' });
    const dados = chamadas.filter(c => c.passo !== 'auth.deleteUser');
    assert.deepStrictEqual(dados.map(c => c.passo), handler.ORDEM_DE_EXCLUSAO);
    assert.strictEqual(new Set(dados.map(c => c.passo)).size, 10);
    assert.ok(dados.every(c => c.coluna === 'user_id' && c.valor === 'usuario-do-token'), 'cada exclusão filtra pelo usuário do token');
    assert.strictEqual(chamadas[chamadas.length - 1].id, 'usuario-do-token');
  });

  await ta('excluir conta: se uma etapa falha, para ali e NÃO apaga o usuário do Auth (dá pra tentar de novo)', async () => {
    const { handler, chamadas } = carregarEndpoint({ falharEm: 'contas' });
    const erroOriginal = console.error; console.error = () => {}; // o endpoint registra a falha no log; aqui é esperado
    let res;
    try { res = await chamarEndpoint(handler); } finally { console.error = erroOriginal; }
    assert.strictEqual(res.codigo, 500);
    assert.ok(!chamadas.some(c => c.passo === 'auth.deleteUser'), 'o usuário do Auth não pode ser apagado com dados pela metade');
    assert.ok(!chamadas.some(c => c.passo === 'orcamentos'), 'nada depois da etapa que falhou');
  });

  await ta('excluir conta: sem confirmação ou sem login, nada é apagado', async () => {
    const { handler, chamadas } = carregarEndpoint();
    assert.strictEqual((await chamarEndpoint(handler, {})).codigo, 400);
    const res = { status(c) { this.codigo = c; return this; }, json(o) { this.corpo = o; return this; }, setHeader() {}, end() { return this; } };
    await handler({ method: 'POST', headers: {}, body: { confirmar: true } }, res);
    assert.strictEqual(res.codigo, 401);
    assert.strictEqual(chamadas.length, 0);
  });
}

testesAssincronos().then(() => {
  /* ---------- Orçamento: categoria estourada e categoria sem planejado ---------- */

const moeda = (n) => 'R$ ' + n.toFixed(2).replace('.', ',');
const CATS = ['Moradia', 'Alimentação', 'Transporte', 'Lazer'];

t('categoria estourada: só entra quem tem planejado e passou dele, da que mais passou para a que menos', () => {
  const r = v.categoriasEstouradas(CATS, { Moradia: 1500, Alimentação: 300, Transporte: 100 }, { Moradia: 1650, Alimentação: 62, Transporte: 120, Lazer: 650 });
  assert.deepStrictEqual(r, [{ categoria: 'Moradia', passou: 150 }, { categoria: 'Transporte', passou: 20 }]);
  assert.deepStrictEqual(v.categoriasEstouradas(CATS, { Moradia: 1500 }, { Moradia: 1500 }), []); // gastou exatamente o planejado: não estourou
  assert.deepStrictEqual(v.categoriasEstouradas(CATS, {}, { Lazer: 650 }), []); // sem planejado nunca estoura
});

t('aviso de estouro: uma categoria, duas, e "e mais N" a partir da terceira', () => {
  assert.strictEqual(v.textoCategoriasEstouradas([], moeda), '');
  assert.strictEqual(v.textoCategoriasEstouradas([{ categoria: 'Moradia', passou: 150 }], moeda), 'Atenção: Moradia passou R$ 150,00 do planejado');
  assert.strictEqual(
    v.textoCategoriasEstouradas([{ categoria: 'Moradia', passou: 150 }, { categoria: 'Transporte', passou: 20 }], moeda),
    'Atenção: Moradia passou R$ 150,00 e Transporte passou R$ 20,00 do planejado');
  assert.strictEqual(
    v.textoCategoriasEstouradas([{ categoria: 'A', passou: 3 }, { categoria: 'B', passou: 2 }, { categoria: 'C', passou: 1 }, { categoria: 'D', passou: 1 }], moeda),
    'Atenção: A passou R$ 3,00 e B passou R$ 2,00 do planejado, e mais 2');
  // modo privacidade: quem formata esconde os números, o texto continua o mesmo
  assert.strictEqual(v.textoCategoriasEstouradas([{ categoria: 'Moradia', passou: 150 }], () => 'R$ •••••'), 'Atenção: Moradia passou R$ ••••• do planejado');
});

t('linha do orçamento: sem planejado (zero, vazio ou ausente) não tem barra; com planejado, nada muda', () => {
  for (const p of [0, undefined, null, NaN]) {
    const l = v.linhaDoOrcamento(650, p);
    assert.strictEqual(l.temBarra, false);
    assert.strictEqual(l.status, 'sem-plano');
  }
  assert.deepStrictEqual(v.linhaDoOrcamento(0, 0), { temBarra: false, pct: 0, status: 'sem-plano' });
  assert.deepStrictEqual(v.linhaDoOrcamento(62, 300), { temBarra: true, pct: (62 / 300) * 100, status: 'ok' });
  assert.strictEqual(v.linhaDoOrcamento(240, 300).status, 'warn'); // 80%
  assert.strictEqual(v.linhaDoOrcamento(300, 300).status, 'warn'); // 100% ainda não estourou
  assert.strictEqual(v.linhaDoOrcamento(300.01, 300).status, 'over');
});

console.log(`\n${ok} testes passaram.`);
}).catch((erro) => {
  console.error('\nFALHOU:', erro.message);
  process.exit(1);
});
