'use strict';
// Apartado de Cotizaciones. Se carga ANTES de app.js; usa sus ayudantes ($, esc, mxn, api, act, abrirDlg…) al ejecutarse.
const sumaDias = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
// Las llantas se cotizan por JUEGO de 4: en el sistema siguen siendo piezas (1 juego = 4 llantas), pero en la cotización
// se muestran y se capturan como "Juego de 4 llantas" (cantidad de juegos y precio por juego).
const JUEGOS = { Llanta: { nombre: 'Juego de 4 llantas', n: 4 } };
const factorJuego = tipo => JUEGOS[tipo]?.n || 1;
const nombreCot = tipo => JUEGOS[tipo]?.nombre || tipo;
const mostrarItem = i => {
  const f = factorJuego(i.tipo);
  return f > 1 && i.cantidad % f === 0
    ? { nombre: nombreCot(i.tipo), cantidad: i.cantidad / f, precio: i.precio_dia * f }
    : { nombre: i.tipo, cantidad: i.cantidad, precio: i.precio_dia }; // si no completa un juego, se deja en piezas
};
// Pendiente muestra cuántos días le quedan antes de pasar sola a "No contratada".
const badgeCot = c => {
  if (c.estatus !== 'Pendiente') return `<span class="badge ${c.estatus === 'Contratada' ? 'ok' : ''}">${esc(c.estatus)}${c.cerrada_auto ? ' · automático' : ''}</span>`;
  const n = c.restantes;
  return `<span class="badge ${n <= 3 ? 'bad' : 'warn'}">Pendiente · vence ${n <= 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} d`}</span>`;
};
const piezasCot = c => c.items.map(i => { const m = mostrarItem(i); return `${m.cantidad} ${esc(m.nombre)}`; }).join(' · ') || 'Sin piezas';
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
  c.items.forEach(i => { const m = mostrarItem(i); l.push(`• ${m.cantidad} ${m.nombre} × ${c.dias} día${c.dias > 1 ? 's' : ''} (${mxn(m.precio)} por día c/u)`); });
  l.push(`• Renta: ${mxn(c.subtotal)}`);
  if (c.logistico) l.push(`• Traslado, montaje, desmontaje y recolección: ${mxn(c.logistico)}`);
  if (c.iva) l.push(`• IVA (${c.iva_pct}%): ${mxn(c.iva)}`);
  l.push(`• *Total: ${mxn(c.total)}*`, '¿Te la confirmo?');
  return l.join('\n');
}

async function abrirCotizacion(id) {
  const c = await act(() => api('GET', `/api/cotizaciones/${id}`));
  if (!c) return;
  const tel = AR.normalizarTelefonoE164(c.telefono || '');
  const wa = tel ? enlaceWhatsApp(tel.slice(1), msgCotizacion(c)) : null;
  abrirDlg(`${dlgHead(`${esc(c.folio)} · ${esc(c.nombre)}`)}
    <p>${badgeCot(c)} <span class="muted">Cotizada el ${fecha(c.fecha)} · ${c.dias} día${c.dias > 1 ? 's' : ''}</span></p>
    ${c.estatus === 'Pendiente' ? `<p class="muted">⏳ Pasa sola a "No contratada" el ${fecha(c.vence)} (${c.dias_vigencia} días naturales).</p>` : ''}
    ${c.cerrada_auto ? `<p class="muted">🤖 Pasó a "No contratada" automáticamente el ${fecha(c.cerrada_auto)} por cumplir ${c.dias_vigencia} días. Si el cliente regresa, cámbiala a Pendiente y vuelve a contar ${c.dias_vigencia} días.</p>` : ''}
    ${c.telefono ? `<p class="muted">📞 ${esc(c.telefono)}</p>` : ''}${c.direccion ? `<p class="muted">📍 ${esc(c.direccion)}</p>` : ''}
    ${c.fecha_traslado || c.fecha_recoleccion ? `<p class="muted">🚚 Traslado ${c.fecha_traslado ? fecha(c.fecha_traslado) : '—'} · Recolección ${c.fecha_recoleccion ? fecha(c.fecha_recoleccion) : '—'}</p>` : ''}
    <table><tr><th>Pieza</th><th class="r">Cant.</th><th class="r">$/día</th></tr>
      ${c.items.map(i => { const m = mostrarItem(i); return `<tr><td>${esc(m.nombre)}</td><td class="r">${m.cantidad}</td><td class="r">${mxn(m.precio)}</td></tr>`; }).join('')}</table>
    <table style="margin-top:10px">
      <tr><td>Renta (${c.dias} d)</td><td class="r money">${mxn(c.subtotal)}</td></tr>
      <tr><td>Traslado, montaje, desmontaje y recolección</td><td class="r money">${mxn(c.logistico)}</td></tr>
      ${c.renta_id ? `<tr><td>IVA (${c.iva_pct}%)</td><td class="r money">${mxn(c.iva)}</td></tr>`
        : `<tr><td><label style="display:flex;gap:8px;align-items:center;margin:0;color:inherit;font-size:inherit;font-weight:400"><input type="checkbox" id="chkIvaCot" class="chk" ${c.iva_pct > 0 ? 'checked' : ''}> Con IVA (16%) <span class="muted">· quítalo si paga en efectivo sin IVA</span></label></td><td class="r money">${mxn(c.iva)}</td></tr>`}
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
      <button class="btn" type="button" id="editarCot">${c.renta_id ? '✏️ Editar cotización y renta' : '✏️ Editar cotización'}</button>
      ${wa ? `<a class="btn" href="${wa}" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : ''}
      <button class="btn" type="button" id="copiarMsgCot">Copiar mensaje</button>
      ${c.renta_id ? '' : '<button class="btn danger" id="borrarCot">Borrar cotización</button>'}</div>
    <p class="muted" style="margin-top:8px">El mensaje sale de la cuenta de WhatsApp que esté abierta en este aparato. En computadora se abre <b>WhatsApp Web</b>: para que salga del número de la empresa, vincula ahí tu cuenta de <b>WhatsApp Business</b> (app empresarial → Dispositivos vinculados). También puedes tocar <b>Copiar mensaje</b> y pegarlo en el chat del cliente dentro de WhatsApp Business.</p>`);
  $('#copiarMsgCot', dlg).onclick = () => copiarTexto(msgCotizacion(c));
  const editar = $('#editarCot', dlg);
  if (editar) editar.onclick = () => act(() => formularioCotizacion(c));
  const chkIva = $('#chkIvaCot', dlg);
  if (chkIva) chkIva.onchange = () => act(async () => { await api('PATCH', `/api/cotizaciones/${id}`, { iva_pct: chkIva.checked ? 16 : 0 }); toast(chkIva.checked ? 'IVA agregado' : 'Sin IVA'); abrirCotizacion(id); refrescar(); });
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

const nuevaCotizacion = () => formularioCotizacion(null);

// Formulario de cotización: sin argumento crea una nueva; con una cotización (c) la edita.
async function formularioCotizacion(c) {
  const [clientes, tipos] = await Promise.all([api('GET', '/api/clientes'), api('GET', '/api/tipos')]);
  // Al editar también se muestran las piezas que ya traía la cotización, aunque hoy no haya existencia.
  const lista = tipos.filter(t => t.operativos > 0 || (c && c.items.some(i => i.tipo === t.tipo)));
  const enCot = tipo => (c ? c.items.find(i => i.tipo === tipo) : null);
  // Un precio que coincide con el tabulador se deja en blanco (sigue al tabulador si cambias días o cantidad);
  // uno distinto se conserva como precio manual.
  const nAndCot = c ? c.items.reduce((s, i) => s + (lista.find(t => t.tipo === i.tipo)?.categoria === 'andamio' ? i.cantidad : 0), 0) : 0;
  // En el formulario, las llantas se capturan en juegos de 4 (cantidad de juegos y precio por juego por día).
  const juegosIniciales = t => Math.ceil((enCot(t.tipo)?.cantidad || 0) / factorJuego(t.tipo));
  const precioInicial = t => {
    const i = enCot(t.tipo);
    if (!i) return '';
    const f = factorJuego(t.tipo);
    const auto = t.categoria === 'andamio' ? AR.precioAndamioPorDia(c.dias, nAndCot || 1) : t.renta_dia;
    return Math.abs(i.precio_dia - auto) > 0.005 ? Math.round(i.precio_dia * f * 100) / 100 : '';
  };
  abrirDlg(`${dlgHead(c ? `Editar ${esc(c.folio)}` : 'Nueva cotización')}
    ${c && c.renta_id ? `<p class="muted" style="background:var(--warn-bg,#fff4d6);padding:8px 10px;border-radius:8px">Esta cotización ya es una renta. Los cambios de <b>días, precios, logística e IVA</b> también se aplican a la renta, para que lo cotizado y lo cobrado cuadren. Las cantidades de piezas no se pueden cambiar aquí.</p>` : ''}
    <form id="fCot">
      <label>Cliente existente (opcional)</label>
      <select name="cliente_id"><option value="">— Cliente nuevo / prospecto —</option>${clientes.map(cl => `<option value="${cl.id}" ${c && c.cliente_id === cl.id ? 'selected' : ''}>${esc(cl.nombre)}${cl.telefono ? ' · ' + esc(cl.telefono) : ''}</option>`).join('')}</select>
      <div class="f2"><div><label>Nombre</label><input name="nombre" required value="${esc(c?.nombre || '')}"></div><div><label>Teléfono / WhatsApp</label><input name="telefono" inputmode="tel" value="${esc(c?.telefono || '')}"></div></div>
      <div class="f2"><div><label>Fecha de cotización</label><input name="fecha" type="date" value="${c?.fecha || hoyStr()}" required></div>
        <div><label>Días de renta</label><input name="dias" type="number" min="1" max="365" value="${c?.dias || 5}" required></div></div>
      <div class="f2"><div><label>Fecha de traslado (opcional)</label><input name="fecha_traslado" type="date" value="${c?.fecha_traslado || ''}"></div>
        <div><label>Fecha de recolección (opcional)</label><input name="fecha_recoleccion" type="date" value="${c?.fecha_recoleccion || ''}"></div></div>
      <label>Dirección</label><input name="direccion" value="${esc(c?.direccion || '')}">
      <h3>Piezas</h3>
      <div id="tiposCot">${lista.map(t => `<div class="pick" data-tipo="${esc(t.tipo)}">
        ${t.foto ? `<img class="thumb" src="${t.foto}" alt="">` : '<div class="thumb"></div>'}
        <div class="grow"><div class="t">${esc(nombreCot(t.tipo))}</div></div>
        <div><label style="margin:0">Cant.</label><input class="q" type="number" min="0" value="${juegosIniciales(t)}"></div>
        <div><label style="margin:0">$/día</label><input class="p" type="number" step="0.01" min="0" value="${precioInicial(t)}"></div></div>`).join('')}</div>
      <div class="f2"><div><label>Traslado, montaje, desmontaje y recolección ($)</label><input name="logistico" type="number" step="0.01" min="0" value="${c?.logistico ?? 0}"></div>
        <div><label>Estatus</label>${c ? `<div style="margin-top:6px">${badgeCot(c)}</div><div class="muted" style="margin-top:4px">Editar no cambia el estatus ni la vigencia.</div>`
          : `<div class="badge warn" style="margin-top:6px">Pendiente</div><div class="muted" style="margin-top:4px">Pasa sola a "No contratada" a los 15 días.</div>`}</div></div>
      <label>Notas</label><textarea name="notas" rows="2" placeholder="Incluye llantas, escalera…">${esc(c?.notas || '')}</textarea>
      <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="iva" ${!c || c.iva_pct > 0 ? 'checked' : ''} style="width:auto"> Agregar IVA (16%)</label>
      <div class="total"><div class="muted">TOTAL DE LA COTIZACIÓN</div><div class="n" id="totalPrev">$0</div><div class="muted" id="totalDet"></div></div>
      <p class="error" id="cotErr"></p>
      <div class="actions"><button class="btn primary" type="submit">${c ? 'Guardar cambios' : 'Guardar cotización'}</button><button class="btn x" type="button">Cancelar</button></div>
    </form>`);
  const form = $('#fCot');
  const val = n => form.elements[n].value;
  let recolAuto = !(c && c.fecha_recoleccion);

  function recalc() {
    const dias = Math.max(1, parseInt(val('dias'), 10) || 1);
    const filas = $$('.pick[data-tipo]', form).map(el => ({ el, t: lista.find(x => x.tipo === el.dataset.tipo), q: parseInt($('.q', el).value, 10) || 0 }));
    const nAndamios = filas.filter(f => f.t.categoria === 'andamio').reduce((s, f) => s + f.q, 0);
    let sub = 0;
    for (const { el, t, q } of filas) {
      const auto = t.categoria === 'andamio' ? AR.precioAndamioPorDia(dias, nAndamios || 1) : t.renta_dia * factorJuego(t.tipo);
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
  if (c && c.renta_id) $$('.pick .q', form).forEach(q => { q.readOnly = true; q.title = 'Las piezas ya están asignadas a la renta'; });
  recalc();

  form.onsubmit = async e => {
    e.preventDefault();
    // Las llantas se guardan como piezas: juegos × 4, y el precio por juego se divide entre 4.
    const items = $$('.pick[data-tipo]', form).map(el => {
      const f = factorJuego(el.dataset.tipo), p = $('.p', el).value;
      return { tipo: el.dataset.tipo, cantidad: (parseInt($('.q', el).value, 10) || 0) * f, precio_dia: p === '' ? '' : Number(p) / f };
    });
    const body = {
      cliente_id: val('cliente_id') || null, nombre: val('nombre'), telefono: val('telefono'), fecha: val('fecha'), dias: Number(val('dias')),
      fecha_traslado: val('fecha_traslado') || null, fecha_recoleccion: val('fecha_recoleccion') || null, direccion: val('direccion'),
      logistico: val('logistico'), notas: val('notas'), iva_pct: form.elements.iva.checked ? 16 : 0, items,
    };
    try {
      if (c) { // edición: se conserva el folio, el estatus y la vigencia
        const g = await api('PUT', `/api/cotizaciones/${c.id}`, body);
        dlg.close(); toast(`Cotización ${g.folio} actualizada`); refrescar(); abrirCotizacion(g.id);
      } else {
        const g = await api('POST', '/api/cotizaciones', body);
        dlg.close(); toast(`Cotización ${g.folio} guardada`);
        filtroCot = 'Pendiente'; busquedaCot = ''; ir('cotizaciones'); abrirCotizacion(g.id);
      }
    } catch (err) { $('#cotErr').textContent = err.message; }
  };
}
