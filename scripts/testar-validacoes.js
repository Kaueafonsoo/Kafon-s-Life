/* Testes de js/validacoes.js. Rodar: node scripts/testar-validacoes.js */
const assert = require('assert');
const v = require('../js/validacoes.js');

let ok = 0;
function t(nome, fn) { fn(); ok++; console.log('  ok  ' + nome); }

t('link do desejo: só http:// e https://', () => {
  assert.strictEqual(v.ehLinkWeb('https://loja.com.br/produto?id=1'), true);
  assert.strictEqual(v.ehLinkWeb('http://exemplo.com'), true);
  assert.strictEqual(v.ehLinkWeb('  HTTPS://EXEMPLO.COM  '), true);
  assert.strictEqual(v.ehLinkWeb('javascript:alert(1)'), false);
  assert.strictEqual(v.ehLinkWeb('JavaScript:alert(1)'), false);
  assert.strictEqual(v.ehLinkWeb('data:text/html,<script>alert(1)</script>'), false);
  assert.strictEqual(v.ehLinkWeb('ftp://servidor.com/arquivo'), false);
  assert.strictEqual(v.ehLinkWeb('//exemplo.com'), false);
  assert.strictEqual(v.ehLinkWeb('www.loja.com'), false);
  assert.strictEqual(v.ehLinkWeb('https://'), false);
  assert.strictEqual(v.ehLinkWeb('https://loja.com e mais texto'), false);
  assert.strictEqual(v.ehLinkWeb(''), false);
  assert.strictEqual(v.ehLinkWeb(null), false);
});

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

console.log(`\n${ok} testes passaram.`);
