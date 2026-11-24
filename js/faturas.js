/* GRANA — regras de cartão de crédito.
   Funções puras (sem tela e sem banco): dizem em qual fatura cai uma compra, quando a fatura fecha e vence.
   Usadas pelo contas.js e testadas por scripts/testar-faturas.js (node scripts/testar-faturas.js).

   O cartão é descrito por dois números, exatamente os que o app do banco mostra:
     cartao = { melhorDiaCompra, diaVencimento }

   Convenções:
   - MELHOR DIA DE COMPRA: compras feitas a partir desse dia entram só na fatura SEGUINTE; as feitas antes dele
     ainda entram na fatura que está fechando. Vale para qualquer banco (no Nubank é o próprio dia de fechamento;
     no Inter é o dia seguinte ao fechamento). O dia em que a fatura fecha é, portanto, o dia anterior ao melhor dia
     (melhor dia 1 = fecha no último dia do mês).
   - Uma fatura é identificada pelo MÊS DO VENCIMENTO, no formato "aaaa-mm" (a "fatura de dezembro" vence em dezembro).
   - O vencimento é o primeiro dia de vencer depois do fechamento: se o dia de vencer é maior que o de fechar,
     vence no mesmo mês (fecha 3, vence 10); senão, no mês seguinte (fecha 25, vence 5).
   - Dia 29, 30 ou 31 em mês mais curto vale o último dia do mês. */

(function (raiz) {
  const MESES_FATURA = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function diasNoMes(ano, mesIdx) {
    return new Date(ano, mesIdx + 1, 0).getDate();
  }

  /** Dia em que a fatura fecha, a partir do melhor dia de compra (1 = último dia do mês, representado por 31). */
  function diaDeFechamento(cartao) {
    return cartao.melhorDiaCompra <= 1 ? 31 : cartao.melhorDiaCompra - 1;
  }

  function paraIso(ano, mesIdx, dia) {
    const ultimo = diasNoMes(ano, mesIdx);
    const d = Math.min(dia, ultimo);
    return `${ano}-${String(mesIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /** Soma meses a um ano e mês (0-11), devolvendo { ano, mesIdx }. */
  function somaMeses(ano, mesIdx, n) {
    const total = ano * 12 + mesIdx + n;
    return { ano: Math.floor(total / 12), mesIdx: ((total % 12) + 12) % 12 };
  }

  function refDe(ano, mesIdx) {
    return `${ano}-${String(mesIdx + 1).padStart(2, '0')}`;
  }

  function lerRef(ref) {
    const [ano, mes] = ref.split('-').map(Number);
    return { ano, mesIdx: mes - 1 };
  }

  /** "2026-12" + 3 -> "2027-03" */
  function somaMesesRef(ref, n) {
    const { ano, mesIdx } = lerRef(ref);
    const r = somaMeses(ano, mesIdx, n);
    return refDe(r.ano, r.mesIdx);
  }

  /** Em qual fatura (mês do vencimento) cai uma compra feita na data ISO. */
  function faturaDaCompra(dataIso, cartao) {
    const [ano, mes, dia] = dataIso.split('-').map(Number);
    const mesIdx = mes - 1;
    const diaFecha = diaDeFechamento(cartao);
    const fechaNoMesDaCompra = dia <= Math.min(diaFecha, diasNoMes(ano, mesIdx));
    const fech = somaMeses(ano, mesIdx, fechaNoMesDaCompra ? 0 : 1);
    const venceNoMesDoFechamento = cartao.diaVencimento > diaFecha;
    const venc = somaMeses(fech.ano, fech.mesIdx, venceNoMesDoFechamento ? 0 : 1);
    return refDe(venc.ano, venc.mesIdx);
  }

  /** Data ISO em que a fatura vence. */
  function vencimentoDaFatura(ref, cartao) {
    const { ano, mesIdx } = lerRef(ref);
    return paraIso(ano, mesIdx, cartao.diaVencimento);
  }

  /** Data ISO em que a fatura fecha (a última compra que entra nela). */
  function fechamentoDaFatura(ref, cartao) {
    const { ano, mesIdx } = lerRef(ref);
    const diaFecha = diaDeFechamento(cartao);
    const venceNoMesDoFechamento = cartao.diaVencimento > diaFecha;
    const f = somaMeses(ano, mesIdx, venceNoMesDoFechamento ? 0 : -1);
    return paraIso(f.ano, f.mesIdx, diaFecha);
  }

  /** 'paga' | 'aberta' (ainda recebe compras) | 'fechada' (aguardando pagamento) | 'vencida' */
  function statusDaFatura(ref, cartao, hojeIso, paga) {
    if (paga) return 'paga';
    if (hojeIso <= fechamentoDaFatura(ref, cartao)) return 'aberta';
    if (hojeIso > vencimentoDaFatura(ref, cartao)) return 'vencida';
    return 'fechada';
  }

  /** "dezembro de 2026" */
  function rotuloDaFatura(ref) {
    const { ano, mesIdx } = lerRef(ref);
    return `${MESES_FATURA[mesIdx]} de ${ano}`;
  }

  const api = {
    diasNoMes, diaDeFechamento, somaMesesRef, faturaDaCompra, vencimentoDaFatura, fechamentoDaFatura, statusDaFatura, rotuloDaFatura,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, api);
})(typeof window !== 'undefined' ? window : globalThis);
