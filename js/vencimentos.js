/* GRANA — o que falta pagar, "quanto posso gastar hoje" e avisos de vencimento.
   Funções puras (sem tela e sem banco), usadas em três lugares com a MESMA conta: o Resumo (navegador),
   o lembrete por push (api/, Node) e o lembrete local do app nativo. Testadas por scripts/testar-vencimentos.js.

   Um "item a pagar" é: { tipo: 'conta' | 'fatura', id, descricao, data (vencimento, aaaa-mm-dd), valor }.
   - conta: despesa com status "pendente" (não é compra no cartão);
   - fatura: soma das compras de um cartão numa fatura que ainda não foi paga. */

(function (raiz) {
  function criar(F) {
    const MS_DIA = 86400000;
    const paraData = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
    const paraIso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const arredonda = (n) => Math.round(n * 100) / 100;

    /** Dias entre duas datas ISO (ate - de). */
    function diasEntre(deIso, ateIso) {
      return Math.round((paraData(ateIso) - paraData(deIso)) / MS_DIA);
    }

    function somaDiasIso(iso, n) {
      const d = paraData(iso);
      d.setDate(d.getDate() + n);
      return paraIso(d);
    }

    /** Tudo que ainda falta pagar: contas pendentes e faturas de cartão em aberto. */
    function contasAPagar({ lancamentos, cartoes, faturas }) {
      const itens = [];
      for (const l of lancamentos) {
        if (l.tipo === 'despesa' && l.status === 'pendente' && !l.cartaoId) {
          itens.push({ tipo: 'conta', id: l.id, descricao: l.descricao, data: l.data, valor: l.valor });
        }
      }
      for (const k of cartoes || []) {
        const totais = {};
        for (const l of lancamentos) {
          if (l.cartaoId === k.id && l.tipo === 'despesa' && l.faturaRef) totais[l.faturaRef] = (totais[l.faturaRef] || 0) + l.valor;
        }
        for (const [ref, total] of Object.entries(totais)) {
          if ((faturas || []).some(f => f.cartaoId === k.id && f.referencia === ref)) continue; // já paga
          if (arredonda(total) <= 0) continue;
          itens.push({
            tipo: 'fatura', id: `${k.id}:${ref}`, cartaoId: k.id, ref,
            descricao: `Fatura ${k.nome}`, data: F.vencimentoDaFatura(ref, { melhorDiaCompra: k.melhorDiaCompra, diaVencimento: k.diaVencimento }),
            valor: arredonda(total),
          });
        }
      }
      return itens.sort((a, b) => a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao));
    }

    /** Dia em que o salário cai: neste mês se ainda não chegou, senão no mês seguinte. Sem dia configurado: null. */
    function proximoPagamento(hojeIso, diaPagamento) {
      if (!diaPagamento || diaPagamento < 1 || diaPagamento > 31) return null;
      const [ano, mes, dia] = hojeIso.split('-').map(Number);
      const alvo = dia >= diaPagamento ? { ano: mes === 12 ? ano + 1 : ano, mesIdx: mes % 12 } : { ano, mesIdx: mes - 1 };
      return `${alvo.ano}-${String(alvo.mesIdx + 1).padStart(2, '0')}-${String(Math.min(diaPagamento, F.diasNoMes(alvo.ano, alvo.mesIdx))).padStart(2, '0')}`;
    }

    /** Primeiro dia do mês seguinte (usado como horizonte quando não há dia de salário). */
    function inicioDoProximoMes(hojeIso) {
      const [ano, mes] = hojeIso.split('-').map(Number);
      return `${mes === 12 ? ano + 1 : ano}-${String((mes % 12) + 1).padStart(2, '0')}-01`;
    }

    /** Média diária dos gastos dos últimos `janela` dias, sem as contas grandes e raras (aluguel, mensalidade):
        descarta o que passa de 3x a mediana, para o ritmo refletir o gasto do dia a dia. */
    function mediaDiariaDeGastos(lancamentos, hojeIso, janela = 30) {
      const inicio = somaDiasIso(hojeIso, -janela);
      const valores = lancamentos
        .filter(l => l.tipo === 'despesa' && l.data > inicio && l.data <= hojeIso)
        .map(l => l.valor)
        .sort((a, b) => a - b);
      if (!valores.length) return 0;
      const mediana = valores[Math.floor(valores.length / 2)];
      const corte = mediana * 3;
      const soma = valores.filter(v => v <= corte).reduce((s, v) => s + v, 0);
      return arredonda(soma / janela);
    }

    /** Quanto dá para gastar por dia até o próximo salário, já separando o que está para vencer.
        status: 'vermelho' (sem folga), 'amarelo' (folga menor que o seu ritmo normal), 'verde' (dá pra manter o ritmo). */
    function quantoPossoGastar({ hoje, diaPagamento, saldo, itens, mediaDiaria = 0, atrasoMaximoDias = 60 }) {
      const salario = proximoPagamento(hoje, diaPagamento);
      const limite = salario || inicioDoProximoMes(hoje);
      const dias = Math.max(1, diasEntre(hoje, limite));
      const desde = somaDiasIso(hoje, -atrasoMaximoDias);
      // Conta que vence no dia do salário já é paga com o salário novo: só entra o que vence antes.
      const considerados = itens.filter(i => i.data >= desde && i.data < limite);
      const aPagar = arredonda(considerados.reduce((s, i) => s + i.valor, 0));
      const disponivel = arredonda(saldo - aPagar);
      const porDia = arredonda(disponivel / dias);
      let status;
      if (porDia <= 0) status = 'vermelho';
      else if (mediaDiaria > 0 && porDia < mediaDiaria) status = 'amarelo';
      else status = 'verde';
      return { dias, limite, temSalario: !!salario, saldo: arredonda(saldo), aPagar, disponivel, porDia, mediaDiaria, status, considerados };
    }

    /** Vencimentos para destacar: atrasados, de hoje e dos próximos `dias` dias (usado no card do Resumo). */
    function vencimentosProximos(itens, hojeIso, dias = 3, atrasoMaximoDias = 30) {
      return itens
        .map(i => ({ ...i, faltam: diasEntre(hojeIso, i.data) }))
        .filter(i => i.faltam <= dias && i.faltam >= -atrasoMaximoDias);
    }

    /** O que avisar numa notificação rodada à noite: atrasados, vence hoje, vence amanhã (1 dia antes) e vence em 3 dias.
        Só esses marcos, para não repetir o mesmo aviso todo dia. */
    function avisosDeVencimento(itens, hojeIso, antecedencias = [3, 1], atrasoMaximoDias = 30) {
      const r = { atrasadas: [], hoje: [], antes: {} };
      antecedencias.forEach(n => { r.antes[n] = []; });
      for (const i of itens) {
        const faltam = diasEntre(hojeIso, i.data);
        if (faltam < 0 && faltam >= -atrasoMaximoDias) r.atrasadas.push(i);
        else if (faltam === 0) r.hoje.push(i);
        else if (r.antes[faltam]) r.antes[faltam].push(i);
      }
      return r;
    }

    return { diasEntre, somaDiasIso, contasAPagar, proximoPagamento, inicioDoProximoMes, mediaDiariaDeGastos, quantoPossoGastar, vencimentosProximos, avisosDeVencimento };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = criar(require('./faturas.js'));
  else Object.assign(raiz, criar(raiz));
})(typeof window !== 'undefined' ? window : globalThis);
