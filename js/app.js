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
  config: { nome: '', diaPagamento: null, privacidade: false },
  categorias: [...CATEGORIAS_PADRAO],
  formasPagamento: [...FORMAS_PADRAO],
  lancamentos: [],
  orcamentos: {},
  metas: [],
};

let supabaseClient = null;
let session = null;
let appStarted = false;
let authMode = 'entrar';

let currentDate = new Date();
let currentYear = currentDate.getFullYear();
let currentMonth = currentDate.getMonth(); // 0-11
let sortState = { field: 'data', dir: 'desc' };
let editingLancId = null;
let editingMetaId = null;

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

/* ---------- Carregar tudo do Supabase ---------- */

async function fetchAllData() {
  const uid = session.user.id;

  const [lancRes, orcRes, metaRes, cfgRes] = await Promise.all([
    supabaseClient.from('lancamentos').select('*').order('data', { ascending: false }),
    supabaseClient.from('orcamentos').select('*'),
    supabaseClient.from('metas').select('*').order('created_at', { ascending: true }),
    supabaseClient.from('config').select('*').maybeSingle(),
  ]);

  for (const res of [lancRes, orcRes, metaRes, cfgRes]) {
    if (res.error) throw res.error;
  }

  state.lancamentos = (lancRes.data || []).map(rowToLancamento);

  state.orcamentos = {};
  (orcRes.data || []).forEach(r => { state.orcamentos[r.categoria] = Number(r.valor_planejado); });

  state.metas = (metaRes.data || []).map(rowToMeta);

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

  state.config = { nome: cfg.nome || '', diaPagamento: cfg.dia_pagamento, privacidade: !!cfg.privacidade };
  state.categorias = (cfg.categorias && cfg.categorias.length) ? cfg.categorias : [...CATEGORIAS_PADRAO];
  state.formasPagamento = (cfg.formas_pagamento && cfg.formas_pagamento.length) ? cfg.formas_pagamento : [...FORMAS_PADRAO];
}

/* ---------- Utilitários de formatação ---------- */

/** Respeita o modo privacidade: todo valor exibido na tela passa por aqui. */
function formatCurrency(value) {
  if (state.config.privacidade) return VALOR_OCULTO;
  return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

function computeMonthlyComparison(refYear, refMonth, count = 6) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    let m = refMonth - i, y = refYear;
    while (m < 0) { m += 12; y -= 1; }
    const lancs = getLancamentosForMonth(y, m);
    const t = computeTotals(lancs);
    out.push({ label: `${MESES_ABREV[m]}/${String(y).slice(2)}`, receita: t.receitas, despesa: t.despesas });
  }
  return out;
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

/* ---------- Navegação por abas ---------- */

const TAB_TITLES = { resumo: 'Resumo Mensal', lancamentos: 'Lançamentos', orcamento: 'Orçamento', metas: 'Metas' };

function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('is-active'));
  document.getElementById('tab-' + tab).classList.add('is-active');

  document.querySelectorAll('.nav-item[data-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tabbar-item[data-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));

  document.getElementById('page-title').textContent = TAB_TITLES[tab];
  // Metas não são por mês; esconde de vez para não deixar espaço vazio no layout.
  document.getElementById('month-switcher').hidden = (tab === 'metas');

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

/* ---------- Render: Resumo Mensal ---------- */

function renderResumo() {
  const lancs = getLancamentosForMonth(currentYear, currentMonth);
  const { receitas, despesas, saldo } = computeTotals(lancs);

  document.getElementById('stat-receitas').textContent = formatCurrency(receitas);
  document.getElementById('stat-despesas').textContent = formatCurrency(despesas);
  const saldoEl = document.getElementById('stat-saldo');
  saldoEl.textContent = formatCurrency(saldo);
  saldoEl.classList.toggle('positive', saldo >= 0);
  saldoEl.classList.toggle('negative', saldo < 0);

  renderPayday();

  const breakdown = computeCategoriaBreakdown(lancs);
  renderPieChart(document.getElementById('chart-pie'), breakdown);
  renderPieLegend(document.getElementById('legend-pie'), breakdown);

  const comparison = computeMonthlyComparison(currentYear, currentMonth, 6);
  renderBarChart(document.getElementById('chart-bar'), comparison);
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
      deleteLancamento(btn.dataset.deleteId);
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
    if (editingLancId) { deleteLancamento(editingLancId); closeModal('modal-lancamento'); }
  });
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
  } else {
    document.getElementById('modal-lancamento-title').textContent = 'Novo lançamento';
    document.getElementById('lanc-id').value = '';
    const iso = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(Math.min(new Date().getDate(), 28)).padStart(2, '0')}`;
    document.getElementById('lanc-data').value = iso;
    document.getElementById('btn-excluir-lancamento').hidden = true;
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

async function onSubmitLancamento(e) {
  e.preventDefault();
  const id = document.getElementById('lanc-id').value;
  const btn = e.target.querySelector('button[type="submit"]');
  const payload = {
    data: document.getElementById('lanc-data').value,
    descricao: document.getElementById('lanc-descricao').value.trim(),
    tipo: document.getElementById('lanc-tipo').value,
    categoria: document.getElementById('lanc-categoria').value,
    forma_pagamento: document.getElementById('lanc-forma').value,
    status: document.getElementById('lanc-status').value,
    valor: parseFloat(document.getElementById('lanc-valor').value) || 0,
  };

  btn.disabled = true;
  try {
    if (id) {
      const { data, error } = await supabaseClient.from('lancamentos').update(payload).eq('id', id).select().single();
      if (error) throw error;
      const idx = state.lancamentos.findIndex(x => x.id === id);
      state.lancamentos[idx] = rowToLancamento(data);
      showToast('Lançamento atualizado');
    } else {
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
    if (editingMetaId) { deleteMeta(editingMetaId); closeModal('modal-meta'); }
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
    renderAll();
    showToast('Ajustes salvos');
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message);
  }
  btn.disabled = false;
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

/* ---------- Exportar / Importar (backup local, além da nuvem) ---------- */

function initExportImport() {
  document.querySelectorAll('.btn-export').forEach(btn => btn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `grana-financas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup exportado');
  }));

  const fileInput = document.getElementById('import-file');
  document.querySelectorAll('.btn-import').forEach(btn => btn.addEventListener('click', () => fileInput.click()));
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.lancamentos || !data.metas) throw new Error('formato inválido');
        showToast('Importando...');
        await importarBackup(data);
        populateCategoriaSelects();
        renderAll();
        showToast('Dados importados com sucesso');
      } catch (err) {
        showToast('Falha ao importar: ' + err.message);
      }
      fileInput.value = '';
    };
    reader.readAsText(file);
  });
}

/** Envia um backup .json (de uma exportação anterior) para a conta atual na nuvem. */
async function importarBackup(data) {
  const uid = session.user.id;

  if (Array.isArray(data.lancamentos) && data.lancamentos.length) {
    const rows = data.lancamentos.map(l => ({
      user_id: uid, data: l.data, descricao: l.descricao, categoria: l.categoria,
      tipo: l.tipo, forma_pagamento: l.formaPagamento, valor: l.valor, status: l.status,
    }));
    const { error } = await supabaseClient.from('lancamentos').insert(rows);
    if (error) throw error;
  }

  if (Array.isArray(data.metas) && data.metas.length) {
    const rows = data.metas.map(m => ({
      user_id: uid, emoji: m.emoji || '🎯', nome: m.nome,
      valor_meta: m.valorMeta, valor_atual: m.valorAtual, data_prevista: m.dataPrevista,
    }));
    const { error } = await supabaseClient.from('metas').insert(rows);
    if (error) throw error;
  }

  if (data.orcamentos && typeof data.orcamentos === 'object') {
    const rows = Object.entries(data.orcamentos).map(([categoria, valor_planejado]) => ({
      user_id: uid, categoria, valor_planejado,
    }));
    if (rows.length) {
      const { error } = await supabaseClient.from('orcamentos').upsert(rows);
      if (error) throw error;
    }
  }

  const cfgPayload = {};
  if (Array.isArray(data.categorias) && data.categorias.length) cfgPayload.categorias = data.categorias;
  if (Array.isArray(data.formasPagamento) && data.formasPagamento.length) cfgPayload.formas_pagamento = data.formasPagamento;
  if (data.config) {
    if (data.config.nome) cfgPayload.nome = data.config.nome;
    if (data.config.diaPagamento) cfgPayload.dia_pagamento = data.config.diaPagamento;
  }
  if (Object.keys(cfgPayload).length) {
    const { error } = await supabaseClient.from('config').update(cfgPayload).eq('user_id', uid);
    if (error) throw error;
  }

  await fetchAllData();
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
}

/* ---------- Init ---------- */

async function onSessionReady() {
  hideAuthScreen();
  if (appStarted) return; // token apenas renovado; dados já estão carregados
  appStarted = true;
  try {
    await fetchAllData();
    populateCategoriaSelects();
    renderAll();
  } catch (err) {
    showToast('Erro ao carregar seus dados: ' + err.message);
  }
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
  // A interface é conectada ANTES de tentar falar com o Supabase: uma URL/chave
  // inválida em supabase-config.js não pode deixar a tela inteira sem reação.
  initAuthScreen();
  initTabNav();
  initMonthSwitcher();
  initLancamentosTab();
  initMetasTab();
  initAjustes();
  initModals();
  initExportImport();
  document.getElementById('btn-privacidade').addEventListener('click', togglePrivacidade);

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
      showAuthScreen();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
