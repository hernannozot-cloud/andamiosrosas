'use strict';
// Utilización de la flota de andamios (Estándar y Plegable; sin accesorios).
// Utilización = andamios en uso ÷ andamios de la flota (los que no están dados de baja), por día; en periodos
// más largos es el promedio diario: andamios-día en uso ÷ (flota × días). La barra se divide en cuánto aporta
// cada tipo a la utilización total de la flota; el detalle (al pasar el cursor) trae la de cada tipo por separado.
// Se carga ANTES de app.js; usa ayudantes de app.js/graficos.js ($, esc, mxn, fecha, api, pasoBonito, etiquetaCubeta…).
let utilModo = 'dia', utilDias = 30, utilDatos = null;
const pctU = x => { const v = x * 100; return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`; };

function agregaUtil(filas, F) {
  const n = filas.length, ue = filas.reduce((s, r) => s + r.e, 0), up = filas.reduce((s, r) => s + r.p, 0), den = (F.e + F.p) * n;
  return { n, ue, up, total: den ? (ue + up) / den : 0, ge: den ? ue / den : 0, gp: den ? up / den : 0,
    propioE: F.e && n ? ue / (F.e * n) : 0, propioP: F.p && n ? up / (F.p * n) : 0 };
}

function prepararUtil(d) {
  const F = d.flota, filas = d.dias;
  const dia = filas.map((r, i) => {
    const mes = r.f.slice(0, 7); let j = i;
    while (j > 0 && filas[j - 1].f.slice(0, 7) === mes) j--;
    return { f: r.f, e: r.e, p: r.p, ...agregaUtil([r], F), acumMes: agregaUtil(filas.slice(j, i + 1), F) };
  });
  const porMes = new Map();
  for (const r of filas) { const k = r.f.slice(0, 7); if (!porMes.has(k)) porMes.set(k, []); porMes.get(k).push(r); }
  const meses = [...porMes].map(([k, rs]) => ({ k, ...agregaUtil(rs, F), acumAnio: agregaUtil(filas.filter(r => r.f.startsWith(k.slice(0, 4)) && r.f <= rs.at(-1).f), F) }));
  return { F, dia, meses };
}

function textoUtil(titulo, a, F, extra) {
  return `${titulo}: ${pctU(a.total)} de la flota` + (a.n === 1 ? ` (${a.ue + a.up} de ${F.e + F.p} andamios)` : '')
    + ` · Estándar ${pctU(a.propioE)} (${a.ue}${a.n === 1 ? `/${F.e}` : ' and-día'}) · Plegable ${pctU(a.propioP)} (${a.up}${a.n === 1 ? `/${F.p}` : ' and-día'})${extra ? ` · ${extra}` : ''}`;
}

function svgUtil(items, W) {
  const H = 240, L = 38, R = 8, T = 20, B = 34, pw = W - L - R, ph = H - T - B;
  const maxV = Math.max(0.1, ...items.map(i => Math.max(i.total, i.linea)));
  const paso = pasoBonito(maxV * 100) / 100, techo = Math.ceil(maxV / paso - 1e-9) * paso;
  const n = items.length, bw = pw / n, barra = Math.min(bw * 0.72, 52), cada = Math.ceil(n / Math.max(4, Math.floor(pw / 46)));
  const yv = v => T + ph - (v / techo) * ph;
  let g = '';
  for (let v = 0; v <= techo + 1e-9; v += paso) g += `<line x1="${L}" x2="${W - R}" y1="${yv(v)}" y2="${yv(v)}" class="gr-grid"/><text x="${L - 6}" y="${yv(v) + 3}" text-anchor="end">${Math.round(v * 100)}%</text>`;
  const puntos = [];
  items.forEach((it, i) => {
    const x = L + i * bw + (bw - barra) / 2, cx = x + barra / 2;
    const segs = [[it.ge, 'gu-e', 0], [it.gp, 'gu-p', it.ge]].filter(([v]) => v > 0.0005)
      .map(([v, cls, base]) => `<rect class="${cls}" x="${x.toFixed(1)}" y="${yv(base + v).toFixed(1)}" width="${barra.toFixed(1)}" height="${(v / techo * ph).toFixed(1)}" rx="2"/>`).join('');
    const valor = it.total > 0 && bw >= 24 ? `<text x="${cx.toFixed(1)}" y="${yv(it.total) - 4}" text-anchor="middle" class="gr-v">${pctU(it.total)}</text>` : '';
    const eje = i % cada === 0 || i === n - 1 ? `<text x="${cx.toFixed(1)}" y="${H - 14}" text-anchor="middle">${esc(it.etiqueta)}</text>` : '';
    puntos.push(`${cx.toFixed(1)},${yv(it.linea).toFixed(1)}`);
    g += `<g><title>${esc(it.tip)}</title><rect x="${(L + i * bw).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ph}" fill="transparent"/>${segs}${valor}${eje}</g>`;
  });
  g += `<polyline class="gu-line" points="${puntos.join(' ')}"/>`;
  if (n <= 40) puntos.forEach(p => { const [cx, cy] = p.split(','); g += `<circle class="gu-dot" cx="${cx}" cy="${cy}" r="2.6"/>`; });
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Utilización de la flota">${g}</svg>`;
}

async function vUtilizacion() {
  utilDatos = prepararUtil(await api('GET', '/api/utilizacion'));
  pintarUtilizacion(utilDatos);
}

function pintarUtilizacion(P) {
  const { F, dia, meses } = P;
  const hoy = dia.at(-1), mesActual = meses.at(-1), anio = mesActual.acumAnio, anterior = meses.length > 1 ? meses.at(-2) : null;
  const desde = dia[0].f;
  const tarjeta = (titulo, a, extra = '') => `<div class="card stat"><div class="n">${pctU(a.total)}</div><div class="l">${titulo}</div>
    <div class="sub"><span class="t-e">Estándar ${pctU(a.propioE)}</span> · <span class="t-p">Plegable ${pctU(a.propioP)}</span></div>${extra}</div>`;
  const items = utilModo === 'dia'
    ? dia.slice(-utilDias).map(r => ({ ...r, etiqueta: etiquetaCubeta(r.f, 'dia'), linea: r.acumMes.total,
      tip: textoUtil(fecha(r.f), r, F, `acumulado del mes ${pctU(r.acumMes.total)}`) }))
    : meses.map(m => ({ ...m, etiqueta: etiquetaCubeta(m.k, 'mes'), linea: m.acumAnio.total,
      tip: textoUtil(`${etiquetaCubeta(m.k, 'mes')} (${m.n} días)`, m, F, `acumulado del año ${pctU(m.acumAnio.total)}`) }));
  const opcionesDias = [30, 60, 90];
  $('#main').innerHTML = `<div class="toolbar"><h2 style="margin:0">Utilización de la flota</h2><span class="spacer"></span>
      <button class="btn" onclick="window.print()">Imprimir / PDF</button></div>
    <p class="muted">Flota: ${F.e} Andamio Estándar + ${F.p} Andamio Plegable = ${F.e + F.p} andamios · se cuenta desde la primera renta (${fecha(desde)}) · sin accesorios</p>
    <div class="grid">${tarjeta('Hoy', hoy, `<div class="sub">${hoy.e + hoy.p} de ${F.e + F.p} andamios en uso</div>`)}
      ${tarjeta(`Mes en curso (acumulado, ${mesActual.n} días)`, mesActual)}${tarjeta(`Año (acumulado, ${anio.n} días)`, anio)}
      ${anterior ? tarjeta(`Mes anterior (${etiquetaCubeta(anterior.k, 'mes')})`, anterior) : ''}</div>
    <div class="card" id="cardUtil" style="margin-top:14px"><div class="toolbar" style="margin-bottom:4px"><h3 style="margin:0">${utilModo === 'dia' ? 'Utilización diaria' : 'Utilización por mes'}</h3><span class="spacer"></span>
      <button class="chip ${utilModo === 'dia' ? 'on' : ''}" data-um="dia">Diaria</button><button class="chip ${utilModo === 'mes' ? 'on' : ''}" data-um="mes">Mensual</button>
      ${utilModo === 'dia' ? `<select id="utilDias" style="width:auto">${opcionesDias.map(d => `<option value="${d}" ${d === utilDias ? 'selected' : ''}>Últimos ${d} días</option>`).join('')}</select>` : ''}</div>
      <div id="svgUtil"></div>
      <div class="leyenda"><span class="gu-e">Andamio Estándar</span><span class="gu-p">Andamio Plegable</span><span class="gu-l">${utilModo === 'dia' ? 'Acumulado del mes' : 'Acumulado del año'}</span></div>
      <p class="muted" style="margin:6px 0 0">La altura de la barra es la utilización de toda la flota; cada color es lo que aporta ese tipo. Pasa el cursor para ver la utilización de cada tipo.</p></div>
    <h3>Utilización por mes</h3>
    <div class="card tabla-scroll"><table class="detalle"><thead><tr><th>Mes</th><th class="r">Días</th><th class="r">Total flota</th><th class="r">Estándar</th><th class="r">Plegable</th><th class="r">Acumulado año</th></tr></thead>
      <tbody>${meses.map(m => `<tr><td>${esc(etiquetaCubeta(m.k, 'mes'))}</td><td class="r">${m.n}</td><td class="r money">${pctU(m.total)}</td>
        <td class="r">${pctU(m.propioE)} <span class="muted">(${m.ue} and-día)</span></td><td class="r">${pctU(m.propioP)} <span class="muted">(${m.up} and-día)</span></td><td class="r">${pctU(m.acumAnio.total)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>Año</th><th class="r">${anio.n}</th><th class="r">${pctU(anio.total)}</th><th class="r">${pctU(anio.propioE)}</th><th class="r">${pctU(anio.propioP)}</th><th></th></tr></tfoot></table></div>
    <p class="muted">"and-día" = andamios-día: un andamio rentado un día. Utilización = andamios-día en uso ÷ (andamios de la flota × días). Un andamio cuenta desde el día de entrega hasta el día anterior a su devolución.</p>`;
  const cont = $('#svgUtil');
  cont.innerHTML = svgUtil(items, Math.max(300, Math.round(cont.clientWidth - 2)));
  $$('[data-um]').forEach(b => b.onclick = () => { utilModo = b.dataset.um; pintarUtilizacion(P); });
  const sel = $('#utilDias');
  if (sel) sel.onchange = () => { utilDias = Number(sel.value); pintarUtilizacion(P); };
}
