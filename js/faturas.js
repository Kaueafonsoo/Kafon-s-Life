/* GRANA — regras de cartão de crédito.
   Funções puras (sem tela e sem banco): dizem em qual fatura cai uma compra, quando a fatura fecha e vence.
   Usadas pelo contas.js e testadas por scripts/testar-faturas.js (node scripts/testar-faturas.js).

   Convenções:
   - Uma fatura é identificada pelo MÊS DO VENCIMENTO, no formato "aaaa-mm" (a "fatura de dezembro" vence em dezembro).
   - cartao = { diaFechamento, diaVencimento }.
   - Compra feita até o dia do fechamento (inclusive) entra na fatura que fecha naquele mês; depois, na seguinte.
   - O vencimento é o primeiro dia de vencimento depois do fechamento: se o dia de vencer é maior que o de fechar,
     vence no mesmo mês (fecha 3, vence 10); senão, no mês seguinte (fecha 25, vence 5).
   - Dia 29, 30 ou 31 em mês mais curto vale o último dia do mês. */

(function (raiz) {
  const MESES_FATURA = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function diasNoMes(ano, mesIdx) {
    return new Date(ano, mesIdx + 1, 0).getDate();
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
    const fechaNoMesDaCompra = dia <= Math.min(cartao.diaFechamento, diasNoMes(ano, mesIdx));
    const fech = somaMeses(ano, mesIdx, fechaNoMesDaCompra ? 0 : 1);
    const venceNoMesDoFechamento = cartao.diaVencimento > cartao.diaFechamento;
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
    const venceNoMesDoFechamento = cartao.diaVencimento > cartao.diaFechamento;
    const f = somaMeses(ano, mesIdx, venceNoMesDoFechamento ? 0 : -1);
    return paraIso(f.ano, f.mesIdx, cartao.diaFechamento);
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
    diasNoMes, somaMesesRef, faturaDaCompra, vencimentoDaFatura, fechamentoDaFatura, statusDaFatura, rotuloDaFatura,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, api);
})(typeof window !== 'undefined' ? window : globalThis);
