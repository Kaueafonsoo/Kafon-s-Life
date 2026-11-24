/* ===================================================================
   GRANA — contas, cartões de crédito e faturas.
   As regras de fechamento/vencimento ficam em js/faturas.js (funções puras e testadas);
   aqui moram os cálculos sobre os dados, a aba "Contas", a tela da fatura e os modais.

   Ideias que valem pro arquivo todo:
   - O saldo de uma conta NÃO é gravado: é saldo_inicial + lançamentos pagos até hoje - faturas pagas.
     Assim ele nunca fica desatualizado em relação aos lançamentos.
   - Compra no cartão não mexe em nenhuma conta. Só o PAGAMENTO da fatura tira dinheiro da conta, e esse
     pagamento fica na tabela "faturas" (não em "lancamentos"), pra despesa não contar duas vezes.
   - Se as tabelas novas ainda não existem no Supabase, state.recursoContas fica false e toda esta parte
     some da tela: o app continua funcionando como antes.
   =================================================================== */

const TIPOS_CONTA = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  carteira: 'Carteira (dinheiro)',
  investimento: 'Investimentos',
  outro: 'Outra',
};

const ICONES_TIPO_CONTA = {
  corrente: '<path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
  poupanca: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  carteira: '<path d="M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l2-3h12M16 13h.01"/>',
  investimento: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  outro: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
};

const ICONE_CARTAO = '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>';
const ICONE_EDITAR = '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>';

const DESTINO_LOCAL_KEY = 'grana_ultimo_destino';

const $id = (id) => document.getElementById(id);
const doisDigitos = (n) => String(n).padStart(2, '0');
const arredonda = (n) => Math.round(n * 100) / 100;

function hojeIso() {
  const d = new Date();
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

/** "2026-12-05" -> "05/12" */
function diaMes(iso) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/* ---------- Conversão linha do banco <-> objeto da tela ---------- */

function rowToConta(r) {
  return { id: r.id, nome: r.nome, tipo: r.tipo, saldoInicial: Number(r.saldo_inicial), arquivada: !!r.arquivada };
}

function rowToCartao(r) {
  return {
    id: r.id, nome: r.nome, limite: Number(r.limite),
    melhorDiaCompra: r.melhor_dia_compra, diaVencimento: r.dia_vencimento,
    contaPagamentoId: r.conta_pagamento_id || null, arquivado: !!r.arquivado,
  };
}

function rowToFatura(r) {
  return {
    id: r.id, cartaoId: r.cartao_id, referencia: r.referencia,
    valorPago: Number(r.valor_pago), pagoEm: r.pago_em, contaId: r.conta_id || null,
  };
}

function rowToTransferencia(r) {
  return {
    id: r.id, contaOrigemId: r.conta_origem_id, contaDestinoId: r.conta_destino_id,
    valor: Number(r.valor), data: r.data, descricao: r.descricao || '',
  };
}

/* ---------- Carregar do Supabase ---------- */

/** Busca contas, cartões e pagamentos de fatura. Se as tabelas ainda não existem (schema.sql não rodou),
    desliga o recurso em vez de quebrar o app inteiro. */
async function carregarContas() {
  const [contaRes, cartaoRes, faturaRes] = await Promise.all([
    supabaseClient.from('contas').select('*').order('created_at', { ascending: true }),
    supabaseClient.from('cartoes').select('*').order('created_at', { ascending: true }),
    supabaseClient.from('faturas').select('*'),
  ]);
  const erro = contaRes.error || cartaoRes.error || faturaRes.error;
  if (erro) {
    console.warn('Contas e cartões indisponíveis (rode supabase/schema.sql):', erro.message);
    state.recursoContas = false;
    state.contas = []; state.cartoes = []; state.faturas = [];
  } else {
    state.recursoContas = true;
    state.contas = (contaRes.data || []).map(rowToConta);
    state.cartoes = (cartaoRes.data || []).map(rowToCartao);
    state.faturas = (faturaRes.data || []).map(rowToFatura);
  }
  document.documentElement.classList.toggle('sem-contas', !state.recursoContas);

  // Transferências são opcionais: se a tabela ainda não existe, só o botão "Transferir" some.
  state.transferencias = []; state.recursoTransf = false;
  if (state.recursoContas) {
    const transfRes = await supabaseClient.from('transferencias').select('*').order('data', { ascending: false });
    if (!transfRes.error) {
      state.recursoTransf = true;
      state.transferencias = (transfRes.data || []).map(rowToTransferencia);
    } else {
      console.warn('Transferências indisponíveis (rode supabase/schema.sql):', transfRes.error.message);
    }
  }
  document.documentElement.classList.toggle('sem-transf', !state.recursoTransf);
}

/** Todo usuário precisa de ao menos uma conta pra ligar os lançamentos. O índice único (usuário + nome) impede
    duplicata se dois aparelhos abrirem ao mesmo tempo pela primeira vez. */
async function garantirContaPadrao() {
  if (!state.recursoContas || state.contas.length) return;
  const { data, error } = await supabaseClient
    .from('contas')
    .insert({ user_id: session.user.id, nome: 'Conta principal', tipo: 'corrente', saldo_inicial: 0 })
    .select().single();
  if (error) {
    const { data: lista } = await supabaseClient.from('contas').select('*');
    state.contas = (lista || []).map(rowToConta);
    return;
  }
  state.contas.push(rowToConta(data));
}

/* ---------- Consultas ---------- */

const contaPorId = (id) => state.contas.find(c => c.id === id) || null;
const cartaoPorId = (id) => state.cartoes.find(c => c.id === id) || null;
const contasAtivas = () => state.contas.filter(c => !c.arquivada);
const cartoesAtivos = () => state.cartoes.filter(c => !c.arquivado);

/** Saldo atual: inicial + receitas pagas - despesas pagas - faturas pagas, tudo até hoje.
    Lançamento pendente ou com data futura (parcelas, recorrências) ainda não mexeu no dinheiro. */
function movimentoDaConta(contaId, hoje = hojeIso()) {
  let total = 0;
  for (const l of state.lancamentos) {
    if (l.contaId !== contaId || l.status !== 'pago' || l.data > hoje) continue;
    total += l.tipo === 'receita' ? l.valor : -l.valor;
  }
  for (const f of state.faturas) {
    if (f.contaId === contaId && f.pagoEm <= hoje) total -= f.valorPago;
  }
  // Transferência: sai de uma conta e entra na outra, sem passar por receita/despesa.
  for (const t of state.transferencias) {
    if (t.data > hoje) continue;
    if (t.contaOrigemId === contaId) total -= t.valor;
    if (t.contaDestinoId === contaId) total += t.valor;
  }
  return arredonda(total);
}

function saldoDaConta(conta, hoje = hojeIso()) {
  return arredonda(conta.saldoInicial + movimentoDaConta(conta.id, hoje));
}

function contaTemMovimento(contaId) {
  return state.lancamentos.some(l => l.contaId === contaId) || state.faturas.some(f => f.contaId === contaId)
    || state.transferencias.some(t => t.contaOrigemId === contaId || t.contaDestinoId === contaId);
}

function cartaoTemMovimento(cartaoId) {
  return state.lancamentos.some(l => l.cartaoId === cartaoId) || state.faturas.some(f => f.cartaoId === cartaoId);
}

function lancamentosDaFatura(cartaoId, ref) {
  return state.lancamentos.filter(l => l.cartaoId === cartaoId && l.faturaRef === ref && l.tipo === 'despesa');
}

function totalDaFatura(cartaoId, ref) {
  return arredonda(lancamentosDaFatura(cartaoId, ref).reduce((s, l) => s + l.valor, 0));
}

function pagamentoDaFatura(cartaoId, ref) {
  return state.faturas.find(f => f.cartaoId === cartaoId && f.referencia === ref) || null;
}

/** Limite usado = tudo que ainda não foi pago no cartão, inclusive parcelas de faturas futuras (como no banco). */
function limiteUsado(cartao, ignorarLancId = null) {
  let total = 0;
  for (const l of state.lancamentos) {
    if (l.cartaoId !== cartao.id || l.tipo !== 'despesa' || l.id === ignorarLancId) continue;
    if (!pagamentoDaFatura(cartao.id, l.faturaRef)) total += l.valor;
  }
  return arredonda(total);
}

/** A fatura que importa agora: a mais antiga ainda não paga que tem compras; se não houver, a atual (vazia). */
function faturaEmFoco(cartao) {
  const pendentes = new Set();
  for (const l of state.lancamentos) {
    if (l.cartaoId === cartao.id && l.tipo === 'despesa' && l.faturaRef && !pagamentoDaFatura(cartao.id, l.faturaRef)) pendentes.add(l.faturaRef);
  }
  if (pendentes.size) return [...pendentes].sort()[0];
  return faturaDaCompra(hojeIso(), cartao);
}

function statusDaFaturaDoCartao(cartao, ref) {
  return statusDaFatura(ref, cartao, hojeIso(), !!pagamentoDaFatura(cartao.id, ref));
}

const ROTULO_STATUS = { paga: 'Paga', aberta: 'Aberta', fechada: 'Fechada', vencida: 'Vencida' };

/* ---------- Peças usadas pelo formulário de lançamento ---------- */

/** Texto da coluna "Pagamento" na lista de lançamentos. */
function rotuloPagamento(l) {
  if (!state.recursoContas) return l.formaPagamento;
  const cartao = l.cartaoId && cartaoPorId(l.cartaoId);
  if (cartao) return `Cartão ${cartao.nome}`;
  const conta = l.contaId && contaPorId(l.contaId);
  if (conta) return `${conta.nome} · ${l.formaPagamento}`;
  return l.formaPagamento;
}

/** Valor do filtro "Todas as contas": '' | 'c:<id>' | 'k:<id>'. */
function lancamentoPassaNoFiltroConta(l, filtro) {
  if (!filtro) return true;
  const [tipo, id] = [filtro[0], filtro.slice(2)];
  return tipo === 'c' ? l.contaId === id : l.cartaoId === id;
}

function popularFiltroConta() {
  const sel = $id('filter-conta');
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todas as contas</option>';
  contasAtivas().forEach(c => sel.appendChild(new Option(c.nome, `c:${c.id}`)));
  cartoesAtivos().forEach(k => sel.appendChild(new Option(`Cartão ${k.nome}`, `k:${k.id}`)));
  if ([...sel.options].some(o => o.value === atual)) sel.value = atual;
}

function opcaoGrupo(rotulo, opcoes) {
  const g = document.createElement('optgroup');
  g.label = rotulo;
  opcoes.forEach(([valor, texto]) => g.appendChild(new Option(texto, valor)));
  return g;
}

/** Monta o campo "Conta ou cartão". `selecionado` = '' | 'c:<id>' | 'k:<id>'. Receita só vai pra conta. */
function popularDestinoLancamento(selecionado) {
  const sel = $id('lanc-conta');
  const ehReceita = $id('lanc-tipo').value === 'receita';
  sel.innerHTML = '';

  if (selecionado === '') sel.appendChild(new Option('— Sem conta —', ''));

  const contas = contasAtivas().map(c => [`c:${c.id}`, c.nome]);
  const contaSel = selecionado.startsWith('c:') ? contaPorId(selecionado.slice(2)) : null;
  if (contaSel && contaSel.arquivada) contas.push([selecionado, `${contaSel.nome} (arquivada)`]);
  if (contas.length) sel.appendChild(opcaoGrupo('Contas', contas));

  if (!ehReceita) {
    const cartoes = cartoesAtivos().map(k => [`k:${k.id}`, `${k.nome} (crédito)`]);
    const cartaoSel = selecionado.startsWith('k:') ? cartaoPorId(selecionado.slice(2)) : null;
    if (cartaoSel && cartaoSel.arquivado) cartoes.push([selecionado, `${cartaoSel.nome} (arquivado)`]);
    if (cartoes.length) sel.appendChild(opcaoGrupo('Cartões de crédito', cartoes));
  }

  const valido = [...sel.options].some(o => o.value === selecionado);
  sel.value = valido ? selecionado : (sel.options[0] ? sel.options[0].value : '');
}

/** Chamado ao abrir o modal. `lanc` = lançamento sendo editado (ou null); `destinoInicial` vem do botão "+ Compra no cartão". */
function prepararDestinoLancamento(lanc, destinoInicial) {
  let selecionado;
  if (lanc) {
    selecionado = lanc.cartaoId ? `k:${lanc.cartaoId}` : (lanc.contaId ? `c:${lanc.contaId}` : '');
  } else if (destinoInicial) {
    selecionado = destinoInicial;
  } else {
    const ultimo = localStorage.getItem(DESTINO_LOCAL_KEY) || '';
    const existe = ultimo.startsWith('c:') ? contasAtivas().some(c => `c:${c.id}` === ultimo) : cartoesAtivos().some(k => `k:${k.id}` === ultimo);
    selecionado = existe ? ultimo : (contasAtivas()[0] ? `c:${contasAtivas()[0].id}` : '');
  }
  popularDestinoLancamento(selecionado);
  aoMudarDestinoLancamento();
}

function lerDestinoLancamento() {
  const v = $id('lanc-conta').value || '';
  if (v.startsWith('k:')) { const cartao = cartaoPorId(v.slice(2)); return { contaId: null, cartaoId: cartao ? cartao.id : null, cartao }; }
  if (v.startsWith('c:')) return { contaId: v.slice(2), cartaoId: null, cartao: null };
  return { contaId: null, cartaoId: null, cartao: null };
}

/** Compra no cartão não tem "forma de pagamento" nem "status" pra escolher: esconde esses campos. */
function aoMudarDestinoLancamento() {
  const d = lerDestinoLancamento();
  $id('lanc-forma-status-row').hidden = !!d.cartao;
  atualizarDicaFatura();
}

function aoMudarTipoLancamento() {
  popularDestinoLancamento($id('lanc-conta').value || '');
  aoMudarDestinoLancamento();
}

function atualizarDicaFatura() {
  const hint = $id('lanc-conta-hint');
  const d = lerDestinoLancamento();
  const data = $id('lanc-data').value;
  // No cartão, a explicação por fatura substitui a linha "Última parcela: mês" (que é pela data da compra e confunde).
  if (!d.cartao || !data) { hint.hidden = true; updateRepeticaoFim(); return; }
  $id('lanc-repeticao-fim').hidden = true;

  const ref = faturaDaCompra(data, d.cartao);
  let texto = `Entra na fatura de ${rotuloDaFatura(ref)} (fecha ${diaMes(fechamentoDaFatura(ref, d.cartao))}, vence ${diaMes(vencimentoDaFatura(ref, d.cartao))}).`;

  const modo = editingLancId ? 'nenhuma' : $id('lanc-repeticao').value;
  const qtd = parseInt($id('lanc-repeticao-qtd').value, 10) || 1;
  if ((modo === 'parcelado' || modo === 'recorrente') && qtd > 1) {
    texto += ` As demais vão para as faturas seguintes, até ${rotuloDaFatura(somaMesesRef(ref, qtd - 1))}.`;
  }

  const valor = parseFloat($id('lanc-valor').value) || 0;
  if ($id('lanc-tipo').value === 'despesa' && modo !== 'recorrente') {
    const disponivel = d.cartao.limite - limiteUsado(d.cartao, editingLancId);
    if (valor > disponivel + 0.005) texto += ` Atenção: passa do limite disponível (${formatCurrency(Math.max(0, disponivel))}).`;
  }
  hint.textContent = texto;
  hint.hidden = false;
}

/** Fatura de cada parcela/recorrência: a primeira pela regra de fechamento, as outras nas faturas seguintes. */
function faturaRefDaParcela(dataBase, cartao, i) {
  return somaMesesRef(faturaDaCompra(dataBase, cartao), i);
}

function guardarUltimoDestino(destino) {
  const v = destino.cartaoId ? `k:${destino.cartaoId}` : (destino.contaId ? `c:${destino.contaId}` : '');
  try { if (v) localStorage.setItem(DESTINO_LOCAL_KEY, v); } catch (e) { /* guardar a preferência é só conforto */ }
}

/* ---------- Aba Contas ---------- */

function renderContasTudo() {
  if (!state.recursoContas) return;
  popularFiltroConta();
  renderContasTab();
  renderTransferencias();
  renderFatura();
}

function renderContasTab() {
  const ativas = contasAtivas();
  const cartoes = cartoesAtivos();
  const hoje = hojeIso();

  const saldoTotal = arredonda(ativas.reduce((s, c) => s + saldoDaConta(c, hoje), 0));
  const aPagar = arredonda(cartoes.reduce((s, k) => s + limiteUsado(k), 0));
  $id('contas-resumo').innerHTML = `
    <div class="contas-resumo-item">
      <small>Saldo em contas</small>
      <strong class="${saldoTotal < 0 ? 'negativo' : ''}">${formatCurrency(saldoTotal)}</strong>
    </div>
    <div class="contas-resumo-item">
      <small>A pagar nos cartões</small>
      <strong>${formatCurrency(aPagar)}</strong>
    </div>`;

  const grid = $id('contas-grid');
  grid.innerHTML = ativas.length ? ativas.map(c => {
    const saldo = saldoDaConta(c, hoje);
    return `
      <article class="conta-card" data-conta="${c.id}" tabindex="0" role="button" aria-label="Ver lançamentos de ${escapeHtml(c.nome)}">
        <div class="conta-topo">
          <span class="conta-ico"><svg viewBox="0 0 24 24">${ICONES_TIPO_CONTA[c.tipo] || ICONES_TIPO_CONTA.outro}</svg></span>
          <div class="conta-nome"><strong>${escapeHtml(c.nome)}</strong><small>${TIPOS_CONTA[c.tipo] || 'Conta'}</small></div>
          <button type="button" class="icon-btn conta-editar" data-editar-conta="${c.id}" aria-label="Editar ${escapeHtml(c.nome)}"><svg viewBox="0 0 24 24">${ICONE_EDITAR}</svg></button>
        </div>
        <span class="conta-saldo ${saldo < 0 ? 'negativo' : ''}">${formatCurrency(saldo)}</span>
        <small class="conta-info">Considera só lançamentos pagos até hoje</small>
      </article>`;
  }).join('') : '<p class="vazio-contas">Nenhuma conta ainda. Crie a primeira para ligar seus lançamentos.</p>';

  const cartoesGrid = $id('cartoes-grid');
  cartoesGrid.innerHTML = cartoes.length ? cartoes.map(k => {
    const ref = faturaEmFoco(k);
    const status = statusDaFaturaDoCartao(k, ref);
    const total = totalDaFatura(k.id, ref);
    const usado = limiteUsado(k);
    const pct = k.limite > 0 ? Math.min(100, (usado / k.limite) * 100) : 0;
    const titulo = status === 'aberta' ? 'Fatura atual' : (status === 'vencida' ? 'Fatura vencida' : 'Fatura fechada');
    return `
      <article class="cartao-card" data-cartao="${k.id}" tabindex="0" role="button" aria-label="Abrir a fatura do cartão ${escapeHtml(k.nome)}">
        <div class="cartao-topo">
          <strong>${escapeHtml(k.nome)}</strong>
          <button type="button" class="icon-btn conta-editar" data-editar-cartao="${k.id}" aria-label="Editar ${escapeHtml(k.nome)}"><svg viewBox="0 0 24 24">${ICONE_EDITAR}</svg></button>
        </div>
        <div class="cartao-fatura">
          <small class="${status === 'vencida' ? 'alerta' : ''}">${titulo} · vence ${diaMes(vencimentoDaFatura(ref, k))}</small>
          <span class="cartao-valor">${formatCurrency(total)}</span>
        </div>
        <div class="limite-barra"><span class="${pct >= 90 ? 'cheio' : ''}" style="width:${pct.toFixed(1)}%"></span></div>
        <div class="cartao-limite"><span>Disponível ${formatCurrency(Math.max(0, k.limite - usado))}</span><span>Limite ${formatCurrency(k.limite)}</span></div>
        <small class="cartao-rodape">Melhor dia de compra ${k.melhorDiaCompra} · vence dia ${k.diaVencimento}</small>
      </article>`;
  }).join('') : '<p class="vazio-contas">Nenhum cartão ainda. Cadastre o limite, o melhor dia de compra e o vencimento para acompanhar a fatura.</p>';

  const arqContas = state.contas.filter(c => c.arquivada);
  const arqCartoes = state.cartoes.filter(k => k.arquivado);
  const det = $id('arquivados');
  det.hidden = !(arqContas.length || arqCartoes.length);
  $id('arquivados-titulo').textContent = `Arquivados (${arqContas.length + arqCartoes.length})`;
  $id('arquivados-lista').innerHTML =
    arqContas.map(c => `<div class="arquivado-item"><span>${escapeHtml(c.nome)} <small>conta</small></span><button type="button" class="btn btn-ghost" data-reativar-conta="${c.id}">Reativar</button></div>`).join('') +
    arqCartoes.map(k => `<div class="arquivado-item"><span>${escapeHtml(k.nome)} <small>cartão</small></span><button type="button" class="btn btn-ghost" data-reativar-cartao="${k.id}">Reativar</button></div>`).join('');
}

function irParaLancamentosDaConta(valorFiltro) {
  $id('filter-conta').value = valorFiltro;
  $id('filter-tipo').value = '';
  $id('filter-categoria').value = '';
  $id('search-lanc').value = '';
  switchTab('lancamentos');
}

/* ---------- Transferências entre contas ---------- */

const ICONE_TRANSFERENCIA = '<path d="M7 7h13l-3-3M17 17H4l3 3"/>';
const TRANSFERENCIAS_VISIVEIS = 8;
let editandoTransfId = null;

function renderTransferencias() {
  const bloco = $id('transferencias-bloco');
  if (!state.recursoTransf) return;
  const lista = [...state.transferencias].sort((a, b) => b.data.localeCompare(a.data));
  bloco.hidden = !lista.length;
  if (!lista.length) return;
  const nome = (id) => { const c = contaPorId(id); return c ? c.nome : 'conta removida'; };
  $id('transf-lista').innerHTML = lista.slice(0, TRANSFERENCIAS_VISIVEIS).map(t => `
    <div class="transf-item" data-transf="${t.id}" tabindex="0" role="button" aria-label="Editar transferência">
      <span class="transf-ico"><svg viewBox="0 0 24 24">${ICONE_TRANSFERENCIA}</svg></span>
      <div class="transf-texto">
        <strong>${escapeHtml(nome(t.contaOrigemId))} &rarr; ${escapeHtml(nome(t.contaDestinoId))}</strong>
        <small>${formatDateDisplay(t.data)}${t.descricao ? ' · ' + escapeHtml(t.descricao) : ''}${t.data > hojeIso() ? ' · agendada' : ''}</small>
      </div>
      <span class="transf-valor">${formatCurrency(t.valor)}</span>
    </div>`).join('') +
    (lista.length > TRANSFERENCIAS_VISIVEIS ? `<p class="transf-mais">Mostrando as ${TRANSFERENCIAS_VISIVEIS} mais recentes de ${lista.length}.</p>` : '');
}

function popularSelectsTransferencia(origemSel, destinoSel) {
  const montar = (sel, valor) => {
    sel.innerHTML = '';
    const ativas = contasAtivas();
    ativas.forEach(c => sel.appendChild(new Option(`${c.nome} — saldo ${formatCurrency(saldoDaConta(c))}`, c.id)));
    const atual = valor && contaPorId(valor);
    if (atual && atual.arquivada) sel.appendChild(new Option(`${atual.nome} (arquivada)`, atual.id));
    sel.value = valor && [...sel.options].some(o => o.value === valor) ? valor : (sel.options[0] ? sel.options[0].value : '');
  };
  montar($id('transf-origem'), origemSel);
  montar($id('transf-destino'), destinoSel);
}

function abrirTransferenciaModal(id) {
  if (!state.recursoTransf) return;
  const t = id ? state.transferencias.find(x => x.id === id) : null;
  if (!t && contasAtivas().length < 2) { showToast('Para transferir, crie pelo menos duas contas.'); return; }
  editandoTransfId = t ? t.id : null;
  $id('form-transferencia').reset();
  $id('modal-transferencia-title').textContent = t ? 'Editar transferência' : 'Transferir entre contas';
  const ativas = contasAtivas();
  // Sugestão: da conta com mais dinheiro para a seguinte.
  const origemPadrao = t ? t.contaOrigemId : ([...ativas].sort((a, b) => saldoDaConta(b) - saldoDaConta(a))[0] || {}).id;
  const destinoPadrao = t ? t.contaDestinoId : (ativas.find(c => c.id !== origemPadrao) || {}).id;
  popularSelectsTransferencia(origemPadrao, destinoPadrao);
  $id('transf-id').value = t ? t.id : '';
  $id('transf-valor').value = t ? t.valor : '';
  $id('transf-data').value = t ? t.data : hojeIso();
  $id('transf-descricao').value = t ? t.descricao : '';
  $id('btn-excluir-transf').hidden = !t;
  atualizarDicaTransferencia();
  openModal('modal-transferencia');
}

/** Mostra como ficam os dois saldos depois da transferência (sem contar a própria, se estiver editando). */
function atualizarDicaTransferencia() {
  const dica = $id('transf-dica');
  const origem = contaPorId($id('transf-origem').value), destino = contaPorId($id('transf-destino').value);
  const valor = arredonda(parseFloat($id('transf-valor').value) || 0);
  if (!origem || !destino) return;
  if (origem.id === destino.id) { dica.textContent = 'Escolha duas contas diferentes.'; return; }
  const data = $id('transf-data').value || hojeIso();
  const sem = state.transferencias.filter(x => x.id !== editandoTransfId);
  const guardadas = state.transferencias; state.transferencias = sem;
  const so = saldoDaConta(origem, data > hojeIso() ? data : hojeIso()), sd = saldoDaConta(destino, data > hojeIso() ? data : hojeIso());
  state.transferencias = guardadas;
  if (!valor) { dica.textContent = 'Mover dinheiro entre as suas contas não conta como receita nem como despesa: só muda o saldo das duas.'; return; }
  dica.textContent = `Depois: ${origem.nome} ${formatCurrency(arredonda(so - valor))}${so - valor < 0 ? ' (negativo)' : ''} · ${destino.nome} ${formatCurrency(arredonda(sd + valor))}. Não conta como receita nem despesa.`;
}

async function salvarTransferencia(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const campos = {
    conta_origem_id: $id('transf-origem').value,
    conta_destino_id: $id('transf-destino').value,
    valor: arredonda(parseFloat($id('transf-valor').value) || 0),
    data: $id('transf-data').value,
    descricao: $id('transf-descricao').value.trim() || null,
  };
  if (campos.conta_origem_id === campos.conta_destino_id) { showToast('Escolha duas contas diferentes.'); return; }
  if (!(campos.valor > 0)) { showToast('Informe um valor maior que zero.'); return; }
  btn.disabled = true;
  try {
    if (editandoTransfId) {
      const { data, error } = await supabaseClient.from('transferencias').update(campos).eq('id', editandoTransfId).select().single();
      if (error) throw error;
      state.transferencias[state.transferencias.findIndex(x => x.id === editandoTransfId)] = rowToTransferencia(data);
      showToast('Transferência atualizada');
    } else {
      const { data, error } = await supabaseClient.from('transferencias').insert({ user_id: session.user.id, ...campos }).select().single();
      if (error) throw error;
      state.transferencias.push(rowToTransferencia(data));
      showToast('Transferência feita');
    }
    closeModal('modal-transferencia');
    haptic();
    renderAll();
  } catch (err) {
    showToast('Erro ao salvar a transferência: ' + err.message);
  }
  btn.disabled = false;
}

function pedirExcluirTransferencia() {
  const t = state.transferencias.find(x => x.id === editandoTransfId);
  if (!t) return;
  closeModal('modal-transferencia');
  pedirConfirmacao(`Excluir esta transferência de ${formatCurrency(t.valor)}? O dinheiro volta para a conta de origem.`, async () => {
    const { error } = await supabaseClient.from('transferencias').delete().eq('id', t.id);
    if (error) { showToast('Erro ao excluir: ' + error.message); return; }
    state.transferencias = state.transferencias.filter(x => x.id !== t.id);
    showToast('Transferência excluída');
    renderAll();
  });
}

/* ---------- Conta: criar, editar, arquivar, excluir ---------- */

let editandoContaId = null;

function abrirContaModal(id) {
  editandoContaId = id;
  $id('form-conta').reset();
  const conta = id ? contaPorId(id) : null;
  $id('modal-conta-title').textContent = conta ? 'Editar conta' : 'Nova conta';
  $id('conta-id').value = conta ? conta.id : '';
  $id('conta-nome').value = conta ? conta.nome : '';
  $id('conta-tipo').value = conta ? conta.tipo : 'corrente';
  $id('conta-saldo').value = conta ? saldoDaConta(conta) : '';
  $id('conta-saldo-label').textContent = conta ? 'Saldo atual (R$)' : 'Quanto tem nela hoje? (R$)';
  const botao = $id('btn-excluir-conta');
  botao.hidden = !conta;
  if (conta) botao.textContent = contaTemMovimento(conta.id) ? 'Arquivar' : 'Excluir';
  openModal('modal-conta');
}

async function salvarConta(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const nome = $id('conta-nome').value.trim();
  const tipo = $id('conta-tipo').value;
  const saldoDigitado = arredonda(parseFloat($id('conta-saldo').value) || 0);
  if (state.contas.some(c => c.id !== editandoContaId && c.nome.toLowerCase() === nome.toLowerCase())) {
    showToast('Já existe uma conta com esse nome.');
    return;
  }
  btn.disabled = true;
  try {
    if (editandoContaId) {
      const conta = contaPorId(editandoContaId);
      // O usuário informa o saldo que quer ver; o inicial é ajustado pra o cálculo fechar nesse número.
      const saldoInicial = arredonda(saldoDigitado - movimentoDaConta(conta.id));
      const { data, error } = await supabaseClient.from('contas')
        .update({ nome, tipo, saldo_inicial: saldoInicial }).eq('id', conta.id).select().single();
      if (error) throw error;
      state.contas[state.contas.findIndex(c => c.id === conta.id)] = rowToConta(data);
      showToast('Conta atualizada');
    } else {
      const { data, error } = await supabaseClient.from('contas')
        .insert({ user_id: session.user.id, nome, tipo, saldo_inicial: saldoDigitado }).select().single();
      if (error) throw error;
      state.contas.push(rowToConta(data));
      showToast('Conta criada');
    }
    closeModal('modal-conta');
    haptic();
    renderAll();
  } catch (err) {
    showToast('Erro ao salvar a conta: ' + err.message);
  }
  btn.disabled = false;
}

async function arquivarConta(id, arquivada) {
  const { data, error } = await supabaseClient.from('contas').update({ arquivada }).eq('id', id).select().single();
  if (error) { showToast('Erro: ' + error.message); return; }
  state.contas[state.contas.findIndex(c => c.id === id)] = rowToConta(data);
  showToast(arquivada ? 'Conta arquivada' : 'Conta reativada');
  renderAll();
}

async function excluirConta(id) {
  const { error } = await supabaseClient.from('contas').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir: ' + error.message); return; }
  state.contas = state.contas.filter(c => c.id !== id);
  showToast('Conta excluída');
  renderAll();
}

function pedirExcluirOuArquivarConta() {
  const conta = contaPorId(editandoContaId);
  if (!conta) return;
  closeModal('modal-conta');
  if (contaTemMovimento(conta.id)) {
    if (contasAtivas().length <= 1 && !conta.arquivada) {
      showToast('Esta é a sua única conta. Crie outra antes de arquivar.');
      return;
    }
    pedirConfirmacao(`"${conta.nome}" tem lançamentos, então não dá para excluir sem perdê-los de vista. Arquivar tira a conta das listas, mas guarda todo o histórico.`,
      () => arquivarConta(conta.id, true), { titulo: 'Arquivar conta', botao: 'Arquivar', neutro: true });
  } else {
    pedirConfirmacao(`Excluir a conta "${conta.nome}"?`, () => excluirConta(conta.id));
  }
}

/* ---------- Cartão: criar, editar, arquivar, excluir ---------- */

let editandoCartaoId = null;

function popularContasDoCartao(selecionada) {
  const sel = $id('cartao-conta');
  sel.innerHTML = '<option value="">Escolher na hora de pagar</option>';
  contasAtivas().forEach(c => sel.appendChild(new Option(c.nome, c.id)));
  sel.value = [...sel.options].some(o => o.value === selecionada) ? selecionada : '';
}

function abrirCartaoModal(id) {
  editandoCartaoId = id;
  $id('form-cartao').reset();
  const cartao = id ? cartaoPorId(id) : null;
  $id('modal-cartao-title').textContent = cartao ? 'Editar cartão' : 'Novo cartão';
  $id('cartao-id').value = cartao ? cartao.id : '';
  $id('cartao-nome').value = cartao ? cartao.nome : '';
  $id('cartao-limite').value = cartao ? cartao.limite : '';
  $id('cartao-melhor-dia').value = cartao ? cartao.melhorDiaCompra : '';
  $id('cartao-vencimento').value = cartao ? cartao.diaVencimento : '';
  popularContasDoCartao(cartao ? cartao.contaPagamentoId : (contasAtivas()[0] ? contasAtivas()[0].id : ''));
  const botao = $id('btn-excluir-cartao');
  botao.hidden = !cartao;
  if (cartao) botao.textContent = cartaoTemMovimento(cartao.id) ? 'Arquivar' : 'Excluir';
  atualizarDicaDiasCartao();
  prepararVincularAntigos(cartao);
  openModal('modal-cartao');
}

/** Explica em palavras o que os dois dias significam, com o exemplo de uma compra de hoje. */
function atualizarDicaDiasCartao() {
  const melhor = parseInt($id('cartao-melhor-dia').value, 10);
  const venc = parseInt($id('cartao-vencimento').value, 10);
  const dica = $id('cartao-dica');
  if (!melhor || !venc || melhor < 1 || melhor > 31 || venc < 1 || venc > 31) {
    dica.textContent = 'Compras feitas a partir do melhor dia de compra entram só na fatura seguinte. É o dado que o app do seu banco mostra com esse nome.';
    return;
  }
  const cartao = { melhorDiaCompra: melhor, diaVencimento: venc };
  const ref = faturaDaCompra(hojeIso(), cartao);
  dica.textContent = `Uma compra de hoje entra na fatura de ${rotuloDaFatura(ref)} (fecha ${diaMes(fechamentoDaFatura(ref, cartao))}, vence ${diaMes(vencimentoDaFatura(ref, cartao))}). ` +
    (melhor === 1 ? 'Com melhor dia 1, a fatura fecha no último dia do mês.' : `A fatura fecha no dia ${diaDeFechamento(cartao)}, um dia antes do melhor dia.`);
}

async function salvarCartao(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const nome = $id('cartao-nome').value.trim();
  const campos = {
    nome,
    limite: arredonda(parseFloat($id('cartao-limite').value) || 0),
    melhor_dia_compra: parseInt($id('cartao-melhor-dia').value, 10),
    dia_vencimento: parseInt($id('cartao-vencimento').value, 10),
    conta_pagamento_id: $id('cartao-conta').value || null,
  };
  if (!(campos.melhor_dia_compra >= 1 && campos.melhor_dia_compra <= 31 && campos.dia_vencimento >= 1 && campos.dia_vencimento <= 31)) {
    showToast('O melhor dia de compra e o vencimento vão de 1 a 31.');
    return;
  }
  if (state.cartoes.some(k => k.id !== editandoCartaoId && k.nome.toLowerCase() === nome.toLowerCase())) {
    showToast('Já existe um cartão com esse nome.');
    return;
  }
  btn.disabled = true;
  try {
    if (editandoCartaoId) {
      const { data, error } = await supabaseClient.from('cartoes').update(campos).eq('id', editandoCartaoId).select().single();
      if (error) throw error;
      state.cartoes[state.cartoes.findIndex(k => k.id === editandoCartaoId)] = rowToCartao(data);
      // Mudar o melhor dia/vencimento vale só daqui pra frente: as compras já lançadas mantêm a fatura em que caíram.
      showToast('Cartão atualizado');
      closeModal('modal-cartao');
    } else {
      const { data, error } = await supabaseClient.from('cartoes').insert({ user_id: session.user.id, ...campos }).select().single();
      if (error) throw error;
      const novo = rowToCartao(data);
      state.cartoes.push(novo);
      closeModal('modal-cartao');
      // Se há compras antigas no crédito, oferece trazê-las já: reabre o cartão com essa opção à vista.
      if (candidatosAVincular().length) {
        showToast('Cartão criado. Achei compras antigas no crédito: veja se quer trazê-las para este cartão.', 5000);
        abrirCartaoModal(novo.id);
      } else {
        showToast('Cartão criado');
      }
    }
    haptic();
    renderAll();
  } catch (err) {
    showToast('Erro ao salvar o cartão: ' + err.message);
  }
  btn.disabled = false;
}

async function arquivarCartao(id, arquivado) {
  const { data, error } = await supabaseClient.from('cartoes').update({ arquivado }).eq('id', id).select().single();
  if (error) { showToast('Erro: ' + error.message); return; }
  state.cartoes[state.cartoes.findIndex(k => k.id === id)] = rowToCartao(data);
  showToast(arquivado ? 'Cartão arquivado' : 'Cartão reativado');
  renderAll();
}

async function excluirCartao(id) {
  const { error } = await supabaseClient.from('cartoes').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir: ' + error.message); return; }
  state.cartoes = state.cartoes.filter(k => k.id !== id);
  state.faturas = state.faturas.filter(f => f.cartaoId !== id);
  showToast('Cartão excluído');
  renderAll();
}

function pedirExcluirOuArquivarCartao() {
  const cartao = cartaoPorId(editandoCartaoId);
  if (!cartao) return;
  closeModal('modal-cartao');
  if (cartaoTemMovimento(cartao.id)) {
    pedirConfirmacao(`"${cartao.nome}" tem compras lançadas. Arquivar tira o cartão das listas e do formulário, mas guarda todo o histórico das faturas.`,
      () => arquivarCartao(cartao.id, true), { titulo: 'Arquivar cartão', botao: 'Arquivar', neutro: true });
  } else {
    pedirConfirmacao(`Excluir o cartão "${cartao.nome}"?`, () => excluirCartao(cartao.id));
  }
}

/* ---------- Trazer lançamentos antigos para um cartão ---------- */

/** Despesas antigas sem cartão, agrupadas pela forma de pagamento, com as parecidas com "crédito" primeiro. */
function candidatosAVincular() {
  const grupos = {};
  for (const l of state.lancamentos) {
    if (l.tipo !== 'despesa' || l.cartaoId) continue;
    grupos[l.formaPagamento] = (grupos[l.formaPagamento] || 0) + 1;
  }
  return Object.entries(grupos)
    .map(([forma, qtd]) => ({ forma, qtd, credito: /cr[eé]dito/i.test(forma) }))
    .sort((a, b) => (b.credito - a.credito) || (b.qtd - a.qtd));
}

function prepararVincularAntigos(cartao) {
  const bloco = $id('vincular-antigos');
  const candidatos = candidatosAVincular();
  bloco.hidden = !cartao || !candidatos.length;
  if (bloco.hidden) return;
  const sel = $id('vincular-forma');
  sel.innerHTML = '';
  candidatos.forEach(c => sel.appendChild(new Option(`${c.forma} (${c.qtd} ${c.qtd === 1 ? 'lançamento' : 'lançamentos'})`, c.forma)));
}

async function vincularAntigos() {
  const cartao = cartaoPorId(editandoCartaoId);
  const forma = $id('vincular-forma').value;
  if (!cartao || !forma) return;
  const alvo = state.lancamentos.filter(l => l.tipo === 'despesa' && !l.cartaoId && l.formaPagamento === forma);
  if (!alvo.length) { showToast('Nenhum lançamento para vincular.'); return; }
  const pagarVencidas = $id('vincular-pagar-vencidas').checked;

  const btn = $id('btn-vincular');
  btn.disabled = true;
  try {
    const porRef = {};
    for (const l of alvo) (porRef[faturaDaCompra(l.data, cartao)] = porRef[faturaDaCompra(l.data, cartao)] || []).push(l.id);

    for (const [ref, ids] of Object.entries(porRef)) {
      for (let i = 0; i < ids.length; i += 100) {
        const parte = ids.slice(i, i + 100);
        const { data, error } = await supabaseClient.from('lancamentos')
          .update({ cartao_id: cartao.id, fatura_ref: ref, conta_id: null }).in('id', parte).select();
        if (error) throw error;
        data.forEach(r => {
          const idx = state.lancamentos.findIndex(x => x.id === r.id);
          if (idx >= 0) state.lancamentos[idx] = rowToLancamento(r);
        });
      }
    }

    let marcadas = 0;
    if (pagarVencidas) {
      const hoje = hojeIso();
      const novas = Object.keys(porRef)
        .filter(ref => vencimentoDaFatura(ref, cartao) < hoje && !pagamentoDaFatura(cartao.id, ref))
        .map(ref => ({
          user_id: session.user.id, cartao_id: cartao.id, referencia: ref,
          valor_pago: totalDaFatura(cartao.id, ref), pago_em: vencimentoDaFatura(ref, cartao), conta_id: null,
        }));
      if (novas.length) {
        const { data, error } = await supabaseClient.from('faturas').insert(novas).select();
        if (error) throw error;
        data.forEach(r => state.faturas.push(rowToFatura(r)));
        marcadas = novas.length;
      }
    }
    showToast(`${alvo.length} ${alvo.length === 1 ? 'lançamento vinculado' : 'lançamentos vinculados'}` +
      (marcadas ? `; ${marcadas} ${marcadas === 1 ? 'fatura antiga marcada' : 'faturas antigas marcadas'} como paga` : ''), 4500);
    haptic();
    renderAll();
    prepararVincularAntigos(cartao);
  } catch (err) {
    showToast('Erro ao vincular: ' + err.message);
  }
  btn.disabled = false;
}

/* ---------- Tela da fatura ---------- */

let faturaAberta = null; // { cartaoId, ref }

function abrirFatura(cartaoId, ref) {
  const cartao = cartaoPorId(cartaoId);
  if (!cartao) return;
  faturaAberta = { cartaoId, ref: ref || faturaEmFoco(cartao) };
  switchTab('fatura');
}

function renderFatura() {
  if (!faturaAberta) return;
  const cartao = cartaoPorId(faturaAberta.cartaoId);
  if (!cartao) { faturaAberta = null; return; }
  const ref = faturaAberta.ref;
  const total = totalDaFatura(cartao.id, ref);
  const pagamento = pagamentoDaFatura(cartao.id, ref);
  const status = statusDaFaturaDoCartao(cartao, ref);
  const usado = limiteUsado(cartao);
  const pct = cartao.limite > 0 ? Math.min(100, (usado / cartao.limite) * 100) : 0;

  $id('fatura-cartao-nome').textContent = `Cartão ${cartao.nome}`;
  $id('fatura-titulo').textContent = `Fatura de ${rotuloDaFatura(ref)}`;
  $id('fatura-total').textContent = formatCurrency(total);
  $id('fatura-fecha').textContent = formatDateDisplay(fechamentoDaFatura(ref, cartao));
  $id('fatura-vence').textContent = formatDateDisplay(vencimentoDaFatura(ref, cartao));

  const chip = $id('fatura-status');
  chip.className = `fatura-status status-${status}`;
  chip.textContent = status === 'paga' && pagamento
    ? `Paga em ${formatDateDisplay(pagamento.pagoEm)}`
    : (status === 'aberta' ? `Aberta · fecha ${diaMes(fechamentoDaFatura(ref, cartao))}` : (status === 'fechada' ? `Fechada · vence ${diaMes(vencimentoDaFatura(ref, cartao))}` : 'Vencida'));

  $id('fatura-limite-usado').textContent = formatCurrency(usado);
  $id('fatura-limite-barra').style.width = `${pct.toFixed(1)}%`;
  $id('fatura-limite-barra').className = pct >= 90 ? 'cheio' : '';
  $id('fatura-limite-disponivel').textContent = `Disponível ${formatCurrency(Math.max(0, cartao.limite - usado))}`;
  $id('fatura-limite-total').textContent = `de ${formatCurrency(cartao.limite)}`;

  const aviso = $id('fatura-aviso');
  if (pagamento && Math.abs(pagamento.valorPago - total) > 0.005) {
    aviso.textContent = `O total mudou depois do pagamento: foram pagos ${formatCurrency(pagamento.valorPago)} e as compras agora somam ${formatCurrency(total)}.`;
    aviso.hidden = false;
  } else if (pagamento && !pagamento.contaId) {
    aviso.textContent = 'Marcada como paga sem debitar de nenhuma conta.';
    aviso.hidden = false;
  } else {
    aviso.hidden = true;
  }

  $id('btn-pagar-fatura').hidden = !!pagamento || total <= 0;
  $id('btn-desfazer-pagamento').hidden = !pagamento;

  const lancs = lancamentosDaFatura(cartao.id, ref).sort((a, b) => b.data.localeCompare(a.data));
  $id('fatura-lista').innerHTML = lancs.length ? lancs.map(l => `
    <div class="fatura-item" data-lanc="${l.id}" tabindex="0" role="button">
      ${iconeCategoriaHtml(l.categoria, l.descricao)}
      <div class="fatura-item-texto"><strong>${escapeHtml(l.descricao)}</strong><small>${diaMes(l.data)} · ${escapeHtml(l.categoria)}</small></div>
      <span class="fatura-item-valor">${formatCurrency(l.valor)}</span>
    </div>`).join('') : '<p class="vazio-contas">Nenhuma compra nesta fatura.</p>';
}

function navegarFatura(delta) {
  if (!faturaAberta) return;
  faturaAberta.ref = somaMesesRef(faturaAberta.ref, delta);
  renderFatura();
}

/* ---------- Pagar fatura ---------- */

function abrirPagarFatura() {
  if (!faturaAberta) return;
  const cartao = cartaoPorId(faturaAberta.cartaoId);
  const ref = faturaAberta.ref;
  const total = totalDaFatura(cartao.id, ref);
  if (total <= 0) return;

  $id('pagar-cartao').textContent = `Cartão ${cartao.nome}`;
  $id('pagar-valor').textContent = formatCurrency(total);
  $id('pagar-ref').textContent = `Fatura de ${rotuloDaFatura(ref)} · vence ${formatDateDisplay(vencimentoDaFatura(ref, cartao))}`;
  $id('pagar-data').value = hojeIso();

  const sel = $id('pagar-conta');
  sel.innerHTML = '';
  contasAtivas().forEach(c => sel.appendChild(new Option(`${c.nome} — saldo ${formatCurrency(saldoDaConta(c))}`, c.id)));
  sel.appendChild(new Option('Não debitar de nenhuma conta (só marcar como paga)', ''));
  const padrao = cartao.contaPagamentoId && contasAtivas().some(c => c.id === cartao.contaPagamentoId) ? cartao.contaPagamentoId : (contasAtivas()[0] ? contasAtivas()[0].id : '');
  sel.value = padrao;
  atualizarDicaPagamento();
  openModal('modal-pagar-fatura');
}

function atualizarDicaPagamento() {
  if (!faturaAberta) return;
  const total = totalDaFatura(faturaAberta.cartaoId, faturaAberta.ref);
  const conta = contaPorId($id('pagar-conta').value);
  const hint = $id('pagar-conta-hint');
  if (!conta) { hint.textContent = 'O saldo das contas não muda; a fatura só fica marcada como paga.'; return; }
  const depois = arredonda(saldoDaConta(conta) - total);
  hint.textContent = `Saldo de ${conta.nome} depois do pagamento: ${formatCurrency(depois)}${depois < 0 ? ' (ficará negativo)' : ''}.`;
}

async function confirmarPagamentoFatura(e) {
  e.preventDefault();
  if (!faturaAberta) return;
  const btn = e.target.querySelector('button[type="submit"]');
  const { cartaoId, ref } = faturaAberta;
  const total = totalDaFatura(cartaoId, ref);
  btn.disabled = true;
  try {
    const { data, error } = await supabaseClient.from('faturas').insert({
      user_id: session.user.id, cartao_id: cartaoId, referencia: ref,
      valor_pago: total, pago_em: $id('pagar-data').value, conta_id: $id('pagar-conta').value || null,
    }).select().single();
    if (error) throw error;
    state.faturas.push(rowToFatura(data));
    closeModal('modal-pagar-fatura');
    showToast('Fatura paga');
    haptic();
    renderAll();
  } catch (err) {
    showToast('Erro ao pagar a fatura: ' + err.message);
  }
  btn.disabled = false;
}

function pedirDesfazerPagamento() {
  if (!faturaAberta) return;
  const pagamento = pagamentoDaFatura(faturaAberta.cartaoId, faturaAberta.ref);
  if (!pagamento) return;
  const conta = pagamento.contaId && contaPorId(pagamento.contaId);
  pedirConfirmacao(`A fatura volta a ficar em aberto${conta ? ` e ${formatCurrency(pagamento.valorPago)} voltam para ${conta.nome}` : ''}. Desfazer o pagamento?`,
    async () => {
      const { error } = await supabaseClient.from('faturas').delete().eq('id', pagamento.id);
      if (error) { showToast('Erro: ' + error.message); return; }
      state.faturas = state.faturas.filter(f => f.id !== pagamento.id);
      showToast('Pagamento desfeito');
      renderAll();
    }, { titulo: 'Desfazer pagamento', botao: 'Desfazer', neutro: true });
}

/* ---------- Tempo real ---------- */

function atualizarLista(lista, payload, converter) {
  if (payload.eventType === 'DELETE') return lista.filter(x => x.id !== payload.old.id);
  const novo = converter(payload.new);
  const idx = lista.findIndex(x => x.id === novo.id);
  if (idx >= 0) { const copia = [...lista]; copia[idx] = novo; return copia; }
  return [...lista, novo];
}

/** Encaixa as três tabelas novas no canal de tempo real que o app.js já abre. */
function adicionarRealtimeContas(canal, filtro) {
  canal = canal
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contas', filter: filtro }, (p) => {
      state.contas = atualizarLista(state.contas, p, rowToConta);
      renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cartoes', filter: filtro }, (p) => {
      state.cartoes = atualizarLista(state.cartoes, p, rowToCartao);
      renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'faturas', filter: filtro }, (p) => {
      state.faturas = atualizarLista(state.faturas, p, rowToFatura);
      renderAll();
    });
  return state.recursoTransf ? canal.on('postgres_changes', { event: '*', schema: 'public', table: 'transferencias', filter: filtro }, (p) => {
    state.transferencias = atualizarLista(state.transferencias, p, rowToTransferencia);
    renderAll();
  }) : canal;
}

/* ---------- Ligações dos botões ---------- */

function initContas() {
  $id('btn-nova-conta').addEventListener('click', () => abrirContaModal(null));
  $id('btn-transferir').addEventListener('click', () => abrirTransferenciaModal(null));
  $id('form-transferencia').addEventListener('submit', salvarTransferencia);
  $id('btn-excluir-transf').addEventListener('click', pedirExcluirTransferencia);
  ['transf-origem', 'transf-destino', 'transf-data'].forEach(id => $id(id).addEventListener('change', atualizarDicaTransferencia));
  $id('transf-valor').addEventListener('input', atualizarDicaTransferencia);
  $id('btn-novo-cartao').addEventListener('click', () => {
    if (!contasAtivas().length) { showToast('Crie uma conta antes, para poder pagar a fatura.'); return; }
    abrirCartaoModal(null);
  });
  $id('form-conta').addEventListener('submit', salvarConta);
  $id('btn-excluir-conta').addEventListener('click', pedirExcluirOuArquivarConta);
  $id('form-cartao').addEventListener('submit', salvarCartao);
  $id('btn-excluir-cartao').addEventListener('click', pedirExcluirOuArquivarCartao);
  $id('btn-vincular').addEventListener('click', vincularAntigos);
  $id('cartao-melhor-dia').addEventListener('input', atualizarDicaDiasCartao);
  $id('cartao-vencimento').addEventListener('input', atualizarDicaDiasCartao);

  const aoAtivar = (e, fn) => { if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

  const cliqueContas = (e) => {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    const editarConta = e.target.closest('[data-editar-conta]');
    if (editarConta) { e.stopPropagation(); abrirContaModal(editarConta.dataset.editarConta); return; }
    const editarCartao = e.target.closest('[data-editar-cartao]');
    if (editarCartao) { e.stopPropagation(); abrirCartaoModal(editarCartao.dataset.editarCartao); return; }
    const reativarConta = e.target.closest('[data-reativar-conta]');
    if (reativarConta) { arquivarConta(reativarConta.dataset.reativarConta, false); return; }
    const reativarCartao = e.target.closest('[data-reativar-cartao]');
    if (reativarCartao) { arquivarCartao(reativarCartao.dataset.reativarCartao, false); return; }
    const transf = e.target.closest('[data-transf]');
    if (transf) { e.preventDefault(); abrirTransferenciaModal(transf.dataset.transf); return; }
    const cartao = e.target.closest('[data-cartao]');
    if (cartao) { e.preventDefault(); abrirFatura(cartao.dataset.cartao); return; }
    const conta = e.target.closest('[data-conta]');
    if (conta) { e.preventDefault(); irParaLancamentosDaConta(`c:${conta.dataset.conta}`); }
  };
  $id('tab-contas').addEventListener('click', cliqueContas);
  $id('tab-contas').addEventListener('keydown', cliqueContas);

  $id('btn-fatura-voltar').addEventListener('click', () => switchTab('contas'));
  $id('btn-fatura-anterior').addEventListener('click', () => navegarFatura(-1));
  $id('btn-fatura-proxima').addEventListener('click', () => navegarFatura(1));
  $id('btn-pagar-fatura').addEventListener('click', abrirPagarFatura);
  $id('btn-desfazer-pagamento').addEventListener('click', pedirDesfazerPagamento);
  $id('btn-compra-cartao').addEventListener('click', () => { if (faturaAberta) openLancamentoModal(null, { destino: `k:${faturaAberta.cartaoId}` }); });
  $id('fatura-lista').addEventListener('click', (e) => { const item = e.target.closest('[data-lanc]'); if (item) openLancamentoModal(item.dataset.lanc); });
  $id('fatura-lista').addEventListener('keydown', (e) => { const item = e.target.closest('[data-lanc]'); if (item) aoAtivar(e, () => openLancamentoModal(item.dataset.lanc)); });
  $id('pagar-conta').addEventListener('change', atualizarDicaPagamento);
  $id('form-pagar-fatura').addEventListener('submit', confirmarPagamentoFatura);

  // Campo "Conta ou cartão" do formulário de lançamento
  $id('lanc-conta').addEventListener('change', aoMudarDestinoLancamento);
  $id('lanc-tipo').addEventListener('change', aoMudarTipoLancamento);
  $id('lanc-data').addEventListener('change', atualizarDicaFatura);
  $id('lanc-valor').addEventListener('input', atualizarDicaFatura);
  $id('lanc-repeticao').addEventListener('change', atualizarDicaFatura);
  $id('lanc-repeticao-qtd').addEventListener('input', atualizarDicaFatura);
  $id('filter-conta').addEventListener('change', () => renderLancamentos());
}
