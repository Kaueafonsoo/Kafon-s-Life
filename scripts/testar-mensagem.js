/* Testes do lembrete diário (api/_mensagem.js + api/_dados.js). Rodar: node scripts/testar-mensagem.js */
const assert = require('assert');
const { montarMensagem } = require('../api/_mensagem');
const { itensAPagar, avisosDeVencimento } = require('../api/_dados');

let ok = 0;
function t(nome, fn) { fn(); ok++; console.log('  ok  ' + nome); }

const HOJE = '2026-11-24';
// linhas como vêm do banco (snake_case)
const lancamentos = [
  { id: 'a', descricao: 'Condomínio', data: '2026-11-20', valor: '450.00', tipo: 'despesa', status: 'pendente', cartao_id: null, fatura_ref: null },
  { id: 'b', descricao: 'Luz', data: '2026-11-25', valor: '180.00', tipo: 'despesa', status: 'pendente', cartao_id: null, fatura_ref: null },
  { id: 'c', descricao: 'Internet', data: '2026-11-27', valor: '120.00', tipo: 'despesa', status: 'pendente', cartao_id: null, fatura_ref: null },
  { id: 'd', descricao: 'Plano', data: '2026-11-28', valor: '400.00', tipo: 'despesa', status: 'pendente', cartao_id: null, fatura_ref: null },
  { id: 'e', descricao: 'Netflix', data: '2026-11-02', valor: '55.90', tipo: 'despesa', status: 'pago', cartao_id: 'k1', fatura_ref: '2026-12' },
  { id: 'f', descricao: 'Tênis', data: '2026-10-28', valor: '300.00', tipo: 'despesa', status: 'pago', cartao_id: 'k1', fatura_ref: '2026-12' },
];
const cartoes = [{ id: 'k1', nome: 'Nubank', melhor_dia_compra: 25, dia_vencimento: 27 }]; // fatura vence dia 27: em 3 dias
const faturas = [];

t('itensAPagar junta contas pendentes e a fatura do cartão a partir das linhas do banco', () => {
  const itens = itensAPagar({ lancamentos, cartoes, faturas });
  assert.deepStrictEqual(itens.map(i => [i.descricao, i.data, i.valor]), [
    ['Condomínio', '2026-11-20', 450], ['Luz', '2026-11-25', 180], ['Internet', '2026-11-27', 120],
    ['Fatura Nubank', '2026-12-27', 355.9], ['Plano', '2026-11-28', 400],
  ].sort((a, b) => a[1].localeCompare(b[1])));
});

t('a fatura do cartão avisa 3 dias e 1 dia antes de vencer', () => {
  // fatura de 2026-11 vencendo dia 27: usa compras com fatura_ref 2026-11
  const lan = [{ id: 'x', descricao: 'Mercado', data: '2026-10-10', valor: '420.50', tipo: 'despesa', status: 'pago', cartao_id: 'k1', fatura_ref: '2026-11' }];
  const itens = itensAPagar({ lancamentos: lan, cartoes, faturas });
  assert.strictEqual(itens[0].data, '2026-11-27');
  const em3 = avisosDeVencimento(itens, '2026-11-24');
  assert.deepStrictEqual(em3.antes[3].map(i => i.descricao), ['Fatura Nubank']);
  const em1 = avisosDeVencimento(itens, '2026-11-26');
  assert.deepStrictEqual(em1.antes[1].map(i => i.descricao), ['Fatura Nubank']);
  const jaPaga = itensAPagar({ lancamentos: lan, cartoes, faturas: [{ cartao_id: 'k1', referencia: '2026-11' }] });
  assert.strictEqual(jaPaga.length, 0); // paga: não avisa
});

t('mensagem: atrasada, vence amanhã, vence em 3 dias (e a fatura aparece junto)', () => {
  const lan = [...lancamentos.slice(0, 3), { id: 'x', descricao: 'Mercado', data: '2026-10-10', valor: '420.50', tipo: 'despesa', status: 'pago', cartao_id: 'k1', fatura_ref: '2026-11' }];
  const itens = itensAPagar({ lancamentos: lan, cartoes, faturas });
  const avisos = avisosDeVencimento(itens, HOJE);
  const m = montarMensagem({ hoje: HOJE, privacidade: false, lancouHoje: true, avisos, orcamento: [] });
  // itens com o mesmo vencimento saem em ordem alfabética
  assert.strictEqual(m.body, 'Contas em atraso: Condomínio · vence amanhã: Luz · vencem em 3 dias: Fatura Nubank, Internet');
});

t('mensagem no singular e no plural', () => {
  const um = montarMensagem({ hoje: HOJE, privacidade: false, lancouHoje: true, avisos: { atrasadas: [], hoje: [], antes: { 1: [{ descricao: 'Luz' }], 3: [] } }, orcamento: [] });
  assert.strictEqual(um.body, 'Contas vence amanhã: Luz');
  const dois = montarMensagem({ hoje: HOJE, privacidade: false, lancouHoje: true, avisos: { atrasadas: [], hoje: [], antes: { 1: [{ descricao: 'Luz' }, { descricao: 'Água' }], 3: [] } }, orcamento: [] });
  assert.strictEqual(dois.body, 'Contas vencem amanhã: Luz, Água');
});

t('muitos itens: mostra dois nomes e "e mais N"', () => {
  const m = montarMensagem({ hoje: HOJE, privacidade: false, lancouHoje: true, avisos: { atrasadas: [], hoje: [], antes: { 1: [], 3: ['A', 'B', 'C', 'D'].map(d => ({ descricao: d })) } }, orcamento: [] });
  assert.strictEqual(m.body, 'Contas vencem em 3 dias: A, B e mais 2');
});

t('sem nada pra avisar e com o dia lançado: não manda notificação', () => {
  assert.strictEqual(montarMensagem({ hoje: HOJE, privacidade: false, lancouHoje: true, avisos: { atrasadas: [], hoje: [], antes: { 1: [], 3: [] } }, orcamento: [] }), null);
  assert.strictEqual(montarMensagem({ hoje: HOJE, privacidade: false, lancouHoje: true, avisos: undefined, orcamento: [] }), null);
});

t('modo privacidade: a tela bloqueada não mostra nomes de contas nem de faturas', () => {
  const m = montarMensagem({ hoje: HOJE, privacidade: true, lancouHoje: true, avisos: { atrasadas: [], hoje: [], antes: { 1: [{ descricao: 'Fatura Nubank' }], 3: [] } }, orcamento: [] });
  assert.ok(!/Nubank/.test(m.body));
  assert.ok(/avisos de contas/.test(m.body));
});

t('conta que vence em 2 dias não avisa (só os marcos de 3 e 1 dia, e o dia)', () => {
  const avisos = avisosDeVencimento([{ descricao: 'X', data: '2026-11-26' }], HOJE);
  assert.strictEqual(montarMensagem({ hoje: HOJE, privacidade: false, lancouHoje: true, avisos, orcamento: [] }), null);
});

const { planejarLembretes } = require('../api/_planejar');

// objetos no formato da tela (camelCase), como o app nativo os tem em memória
const tela = {
  lancamentos: [
    { id: 'a', descricao: 'Luz', data: '2026-11-27', valor: 180, tipo: 'despesa', status: 'pendente', categoria: 'Moradia', cartaoId: null, faturaRef: null },
    { id: 'm', descricao: 'Mercado', data: '2026-10-10', valor: 420.5, tipo: 'despesa', status: 'pago', categoria: 'Alimentação', cartaoId: 'k1', faturaRef: '2026-11' },
  ],
  cartoes: [{ id: 'k1', nome: 'Nubank', melhorDiaCompra: 1, diaVencimento: 28 }],
  faturas: [], orcamentos: {}, privacidade: false,
};
const dataLocal = (a, m, d, h = 12) => new Date(a, m - 1, d, h, 0, 0);

t('app nativo: agenda a noite de cada marco (3 dias e 1 dia antes), da conta e da fatura', () => {
  // hoje 24/11 às 12h: a próxima 21h é hoje
  const plano = planejarLembretes({ agora: dataLocal(2026, 11, 24), dias: 7, lancamentos: tela.lancamentos, cartoes: tela.cartoes, faturas: tela.faturas, orcamentos: {}, privacidade: false });
  const porDia = Object.fromEntries(plano.map(p => [p.quando.getDate(), p.body]));
  assert.ok(/vence em 3 dias: Luz/.test(porDia[24]), 'luz vence dia 27: avisa dia 24 (3 dias antes)');
  assert.ok(/vence amanhã: Fatura Nubank/.test(porDia[27]) || /Fatura Nubank/.test(porDia[27]), 'fatura vence dia 28: avisa dia 27 (1 dia antes)');
  assert.ok(/vence hoje: Luz/.test(porDia[27]), 'e a luz vence no dia 27');
  assert.ok(/vence em 3 dias: Fatura Nubank/.test(porDia[25]), 'fatura vence dia 28: avisa dia 25 (3 dias antes)');
  assert.ok(/vence amanhã: Luz/.test(porDia[26]), 'luz: avisa dia 26 (1 dia antes)');
  assert.strictEqual(plano[0].quando.getHours(), 21);
});

t('app nativo: depois das 21h, a primeira notificação é a de amanhã', () => {
  const plano = planejarLembretes({ agora: dataLocal(2026, 11, 24, 22), dias: 3, lancamentos: tela.lancamentos, cartoes: tela.cartoes, faturas: tela.faturas, orcamentos: {}, privacidade: false });
  assert.strictEqual(plano[0].quando.getDate(), 25);
});

t('app nativo: o que já foi pago não gera aviso', () => {
  const lan = [{ ...tela.lancamentos[0], status: 'pago' }, tela.lancamentos[1]];
  const plano = planejarLembretes({ agora: dataLocal(2026, 11, 24), dias: 7, lancamentos: lan, cartoes: tela.cartoes, faturas: [{ cartaoId: 'k1', referencia: '2026-11' }], orcamentos: {}, privacidade: false });
  assert.ok(plano.every(p => !/Luz|Nubank/.test(p.body)));
});

console.log(`\n${ok} testes passaram.`);
