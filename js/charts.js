/* Gráficos SVG leves, sem dependências externas. */

/* Definidas em css/styles.css para acompanhar o tema claro/escuro. */
const CHART_PALETTE = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)'
];

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

/**
 * Renders a donut chart into `container`.
 * data: [{ label, value }]
 */
function renderPieChart(container, data) {
  container.innerHTML = '';
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!data.length || total <= 0) {
    container.innerHTML = '<div class="chart-empty">Sem despesas neste mês.</div>';
    return;
  }

  const size = 220, r = 80, cx = size / 2, cy = size / 2, strokeW = 34;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, style: 'overflow:visible' });

  let startAngle = -90;
  data.forEach((d, i) => {
    const fraction = d.value / total;
    const angle = fraction * 360;
    const endAngle = startAngle + angle;
    const path = describeArc(cx, cy, r, startAngle, endAngle - (data.length > 1 ? 1.5 : 0));
    const el = svgEl('path', {
      d: path,
      fill: 'none',
      'stroke-width': strokeW,
      'stroke-linecap': data.length > 1 ? 'round' : 'butt'
    });
    el.style.stroke = CHART_PALETTE[i % CHART_PALETTE.length];
    svg.appendChild(el);
    startAngle = endAngle;
  });

  const centerText = svgEl('text', {
    x: cx, y: cy - 6, 'text-anchor': 'middle',
    'font-size': '11', 'font-weight': '600'
  });
  centerText.style.fill = 'var(--text-muted)';
  centerText.textContent = 'TOTAL';
  const centerValue = svgEl('text', {
    x: cx, y: cy + 14, 'text-anchor': 'middle',
    'font-size': '15', 'font-weight': '700'
  });
  centerValue.style.fill = 'var(--text)';
  centerValue.textContent = formatCurrency(total);

  svg.appendChild(centerText);
  svg.appendChild(centerValue);
  container.appendChild(svg);
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  // shift so 0deg = top, matches -90 offset used above
  const s = polarToCartesian(cx, cy, r, startAngle + 90);
  const e = polarToCartesian(cx, cy, r, endAngle + 90);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

function renderPieLegend(container, data) {
  container.innerHTML = '';
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return;
  data.forEach((d, i) => {
    const pct = (d.value / total * 100).toFixed(1);
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot" style="background:${CHART_PALETTE[i % CHART_PALETTE.length]}"></span>${d.label} · ${pct}%`;
    container.appendChild(item);
  });
}

/**
 * Area/line chart of accumulated net worth over time, with a value axis on the
 * left, a zero reference line when the range crosses zero, and the current
 * total called out above the last point — so the shape alone isn't the only
 * thing telling the story.
 * data: [{ label, saldo }]
 */
function renderAreaChart(container, data) {
  container.innerHTML = '';
  if (!data.length) {
    container.innerHTML = '<div class="chart-empty">Sem dados suficientes.</div>';
    return;
  }
  const padLeft = 50, padRight = 10, padTop = 34, padBottom = 26;
  const plotW = Math.max(260, data.length * 40);
  const width = padLeft + padRight + plotW;
  const height = 240;
  const plotH = height - padTop - padBottom;

  const values = data.map(d => d.saldo);
  const maxVal = Math.max(...values, 0);
  const minVal = Math.min(...values, 0);
  const range = (maxVal - minVal) || 1;
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;
  const yFor = (v) => padTop + plotH - ((v - minVal) / range) * plotH;

  const points = data.map((d, i) => ({ x: padLeft + stepX * i, y: yFor(d.saldo), d }));

  const last = data[data.length - 1];
  const color = last.saldo >= 0 ? 'var(--income)' : 'var(--expense)';

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, preserveAspectRatio: 'xMidYMax meet' });

  // Eixo de referência: três níveis (topo, meio, base) pra dar noção de escala real, não só a forma da curva.
  [maxVal, (maxVal + minVal) / 2, minVal].forEach(v => {
    const y = yFor(v);
    const gridLine = svgEl('line', { x1: padLeft, y1: y, x2: padLeft + plotW, y2: y, 'stroke-width': 1 });
    gridLine.style.stroke = 'var(--border)';
    svg.appendChild(gridLine);
    const gridLabel = svgEl('text', { x: padLeft - 8, y: y + 3, 'text-anchor': 'end', 'font-size': '9.5' });
    gridLabel.style.fill = 'var(--text-faint)';
    gridLabel.textContent = formatCompactCurrency(v);
    svg.appendChild(gridLabel);
  });

  // Linha de zero tracejada, só quando o período passa de negativo pra positivo (senão já é uma das linhas acima).
  if (minVal < 0 && maxVal > 0) {
    const zeroY = yFor(0);
    const zeroLine = svgEl('line', {
      x1: padLeft, y1: zeroY, x2: padLeft + plotW, y2: zeroY,
      'stroke-width': 1, 'stroke-dasharray': '3 3'
    });
    zeroLine.style.stroke = 'var(--text-faint)';
    svg.appendChild(zeroLine);
  }

  const gradId = 'evo-grad-' + Math.random().toString(36).slice(2, 8);
  const defs = svgEl('defs', {});
  const grad = svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
  const stop1 = svgEl('stop', { offset: '0%' });
  stop1.style.stopColor = color; stop1.style.stopOpacity = '0.22';
  const stop2 = svgEl('stop', { offset: '100%' });
  stop2.style.stopColor = color; stop2.style.stopOpacity = '0';
  grad.appendChild(stop1); grad.appendChild(stop2);
  defs.appendChild(grad);
  svg.appendChild(defs);

  const lineStr = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const baseY = padTop + plotH;
  const areaStr = `${points[0].x.toFixed(1)},${baseY} ${lineStr} ${points[points.length - 1].x.toFixed(1)},${baseY}`;

  svg.appendChild(svgEl('polygon', { points: areaStr, fill: `url(#${gradId})` }));

  const line = svgEl('polyline', {
    points: lineStr, fill: 'none', 'stroke-width': 2.5,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  });
  line.style.stroke = color;
  svg.appendChild(line);

  points.forEach((p, i) => {
    const dot = svgEl('circle', { cx: p.x, cy: p.y, r: i === points.length - 1 ? 4 : 2.5 });
    dot.style.fill = color;
    svg.appendChild(dot);
  });

  // Chama o valor atual acima do último ponto — é o número que resume o gráfico inteiro.
  const lastPoint = points[points.length - 1];
  const valueLabel = svgEl('text', {
    x: Math.min(lastPoint.x, padLeft + plotW), y: Math.max(padTop - 14, lastPoint.y - 14),
    'text-anchor': 'end', 'font-size': '13', 'font-weight': '700'
  });
  valueLabel.style.fill = color;
  valueLabel.textContent = formatCurrency(last.saldo);
  svg.appendChild(valueLabel);

  const labelEvery = data.length > 8 ? 2 : 1;
  points.forEach((p, i) => {
    const isLast = i === points.length - 1;
    if (i % labelEvery !== 0 && !isLast) return;
    const label = svgEl('text', {
      x: p.x, y: height - 6,
      'text-anchor': isLast ? 'end' : (i === 0 ? 'start' : 'middle'),
      'font-size': '10.5'
    });
    label.style.fill = 'var(--text-muted)';
    label.textContent = p.d.label;
    svg.appendChild(label);
  });

  container.appendChild(svg);
}
