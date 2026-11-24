/* Testes de js/vencimentos.js. Rodar: node scripts/testar-vencimentos.js */
const assert = require('assert');
const v = require('../js/vencimentos.js');

let ok = 0;
function t(nome, fn) { fn(); ok++; console.log('  ok  ' + nome); }

const cartao = { id: 'k1', nome: 'Nubank', melhorDiaCompra: 25, diaVencimento: 5 };
const conta = (id, descricao, data, valor, extra = {}) => ({ id, descricao, data, valor, tipo: 'despesa', status: 'pendente', cartaoId: null, faturaRef: null, ...extra });
const compra = (id, valor, faturaRef) => ({ id, descricao: 'compra ' + id, data: '2026-11-10', valor, tipo: 'despesa', status: 'pago', cartaoId: 'k1', faturaRef });

t('diasEntre e somaDiasIso, inclusive na virada de mês e de ano', () => {
  assert.strictEqual(v.diasEntre('2026-11-24', '2026-12-05'), 11);
  assert.strictEqual(v.diasEntre('2026-12-30', '2027-01-02'), 3);
  assert.strictEqual(v.diasEntre('2026-11-24', '2026-11-20'), -4);
  assert.strictEqual(v.somaDiasIso('2026-12-30', 3), '2027-01-02');
  assert.strictEqual(v.somaDiasIso('2027-03-01', -1), '2027-02-28');
});

t('próximo salário: neste mês se ainda não chegou, senão no mês seguinte', () => {
  assert.strictEqual(v.proximoPagamento('2026-11-24', 5), '2026-12-05');
  assert.strictEqual(v.proximoPagamento('2026-11-03', 5), '2026-11-05');
  assert.strictEqual(v.proximoPagamento('2026-11-05', 5), '2026-12-05'); // no dia do salário, vale o próximo
  assert.strictEqual(v.proximoPagamento('2026-12-20', 5), '2027-01-05');
  assert.strictEqual(v.proximoPagamento('2027-01-31', 31), '2027-02-28'); // dia 31 em mês curto
  assert.strictEqual(v.proximoPagamento('2026-11-24', null), null);
});

t('contasAPagar junta contas pendentes e faturas em aberto, e ignora o que já foi pago', () => {
  const lancamentos = [
    conta('a', 'Luz', '2026-11-25', 180),
    { ...conta('b', 'Aluguel', '2026-11-03', 900), status: 'pago' },
    compra('c1', 300, '2026-12'), compra('c2', 55.9, '2026-12'), compra('c3', 100, '2026-11'),
  ];
  const faturas = [{ cartaoId: 'k1', referencia: '2026-11' }]; // novembro já paga
  const itens = v.contasAPagar({ lancamentos, cartoes: [cartao], faturas });
  assert.deepStrictEqual(itens.map(i => [i.tipo, i.descricao, i.data, i.valor]), [
    ['conta', 'Luz', '2026-11-25', 180],
    ['fatura', 'Fatura Nubank', '2026-12-05', 355.9],
  ]);
});

t('compra no cartão nunca vira "conta pendente" (ela já está na fatura)', () => {
  const lancamentos = [{ ...compra('x', 50, '2026-12'), status: 'pendente' }];
  const itens = v.contasAPagar({ lancamentos, cartoes: [cartao], faturas: [] });
  assert.deepStrictEqual(itens.map(i => i.tipo), ['fatura']);
});

t('quanto posso gastar: saldo menos o que vence antes do salário, dividido pelos dias', () => {
  const itens = [
    { tipo: 'conta', descricao: 'Luz', data: '2026-11-25', valor: 180 },
    { tipo: 'conta', descricao: 'Internet', data: '2026-11-27', valor: 120 },
    { tipo: 'fatura', descricao: 'Fatura Nubank', data: '2026-12-05', valor: 355.9 }, // vence no dia do salário: não entra
    { tipo: 'conta', descricao: 'Plano', data: '2026-12-10', valor: 400 },            // depois do salário: não entra
  ];
  const r = v.quantoPossoGastar({ hoje: '2026-11-24', diaPagamento: 5, saldo: 1500, itens, mediaDiaria: 40 });
  assert.strictEqual(r.dias, 11);
  assert.strictEqual(r.aPagar, 300);
  assert.strictEqual(r.disponivel, 1200);
  assert.strictEqual(r.porDia, 109.09);
  assert.strictEqual(r.status, 'verde');
  assert.strictEqual(r.considerados.length, 2);
});

t('fatura que vence ANTES do salário entra na conta', () => {
  const itens = [{ tipo: 'fatura', descricao: 'Fatura C6', data: '2026-12-04', valor: 500 }];
  const r = v.quantoPossoGastar({ hoje: '2026-11-24', diaPagamento: 5, saldo: 1500, itens });
  assert.strictEqual(r.aPagar, 500);
});

t('semáforo: verde, amarelo e vermelho', () => {
  const base = { hoje: '2026-11-24', diaPagamento: 5, itens: [] };
  // 11 dias; ritmo normal de R$ 80 por dia
  assert.strictEqual(v.quantoPossoGastar({ ...base, saldo: 1100, mediaDiaria: 80 }).status, 'verde');   // 100/dia
  assert.strictEqual(v.quantoPossoGastar({ ...base, saldo: 660, mediaDiaria: 80 }).status, 'amarelo');  // 60/dia, abaixo do ritmo
  assert.strictEqual(v.quantoPossoGastar({ ...base, saldo: 0, mediaDiaria: 80 }).status, 'vermelho');
  assert.strictEqual(v.quantoPossoGastar({ ...base, saldo: 100, itens: [{ data: '2026-11-30', valor: 300, descricao: 'x', tipo: 'conta' }], mediaDiaria: 80 }).status, 'vermelho'); // contas > saldo
  assert.strictEqual(v.quantoPossoGastar({ ...base, saldo: 50, mediaDiaria: 0 }).status, 'verde');      // sem histórico: verde se sobra algo
});

t('conta atrasada ainda pesa; muito antiga (mais de 60 dias) é ignorada', () => {
  const itens = [
    { tipo: 'conta', descricao: 'Condomínio', data: '2026-11-22', valor: 450 },
    { tipo: 'conta', descricao: 'Esquecida', data: '2026-06-01', valor: 999 },
  ];
  const r = v.quantoPossoGastar({ hoje: '2026-11-24', diaPagamento: 5, saldo: 1000, itens });
  assert.strictEqual(r.aPagar, 450);
});

t('salário amanhã: o período é de 1 dia', () => {
  const r = v.quantoPossoGastar({ hoje: '2026-12-04', diaPagamento: 5, saldo: 300, itens: [] });
  assert.strictEqual(r.dias, 1);
  assert.strictEqual(r.porDia, 300);
});

t('sem dia de salário: o horizonte é o fim do mês', () => {
  const r = v.quantoPossoGastar({ hoje: '2026-11-24', diaPagamento: null, saldo: 600, itens: [] });
  assert.strictEqual(r.temSalario, false);
  assert.strictEqual(r.limite, '2026-12-01');
  assert.strictEqual(r.dias, 7);
  assert.strictEqual(v.inicioDoProximoMes('2026-12-15'), '2027-01-01');
});

t('média diária ignora contas grandes e raras', () => {
  const g = (data, valor) => ({ tipo: 'despesa', data, valor });
  const lancs = [g('2026-11-20', 40), g('2026-11-18', 35), g('2026-11-15', 50), g('2026-11-12', 45), g('2026-11-03', 900) /* aluguel */, { tipo: 'receita', data: '2026-11-01', valor: 5000 }];
  const media = v.mediaDiariaDeGastos(lancs, '2026-11-24', 30);
  assert.strictEqual(media, 5.67); // (40+35+50+45)/30, sem o aluguel nem a receita
  assert.strictEqual(v.mediaDiariaDeGastos([], '2026-11-24'), 0);
});

t('vencimentosProximos: atrasados, hoje e até 3 dias', () => {
  const itens = [
    { descricao: 'A', data: '2026-11-22', valor: 1 }, { descricao: 'B', data: '2026-11-24', valor: 1 }, { descricao: 'C', data: '2026-11-27', valor: 1 },
    { descricao: 'D', data: '2026-11-28', valor: 1 }, { descricao: 'E', data: '2026-09-01', valor: 1 },
  ];
  assert.deepStrictEqual(v.vencimentosProximos(itens, '2026-11-24', 3).map(i => [i.descricao, i.faltam]), [['A', -2], ['B', 0], ['C', 3]]);
});

t('avisos 3 dias e 1 dia antes: só os marcos exatos, para não repetir todo dia', () => {
  const itens = [
    { descricao: 'Atrasada', data: '2026-11-20' }, { descricao: 'Hoje', data: '2026-11-24' },
    { descricao: 'Amanhã', data: '2026-11-25' }, { descricao: 'Em 2 dias', data: '2026-11-26' },
    { descricao: 'Em 3 dias', data: '2026-11-27' }, { descricao: 'Em 4 dias', data: '2026-11-28' },
  ];
  const a = v.avisosDeVencimento(itens, '2026-11-24');
  assert.deepStrictEqual(a.atrasadas.map(i => i.descricao), ['Atrasada']);
  assert.deepStrictEqual(a.hoje.map(i => i.descricao), ['Hoje']);
  assert.deepStrictEqual(a.antes[1].map(i => i.descricao), ['Amanhã']);
  assert.deepStrictEqual(a.antes[3].map(i => i.descricao), ['Em 3 dias']);
  // o dia seguinte: o que era "em 3 dias" agora é "em 2" e não avisa de novo; o que era "em 2" vira "amanhã"
  const b = v.avisosDeVencimento(itens, '2026-11-25');
  assert.deepStrictEqual(b.antes[1].map(i => i.descricao), ['Em 2 dias']);
  assert.deepStrictEqual(b.antes[3].map(i => i.descricao), ['Em 4 dias']);
});

console.log(`\n${ok} testes passaram.`);
