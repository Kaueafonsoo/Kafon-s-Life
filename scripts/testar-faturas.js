/* Testes das regras de fatura (js/faturas.js). Rodar: node scripts/testar-faturas.js */
const assert = require('assert');
const f = require('../js/faturas.js');

let ok = 0;
function t(nome, fn) { fn(); ok++; console.log('  ok  ' + nome); }

const fecha25vence5 = { diaFechamento: 25, diaVencimento: 5 };   // vence no mês seguinte ao fechamento
const fecha3vence10 = { diaFechamento: 3, diaVencimento: 10 };   // vence no mesmo mês do fechamento
const fecha31vence10 = { diaFechamento: 31, diaVencimento: 10 };

t('compra ANTES do fechamento entra na fatura que fecha neste mês (vence no mês seguinte)', () => {
  assert.strictEqual(f.faturaDaCompra('2026-11-20', fecha25vence5), '2026-12');
});
t('compra NO DIA do fechamento ainda entra na fatura que fecha', () => {
  assert.strictEqual(f.faturaDaCompra('2026-11-25', fecha25vence5), '2026-12');
});
t('compra DEPOIS do fechamento cai na fatura seguinte', () => {
  assert.strictEqual(f.faturaDaCompra('2026-11-26', fecha25vence5), '2027-01');
});
t('virada de ano: compra de 30/12 com fechamento 25 vence em fevereiro', () => {
  assert.strictEqual(f.faturaDaCompra('2026-12-30', fecha25vence5), '2027-02');
});
t('cartão que vence no mesmo mês do fechamento (fecha 3, vence 10)', () => {
  assert.strictEqual(f.faturaDaCompra('2026-11-02', fecha3vence10), '2026-11');
  assert.strictEqual(f.faturaDaCompra('2026-11-03', fecha3vence10), '2026-11');
  assert.strictEqual(f.faturaDaCompra('2026-11-04', fecha3vence10), '2026-12');
});
t('fechamento dia 31 em fevereiro: qualquer compra do mês entra na fatura que fecha no fim de fevereiro', () => {
  assert.strictEqual(f.faturaDaCompra('2027-02-28', fecha31vence10), '2027-03');
  assert.strictEqual(f.faturaDaCompra('2027-02-01', fecha31vence10), '2027-03');
});
t('vencimento e fechamento de uma fatura', () => {
  assert.strictEqual(f.vencimentoDaFatura('2026-12', fecha25vence5), '2026-12-05');
  assert.strictEqual(f.fechamentoDaFatura('2026-12', fecha25vence5), '2026-11-25');
  assert.strictEqual(f.vencimentoDaFatura('2026-11', fecha3vence10), '2026-11-10');
  assert.strictEqual(f.fechamentoDaFatura('2026-11', fecha3vence10), '2026-11-03');
});
t('dia 31 de vencimento em mês curto vale o último dia', () => {
  assert.strictEqual(f.vencimentoDaFatura('2027-02', { diaFechamento: 20, diaVencimento: 31 }), '2027-02-28');
  assert.strictEqual(f.fechamentoDaFatura('2027-03', fecha31vence10), '2027-02-28');
});
t('parcelas caem em faturas consecutivas, inclusive na virada do ano', () => {
  const base = f.faturaDaCompra('2026-11-20', fecha25vence5); // 2026-12
  const parcelas = [0, 1, 2, 3].map(i => f.somaMesesRef(base, i));
  assert.deepStrictEqual(parcelas, ['2026-12', '2027-01', '2027-02', '2027-03']);
});
t('somaMesesRef com números negativos e múltiplos anos', () => {
  assert.strictEqual(f.somaMesesRef('2027-01', -1), '2026-12');
  assert.strictEqual(f.somaMesesRef('2026-03', 25), '2028-04');
});
t('status: aberta, fechada, vencida e paga', () => {
  const ref = '2026-12'; // fecha 25/11, vence 05/12
  assert.strictEqual(f.statusDaFatura(ref, fecha25vence5, '2026-11-25', false), 'aberta');
  assert.strictEqual(f.statusDaFatura(ref, fecha25vence5, '2026-11-26', false), 'fechada');
  assert.strictEqual(f.statusDaFatura(ref, fecha25vence5, '2026-12-05', false), 'fechada');
  assert.strictEqual(f.statusDaFatura(ref, fecha25vence5, '2026-12-06', false), 'vencida');
  assert.strictEqual(f.statusDaFatura(ref, fecha25vence5, '2026-12-06', true), 'paga');
});
t('rótulo em português', () => {
  assert.strictEqual(f.rotuloDaFatura('2026-12'), 'dezembro de 2026');
  assert.strictEqual(f.rotuloDaFatura('2027-03'), 'março de 2027');
});

console.log(`\n${ok} testes passaram.`);
