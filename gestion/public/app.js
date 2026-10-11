'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mxn = n => { // enteros sin centavos; con centavos siempre 2 decimales
  const x = Number(n) || 0, d = Number.isInteger(x) ? 0 : 2;
  return x.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: d, maximumFractionDigits: d });
};
const hoyStr = () => new Date().toLocaleDateString('en-CA');
const fecha = s => s ? new Date(`${s}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fechaCorta = s => s ? new Date(`${s}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '';

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast show${err ? ' err' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('Sesión requerida'); }
  if (!res.ok) throw new Error(data.error || 'Ocurrió un error');
  return data;
}
// Ejecuta una acción mostrando el error como aviso en vez de romper la pantalla.
async function act(fn) { try { return await fn(); } catch (e) { toast(e.message, true); } }

// ---------- Diálogo ----------
const dlg = $('#dlg');
function abrirDlg(html) { $('#dlgBody').innerHTML = html; if (!dlg.open) dlg.showModal(); $$('.x', dlg).forEach(b => b.onclick = () => dlg.close()); }
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
const dlgHead = t => `<div class="dlg-head"><h2>${t}</h2><button class="x" aria-label="Cerrar">×</button></div>`;

// ---------- Sesión ----------
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; dlg.open && dlg.close(); $('#pin').value = ''; $('#pin').focus(); }
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { await api('POST', '/api/login', { pin: $('#pin').value }); $('#loginError').textContent = ''; arrancar(); }
  catch (err) { $('#loginError').textContent = err.message; }
});
$('#logout').onclick = async () => { await api('POST', '/api/logout', {}).catch(() => {}); showLogin(); };

// ---------- Navegación ----------
const vistas = { resumen: vResumen, cotizaciones: vCotizaciones, rentas: vRentas, inventario: vInventario, clientes: vClientes, reportes: vReportes, utilizacion: vUtilizacion, activos: vActivos };
let vista = 'resumen';
function ir(v) { vista = vistas[v] ? v : 'resumen'; location.hash = vista; $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === vista)); act(() => vistas[vista]()); }
$$('#nav button').forEach(b => b.onclick = () => ir(b.dataset.v));
async function arrancar() {
  $('#login').hidden = true; $('#app').hidden = false;
  ir(location.hash.slice(1) || 'resumen');
}
api('GET', '/api/me').then(r => r.ok ? arrancar() : showLogin()).catch(showLogin);
const refrescar = () => act(() => vistas[vista]());

// ---------- Helpers de renta ----------
function badgeRenta(r) {
  if (r.estado === 'apartada') return `<span class="badge info">Apartada · ${fechaCorta(r.fecha_inicio)}</span>`;
  if (r.estado === 'devuelta') return '<span class="badge">Devuelta</span>';
  if (r.estado === 'cancelada') return '<span class="badge">Cancelada</span>';
  if (r.vencida) return `<span class="badge bad">Vencida hace ${-r.restantes} d</span>`;
  if (r.restantes === 0) return '<span class="badge warn">Vence hoy</span>';
  if (r.restantes === 1) return '<span class="badge warn">Vence mañana</span>';
  return `<span class="badge ok">Faltan ${r.restantes} d</span>`;
}
const piezasTxt = r => r.grupos.map(g => `${g.cantidad} ${esc(g.tipo)}`).join(' · ');
function rowRenta(r) {
  return `<div class="row" data-renta="${r.id}"><div class="grow"><div class="t">${esc(r.cliente_nombre)} <span class="muted">${esc(r.folio)}</span></div>
    <div class="s">${piezasTxt(r)}</div></div><div style="text-align:right">${badgeRenta(r)}${r.facturada ? ' <span class="badge info">Factura</span>' : ''}
    ${r.saldo > 0 && r.estado !== 'cancelada' ? `<div class="money" style="color:var(--bad);font-size:.85rem">Debe ${mxn(r.saldo)}</div>` : ''}</div></div>`;
}
const enlazarRentas = root => $$('[data-renta]', root).forEach(el => el.onclick = () => abrirRenta(Number(el.dataset.renta)));
const stat = (n, l, cls = '') => `<div class="card stat ${cls}"><div class="n">${n}</div><div class="l">${l}</div></div>`;

// ---------- Resumen ----------
async function vResumen() {
  const d = await api('GET', '/api/resumen');
  $('#main').innerHTML = `
    <h2>Resumen <span class="muted">${fecha(d.hoy)}</span></h2>
    <div class="grid">
      ${stat(d.activas, 'Rentas activas')}${stat(d.vencidas, 'Vencidas', d.vencidas ? 'bad' : '')}${stat(d.apartadas, 'Apartadas')}
      ${stat(d.cotizacionesPendientes, 'Cotizaciones pendientes')}
      ${stat(mxn(d.ventasTotal), 'Ventas totales', 'ok')}${stat(mxn(d.ventasMes), 'Ventas del mes')}
      ${stat(mxn(d.porCobrar), 'Por cobrar', d.porCobrar > 0.5 ? 'bad' : '')}${stat(mxn(d.cobradoMes), 'Cobrado este mes', 'ok')}
    </div>
    <div id="grafVentas" style="margin-top:14px"></div>
    <div class="cols">
      <div class="card"><h3 style="margin-top:0">Por regresar</h3>${d.porRegresar.map(rowRenta).join('') || '<p class="muted">No hay rentas activas.</p>'}</div>
      <div class="card"><h3 style="margin-top:0">Próximas entregas (apartadas)</h3>${d.proximas.map(rowRenta).join('') || '<p class="muted">Sin apartados.</p>'}
        <h3>Saldos pendientes</h3>${d.conSaldo.map(rowRenta).join('') || '<p class="muted">Nadie te debe.</p>'}</div>
      <div class="card"><h3 style="margin-top:0">Disponibilidad hoy</h3>${d.tipos.map(t => `
        <div class="pick"><div class="grow"><div class="t">${esc(t.tipo)}</div>
        <div class="bar"><i style="width:${t.operativos ? Math.round(t.disponibles / t.operativos * 100) : 0}%"></i></div></div>
        <div class="money">${t.disponibles}<span class="muted"> / ${t.total}</span></div></div>`).join('')}</div>
    </div>`;
  enlazarRentas($('#main'));
  act(() => pintarGraficoVentas('#grafVentas'));
}

// ---------- Rentas ----------
let filtroRentas = 'activas';
async function vRentas() {
  const rentas = await api('GET', '/api/rentas');
  const filtros = {
    activas: ['Activas', r => r.estado === 'activa'], apartadas: ['Apartadas', r => r.estado === 'apartada'],
    saldo: ['Con saldo', r => r.saldo > 0 && r.estado !== 'cancelada'], devueltas: ['Devueltas', r => r.estado === 'devuelta'],
    todas: ['Todas', () => true],
  };
  const lista = rentas.filter(filtros[filtroRentas][1]);
  $('#main').innerHTML = `
    <div class="toolbar"><h2 style="margin:0">Rentas</h2><span class="spacer"></span><button id="nueva" class="btn primary">+ Nueva renta</button></div>
    <div class="toolbar">${Object.entries(filtros).map(([k, [n]]) => `<button class="chip ${k === filtroRentas ? 'on' : ''}" data-f="${k}">${n} (${rentas.filter(filtros[k][1]).length})</button>`).join('')}</div>
    <div class="card">${lista.map(rowRenta).join('') || '<p class="muted">No hay rentas en esta vista.</p>'}</div>`;
  $$('[data-f]').forEach(b => b.onclick = () => { filtroRentas = b.dataset.f; refrescar(); });
  $('#nueva').onclick = () => act(nuevaRenta);
  enlazarRentas($('#main'));
}

async function abrirRenta(id) {
  const r = await act(() => api('GET', `/api/rentas/${id}`));
  if (!r) return;
  const tel = AR.normalizarTelefonoE164(r.cliente_telefono || '');
  let msg = `Hola ${r.cliente_nombre}, te escribimos de Andamios Rosas.`;
  if (r.estado === 'activa') msg += ` Tu renta ${r.folio} ${r.vencida ? 'venció' : 'vence'} el ${fecha(r.fecha_fin)}.`;
  if (r.saldo > 0) msg += ` Tienes un saldo pendiente de ${mxn(r.saldo)}.`;
  msg += ' ¿Coordinamos? ¡Gracias!';
  const wa = tel ? `https://wa.me/${tel.slice(1)}?text=${encodeURIComponent(msg)}` : null;
  // Tipos de pieza para la sección "Equipo entregado": andamios primero, luego accesorios.
  const tiposEq = r.estado === 'cancelada' ? [] : [...(await act(() => api('GET', '/api/tipos')) || [])]
    .sort((a, b) => (a.categoria === 'andamio' ? 0 : 1) - (b.categoria === 'andamio' ? 0 : 1) || a.tipo.localeCompare(b.tipo));
  abrirDlg(`${dlgHead(`${esc(r.folio)} · ${esc(r.cliente_nombre)}`)}
    <p>${badgeRenta(r)} <span class="muted">${fecha(r.fecha_inicio)} → ${fecha(r.fecha_fin)} (${r.dias} día${r.dias > 1 ? 's' : ''})</span></p>
    ${r.cliente_telefono ? `<p class="muted">📞 ${esc(r.cliente_telefono)}</p>` : ''}${r.direccion ? `<p class="muted">📍 ${esc(r.direccion)}</p>` : ''}
    <table><tr><th>Pieza</th><th class="r">Cant.</th><th class="r">$/día</th></tr>
      ${r.grupos.map(g => `<tr><td>${esc(g.tipo)}<div class="muted">${esc(g.codigos.join(', '))}</div></td><td class="r">${g.cantidad}</td><td class="r">${mxn(g.precio_dia)}</td></tr>`).join('')}</table>
    <table style="margin-top:10px">
      <tr><td>Subtotal (${r.dias} d)</td><td class="r money">${mxn(r.subtotal)}</td></tr>
      <tr><td>Cargo adicional${r.extra_concepto ? ` <span class="muted">(${esc(r.extra_concepto)})</span>` : ''}</td><td class="r money">${mxn(r.extra)}</td></tr>
      ${r.estado === 'cancelada' ? (r.iva ? `<tr><td>IVA (${r.iva_pct}%)</td><td class="r money">${mxn(r.iva)}</td></tr>` : '')
        : `<tr><td><label style="display:flex;gap:8px;align-items:center;margin:0;color:inherit;font-size:inherit;font-weight:400"><input type="checkbox" id="chkIva" class="chk" ${r.iva_pct > 0 ? 'checked' : ''}> Con IVA (16%) <span class="muted">· quítalo si paga en efectivo sin IVA</span></label></td><td class="r money">${mxn(r.iva)}</td></tr>`}
      <tr><td><b>Total</b></td><td class="r money">${mxn(r.total)}</td></tr>
      <tr><td>Pagado</td><td class="r money" style="color:var(--ok)">${mxn(r.pagado)}</td></tr>
      <tr><td><b>Saldo</b></td><td class="r money" style="color:${r.saldo > 0 ? 'var(--bad)' : 'var(--ok)'}">${mxn(r.saldo)}</td></tr></table>
    <h3>Pagos</h3>
    ${r.pagos.map(p => `<div class="row" style="cursor:default"><div class="grow"><div class="t">${mxn(p.monto)} <span class="badge">${esc(p.tipo)}</span></div>
      <div class="s">${fecha(p.fecha)}${p.nota ? ' · ' + esc(p.nota) : ''}</div></div>
      <select data-forma="${p.id}" style="width:auto" title="Forma de pago"><option value="">Forma: sin especificar</option>
        <option value="efectivo" ${p.forma === 'efectivo' ? 'selected' : ''}>Efectivo</option><option value="transferencia" ${p.forma === 'transferencia' ? 'selected' : ''}>Transferencia</option></select>
      <button class="btn small danger" data-delpago="${p.id}">Quitar</button></div>`).join('') || '<p class="muted">Sin pagos registrados.</p>'}
    ${r.estado !== 'cancelada' ? `<form id="fPago" class="f2" style="margin-top:8px">
      <div><label>Monto</label><input name="monto" type="number" step="0.01" min="0.01" required></div>
      <div><label>Tipo</label><select name="tipo"><option value="pago">Pago</option><option value="anticipo">Anticipo</option></select></div>
      <div><label>Forma de pago</label><select name="forma"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option></select></div><div></div>
      <div style="grid-column:1/-1"><button class="btn small primary" type="submit">Registrar pago</button>
        ${r.saldo > 0 ? `<button class="btn small" type="button" id="liquidar">Liquidar saldo (${mxn(r.saldo)})</button>` : ''}</div></form>` : ''}
    ${r.estado !== 'cancelada' ? `<h3>Factura</h3>
    <form id="fFactura" class="f2"><div style="grid-column:1/-1"><label style="display:flex;gap:8px;align-items:center;margin:0;color:inherit;font-size:inherit;font-weight:600"><input type="checkbox" name="facturada" class="chk" ${r.facturada ? 'checked' : ''}> Se generó factura a este cliente</label></div>
      <div><label>Folio de la factura (opcional)</label><input name="factura_folio" value="${esc(r.factura_folio || '')}" placeholder="Ej. A-123"></div>
      <div style="align-self:end"><button class="btn small" type="submit">Guardar factura</button></div></form>
    ${r.facturada && !(r.iva_pct > 0) ? '<p class="muted" style="color:var(--warn)">⚠ Marcaste factura, pero esta renta está sin IVA.</p>' : ''}` : ''}
    <h3>Cargo adicional y notas</h3>
    <form id="fExtra" class="f2"><div><label>Monto ($)</label><input name="extra" type="number" step="0.01" value="${r.extra}"></div>
      <div><label>Concepto</label><input name="extra_concepto" value="${esc(r.extra_concepto || '')}" placeholder="Traslado, daño, retraso…"></div>
      <div style="grid-column:1/-1"><label>Notas</label><textarea name="notas" rows="2">${esc(r.notas || '')}</textarea></div>
      <div style="grid-column:1/-1"><button class="btn small" type="submit">Guardar</button></div></form>
    ${tiposEq.length ? `<h3>Equipo entregado</h3>
      <p class="muted">Marca lo que realmente salió con esta renta y cuántas piezas. Esto define la <b>utilización</b> y el <b>inventario en renta</b>; la cantidad de arriba es solo para el precio.</p>
      <div id="equipoLista">${tiposEq.map(t => {
        const c = (r.equipo.find(e => e.tipo === t.tipo) || {}).cantidad || 0;
        return `<div class="pick" data-tipo="${esc(t.tipo)}"><input type="checkbox" class="chk" ${c ? 'checked' : ''} aria-label="${esc(t.tipo)}">
          ${t.foto ? `<img class="thumb" src="${t.foto}" alt="">` : '<div class="thumb"></div>'}
          <div class="grow"><div class="t">${esc(t.tipo)}</div></div>
          <div><input class="q" type="number" min="1" max="999" value="${c || ''}" placeholder="0" ${c ? '' : 'disabled'}></div></div>`;
      }).join('')}</div>
      <div style="margin-top:8px"><button class="btn small primary" id="guardarEquipo">Guardar equipo entregado</button></div>` : ''}
    <div class="actions">
      ${r.estado === 'apartada' ? '<button class="btn primary" id="entregar">Marcar entregada</button>' : ''}
      ${r.estado === 'activa' ? '<button class="btn primary" id="devolver">Registrar devolución</button>' : ''}
      ${wa ? `<a class="btn" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${r.estado === 'apartada' || r.estado === 'activa' ? '<button class="btn danger" id="cancelar">Cancelar renta</button>' : ''}
    </div>`);
  const reabrir = () => { abrirRenta(id); refrescar(); };
  const accion = (sel, fn) => { const el = $(sel, dlg); if (el) el.onclick = () => act(async () => { await fn(); reabrir(); }); };
  accion('#entregar', () => api('POST', `/api/rentas/${id}/entregar`, {}));
  accion('#devolver', () => api('POST', `/api/rentas/${id}/devolver`, {}));
  accion('#cancelar', async () => { if (!confirm('¿Cancelar esta renta? Las piezas quedarán libres.')) throw new Error('Cancelación abortada'); await api('POST', `/api/rentas/${id}/cancelar`, {}); });
  accion('#liquidar', () => api('POST', `/api/rentas/${id}/pagos`, { monto: r.saldo, tipo: 'pago', nota: 'Liquidación', forma: $('#fPago', dlg).elements.forma.value }));
  const chkIva = $('#chkIva', dlg);
  if (chkIva) chkIva.onchange = () => act(async () => { await api('PATCH', `/api/rentas/${id}`, { iva_pct: chkIva.checked ? 16 : 0 }); toast(chkIva.checked ? 'IVA agregado' : 'Sin IVA'); reabrir(); });
  $$('[data-forma]', dlg).forEach(s => s.onchange = () => act(async () => { await api('PATCH', `/api/pagos/${s.dataset.forma}`, { forma: s.value }); toast('Forma de pago actualizada'); reabrir(); }));
  const fFactura = $('#fFactura', dlg);
  if (fFactura) fFactura.onsubmit = e => { e.preventDefault(); act(async () => { await api('PATCH', `/api/rentas/${id}`, { facturada: fFactura.elements.facturada.checked, factura_folio: fFactura.elements.factura_folio.value }); toast('Factura guardada'); reabrir(); }); };
  $$('[data-delpago]', dlg).forEach(b => b.onclick = () => act(async () => { if (confirm('¿Quitar este pago?')) { await api('DELETE', `/api/pagos/${b.dataset.delpago}`); reabrir(); } }));
  const fPago = $('#fPago', dlg);
  if (fPago) fPago.onsubmit = e => { e.preventDefault(); const f = new FormData(fPago); act(async () => { await api('POST', `/api/rentas/${id}/pagos`, { monto: f.get('monto'), tipo: f.get('tipo'), forma: f.get('forma') }); reabrir(); }); };
  $('#fExtra', dlg).onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); act(async () => { await api('PATCH', `/api/rentas/${id}`, Object.fromEntries(f)); toast('Guardado'); reabrir(); }); };
  const lista = $('#equipoLista', dlg);
  if (lista) {
    $$('.pick', lista).forEach(fila => {
      const chk = $('.chk', fila), q = $('.q', fila);
      chk.onchange = () => { // al marcar, propone lo cotizado (o 1); al desmarcar, la cantidad queda en blanco
        q.disabled = !chk.checked;
        q.value = chk.checked ? (q.value || (r.grupos.find(g => g.tipo === fila.dataset.tipo) || {}).cantidad || 1) : '';
      };
    });
    $('#guardarEquipo', dlg).onclick = () => act(async () => {
      const items = $$('.pick', lista).map(fila => ({ tipo: fila.dataset.tipo, cantidad: $('.chk', fila).checked ? parseInt($('.q', fila).value, 10) || 0 : 0 }));
      await api('PATCH', `/api/rentas/${id}/equipo`, { items });
      toast('Equipo entregado guardado'); reabrir();
    });
  }
}

async function nuevaRenta() {
  const clientes = await api('GET', '/api/clientes');
  const st = { tipos: [], fetchId: 0 };
  abrirDlg(`${dlgHead('Nueva renta')}
    <form id="fNueva">
      <label>Cliente</label>
      <select name="cliente_id"><option value="">➕ Cliente nuevo</option>${clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}${c.telefono ? ' · ' + esc(c.telefono) : ''}</option>`).join('')}</select>
      <div id="nuevoCli" class="f2"><div><label>Nombre</label><input name="cnombre"></div><div><label>Teléfono / WhatsApp</label><input name="ctel" inputmode="tel"></div></div>
      <div class="f2"><div><label>Inicio</label><input name="fecha_inicio" type="date" value="${hoyStr()}" required></div>
        <div><label>Días de renta</label><input name="dias" type="number" min="1" max="365" value="5" required></div></div>
      <div class="f2"><div><label>Estatus</label><select name="estado"><option value="activa">Entrega inmediata (en obra)</option><option value="apartada">Apartar para esa fecha</option></select></div>
        <div><label>Dirección de entrega</label><input name="direccion"></div></div>
      <h3>Piezas <span id="dispInfo" class="muted"></span></h3>
      <div id="tipos"><p class="muted">Cargando…</p></div>
      <div class="f2"><div><label>Cargo adicional ($)</label><input name="extra" type="number" step="0.01" value="0"></div>
        <div><label>Concepto</label><input name="extra_concepto" placeholder="Traslado, etc."></div></div>
      <label>Notas</label><textarea name="notas" rows="2"></textarea>
      <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="iva" style="width:auto"> Agregar IVA (16%)</label>
      <div class="total"><div class="muted">TOTAL ESTIMADO</div><div class="n" id="totalPrev">$0</div><div class="muted" id="totalDet"></div></div>
      <p class="error" id="nrErr"></p>
      <div class="actions"><button class="btn primary" type="submit">Guardar renta</button><button class="btn x" type="button">Cancelar</button></div>
    </form>`);
  const form = $('#fNueva');
  const val = n => form.elements[n].value;
  const toggleCli = () => { $('#nuevoCli').hidden = !!val('cliente_id'); };
  form.elements.cliente_id.onchange = toggleCli; toggleCli();

  function recalc() {
    const dias = Math.max(1, parseInt(val('dias'), 10) || 1);
    const filas = $$('.pick[data-tipo]', form).map(el => ({ el, t: st.tipos.find(x => x.tipo === el.dataset.tipo), q: parseInt($('.q', el).value, 10) || 0 }));
    const nAndamios = filas.filter(f => f.t.categoria === 'andamio').reduce((s, f) => s + f.q, 0);
    let sub = 0;
    for (const { el, t, q } of filas) {
      const auto = t.categoria === 'andamio' ? AR.precioAndamioPorDia(dias, nAndamios || 1) : t.renta_dia;
      const inp = $('.p', el); inp.placeholder = auto;
      const precio = inp.value !== '' ? Number(inp.value) : auto;
      sub += q * precio * dias;
    }
    const extra = Number(val('extra')) || 0;
    const iva = form.elements.iva.checked ? Math.round((sub + extra) * 16) / 100 : 0;
    $('#totalPrev').textContent = mxn(sub + extra + iva);
    $('#totalDet').textContent = `${mxn(sub)} de renta por ${dias} día${dias > 1 ? 's' : ''}${extra ? ` + ${mxn(extra)} adicional` : ''}${iva ? ` + ${mxn(iva)} de IVA` : ''}`;
  }
  async function cargarTipos() {
    const my = ++st.fetchId;
    const ini = val('fecha_inicio'), dias = Math.max(1, parseInt(val('dias'), 10) || 1);
    if (!ini) return;
    const tipos = await act(() => api('GET', `/api/tipos?inicio=${ini}&dias=${dias}`));
    if (!tipos || my !== st.fetchId) return;
    const previos = Object.fromEntries($$('.pick[data-tipo]', form).map(el => [el.dataset.tipo, [$('.q', el).value, $('.p', el).value]]));
    st.tipos = tipos.filter(t => t.operativos > 0);
    $('#dispInfo').textContent = `(disponibles del ${fechaCorta(ini)} al ${fechaCorta(addDias(ini, dias))})`;
    $('#tipos').innerHTML = st.tipos.map(t => `<div class="pick" data-tipo="${esc(t.tipo)}">
      ${t.foto ? `<img class="thumb" src="${t.foto}" alt="">` : '<div class="thumb"></div>'}
      <div class="grow"><div class="t">${esc(t.tipo)}</div><div class="s ${t.disponibles ? '' : 'err'}">${t.disponibles} disponible${t.disponibles === 1 ? '' : 's'}</div></div>
      <div><label style="margin:0">Cant.</label><input class="q" type="number" min="0" max="${t.disponibles}" value="${previos[t.tipo]?.[0] || 0}"></div>
      <div><label style="margin:0">$/día</label><input class="p" type="number" step="0.01" min="0" value="${previos[t.tipo]?.[1] || ''}"></div></div>`).join('');
    $$('#tipos input', form).forEach(i => i.oninput = recalc);
    recalc();
  }
  const addDias = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  ['fecha_inicio', 'dias'].forEach(n => form.elements[n].addEventListener('change', () => { cargarTipos(); }));
  form.elements.extra.oninput = recalc; form.elements.dias.oninput = recalc; form.elements.iva.onchange = recalc;
  await cargarTipos();

  form.onsubmit = async e => {
    e.preventDefault();
    const items = $$('.pick[data-tipo]', form).map(el => ({ tipo: el.dataset.tipo, cantidad: parseInt($('.q', el).value, 10) || 0, precio_dia: $('.p', el).value }));
    const body = {
      cliente_id: val('cliente_id') || null, cliente: { nombre: val('cnombre'), telefono: val('ctel') },
      fecha_inicio: val('fecha_inicio'), dias: Number(val('dias')), estado: val('estado'), direccion: val('direccion'),
      extra: val('extra'), extra_concepto: val('extra_concepto'), notas: val('notas'), items, iva_pct: form.elements.iva.checked ? 16 : 0,
    };
    try { const r = await api('POST', '/api/rentas', body); dlg.close(); toast(`Renta ${r.folio} creada`); ir('rentas'); abrirRenta(r.id); }
    catch (err) { $('#nrErr').textContent = err.message; }
  };
}

// ---------- Inventario ----------
async function vInventario() {
  const tipos = await api('GET', '/api/tipos');
  $('#main').innerHTML = `<h2>Inventario</h2><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
    ${tipos.map(t => `<div class="card" data-tipo="${esc(t.tipo)}" style="cursor:pointer"><div class="row" style="border:0;padding:0;cursor:pointer">
      ${t.foto ? `<img class="thumb" src="${t.foto}" alt="">` : '<div class="thumb"></div>'}
      <div class="grow"><div class="t">${esc(t.tipo)}</div><div class="s">${t.total} piezas</div></div></div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap"><span class="badge ok">${t.disponibles} libres hoy</span>
        <span class="badge info">${t.rentados} en renta</span>${t.mantenimiento ? `<span class="badge warn">${t.mantenimiento} mantenimiento</span>` : ''}${t.baja ? `<span class="badge">${t.baja} baja</span>` : ''}</div></div>`).join('')}</div>`;
  $$('[data-tipo]', $('#main')).forEach(c => c.onclick = () => act(() => abrirTipo(c.dataset.tipo)));
}
async function abrirTipo(tipo) {
  const [activos, enCampo] = await Promise.all([api('GET', `/api/activos?tipo=${encodeURIComponent(tipo)}`), api('GET', `/api/equipo-en-campo?tipo=${encodeURIComponent(tipo)}`)]);
  const totalCampo = enCampo.reduce((s, x) => s + x.cantidad, 0);
  abrirDlg(`${dlgHead(esc(tipo))}<p class="muted">${activos.length} piezas. Cambia el estado de una pieza si está en mantenimiento o fuera de servicio.</p>
    <h3 style="margin-top:6px">En campo ahora: ${totalCampo}</h3>
    ${enCampo.map(x => `<div class="pick"><div class="grow"><div class="t">${esc(x.cliente)} <span class="muted">${esc(x.folio)}</span></div>
      <div class="s">Regresa el ${fecha(x.fecha_fin)}</div></div><div>${x.vencida ? '<span class="badge bad">Vencida</span> ' : ''}<span class="money">${x.cantidad}</span></div></div>`).join('') || '<p class="muted">Ninguna pieza de este tipo está en renta.</p>'}
    <p class="muted" style="margin-top:6px">Se calcula con el <b>equipo entregado</b> de cada renta activa.</p>
    <h3>Piezas</h3>
    ${activos.map(a => `<div class="pick"><div class="grow"><div class="t">${esc(a.codigo)}</div>
      <div class="s">${a.en_renta ? `En renta · ${esc(a.en_renta.nombre)} (${esc(a.en_renta.folio)})` : esc(a.ubicacion || '')}</div></div>
      <select data-act="${a.id}" style="width:150px">${['Disponible', 'Mantenimiento', 'Baja'].map(e => `<option ${a.estado === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>`).join('')}
    <form id="fAlta" class="f2" style="margin-top:14px"><div><label>Agregar pieza: código</label><input name="codigo" required placeholder="AR-AN-PL-031"></div>
      <div style="align-self:end"><button class="btn primary" type="submit">Agregar</button></div></form>`);
  $$('[data-act]', dlg).forEach(s => s.onchange = () => act(async () => { await api('PATCH', `/api/activos/${s.dataset.act}`, { estado: s.value }); toast('Actualizado'); refrescar(); }));
  $('#fAlta', dlg).onsubmit = e => { e.preventDefault(); act(async () => { await api('POST', '/api/activos', { codigo: new FormData(e.target).get('codigo'), tipo }); toast('Pieza agregada'); abrirTipo(tipo); refrescar(); }); };
}

// ---------- Clientes ----------
async function vClientes() {
  const cs = await api('GET', '/api/clientes');
  $('#main').innerHTML = `<div class="toolbar"><h2 style="margin:0">Clientes</h2><span class="spacer"></span><button id="nuevoCliente" class="btn primary">+ Nuevo cliente</button></div>
    <div class="card">${cs.map(c => `<div class="row" data-cli="${c.id}"><div class="grow"><div class="t">${esc(c.nombre)}</div>
      <div class="s">${esc(c.telefono || 'Sin teléfono')} · ${c.rentas} renta${c.rentas === 1 ? '' : 's'}</div></div>
      <div style="text-align:right"><div class="money">${mxn(c.total)}</div>${c.saldo > 0 ? `<div class="money" style="color:var(--bad);font-size:.85rem">Debe ${mxn(c.saldo)}</div>` : ''}</div></div>`).join('') || '<p class="muted">Aún no hay clientes.</p>'}</div>`;
  const form = c => { abrirDlg(`${dlgHead(c ? 'Editar cliente' : 'Nuevo cliente')}<form id="fCli">
      <label>Nombre</label><input name="nombre" required value="${esc(c?.nombre || '')}">
      <label>Teléfono / WhatsApp</label><input name="telefono" inputmode="tel" value="${esc(c?.telefono || '')}">
      <label>Dirección habitual</label><input name="direccion" value="${esc(c?.direccion || '')}">
      <label>Notas</label><textarea name="notas" rows="2">${esc(c?.notas || '')}</textarea>
      <div class="actions"><button class="btn primary" type="submit">Guardar</button></div></form>`);
    $('#fCli', dlg).onsubmit = e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
      act(async () => { await api(c ? 'PATCH' : 'POST', c ? `/api/clientes/${c.id}` : '/api/clientes', body); dlg.close(); toast('Guardado'); refrescar(); }); };
  };
  $('#nuevoCliente').onclick = () => form(null);
  $$('[data-cli]').forEach(el => el.onclick = () => form(cs.find(c => c.id === Number(el.dataset.cli))));
}

// ---------- Reportes ----------
let periodo = 'todo';
function rango(p) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  const f = d => d.toLocaleDateString('en-CA');
  if (p === 'mes') return [f(new Date(y, m, 1)), f(new Date(y, m + 1, 0))];
  if (p === 'mespasado') return [f(new Date(y, m - 1, 1)), f(new Date(y, m, 0))];
  if (p === '30') return [f(new Date(n.getTime() - 29 * 86400000)), f(n)];
  if (p === 'anio') return [`${y}-01-01`, `${y}-12-31`];
  return ['2000-01-01', '2100-12-31'];
}

// Los gráficos se dibujan al ancho de la pantalla: se redibujan al girar el celular o cambiar el tamaño de la ventana.
let anchoPrevio = window.innerWidth, temporizadorRedibujo;
window.addEventListener('resize', () => {
  clearTimeout(temporizadorRedibujo);
  temporizadorRedibujo = setTimeout(() => {
    if (Math.abs(window.innerWidth - anchoPrevio) > 30 && ['resumen', 'cotizaciones', 'reportes', 'utilizacion'].includes(vista)) { anchoPrevio = window.innerWidth; refrescar(); }
  }, 300);
});
