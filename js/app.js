/* ===================================================================
   GRANA — Finanças
   Dados salvos na nuvem (Supabase), protegidos por login. Cada usuário só
   enxerga os próprios lançamentos, orçamentos e metas (Row Level Security).
   =================================================================== */

const CATEGORIAS_PADRAO = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Assinaturas', 'Outros'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const EMOJIS_META = ['🎯', '🛡️', '✈️', '🏠', '🚗', '🎓', '💍', '🖥️', '🏋️', '🎸', '🐶', '🎁'];

const VALOR_OCULTO = 'R$ •••••';

/* ---------- Estado ---------- */

let state = {
  config: { nome: '', diaPagamento: null, privacidade: false, tema: 'claro' },
  categorias: [...CATEGORIAS_PADRAO],
  lancamentos: [],
  orcamentos: {},
  metas: [],
  // Contas, cartões, pagamentos de fatura e transferências (js/contas.js).
  contas: [],
  cartoes: [],
  faturas: [],
  transferencias: [],
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
const statAnimStart = new WeakMap(); // guarda o último valor exibido de cada elemento, pra animar a partir dali

/* ---------- Conversão linha do banco <-> objeto usado na tela ---------- */

function rowToLancamento(r) {
  return {
    id: r.id, data: r.data, descricao: r.descricao, categoria: r.categoria,
    tipo: r.tipo, formaPagamento: r.forma_pagamento, valor: Number(r.valor), status: r.status,
    contaId: r.conta_id || null, cartaoId: r.cartao_id || null, faturaRef: r.fatura_ref || null, importId: r.import_id || null,
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

  state.config = { nome: cfg.nome || '', diaPagamento: cfg.dia_pagamento, privacidade: !!cfg.privacidade, tema: cfg.tema || 'claro' };
  state.categorias = (cfg.categorias && cfg.categorias.length) ? cfg.categorias : [...CATEGORIAS_PADRAO];

  await carregarContas();
}

/* ---------- Utilitários de formatação ---------- */

/** Respeita o modo privacidade: todo valor exibido na tela passa por aqui. */
function formatCurrency(value) {
  if (state.config.privacidade) return VALOR_OCULTO;
  return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

/** Saldo em que o "quanto posso gastar" se baseia: o dinheiro do dia a dia (conta corrente, carteira, outras).
    Poupança e investimentos ficam de fora, porque não são pra gastar. */
function saldoParaGastar() {
  const doDiaADia = contasAtivas().filter(c => c.tipo !== 'poupanca' && c.tipo !== 'investimento');
  return { valor: arredonda(doDiaADia.reduce((s, c) => s + saldoDaConta(c), 0)), rotulo: 'Saldo nas contas do dia a dia' };
}

const STATUS_HOJE = {
  verde: { chip: 'No ritmo' },
  amarelo: { chip: 'Atenção' },
  vermelho: { chip: 'Sem folga' },
};

/** Card do topo do Resumo: quanto dá pra gastar por dia até o próximo salário, já separando o que vai vencer. */
function renderQuantoPosso() {
  const card = document.getElementById('hoje-card');
  const hoje = new Date();
  const vendoMesAtual = currentYear === hoje.getFullYear() && currentMonth === hoje.getMonth();
  if (!vendoMesAtual) { card.hidden = true; return; }

  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const base = saldoParaGastar();
  const itens = contasAPagar({ lancamentos: state.lancamentos, cartoes: state.cartoes, faturas: state.faturas });
  const r = quantoPossoGastar({
    hoje: hojeIso, diaPagamento: state.config.diaPagamento, saldo: base.valor, itens,
    mediaDiaria: mediaDiariaDeGastos(state.lancamentos, hojeIso),
    diasDeUso: diasDeHistorico(state.lancamentos, hojeIso),
  });

  card.dataset.status = r.status;
  document.getElementById('hoje-chip').textContent = STATUS_HOJE[r.status].chip;
  document.getElementById('hoje-valor').textContent = formatCurrency(Math.max(r.porDia, 0));
  const ate = r.temSalario ? `até o próximo salário (dia ${r.limite.slice(8)}/${r.limite.slice(5, 7)})` : 'até o fim do mês';
  document.getElementById('hoje-sub').textContent = `por dia · ${r.dias === 1 ? '1 dia' : r.dias + ' dias'} ${ate}`;

  let dica;
  if (r.status === 'vermelho') {
    dica = r.disponivel < 0
      ? `As contas até lá passam do que você tem: faltam ${formatCurrency(Math.abs(r.disponivel))}. Dá para segurar os gastos e ver o que pode esperar.`
      : 'Não sobra nada depois das contas até lá. Segure os gastos.';
  } else if (r.status === 'amarelo') {
    dica = `Menos que o seu ritmo normal (${formatCurrency(r.mediaDiaria)} por dia). Vale segurar um pouco.`;
  } else if (r.aprendendo) {
    dica = 'Sobra depois das contas até lá.';
  } else {
    dica = r.mediaDiaria > 0 ? `Dá para manter o seu ritmo normal (${formatCurrency(r.mediaDiaria)} por dia).` : 'Sobra com folga depois das contas até lá.';
  }
  // Nas primeiras semanas a média do seu gasto ainda não diz muito: o amarelo fica de fora e o app avisa.
  if (r.aprendendo) dica += ' Ainda estou aprendendo o seu ritmo de gastos; por enquanto só aviso quando falta dinheiro.';
  document.getElementById('hoje-dica').textContent = dica;

  // Pendências atrasadas há muito tempo não entram na conta, mas não podem sumir da vista.
  const antigasEl = document.getElementById('hoje-antigas');
  if (r.antigas.length) {
    antigasEl.textContent = `Você tem ${r.antigas.length} ${r.antigas.length === 1 ? 'conta antiga atrasada' : 'contas antigas atrasadas'} (${formatCurrency(r.totalAntigas)}) fora dessa conta. Ver`;
    antigasEl.hidden = false;
  } else {
    antigasEl.hidden = true;
  }

  const lista = r.considerados.map(i =>
    `<div class="hoje-item"><span>${escapeHtml(i.descricao)} · vence ${i.data.slice(8)}/${i.data.slice(5, 7)}</span><span>${formatCurrency(i.valor)}</span></div>`).join('');
  const antigas = r.antigas.map(i => {
    const atributo = i.tipo === 'fatura' ? `data-antiga-fatura="${i.cartaoId}" data-ref="${i.ref}"` : `data-antiga-lanc="${i.id}"`;
    return `<button type="button" class="hoje-item antiga" ${atributo}><span>${escapeHtml(i.descricao)} · venceu ${i.data.slice(8)}/${i.data.slice(5, 7)}/${i.data.slice(0, 4)}</span><span>${formatCurrency(i.valor)}</span></button>`;
  }).join('');
  document.getElementById('hoje-conta').innerHTML = `
    <div class="hoje-linha"><span>${base.rotulo}</span><strong>${formatCurrency(r.saldo)}</strong></div>
    <div class="hoje-linha"><span>− Contas e faturas até lá</span><strong>${formatCurrency(r.aPagar)}</strong></div>
    ${lista}
    <div class="hoje-linha total"><span>= Disponível</span><strong>${formatCurrency(r.disponivel)}</strong></div>
    <div class="hoje-linha"><span>÷ Dias</span><strong>${r.dias}</strong></div>
    <p class="hoje-nota">Conta que vence no dia do salário não entra, porque você paga com o salário novo. Só conta pendente e fatura em aberto entram; marque as pagas como pagas para o número ficar certo.</p>
    ${r.antigas.length ? `<div class="hoje-antigas-lista"><p class="hoje-nota"><strong>Atrasadas há mais de 60 dias (fora da conta):</strong> se já foram pagas, marque como pagas; se não valem mais, exclua.</p>${antigas}</div>` : ''}`;
  card.hidden = false;
}

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

const TAB_TITLES = { resumo: 'Resumo Mensal', lancamentos: 'Lançamentos', contas: 'Contas', fatura: 'Fatura', planejar: 'Planejar' };

/* Planejar tem duas partes: Orçamento e Metas. A última escolhida fica guardada neste aparelho (só conforto). */
const PLANEJAR_SUB_KEY = 'grana_planejar_aba';
const PLANEJAR_SUBS = ['orcamento', 'metas'];
let planejarSub = (() => {
  try { const v = localStorage.getItem(PLANEJAR_SUB_KEY); if (PLANEJAR_SUBS.includes(v)) return v; } catch (e) { /* sem localStorage: abre no Orçamento */ }
  return 'orcamento';
})();
let abaAtual = 'resumo';

/** Mostra a parte pedida do Planejar e guarda a escolha para a próxima vez. */
function mostrarPlanejarSub(sub) {
  if (!PLANEJAR_SUBS.includes(sub)) sub = 'orcamento';
  planejarSub = sub;
  try { localStorage.setItem(PLANEJAR_SUB_KEY, sub); } catch (e) { /* só conforto */ }
  PLANEJAR_SUBS.forEach(s => { document.getElementById('planejar-' + s).hidden = (s !== sub); });
  document.querySelectorAll('#planejar-toggle button').forEach(b => {
    const ativo = b.dataset.sub === sub;
    b.classList.toggle('is-active', ativo);
    b.setAttribute('aria-selected', String(ativo));
  });
  atualizarSeletorDeMes();
}

/** O mês do topo vale para o Orçamento; Metas, Contas e Fatura não são por mês (a fatura tem a própria navegação). */
function atualizarSeletorDeMes() {
  const semMes = abaAtual === 'contas' || abaAtual === 'fatura' || (abaAtual === 'planejar' && planejarSub === 'metas');
  document.getElementById('month-switcher').hidden = semMes;
}

function switchTab(tab, sub) {
  abaAtual = tab;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('is-active'));
  document.getElementById('tab-' + tab).classList.add('is-active');

  // A fatura é aberta a partir de um cartão e não tem item no menu: o destaque fica em "Contas".
  const abaDoMenu = tab === 'fatura' ? 'contas' : tab;
  document.querySelectorAll('.nav-item[data-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.tab === abaDoMenu));
  document.querySelectorAll('.tabbar-item[data-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.tab === abaDoMenu));

  document.getElementById('page-title').textContent = TAB_TITLES[tab];
  // Em Planejar, `sub` (se vier, como no "Ver orçamento" do Resumo) escolhe a parte; sem `sub`, vale a última escolha guardada.
  if (tab === 'planejar') mostrarPlanejarSub(sub || planejarSub);
  else atualizarSeletorDeMes();

  renderAll();
}

function initTabNav() {
  document.getElementById('hero-contas').addEventListener('click', () => switchTab('contas'));
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn.dataset.sub));
  });
  document.querySelectorAll('#planejar-toggle button').forEach(btn => {
    btn.addEventListener('click', () => mostrarPlanejarSub(btn.dataset.sub));
  });
  mostrarPlanejarSub(planejarSub);
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

/** Mini linha da evolução patrimonial (últimos 6 meses) no canto do cartão de saldo. */
function renderHeroSpark() {
  const box = document.getElementById('hero-spark');
  const dados = computeNetWorthEvolution(currentYear, currentMonth, 6).map(d => d.saldo);
  if (dados.length < 2) { box.innerHTML = ''; return; }
  const w = 220, h = 64, pad = 6;
  const min = Math.min(...dados), max = Math.max(...dados), faixa = (max - min) || 1;
  const pts = dados.map((v, i) => [pad + (i * (w - pad * 2)) / (dados.length - 1), pad + (h - pad * 2) - ((v - min) / faixa) * (h - pad * 2)]);
  const linha = pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
  const ult = pts[pts.length - 1];
  box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <polyline points="${linha}" fill="none" stroke="currentColor" stroke-opacity=".85" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${ult[0].toFixed(1)}" cy="${ult[1].toFixed(1)}" r="4" fill="currentColor"/></svg>
    <span>Evolução em ${dados.length} meses</span>`;
}

/* ---------- Gastos por categoria: ranking ---------- */

const RANKING_VISIVEIS = 6;
let rankingExpandido = false;

/** Lista ordenada do que mais pesou: barra proporcional à maior categoria, % do total e variação vs. mês anterior. */
function renderCategoriaRanking(breakdown) {
  const box = document.getElementById('cat-ranking');
  box.innerHTML = '';
  const total = breakdown.reduce((s, b) => s + b.value, 0);
  if (!breakdown.length || total <= 0) {
    box.innerHTML = '<div class="chart-empty">Sem despesas neste mês.</div>';
    return;
  }

  let py = currentYear, pm = currentMonth - 1;
  if (pm < 0) { pm = 11; py -= 1; }
  const anterior = {};
  computeCategoriaBreakdown(getLancamentosForMonth(py, pm)).forEach(c => { anterior[c.label] = c.value; });
  const temBase = Object.keys(anterior).length > 0;

  const maior = breakdown[0].value;
  const lista = rankingExpandido ? breakdown : breakdown.slice(0, RANKING_VISIVEIS);

  lista.forEach((c, i) => {
    const pct = (c.value / total) * 100;
    const cor = corCategoria(c.label);

    let delta = '';
    if (temBase) {
      const antes = anterior[c.label];
      if (!antes) {
        delta = '<span class="cat-delta is-new">novo</span>';
      } else {
        const v = ((c.value - antes) / antes) * 100;
        if (Math.abs(v) >= 1) {
          delta = `<span class="cat-delta ${v > 0 ? 'is-up' : 'is-down'}">${v > 0 ? '↑' : '↓'} ${Math.abs(v).toFixed(0)}%</span>`;
        }
      }
    }

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cat-row';
    row.dataset.categoria = c.label;
    row.setAttribute('aria-label', `Ver lançamentos de ${c.label}`);
    row.innerHTML = `
      <span class="cat-row-top">
        <span class="cat-name">${iconeCategoriaHtml(c.label)}<span class="name-text">${escapeHtml(c.label)}</span></span>
        <span class="cat-value">${formatCurrency(c.value)}</span>
      </span>
      <span class="cat-bar"><span class="cat-bar-fill" style="width:${(c.value / maior * 100).toFixed(1)}%;background:${cor}"></span></span>
      <span class="cat-row-bottom"><span>${pct.toFixed(1)}% do total</span>${delta}</span>
    `;
    box.appendChild(row);
  });

  if (breakdown.length > RANKING_VISIVEIS) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'cat-more';
    more.textContent = rankingExpandido ? 'Mostrar menos' : `Ver todas (${breakdown.length})`;
    more.dataset.toggleRanking = '1';
    box.appendChild(more);
  }
}

function initCategoriaRanking() {
  document.getElementById('cat-ranking').addEventListener('click', (e) => {
    if (e.target.closest('[data-toggle-ranking]')) {
      rankingExpandido = !rankingExpandido;
      renderResumo();
      return;
    }
    const row = e.target.closest('.cat-row');
    if (!row) return;
    // Leva direto pros lançamentos dessa categoria, só despesas, pra conferir item por item.
    const sel = document.getElementById('filter-categoria');
    if (![...sel.options].some(o => o.value === row.dataset.categoria)) return;
    sel.value = row.dataset.categoria;
    document.getElementById('filter-tipo').value = 'despesa';
    document.getElementById('search-lanc').value = '';
    switchTab('lancamentos');
  });
}


/* ---------- Ícones de categoria ---------- */
// Traços simples (24x24, só contorno). A escolha é por palavra-chave no nome da categoria,
// já que as categorias são do usuário; o que não casar com nada recebe a etiqueta genérica.
const ICONES_CATEGORIA = {
  casa: '<path d="M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6"/>',
  mercado: '<path d="M3 4h2l2.4 11h10.2L20 7H6.2"/><path d="M9 20h.01M17 20h.01"/>',
  comida: '<path d="M6 3v8M4 3v5a2 2 0 004 0V3M6 11v10M17 3c-2 1.5-3 4-3 7v3h3V3zM17 13v8"/>',
  carro: '<path d="M5 16v-5l2-5h10l2 5v5M3 16h18M7 19v-3M17 19v-3M7 12h10"/>',
  saude: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.4A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
  lazer: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4 0 007 0M9 9.5h.01M15 9.5h.01"/>',
  estudo: '<path d="M2 9l10-5 10 5-10 5zM6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5M22 9v6"/>',
  assinatura: '<path d="M17 2l3 3-3 3M3 11V9a4 4 0 014-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 01-4 4H4"/>',
  compras: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 016 0v2"/>',
  esporte: '<path d="M8 4h8v5a4 4 0 01-8 0zM8 6H4v1a3 3 0 003 3M16 6h4v1a3 3 0 01-3 3M12 13v4M8 21h8M10 17h4"/>',
  jogo: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01"/>',
  conta: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  viagem: '<path d="M2 14l20-9-6 16-4-7z"/>',
  presente: '<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>',
  carteira: '<path d="M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l2-3h12M16 13h.01"/>',
  etiqueta: '<path d="M3 12V4h8l10 10-8 8zM7.5 8.5h.01"/>',
  tv: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M10 8.5v4.5l4-2.25zM8 21h8"/>',
  musica: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  cruz: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  celular: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  wifi: '<path d="M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01"/>',
  gota: '<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>',
  combustivel: '<path d="M4 21V5a2 2 0 012-2h6a2 2 0 012 2v16M3 21h12M14 9h2a2 2 0 012 2v5a1.5 1.5 0 003 0V8l-3-3M7 8h4"/>',
  halter: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  camisa: '<path d="M8 3L3 6l2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 01-8 0z"/>',
  cartao: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
  troca: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
  recibo: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
  escudo: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  filme: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  ingresso: '<path d="M3 9V7a1 1 0 011-1h16a1 1 0 011 1v2a3 3 0 000 6v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2a3 3 0 000-6z"/><path d="M14 6v12"/>',
  cafe: '<path d="M4 9h13v5a5 5 0 01-5 5H9a5 5 0 01-5-5zM17 10h2a2 2 0 010 4h-2M7 3v2M11 3v2M15 3v2"/>',
  pata: '<circle cx="6" cy="10" r="1.8"/><circle cx="10" cy="6" r="1.8"/><circle cx="14" cy="6" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M12 12c-3 0-5 3-5 5.2 0 1.5 1.5 2 3 1.5 1-.3 1.5-.5 2-.5s1 .2 2 .5c1.5.5 3-.1 3-1.5C17 15 15 12 12 12z"/>',
  tesoura: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1L20 20M8.1 15.9L20 4"/>',
  livro: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13"/>',
  grafico: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  cama: '<path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 00-3-3h-7v5M7.5 11.5h.01"/>',
  game: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10v5M4.5 12.5h5M15.5 11h.01M18 14h.01"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 20h20"/>',
};
const ICONE_POR_PALAVRA = [
  [/moradia|casa|alug|condom|imovel/, 'casa'],
  [/restaurante|delivery|lanche|comida|ifood|bar\b|padaria/, 'comida'],
  [/aliment|mercado|supermerc|feira/, 'mercado'],
  [/transporte|uber|combust|carro|gasolina|onibus|metro|veiculo/, 'carro'],
  [/saude|farmac|medic|dentist|plano de saude/, 'saude'],
  [/lazer|diversao|cinema|entreten|festa|balada/, 'lazer'],
  [/educa|curso|escola|faculdade|livro/, 'estudo'],
  [/assinat|streaming|netflix|spotify|mensalidade/, 'assinatura'],
  [/compra|loja|roupa|shopping|vestuario|pessoais/, 'compras'],
  [/esporte|academia|fitness|treino/, 'esporte'],
  [/aposta|jogo|bet|cartola|cassino/, 'jogo'],
  [/luz|energia|agua|internet|telefone|conta|gas\b/, 'conta'],
  [/viagem|passagem|hotel|ferias/, 'viagem'],
  [/presente/, 'presente'],
  [/salario|renda|receita|invest|rendimento/, 'carteira'],
];

function iconeDaCategoria(nome) {
  const chave = (nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const achado = ICONE_POR_PALAVRA.find(([re]) => re.test(chave));
  return ICONES_CATEGORIA[achado ? achado[1] : 'etiqueta'];
}


// A descrição do lançamento ("Netflix", "Uber", "Farmácia") diz mais sobre o que foi do que a categoria,
// então ela tem prioridade; só quando nada casa é que vale o ícone da categoria.
const ICONE_POR_DESCRICAO = [
  [/uber|\b99\b|taxi|cabify|onibus|metro\b|bilhete unico|pedagio|estacion|oficina|mecanic|pneu|ipva|licenciamento/, 'carro'],
  [/gasolina|combust|posto|etanol|alcool|diesel|abastec/, 'combustivel'],
  [/ifood|rappi|restaurante|lanche|pizza|burger|hamburg|mcdonald|subway|sushi|churrasc|marmita|almoco|jantar|delivery|padaria|pastel|acai/, 'comida'],
  [/cafe|starbucks|\bbar\b|cerveja|chopp|boteco|happy hour/, 'cafe'],
  [/mercado|supermerc|atacad|assai|carrefour|hortifruti|acougue|sacolao|feira|compras do mes/, 'mercado'],
  [/netflix|disney|hbo|prime video|globoplay|youtube|streaming|paramount|apple tv|crunchyroll/, 'tv'],
  [/spotify|deezer|apple music|musica/, 'musica'],
  [/farmacia|drogaria|remedio|medic|consulta|exame|dentista|hospital|clinica|psicolog|terapia|plano de saude|unimed/, 'cruz'],
  [/academia|smartfit|crossfit|personal|treino|suplemento|whey/, 'halter'],
  [/aluguel|condominio|iptu|financiamento|reforma|imobili/, 'casa'],
  [/\bluz\b|energia|enel|cpfl|cemig|eletric/, 'conta'],
  [/\bagua\b|sabesp|saneamento|copasa/, 'gota'],
  [/internet|wifi|fibra|banda larga/, 'wifi'],
  [/celular|telefone|\bvivo\b|\bclaro\b|\btim\b|\boi\b|recarga/, 'celular'],
  [/cartao|fatura|nubank|\binter\b|\bc6\b|itau|bradesco|santander|anuidade/, 'cartao'],
  [/\bpix\b|transferencia|\bted\b|\bdoc\b|saque|deposito/, 'troca'],
  [/boleto|imposto|taxa|darf|multa|tarifa|\biss\b|inss/, 'recibo'],
  [/seguro|previdencia/, 'escudo'],
  [/cinema|filme/, 'filme'],
  [/\bshow\b|ingresso|teatro|festival|evento|balada|festa/, 'ingresso'],
  [/steam|playstation|\bpsn\b|xbox|nintendo|\bgame\b|riot|valorant|fifa/, 'game'],
  [/\bbet\b|bet365|aposta|cassino|tigrinho|loteria|mega.?sena|cartola|\bjogo\b/, 'jogo'],
  [/roupa|camisa|calca|tenis|sapato|sandalia|shein|renner|zara|vestuario|blusa|jaqueta/, 'camisa'],
  [/notebook|computador|mouse|teclado|monitor|eletron|iphone|samsung|fone|headphone|airpods|tablet|ipad/, 'laptop'],
  [/cabelo|barbear|barbearia|salao|manicure|estetica|depila|corte/, 'tesoura'],
  [/\bpet\b|racao|veterin|cachorro|gato|petshop/, 'pata'],
  [/curso|faculdade|escola|udemy|alura|matricula|apostila|idioma|ingles/, 'estudo'],
  [/livro|kindle|livraria/, 'livro'],
  [/hotel|hospedagem|airbnb|pousada/, 'cama'],
  [/viagem|passagem|\bvoo\b|latam|decolar|booking/, 'viagem'],
  [/presente|aniversario|natal|cesta/, 'presente'],
  [/salario|pagamento|renda|freela|comissao|bonus|13o|decimo|reembolso|estorno|cashback|rendimento|dividendo/, 'carteira'],
  [/invest|tesouro|\bcdb\b|acoes|\bfii\b|poupanca|aporte|cripto|bitcoin|reserva/, 'grafico'],
  [/doacao|dizimo|igreja|caridade/, 'saude'],
  [/esporte|futebol|quadra|\bbola\b/, 'esporte'],
];

function semAcento(texto) {
  return (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function iconeDoLancamento(descricao, categoria) {
  const achado = ICONE_POR_DESCRICAO.find(([re]) => re.test(semAcento(descricao)));
  return achado ? ICONES_CATEGORIA[achado[1]] : iconeDaCategoria(categoria);
}

/** Bolinha com o ícone da categoria, na cor fixa dela. */
function iconeCategoriaHtml(nome, descricao) {
  const traco = descricao ? iconeDoLancamento(descricao, nome) : iconeDaCategoria(nome);
  return `<span class="cat-ico" style="--c:${corCategoria(nome)}" aria-hidden="true"><svg viewBox="0 0 24 24">${traco}</svg></span>`;
}

/* ---------- Contas a vencer (card do Resumo) ---------- */

const VENCER_DIAS = 3;      // avisa de hoje até 3 dias à frente, mais as atrasadas
const VENCER_VISIVEIS = 5;

function textoDoVencimento(faltam) {
  if (faltam < 0) return { texto: `Atrasada há ${-faltam} ${faltam === -1 ? 'dia' : 'dias'}`, urgente: true };
  if (faltam === 0) return { texto: 'Vence hoje', urgente: true };
  if (faltam === 1) return { texto: 'Vence amanhã', urgente: true };
  return { texto: `Vence em ${faltam} dias`, urgente: false };
}

/** Contas pendentes e faturas de cartão que vencem nos próximos 3 dias (ou já passaram), no topo do Resumo. */
function renderContasAVencer() {
  const card = document.getElementById('vencer-card');
  const d = new Date();
  const hojeIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const itens = contasAPagar({ lancamentos: state.lancamentos, cartoes: state.cartoes, faturas: state.faturas });
  const proximos = vencimentosProximos(itens, hojeIso, VENCER_DIAS);
  if (!proximos.length) { card.hidden = true; return; }

  const total = arredonda(proximos.reduce((s, i) => s + i.valor, 0));
  document.getElementById('vencer-sub').textContent = `${formatCurrency(total)} nos próximos dias`;
  const visiveis = proximos.slice(0, VENCER_VISIVEIS);
  document.getElementById('vencer-lista').innerHTML = visiveis.map(i => {
    const { texto, urgente } = textoDoVencimento(i.faltam);
    const lanc = i.tipo === 'conta' ? state.lancamentos.find(l => l.id === i.id) : null;
    const icone = i.tipo === 'fatura'
      ? `<span class="cat-ico" style="--c:var(--text)" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONE_CARTAO}</svg></span>`
      : iconeCategoriaHtml(lanc ? lanc.categoria : '', i.descricao);
    const acao = i.tipo === 'fatura'
      ? `<button type="button" class="btn btn-ghost vencer-acao" data-vencer-fatura="${i.cartaoId}" data-ref="${i.ref}">Ver fatura</button>`
      : `<button type="button" class="btn btn-ghost vencer-acao" data-vencer-paga="${i.id}">Marcar paga</button>`;
    return `
      <div class="vencer-item">
        ${icone}
        <div class="vencer-texto"><strong>${escapeHtml(i.descricao)}</strong><small class="${urgente ? 'urgente' : ''}">${texto} · ${i.data.slice(8)}/${i.data.slice(5, 7)}</small></div>
        <div class="vencer-dir"><span class="vencer-valor">${formatCurrency(i.valor)}</span>${acao}</div>
      </div>`;
  }).join('') + (proximos.length > VENCER_VISIVEIS ? `<p class="budget-alert-more">e mais ${proximos.length - VENCER_VISIVEIS}: veja em Lançamentos e Contas</p>` : '');
  card.hidden = false;
}

async function marcarContaComoPaga(id) {
  const atual = state.lancamentos.find(l => l.id === id);
  // Vencimento futuro: a data passa a ser hoje, senão o dinheiro só sairia do saldo no dia do vencimento.
  const hoje = hojeIso();
  const novaData = atual ? dataAoMarcarPaga(atual.data, hoje) : hoje;
  const ajustou = !!atual && novaData !== atual.data;
  const campos = ajustou ? { status: 'pago', data: novaData } : { status: 'pago' };
  const { data, error } = await supabaseClient.from('lancamentos').update(campos).eq('id', id).select().single();
  if (error) { showToast('Erro ao marcar como paga: ' + error.message); return; }
  const idx = state.lancamentos.findIndex(l => l.id === id);
  if (idx >= 0) state.lancamentos[idx] = rowToLancamento(data);
  haptic();
  showToast(ajustou ? 'Marcada como paga. A data virou hoje, e o valor já saiu do saldo.' : 'Marcada como paga', ajustou ? 4500 : undefined);
  renderAll();
}

function initQuantoPosso() {
  const detalhe = document.querySelector('.hoje-detalhe');
  document.getElementById('hoje-antigas').addEventListener('click', () => {
    detalhe.open = true;
    const alvo = document.querySelector('.hoje-antigas-lista');
    if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('hoje-conta').addEventListener('click', (e) => {
    const lanc = e.target.closest('[data-antiga-lanc]');
    if (lanc) { openLancamentoModal(lanc.dataset.antigaLanc); return; }
    const fatura = e.target.closest('[data-antiga-fatura]');
    if (fatura) abrirFatura(fatura.dataset.antigaFatura, fatura.dataset.ref);
  });
}

function initContasAVencer() {
  document.getElementById('vencer-lista').addEventListener('click', (e) => {
    const paga = e.target.closest('[data-vencer-paga]');
    if (paga) { marcarContaComoPaga(paga.dataset.vencerPaga); return; }
    const fatura = e.target.closest('[data-vencer-fatura]');
    if (fatura) abrirFatura(fatura.dataset.vencerFatura, fatura.dataset.ref);
  });
}

/* ---------- Alertas de orçamento ---------- */

const ORCAMENTO_ALERTA_PCT = 80;

function gastoCategoriaNoMes(categoria, year, month) {
  return getLancamentosForMonth(year, month)
    .filter(l => l.tipo === 'despesa' && l.categoria === categoria)
    .reduce((s, l) => s + l.valor, 0);
}

/** % do orçamento da categoria já usado no mês da data (0 se a categoria não tem orçamento definido). */
function pctOrcamento(categoria, dataIso) {
  const planejado = state.orcamentos[categoria] || 0;
  if (planejado <= 0) return 0;
  const [y, m] = dataIso.split('-').map(Number);
  return (gastoCategoriaNoMes(categoria, y, m - 1) / planejado) * 100;
}

/** Categorias do mês com 80% ou mais do orçamento usado, da mais apertada pra menos. */
function computeAlertasOrcamento(year, month) {
  const alertas = [];
  state.categorias.forEach(cat => {
    const planejado = state.orcamentos[cat] || 0;
    if (planejado <= 0) return;
    const gasto = gastoCategoriaNoMes(cat, year, month);
    const pct = (gasto / planejado) * 100;
    if (pct >= ORCAMENTO_ALERTA_PCT) alertas.push({ categoria: cat, planejado, gasto, pct, estourou: pct > 100 });
  });
  return alertas.sort((a, b) => b.pct - a.pct);
}

/** Depois de salvar uma despesa, avisa na hora se ela fez a categoria cruzar 80% ou 100% do orçamento. */
function avisarOrcamento(categoria, dataIso, pctAntes) {
  const pctDepois = pctOrcamento(categoria, dataIso);
  if (pctDepois > 100 && pctAntes <= 100) {
    showToast(`Atenção: o orçamento de ${categoria} estourou neste mês.`, 5000);
  } else if (pctDepois >= ORCAMENTO_ALERTA_PCT && pctAntes < ORCAMENTO_ALERTA_PCT) {
    showToast(`Atenção: ${categoria} chegou a ${Math.floor(pctDepois)}% do orçamento.`, 5000);
  }
}

function renderAlertasOrcamento() {
  const card = document.getElementById('budget-alert-card');
  const lista = document.getElementById('budget-alert-list');
  const alertas = computeAlertasOrcamento(currentYear, currentMonth);
  if (!alertas.length) { card.hidden = true; return; }

  const MAX = 4;
  lista.innerHTML = alertas.slice(0, MAX).map(a => `
    <div class="budget-alert-item">
      <div class="budget-alert-row">
        <span class="budget-alert-name">${iconeCategoriaHtml(a.categoria)}<span class="name-text">${escapeHtml(a.categoria)}</span></span>
        <span class="budget-alert-note ${a.estourou ? 'is-over' : ''}">${Math.floor(a.pct)}%</span>
      </div>
      <div class="budget-bar-wrap"><div class="budget-bar ${a.estourou ? 'over' : 'warn'}" style="width:${Math.min(100, a.pct)}%"></div></div>
      <div class="budget-alert-values">${formatCurrency(a.gasto)} de ${formatCurrency(a.planejado)}${a.estourou ? ` · <span class="budget-alert-over">estourou ${formatCurrency(a.gasto - a.planejado)}</span>` : ''}</div>
    </div>
  `).join('') + (alertas.length > MAX ? `<p class="budget-alert-more">e mais ${alertas.length - MAX} em Planejar › Orçamento</p>` : '');
  card.hidden = false;
}

/* ---------- Cor das categorias ---------- */

/** Cor fixa por categoria (posição na lista de categorias), igual no ranking e nos ícones — assim "azul" é sempre a mesma coisa. */
function corCategoria(cat) {
  const i = state.categorias.indexOf(cat);
  return CHART_PALETTE[(i >= 0 ? i : state.categorias.length) % CHART_PALETTE.length];
}

function renderMonthLabel() {
  document.getElementById('month-label').textContent = monthLabel(currentYear, currentMonth);
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

  // O resultado do mês não é o dinheiro das contas: a linha abaixo mostra os dois lado a lado (o valor é o mesmo da aba Contas).
  document.getElementById('hero-nota').textContent = `Entrou menos saiu em ${MESES[currentMonth].toLowerCase()}. Não é o dinheiro que está nas contas.`;
  document.getElementById('hero-contas-valor').textContent = formatCurrency(saldoTotalEmContas());

  renderInsight();
  renderQuantoPosso();

  const breakdown = computeCategoriaBreakdown(lancs);
  renderCategoriaRanking(breakdown);
  renderContasAVencer();
  renderAlertasOrcamento();

  renderHeroSpark();
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
}

function getFilteredSortedLancamentos() {
  let lancs = getLancamentosForMonth(currentYear, currentMonth);

  const search = document.getElementById('search-lanc').value.trim().toLowerCase();
  const catFilter = document.getElementById('filter-categoria').value;
  const tipoFilter = document.getElementById('filter-tipo').value;
  const contaFilter = document.getElementById('filter-conta').value;

  if (contaFilter) lancs = lancs.filter(l => lancamentoPassaNoFiltroConta(l, contaFilter));
  if (search) lancs = lancs.filter(l => l.descricao.toLowerCase().includes(search));
  if (catFilter) lancs = lancs.filter(l => l.categoria === catFilter);
  if (tipoFilter) lancs = lancs.filter(l => l.tipo === tipoFilter);

  const { field, dir } = sortState;
  lancs = [...lancs].sort((a, b) => {
    let av = field === 'pagamento' ? rotuloPagamento(a) : a[field];
    let bv = field === 'pagamento' ? rotuloPagamento(b) : b[field];
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
      <td class="col-desc"><span class="desc-wrap">${iconeCategoriaHtml(l.categoria, l.descricao)}<span class="desc-text">${escapeHtml(l.descricao)}</span></span></td>
      <td class="col-cat"><span class="cat-pill">${escapeHtml(l.categoria)}</span></td>
      <td class="col-tipo"><span class="badge badge-${l.tipo}">${l.tipo === 'receita' ? 'Receita' : 'Despesa'}</span></td>
      <td class="col-forma">${escapeHtml(rotuloPagamento(l))}</td>
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
  document.getElementById('lanc-tipo').addEventListener('change', () => { updateRepeticaoTipoUI(); aplicarCategoriaPadraoDoTipo(); });
  document.getElementById('lanc-categoria').addEventListener('change', () => { categoriaEscolhidaPelaPessoa = true; });
  document.getElementById('lanc-repeticao-qtd').addEventListener('input', updateRepeticaoFim);
  document.getElementById('lanc-data').addEventListener('change', updateRepeticaoFim);
}

/** Num lançamento novo, trocar o tipo ajusta a categoria de partida (Receita -> "Outros", Despesa -> a primeira da lista),
    a não ser que a pessoa já tenha escolhido uma categoria: aí ela é respeitada. Editar um lançamento nunca troca a categoria. */
let categoriaEscolhidaPelaPessoa = false;
function aplicarCategoriaPadraoDoTipo() {
  if (editingLancId || categoriaEscolhidaPelaPessoa) return;
  const tipo = document.getElementById('lanc-tipo').value;
  const padrao = tipo === 'receita' ? categoriaPadrao('receita', state.categorias) : state.categorias[0];
  if (padrao) setSelectValue('lanc-categoria', padrao);
}

function openLancamentoModal(id, opcoes = {}) {
  editingLancId = id;
  categoriaEscolhidaPelaPessoa = false;
  const form = document.getElementById('form-lancamento');
  form.reset();

  if (id) {
    const l = state.lancamentos.find(x => x.id === id);
    document.getElementById('modal-lancamento-title').textContent = 'Editar lançamento';
    document.getElementById('lanc-id').value = l.id;
    document.getElementById('lanc-data').value = l.data;
    document.getElementById('lanc-descricao').value = l.descricao;
    document.getElementById('lanc-tipo').value = l.tipo;
    // A categoria pode ter sido removida nos Ajustes depois do lançamento.
    setSelectValue('lanc-categoria', l.categoria);
    document.getElementById('lanc-status').value = l.status;
    document.getElementById('lanc-valor').value = l.valor;
    document.getElementById('btn-excluir-lancamento').hidden = false;
    // Editar um lançamento existente mexe só nele — não recria a série.
    document.getElementById('lanc-repeticao-section').hidden = true;
  } else {
    document.getElementById('modal-lancamento-title').textContent = 'Novo lançamento';
    document.getElementById('lanc-id').value = '';
    const iso = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(diaPadraoDoMes(new Date().getDate(), currentYear, currentMonth)).padStart(2, '0')}`;
    document.getElementById('lanc-data').value = iso;
    document.getElementById('btn-excluir-lancamento').hidden = true;
    document.getElementById('lanc-repeticao-section').hidden = false;
    document.getElementById('lanc-repeticao').value = 'nenhuma';
    // Vindo do botão "+ Compra no cartão" da fatura, a data é a de hoje (é uma compra de agora).
    if (opcoes.destino) document.getElementById('lanc-data').value = hojeIso();
    updateRepeticaoTipoUI();
    updateRepeticaoUI();
  }
  prepararDestinoLancamento(id ? state.lancamentos.find(x => x.id === id) : null, opcoes.destino);
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
  if (valorBase < 0.01) { showToast('Informe um valor de pelo menos R$ 0,01.'); return; }
  // Conta ou cartão onde o lançamento acontece. Compra no cartão não tem status pra escolher.
  const destino = lerDestinoLancamento();
  // A forma de pagamento não é mais escolhida na tela (a conta ou o cartão já dizem isso), mas a coluna continua no banco:
  // compra no cartão grava "Crédito <nome>", o resto grava "Outro", e um lançamento antigo editado mantém a forma que já tinha.
  const anterior = id ? state.lancamentos.find(x => x.id === id) : null;
  const forma = destino.cartao ? `Crédito ${destino.cartao.nome}` : (anterior && !anterior.cartaoId ? anterior.formaPagamento : 'Outro');
  const payloadBase = {
    tipo: document.getElementById('lanc-tipo').value,
    categoria: document.getElementById('lanc-categoria').value,
    forma_pagamento: forma,
    status: destino.cartao ? 'pago' : document.getElementById('lanc-status').value,
  };
  payloadBase.conta_id = destino.contaId;
  payloadBase.cartao_id = destino.cartaoId;
  const modoRepeticao = id ? 'nenhuma' : document.getElementById('lanc-repeticao').value;
  const qtd = Math.max(1, parseInt(document.getElementById('lanc-repeticao-qtd').value, 10) || 1);
  if (modoRepeticao === 'parcelado' && qtd > 1 && valorBase / qtd < 0.01) {
    showToast('Esse valor é pequeno demais para dividir em tantas parcelas.');
    return;
  }

  const pctAntes = payloadBase.tipo === 'despesa' ? pctOrcamento(payloadBase.categoria, dataBase) : 0;

  let dataAjustada = false;
  btn.disabled = true;
  try {
    if (id) {
      const payload = { ...payloadBase, data: dataBase, descricao: descricaoBase, valor: valorBase };
      // Passou de pendente para pago com vencimento futuro: a data vira hoje, para o valor sair do saldo agora.
      if (anterior && anterior.status === 'pendente' && payload.status === 'pago' && !destino.cartao) {
        const hoje = hojeIso();
        if (dataAoMarcarPaga(payload.data, hoje) !== payload.data) { payload.data = hoje; dataAjustada = true; }
      }
      // Só recalcula a fatura se mudou o cartão ou a data; editar descrição ou valor não tira a compra da fatura em que caiu
      // (e uma parcela editada não "pula" de fatura sem querer).
      const mudou = !anterior || anterior.cartaoId !== destino.cartaoId || anterior.data !== dataBase || !anterior.faturaRef;
      payload.fatura_ref = destino.cartao ? (mudou ? faturaDaCompra(dataBase, destino.cartao) : anterior.faturaRef) : null;
      const { data, error } = await supabaseClient.from('lancamentos').update(payload).eq('id', id).select().single();
      if (error) throw error;
      const idx = state.lancamentos.findIndex(x => x.id === id);
      state.lancamentos[idx] = rowToLancamento(data);
      showToast(dataAjustada ? 'Lançamento pago. A data virou hoje, e o valor já saiu do saldo.' : 'Lançamento atualizado', dataAjustada ? 4500 : undefined);
    } else if (modoRepeticao === 'recorrente' && qtd > 1) {
      const serieId = crypto.randomUUID();
      const rows = [];
      for (let i = 0; i < qtd; i++) {
        rows.push({
          ...payloadBase, user_id: session.user.id, serie_id: serieId,
          data: addMonthsToIso(dataBase, i),
          descricao: descricaoBase,
          valor: valorBase,
          fatura_ref: destino.cartao ? faturaRefDaParcela(dataBase, destino.cartao, i) : null,
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
          // Cada parcela cai numa fatura seguinte: a 1ª pela regra do melhor dia de compra, as outras mês a mês depois dela.
          fatura_ref: destino.cartao ? faturaRefDaParcela(dataBase, destino.cartao, i) : null,
        });
      }
      const { data, error } = await supabaseClient.from('lancamentos').insert(rows).select();
      if (error) throw error;
      data.forEach(r => state.lancamentos.push(rowToLancamento(r)));
      showToast(`Despesa parcelada em ${qtd}x`);
    } else {
      const payload = { ...payloadBase, data: dataBase, descricao: descricaoBase, valor: valorBase };
      payload.fatura_ref = destino.cartao ? faturaDaCompra(dataBase, destino.cartao) : null;
      const { data, error } = await supabaseClient
        .from('lancamentos')
        .insert({ ...payload, user_id: session.user.id })
        .select()
        .single();
      if (error) throw error;
      state.lancamentos.push(rowToLancamento(data));
      showToast('Lançamento adicionado');
    }
    guardarUltimoDestino(destino);
    closeModal('modal-lancamento');
    haptic();
    renderAll();
    if (payloadBase.tipo === 'despesa') avisarOrcamento(payloadBase.categoria, dataBase, pctAntes);
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

/** Cartão-resumo do mês no topo do Orçamento. Soma só as categorias que têm valor planejado (gasto sem planejamento
    não entra, senão o total não bateria com o planejado) e usa os mesmos lançamentos do mês que a lista abaixo. */
function renderResumoOrcamento(gastoPorCategoria) {
  const card = document.getElementById('budget-summary');
  let planejado = 0, gasto = 0;
  state.categorias.forEach(cat => {
    const p = state.orcamentos[cat] || 0;
    if (p <= 0) return;
    planejado += p;
    gasto += gastoPorCategoria[cat] || 0;
  });
  if (planejado <= 0) { card.hidden = true; return; }

  // A soma continua como está; o aviso abaixo só deixa claro que alguma categoria sozinha já passou do planejado.
  const alerta = document.getElementById('budget-summary-alerta');
  const texto = textoCategoriasEstouradas(categoriasEstouradas(state.categorias, state.orcamentos, gastoPorCategoria), formatCurrency);
  alerta.textContent = texto;
  alerta.hidden = !texto;

  const pct = (gasto / planejado) * 100;
  const status = pct > 100 ? 'over' : (pct >= ORCAMENTO_ALERTA_PCT ? 'warn' : 'ok');
  const pctEl = document.getElementById('budget-summary-pct');
  pctEl.textContent = state.config.privacidade ? '' : `${Math.floor(pct)}%`;
  pctEl.className = 'budget-summary-pct ' + status;
  document.getElementById('budget-summary-gasto').textContent = formatCurrency(gasto);
  document.getElementById('budget-summary-de').textContent = `de ${formatCurrency(planejado)} planejados`;
  const barra = document.getElementById('budget-summary-bar');
  barra.className = 'budget-bar ' + status;
  barra.style.width = `${Math.min(100, pct)}%`;
  const resto = document.getElementById('budget-summary-resto');
  const sobra = planejado - gasto;
  resto.className = 'budget-summary-resto' + (sobra < 0 ? ' over' : '');
  resto.textContent = sobra < 0 ? `Passou ${formatCurrency(-sobra)} do planejado` : `Ainda dá para gastar ${formatCurrency(sobra)}`;
  card.hidden = false;
}

function renderOrcamento() {
  const lancs = getLancamentosForMonth(currentYear, currentMonth);
  const gastoPorCategoria = {};
  for (const l of lancs) {
    if (l.tipo !== 'despesa') continue;
    gastoPorCategoria[l.categoria] = (gastoPorCategoria[l.categoria] || 0) + l.valor;
  }

  renderResumoOrcamento(gastoPorCategoria);

  const list = document.getElementById('budget-list');
  const oculto = state.config.privacidade;
  list.innerHTML = '';

  state.categorias.forEach(cat => {
    const planejado = state.orcamentos[cat] || 0;
    const gasto = gastoPorCategoria[cat] || 0;
    const { temBarra: temPlano, pct, status } = linhaDoOrcamento(gasto, planejado);

    const item = document.createElement('div');
    item.className = 'budget-item' + (temPlano ? '' : ' sem-plano');
    // Sem valor planejado não há o que medir: nada de barra nem "de R$ 0,00", só o quanto foi gasto, em cinza.
    const barra = temPlano ? `
      <div class="budget-bar-wrap">
        <div class="budget-bar ${status}" style="width:${Math.min(100, pct)}%"></div>
      </div>` : '';
    const valores = temPlano
      ? `<strong>${formatCurrency(gasto)}</strong> de ${formatCurrency(planejado)}
        ${status === 'over' ? `<br><span class="budget-over-note">Estourou ${formatCurrency(gasto - planejado)}</span>` : ''}`
      : `${formatCurrency(gasto)} gastos · sem valor planejado`;
    item.innerHTML = `
      <div class="budget-cat">
        ${iconeCategoriaHtml(cat)}
        <span class="budget-cat-name">${escapeHtml(cat)}</span>
      </div>${barra}
      <div class="budget-values">${valores}</div>
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

/* ---------- Ajustes ---------- */

function initAjustes() {
  document.querySelectorAll('.btn-ajustes').forEach(b => b.addEventListener('click', openAjustes));
  document.getElementById('form-ajustes').addEventListener('submit', onSubmitAjustes);
  document.getElementById('btn-restaurar-padrao').addEventListener('click', () => {
    document.getElementById('cfg-categorias').value = CATEGORIAS_PADRAO.join('\n');
    showToast('Categorias padrão restauradas — salve para aplicar');
  });
}

function openAjustes() {
  document.getElementById('cfg-nome').value = state.config.nome || '';
  document.getElementById('cfg-dia-pagamento').value = state.config.diaPagamento || '';
  document.getElementById('cfg-categorias').value = state.categorias.join('\n');
  atualizarBotaoFaceId();
  atualizarLembretesUI();
  openModal('modal-ajustes');
}

function parseLinhas(texto) {
  return texto.split('\n').map(s => s.trim()).filter(Boolean);
}

async function onSubmitAjustes(e) {
  e.preventDefault();

  // Repetidas (ignorando maiúsculas e acentos, "Saúde" = "saude") saem; fica a primeira.
  const categoriasDigitadas = parseLinhas(document.getElementById('cfg-categorias').value);
  const categorias = removerRepetidas(categoriasDigitadas);
  const removidas = categoriasDigitadas.length - categorias.length;

  if (!categorias.length) {
    showToast('A lista de categorias não pode ficar vazia');
    return;
  }

  const dia = parseInt(document.getElementById('cfg-dia-pagamento').value, 10);
  const payload = {
    nome: document.getElementById('cfg-nome').value.trim(),
    dia_pagamento: (dia >= 1 && dia <= 31) ? dia : null,
    categorias,
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

    populateCategoriaSelects();
    closeModal('modal-ajustes');
    haptic();
    renderAll();
    showToast(removidas ? `Ajustes salvos. Tirei ${removidas} ${removidas === 1 ? 'item repetido' : 'itens repetidos'}.` : 'Ajustes salvos');
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

/* ---------- Lembretes por notificação ---------- */
// O aparelho se inscreve no serviço de push do navegador e guarda a inscrição no Supabase;
// quem envia o aviso das 21h é o servidor (api/lembretes.js, via Vercel Cron).
// No iPhone isso só funciona com o app instalado na tela de início (iOS 16.4+).

function ehIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function appInstalado() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function pushSuportado() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ParaBytes(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function inscricaoAtual() {
  if (!pushSuportado()) return null;
  // serviceWorker.ready nunca responde se nenhum service worker foi registrado (modo privado, por exemplo). Sem o limite de
  // tempo, isso travaria quem sai ou exclui a conta, que passam por aqui antes de continuar.
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 2000))]);
  return reg ? reg.pushManager.getSubscription() : null;
}

async function atualizarLembretesUI() {
  const row = document.getElementById('lembretes-row');
  const btn = document.getElementById('btn-lembretes-toggle');
  const hint = document.getElementById('lembretes-hint');

  if (!pushSuportado()) {
    // iPhone fora do app instalado não expõe push; explica o caminho em vez de esconder a opção.
    row.hidden = !(ehIOS() && !appInstalado());
    if (!row.hidden) {
      btn.disabled = true;
      hint.textContent = 'No iPhone, os lembretes só funcionam com o GRANA instalado: no Safari, toque em Compartilhar → Adicionar à Tela de Início, e abra o app por lá.';
    }
    return;
  }

  row.hidden = false;
  const sub = await inscricaoAtual();
  const ativo = !!sub && Notification.permission === 'granted';
  btn.disabled = false;
  btn.textContent = ativo ? 'Desativar lembretes' : 'Ativar lembretes';
  hint.textContent = Notification.permission === 'denied'
    ? 'As notificações estão bloqueadas para o GRANA neste aparelho. Libere em Ajustes do aparelho → Notificações.'
    : 'Um aviso por dia, às 21h, só quando houver algo importante: conta ou fatura do cartão vencendo (3 dias e 1 dia antes), orçamento no limite ou nenhum gasto lançado no dia. Vale só para este aparelho.';
}

async function ativarLembretes() {
  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') {
      showToast('Sem a permissão de notificações não dá pra ativar os lembretes.');
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ParaBytes(VAPID_PUBLIC_KEY),
    });
    const j = sub.toJSON();
    const { error } = await supabaseClient.from('push_subscriptions').upsert(
      { user_id: session.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: 'endpoint' }
    );
    if (error) {
      await sub.unsubscribe().catch(() => {});
      throw error;
    }
    showToast('Lembretes ativados neste aparelho');
  } catch (err) {
    showToast('Não deu pra ativar os lembretes: ' + (err.message || 'tente de novo'));
  }
  atualizarLembretesUI();
}

async function desativarLembretes() {
  try {
    const sub = await inscricaoAtual();
    if (sub) {
      await supabaseClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
    showToast('Lembretes desativados neste aparelho');
  } catch (err) {
    showToast('Não deu pra desativar: ' + (err.message || 'tente de novo'));
  }
  atualizarLembretesUI();
}

/** Ao sair da conta, o aparelho deixa de receber os avisos dela (senão o próximo a entrar veria dados de outra pessoa). */
async function removerInscricaoAoSair() {
  try {
    const sub = await inscricaoAtual();
    if (!sub) return;
    await supabaseClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  } catch (e) { /* sair da conta não pode travar por causa disso */ }
}

function initLembretes() {
  document.getElementById('btn-lembretes-toggle').addEventListener('click', async () => {
    if (await inscricaoAtual()) desativarLembretes();
    else ativarLembretes();
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
    await removerInscricaoAoSair();
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
/** Pergunta antes de agir. Por padrão é uma exclusão (botão vermelho "Excluir"); `opcoes` troca título e botão
    para outras confirmações, como desfazer um pagamento. */
function pedirConfirmacao(mensagem, aoConfirmar, opcoes = {}) {
  document.getElementById('confirmar-mensagem').textContent = mensagem;
  document.getElementById('confirmar-titulo').textContent = opcoes.titulo || 'Confirmar exclusão';
  const botao = document.getElementById('btn-confirmar-exclusao');
  botao.textContent = opcoes.botao || 'Excluir';
  botao.classList.toggle('btn-danger-solid', !opcoes.neutro);
  botao.classList.toggle('btn-primary', !!opcoes.neutro);
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
function showToast(msg, ms = 2600) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), ms);
}

/* ---------- Sincronização em tempo real ---------- */
/* Uma alteração feita num aparelho aparece nos outros sem precisar recarregar.
   Os handlers são seguros mesmo quando o evento é eco da própria escrita deste
   aparelho: INSERT só adiciona se o id ainda não existe, UPDATE/DELETE mexem
   só no item daquele id — reaplicar o mesmo dado não duplica nem quebra nada. */

let realtimeChannel = null;

let renderAgendado = null;
/** Eventos de tempo real chegam em rajada (importar 200 linhas manda 200 avisos). Em vez de redesenhar a tela a cada um,
    espera a rajada acabar e redesenha uma vez só. */
function renderAllAgendado() {
  clearTimeout(renderAgendado);
  renderAgendado = setTimeout(() => { renderAgendado = null; renderAll(); }, 150);
}

function iniciarRealtime() {
  if (realtimeChannel) return;
  const uid = session.user.id;
  const filtro = `user_id=eq.${uid}`;

  let canal = supabaseClient
    .channel('grana-mudancas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lancamentos', filter: filtro }, (payload) => {
      if (payload.eventType === 'DELETE') {
        state.lancamentos = state.lancamentos.filter(x => x.id !== payload.old.id);
      } else if (payload.eventType === 'INSERT') {
        // Já está na tela: foi este aparelho que criou (ex.: importou agora). Nada a fazer.
        if (state.lancamentos.some(x => x.id === payload.new.id)) return;
        state.lancamentos.push(rowToLancamento(payload.new));
      } else {
        const idx = state.lancamentos.findIndex(x => x.id === payload.new.id);
        if (idx >= 0) state.lancamentos[idx] = rowToLancamento(payload.new);
      }
      renderAllAgendado();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orcamentos', filter: filtro }, (payload) => {
      if (payload.eventType === 'DELETE') delete state.orcamentos[payload.old.categoria];
      else state.orcamentos[payload.new.categoria] = Number(payload.new.valor_planejado);
      renderAllAgendado();
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'config', filter: filtro }, (payload) => {
      if (payload.eventType === 'DELETE') return;
      const cfg = payload.new;
      state.config = { nome: cfg.nome || '', diaPagamento: cfg.dia_pagamento, privacidade: !!cfg.privacidade, tema: cfg.tema || 'claro' };
      state.categorias = (cfg.categorias && cfg.categorias.length) ? cfg.categorias : [...CATEGORIAS_PADRAO];
      aplicarTema(state.config.tema);
      localStorage.setItem(TEMA_LOCAL_KEY, state.config.tema);
      populateCategoriaSelects();
      renderAllAgendado();
    });

  canal = adicionarRealtimeContas(canal, filtro);
  realtimeChannel = canal.subscribe();
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

/** Endereço do site publicado. O link do e-mail de recuperação precisa voltar para um endereço http(s) fixo e permitido no
    Supabase (Authentication → URL Configuration), inclusive quando o pedido sai do app Android/iPhone. */
const URL_DO_SITE = 'https://kafon-s-life.vercel.app';

/** Verdadeiro enquanto a pessoa veio do link "redefinir senha" e ainda não escolheu a senha nova: nesse intervalo o Supabase
    já criou uma sessão, mas ela não pode entrar no app antes de a senha ser trocada. */
let recuperandoSenha = false;

function setAuthMode(mode) {
  authMode = mode;
  document.getElementById('auth-title').textContent = mode === 'entrar' ? 'Entrar' : 'Criar conta';
  document.getElementById('auth-submit').textContent = mode === 'entrar' ? 'Entrar' : 'Criar conta';
  document.getElementById('auth-toggle-entrar').classList.toggle('is-active', mode === 'entrar');
  document.getElementById('auth-toggle-cadastro').classList.toggle('is-active', mode === 'cadastrar');
  document.getElementById('auth-message').hidden = true;
  document.getElementById('auth-esqueci').hidden = mode !== 'entrar';
}

/** Escolhe qual das telas do login aparece: 'entrar' | 'cadastrar' | 'recuperar' | 'novasenha'. */
function mostrarTelaAuth(tela) {
  const entrando = tela === 'entrar' || tela === 'cadastrar';
  document.querySelector('.auth-tabs').hidden = !entrando;
  document.getElementById('form-auth').hidden = !entrando;
  document.getElementById('form-recuperar').hidden = tela !== 'recuperar';
  document.getElementById('form-nova-senha').hidden = tela !== 'novasenha';
  ['recuperar-message', 'nova-senha-message'].forEach(id => { document.getElementById(id).hidden = true; });
  if (entrando) setAuthMode(tela);
  else document.getElementById('auth-title').textContent = tela === 'recuperar' ? 'Recuperar senha' : 'Definir nova senha';
}

function mostrarMensagemAuth(id, texto, ok = false) {
  const el = document.getElementById(id);
  el.textContent = texto;
  el.classList.toggle('auth-message-ok', ok);
  el.hidden = false;
}

function traduzErroAuth(msg) {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/user already registered/i.test(msg)) return 'Já existe uma conta com esse e-mail — tente entrar.';
  if (/password should be at least/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/unable to validate email/i.test(msg)) return 'E-mail inválido.';
  if (/email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar — verifique sua caixa de entrada.';
  if (/failed to fetch/i.test(msg)) return 'Sem conexão com o servidor. Verifique sua internet.';
  if (/rate limit|only request this after|too many/i.test(msg)) return 'Muitas tentativas. Espere um minuto e tente de novo.';
  if (/same password|different from the old/i.test(msg)) return 'A senha nova precisa ser diferente da atual.';
  if (/auth session missing|session.*(expired|missing)/i.test(msg)) return 'O link expirou. Peça um novo em "Esqueci minha senha".';
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

/** Pede o e-mail com o link para redefinir a senha. A resposta é a mesma exista ou não a conta, pra ninguém descobrir
    quais e-mails estão cadastrados. */
async function onSubmitRecuperar(e) {
  e.preventDefault();
  const email = document.getElementById('recuperar-email').value.trim();
  const btn = document.getElementById('recuperar-submit');
  btn.disabled = true;
  document.getElementById('recuperar-message').hidden = true;
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: URL_DO_SITE + '/' });
    if (error) throw error;
    mostrarMensagemAuth('recuperar-message', 'Se existe uma conta com esse e-mail, enviamos o link para criar uma senha nova. Confira também a caixa de spam.', true);
  } catch (err) {
    mostrarMensagemAuth('recuperar-message', traduzErroAuth(err.message));
  }
  btn.disabled = false;
}

/** Salva a senha nova (tela aberta pelo link do e-mail) e então deixa a pessoa entrar no app. */
async function onSubmitNovaSenha(e) {
  e.preventDefault();
  const senha = document.getElementById('nova-senha').value;
  const confirma = document.getElementById('nova-senha-confirma').value;
  const btn = document.getElementById('nova-senha-submit');
  document.getElementById('nova-senha-message').hidden = true;
  if (senha !== confirma) { mostrarMensagemAuth('nova-senha-message', 'As duas senhas não são iguais.'); return; }
  btn.disabled = true;
  try {
    const { error } = await supabaseClient.auth.updateUser({ password: senha });
    if (error) throw error;
    recuperandoSenha = false;
    document.getElementById('form-nova-senha').reset();
    try { history.replaceState(null, '', location.pathname); } catch (err) { /* limpar o endereço é só capricho */ }
    mostrarTelaAuth('entrar');
    showToast('Senha alterada. Você já está dentro.');
    if (session) onSessionReady();
  } catch (err) {
    mostrarMensagemAuth('nova-senha-message', traduzErroAuth(err.message));
  }
  btn.disabled = false;
}

function initAuthScreen() {
  document.getElementById('auth-toggle-entrar').addEventListener('click', () => mostrarTelaAuth('entrar'));
  document.getElementById('auth-toggle-cadastro').addEventListener('click', () => mostrarTelaAuth('cadastrar'));
  document.getElementById('form-auth').addEventListener('submit', onSubmitAuth);
  document.getElementById('auth-esqueci').addEventListener('click', () => {
    document.getElementById('recuperar-email').value = document.getElementById('auth-email').value;
    mostrarTelaAuth('recuperar');
  });
  document.getElementById('recuperar-voltar').addEventListener('click', () => mostrarTelaAuth('entrar'));
  document.getElementById('form-recuperar').addEventListener('submit', onSubmitRecuperar);
  document.getElementById('form-nova-senha').addEventListener('submit', onSubmitNovaSenha);
  document.querySelectorAll('.btn-sair').forEach(b => b.addEventListener('click', async () => {
    await removerInscricaoAoSair();
    await supabaseClient.auth.signOut();
  }));
}

/* ---------- Sair e excluir a conta ---------- */

/** Apaga o que o aparelho guardou depois que alguém sai da conta: os caches do app (que não devem guardar dados de
    ninguém) e as preferências de "último destino". Na exclusão da conta apaga também todas as outras preferências do app. */
async function limparRastrosLocais(tudo = false) {
  try {
    Object.keys(localStorage).filter(k => k.startsWith('grana_ultimo_destino') || (tudo && k.startsWith('grana_'))).forEach(k => localStorage.removeItem(k));
  } catch (e) { /* localStorage pode estar bloqueado */ }
  try {
    if (window.caches) for (const nome of await caches.keys()) await caches.delete(nome);
  } catch (e) { /* sem acesso ao cache: nada a limpar */ }
}

function abrirExcluirConta() {
  document.getElementById('form-excluir-usuario').reset();
  document.getElementById('excluir-erro').hidden = true;
  document.getElementById('btn-confirmar-excluir-usuario').disabled = true;
  closeModal('modal-ajustes');
  openModal('modal-excluir-usuario');
}

async function excluirMinhaConta(e) {
  e.preventDefault();
  if (document.getElementById('excluir-confirma').value.trim().toUpperCase() !== 'EXCLUIR') return;
  const btn = document.getElementById('btn-confirmar-excluir-usuario');
  const erroEl = document.getElementById('excluir-erro');
  btn.disabled = true;
  btn.textContent = 'Excluindo…';
  erroEl.hidden = true;
  try {
    const { data } = await supabaseClient.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) throw new Error('Sua sessão expirou. Entre de novo e tente outra vez.');
    // Dentro do app Android/iPhone a página não é servida pelo site, então o endereço precisa ser o completo.
    const base = document.documentElement.classList.contains('app-nativo') ? URL_DO_SITE : '';
    const resp = await fetch(base + '/api/excluir-conta', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmar: true }),
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(corpo.erro || `erro ${resp.status}`);

    await removerInscricaoAoSair();
    await limparRastrosLocais(true);
    closeModal('modal-excluir-usuario');
    await supabaseClient.auth.signOut({ scope: 'local' });
    showToast('Conta excluída. Todos os seus dados foram apagados.', 7000);
  } catch (err) {
    erroEl.textContent = traduzErroAuth(err.message) || 'Não foi possível excluir agora. Tente de novo.';
    erroEl.hidden = false;
    btn.disabled = false;
  }
  btn.textContent = 'Excluir tudo';
}

function initExcluirConta() {
  document.getElementById('btn-excluir-usuario').addEventListener('click', abrirExcluirConta);
  document.getElementById('excluir-confirma').addEventListener('input', (e) => {
    document.getElementById('btn-confirmar-excluir-usuario').disabled = e.target.value.trim().toUpperCase() !== 'EXCLUIR';
  });
  document.getElementById('form-excluir-usuario').addEventListener('submit', excluirMinhaConta);
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
  renderContasTudo();
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
    await garantirContaPadrao();
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

/** Reage a entrar, sair e ao link de "redefinir senha". */
function aoMudarEstadoAuth(event, newSession) {
  session = newSession;
  if (event === 'PASSWORD_RECOVERY') {
    // Link do e-mail aberto: antes de entrar no app, a pessoa define a senha nova.
    recuperandoSenha = true;
    showAuthScreen();
    mostrarTelaAuth('novasenha');
    return;
  }
  if (recuperandoSenha && session) return; // sessão criada pelo link: só entra depois de trocar a senha
  if (session) {
    onSessionReady();
  } else {
    const estavaLogado = appStarted;
    appStarted = false;
    pararRealtime();
    showAuthScreen();
    if (estavaLogado) limparRastrosLocais(); // saiu da conta: o aparelho não guarda nada dela
  }
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
  initCategoriaRanking();
  initLancamentosTab();
  initContas();
  initContasAVencer();
  initQuantoPosso();
  initImportar();
  initMetasTab();
  initAjustes();
  initExcluirConta();
  initModals();
  initConfirmModal();
  initFaceIdSetting();
  initLembretes();
  initTemaToggle();
  initLoadRetry();
  initLockScreen();
  document.getElementById('btn-privacidade').addEventListener('click', togglePrivacidade);

  // Quem abre o link do e-mail chega com "type=recovery" no endereço. A sessão que o Supabase cria por causa dele
  // costuma ser anunciada antes do evento de recuperação, então marcamos já aqui pra ela não entrar direto no app.
  const dadosDoLink = location.hash + location.search;
  if (/type=recovery/.test(dadosDoLink)) recuperandoSenha = true;
  const linkExpirado = /error_code=otp_expired|error_description=.*(expired|invalid)/i.test(dadosDoLink);

  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    showConfigError('Configuração pendente: edite js/supabase-config.js com a URL e a chave do seu projeto Supabase.');
    return;
  }

  supabaseClient.auth.onAuthStateChange(aoMudarEstadoAuth);

  if (linkExpirado) {
    mostrarTelaAuth('entrar');
    mostrarMensagemAuth('auth-message', 'Esse link expirou ou já foi usado. Toque em "Esqueci minha senha" para receber um novo.');
    try { history.replaceState(null, '', location.pathname); } catch (err) { /* só capricho */ }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
