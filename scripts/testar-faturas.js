/* Testes das regras de fatura (js/faturas.js). Rodar: node scripts/testar-faturas.js
   O cartão é descrito pelo "melhor dia de compra" (compras a partir dele vão para a fatura seguinte) e pelo vencimento. */
const assert = require('assert');
const f = require('../js/faturas.js');

let ok = 0;
function t(nome, fn) { fn(); ok++; console.log('  ok  ' + nome); }

// Nubank: fecha dia 25 e compras A PARTIR do fechamento já vão para a seguinte -> melhor dia = 25.
const nubank = { melhorDiaCompra: 25, diaVencimento: 5 };
// Inter: fecha dia 25 e o melhor dia de compra é o dia seguinte -> 26. Compra no dia 25 ainda entra na fatura que fecha.
const inter = { melhorDiaCompra: 26, diaVencimento: 5 };
// Fecha dia 3 e vence dia 10 do mesmo mês -> melhor dia 4.
const venceNoMesmoMes = { melhorDiaCompra: 4, diaVencimento: 10 };
// Melhor dia 1: a fatura fecha no último dia do mês.
const fechaNoFimDoMes = { melhorDiaCompra: 1, diaVencimento: 10 };

t('antes do melhor dia: entra na fatura que fecha agora', () => {
  assert.strictEqual(f.faturaDaCompra('2026-11-20', nubank), '2026-12');
  assert.strictEqual(f.faturaDaCompra('2026-11-24', nubank), '2026-12');
});
t('NO melhor dia: vai para a fatura seguinte (regra do Nubank)', () => {
  assert.strictEqual(f.faturaDaCompra('2026-11-25', nubank), '2027-01');
  assert.strictEqual(f.faturaDaCompra('2026-11-26', nubank), '2027-01');
});
t('estilo Inter: compra no dia 25 ainda entra na fatura que fecha; no 26 (melhor dia) vai para a seguinte', () => {
  assert.strictEqual(f.faturaDaCompra('2026-11-25', inter), '2026-12');
  assert.strictEqual(f.faturaDaCompra('2026-11-26', inter), '2027-01');
});
t('virada de ano', () => {
  assert.strictEqual(f.faturaDaCompra('2026-12-20', nubank), '2027-01');
  assert.strictEqual(f.faturaDaCompra('2026-12-30', nubank), '2027-02');
});
t('cartão que vence no mesmo mês do fechamento (fecha 3, vence 10)', () => {
  assert.strictEqual(f.faturaDaCompra('2026-11-02', venceNoMesmoMes), '2026-11');
  assert.strictEqual(f.faturaDaCompra('2026-11-03', venceNoMesmoMes), '2026-11');
  assert.strictEqual(f.faturaDaCompra('2026-11-04', venceNoMesmoMes), '2026-12');
});
t('melhor dia 1: a fatura fecha no último dia do mês e a compra de qualquer dia entra nela', () => {
  assert.strictEqual(f.faturaDaCompra('2026-11-01', fechaNoFimDoMes), '2026-12');
  assert.strictEqual(f.faturaDaCompra('2026-11-30', fechaNoFimDoMes), '2026-12');
  assert.strictEqual(f.faturaDaCompra('2027-02-28', fechaNoFimDoMes), '2027-03');
  assert.strictEqual(f.fechamentoDaFatura('2026-12', fechaNoFimDoMes), '2026-11-30');
  assert.strictEqual(f.fechamentoDaFatura('2027-03', fechaNoFimDoMes), '2027-02-28');
});
t('dia em que a fatura fecha = dia antes do melhor dia', () => {
  assert.strictEqual(f.diaDeFechamento(nubank), 24);
  assert.strictEqual(f.diaDeFechamento(inter), 25);
  assert.strictEqual(f.diaDeFechamento(venceNoMesmoMes), 3);
  assert.strictEqual(f.diaDeFechamento(fechaNoFimDoMes), 31);
});
t('vencimento e fechamento de uma fatura', () => {
  assert.strictEqual(f.vencimentoDaFatura('2026-12', inter), '2026-12-05');
  assert.strictEqual(f.fechamentoDaFatura('2026-12', inter), '2026-11-25');
  assert.strictEqual(f.fechamentoDaFatura('2026-12', nubank), '2026-11-24');
  assert.strictEqual(f.vencimentoDaFatura('2026-11', venceNoMesmoMes), '2026-11-10');
  assert.strictEqual(f.fechamentoDaFatura('2026-11', venceNoMesmoMes), '2026-11-03');
});
t('dia 31 de vencimento em mês curto vale o último dia', () => {
  assert.strictEqual(f.vencimentoDaFatura('2027-02', { melhorDiaCompra: 21, diaVencimento: 31 }), '2027-02-28');
});
t('a compra feita no dia seguinte ao fechamento sempre cai numa fatura que ainda não fechou', () => {
  for (const cartao of [nubank, inter, venceNoMesmoMes, fechaNoFimDoMes]) {
    for (const dia of ['2026-01-15', '2026-02-28', '2026-06-30', '2026-12-31', '2027-03-01']) {
      const ref = f.faturaDaCompra(dia, cartao);
      assert.ok(f.fechamentoDaFatura(ref, cartao) >= dia, `${dia} caiu numa fatura que já tinha fechado (${ref})`);
      assert.ok(f.vencimentoDaFatura(ref, cartao) > f.fechamentoDaFatura(ref, cartao), 'vencimento antes do fechamento');
    }
  }
});
t('parcelas caem em faturas consecutivas, inclusive na virada do ano', () => {
  const base = f.faturaDaCompra('2026-11-20', nubank); // 2026-12
  const parcelas = [0, 1, 2, 3].map(i => f.somaMesesRef(base, i));
  assert.deepStrictEqual(parcelas, ['2026-12', '2027-01', '2027-02', '2027-03']);
});
t('somaMesesRef com números negativos e múltiplos anos', () => {
  assert.strictEqual(f.somaMesesRef('2027-01', -1), '2026-12');
  assert.strictEqual(f.somaMesesRef('2026-03', 25), '2028-04');
});
t('status: aberta, fechada, vencida e paga', () => {
  const ref = '2026-12'; // inter: fecha 25/11, vence 05/12
  assert.strictEqual(f.statusDaFatura(ref, inter, '2026-11-25', false), 'aberta');
  assert.strictEqual(f.statusDaFatura(ref, inter, '2026-11-26', false), 'fechada');
  assert.strictEqual(f.statusDaFatura(ref, inter, '2026-12-05', false), 'fechada');
  assert.strictEqual(f.statusDaFatura(ref, inter, '2026-12-06', false), 'vencida');
  assert.strictEqual(f.statusDaFatura(ref, inter, '2026-12-06', true), 'paga');
});
t('rótulo em português', () => {
  assert.strictEqual(f.rotuloDaFatura('2026-12'), 'dezembro de 2026');
  assert.strictEqual(f.rotuloDaFatura('2027-03'), 'março de 2027');
});

console.log(`\n${ok} testes passaram.`);
