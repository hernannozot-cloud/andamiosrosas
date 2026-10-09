'use strict';
// Gráfico de cotizaciones generadas por día y por mes (SVG propio, sin librerías).
// Se carga ANTES de app.js; usa ayudantes de app.js/cotizaciones.js (esc, $, $$, hoyStr, sumaDias) al ejecutarse.
let grafModo = 'dia', grafDias = 30;
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ESTATUS_GRAF = [['Contratada', 'gr-c'], ['Pendiente', 'gr-p'], ['No contratada', 'gr-n']];

function cubetasCotizaciones(cots, modo, dias) {
  const hoyS = hoyStr();
  let llaves = [];
  if (modo === 'dia') {
    for (let i = dias - 1; i >= 0; i--) llaves.push(sumaDias(hoyS, -i));
  } else {
    let [y, m] = ([...cots.map(c => c.fecha.slice(0, 7))].sort()[0] || hoyS.slice(0, 7)).split('-').map(Number);
    const [yf, mf] = hoyS.slice(0, 7).split('-').map(Number);
    while (y < yf || (y === yf && m <= mf)) { llaves.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
    llaves = llaves.slice(-24);
  }
  const mapa = new Map(llaves.map(k => [k, { k, Contratada: 0, Pendiente: 0, 'No contratada': 0, total: 0 }]));
  for (const c of cots) {
    const b = mapa.get(modo === 'dia' ? c.fecha : c.fecha.slice(0, 7));
    if (b) { b[c.estatus]++; b.total++; }
  }
  return llaves.map(k => mapa.get(k));
}
function etiquetaCubeta(k, modo) {
  if (modo === 'dia') { const [, m, d] = k.split('-').map(Number); return `${d} ${MESES_CORTOS[m - 1]}`; }
  const [y, m] = k.split('-').map(Number); return `${MESES_CORTOS[m - 1]} ${String(y).slice(2)}`;
}
function textoCubeta(b, modo) {
  const partes = ESTATUS_GRAF.filter(([e]) => b[e]).map(([e]) => `${b[e]} ${e.toLowerCase()}${b[e] === 1 || e === 'Pendiente' ? '' : 's'}`);
  const cuando = modo === 'dia' ? fecha(b.k) : etiquetaCubeta(b.k, 'mes');
  return `${cuando}: ${b.total} ${b.total === 1 ? 'cotización' : 'cotizaciones'}${partes.length ? ` (${partes.join(', ')})` : ''}`;
}

function svgGraficoCotizaciones(cubs, modo, W) {
  const H = 230, L = 32, R = 8, T = 18, B = 34, pw = W - L - R, ph = H - T - B; // W = ancho real en pantalla: el texto se ve a tamaño normal
  const maxV = Math.max(1, ...cubs.map(b => b.total));
  const paso = maxV <= 5 ? 1 : maxV <= 10 ? 2 : Math.ceil(maxV / 5);
  const techo = Math.ceil(maxV / paso) * paso;
  const n = cubs.length, bw = pw / n, barra = Math.min(bw * 0.74, 48), cada = Math.ceil(n / Math.max(4, Math.floor(pw / 46)));
  const yv = v => T + ph - (v / techo) * ph;
  let g = '';
  for (let v = 0; v <= techo; v += paso) g += `<line x1="${L}" x2="${W - R}" y1="${yv(v)}" y2="${yv(v)}" class="gr-grid"/><text x="${L - 6}" y="${yv(v) + 3}" text-anchor="end">${v}</text>`;
  cubs.forEach((b, i) => {
    const x = L + i * bw + (bw - barra) / 2;
    let acum = 0, segs = '';
    for (const [e, cls] of ESTATUS_GRAF) {
      if (!b[e]) continue;
      segs += `<rect class="${cls}" x="${x.toFixed(1)}" y="${yv(acum + b[e]).toFixed(1)}" width="${barra.toFixed(1)}" height="${(b[e] / techo * ph).toFixed(1)}" rx="2"/>`;
      acum += b[e];
    }
    const valor = b.total && bw >= 13 ? `<text x="${(x + barra / 2).toFixed(1)}" y="${yv(b.total) - 4}" text-anchor="middle" class="gr-v">${b.total}</text>` : '';
    const eje = i % cada === 0 || i === n - 1 ? `<text x="${(x + barra / 2).toFixed(1)}" y="${H - 14}" text-anchor="middle">${esc(etiquetaCubeta(b.k, modo))}</text>` : '';
    g += `<g><title>${esc(textoCubeta(b, modo))}</title><rect x="${(L + i * bw).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ph}" fill="transparent"/>${segs}${valor}${eje}</g>`;
  });
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cotizaciones generadas">${g}</svg>`;
}

function pintarGraficoCotizaciones(cots) {
  const cont = $('#grafCot');
  const cubs = cubetasCotizaciones(cots, grafModo, grafDias);
  const total = cubs.reduce((s, b) => s + b.total, 0);
  const mejor = cubs.reduce((a, b) => (b.total > a.total ? b : a), cubs[0]);
  const resumen = grafModo === 'dia'
    ? `${total} ${total === 1 ? 'cotización' : 'cotizaciones'} en los últimos ${grafDias} días · promedio ${(total / grafDias).toFixed(1)} por día${mejor?.total ? ` · día con más: ${fecha(mejor.k)} (${mejor.total})` : ''}`
    : `${total} ${total === 1 ? 'cotización' : 'cotizaciones'} en ${cubs.length} mes${cubs.length === 1 ? '' : 'es'} · promedio ${(total / cubs.length).toFixed(1)} por mes${mejor?.total ? ` · mes con más: ${etiquetaCubeta(mejor.k, 'mes')} (${mejor.total})` : ''}`;
  cont.innerHTML = `<div class="card"><div class="toolbar" style="margin-bottom:4px"><h3 style="margin:0">Cotizaciones generadas</h3><span class="spacer"></span>
      <button class="chip ${grafModo === 'dia' ? 'on' : ''}" data-gm="dia">Por día</button><button class="chip ${grafModo === 'mes' ? 'on' : ''}" data-gm="mes">Por mes</button>
      ${grafModo === 'dia' ? `<select id="grafDias" style="width:auto">${[30, 60, 90].map(d => `<option value="${d}" ${d === grafDias ? 'selected' : ''}>Últimos ${d} días</option>`).join('')}</select>` : ''}</div>
    ${svgGraficoCotizaciones(cubs, grafModo, Math.max(300, Math.round(cont.clientWidth - 34)))}
    <div class="leyenda"><span class="gr-c">Contratada</span><span class="gr-p">Pendiente</span><span class="gr-n">No contratada</span></div>
    <p class="muted" style="margin:6px 0 0">${resumen}</p></div>`;
  $$('[data-gm]', cont).forEach(b => b.onclick = () => { grafModo = b.dataset.gm; pintarGraficoCotizaciones(cots); });
  const sel = $('#grafDias', cont);
  if (sel) sel.onchange = () => { grafDias = Number(sel.value); pintarGraficoCotizaciones(cots); };
}
