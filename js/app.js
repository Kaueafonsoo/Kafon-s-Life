/* ===================================================================
   GRANA — Finanças
   Dados salvos na nuvem (Supabase), protegidos por login. Cada usuário só
   enxerga os próprios lançamentos, orçamentos e metas (Row Level Security).
   =================================================================== */

const CATEGORIAS_PADRAO = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Assinaturas', 'Outros'];
const FORMAS_PADRAO = ['Dinheiro', 'Cartão de Débito', 'Cartão de Crédito', 'Pix', 'Transferência', 'Boleto', 'Outro'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const EMOJIS_META = ['🎯', '🛡️', '✈️', '🏠', '🚗', '🎓', '💍', '🖥️', '🏋️', '🎸', '🐶', '🎁'];

const VALOR_OCULTO = 'R$ •••••';

/* ---------- Estado ---------- */

let state = {
  config: { nome: '', diaPagamento: null, privacidade: false, tema: 'claro' },
  categorias: [...CATEGORIAS_PADRAO],
  formasPagamento: [...FORMAS_PADRAO],
  lancamentos: [],
  orcamentos: {},
  metas: [],
  desejos: [],
};

const PRIORIDADE_ORDEM = { alta: 0, media: 1, baixa: 2 };

let supabaseClient = null;
let session = null;
let appStarted = false;
let authMode = 'entrar';

let currentDate = new Date();
let currentYear = currentDate.getFullYear();
let currentMonth = currentDate.getMonth(); // 0-11
let sortState = { field: 'data', dir: 'desc' };
let evolucaoMeses = 12;
let editingLancId = null;
let editingMetaId = null;
let editingDesejoId = null;
const statAnimStart = new WeakMap(); // guarda o último valor exibido de cada elemento, pra animar a partir dali

/* ---------- Conversão linha do banco <-> objeto usado na tela ---------- */

function rowToLancamento(r) {
  return {
    id: r.id, data: r.data, descricao: r.descricao, categoria: r.categoria,
    tipo: r.tipo, formaPagamento: r.forma_pagamento, valor: Number(r.valor), status: r.status,
  };
}

function rowToMeta(r) {
  return {
    id: r.id, emoji: r.emoji || '🎯', nome: r.nome,
    valorMeta: Number(r.valor_meta), valorAtual: Number(r.valor_atual), dataPrevista: r.data_prevista,
  };
}

function rowToDesejo(r) {
  return {
    id: r.id, nome: r.nome, preco: Number(r.preco), prioridade: r.prioridade,
    link: r.link || '', comprado: !!r.comprado,
  };
}

/* ---------- Carregar tudo do Supabase ---------- */

async function fetchAllData() {
  const uid = session.user.id;

  const [lancRes, orcRes, metaRes, desejoRes, cfgRes] = await Promise.all([
    supabaseClient.from('lancamentos').select('*').order('data', { ascending: false }),
    supabaseClient.from('orcamentos').select('*'),
    supabaseClient.from('metas').select('*').order('created_at', { ascending: true }),
    supabaseClient.from('wishlist').select('*').order('created_at', { ascending: true }),
    supabaseClient.from('config').select('*').maybeSingle(),
  ]);

  for (const res of [lancRes, orcRes, metaRes, desejoRes, cfgRes]) {
    if (res.error) throw res.error;
  }

  state.lancamentos = (lancRes.data || []).map(rowToLancamento);

  state.orcamentos = {};
  (orcRes.data || []).forEach(r => { state.orcamentos[r.categoria] = Number(r.valor_planejado); });

  state.metas = (metaRes.data || []).map(rowToMeta);
  state.desejos = (desejoRes.data || []).map(rowToDesejo);

  let cfg = cfgRes.data;
  if (!cfg) {
    // Primeiro login deste usuário: cria a linha de config com os padrões.
    const { data: novaCfg, error } = await supabaseClient
      .from('config')
      .insert({ user_id: uid })
      .select()
      .single();
    if (error) throw error;
    cfg = novaCfg;
  }

  state.config = { nome: cfg.nome || '', diaPagamento: cfg.dia_pagamento, privacidade: !!cfg.privacidade, tema: cfg.tema || 'claro' };
  state.categorias = (cfg.categorias && cfg.categorias.length) ? cfg.categorias : [...CATEGORIAS_PADRAO];
  state.formasPagamento = (cfg.formas_pagamento && cfg.formas_pagamento.length) ? cfg.formas_pagamento : [...FORMAS_PADRAO];
}

/* ---------- Utilitários de formatação ---------- */

/** Respeita o modo privacidade: todo valor exibido na tela passa por aqui. */
function formatCurrency(value) {
  if (state.config.privacidade) return VALOR_OCULTO;
  return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Versão curta pra rótulos de eixo (R$ 5,2 mil em vez de R$ 5.200,00). */
function formatCompactCurrency(value) {
  if (state.config.privacidade) return '•••';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

/** Anima um valor em R$ subindo/descendo do último número exibido até o novo, em vez de trocar de uma vez. */
function animateStatValue(el, targetValue) {
  if (state.config.privacidade) {
    el.textContent = VALOR_OCULTO;
    statAnimStart.set(el, targetValue);
    return;
  }
  const startValue = statAnimStart.get(el) ?? 0;
  statAnimStart.set(el, targetValue);
  if (startValue === targetValue) {
    el.textContent = formatCurrency(targetValue);
    return;
  }
  const duration = 500;
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = startValue + (targetValue - startValue) * eased;
    el.textContent = current.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = formatCurrency(targetValue);
  }
  requestAnimationFrame(tick);
}

/** Vibração leve pra confirmar uma ação no iPhone — silencioso em navegadores sem suporte. */
function haptic(duration = 12) {
  if (navigator.vibrate) navigator.vibrate(duration);
}

function formatDateDisplay(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function monthLabel(year, month) {
  return `${MESES[month]} ${year}`;
}

/* ---------- Consultas de dados ---------- */

function getLancamentosForMonth(year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  return state.lancamentos.filter(l => l.data.startsWith(prefix));
}

function computeTotals(lancs) {
  let receitas = 0, despesas = 0;
  for (const l of lancs) {
    if (l.tipo === 'receita') receitas += l.valor;
    else despesas += l.valor;
  }
  return { receitas, despesas, saldo: receitas - despesas };
}

function computeCategoriaBreakdown(lancs) {
  const map = {};
  for (const l of lancs) {
    if (l.tipo !== 'despesa') continue;
    map[l.categoria] = (map[l.categoria] || 0) + l.valor;
  }
  return Object.entries(map)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/** Saldo acumulado mês a mês (evolução patrimonial), desde o lançamento mais antigo até o mês de referência,
    recortado para os últimos `count` meses — assim o acumulado do início do recorte já reflete o histórico todo. */
function computeNetWorthEvolution(refYear, refMonth, count) {
  let cursorY = refYear, cursorM = refMonth;
  if (state.lancamentos.length) {
    const [y0, m0] = state.lancamentos.reduce((min, l) => l.data < min ? l.data : min, state.lancamentos[0].data).split('-');
    cursorY = parseInt(y0, 10);
    cursorM = parseInt(m0, 10) - 1;
  }
  let acumulado = 0;
  const porMes = [];
  while (cursorY < refYear || (cursorY === refYear && cursorM <= refMonth)) {
    acumulado += computeTotals(getLancamentosForMonth(cursorY, cursorM)).saldo;
    porMes.push({ label: `${MESES_ABREV[cursorM]}/${String(cursorY).slice(2)}`, saldo: acumulado });
    cursorM++;
    if (cursorM > 11) { cursorM = 0; cursorY++; }
  }
  return porMes.slice(-count);
}

/* ---------- Saudação ---------- */

function renderGreeting() {
  const el = document.getElementById('greeting');
  const nome = (state.config.nome || '').trim();
  if (!nome) { el.textContent = ''; el.hidden = true; return; }

  const h = new Date().getHours();
  let periodo = 'Boa noite';
  if (h >= 5 && h < 12) periodo = 'Bom dia';
  else if (h >= 12 && h < 18) periodo = 'Boa tarde';

  el.textContent = `${periodo}, ${nome}`;
  el.hidden = false;
}

/* ---------- Modo privacidade ---------- */

const OLHO_ABERTO = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>';
const OLHO_FECHADO = '<path d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 5.2A9.5 9.5 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4.1M6.2 6.9A17 17 0 002 12s3.6 7 10 7c1.4 0 2.6-.2 3.7-.6"/>';

function renderPrivacidade() {
  const on = state.config.privacidade;
  const btn = document.getElementById('btn-privacidade');
  document.getElementById('icon-privacidade').innerHTML = on ? OLHO_FECHADO : OLHO_ABERTO;
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-label', on ? 'Mostrar valores' : 'Ocultar valores');
  btn.title = on ? 'Mostrar valores' : 'Ocultar valores';
}

async function togglePrivacidade() {
  state.config.privacidade = !state.config.privacidade;
  renderAll();
  showToast(state.config.privacidade ? 'Valores ocultos' : 'Valores visíveis');
  const { error } = await supabaseClient
    .from('config')
    .update({ privacidade: state.config.privacidade })
    .eq('user_id', session.user.id);
  if (error) showToast('Não consegui salvar essa preferência agora');
}

/* ---------- Modo claro / escuro ---------- */

const TEMA_LOCAL_KEY = 'grana_tema';

/** Só aplica o tema na tela — não mexe em estado nem salva nada. */
function aplicarTema(tema) {
  document.documentElement.dataset.theme = tema === 'escuro' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', tema === 'escuro' ? '#0F0D0B' : '#FDFDFC');
  document.querySelectorAll('#tema-toggle button').forEach(b => b.classList.toggle('is-active', b.dataset.tema === tema));
}

async function alternarTema(tema) {
  if (tema === state.config.tema) return;
  state.config.tema = tema;
  aplicarTema(tema);
  // Guarda localmente pra próxima abertura já nascer no tema certo, sem esperar
  // o Supabase responder (evita o flash de um tema errado por uma fração de segundo).
  localStorage.setItem(TEMA_LOCAL_KEY, tema);
  const { error } = await supabaseClient
    .from('config')
    .update({ tema })
    .eq('user_id', session.user.id);
  if (error) showToast('Não consegui salvar essa preferência agora');
}

function initTemaToggle() {
  document.getElementById('tema-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tema]');
    if (btn) alternarTema(btn.dataset.tema);
  });
}

/* ---------- Contagem para o salário ---------- */

function renderPayday() {
  const card = document.getElementById('payday-card');
  const dia = state.config.diaPagamento;
  const hoje = new Date();
  const vendoMesAtual = currentYear === hoje.getFullYear() && currentMonth === hoje.getMonth();

  if (!dia || dia < 1 || dia > 31 || !vendoMesAtual) { card.hidden = true; return; }

  // Próximo pagamento: neste mês se ainda não passou, senão no mês seguinte.
  const diaHoje = hoje.getDate();
  let ano = hoje.getFullYear(), mes = hoje.getMonth();
  if (diaHoje >= dia) { mes += 1; if (mes > 11) { mes = 0; ano += 1; } }
  const ultimoDiaDoMes = new Date(ano, mes + 1, 0).getDate();
  const proximo = new Date(ano, mes, Math.min(dia, ultimoDiaDoMes));

  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dias = Math.round((proximo - inicioHoje) / 86400000);

  const { saldo } = computeTotals(getLancamentosForMonth(currentYear, currentMonth));
  const porDia = dias > 0 ? saldo / dias : saldo;

  document.getElementById('payday-days').textContent = dias === 1 ? '1 dia' : `${dias} dias`;
  document.getElementById('payday-days-label').textContent = 'até o próximo salário';

  const perDayEl = document.getElementById('payday-perday');
  perDayEl.textContent = formatCurrency(Math.max(porDia, 0));
  perDayEl.classList.toggle('is-negative', saldo < 0);

  card.hidden = false;
}

/* ---------- Insight automático ---------- */

/** Compara o total de despesas do mês exibido com o mês anterior e aponta a categoria que mais pesou. */
function computeInsight(year, month) {
  const atual = computeTotals(getLancamentosForMonth(year, month));
  let py = year, pm = month - 1;
  if (pm < 0) { pm = 11; py -= 1; }
  const anterior = computeTotals(getLancamentosForMonth(py, pm));

  if (anterior.despesas <= 0) return null; // sem base de comparação

  const variacao = ((atual.despesas - anterior.despesas) / anterior.despesas) * 100;
  if (Math.abs(variacao) < 1) return null; // variação pequena demais para valer destaque

  const catAtual = computeCategoriaBreakdown(getLancamentosForMonth(year, month));
  const catAnteriorMap = {};
  computeCategoriaBreakdown(getLancamentosForMonth(py, pm)).forEach(c => { catAnteriorMap[c.label] = c.value; });

  let maiorAumento = null;
  catAtual.forEach(c => {
    const diff = c.value - (catAnteriorMap[c.label] || 0);
    if (diff > 0 && (!maiorAumento || diff > maiorAumento.diff)) maiorAumento = { categoria: c.label, diff };
  });

  const sinal = variacao > 0 ? 'a mais' : 'a menos';
  let texto = `Você gastou <strong>${Math.abs(variacao).toFixed(0)}% ${sinal}</strong> do que em ${MESES[pm]}`;
  if (maiorAumento && variacao > 0) {
    texto += `, principalmente em <strong>${escapeHtml(maiorAumento.categoria)}</strong> (+${formatCurrency(maiorAumento.diff)})`;
  }
  return texto + '.';
}

function renderInsight() {
  const card = document.getElementById('insight-card');
  if (state.config.privacidade) { card.hidden = true; return; }

  const texto = computeInsight(currentYear, currentMonth);
  if (!texto) { card.hidden = true; return; }
  document.getElementById('insight-texto').innerHTML = texto;
  card.hidden = false;
}

/* ---------- Navegação por abas ---------- */

const TAB_TITLES = { resumo: 'Resumo Mensal', lancamentos: 'Lançamentos', orcamento: 'Orçamento', metas: 'Metas', desejos: 'Desejos' };

function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('is-active'));
  document.getElementById('tab-' + tab).classList.add('is-active');

  document.querySelectorAll('.nav-item[data-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tabbar-item[data-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));

  document.getElementById('page-title').textContent = TAB_TITLES[tab];
  // Metas e Desejos não são por mês; esconde de vez para não deixar espaço vazio no layout.
  document.getElementById('month-switcher').hidden = (tab === 'metas' || tab === 'desejos');

  renderAll();
}

function initTabNav() {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

/* ---------- Seletor de mês ---------- */

function initMonthSwitcher() {
  document.getElementById('month-prev').addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderAll();
  });
  document.getElementById('month-next').addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderAll();
  });
}

function renderMonthLabel() {
  document.getElementById('month-label').textContent = monthLabel(currentYear, currentMonth);
}

function initEvolucaoToggle() {
  document.getElementById('evolucao-range').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-meses]');
    if (!btn) return;
    evolucaoMeses = parseInt(btn.dataset.meses, 10);
    document.querySelectorAll('#evolucao-range button').forEach(b => b.classList.toggle('is-active', b === btn));
    renderResumo();
  });
}

function initEvolucaoHelp() {
  const btn = document.getElementById('btn-evolucao-help');
  const pop = document.getElementById('evolucao-help-popover');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  pop.querySelector('[data-close-help]').addEventListener('click', () => { pop.hidden = true; });
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true;
  });
}

/* ---------- Render: Resumo Mensal ---------- */

function renderResumo() {
  const lancs = getLancamentosForMonth(currentYear, currentMonth);
  const { receitas, despesas, saldo } = computeTotals(lancs);

  animateStatValue(document.getElementById('stat-receitas'), receitas);
  animateStatValue(document.getElementById('stat-despesas'), despesas);
  const saldoEl = document.getElementById('stat-saldo');
  animateStatValue(saldoEl, saldo);
  saldoEl.classList.toggle('positive', saldo >= 0);
  saldoEl.classList.toggle('negative', saldo < 0);

  renderInsight();
  renderPayday();

  const breakdown = computeCategoriaBreakdown(lancs);
  renderPieChart(document.getElementById('chart-pie'), breakdown);
  renderPieLegend(document.getElementById('legend-pie'), breakdown);

  const evolucao = computeNetWorthEvolution(currentYear, currentMonth, evolucaoMeses);
  renderAreaChart(document.getElementById('chart-bar'), evolucao);
}

/* ---------- Render: Lançamentos ---------- */

function populateCategoriaSelects() {
  const filterSel = document.getElementById('filter-categoria');
  const formSel = document.getElementById('lanc-categoria');
  const catAtual = formSel.value, filtroAtual = filterSel.value;

  filterSel.innerHTML = '<option value="">Todas categorias</option>';
  formSel.innerHTML = '';
  state.categorias.forEach(cat => {
    filterSel.appendChild(new Option(cat, cat));
    formSel.appendChild(new Option(cat, cat));
  });
  if (state.categorias.includes(catAtual)) formSel.value = catAtual;
  if (state.categorias.includes(filtroAtual)) filterSel.value = filtroAtual;

  const formaSel = document.getElementById('lanc-forma');
  const formaAtual = formaSel.value;
  formaSel.innerHTML = '';
  state.formasPagamento.forEach(f => formaSel.appendChild(new Option(f, f)));
  if (state.formasPagamento.includes(formaAtual)) formaSel.value = formaAtual;
}

function getFilteredSortedLancamentos() {
  let lancs = getLancamentosForMonth(currentYear, currentMonth);

  const search = document.getElementById('search-lanc').value.trim().toLowerCase();
  const catFilter = document.getElementById('filter-categoria').value;
  const tipoFilter = document.getElementById('filter-tipo').value;

  if (search) lancs = lancs.filter(l => l.descricao.toLowerCase().includes(search));
  if (catFilter) lancs = lancs.filter(l => l.categoria === catFilter);
  if (tipoFilter) lancs = lancs.filter(l => l.tipo === tipoFilter);

  const { field, dir } = sortState;
  lancs = [...lancs].sort((a, b) => {
    let av = a[field], bv = b[field];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
  return lancs;
}

function renderLancamentos() {
  const tbody = document.getElementById('lanc-tbody');
  const lancs = getFilteredSortedLancamentos();
  tbody.innerHTML = '';

  document.getElementById('lanc-empty').hidden = lancs.length > 0;
  document.getElementById('lanc-table').hidden = lancs.length === 0;

  for (const l of lancs) {
    const tr = document.createElement('tr');
    tr.dataset.id = l.id;
    tr.innerHTML = `
      <td class="col-date">${formatDateDisplay(l.data)}</td>
      <td class="col-desc">${escapeHtml(l.descricao)}</td>
      <td class="col-cat"><span class="cat-pill">${escapeHtml(l.categoria)}</span></td>
      <td class="col-tipo"><span class="badge badge-${l.tipo}">${l.tipo === 'receita' ? 'Receita' : 'Despesa'}</span></td>
      <td class="col-forma">${escapeHtml(l.formaPagamento)}</td>
      <td class="valor-cell valor-${l.tipo}">${l.tipo === 'despesa' ? '−' : '+'} ${formatCurrency(l.valor)}</td>
      <td class="col-status"><span class="badge badge-${l.status}">${l.status === 'pago' ? 'Pago' : 'Pendente'}</span></td>
      <td class="col-actions">
        <button class="row-delete-btn" data-delete-id="${l.id}" aria-label="Excluir">
          <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0l1 13h10l1-13"/></svg>
        </button>
      </td>`;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete-id]')) return;
      openLancamentoModal(tr.dataset.id);
    });
  });
  tbody.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      pedirConfirmacao('Excluir este lançamento?', () => deleteLancamento(btn.dataset.deleteId));
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function initLancamentosTab() {
  populateCategoriaSelects();

  document.getElementById('search-lanc').addEventListener('input', renderLancamentos);
  document.getElementById('filter-categoria').addEventListener('change', renderLancamentos);
  document.getElementById('filter-tipo').addEventListener('change', renderLancamentos);

  document.getElementById('btn-novo-lancamento').addEventListener('click', () => openLancamentoModal(null));
  document.getElementById('btn-novo-lancamento-empty').addEventListener('click', () => openLancamentoModal(null));
  document.getElementById('fab-novo-lancamento').addEventListener('click', () => openLancamentoModal(null));

  document.querySelectorAll('.lanc-table thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sortState.field === field) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      else sortState = { field, dir: 'asc' };
      renderLancamentos();
    });
  });

  document.getElementById('form-lancamento').addEventListener('submit', onSubmitLancamento);
  document.getElementById('btn-excluir-lancamento').addEventListener('click', () => {
    if (!editingLancId) return;
    const id = editingLancId;
    pedirConfirmacao('Excluir este lançamento?', () => { deleteLancamento(id); closeModal('modal-lancamento'); });
  });

  document.getElementById('lanc-repeticao').addEventListener('change', updateRepeticaoUI);
  document.getElementById('lanc-tipo').addEventListener('change', updateRepeticaoTipoUI);
  document.getElementById('lanc-repeticao-qtd').addEventListener('input', updateRepeticaoFim);
  document.getElementById('lanc-data').addEventListener('change', updateRepeticaoFim);
}

function openLancamentoModal(id) {
  editingLancId = id;
  const form = document.getElementById('form-lancamento');
  form.reset();

  if (id) {
    const l = state.lancamentos.find(x => x.id === id);
    document.getElementById('modal-lancamento-title').textContent = 'Editar lançamento';
    document.getElementById('lanc-id').value = l.id;
    document.getElementById('lanc-data').value = l.data;
    document.getElementById('lanc-descricao').value = l.descricao;
    document.getElementById('lanc-tipo').value = l.tipo;
    // A categoria/forma pode ter sido removida nos Ajustes depois do lançamento.
    setSelectValue('lanc-categoria', l.categoria);
    setSelectValue('lanc-forma', l.formaPagamento);
    document.getElementById('lanc-status').value = l.status;
    document.getElementById('lanc-valor').value = l.valor;
    document.getElementById('btn-excluir-lancamento').hidden = false;
    // Editar um lançamento existente mexe só nele — não recria a série.
    document.getElementById('lanc-repeticao-section').hidden = true;
  } else {
    document.getElementById('modal-lancamento-title').textContent = 'Novo lançamento';
    document.getElementById('lanc-id').value = '';
    const iso = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(Math.min(new Date().getDate(), 28)).padStart(2, '0')}`;
    document.getElementById('lanc-data').value = iso;
    document.getElementById('btn-excluir-lancamento').hidden = true;
    document.getElementById('lanc-repeticao-section').hidden = false;
    document.getElementById('lanc-repeticao').value = 'nenhuma';
    updateRepeticaoTipoUI();
    updateRepeticaoUI();
  }
  openModal('modal-lancamento');
}

/** Seleciona o valor; se ele não existe mais na lista, adiciona uma opção temporária. */
function setSelectValue(selectId, value) {
  const sel = document.getElementById(selectId);
  if (![...sel.options].some(o => o.value === value)) {
    sel.appendChild(new Option(value + ' (removida)', value));
  }
  sel.value = value;
}

/** Soma N meses a uma data ISO (aaaa-mm-dd), ajustando o dia se o mês de destino for mais curto. */
function addMonthsToIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  let totalMonths = (m - 1) + n;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const ultimoDia = new Date(targetYear, targetMonth + 1, 0).getDate();
  const targetDay = Math.min(d, ultimoDia);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

/** Mostra/esconde o campo de quantidade e ajusta o texto conforme "recorrente" ou "parcelado". */
function updateRepeticaoUI() {
  const modo = document.getElementById('lanc-repeticao').value;
  const wrap = document.getElementById('lanc-repeticao-qtd-wrap');
  const label = document.getElementById('lanc-repeticao-qtd-label');
  const qtd = document.getElementById('lanc-repeticao-qtd');
  const hint = document.getElementById('lanc-repeticao-hint');

  if (modo === 'nenhuma') {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  if (modo === 'recorrente') {
    label.textContent = 'Por quantos meses';
    qtd.value = 12;
    hint.textContent = 'Cria o mesmo lançamento nos próximos meses. Cada um pode ser editado ou excluído depois, sem afetar os outros.';
  } else {
    label.textContent = 'Em quantas parcelas';
    qtd.value = 2;
    hint.textContent = 'O valor digitado é dividido igualmente entre as parcelas, uma por mês.';
  }
  updateRepeticaoFim();
}

/** Mostra em qual mês cai a última parcela/recorrência, a partir da data e da quantidade escolhidas. */
function updateRepeticaoFim() {
  const modo = document.getElementById('lanc-repeticao').value;
  const aviso = document.getElementById('lanc-repeticao-fim');
  const dataBase = document.getElementById('lanc-data').value;
  const qtd = parseInt(document.getElementById('lanc-repeticao-qtd').value, 10);

  if (modo === 'nenhuma' || !dataBase || !qtd || qtd < 2) {
    aviso.hidden = true;
    return;
  }

  const dataFim = addMonthsToIso(dataBase, qtd - 1);
  const [anoFim, mesFim] = dataFim.split('-').map(Number);
  const mesTexto = `${MESES[mesFim - 1]} de ${anoFim}`;

  aviso.textContent = modo === 'parcelado'
    ? `Última parcela: ${mesTexto}`
    : `Repete até: ${mesTexto}`;
  aviso.hidden = false;
}

/** "Parcelado" só faz sentido para despesa; esconde a opção quando o tipo é receita. */
function updateRepeticaoTipoUI() {
  const tipo = document.getElementById('lanc-tipo').value;
  const optParcelado = document.getElementById('opt-parcelado');
  const sel = document.getElementById('lanc-repeticao');
  optParcelado.hidden = (tipo === 'receita');
  if (tipo === 'receita' && sel.value === 'parcelado') {
    sel.value = 'nenhuma';
    updateRepeticaoUI();
  }
}

async function onSubmitLancamento(e) {
  e.preventDefault();
  const id = document.getElementById('lanc-id').value;
  const btn = e.target.querySelector('button[type="submit"]');

  const dataBase = document.getElementById('lanc-data').value;
  const descricaoBase = document.getElementById('lanc-descricao').value.trim();
  const valorBase = parseFloat(document.getElementById('lanc-valor').value) || 0;
  const payloadBase = {
    tipo: document.getElementById('lanc-tipo').value,
    categoria: document.getElementById('lanc-categoria').value,
    forma_pagamento: document.getElementById('lanc-forma').value,
    status: document.getElementById('lanc-status').value,
  };
  const modoRepeticao = id ? 'nenhuma' : document.getElementById('lanc-repeticao').value;
  const qtd = Math.max(1, parseInt(document.getElementById('lanc-repeticao-qtd').value, 10) || 1);

  btn.disabled = true;
  try {
    if (id) {
      const payload = { ...payloadBase, data: dataBase, descricao: descricaoBase, valor: valorBase };
      const { data, error } = await supabaseClient.from('lancamentos').update(payload).eq('id', id).select().single();
      if (error) throw error;
      const idx = state.lancamentos.findIndex(x => x.id === id);
      state.lancamentos[idx] = rowToLancamento(data);
      showToast('Lançamento atualizado');
    } else if (modoRepeticao === 'recorrente' && qtd > 1) {
      const serieId = crypto.randomUUID();
      const rows = [];
      for (let i = 0; i < qtd; i++) {
        rows.push({
          ...payloadBase, user_id: session.user.id, serie_id: serieId,
          data: addMonthsToIso(dataBase, i),
          descricao: descricaoBase,
          valor: valorBase,
        });
      }
      const { data, error } = await supabaseClient.from('lancamentos').insert(rows).select();
      if (error) throw error;
      data.forEach(r => state.lancamentos.push(rowToLancamento(r)));
      showToast(`${qtd} lançamentos recorrentes criados`);
    } else if (modoRepeticao === 'parcelado' && qtd > 1) {
      const serieId = crypto.randomUUID();
      // Divide o valor em partes iguais; a última absorve o resto do arredondamento, para o total fechar exato.
      const parte = Math.floor((valorBase / qtd) * 100) / 100;
      const rows = [];
      let somaParcial = 0;
      for (let i = 0; i < qtd; i++) {
        const isUltima = i === qtd - 1;
        const valorParcela = isUltima ? +(valorBase - somaParcial).toFixed(2) : parte;
        somaParcial += valorParcela;
        rows.push({
          ...payloadBase, user_id: session.user.id, serie_id: serieId,
          data: addMonthsToIso(dataBase, i),
          descricao: `${descricaoBase} (${i + 1}/${qtd})`,
          valor: valorParcela,
        });
      }
      const { data, error } = await supabaseClient.from('lancamentos').insert(rows).select();
      if (error) throw error;
      data.forEach(r => state.lancamentos.push(rowToLancamento(r)));
      showToast(`Despesa parcelada em ${qtd}x`);
    } else {
      const payload = { ...payloadBase, data: dataBase, descricao: descricaoBase, valor: valorBase };
      const { data, error } = await supabaseClient
        .from('lancamentos')
        .insert({ ...payload, user_id: session.user.id })
        .select()
        .single();
      if (error) throw error;
      state.lancamentos.push(rowToLancamento(data));
      showToast('Lançamento adicionado');
    }
    closeModal('modal-lancamento');
    haptic();
    renderAll();
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message);
  }
  btn.disabled = false;
}

async function deleteLancamento(id) {
  const { error } = await supabaseClient.from('lancamentos').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir: ' + error.message); return; }
  state.lancamentos = state.lancamentos.filter(x => x.id !== id);
  showToast('Lançamento excluído');
  renderAll();
}

/* ---------- Render: Orçamento ---------- */

function renderOrcamento() {
  const lancs = getLancamentosForMonth(currentYear, currentMonth);
  const gastoPorCategoria = {};
  for (const l of lancs) {
    if (l.tipo !== 'despesa') continue;
    gastoPorCategoria[l.categoria] = (gastoPorCategoria[l.categoria] || 0) + l.valor;
  }

  const list = document.getElementById('budget-list');
  const oculto = state.config.privacidade;
  list.innerHTML = '';

  state.categorias.forEach(cat => {
    const planejado = state.orcamentos[cat] || 0;
    const gasto = gastoPorCategoria[cat] || 0;
    const pct = planejado > 0 ? (gasto / planejado) * 100 : (gasto > 0 ? 100 : 0);
    let status = 'ok';
    if (pct > 100) status = 'over';
    else if (pct >= 80) status = 'warn';

    const item = document.createElement('div');
    item.className = 'budget-item';
    item.innerHTML = `
      <div class="budget-cat">
        <span class="budget-status-dot ${status}"></span>
        ${escapeHtml(cat)}
      </div>
      <div class="budget-bar-wrap">
        <div class="budget-bar ${status}" style="width:${Math.min(100, pct)}%"></div>
      </div>
      <div class="budget-values">
        <strong>${formatCurrency(gasto)}</strong> de ${formatCurrency(planejado)}
        ${status === 'over' ? `<br><span class="budget-over-note">Estourou ${formatCurrency(gasto - planejado)}</span>` : ''}
      </div>
      <div class="budget-input-wrap">
        <span>R$</span>
        <input type="${oculto ? 'text' : 'number'}" class="budget-input" min="0" step="10"
               value="${oculto ? '•••' : planejado}" data-cat="${escapeHtml(cat)}" ${oculto ? 'readonly' : ''} />
      </div>
    `;
    list.appendChild(item);
  });

  if (oculto) return;
  list.querySelectorAll('.budget-input').forEach(input => {
    input.addEventListener('change', async () => {
      const categoria = input.dataset.cat;
      const valor = parseFloat(input.value) || 0;
      state.orcamentos[categoria] = valor;
      renderOrcamento();
      const { error } = await supabaseClient
        .from('orcamentos')
        .upsert({ user_id: session.user.id, categoria, valor_planejado: valor });
      if (error) showToast('Erro ao salvar orçamento: ' + error.message);
    });
  });
}

/* ---------- Render: Metas ---------- */

function renderMetas() {
  const grid = document.getElementById('goals-grid');
  grid.innerHTML = '';
  document.getElementById('goals-empty').hidden = state.metas.length > 0;

  const today = new Date();

  state.metas.forEach(meta => {
    const pct = meta.valorMeta > 0 ? Math.min(100, (meta.valorAtual / meta.valorMeta) * 100) : 0;
    const deadline = new Date(meta.dataPrevista + 'T00:00:00');
    const daysLeft = Math.ceil((deadline - today) / 86400000);
    let deadlineText = '';
    let deadlineClass = '';
    if (pct >= 100) {
      deadlineText = 'Meta concluída 🎉';
    } else if (daysLeft < 0) {
      deadlineText = `Prazo vencido há ${Math.abs(daysLeft)} dia(s)`;
      deadlineClass = 'goal-deadline-over';
    } else if (daysLeft <= 30) {
      deadlineText = `${daysLeft} dia(s) restantes`;
      deadlineClass = 'goal-deadline-warn';
    } else {
      deadlineText = `${daysLeft} dias restantes`;
    }

    const card = document.createElement('div');
    card.className = 'goal-card';
    card.dataset.id = meta.id;
    card.innerHTML = `
      <div class="goal-header">
        <span class="goal-emoji">${escapeHtml(meta.emoji || '🎯')}</span>
        <span class="goal-name">${escapeHtml(meta.nome)}</span>
        <span class="goal-pct">${pct.toFixed(0)}%</span>
      </div>
      <div class="goal-bar-wrap"><div class="goal-bar" style="width:${pct}%"></div></div>
      <div class="goal-values">
        <span>Atual: <strong>${formatCurrency(meta.valorAtual)}</strong></span>
        <span>Meta: <strong>${formatCurrency(meta.valorMeta)}</strong></span>
      </div>
      <div class="goal-meta-row">
        <span>Previsto: ${formatDateDisplay(meta.dataPrevista)}</span>
        <span class="${deadlineClass}">${deadlineText}</span>
      </div>
    `;
    card.addEventListener('click', () => openMetaModal(meta.id));
    grid.appendChild(card);
  });
}

function initMetasTab() {
  document.getElementById('btn-nova-meta').addEventListener('click', () => openMetaModal(null));
  document.getElementById('btn-nova-meta-empty').addEventListener('click', () => openMetaModal(null));
  document.getElementById('form-meta').addEventListener('submit', onSubmitMeta);
  document.getElementById('btn-excluir-meta').addEventListener('click', () => {
    if (!editingMetaId) return;
    const id = editingMetaId;
    pedirConfirmacao('Excluir esta meta?', () => { deleteMeta(id); closeModal('modal-meta'); });
  });

  const picker = document.getElementById('emoji-picker');
  EMOJIS_META.forEach(em => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emoji-option';
    b.textContent = em;
    b.addEventListener('click', () => selectEmoji(em));
    picker.appendChild(b);
  });
}

function selectEmoji(em) {
  document.getElementById('meta-emoji').value = em;
  document.querySelectorAll('.emoji-option').forEach(b => {
    b.classList.toggle('is-selected', b.textContent === em);
  });
}

function openMetaModal(id) {
  editingMetaId = id;
  const form = document.getElementById('form-meta');
  form.reset();

  if (id) {
    const m = state.metas.find(x => x.id === id);
    document.getElementById('modal-meta-title').textContent = 'Editar meta';
    document.getElementById('meta-id').value = m.id;
    document.getElementById('meta-nome').value = m.nome;
    document.getElementById('meta-valor-meta').value = m.valorMeta;
    document.getElementById('meta-valor-atual').value = m.valorAtual;
    document.getElementById('meta-data').value = m.dataPrevista;
    selectEmoji(m.emoji || '🎯');
    document.getElementById('btn-excluir-meta').hidden = false;
  } else {
    document.getElementById('modal-meta-title').textContent = 'Nova meta';
    document.getElementById('meta-id').value = '';
    document.getElementById('meta-valor-atual').value = 0;
    selectEmoji('🎯');
    document.getElementById('btn-excluir-meta').hidden = true;
  }
  openModal('modal-meta');
}

async function onSubmitMeta(e) {
  e.preventDefault();
  const id = document.getElementById('meta-id').value;
  const btn = e.target.querySelector('button[type="submit"]');
  const payload = {
    emoji: document.getElementById('meta-emoji').value || '🎯',
    nome: document.getElementById('meta-nome').value.trim(),
    valor_meta: parseFloat(document.getElementById('meta-valor-meta').value) || 0,
    valor_atual: parseFloat(document.getElementById('meta-valor-atual').value) || 0,
    data_prevista: document.getElementById('meta-data').value,
  };

  btn.disabled = true;
  try {
    if (id) {
      const { data, error } = await supabaseClient.from('metas').update(payload).eq('id', id).select().single();
      if (error) throw error;
      const idx = state.metas.findIndex(x => x.id === id);
      state.metas[idx] = rowToMeta(data);
      showToast('Meta atualizada');
    } else {
      const { data, error } = await supabaseClient
        .from('metas')
        .insert({ ...payload, user_id: session.user.id })
        .select()
        .single();
      if (error) throw error;
      state.metas.push(rowToMeta(data));
      showToast('Meta criada');
    }
    closeModal('modal-meta');
    haptic();
    renderMetas();
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message);
  }
  btn.disabled = false;
}

async function deleteMeta(id) {
  const { error } = await supabaseClient.from('metas').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir: ' + error.message); return; }
  state.metas = state.metas.filter(x => x.id !== id);
  showToast('Meta excluída');
  renderMetas();
}

/* ---------- Render: Desejos ---------- */

function getSortedDesejos() {
  return [...state.desejos].sort((a, b) => {
    if (a.comprado !== b.comprado) return a.comprado ? 1 : -1;
    return PRIORIDADE_ORDEM[a.prioridade] - PRIORIDADE_ORDEM[b.prioridade];
  });
}

function renderDesejos() {
  const grid = document.getElementById('wishlist-grid');
  grid.innerHTML = '';
  document.getElementById('wishlist-empty').hidden = state.desejos.length > 0;

  const totalDesejado = state.desejos.filter(d => !d.comprado).reduce((s, d) => s + d.preco, 0);
  document.getElementById('wishlist-total').innerHTML = state.desejos.length
    ? `Total desejado: <strong>${formatCurrency(totalDesejado)}</strong>`
    : '';

  const PRIORIDADE_LABEL = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

  getSortedDesejos().forEach(desejo => {
    const card = document.createElement('div');
    card.className = 'wishlist-card' + (desejo.comprado ? ' is-comprado' : '');
    card.dataset.id = desejo.id;
    card.innerHTML = `
      <div class="wishlist-header">
        <span class="wishlist-name">${escapeHtml(desejo.nome)}</span>
        <span class="badge badge-${desejo.prioridade}">${PRIORIDADE_LABEL[desejo.prioridade]}</span>
      </div>
      <div class="wishlist-price">${formatCurrency(desejo.preco)}</div>
      <div class="wishlist-footer">
        <span class="badge ${desejo.comprado ? 'badge-pago' : 'badge-pendente'}">${desejo.comprado ? 'Comprado' : 'Na lista'}</span>
        ${desejo.link ? `
          <a class="wishlist-link" href="${escapeHtml(desejo.link)}" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
            Ver item
          </a>` : '<span></span>'}
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.wishlist-link')) return;
      openDesejoModal(desejo.id);
    });
    grid.appendChild(card);
  });
}

function initDesejosTab() {
  document.getElementById('btn-novo-desejo').addEventListener('click', () => openDesejoModal(null));
  document.getElementById('btn-novo-desejo-empty').addEventListener('click', () => openDesejoModal(null));
  document.getElementById('form-desejo').addEventListener('submit', onSubmitDesejo);
  document.getElementById('btn-excluir-desejo').addEventListener('click', () => {
    if (!editingDesejoId) return;
    const id = editingDesejoId;
    pedirConfirmacao('Excluir este desejo?', () => { deleteDesejo(id); closeModal('modal-desejo'); });
  });
}

function openDesejoModal(id) {
  editingDesejoId = id;
  const form = document.getElementById('form-desejo');
  form.reset();

  if (id) {
    const d = state.desejos.find(x => x.id === id);
    document.getElementById('modal-desejo-title').textContent = 'Editar desejo';
    document.getElementById('desejo-id').value = d.id;
    document.getElementById('desejo-nome').value = d.nome;
    document.getElementById('desejo-preco').value = d.preco;
    document.getElementById('desejo-prioridade').value = d.prioridade;
    document.getElementById('desejo-link').value = d.link;
    document.getElementById('desejo-comprado').checked = d.comprado;
    document.getElementById('btn-excluir-desejo').hidden = false;
  } else {
    document.getElementById('modal-desejo-title').textContent = 'Novo desejo';
    document.getElementById('desejo-id').value = '';
    document.getElementById('btn-excluir-desejo').hidden = true;
  }
  openModal('modal-desejo');
}

async function onSubmitDesejo(e) {
  e.preventDefault();
  const id = document.getElementById('desejo-id').value;
  const btn = e.target.querySelector('button[type="submit"]');
  const payload = {
    nome: document.getElementById('desejo-nome').value.trim(),
    preco: parseFloat(document.getElementById('desejo-preco').value) || 0,
    prioridade: document.getElementById('desejo-prioridade').value,
    link: document.getElementById('desejo-link').value.trim(),
    comprado: document.getElementById('desejo-comprado').checked,
  };

  btn.disabled = true;
  try {
    if (id) {
      const { data, error } = await supabaseClient.from('wishlist').update(payload).eq('id', id).select().single();
      if (error) throw error;
      const idx = state.desejos.findIndex(x => x.id === id);
      state.desejos[idx] = rowToDesejo(data);
      showToast('Desejo atualizado');
    } else {
      const { data, error } = await supabaseClient
        .from('wishlist')
        .insert({ ...payload, user_id: session.user.id })
        .select()
        .single();
      if (error) throw error;
      state.desejos.push(rowToDesejo(data));
      showToast('Desejo adicionado');
    }
    closeModal('modal-desejo');
    haptic();
    renderDesejos();
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message);
  }
  btn.disabled = false;
}

async function deleteDesejo(id) {
  const { error } = await supabaseClient.from('wishlist').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir: ' + error.message); return; }
  state.desejos = state.desejos.filter(x => x.id !== id);
  showToast('Desejo excluído');
  renderDesejos();
}

/* ---------- Ajustes ---------- */

function initAjustes() {
  document.querySelectorAll('.btn-ajustes').forEach(b => b.addEventListener('click', openAjustes));
  document.getElementById('form-ajustes').addEventListener('submit', onSubmitAjustes);
  document.getElementById('btn-restaurar-padrao').addEventListener('click', () => {
    document.getElementById('cfg-categorias').value = CATEGORIAS_PADRAO.join('\n');
    document.getElementById('cfg-formas').value = FORMAS_PADRAO.join('\n');
    showToast('Listas padrão restauradas — salve para aplicar');
  });
}

function openAjustes() {
  document.getElementById('cfg-nome').value = state.config.nome || '';
  document.getElementById('cfg-dia-pagamento').value = state.config.diaPagamento || '';
  document.getElementById('cfg-categorias').value = state.categorias.join('\n');
  document.getElementById('cfg-formas').value = state.formasPagamento.join('\n');
  atualizarBotaoFaceId();
  openModal('modal-ajustes');
}

function parseLinhas(texto) {
  return texto.split('\n').map(s => s.trim()).filter(Boolean);
}

async function onSubmitAjustes(e) {
  e.preventDefault();

  const categorias = parseLinhas(document.getElementById('cfg-categorias').value);
  const formas = parseLinhas(document.getElementById('cfg-formas').value);

  if (!categorias.length || !formas.length) {
    showToast('Categorias e formas de pagamento não podem ficar vazias');
    return;
  }

  const dia = parseInt(document.getElementById('cfg-dia-pagamento').value, 10);
  const payload = {
    nome: document.getElementById('cfg-nome').value.trim(),
    dia_pagamento: (dia >= 1 && dia <= 31) ? dia : null,
    categorias,
    formas_pagamento: formas,
  };

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const { data, error } = await supabaseClient
      .from('config')
      .update(payload)
      .eq('user_id', session.user.id)
      .select()
      .single();
    if (error) throw error;

    state.config.nome = data.nome || '';
    state.config.diaPagamento = data.dia_pagamento;
    state.categorias = data.categorias;
    state.formasPagamento = data.formas_pagamento;

    populateCategoriaSelects();
    closeModal('modal-ajustes');
    haptic();
    renderAll();
    showToast('Ajustes salvos');
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message);
  }
  btn.disabled = false;
}

/* ---------- Trava rápida com Face ID/Touch ID ---------- */
// Trava puramente local: o Supabase já autentica de verdade, isso aqui é só uma
// segunda camada pra ninguém abrir o app com o celular destravado. Por isso o
// desafio do WebAuthn é gerado na hora, sem ida ao servidor, e a credencial fica
// só no localStorage deste aparelho (não sincroniza entre Mac e iPhone).
const FACEID_CRED_KEY = 'grana_faceid_cred';
const FACEID_ENABLED_KEY = 'grana_faceid_enabled';

function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function traduzErroFaceId(err) {
  const nome = err && err.name;
  if (nome === 'NotAllowedError') return 'Não deu tempo ou foi cancelado — tente de novo e confirme o Face ID/Touch ID quando o aparelho pedir.';
  if (nome === 'InvalidStateError') return 'Este aparelho já tem um Face ID cadastrado pro GRANA.';
  if (nome === 'SecurityError') return 'Não deu pra confirmar a identidade deste site com segurança.';
  if (nome === 'NotSupportedError' || nome === 'ConstraintError') return 'Este aparelho não tem um jeito compatível de confirmar com Face ID/Touch ID.';
  return 'Não deu pra ativar agora. Tente de novo.';
}

async function faceIdDisponivel() {
  if (!window.PublicKeyCredential || !navigator.credentials) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function faceIdEstaAtivo() {
  return localStorage.getItem(FACEID_ENABLED_KEY) === '1' && !!localStorage.getItem(FACEID_CRED_KEY);
}

async function ativarFaceId() {
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'GRANA' },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: (session && session.user.email) || 'grana',
          displayName: state.config.nome || 'Você',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
      },
    });
    localStorage.setItem(FACEID_CRED_KEY, bufToBase64(cred.rawId));
    localStorage.setItem(FACEID_ENABLED_KEY, '1');
    showToast('Face ID ativado neste aparelho');
  } catch (err) {
    showToast(traduzErroFaceId(err));
  }
  atualizarBotaoFaceId();
}

function desativarFaceId() {
  localStorage.removeItem(FACEID_CRED_KEY);
  localStorage.removeItem(FACEID_ENABLED_KEY);
  showToast('Face ID desativado');
  atualizarBotaoFaceId();
}

async function atualizarBotaoFaceId() {
  const row = document.getElementById('faceid-row');
  const disponivel = await faceIdDisponivel();
  row.hidden = !disponivel;
  if (!disponivel) return;
  document.getElementById('btn-faceid-toggle').textContent = faceIdEstaAtivo() ? 'Desativar Face ID' : 'Ativar Face ID';
}

function initFaceIdSetting() {
  document.getElementById('btn-faceid-toggle').addEventListener('click', () => {
    if (faceIdEstaAtivo()) desativarFaceId();
    else ativarFaceId();
  });
}

function showLockScreen() {
  document.getElementById('lock-screen').hidden = false;
}
function hideLockScreen() {
  document.getElementById('lock-screen').hidden = true;
}

async function tentarDesbloquear() {
  const credB64 = localStorage.getItem(FACEID_CRED_KEY);
  if (!credB64) { hideLockScreen(); return; }
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: base64ToBuf(credB64), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    if (assertion) hideLockScreen();
  } catch {
    // cancelou ou falhou a verificação — a tela continua travada, com o botão pra tentar de novo
  }
}

function initLockScreen() {
  document.getElementById('btn-lock-unlock').addEventListener('click', tentarDesbloquear);
  document.getElementById('btn-lock-signout').addEventListener('click', async () => {
    hideLockScreen();
    await supabaseClient.auth.signOut();
  });
  // Sem isso a trava só valia pra abertura inicial: alguém trocando de app e
  // voltando pro GRANA em segundo plano encontraria tudo aberto do mesmo jeito.
  // Não tenta desbloquear sozinho ao voltar — só trava; o toque no botão é que
  // dispara o Face ID, porque o navegador exige um gesto do usuário pra isso.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && appStarted && faceIdEstaAtivo()) showLockScreen();
  });
}

/** Chamado logo depois que os dados carregam pela primeira vez (a trava ao
    voltar do segundo plano é tratada à parte, em initLockScreen). */
function checarTravaAoAbrir() {
  if (!faceIdEstaAtivo()) return;
  showLockScreen();
  tentarDesbloquear();
}

/* ---------- Confirmação ---------- */

let confirmarCallback = null;

/** Abre o modal genérico "tem certeza?" e só chama aoConfirmar se o usuário confirmar. */
function pedirConfirmacao(mensagem, aoConfirmar) {
  document.getElementById('confirmar-mensagem').textContent = mensagem;
  confirmarCallback = aoConfirmar;
  openModal('modal-confirmar');
}

function initConfirmModal() {
  document.getElementById('btn-confirmar-exclusao').addEventListener('click', () => {
    const callback = confirmarCallback;
    confirmarCallback = null;
    closeModal('modal-confirmar');
    haptic();
    if (callback) callback();
  });
}

/* ---------- Modais ---------- */

function openModal(id) {
  document.getElementById(id).hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).hidden = true;
  document.body.style.overflow = '';
}
function initModals() {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(o => { if (!o.hidden) closeModal(o.id); });
    }
  });
}

/* ---------- Toast ---------- */

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

/* ---------- Relatório em PDF (via diálogo de impressão do navegador) ---------- */

/** Monta uma view imprimível com o mês corrente e abre o diálogo de impressão —
    de lá o usuário escolhe "Salvar como PDF", sem precisar de biblioteca nenhuma.
    Ignora o modo privacidade: gerar o relatório é uma ação explícita, não faz
    sentido devolver um PDF cheio de "•••••" pro usuário que acabou de pedir por ele. */
function gerarRelatorioPDF() {
  const privacidadeAntes = state.config.privacidade;
  state.config.privacidade = false;
  try {
    montarEImprimirRelatorio();
  } finally {
    state.config.privacidade = privacidadeAntes;
  }
}

function montarEImprimirRelatorio() {
  const lancs = getLancamentosForMonth(currentYear, currentMonth).slice().sort((a, b) => a.data.localeCompare(b.data));
  const { receitas, despesas, saldo } = computeTotals(lancs);
  const breakdown = computeCategoriaBreakdown(lancs);
  const totalDespesas = breakdown.reduce((s, b) => s + b.value, 0);

  const linhasCategorias = breakdown.map(b => `
    <tr><td>${escapeHtml(b.label)}</td><td>${formatCurrency(b.value)}</td><td>${totalDespesas ? ((b.value / totalDespesas) * 100).toFixed(1) : '0.0'}%</td></tr>
  `).join('');

  const linhasLancamentos = lancs.map(l => `
    <tr>
      <td>${formatDateDisplay(l.data)}</td>
      <td>${escapeHtml(l.descricao)}</td>
      <td>${escapeHtml(l.categoria)}</td>
      <td>${l.status === 'pago' ? 'Pago' : 'Pendente'}</td>
      <td class="print-valor ${l.tipo}">${l.tipo === 'receita' ? '+ ' : '− '}${formatCurrency(l.valor)}</td>
    </tr>
  `).join('');

  document.getElementById('print-report').innerHTML = `
    <header class="print-header">
      <span class="print-brand">GRANA</span>
      <h1>${monthLabel(currentYear, currentMonth)}</h1>
    </header>
    <section class="print-summary">
      <div><span>Receitas</span><strong>${formatCurrency(receitas)}</strong></div>
      <div><span>Despesas</span><strong>${formatCurrency(despesas)}</strong></div>
      <div><span>Saldo</span><strong>${formatCurrency(saldo)}</strong></div>
    </section>
    ${breakdown.length ? `
    <section>
      <h2>Gastos por categoria</h2>
      <table><thead><tr><th>Categoria</th><th>Valor</th><th>%</th></tr></thead><tbody>${linhasCategorias}</tbody></table>
    </section>` : ''}
    <section>
      <h2>Lançamentos</h2>
      <table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Status</th><th>Valor</th></tr></thead><tbody>${linhasLancamentos || '<tr><td colspan="5">Nenhum lançamento neste mês.</td></tr>'}</tbody></table>
    </section>
    <footer class="print-footer">Gerado em ${new Date().toLocaleDateString('pt-BR')} pelo GRANA</footer>
  `;
  window.print();
}

/* ---------- Sincronização em tempo real ---------- */
/* Uma alteração feita num aparelho aparece nos outros sem precisar recarregar.
   Os handlers são seguros mesmo quando o evento é eco da própria escrita deste
   aparelho: INSERT só adiciona se o id ainda não existe, UPDATE/DELETE mexem
   só no item daquele id — reaplicar o mesmo dado não duplica nem quebra nada. */

let realtimeChannel = null;

function iniciarRealtime() {
  if (realtimeChannel) return;
  const uid = session.user.id;
  const filtro = `user_id=eq.${uid}`;

  realtimeChannel = supabaseClient
    .channel('grana-mudancas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lancamentos', filter: filtro }, (payload) => {
      if (payload.eventType === 'DELETE') {
        state.lancamentos = state.lancamentos.filter(x => x.id !== payload.old.id);
      } else if (payload.eventType === 'INSERT') {
        if (!state.lancamentos.some(x => x.id === payload.new.id)) state.lancamentos.push(rowToLancamento(payload.new));
      } else {
        const idx = state.lancamentos.findIndex(x => x.id === payload.new.id);
        if (idx >= 0) state.lancamentos[idx] = rowToLancamento(payload.new);
      }
      renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orcamentos', filter: filtro }, (payload) => {
      if (payload.eventType === 'DELETE') delete state.orcamentos[payload.old.categoria];
      else state.orcamentos[payload.new.categoria] = Number(payload.new.valor_planejado);
      renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'metas', filter: filtro }, (payload) => {
      if (payload.eventType === 'DELETE') {
        state.metas = state.metas.filter(x => x.id !== payload.old.id);
      } else if (payload.eventType === 'INSERT') {
        if (!state.metas.some(x => x.id === payload.new.id)) state.metas.push(rowToMeta(payload.new));
      } else {
        const idx = state.metas.findIndex(x => x.id === payload.new.id);
        if (idx >= 0) state.metas[idx] = rowToMeta(payload.new);
      }
      renderMetas();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wishlist', filter: filtro }, (payload) => {
      if (payload.eventType === 'DELETE') {
        state.desejos = state.desejos.filter(x => x.id !== payload.old.id);
      } else if (payload.eventType === 'INSERT') {
        if (!state.desejos.some(x => x.id === payload.new.id)) state.desejos.push(rowToDesejo(payload.new));
      } else {
        const idx = state.desejos.findIndex(x => x.id === payload.new.id);
        if (idx >= 0) state.desejos[idx] = rowToDesejo(payload.new);
      }
      renderDesejos();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'config', filter: filtro }, (payload) => {
      if (payload.eventType === 'DELETE') return;
      const cfg = payload.new;
      state.config = { nome: cfg.nome || '', diaPagamento: cfg.dia_pagamento, privacidade: !!cfg.privacidade, tema: cfg.tema || 'claro' };
      state.categorias = (cfg.categorias && cfg.categorias.length) ? cfg.categorias : [...CATEGORIAS_PADRAO];
      state.formasPagamento = (cfg.formas_pagamento && cfg.formas_pagamento.length) ? cfg.formas_pagamento : [...FORMAS_PADRAO];
      aplicarTema(state.config.tema);
      localStorage.setItem(TEMA_LOCAL_KEY, state.config.tema);
      populateCategoriaSelects();
      renderAll();
    })
    .subscribe();
}

function pararRealtime() {
  if (!realtimeChannel) return;
  supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

/* ---------- Autenticação ---------- */

function showAuthScreen() {
  document.getElementById('auth-screen').hidden = false;
  document.getElementById('app').hidden = true;
}
function hideAuthScreen() {
  document.getElementById('auth-screen').hidden = true;
  document.getElementById('app').hidden = false;
}

function setAuthMode(mode) {
  authMode = mode;
  document.getElementById('auth-title').textContent = mode === 'entrar' ? 'Entrar' : 'Criar conta';
  document.getElementById('auth-submit').textContent = mode === 'entrar' ? 'Entrar' : 'Criar conta';
  document.getElementById('auth-toggle-entrar').classList.toggle('is-active', mode === 'entrar');
  document.getElementById('auth-toggle-cadastro').classList.toggle('is-active', mode === 'cadastrar');
  document.getElementById('auth-message').hidden = true;
}

function traduzErroAuth(msg) {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/user already registered/i.test(msg)) return 'Já existe uma conta com esse e-mail — tente entrar.';
  if (/password should be at least/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/unable to validate email/i.test(msg)) return 'E-mail inválido.';
  if (/email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar — verifique sua caixa de entrada.';
  if (/failed to fetch/i.test(msg)) return 'Sem conexão com o servidor. Verifique sua internet.';
  return msg;
}

async function onSubmitAuth(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const msgEl = document.getElementById('auth-message');
  const btn = document.getElementById('auth-submit');

  msgEl.hidden = true;
  msgEl.classList.remove('auth-message-ok');
  btn.disabled = true;
  try {
    if (authMode === 'entrar') {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        msgEl.textContent = 'Conta criada! Confira seu e-mail para confirmar antes de entrar.';
        msgEl.classList.add('auth-message-ok');
        msgEl.hidden = false;
      }
    }
  } catch (err) {
    msgEl.textContent = traduzErroAuth(err.message);
    msgEl.hidden = false;
  }
  btn.disabled = false;
}

function initAuthScreen() {
  document.getElementById('auth-toggle-entrar').addEventListener('click', () => setAuthMode('entrar'));
  document.getElementById('auth-toggle-cadastro').addEventListener('click', () => setAuthMode('cadastrar'));
  document.getElementById('form-auth').addEventListener('submit', onSubmitAuth);
  document.querySelectorAll('.btn-sair').forEach(b => b.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
  }));
}

/* ---------- Render geral ---------- */

function renderAll() {
  renderGreeting();
  renderPrivacidade();
  renderMonthLabel();
  renderResumo();
  renderLancamentos();
  renderOrcamento();
  renderMetas();
  renderDesejos();
}

/* ---------- Init ---------- */

async function onSessionReady() {
  hideAuthScreen();
  if (appStarted) return; // token apenas renovado; dados já estão carregados
  appStarted = true;
  await carregarDadosIniciais();
}

/** Busca os dados da conta e monta a tela. Separada de onSessionReady pra poder
    ser chamada de novo pelo botão "Tentar novamente" se a primeira vez falhar. */
async function carregarDadosIniciais() {
  document.getElementById('load-error').hidden = true;
  showSkeleton();
  try {
    await fetchAllData();
    aplicarTema(state.config.tema);
    localStorage.setItem(TEMA_LOCAL_KEY, state.config.tema);
    populateCategoriaSelects();
    renderAll();
    iniciarRealtime();
    checarTravaAoAbrir();
    hideSkeleton();
  } catch (err) {
    document.getElementById('skeleton').hidden = true; // esconde o brilho, mas o conteúdo real continua escondido
    document.getElementById('load-error-text').textContent = 'Não deu pra carregar seus dados: ' + err.message;
    document.getElementById('load-error').hidden = false;
  }
}

function initLoadRetry() {
  document.getElementById('btn-retry-load').addEventListener('click', carregarDadosIniciais);
}

function showSkeleton() {
  document.getElementById('skeleton').hidden = false;
  document.querySelector('.content').classList.add('is-loading');
}
function hideSkeleton() {
  document.getElementById('skeleton').hidden = true;
  document.querySelector('.content').classList.remove('is-loading');
}

/** Mostra um aviso na tela de login se js/supabase-config.js não foi preenchido. */
function showConfigError(msg) {
  const el = document.getElementById('auth-config-warning');
  el.textContent = msg;
  el.hidden = false;
  document.getElementById('form-auth').hidden = true;
  document.querySelector('.auth-tabs').hidden = true;
}

function init() {
  // Aplica o último tema conhecido (guardado localmente) antes de qualquer coisa,
  // pra não piscar em claro e só depois trocar pra escuro quando os dados da
  // conta chegarem do Supabase — a leitura de verdade acontece em onSessionReady.
  aplicarTema(localStorage.getItem(TEMA_LOCAL_KEY) || 'claro');

  // A interface é conectada ANTES de tentar falar com o Supabase: uma URL/chave
  // inválida em supabase-config.js não pode deixar a tela inteira sem reação.
  initAuthScreen();
  initTabNav();
  initMonthSwitcher();
  initEvolucaoToggle();
  initEvolucaoHelp();
  initLancamentosTab();
  initMetasTab();
  initDesejosTab();
  initAjustes();
  initModals();
  initConfirmModal();
  initFaceIdSetting();
  initTemaToggle();
  initLoadRetry();
  initLockScreen();
  document.getElementById('btn-privacidade').addEventListener('click', togglePrivacidade);
  document.getElementById('btn-exportar-pdf').addEventListener('click', gerarRelatorioPDF);

  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    showConfigError('Configuração pendente: edite js/supabase-config.js com a URL e a chave do seu projeto Supabase.');
    return;
  }

  supabaseClient.auth.onAuthStateChange((event, newSession) => {
    session = newSession;
    if (session) {
      onSessionReady();
    } else {
      appStarted = false;
      pararRealtime();
      showAuthScreen();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
