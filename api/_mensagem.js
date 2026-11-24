/* Monta o texto do lembrete diário. Função pura (sem rede/banco) pra poder ser testada sozinha.
   É a MESMA usada pelo app nativo (src-app/nativo.js), então o aviso é igual no push e no lembrete local.

   dados = {
     hoje: 'aaaa-mm-dd',
     privacidade: boolean,
     lancouHoje: boolean,
     avisos: { atrasadas: [item], hoje: [item], antes: { 1: [item], 3: [item] } },   // de js/vencimentos.js (avisosDeVencimento)
     orcamento: [{ categoria, pct, estourou }],                                        // categorias com 80%+ do orçamento usado
   }
   item = { descricao, ... } — conta pendente ou "Fatura <cartão>".
   Os vencimentos só avisam nos marcos de 3 dias e 1 dia antes, no dia e quando atrasam; assim o mesmo vencimento não
   vira notificação todo dia. Retorna { title, body } ou null quando não há nada útil a dizer (melhor não incomodar). */

function nomesAte(lista, max) {
  const nomes = lista.slice(0, max);
  const resto = lista.length - nomes.length;
  return nomes.join(', ') + (resto > 0 ? ` e mais ${resto}` : '');
}

function montarMensagem({ hoje, privacidade, lancouHoje, avisos, orcamento }) {
  const a = avisos || { atrasadas: [], hoje: [], antes: {} };
  const antes = a.antes || {};
  const linhas = [];
  let sensivel = false;

  // "vence" no singular, "vencem" no plural
  const verbo = (lista) => (lista.length === 1 ? 'vence' : 'vencem');
  const nomes = (lista) => nomesAte(lista.map(i => i.descricao), 2);
  const partes = [];
  if (a.atrasadas.length) partes.push(`em atraso: ${nomes(a.atrasadas)}`);
  if (a.hoje.length) partes.push(`${verbo(a.hoje)} hoje: ${nomes(a.hoje)}`);
  if ((antes[1] || []).length) partes.push(`${verbo(antes[1])} amanhã: ${nomes(antes[1])}`);
  if ((antes[3] || []).length) partes.push(`${verbo(antes[3])} em 3 dias: ${nomes(antes[3])}`);
  if (partes.length) {
    sensivel = true;
    linhas.push(`Contas ${partes.join(' · ')}`);
  }

  if (orcamento.length) {
    sensivel = true;
    const itens = orcamento.slice(0, 3).map(o => o.estourou ? `${o.categoria} estourou` : `${o.categoria} em ${Math.floor(o.pct)}%`);
    linhas.push(`Orçamento: ${itens.join(', ')}`);
  }

  if (!lancouHoje) linhas.push('Você ainda não lançou nada hoje.');

  if (!linhas.length) return null;

  // Com o modo privacidade ligado, o texto da tela bloqueada não revela nomes de contas nem categorias.
  if (privacidade && sensivel) {
    const generico = ['Você tem avisos de contas ou orçamento. Abra o GRANA para ver.'];
    if (!lancouHoje) generico.push('Você ainda não lançou nada hoje.');
    return { title: 'GRANA', body: generico.join(' ') };
  }
  return { title: 'GRANA', body: linhas.join('\n') };
}

module.exports = { montarMensagem };
