/* ===================================================================
   GRANA — tela de "Importar extrato" (OFX e CSV).
   A leitura, a detecção de duplicados e a sugestão de categoria ficam em js/importar.js (funções puras e testadas);
   aqui moram o modal, a revisão linha a linha e a gravação.

   Fluxo: escolher o destino (conta ou cartão) e o arquivo -> revisar (cada linha vem marcada como nova, já importada,
   parecida com algo que você já lançou, ou pagamento de fatura) -> importar só o que estiver marcado.
   O arquivo nunca sai do aparelho. O que impede duplicar de verdade é o índice único em lancamentos.import_id. */

const IMPORTAR_TAMANHO_MAX = 5 * 1024 * 1024; // 5 MB
const IMPORTAR_LINHAS_MAX = 3000;
const IMPORTAR_DESTINO_KEY = 'grana_ultimo_destino_importacao'; // separado do destino dos lançamentos: extrato de conta não deve cair no cartão por herança

let importarTexto = null;     // conteúdo do arquivo já decodificado
let importarLinhas = [];      // linhas classificadas, prontas pra revisão
let importarMapaCsv = null;   // { cabecalho, linhaCabecalho } quando o usuário precisou mapear as colunas

/** Arquivos de banco brasileiro costumam ser Windows-1252 (acentos quebrados em UTF-8): tenta UTF-8 e cai pra 1252. */
function decodificarArquivo(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch (e) { return new TextDecoder('windows-1252').decode(buffer); }
}

function importarDestino() {
  const v = $id('importar-destino').value || '';
  if (v.startsWith('k:')) { const cartao = cartaoPorId(v.slice(2)); return { chave: v, contaId: null, cartaoId: cartao ? cartao.id : null, cartao }; }
  return { chave: v, contaId: v.slice(2), cartaoId: null, cartao: null };
}

function popularDestinoImportar(preferido) {
  const sel = $id('importar-destino');
  sel.innerHTML = '';
  const contas = contasAtivas().map(c => [`c:${c.id}`, c.nome]);
  if (contas.length) sel.appendChild(opcaoGrupo('Contas', contas));
  const cartoes = cartoesAtivos().map(k => [`k:${k.id}`, `${k.nome} (fatura do cartão)`]);
  if (cartoes.length) sel.appendChild(opcaoGrupo('Cartões de crédito', cartoes));
  const valido = [...sel.options].some(o => o.value === preferido);
  sel.value = valido ? preferido : (sel.options[0] ? sel.options[0].value : '');
}

function abrirImportar(destinoInicial) {
  if (!contasAtivas().length) { showToast('Crie uma conta antes de importar.'); return; }
  importarTexto = null; importarLinhas = []; importarMapaCsv = null;
  $id('importar-arquivo').value = '';
  const ultimo = destinoInicial || localStorage.getItem(IMPORTAR_DESTINO_KEY) || '';
  popularDestinoImportar(ultimo);
  mostrarPassoImportar(1);
  $id('importar-erro').hidden = true;
  $id('importar-mapa').hidden = true;
  atualizarOpcaoSinal();
  openModal('modal-importar');
}

function mostrarPassoImportar(n) {
  $id('importar-passo1').hidden = n !== 1;
  $id('importar-passo2').hidden = n !== 2;
  $id('importar-titulo').textContent = n === 1 ? 'Importar extrato' : 'Revisar antes de importar';
}

function erroImportar(texto) {
  const el = $id('importar-erro');
  el.textContent = texto;
  el.hidden = !texto;
}

/** O sinal dos valores muda de banco pra banco: na fatura de cartão em CSV, compra é positiva. O padrão acompanha o destino. */
function atualizarOpcaoSinal() {
  const d = importarDestino();
  $id('importar-positivo-saida').checked = !!d.cartao;
}

/** Mostra a escolha do sinal só para CSV (no OFX o sinal já é padronizado). */
function atualizarVisibilidadeSinal() {
  const ehOfx = importarTexto && /<OFX>|<STMTTRN>|OFXHEADER/i.test(importarTexto);
  $id('importar-sinal-linha').hidden = !importarTexto || ehOfx;
}

async function aoEscolherArquivo() {
  const arquivo = $id('importar-arquivo').files[0];
  erroImportar('');
  $id('importar-mapa').hidden = true;
  if (!arquivo) return;
  if (arquivo.size > IMPORTAR_TAMANHO_MAX) { erroImportar('Este arquivo é grande demais (mais de 5 MB). Exporte um período menor no banco.'); return; }
  try {
    importarTexto = decodificarArquivo(await arquivo.arrayBuffer());
  } catch (err) {
    erroImportar('Não consegui ler este arquivo.');
    return;
  }
  importarMapaCsv = null;
  atualizarVisibilidadeSinal();
  processarArquivoImportado();
}

/** Lê o texto, classifica as linhas e abre a revisão (ou pede o mapeamento de colunas). */
function processarArquivoImportado(opcoesLeitura) {
  if (!importarTexto) return;
  const destino = importarDestino();
  const opcoes = { positivoEhSaida: $id('importar-positivo-saida').checked, ...(opcoesLeitura || {}) };
  const leitura = lerExtratoBancario(importarTexto, opcoes);

  if (leitura.precisaMapear) { mostrarMapaColunas(leitura.precisaMapear); return; }
  if (!leitura.linhas.length) {
    erroImportar('Não encontrei lançamentos neste arquivo. Confira se é o extrato em OFX ou CSV e se o período tem movimento.');
    return;
  }
  if (leitura.linhas.length > IMPORTAR_LINHAS_MAX) {
    erroImportar(`O arquivo tem ${leitura.linhas.length} linhas; o limite é ${IMPORTAR_LINHAS_MAX} por vez. Exporte um período menor.`);
    return;
  }

  const comIds = atribuirImportIds(leitura.linhas, destino.chave);
  const existentes = state.lancamentos.map(l => ({
    importId: l.importId, data: l.data, valor: l.valor, tipo: l.tipo, contaId: l.contaId, cartaoId: l.cartaoId,
  }));
  const classificadas = classificarLinhas(comIds, existentes, destino).map(l => {
    // Cartão só guarda despesa: crédito na fatura (estorno, pagamento) não entra como receita.
    if (destino.cartao && l.valor > 0 && l.situacao === 'novo') {
      return { ...l, situacao: 'credito', motivo: 'Crédito no cartão (estorno ou pagamento): o app não importa isso. Pagamentos são registrados em "Pagar fatura".' };
    }
    return l;
  });

  const historico = state.lancamentos.map(l => ({ descricao: l.descricao, categoria: l.categoria, tipo: l.tipo }));
  importarLinhas = classificadas.map(l => ({
    ...l,
    tipo: l.valor < 0 ? 'despesa' : 'receita',
    categoria: sugerirCategoria(l.descricao, l.valor < 0 ? 'despesa' : 'receita', historico, state.categorias).categoria,
    marcada: l.situacao === 'novo',
  }));
  importarMapaCsv = null;
  renderRevisaoImportar(leitura.avisos);
  mostrarPassoImportar(2);
}

function mostrarMapaColunas({ cabecalho, linhaCabecalho }) {
  importarMapaCsv = { cabecalho, linhaCabecalho };
  const opcoes = (sel, comNenhuma) => {
    sel.innerHTML = '';
    if (comNenhuma) sel.appendChild(new Option('—', '-1'));
    cabecalho.forEach((nome, i) => sel.appendChild(new Option(nome || `Coluna ${i + 1}`, String(i))));
  };
  opcoes($id('mapa-data')); opcoes($id('mapa-descricao')); opcoes($id('mapa-valor'));
  // chute inicial: 1ª coluna = data, 2ª = descrição, 3ª = valor
  $id('mapa-data').value = '0';
  $id('mapa-descricao').value = String(Math.min(1, cabecalho.length - 1));
  $id('mapa-valor').value = String(Math.min(2, cabecalho.length - 1));
  $id('importar-mapa').hidden = false;
  erroImportar('');
}

function aplicarMapaColunas() {
  if (!importarMapaCsv) return;
  const mapa = {
    data: parseInt($id('mapa-data').value, 10), descricao: parseInt($id('mapa-descricao').value, 10),
    valor: parseInt($id('mapa-valor').value, 10), debito: -1, credito: -1, id: -1,
  };
  processarArquivoImportado({ mapa, linhaCabecalho: importarMapaCsv.linhaCabecalho });
}

/* ---------- Revisão ---------- */

function renderRevisaoImportar(avisos) {
  const contagem = { novo: 0, importado: 0, semelhante: 0, fatura: 0, credito: 0 };
  importarLinhas.forEach(l => { contagem[l.situacao]++; });
  const datas = importarLinhas.map(l => l.data).sort();
  const chip = (texto, classe = '') => `<span class="imp-chip ${classe}">${texto}</span>`;
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  $id('importar-resumo').innerHTML =
    chip(`${importarLinhas.length} no arquivo · ${formatDateDisplay(datas[0])} a ${formatDateDisplay(datas[datas.length - 1])}`) +
    chip(plural(contagem.novo, 'novo', 'novos'), 'novo') +
    (contagem.importado ? chip(plural(contagem.importado, 'já importado', 'já importados')) : '') +
    (contagem.semelhante ? chip(plural(contagem.semelhante, 'possível duplicado', 'possíveis duplicados'), 'aviso') : '') +
    (contagem.fatura ? chip(plural(contagem.fatura, 'pagamento de fatura', 'pagamentos de fatura'), 'aviso') : '') +
    (contagem.credito ? chip(plural(contagem.credito, 'crédito ignorado', 'créditos ignorados')) : '');

  const dicas = [];
  if (contagem.semelhante) dicas.push('Os "possíveis duplicados" têm o mesmo valor de algo que você já lançou, em data próxima. Vêm desmarcados; marque os que forem compras diferentes.');
  (avisos || []).forEach(a => dicas.push(a));
  const aviso = $id('importar-resumo').nextElementSibling && $id('importar-resumo').nextElementSibling.classList.contains('imp-aviso') ? $id('importar-resumo').nextElementSibling : null;
  if (aviso) aviso.remove();
  if (dicas.length) {
    const p = document.createElement('p');
    p.className = 'imp-aviso';
    p.textContent = dicas.join(' ');
    $id('importar-resumo').after(p);
  }

  const categorias = state.categorias;
  $id('importar-lista').innerHTML = importarLinhas.map((l, i) => {
    const bloqueada = l.situacao === 'importado' || l.situacao === 'credito';
    const opcoesCat = categorias.map(c => `<option value="${escapeHtml(c)}" ${c === l.categoria ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
    const rotuloSituacao = { novo: l.tipo === 'receita' ? 'Receita' : 'Despesa', importado: 'Já importada', semelhante: 'Possível duplicado', fatura: 'Pagamento de fatura', credito: 'Crédito no cartão' }[l.situacao];
    return `
      <label class="imp-linha ${l.situacao} ${bloqueada ? 'desativada' : ''}">
        <input type="checkbox" data-i="${i}" ${l.marcada ? 'checked' : ''} ${bloqueada ? 'disabled' : ''} />
        <span class="imp-info">
          <strong title="${escapeHtml(l.descricao)}">${escapeHtml(l.descricao)}</strong>
          <small>${diaMes(l.data)}/${l.data.slice(0, 4)} · ${rotuloSituacao}${l.motivo ? ' — ' + escapeHtml(l.motivo) : ''}</small>
        </span>
        <span class="imp-valor ${l.tipo === 'receita' ? 'valor-receita' : 'valor-despesa'}">${l.tipo === 'receita' ? '+' : '−'} ${formatCurrency(Math.abs(l.valor))}</span>
        <select class="imp-cat" data-i="${i}" aria-label="Categoria" ${bloqueada ? 'disabled' : ''}>${opcoesCat}</select>
      </label>`;
  }).join('');
  atualizarBotaoImportar();
}

function atualizarBotaoImportar() {
  const n = importarLinhas.filter(l => l.marcada).length;
  const btn = $id('btn-importar-confirmar');
  btn.textContent = n ? `Importar ${n} ${n === 1 ? 'lançamento' : 'lançamentos'}` : 'Nada marcado';
  btn.disabled = n === 0;
}

/* ---------- Gravação ---------- */

async function confirmarImportacao() {
  const selecionadas = importarLinhas.filter(l => l.marcada);
  if (!selecionadas.length) return;
  const destino = importarDestino();
  const btn = $id('btn-importar-confirmar');
  btn.disabled = true;
  btn.textContent = 'Importando…';

  // Sem forma de pagamento na tela: compra no cartão grava "Crédito <nome>" e o resto "Outro" (a coluna continua no banco).
  const forma = destino.cartao ? `Crédito ${destino.cartao.nome}` : 'Outro';
  const linhas = selecionadas.map(l => ({
    user_id: session.user.id,
    data: l.data,
    descricao: l.descricao.slice(0, 120),
    categoria: l.categoria,
    tipo: l.tipo,
    forma_pagamento: forma,
    valor: Math.abs(l.valor),
    status: 'pago',
    conta_id: destino.contaId,
    cartao_id: destino.cartaoId,
    fatura_ref: destino.cartao ? faturaDaCompra(l.data, destino.cartao) : null,
    import_id: l.importId,
  }));

  try {
    let gravadas = 0;
    for (let i = 0; i < linhas.length; i += 200) {
      // ignoreDuplicates: se alguma linha já existe (importada em outro aparelho agora há pouco), o banco pula só ela.
      const { data, error } = await supabaseClient.from('lancamentos')
        .upsert(linhas.slice(i, i + 200), { onConflict: 'user_id,import_id', ignoreDuplicates: true }).select();
      if (error) throw error;
      (data || []).forEach(r => {
        if (!state.lancamentos.some(x => x.id === r.id)) state.lancamentos.push(rowToLancamento(r));
        gravadas++;
      });
    }
    const puladas = linhas.length - gravadas;
    try { localStorage.setItem(IMPORTAR_DESTINO_KEY, destino.chave); } catch (e) { /* só conforto */ }
    // Vai para o mês mais recente importado, para o usuário ver o resultado.
    const ultima = selecionadas.map(l => l.data).sort().pop();
    currentYear = parseInt(ultima.slice(0, 4), 10);
    currentMonth = parseInt(ultima.slice(5, 7), 10) - 1;
    closeModal('modal-importar');
    haptic();
    showToast(`${gravadas} ${gravadas === 1 ? 'lançamento importado' : 'lançamentos importados'}` + (puladas ? `; ${puladas} já existiam e foram pulados` : ''), 4500);
    if (destino.cartao) { abrirFatura(destino.cartaoId, faturaDaCompra(ultima, destino.cartao)); }
    else switchTab('lancamentos');
    renderAll();
  } catch (err) {
    showToast('Erro ao importar: ' + err.message);
    atualizarBotaoImportar();
  }
}

/* ---------- Ligações ---------- */

function initImportar() {
  $id('btn-importar').addEventListener('click', () => abrirImportar());
  $id('importar-arquivo').addEventListener('change', aoEscolherArquivo);
  $id('importar-destino').addEventListener('change', () => { atualizarOpcaoSinal(); if (importarTexto) processarArquivoImportado(); });
  $id('importar-positivo-saida').addEventListener('change', () => { if (importarTexto && !importarMapaCsv) processarArquivoImportado(); });
  $id('btn-aplicar-mapa').addEventListener('click', aplicarMapaColunas);
  $id('btn-importar-voltar').addEventListener('click', () => mostrarPassoImportar(1));
  $id('btn-importar-confirmar').addEventListener('click', confirmarImportacao);

  const lista = $id('importar-lista');
  lista.addEventListener('change', (e) => {
    const i = parseInt(e.target.dataset.i, 10);
    if (Number.isNaN(i) || !importarLinhas[i]) return;
    if (e.target.matches('input[type="checkbox"]')) importarLinhas[i].marcada = e.target.checked;
    else if (e.target.matches('select.imp-cat')) importarLinhas[i].categoria = e.target.value;
    atualizarBotaoImportar();
  });
}
