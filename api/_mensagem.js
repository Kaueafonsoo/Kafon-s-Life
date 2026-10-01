/* Monta o texto do lembrete diário. Função pura (sem rede/banco) pra poder ser testada sozinha.

   dados = {
     hoje: 'aaaa-mm-dd',
     privacidade: boolean,
     lancouHoje: boolean,
     contas: [{ descricao, data }],              // despesas pendentes de ontem a amanhã (e atrasadas)
     orcamento: [{ categoria, pct, estourou }],  // categorias com 80%+ do orçamento usado
   }
   Retorna { title, body } ou null quando não há nada útil a dizer (melhor não incomodar). */

function nomesAte(lista, max) {
  const nomes = lista.slice(0, max);
  const resto = lista.length - nomes.length;
  return nomes.join(', ') + (resto > 0 ? ` e mais ${resto}` : '');
}

function montarMensagem({ hoje, privacidade, lancouHoje, contas, orcamento }) {
  const linhas = [];
  let sensivel = false;

  if (contas.length) {
    sensivel = true;
    const atrasadas = contas.filter(c => c.data < hoje);
    const hojeLista = contas.filter(c => c.data === hoje);
    const amanha = contas.filter(c => c.data > hoje);
    const partes = [];
    if (atrasadas.length) partes.push(`em atraso: ${nomesAte(atrasadas.map(c => c.descricao), 2)}`);
    if (hojeLista.length) partes.push(`vencem hoje: ${nomesAte(hojeLista.map(c => c.descricao), 2)}`);
    if (amanha.length) partes.push(`vencem amanhã: ${nomesAte(amanha.map(c => c.descricao), 2)}`);
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
