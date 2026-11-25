/* Testes de js/importar.js. Rodar: node scripts/testar-importar.js */
const assert = require('assert');
const im = require('../js/importar.js');

let ok = 0;
function t(nome, fn) { fn(); ok++; console.log('  ok  ' + nome); }

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261105120000[-3:BRT]
<TRNAMT>-45,90
<FITID>20261105001
<MEMO>COMPRA DEBITO SUPERMERCADO EXTRA 1234
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261101
<TRNAMT>5000.00
<FITID>20261101002
<MEMO>PAGAMENTO DE SALARIO
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261110
<TRNAMT>89.90
<FITID>20261110003
<NAME>NETFLIX &amp; CIA
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const NUBANK_CONTA = `Data,Valor,Identificador,Descrição
01/11/2026,5000.00,aaa-111,Transferência Recebida - EMPRESA XYZ LTDA
05/11/2026,-45.90,bbb-222,Compra no débito - SUPERMERCADO EXTRA
06/11/2026,-12.00,ccc-333,Pix enviado - Padaria do Zé
`;

const NUBANK_CARTAO = `date,category,title,amount
2026-11-03,restaurante,Ifood *Pizzaria,62.50
2026-11-04,serviços,Netflix.Com,55.90
2026-11-20,,Pagamento recebido,-500.00
`;

const INTER = `Extrato Conta Corrente
Conta;12345678
Período;01/11/2026 a 30/11/2026

Data Lançamento;Histórico;Descrição;Valor;Saldo
05/11/2026;Compra no débito;"UBER *TRIP, SAO PAULO";-23,40;1.500,00
06/11/2026;Pix recebido;JOAO SILVA;1.250,00;2.750,00
`;

const DEBITO_CREDITO = `Data;Descrição;Débito;Crédito
02/11/2026;ALUGUEL;900,00;
03/11/2026;SALARIO;;5.000,00
Total;;900,00;5.000,00
`;

t('lerValor: formatos brasileiros e americanos', () => {
  assert.strictEqual(im.lerValor('1.234,56'), 1234.56);
  assert.strictEqual(im.lerValor('-45,90'), -45.9);
  assert.strictEqual(im.lerValor('R$ 12.50'), 12.5);
  assert.strictEqual(im.lerValor('1,234.56'), 1234.56);
  assert.strictEqual(im.lerValor('(45,90)'), -45.9);
  assert.strictEqual(im.lerValor('45,90-'), -45.9);
  assert.strictEqual(im.lerValor('1.234'), 1234);
  assert.strictEqual(im.lerValor('12.5'), 12.5);
  assert.strictEqual(im.lerValor('texto'), null);
  assert.strictEqual(im.lerValor(''), null);
});

t('lerData: dd/mm/aaaa, ISO, aaaammdd e datas impossíveis', () => {
  assert.strictEqual(im.lerData('05/11/2026'), '2026-11-05');
  assert.strictEqual(im.lerData('05/11/26'), '2026-11-05');
  assert.strictEqual(im.lerData('2026-11-05'), '2026-11-05');
  assert.strictEqual(im.lerData('20261105120000[-3:BRT]'), '2026-11-05');
  assert.strictEqual(im.lerData('31/02/2026'), null);
  assert.strictEqual(im.lerData('Total'), null);
});

t('OFX (SGML, sem tags de fechamento): data, valor com sinal, FITID e descrição', () => {
  const r = im.lerExtrato(OFX_SGML);
  assert.strictEqual(r.formato, 'ofx');
  assert.strictEqual(r.linhas.length, 3);
  assert.deepStrictEqual(r.linhas[0], { data: '2026-11-05', descricao: 'COMPRA DEBITO SUPERMERCADO EXTRA 1234', valor: -45.9, idExterno: '20261105001' });
  assert.strictEqual(r.linhas[1].valor, 5000);
  assert.strictEqual(r.linhas[1].descricao, 'PAGAMENTO DE SALARIO');
});

t('OFX: valor sem sinal com TRNTYPE de saída vira despesa; entidades XML são decodificadas', () => {
  const l = im.lerExtrato(OFX_SGML).linhas[2];
  assert.strictEqual(l.valor, -89.9);
  assert.strictEqual(l.descricao, 'NETFLIX & CIA');
});

t('CSV Nubank (conta): vírgula, cabeçalho com acento e identificador', () => {
  const r = im.lerExtrato(NUBANK_CONTA);
  assert.strictEqual(r.formato, 'csv');
  assert.strictEqual(r.linhas.length, 3);
  assert.deepStrictEqual(r.linhas[1], { data: '2026-11-05', descricao: 'Compra no débito - SUPERMERCADO EXTRA', valor: -45.9, idExterno: 'bbb-222' });
  assert.strictEqual(r.linhas[0].valor, 5000);
});

t('CSV Nubank (cartão): compras vêm positivas; positivoEhSaida inverte', () => {
  const r = im.lerExtrato(NUBANK_CARTAO, { positivoEhSaida: true });
  assert.strictEqual(r.linhas.length, 3);
  assert.strictEqual(r.linhas[0].valor, -62.5);
  assert.strictEqual(r.linhas[0].data, '2026-11-03');
  assert.strictEqual(r.linhas[2].valor, 500); // pagamento recebido vira entrada
});

t('CSV Inter: ponto e vírgula, linhas de apresentação antes do cabeçalho, campo entre aspas com vírgula', () => {
  const r = im.lerExtrato(INTER);
  assert.strictEqual(r.linhas.length, 2);
  assert.strictEqual(r.linhas[0].descricao, 'UBER *TRIP, SAO PAULO');
  assert.strictEqual(r.linhas[0].valor, -23.4);
  assert.strictEqual(r.linhas[1].valor, 1250);
});

t('CSV com colunas separadas de débito e crédito; a linha de total é ignorada', () => {
  const r = im.lerExtrato(DEBITO_CREDITO);
  assert.deepStrictEqual(r.linhas.map(l => [l.descricao, l.valor]), [['ALUGUEL', -900], ['SALARIO', 5000]]);
  assert.ok(r.avisos.length === 1);
});

t('CSV com cabeçalho desconhecido pede para o usuário mapear as colunas, e o mapa funciona', () => {
  const texto = 'Quando;Oque;Quanto\n05/11/2026;Padaria;-10,00\n';
  const r = im.lerExtrato(texto);
  assert.ok(r.precisaMapear);
  assert.deepStrictEqual(r.precisaMapear.cabecalho, ['Quando', 'Oque', 'Quanto']);
  const r2 = im.lerExtrato(texto, { mapa: { data: 0, descricao: 1, valor: 2, debito: -1, credito: -1, id: -1 }, linhaCabecalho: 0 });
  assert.deepStrictEqual(r2.linhas, [{ data: '2026-11-05', descricao: 'Padaria', valor: -10, idExterno: null }]);
});

t('BOM no começo do arquivo e quebras de linha do Windows não atrapalham', () => {
  const r = im.lerExtrato('﻿' + NUBANK_CONTA.replace(/\n/g, '\r\n'));
  assert.strictEqual(r.linhas.length, 3);
});

t('import_id: estável entre leituras e diferente por destino', () => {
  const a = im.atribuirImportIds(im.lerExtrato(OFX_SGML).linhas, 'c:conta1');
  const b = im.atribuirImportIds(im.lerExtrato(OFX_SGML).linhas, 'c:conta1');
  const c = im.atribuirImportIds(im.lerExtrato(OFX_SGML).linhas, 'c:conta2');
  assert.deepStrictEqual(a.map(l => l.importId), b.map(l => l.importId));
  assert.notStrictEqual(a[0].importId, c[0].importId);
  assert.strictEqual(a[0].importId, 'c:conta1:20261105001');
});

t('duas linhas idênticas no mesmo arquivo (dois cafés) continuam distintas, e o mesmo arquivo gera os mesmos ids', () => {
  const linhas = [
    { data: '2026-11-05', descricao: 'Padaria', valor: -6, idExterno: null },
    { data: '2026-11-05', descricao: 'Padaria', valor: -6, idExterno: null },
  ];
  const a = im.atribuirImportIds(linhas, 'c:x');
  assert.notStrictEqual(a[0].importId, a[1].importId);
  assert.deepStrictEqual(im.atribuirImportIds(linhas, 'c:x').map(l => l.importId), a.map(l => l.importId));
});

t('classificar: já importado, semelhante a um lançamento manual, pagamento de fatura e novo', () => {
  const linhas = im.atribuirImportIds([
    { data: '2026-11-05', descricao: 'COMPRA SUPERMERCADO EXTRA', valor: -45.9, idExterno: 'F1' },
    { data: '2026-11-06', descricao: 'Padaria', valor: -12, idExterno: 'F2' },
    { data: '2026-11-07', descricao: 'PAGAMENTO DE FATURA NUBANK', valor: -835.9, idExterno: 'F3' },
    { data: '2026-11-08', descricao: 'Livraria', valor: -80, idExterno: 'F4' },
  ], 'c:c1');
  const existentes = [
    { importId: 'c:c1:F1', data: '2026-11-05', valor: 45.9, tipo: 'despesa', contaId: 'c1', cartaoId: null },   // mesma linha importada antes
    { importId: null, data: '2026-11-07', valor: 12, tipo: 'despesa', contaId: 'c1', cartaoId: null },          // lançada à mão, 1 dia depois
    { importId: null, data: '2026-11-08', valor: 80, tipo: 'despesa', contaId: 'c2', cartaoId: null },          // mesma coisa, mas em OUTRA conta
  ];
  const r = im.classificarLinhas(linhas, existentes, { contaId: 'c1', cartaoId: null });
  assert.deepStrictEqual(r.map(l => l.situacao), ['importado', 'semelhante', 'fatura', 'novo']);
});

t('semelhante casa cada lançamento manual uma vez só (dois cafés iguais, um só lançado à mão)', () => {
  const linhas = im.atribuirImportIds([
    { data: '2026-11-05', descricao: 'Padaria', valor: -6, idExterno: null },
    { data: '2026-11-05', descricao: 'Padaria', valor: -6, idExterno: null },
  ], 'c:c1');
  const existentes = [{ importId: null, data: '2026-11-05', valor: 6, tipo: 'despesa', contaId: 'c1', cartaoId: null }];
  const r = im.classificarLinhas(linhas, existentes, { contaId: 'c1', cartaoId: null });
  assert.deepStrictEqual(r.map(l => l.situacao), ['semelhante', 'novo']);
});

const CATEGORIAS = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Assinaturas', 'Outros'];

t('categoria por palavra-chave, mapeada para os nomes das categorias do usuário', () => {
  const c = (d, tipo = 'despesa') => im.sugerirCategoria(d, tipo, [], CATEGORIAS).categoria;
  assert.strictEqual(c('UBER *TRIP SAO PAULO'), 'Transporte');
  assert.strictEqual(c('Compra no débito - SUPERMERCADO EXTRA'), 'Alimentação');
  assert.strictEqual(c('Netflix.Com'), 'Assinaturas');
  assert.strictEqual(c('DROGASIL 1234'), 'Saúde');
  assert.strictEqual(c('Pagamento de aluguel'), 'Moradia');
  assert.strictEqual(c('Escola de inglês'), 'Educação');
  assert.strictEqual(c('PAGAMENTO DE SALARIO', 'receita'), 'Outros');
  assert.strictEqual(c('Coisa que ninguém conhece'), 'Outros');
});

t('palavras curtas não casam dentro de outras ("pagamento" não é "game", "alfabeto" não é "bet")', () => {
  const c = (d) => im.sugerirCategoria(d, 'despesa', [], CATEGORIAS).categoria;
  assert.strictEqual(c('Pagamento de boleto'), 'Outros');
  assert.strictEqual(c('Alfabeto escola'), 'Educação');
  assert.strictEqual(c('Praia grande'), 'Outros'); // "raia" dentro de "praia"
});

t('categoria: o que você já lançou parecido ganha das palavras-chave', () => {
  const historico = [
    { descricao: 'Padaria do Zé', categoria: 'Lazer', tipo: 'despesa' },
    { descricao: 'Padaria do Zé', categoria: 'Lazer', tipo: 'despesa' },
    { descricao: 'Mercado Extra', categoria: 'Alimentação', tipo: 'despesa' },
  ];
  const r = im.sugerirCategoria('Pix enviado - Padaria do Zé', 'despesa', historico, CATEGORIAS);
  assert.deepStrictEqual(r, { categoria: 'Lazer', origem: 'historico' });
  // categoria que não existe mais na lista do usuário não é sugerida
  const r2 = im.sugerirCategoria('Padaria do Zé', 'despesa', [{ descricao: 'Padaria do Zé', categoria: 'Apagada', tipo: 'despesa' }], CATEGORIAS);
  assert.notStrictEqual(r2.categoria, 'Apagada');
});

t('categoria: se o usuário não tem "Outros", cai na primeira da lista', () => {
  assert.strictEqual(im.sugerirCategoria('Coisa estranha', 'despesa', [], ['Casa', 'Carro']).categoria, 'Casa');
});

t('categoria de receita importada: "Outros"; sem "Outros" na lista, a última (nunca a primeira, que costuma ser de gasto)', () => {
  const r = (d, cats) => im.sugerirCategoria(d, 'receita', [], cats).categoria;
  assert.strictEqual(r('PIX RECEBIDO FULANO', CATEGORIAS), 'Outros');
  assert.strictEqual(r('PIX RECEBIDO FULANO', ['Moradia', 'Mercado', 'Lazer']), 'Lazer');
  assert.strictEqual(r('PIX RECEBIDO FULANO', ['Moradia']), 'Moradia');
  assert.strictEqual(r('PIX RECEBIDO FULANO', []), '');
  // a despesa continua como antes: "Outros" ou a primeira
  assert.strictEqual(im.sugerirCategoria('PIX ENVIADO FULANO', 'despesa', [], ['Moradia', 'Mercado', 'Lazer']).categoria, 'Moradia');
  assert.strictEqual(im.categoriaPadrao('receita', CATEGORIAS), 'Outros');
  assert.strictEqual(im.categoriaPadrao('despesa', CATEGORIAS), 'Outros');
  // o que a pessoa já classificou antes e as palavras-chave continuam valendo
  assert.strictEqual(im.sugerirCategoria('PAGAMENTO DE SALARIO', 'receita', [], ['Moradia', 'Salário', 'Lazer']).categoria, 'Salário');
});

console.log(`\n${ok} testes passaram.`);
