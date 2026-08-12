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
 * Grouped bar chart comparing income vs expense per month.
 * data: [{ label, receita, despesa }]
 */
function renderBarChart(container, data) {
  container.innerHTML = '';
  if (!data.length) {
    container.innerHTML = '<div class="chart-empty">Sem dados suficientes.</div>';
    return;
  }
  const maxVal = Math.max(1, ...data.map(d => Math.max(d.receita, d.despesa)));
  const width = Math.max(320, data.length * 64);
  const height = 220;
  const padBottom = 26, padTop = 10;
  const plotH = height - padBottom - padTop;
  const groupW = width / data.length;
  const barW = Math.min(18, groupW / 4);

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, preserveAspectRatio: 'xMidYMax meet' });

  data.forEach((d, i) => {
    const gx = groupW * i + groupW / 2;
    const hReceita = (d.receita / maxVal) * plotH;
    const hDespesa = (d.despesa / maxVal) * plotH;

    const barReceita = svgEl('rect', {
      x: gx - barW - 3, y: padTop + (plotH - hReceita),
      width: barW, height: Math.max(hReceita, 0), rx: 3
    });
    barReceita.style.fill = 'var(--income)';
    svg.appendChild(barReceita);

    const barDespesa = svgEl('rect', {
      x: gx + 3, y: padTop + (plotH - hDespesa),
      width: barW, height: Math.max(hDespesa, 0), rx: 3
    });
    barDespesa.style.fill = 'var(--expense)';
    svg.appendChild(barDespesa);

    const label = svgEl('text', {
      x: gx, y: height - 6, 'text-anchor': 'middle',
      'font-size': '10.5'
    });
    label.style.fill = 'var(--text-muted)';
    label.textContent = d.label;
    svg.appendChild(label);
  });

  container.appendChild(svg);
}
