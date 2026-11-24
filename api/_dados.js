/* Transforma as linhas do banco (snake_case) na lista do que falta pagar, com a mesma regra do Resumo e do app nativo
   (js/vencimentos.js). Pura: não acessa rede, por isso dá para testar. */

const V = require('../js/vencimentos.js');

function itensAPagar({ lancamentos, cartoes, faturas }) {
  return V.contasAPagar({
    lancamentos: (lancamentos || []).map(r => ({
      id: r.id, descricao: r.descricao, data: r.data, valor: Number(r.valor), tipo: r.tipo, status: r.status,
      cartaoId: r.cartao_id || null, faturaRef: r.fatura_ref || null,
    })),
    cartoes: (cartoes || []).map(r => ({ id: r.id, nome: r.nome, melhorDiaCompra: r.melhor_dia_compra, diaVencimento: r.dia_vencimento })),
    faturas: (faturas || []).map(r => ({ cartaoId: r.cartao_id, referencia: r.referencia })),
  });
}

module.exports = { itensAPagar, avisosDeVencimento: V.avisosDeVencimento };
