'use strict';
// Reporte de valor en activos. Valor = valor de compra sin IVA de cada pieza (de tu inventario); con IVA = ×1.16.
// Se carga ANTES de app.js; usa ayudantes de app.js ($, $$, esc, mxn, fecha, hoyStr, api, stat…) al ejecutarse.
const pctA = x => { const v = x * 100; return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`; };

async function vActivos() {
  const d = await api('GET', '/api/valor-activos');
  const grupo = (titulo, filas) => {
    if (!filas.length) return '';
    const sum = k => filas.reduce((s, t) => s + t[k], 0);
    return `<tr class="grupo"><td colspan="8">${titulo}</td></tr>${filas.map(t => `<tr>
      <td>${esc(t.tipo)}</td><td class="r">${t.piezas}</td><td class="r">${mxn(t.unitario)}</td><td class="r money">${mxn(t.valor)}</td>
      <td class="r">${pctA(d.valor ? t.valor / d.valor : 0)}</td>
      <td class="r">${t.en_renta ? `${t.en_renta} <span class="muted">(${mxn(t.valor_en_renta)})</span>` : '—'}</td>
      <td class="r">${t.operativas - t.en_renta > 0 ? t.operativas - t.en_renta : 0}</td>
      <td class="r">${t.mantenimiento || t.baja ? `${t.mantenimiento ? `${t.mantenimiento} mant.` : ''}${t.mantenimiento && t.baja ? ' · ' : ''}${t.baja ? `${t.baja} baja` : ''}` : '—'}</td></tr>`).join('')}
      <tr class="subtotal"><td>Subtotal</td><td class="r">${sum('piezas')}</td><td></td><td class="r money">${mxn(sum('valor'))}</td><td class="r">${pctA(d.valor ? sum('valor') / d.valor : 0)}</td>
      <td class="r">${sum('en_renta') || '—'}</td><td class="r">${sum('operativas') - sum('en_renta')}</td><td></td></tr>`;
  };
  const maxV = Math.max(1, ...d.tipos.map(t => t.valor));
  $('#main').innerHTML = `<div class="toolbar"><h2 style="margin:0">Valor en activos</h2><span class="spacer"></span>
      <button class="btn" onclick="window.print()">Imprimir / PDF</button></div>
    <p class="muted">Al ${fecha(hoyStr())} · valor de compra sin IVA de cada pieza de tu inventario; con IVA se calcula al 16%</p>
    <div class="grid">${stat(mxn(d.valor), 'Valor de la flota (sin IVA)')}${stat(mxn(d.valorConIva), 'Valor con IVA (16%)')}${stat(d.piezas, 'Piezas')}
      ${stat(mxn(d.valorEnRenta), `Valor en renta ahora (${pctA(d.valor ? d.valorEnRenta / d.valor : 0)})`, 'ok')}
      ${stat(pctA(d.recuperado), `Inversión recuperada (ventas sin IVA ${mxn(d.ventasSinIva)})`, d.recuperado >= 1 ? 'ok' : '')}</div>
    <div class="cols">
      <div class="card"><h3 style="margin-top:0">Dónde está el valor</h3>${d.tipos.map(t => `<div class="pick"><div class="grow"><div class="t">${esc(t.tipo)}</div>
        <div class="bar"><i style="width:${Math.round(t.valor / maxV * 100)}%"></i></div></div>
        <div style="text-align:right"><div class="money">${mxn(t.valor)}</div><div class="s">${pctA(d.valor ? t.valor / d.valor : 0)} · ${t.piezas} pzs</div></div></div>`).join('')}</div>
      <div class="card"><h3 style="margin-top:0">Estado del valor</h3>
        <div class="pick"><div class="grow"><div class="t">En renta ahora</div><div class="s">${d.enRenta} pieza${d.enRenta === 1 ? '' : 's'}</div></div><div class="money" style="color:var(--ok)">${mxn(d.valorEnRenta)}</div></div>
        <div class="pick"><div class="grow"><div class="t">Disponible en bodega</div><div class="s">operativo y sin rentar</div></div><div class="money">${mxn(d.valor - d.valorEnRenta - d.valorMantenimiento - d.valorBaja)}</div></div>
        <div class="pick"><div class="grow"><div class="t">En mantenimiento</div><div class="s">${d.piezasMantenimiento} pieza${d.piezasMantenimiento === 1 ? '' : 's'}</div></div><div class="money" style="color:var(--warn)">${mxn(d.valorMantenimiento)}</div></div>
        <div class="pick"><div class="grow"><div class="t">Dado de baja</div><div class="s">${d.piezasBaja} pieza${d.piezasBaja === 1 ? '' : 's'}</div></div><div class="money" style="color:var(--bad)">${mxn(d.valorBaja)}</div></div></div></div>
    <h3>Detalle por tipo</h3>
    <div class="card tabla-scroll"><table class="detalle"><thead><tr><th>Tipo</th><th class="r">Piezas</th><th class="r">Valor unitario</th><th class="r">Valor total</th><th class="r">% del total</th>
      <th class="r">En renta (valor)</th><th class="r">Libres</th><th class="r">Mant. / baja</th></tr></thead>
      <tbody>${grupo('Andamios', d.tipos.filter(t => t.categoria === 'andamio'))}${grupo('Plataformas y accesorios', d.tipos.filter(t => t.categoria !== 'andamio'))}</tbody>
      <tfoot><tr><th>TOTAL</th><th class="r">${d.piezas}</th><th></th><th class="r">${mxn(d.valor)}</th><th class="r">100%</th><th class="r">${d.enRenta || '—'}</th><th></th><th></th></tr></tfoot></table></div>
    <p class="muted">"Inversión recuperada" = ventas acumuladas sin IVA ÷ valor de la flota sin IVA. Es un indicador de recuperación, no de utilidad: no descuenta gastos. "En renta" usa el equipo entregado de las rentas activas.</p>`;
}
