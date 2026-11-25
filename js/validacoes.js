/* GRANA — validações pequenas e puras, usadas pelos formulários e testadas por scripts/testar-validacoes.js. */

(function (raiz) {
  const normalizar = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

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

  /* ---------- Orçamento (aba Planejar) ---------- */

  /** Categorias com valor planejado que já gastaram mais que ele, da que mais passou para a que menos passou.
      orcamentos: { categoria: planejado }; gastos: { categoria: gasto no mês }. Categoria sem planejado nunca "estoura". */
  function categoriasEstouradas(categorias, orcamentos, gastos) {
    return categorias
      .map(cat => ({ categoria: cat, planejado: orcamentos[cat] || 0, gasto: gastos[cat] || 0 }))
      .filter(c => c.planejado > 0 && c.gasto > c.planejado)
      .map(c => ({ categoria: c.categoria, passou: Math.round((c.gasto - c.planejado) * 100) / 100 }))
      .sort((a, b) => b.passou - a.passou);
  }

  /** "Atenção: Moradia passou R$ 150,00 do planejado". Até 2 categorias; as outras viram ", e mais N". Vazio se ninguém estourou.
      `moeda` formata o valor (é ela que esconde os números no modo privacidade). */
  function textoCategoriasEstouradas(estouradas, moeda) {
    if (!estouradas.length) return '';
    const nomeadas = estouradas.slice(0, 2).map(c => `${c.categoria} passou ${moeda(c.passou)}`);
    const resto = estouradas.length - nomeadas.length;
    return `Atenção: ${nomeadas.join(' e ')} do planejado${resto > 0 ? `, e mais ${resto}` : ''}`;
  }

  /** Como a linha de uma categoria do orçamento é desenhada. Com planejado: barra e "R$ X de R$ Y". Sem planejado (zero ou
      vazio): sem barra e só "R$ X gastos · sem valor planejado". */
  function linhaDoOrcamento(gasto, planejado) {
    if (!(planejado > 0)) return { temBarra: false, pct: 0, status: 'sem-plano' };
    const pct = (gasto / planejado) * 100;
    return { temBarra: true, pct, status: pct > 100 ? 'over' : (pct >= 80 ? 'warn' : 'ok') };
  }

  const api = { removerRepetidas, diaPadraoDoMes, categoriasEstouradas, textoCategoriasEstouradas, linhaDoOrcamento };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, api);
})(typeof window !== 'undefined' ? window : globalThis);
