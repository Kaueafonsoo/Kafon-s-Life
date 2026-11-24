/* GRANA — validações pequenas e puras, usadas pelos formulários e testadas por scripts/testar-validacoes.js. */

(function (raiz) {
  const normalizar = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** Só endereços que começam com http:// ou https:// (e sem espaços). Bloqueia javascript:, data:, ftp: e afins. */
  function ehLinkWeb(texto) {
    return /^https?:\/\/[^\s]+$/i.test((texto || '').trim());
  }

  /** Tira itens repetidos de uma lista ignorando maiúsculas, acentos e espaços a mais; fica o primeiro de cada, com a
      grafia que a pessoa digitou. Linhas vazias também saem. */
  function removerRepetidas(lista) {
    const vistos = new Set();
    const saida = [];
    for (const item of lista) {
      const chave = normalizar(item);
      if (!chave || vistos.has(chave)) continue;
      vistos.add(chave);
      saida.push(item.trim());
    }
    return saida;
  }

  /** Dia pré-preenchido num novo lançamento: o dia de hoje, limitado ao último dia do mês que está na tela
      (hoje dia 31 olhando fevereiro vira 28 ou 29, não 28 fixo). */
  function diaPadraoDoMes(diaDeHoje, ano, mesIdx) {
    return Math.min(diaDeHoje, new Date(ano, mesIdx + 1, 0).getDate());
  }

  const api = { ehLinkWeb, removerRepetidas, diaPadraoDoMes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, api);
})(typeof window !== 'undefined' ? window : globalThis);
