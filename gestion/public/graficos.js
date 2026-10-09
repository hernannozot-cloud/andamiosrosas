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

// ---------- Ventas por mes (cobrado + por cobrar) ----------
function pasoBonito(maxV) { // paso "redondo" (1, 2, 5 × 10^k) para ~4 líneas de guía
  const crudo = maxV / 4, pot = 10 ** Math.floor(Math.log10(crudo)), f = crudo / pot;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pot;
}
const compacto = n => n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : `$${Math.round(n)}`;

function cubetasVentas(datos) {
  const hoyMes = hoyStr().slice(0, 7);
  const porMes = new Map(datos.map(d => [d.mes, d]));
  const fin = [hoyMes, datos.at(-1)?.mes || hoyMes].sort().at(-1);
  let [y, m] = (datos[0]?.mes || hoyMes).split('-').map(Number);
  const [yf, mf] = fin.split('-').map(Number), llaves = [];
  while (y < yf || (y === yf && m <= mf)) { llaves.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  return llaves.slice(-24).map(k => porMes.get(k) || { mes: k, rentas: 0, total: 0, sinIva: 0, iva: 0, cobrado: 0, porCobrar: 0 });
}

function svgGraficoVentas(cubs, W) {
  const H = 240, L = 44, R = 8, T = 20, B = 34, pw = W - L - R, ph = H - T - B;
  const maxV = Math.max(1, ...cubs.map(b => b.total));
  const paso = pasoBonito(maxV), techo = Math.ceil(maxV / paso) * paso;
  const n = cubs.length, bw = pw / n, barra = Math.min(bw * 0.7, 56), cada = Math.ceil(n / Math.max(4, Math.floor(pw / 46)));
  const yv = v => T + ph - (v / techo) * ph;
  let g = '';
  for (let v = 0; v <= techo + 1e-9; v += paso) g += `<line x1="${L}" x2="${W - R}" y1="${yv(v)}" y2="${yv(v)}" class="gr-grid"/><text x="${L - 6}" y="${yv(v) + 3}" text-anchor="end">${compacto(v)}</text>`;
  cubs.forEach((b, i) => {
    const x = L + i * bw + (bw - barra) / 2;
    const segs = [[b.cobrado, 'gr-c', 0], [b.porCobrar, 'gr-b', b.cobrado]].filter(([v]) => v > 0.005)
      .map(([v, cls, base]) => `<rect class="${cls}" x="${x.toFixed(1)}" y="${yv(base + v).toFixed(1)}" width="${barra.toFixed(1)}" height="${(v / techo * ph).toFixed(1)}" rx="2"/>`).join('');
    const valor = b.total > 0 ? `<text x="${(x + barra / 2).toFixed(1)}" y="${yv(b.total) - 4}" text-anchor="middle" class="gr-v">${bw >= 78 ? mxn(b.total) : compacto(b.total)}</text>` : '';
    const eje = i % cada === 0 || i === n - 1 ? `<text x="${(x + barra / 2).toFixed(1)}" y="${H - 14}" text-anchor="middle">${esc(etiquetaCubeta(b.mes, 'mes'))}</text>` : '';
    const tip = `${etiquetaCubeta(b.mes, 'mes')}: ${b.rentas} renta${b.rentas === 1 ? '' : 's'} · ventas ${mxn(b.total)} (sin IVA ${mxn(b.sinIva)} + IVA ${mxn(b.iva)}) · cobrado ${mxn(b.cobrado)} · por cobrar ${mxn(b.porCobrar)}`;
    g += `<g><title>${esc(tip)}</title><rect x="${(L + i * bw).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ph}" fill="transparent"/>${segs}${valor}${eje}</g>`;
  });
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventas por mes">${g}</svg>`;
}

// Pinta la gráfica de ventas por mes dentro del contenedor indicado (Resumen y Reportes).
async function pintarGraficoVentas(selector) {
  const cont = $(selector);
  if (!cont) return;
  const datos = await api('GET', '/api/ventas-mensuales');
  if (!datos.length) { cont.innerHTML = '<div class="card"><h3 style="margin:0 0 6px">Ventas por mes</h3><p class="muted">Aún no hay ventas registradas.</p></div>'; return; }
  const cubs = cubetasVentas(datos);
  const total = cubs.reduce((s, b) => s + b.total, 0), mejor = cubs.reduce((a, b) => (b.total > a.total ? b : a), cubs[0]);
  cont.innerHTML = `<div class="card"><div class="toolbar" style="margin-bottom:4px"><h3 style="margin:0">Ventas por mes</h3><span class="spacer"></span><span class="muted">Ventas con IVA, por mes de inicio de la renta</span></div>
    ${svgGraficoVentas(cubs, Math.max(300, Math.round(cont.clientWidth - 34)))}
    <div class="leyenda"><span class="gr-c">Cobrado</span><span class="gr-b">Por cobrar</span></div>
    <p class="muted" style="margin:6px 0 0">${mxn(total)} en ${cubs.length} mes${cubs.length === 1 ? '' : 'es'} · promedio ${mxn(total / cubs.length)} por mes · mejor mes: ${etiquetaCubeta(mejor.mes, 'mes')} (${mxn(mejor.total)})</p></div>`;
}
