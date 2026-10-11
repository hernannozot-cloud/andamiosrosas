'use strict';
// Reportes: ventas del periodo (equivalente a la hoja "Reporte de Ventas" del Excel) y rankings.
// Se carga ANTES de app.js; usa sus ayudantes ($, esc, mxn, fecha, api, stat, rango, periodo, refrescar…) al ejecutarse.
async function vReportes() {
  const [desde, hasta] = rango(periodo);
  const d = await api('GET', `/api/reportes?desde=${desde}&hasta=${hasta}`);
  const max = Math.max(1, ...d.masRentado.map(x => x.pz_dia));
  const ranking = cat => d.masRentado.filter(x => x.categoria === cat).map(x => `<div class="pick"><div class="grow"><div class="t">${esc(x.tipo)}</div>
    <div class="bar"><i style="width:${Math.round(x.pz_dia / max * 100)}%"></i></div></div>
    <div style="text-align:right"><div class="money">${x.pz_dia} pz-día</div><div class="s">${mxn(x.ingreso)}</div></div></div>`).join('') || '<p class="muted">Sin movimiento.</p>';
  const ep = d.estadoPago;
  const fila = r => `<tr data-renta="${r.id}">
    <td>${esc(r.folio)}</td><td>${esc(r.cliente)}<div class="muted">${esc(r.telefono || '')}</div></td>
    <td>${fechaCorta(r.fecha_inicio)}${r.estado === 'cancelada' ? '' : ` → ${fechaCorta(r.fecha_fin)}`}</td>
    <td>${esc(r.piezas)}</td><td class="r">${r.dias}</td>
    <td class="r">${mxn(r.cobrado)}</td><td class="r">${mxn(r.iva)}</td><td class="r money">${mxn(r.total)}</td>
    <td>${r.saldo > 0.5 ? `<span class="badge bad">Debe ${mxn(r.saldo)}</span>` : '<span class="badge ok">Pagado</span>'}${r.facturada ? ' <span class="badge info">Factura</span>' : ''}${r.con_iva ? '' : ' <span class="badge">Sin IVA</span>'}${r.forma_pago ? `<div class="muted">${esc(r.forma_pago)}</div>` : ''}</td></tr>`;
  const sum = k => d.detalle.reduce((s, r) => s + r[k], 0);
  const opciones = [['mes', 'Este mes'], ['mespasado', 'Mes pasado'], ['30', 'Últimos 30 días'], ['anio', 'Este año'], ['todo', 'Todo el tiempo']];
  $('#main').innerHTML = `<div class="toolbar"><h2 style="margin:0">Reportes de ventas</h2><span class="spacer"></span>
      <select id="periodo" style="width:auto">${opciones.map(([k, n]) => `<option value="${k}" ${k === periodo ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn" onclick="window.print()">Imprimir / PDF</button></div>
    <p class="muted">${periodo === 'todo' ? 'Todas las rentas' : `Rentas que inician entre ${fecha(desde)} y ${fecha(hasta)}`}${d.primera ? ` · primera renta ${fecha(d.primera)} · última ${fecha(d.ultima)}` : ''}</p>
    <div class="grid">${stat(d.rentas, 'Rentas')}${stat(mxn(d.facturado), 'Ventas totales (con IVA)')}${stat(mxn(d.cobrado), 'Cobrado', 'ok')}
      ${stat(mxn(d.porCobrar), 'Por cobrar', d.porCobrar > 0.5 ? 'bad' : '')}${stat(mxn(d.ticket), 'Ticket promedio')}${stat(d.diasRentados, 'Días rentados')}</div>
    <p class="muted" style="margin-top:8px">Ventas sin IVA ${mxn(d.sinIva)} + IVA ${mxn(d.iva)}</p>
    <div id="grafVentas" style="margin-top:14px"></div>
    <div class="cols">
      <div class="card"><h3 style="margin-top:0">Forma de pago y facturas</h3>
        <div class="pick"><div class="grow"><div class="t">Cobrado en efectivo</div></div><div class="money">${mxn(d.porForma.efectivo)}</div></div>
        <div class="pick"><div class="grow"><div class="t">Cobrado por transferencia</div></div><div class="money">${mxn(d.porForma.transferencia)}</div></div>
        ${d.porForma.sin > 0.5 ? `<div class="pick"><div class="grow"><div class="t">Sin forma de pago capturada</div><div class="s">ábrelas y elige efectivo o transferencia</div></div><div class="money" style="color:var(--warn)">${mxn(d.porForma.sin)}</div></div>` : ''}
        <div class="pick"><div class="grow"><div class="t">Rentas con factura</div><div class="s">${d.facturas.n} de ${d.rentas} · ${d.facturas.sinFactura} sin factura</div></div><div class="money">${mxn(d.facturas.importe)}</div></div>
        <div class="pick"><div class="grow"><div class="t">Rentas con IVA / sin IVA</div></div><div class="money">${d.conIva} / ${d.sinIvaN}</div></div></div>
      <div class="card"><h3 style="margin-top:0">Estado de pago</h3>
        <div class="pick"><div class="grow"><div class="t">Pagadas</div><div class="s">${ep.pagadas.n} renta${ep.pagadas.n === 1 ? '' : 's'}</div></div><div class="money" style="color:var(--ok)">${mxn(ep.pagadas.importe)}</div></div>
        <div class="pick"><div class="grow"><div class="t">Con saldo pendiente</div><div class="s">${ep.pendientes.n} renta${ep.pendientes.n === 1 ? '' : 's'}</div></div><div class="money" style="color:${ep.pendientes.n ? 'var(--bad)' : 'inherit'}">${mxn(ep.pendientes.importe)}</div></div></div>
      <div class="card"><h3 style="margin-top:0">Mejores clientes</h3>${d.mejoresClientes.map(c => `<div class="pick"><div class="grow"><div class="t">${esc(c.nombre)}</div>
        <div class="s">${c.rentas} renta${c.rentas === 1 ? '' : 's'}</div></div><div class="money">${mxn(c.total)}</div></div>`).join('') || '<p class="muted">Sin datos.</p>'}</div>
      <div class="card"><h3 style="margin-top:0">Andamios más rentados</h3>${ranking('andamio')}</div>
      <div class="card"><h3 style="margin-top:0">Accesorios más rentados</h3>${ranking('accesorio')}</div></div>
    <h3>Detalle de rentas</h3>
    <div class="card tabla-scroll">${d.detalle.length ? `<table class="detalle"><thead><tr><th>Folio</th><th>Cliente</th><th>Fechas</th><th>Piezas</th><th class="r">Días</th>
      <th class="r">Cobrado</th><th class="r">IVA</th><th class="r">Total</th><th>Pago</th></tr></thead>
      <tbody>${d.detalle.map(fila).join('')}</tbody>
      <tfoot><tr><th colspan="5" class="r">TOTAL</th><th class="r">${mxn(sum('cobrado'))}</th><th class="r">${mxn(sum('iva'))}</th><th class="r">${mxn(sum('total'))}</th><th></th></tr></tfoot></table>`
      : '<p class="muted">No hay rentas en este periodo.</p>'}</div>`;
  $('#periodo').onchange = e => { periodo = e.target.value; refrescar(); };
  enlazarRentas($('#main'));
  act(() => pintarGraficoVentas('#grafVentas'));
}
