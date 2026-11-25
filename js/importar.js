/* GRANA — importar extrato do banco (OFX e CSV).
   Funções puras (sem tela e sem banco), testadas por scripts/testar-importar.js.

   Cada linha lida vira { data: 'aaaa-mm-dd', descricao, valor, idExterno }, com valor NEGATIVO para dinheiro que
   saiu e POSITIVO para o que entrou (o app decide receita/despesa por esse sinal). idExterno é o identificador
   que o banco dá à transação (FITID no OFX, "Identificador" em alguns CSVs), quando existe.

   Sem duplicar: cada linha ganha um import_id estável (o do banco, ou um hash de data+valor+descrição com contagem
   de ocorrências). Reimportar o mesmo arquivo gera os mesmos ids e é barrado pelo índice único do banco. */

(function (raiz) {
  const semAcento = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* ---------- Números e datas ---------- */

  /** "1.234,56", "-45,90", "R$ 12.50", "(45,90)", "45,90-" -> número. null se não for número. */
  function lerValor(bruto) {
    if (bruto === null || bruto === undefined) return null;
    let t = String(bruto).trim().replace(/R\$|\s/g, '');
    if (!t) return null;
    let negativo = false;
    if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1); }
    if (t.endsWith('-')) { negativo = true; t = t.slice(0, -1); }
    if (t.startsWith('-')) { negativo = !negativo ? true : false; t = t.slice(1); }
    else if (t.startsWith('+')) t = t.slice(1);
    if (!/^[\d.,]+$/.test(t)) return null;
    const temPonto = t.includes('.'), temVirgula = t.includes(',');
    if (temPonto && temVirgula) {
      // o último separador é o decimal
      if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
      else t = t.replace(/,/g, '');
    } else if (temVirgula) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else if (temPonto && /^\d{1,3}(\.\d{3})+$/.test(t)) {
      t = t.replace(/\./g, ''); // 1.234 = mil duzentos e trinta e quatro
    }
    const n = parseFloat(t);
    if (!isFinite(n)) return null;
    return Math.round((negativo ? -n : n) * 100) / 100;
  }

  /** dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd, dd-mm-aaaa, aaaammdd (OFX). null se não for data válida. */
  function lerData(bruto) {
    const t = String(bruto || '').trim();
    let m;
    let a, mes, d;
    if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) { a = +m[1]; mes = +m[2]; d = +m[3]; }
    else if ((m = t.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})/))) { d = +m[1]; mes = +m[2]; a = +m[3]; }
    else if ((m = t.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{2})\b/))) { d = +m[1]; mes = +m[2]; a = 2000 + +m[3]; }
    else if ((m = t.match(/^(\d{4})(\d{2})(\d{2})/))) { a = +m[1]; mes = +m[2]; d = +m[3]; }
    else return null;
    if (mes < 1 || mes > 12 || d < 1 || d > 31 || a < 1990 || a > 2100) return null;
    const ultimo = new Date(a, mes, 0).getDate();
    if (d > ultimo) return null;
    return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /* ---------- OFX ---------- */

  const TIPOS_DE_SAIDA = new Set(['DEBIT', 'PAYMENT', 'CHECK', 'ATM', 'POS', 'FEE', 'SRVCHG', 'DIRECTDEBIT', 'REPEATPMT']);

  function etiqueta(bloco, nome) {
    // OFX 1.x (SGML) não fecha as tags: o valor vai até o próximo "<" ou quebra de linha; OFX 2.x (XML) fecha.
    const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  }

  function decodificarEntidades(t) {
    return t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }

  function lerOfx(texto) {
    const linhas = [];
    const avisos = [];
    const blocos = texto.split(/<STMTTRN>/i).slice(1);
    for (const bruto of blocos) {
      const bloco = bruto.split(/<\/STMTTRN>/i)[0].split(/<\/BANKTRANLIST>/i)[0];
      const data = lerData(etiqueta(bloco, 'DTPOSTED'));
      let valor = lerValor(etiqueta(bloco, 'TRNAMT'));
      if (!data || valor === null) { avisos.push('Uma transação do arquivo não tinha data ou valor e foi ignorada.'); continue; }
      const tipo = etiqueta(bloco, 'TRNTYPE').toUpperCase();
      if (valor > 0 && TIPOS_DE_SAIDA.has(tipo)) valor = -valor; // alguns bancos mandam o valor sem sinal e dizem o tipo
      const memo = decodificarEntidades(etiqueta(bloco, 'MEMO')), nome = decodificarEntidades(etiqueta(bloco, 'NAME'));
      const descricao = (memo || nome || tipo || 'Sem descrição').replace(/\s+/g, ' ').trim();
      linhas.push({ data, descricao, valor, idExterno: etiqueta(bloco, 'FITID') || null });
    }
    return { formato: 'ofx', linhas, avisos };
  }

  /* ---------- CSV ---------- */

  function dividirLinhasCsv(texto, sep) {
    const linhas = [];
    let campo = '', linha = [], aspas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (aspas) {
        if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
        else if (c === '"') aspas = false;
        else campo += c;
      } else if (c === '"') aspas = true;
      else if (c === sep) { linha.push(campo); campo = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && texto[i + 1] === '\n') i++;
        linha.push(campo); campo = '';
        if (linha.some(x => x.trim() !== '')) linhas.push(linha);
        linha = [];
      } else campo += c;
    }
    linha.push(campo);
    if (linha.some(x => x.trim() !== '')) linhas.push(linha);
    return linhas;
  }

  function detectarSeparador(texto) {
    const amostra = texto.split(/\r?\n/).filter(l => l.trim()).slice(0, 12).join('\n');
    const contar = (c) => (amostra.match(new RegExp(c === '\t' ? '\\t' : '\\' + c, 'g')) || []).length;
    const opcoes = [';', ',', '\t'].map(c => [c, contar(c)]).sort((a, b) => b[1] - a[1]);
    return opcoes[0][1] > 0 ? opcoes[0][0] : ',';
  }

  const NOMES = {
    data: ['data', 'date', 'data lancamento', 'data do lancamento', 'data da compra', 'data movimentacao', 'data mov', 'dt', 'dia'],
    descricao: ['descricao', 'description', 'historico', 'titulo', 'title', 'estabelecimento', 'lancamento', 'detalhe', 'detalhes', 'memo', 'nome', 'transacao'],
    valor: ['valor', 'amount', 'value', 'quantia', 'valor (r$)', 'valor r$'],
    debito: ['debito', 'debitos', 'saida', 'saidas'],
    credito: ['credito', 'creditos', 'entrada', 'entradas'],
    id: ['identificador', 'id', 'fitid', 'documento', 'nsu', 'codigo', 'protocolo'],
  };

  function achaColuna(cabecalho, nomes) {
    const norm = cabecalho.map(h => semAcento(h).replace(/[^a-z0-9 ()$]/g, '').trim());
    for (const nome of nomes) { const i = norm.indexOf(nome); if (i >= 0) return i; }
    for (const nome of nomes) { const i = norm.findIndex(h => h.startsWith(nome + ' ') || h.endsWith(' ' + nome)); if (i >= 0) return i; }
    return -1;
  }

  function detectarMapa(cabecalho) {
    const mapa = {
      data: achaColuna(cabecalho, NOMES.data), descricao: achaColuna(cabecalho, NOMES.descricao),
      valor: achaColuna(cabecalho, NOMES.valor), debito: achaColuna(cabecalho, NOMES.debito),
      credito: achaColuna(cabecalho, NOMES.credito), id: achaColuna(cabecalho, NOMES.id),
    };
    const temValor = mapa.valor >= 0 || (mapa.debito >= 0 && mapa.credito >= 0);
    return { mapa, completo: mapa.data >= 0 && mapa.descricao >= 0 && temValor };
  }

  /** Acha a linha do cabeçalho (alguns bancos põem dados da conta antes) olhando as primeiras 15 linhas. */
  function acharCabecalho(linhas) {
    for (let i = 0; i < Math.min(linhas.length, 15); i++) {
      const { completo } = detectarMapa(linhas[i]);
      if (completo) return i;
    }
    return -1;
  }

  /** opcoes: { mapa } (para quando o cabecalho não foi reconhecido) e { positivoEhSaida } (fatura de cartão em CSV). */
  function lerCsv(texto, opcoes = {}) {
    const sep = detectarSeparador(texto);
    const linhas = dividirLinhasCsv(texto, sep);
    const avisos = [];
    let idxCab = acharCabecalho(linhas);
    let mapa;
    if (opcoes.mapa) { mapa = opcoes.mapa; idxCab = opcoes.linhaCabecalho !== undefined ? opcoes.linhaCabecalho : 0; }
    else if (idxCab >= 0) mapa = detectarMapa(linhas[idxCab]).mapa;
    if (!mapa) {
      const cab = linhas[0] || [];
      return { formato: 'csv', linhas: [], avisos, precisaMapear: { cabecalho: cab, amostra: linhas.slice(1, 4), linhaCabecalho: 0 } };
    }
    const saida = [];
    let ignoradas = 0;
    for (const campos of linhas.slice(idxCab + 1)) {
      const data = lerData(campos[mapa.data]);
      let valor;
      if (mapa.valor >= 0) valor = lerValor(campos[mapa.valor]);
      else {
        const deb = lerValor(campos[mapa.debito]) || 0, cre = lerValor(campos[mapa.credito]) || 0;
        valor = (deb || cre) ? Math.round((Math.abs(cre) - Math.abs(deb)) * 100) / 100 : null;
      }
      if (!data || valor === null || valor === 0) { ignoradas++; continue; }
      if (opcoes.positivoEhSaida) valor = -valor;
      const descricao = (campos[mapa.descricao] || '').replace(/\s+/g, ' ').trim() || 'Sem descrição';
      const idExterno = mapa.id >= 0 && (campos[mapa.id] || '').trim() ? campos[mapa.id].trim() : null;
      saida.push({ data, descricao, valor, idExterno });
    }
    if (ignoradas) avisos.push(`${ignoradas} ${ignoradas === 1 ? 'linha foi ignorada' : 'linhas foram ignoradas'} (sem data ou valor válidos, como saldos e totais).`);
    return { formato: 'csv', linhas: saida, avisos, mapa };
  }

  /** Lê o conteúdo do arquivo e decide o formato pelo conteúdo, não só pela extensão. */
  function lerExtrato(texto, opcoes = {}) {
    const limpo = texto.replace(/^﻿/, '');
    if (/<OFX>|<STMTTRN>|OFXHEADER/i.test(limpo)) return lerOfx(limpo);
    return lerCsv(limpo, opcoes);
  }

  /* ---------- Duplicados ---------- */

  /** Hash curto e estável (cyrb53) de um texto. */
  function hashTexto(t) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < t.length; i++) {
      const ch = t.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  /** Dá um import_id a cada linha. destinoChave identifica a conta/cartão ("c:<id>" ou "k:<id>"). Linhas idênticas dentro
      do mesmo arquivo (dois cafés de R$ 6 no mesmo dia) recebem contagens diferentes e continuam distintas. */
  function atribuirImportIds(linhas, destinoChave) {
    const vistos = {};
    return linhas.map(l => {
      let id;
      if (l.idExterno) {
        const base = `${destinoChave}:${l.idExterno}`;
        vistos[base] = (vistos[base] || 0) + 1;
        id = vistos[base] > 1 ? `${base}#${vistos[base]}` : base; // o banco repetiu o id dentro do arquivo: ainda distingue
      } else {
        const base = `${destinoChave}:h${hashTexto(`${l.data}|${l.valor.toFixed(2)}|${semAcento(l.descricao).replace(/\s+/g, ' ')}`)}`;
        vistos[base] = (vistos[base] || 0) + 1;
        id = `${base}#${vistos[base]}`;
      }
      return { ...l, importId: id };
    });
  }

  function diasEntreIso(a, b) {
    const [a1, m1, d1] = a.split('-').map(Number), [a2, m2, d2] = b.split('-').map(Number);
    return Math.round((new Date(a2, m2 - 1, d2) - new Date(a1, m1 - 1, d1)) / 86400000);
  }

  const REGEX_PAGAMENTO_FATURA = /pagamento (de )?fatura|pgto\.? (de )?fatura|pag\.? fatura|fatura (do )?cart[aã]o|pagamento recebido|pagamento on ?line|credito de pagamento/i;

  /** Marca cada linha: 'novo', 'importado' (mesmo import_id já existe), 'semelhante' (mesmo valor, até 2 dias de diferença,
      mesmo destino: provavelmente você já lançou à mão) ou 'fatura' (parece pagamento de fatura, que o app registra em "Pagar fatura").
      existentes: [{ importId, data, valor (positivo), tipo ('receita'|'despesa'), contaId, cartaoId }] */
  function classificarLinhas(linhas, existentes, destino) {
    const ids = new Set(existentes.map(e => e.importId).filter(Boolean));
    const doDestino = existentes.filter(e => destino.cartaoId ? e.cartaoId === destino.cartaoId : e.contaId === destino.contaId);
    const usados = new Set();
    return linhas.map(l => {
      if (ids.has(l.importId)) return { ...l, situacao: 'importado', motivo: 'Já foi importada antes.' };
      const tipo = l.valor < 0 ? 'despesa' : 'receita';
      const sem = doDestino.findIndex((e, i) => !usados.has(i) && e.tipo === tipo && Math.abs(e.valor - Math.abs(l.valor)) < 0.005 && Math.abs(diasEntreIso(e.data, l.data)) <= 2);
      if (sem >= 0) { usados.add(sem); return { ...l, situacao: 'semelhante', motivo: 'Parece já lançada: mesmo valor em data próxima.' }; }
      if (REGEX_PAGAMENTO_FATURA.test(semAcento(l.descricao)) || REGEX_PAGAMENTO_FATURA.test(l.descricao)) {
        return { ...l, situacao: 'fatura', motivo: 'Parece pagamento de fatura. O app já registra isso em "Pagar fatura"; importar aqui contaria duas vezes.' };
      }
      return { ...l, situacao: 'novo', motivo: '' };
    });
  }

  /* ---------- Categoria sugerida ---------- */

  const RUIDO = new Set(['compra', 'debito', 'credito', 'pix', 'pagamento', 'pagto', 'pgto', 'transferencia', 'enviada', 'recebida', 'enviado', 'recebido',
    'cartao', 'via', 'com', 'para', 'por', 'dos', 'das', 'sao', 'ltda', 'eireli', 'sa', 'brasil', 'br', 'cpf', 'cnpj', 'ref', 'doc', 'ted', 'on', 'line']);

  function tokens(descricao) {
    return semAcento(descricao).replace(/[0-9]+/g, ' ').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !RUIDO.has(t));
  }

  /** [regex da descrição, nomes de categoria que combinam (trechos do nome, sem acento)] */
  const REGRAS = [
    [/\buber\b|\b99\b|99pop|\btaxi\b|cabify|onibus|\bmetro\b|bilhete unico|pedagio|estaciona|sem parar|veloe/, ['transporte', 'carro', 'veiculo', 'mobilidade']],
    [/\bposto\b|combustiv|\bshell\b|ipiranga|petrobras|gasolina|etanol/, ['transporte', 'combustivel', 'carro', 'veiculo']],
    [/ifood|rappi|uber eats|restaurante|lanchonete|pizzaria|padaria|burger|mcdonald|\bsubway\b|sushi|acai|\bcafe\b|cafeteria|\bbar\b|churrasc/, ['restaurante', 'delivery', 'alimenta', 'lazer']],
    [/mercado|supermerc|atacad|assai|carrefour|\bextra\b|pao de acucar|hortifruti|acougue|sacolao|\bfeira\b/, ['mercado', 'alimenta', 'supermercado']],
    [/netflix|spotify|disney|\bhbo\b|prime video|amazon prime|globoplay|youtube|deezer|apple\.com|icloud|google (one|storage)|assinatura|mensalidade/, ['assinatura', 'streaming', 'lazer']],
    [/farmacia|drogaria|drogasil|\braia\b|pacheco|panvel|hospital|clinica|laboratorio|dentista|\bmedic|consulta|unimed|plano de saude|\bamil\b/, ['saude', 'farmacia']],
    [/aluguel|condominio|iptu|imobiliaria|financiamento imob/, ['moradia', 'casa', 'aluguel']],
    [/\bluz\b|energia|\benel\b|cpfl|cemig|\blight\b|sabesp|copasa|saneamento|\bagua\b|internet|\bvivo\b|\bclaro\b|\btim\b|\boi\b|\bnet\b|telefon|comgas|\bgas\b/, ['moradia', 'contas', 'casa']],
    [/escola|faculdade|\bcurso\b|udemy|alura|coursera|livraria|matricula|universidade|\bidioma\b|\bingles\b/, ['educa', 'estudo']],
    [/academia|smartfit|bluefit|crossfit|\besporte\b|decathlon|suplement/, ['esporte', 'saude', 'lazer']],
    [/cinema|ingresso|teatro|\bshow\b|\bsteam\b|playstation|xbox|nintendo|\bgames?\b|\bbet(365|nacional|ano)?\b|cassino|loteria/, ['lazer', 'entreten', 'jogo', 'aposta']],
    [/\bamazon\b|mercado ?livre|magazine|magalu|shopee|shein|aliexpress|americanas|renner|riachuelo|\bzara\b|c&a|\bloja\b|shopping|vestuario|calcado/, ['compras', 'lazer', 'outros']],
    [/salario|folha de pagamento|remuneracao|proventos|\b13o\b|decimo terceiro|\bferias\b/, ['salario', 'renda', 'receita', 'outros']],
    [/rendimento|dividendo|\bjuros\b|cashback|estorno|reembolso/, ['rendimento', 'investimento', 'receita', 'outros']],
  ];

  function acharCategoriaPorNome(nomes, categorias) {
    for (const n of nomes) {
      const achada = categorias.find(c => semAcento(c).includes(n));
      if (achada) return achada;
    }
    return null;
  }

  /** Sugere a categoria: primeiro pelo que você já lançou parecido, depois por palavras-chave, por último "Outros".
      historico: [{ descricao, categoria, tipo }]; categorias: nomes das categorias do usuário. */
  function sugerirCategoria(descricao, tipo, historico, categorias) {
    const alvo = new Set(tokens(descricao));
    const normAlvo = semAcento(descricao).replace(/[0-9]+/g, '').replace(/\s+/g, ' ').trim();
    if (alvo.size) {
      const pontos = {};
      for (const h of historico) {
        if (h.tipo !== tipo || !categorias.includes(h.categoria)) continue;
        const outros = new Set(tokens(h.descricao));
        if (!outros.size) continue;
        const comuns = [...alvo].filter(t => outros.has(t)).length;
        if (!comuns) continue;
        const jaccard = comuns / new Set([...alvo, ...outros]).size;
        const exato = semAcento(h.descricao).replace(/[0-9]+/g, '').replace(/\s+/g, ' ').trim() === normAlvo;
        pontos[h.categoria] = (pontos[h.categoria] || 0) + (exato ? 2 : jaccard);
      }
      const melhor = Object.entries(pontos).sort((a, b) => b[1] - a[1])[0];
      if (melhor && melhor[1] >= 0.5) return { categoria: melhor[0], origem: 'historico' };
    }
    const texto = semAcento(descricao);
    for (const [regex, nomes] of REGRAS) {
      if (regex.test(texto)) {
        const c = acharCategoriaPorNome(nomes, categorias);
        if (c) return { categoria: c, origem: 'regra' };
      }
    }
    return { categoria: categoriaPadrao(tipo, categorias), origem: 'padrao' };
  }

  /** Categoria de partida quando não há pista melhor. Despesa: "Outros" (ou a primeira da lista).
      Receita: também "Outros", mas se a lista não tiver, a ÚLTIMA — a primeira costuma ser algo de gasto, como "Moradia". */
  function categoriaPadrao(tipo, categorias) {
    const outros = acharCategoriaPorNome(['outros', 'diversos'], categorias);
    if (tipo === 'receita') return outros || categorias[categorias.length - 1] || '';
    return outros || categorias[0] || '';
  }

  const api = { lerValor, lerData, lerExtrato, lerOfx, lerCsv, atribuirImportIds, classificarLinhas, sugerirCategoria, categoriaPadrao, hashTexto };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, { lerExtratoBancario: lerExtrato, lerNumeroBR: lerValor, lerDataBR: lerData, atribuirImportIds, classificarLinhas, sugerirCategoria, categoriaPadrao, hashTexto });
})(typeof window !== 'undefined' ? window : globalThis);
