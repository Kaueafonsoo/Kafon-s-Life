/* Planeja os lembretes locais das 21h dos próximos dias (usado pelo app nativo). Função pura: recebe "agora" e os dados
   e devolve a lista do que agendar, para poder ser testada com horários fixos.

   Os marcos de 3 dias e 1 dia antes de cada vencimento saem das datas que já estão nos dados, então os avisos dos
   próximos dias podem ser agendados de uma vez e chegam mesmo se o app ficar dias sem abrir. */

const { montarMensagem } = require('./_mensagem');
const { avisosDeVencimento } = require('./_dados');
const V = require('../js/vencimentos.js');

const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Categorias com 80%+ do orçamento usado no mês de `dia` (aaaa-mm-dd). */
function orcamentoDoDia(dia, lancamentos, orcamentos) {
  const prefixo = dia.slice(0, 7);
  const gasto = {};
  lancamentos.filter(l => l.tipo === 'despesa' && l.data.startsWith(prefixo))
    .forEach(l => { gasto[l.categoria] = (gasto[l.categoria] || 0) + Number(l.valor); });
  return Object.entries(orcamentos || {})
    .filter(([, planejado]) => Number(planejado) > 0)
    .map(([categoria, planejado]) => ({ categoria, pct: ((gasto[categoria] || 0) / Number(planejado)) * 100 }))
    .filter(o => o.pct >= 80)
    .map(o => ({ ...o, estourou: o.pct > 100 }))
    .sort((a, b) => b.pct - a.pct);
}

/** dados: { agora: Date, dias, hora (21), lancamentos, cartoes, faturas, orcamentos, privacidade } (objetos no formato da tela).
    Retorna [{ indice, quando: Date, title, body }] só para as noites que têm algo a dizer. */
function planejarLembretes({ agora, dias = 7, hora = 21, lancamentos, cartoes, faturas, orcamentos, privacidade }) {
  const primeiro = new Date(agora);
  primeiro.setHours(hora, 0, 0, 0);
  const primeiroEhHoje = agora < primeiro;
  if (!primeiroEhHoje) primeiro.setDate(primeiro.getDate() + 1);

  const itens = V.contasAPagar({ lancamentos, cartoes, faturas });
  const saida = [];
  for (let i = 0; i < dias; i++) {
    const quando = new Date(primeiro);
    quando.setDate(quando.getDate() + i);
    const dia = isoLocal(quando);
    const msg = montarMensagem({
      hoje: dia,
      privacidade: !!privacidade,
      // Só dá pra saber se você já lançou hoje; nas noites seguintes assume que ainda não.
      lancouHoje: i === 0 && primeiroEhHoje ? lancamentos.some(l => l.data === dia) : false,
      avisos: avisosDeVencimento(itens, dia),
      orcamento: orcamentoDoDia(dia, lancamentos, orcamentos),
    });
    if (msg) saida.push({ indice: i, quando, title: msg.title, body: msg.body });
  }
  return saida;
}

module.exports = { planejarLembretes, orcamentoDoDia };
