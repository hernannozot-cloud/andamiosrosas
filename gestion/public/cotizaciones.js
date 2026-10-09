'use strict';
// Apartado de Cotizaciones. Se carga ANTES de app.js; usa sus ayudantes ($, esc, mxn, api, act, abrirDlg…) al ejecutarse.
const sumaDias = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
// Pendiente muestra cuántos días le quedan antes de pasar sola a "No contratada".
const badgeCot = c => {
  if (c.estatus !== 'Pendiente') return `<span class="badge ${c.estatus === 'Contratada' ? 'ok' : ''}">${esc(c.estatus)}${c.cerrada_auto ? ' · automático' : ''}</span>`;
  const n = c.restantes;
  return `<span class="badge ${n <= 3 ? 'bad' : 'warn'}">Pendiente · vence ${n <= 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} d`}</span>`;
};
const piezasCot = c => c.items.map(i => `${i.cantidad} ${esc(i.tipo)}`).join(' · ') || 'Sin piezas';
const rowCot = c => `<div class="row" data-cot="${c.id}"><div class="grow"><div class="t">${esc(c.nombre)} <span class="muted">${esc(c.folio)}</span></div>
  <div class="s">${piezasCot(c)} · ${c.dias} día${c.dias > 1 ? 's' : ''} · ${fechaCorta(c.fecha)}</div></div>
  <div style="text-align:right">${badgeCot(c)}<div class="money">${mxn(c.total)}</div></div></div>`;

let filtroCot = 'Pendiente', busquedaCot = '';
async function vCotizaciones() {
  const cots = await api('GET', '/api/cotizaciones');
  const cont = cots.filter(c => c.estatus === 'Contratada').length, no = cots.filter(c => c.estatus === 'No contratada').length;
  const pend = cots.filter(c => c.estatus === 'Pendiente');
  const filtros = { Pendiente: 'Pendientes', Contratada: 'Contratadas', 'No contratada': 'No contratadas', todas: 'Todas' };
  const cuenta = k => k === 'todas' ? cots.length : cots.filter(c => c.estatus === k).length;
  $('#main').innerHTML = `
    <div class="toolbar"><h2 style="margin:0">Cotizaciones</h2><span class="spacer"></span><button id="nuevaCot" class="btn primary">+ Nueva cotización</button></div>
    <div class="grid">${stat(cots.length, 'Cotizaciones')}${stat(pend.length, 'Pendientes')}${stat(cont, 'Contratadas', 'ok')}
      ${stat(cont + no ? `${Math.round(cont / (cont + no) * 100)}%` : '—', 'Tasa de cierre')}${stat(mxn(pend.reduce((s, c) => s + c.total, 0)), 'Monto pendiente')}</div>
    <div id="grafCot" style="margin-top:14px"></div>
    <div class="toolbar" style="margin-top:14px">${Object.entries(filtros).map(([k, n]) => `<button class="chip ${k === filtroCot ? 'on' : ''}" data-f="${k}">${n} (${cuenta(k)})</button>`).join('')}
      <input id="buscarCot" placeholder="Buscar por nombre o folio" value="${esc(busquedaCot)}" style="max-width:260px"></div>
    <div class="card" id="listaCot"></div>`;
  const pintar = () => {
    const q = busquedaCot.trim().toLowerCase();
    const lista = cots.filter(c => (filtroCot === 'todas' || c.estatus === filtroCot) && (!q || `${c.nombre} ${c.folio}`.toLowerCase().includes(q)));
    $('#listaCot').innerHTML = lista.map(rowCot).join('') || '<p class="muted">No hay cotizaciones en esta vista.</p>';
    $$('[data-cot]', $('#listaCot')).forEach(el => el.onclick = () => abrirCotizacion(Number(el.dataset.cot)));
  };
  pintar();
  pintarGraficoCotizaciones(cots);
  $$('[data-f]').forEach(b => b.onclick = () => { filtroCot = b.dataset.f; refrescar(); });
  $('#buscarCot').oninput = e => { busquedaCot = e.target.value; pintar(); };
  $('#nuevaCot').onclick = () => act(nuevaCotizacion);
}

function msgCotizacion(c) {
  const l = [`Hola ${c.nombre}, te comparto tu cotización ${c.folio} de Andamios Rosas:`];
  c.items.forEach(i => l.push(`• ${i.cantidad} ${i.tipo} × ${c.dias} día${c.dias > 1 ? 's' : ''} (${mxn(i.precio_dia)} por día c/u)`));
  l.push(`• Renta: ${mxn(c.subtotal)}`);
  if (c.logistico) l.push(`• Traslado / logística: ${mxn(c.logistico)}`);
  if (c.iva) l.push(`• IVA (${c.iva_pct}%): ${mxn(c.iva)}`);
  l.push(`• *Total: ${mxn(c.total)}*`, '¿Te la confirmo?');
  return l.join('\n');
}

async function abrirCotizacion(id) {
  const c = await act(() => api('GET', `/api/cotizaciones/${id}`));
  if (!c) return;
  const tel = AR.normalizarTelefonoE164(c.telefono || '');
  const wa = tel ? `https://wa.me/${tel.slice(1)}?text=${encodeURIComponent(msgCotizacion(c))}` : null;
  abrirDlg(`${dlgHead(`${esc(c.folio)} · ${esc(c.nombre)}`)}
    <p>${badgeCot(c)} <span class="muted">Cotizada el ${fecha(c.fecha)} · ${c.dias} día${c.dias > 1 ? 's' : ''}</span></p>
    ${c.estatus === 'Pendiente' ? `<p class="muted">⏳ Pasa sola a "No contratada" el ${fecha(c.vence)} (${c.dias_vigencia} días naturales).</p>` : ''}
    ${c.cerrada_auto ? `<p class="muted">🤖 Pasó a "No contratada" automáticamente el ${fecha(c.cerrada_auto)} por cumplir ${c.dias_vigencia} días. Si el cliente regresa, cámbiala a Pendiente y vuelve a contar ${c.dias_vigencia} días.</p>` : ''}
    ${c.telefono ? `<p class="muted">📞 ${esc(c.telefono)}</p>` : ''}${c.direccion ? `<p class="muted">📍 ${esc(c.direccion)}</p>` : ''}
    ${c.fecha_traslado || c.fecha_recoleccion ? `<p class="muted">🚚 Traslado ${c.fecha_traslado ? fecha(c.fecha_traslado) : '—'} · Recolección ${c.fecha_recoleccion ? fecha(c.fecha_recoleccion) : '—'}</p>` : ''}
    <table><tr><th>Pieza</th><th class="r">Cant.</th><th class="r">$/día</th></tr>
      ${c.items.map(i => `<tr><td>${esc(i.tipo)}</td><td class="r">${i.cantidad}</td><td class="r">${mxn(i.precio_dia)}</td></tr>`).join('')}</table>
    <table style="margin-top:10px">
      <tr><td>Renta (${c.dias} d)</td><td class="r money">${mxn(c.subtotal)}</td></tr>
      <tr><td>Traslado / logística</td><td class="r money">${mxn(c.logistico)}</td></tr>
      <tr><td>IVA (${c.iva_pct}%)</td><td class="r money">${mxn(c.iva)}</td></tr>
      <tr><td><b>Total</b></td><td class="r money">${mxn(c.total)}</td></tr></table>
    ${c.notas ? `<p class="muted" style="margin-top:10px">${esc(c.notas)}</p>` : ''}
    ${c.renta_id ? '' : `<label>Estatus</label><select id="estCot">${['Pendiente', 'Contratada', 'No contratada'].map(e => `<option ${c.estatus === e ? 'selected' : ''}>${e}</option>`).join('')}</select>`}
    ${c.renta_id ? '<div class="actions"><button class="btn primary" id="verRenta">Ver la renta creada</button></div>' : `
    <h3>Convertir en renta</h3>
    <form id="fConv" class="f2"><div><label>Fecha de inicio</label><input name="fecha_inicio" type="date" value="${c.fecha_traslado || hoyStr()}" required></div>
      <div><label>Estatus</label><select name="estado"><option value="apartada">Apartar para esa fecha</option><option value="activa">Entrega inmediata (en obra)</option></select></div>
      <div style="grid-column:1/-1"><button class="btn primary" type="submit">Convertir en renta</button></div></form>
    <p class="error" id="convErr"></p>`}
    <div class="actions"><a class="btn primary" href="/api/cotizaciones/${c.id}/pdf" target="_blank" rel="noopener">Ver / descargar PDF</a>
      ${wa ? `<a class="btn" href="${wa}" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : ''}
      ${c.renta_id ? '' : '<button class="btn danger" id="borrarCot">Borrar cotización</button>'}</div>`);
  const est = $('#estCot', dlg);
  if (est) est.onchange = () => act(async () => { await api('PATCH', `/api/cotizaciones/${id}`, { estatus: est.value }); toast('Estatus actualizado'); abrirCotizacion(id); refrescar(); });
  const ver = $('#verRenta', dlg);
  if (ver) ver.onclick = () => abrirRenta(c.renta_id);
  const borrar = $('#borrarCot', dlg);
  if (borrar) borrar.onclick = () => act(async () => { if (confirm('¿Borrar esta cotización?')) { await api('DELETE', `/api/cotizaciones/${id}`); dlg.close(); toast('Cotización borrada'); refrescar(); } });
  const conv = $('#fConv', dlg);
  if (conv) conv.onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await api('POST', `/api/cotizaciones/${id}/convertir`, Object.fromEntries(new FormData(conv)));
      dlg.close(); toast(`Renta ${r.renta.folio} creada`); ir('rentas'); abrirRenta(r.renta.id);
    } catch (err) { $('#convErr').textContent = err.message; }
  };
}

async function nuevaCotizacion() {
  const [clientes, tipos] = await Promise.all([api('GET', '/api/clientes'), api('GET', '/api/tipos')]);
  const lista = tipos.filter(t => t.operativos > 0);
  abrirDlg(`${dlgHead('Nueva cotización')}
    <form id="fCot">
      <label>Cliente existente (opcional)</label>
      <select name="cliente_id"><option value="">— Cliente nuevo / prospecto —</option>${clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}${c.telefono ? ' · ' + esc(c.telefono) : ''}</option>`).join('')}</select>
      <div class="f2"><div><label>Nombre</label><input name="nombre" required></div><div><label>Teléfono / WhatsApp</label><input name="telefono" inputmode="tel"></div></div>
      <div class="f2"><div><label>Fecha de cotización</label><input name="fecha" type="date" value="${hoyStr()}" required></div>
        <div><label>Días de renta</label><input name="dias" type="number" min="1" max="365" value="5" required></div></div>
      <div class="f2"><div><label>Fecha de traslado (opcional)</label><input name="fecha_traslado" type="date"></div>
        <div><label>Fecha de recolección (opcional)</label><input name="fecha_recoleccion" type="date"></div></div>
      <label>Dirección</label><input name="direccion">
      <h3>Piezas</h3>
      <div id="tiposCot">${lista.map(t => `<div class="pick" data-tipo="${esc(t.tipo)}">
        ${t.foto ? `<img class="thumb" src="${t.foto}" alt="">` : '<div class="thumb"></div>'}
        <div class="grow"><div class="t">${esc(t.tipo)}</div></div>
        <div><label style="margin:0">Cant.</label><input class="q" type="number" min="0" value="0"></div>
        <div><label style="margin:0">$/día</label><input class="p" type="number" step="0.01" min="0"></div></div>`).join('')}</div>
      <div class="f2"><div><label>Traslado / logística ($)</label><input name="logistico" type="number" step="0.01" min="0" value="0"></div>
        <div><label>Estatus</label><div class="badge warn" style="margin-top:6px">Pendiente</div>
          <div class="muted" style="margin-top:4px">Pasa sola a "No contratada" a los 15 días.</div></div></div>
      <label>Notas</label><textarea name="notas" rows="2" placeholder="Incluye llantas, escalera…"></textarea>
      <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="iva" checked style="width:auto"> Agregar IVA (16%)</label>
      <div class="total"><div class="muted">TOTAL DE LA COTIZACIÓN</div><div class="n" id="totalPrev">$0</div><div class="muted" id="totalDet"></div></div>
      <p class="error" id="cotErr"></p>
      <div class="actions"><button class="btn primary" type="submit">Guardar cotización</button><button class="btn x" type="button">Cancelar</button></div>
    </form>`);
  const form = $('#fCot');
  const val = n => form.elements[n].value;
  let recolAuto = true;

  function recalc() {
    const dias = Math.max(1, parseInt(val('dias'), 10) || 1);
    const filas = $$('.pick[data-tipo]', form).map(el => ({ el, t: lista.find(x => x.tipo === el.dataset.tipo), q: parseInt($('.q', el).value, 10) || 0 }));
    const nAndamios = filas.filter(f => f.t.categoria === 'andamio').reduce((s, f) => s + f.q, 0);
    let sub = 0;
    for (const { el, t, q } of filas) {
      const auto = t.categoria === 'andamio' ? AR.precioAndamioPorDia(dias, nAndamios || 1) : t.renta_dia;
      const inp = $('.p', el); inp.placeholder = auto;
      sub += q * (inp.value !== '' ? Number(inp.value) : auto) * dias;
    }
    const log = Number(val('logistico')) || 0;
    const iva = form.elements.iva.checked ? Math.round((sub + log) * 16) / 100 : 0;
    $('#totalPrev').textContent = mxn(sub + log + iva);
    $('#totalDet').textContent = `${mxn(sub)} de renta${log ? ` + ${mxn(log)} de logística` : ''}${iva ? ` + ${mxn(iva)} de IVA` : ''}`;
  }
  const sincronizarRecoleccion = () => {
    if (recolAuto && val('fecha_traslado')) form.elements.fecha_recoleccion.value = sumaDias(val('fecha_traslado'), Math.max(1, parseInt(val('dias'), 10) || 1));
  };
  form.elements.cliente_id.onchange = () => {
    const c = clientes.find(x => x.id === Number(val('cliente_id')));
    if (c) { form.elements.nombre.value = c.nombre; form.elements.telefono.value = c.telefono || ''; if (c.direccion) form.elements.direccion.value = c.direccion; }
  };
  form.elements.fecha_recoleccion.oninput = () => { recolAuto = false; };
  form.elements.fecha_traslado.onchange = sincronizarRecoleccion;
  form.elements.dias.oninput = () => { sincronizarRecoleccion(); recalc(); };
  [...$$('#tiposCot input', form), form.elements.logistico].forEach(i => i.oninput = recalc);
  form.elements.iva.onchange = recalc;
  recalc();

  form.onsubmit = async e => {
    e.preventDefault();
    const items = $$('.pick[data-tipo]', form).map(el => ({ tipo: el.dataset.tipo, cantidad: parseInt($('.q', el).value, 10) || 0, precio_dia: $('.p', el).value }));
    const body = {
      cliente_id: val('cliente_id') || null, nombre: val('nombre'), telefono: val('telefono'), fecha: val('fecha'), dias: Number(val('dias')),
      fecha_traslado: val('fecha_traslado') || null, fecha_recoleccion: val('fecha_recoleccion') || null, direccion: val('direccion'),
      logistico: val('logistico'), notas: val('notas'), iva_pct: form.elements.iva.checked ? 16 : 0, items,
    };
    try {
      const c = await api('POST', '/api/cotizaciones', body);
      dlg.close(); toast(`Cotización ${c.folio} guardada`);
      filtroCot = 'Pendiente'; busquedaCot = ''; ir('cotizaciones'); abrirCotizacion(c.id);
    } catch (err) { $('#cotErr').textContent = err.message; }
  };
}
