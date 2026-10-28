'use strict';
// Cotización en PDF con el mismo diseño de la hoja de Excel (logo, tabla gris, total en banda rosa).
// El PDF se genera con el navegador instalado (Edge/Chrome) en modo "headless", sin dependencias.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// GESTION_CHROME indica la ruta del navegador si no está en un lugar conocido (en Render: Chromium de Linux).
const NAVEGADORES = [
  process.env.GESTION_CHROME,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].filter(Boolean);
const LOGO = path.join(__dirname, '..', 'sitio-web', 'assets', 'logo.png');
const WHATSAPP = '55 3948 1162';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaLarga = s => {
  const [y, m, d] = String(s).split('-').map(Number);
  return y ? `${String(d).padStart(2, '0')} de ${MESES[m - 1]} del ${y}` : '';
};
let logoUri = null;
function logoDataUri() {
  if (logoUri === null) {
    try { logoUri = `data:image/png;base64,${fs.readFileSync(LOGO).toString('base64')}`; } catch { logoUri = ''; }
  }
  return logoUri;
}

// Las llantas se cotizan por juego de 4: en el sistema son piezas (1 juego = 4 llantas).
const JUEGOS = { Llanta: { nombre: 'Juego de 4 llantas', n: 4 } };
const comoSeCotiza = i => {
  const j = JUEGOS[i.tipo];
  return j && i.cantidad % j.n === 0
    ? { nombre: j.nombre, cantidad: i.cantidad / j.n, precio: i.precio_dia * j.n }
    : { nombre: i.tipo, cantidad: i.cantidad, precio: i.precio_dia }; // si no completa un juego, se deja en piezas
};

function htmlCotizacion(c) {
  const unico = c.items.length === 1;
  const filas = c.items.map((i, k) => {
    const sub = unico ? c.subtotal : i.cantidad * i.precio_dia * c.dias; // un solo renglón: cuadra al centavo con el total guardado
    const m = comoSeCotiza(i);
    return `<tr class="${k % 2 ? 'alt' : ''}"><td class="desc">${esc(m.nombre)}</td><td>${m.cantidad}</td><td>${money(m.precio)}</td><td>${c.dias}</td><td class="r">${money(sub)}</td></tr>`;
  });
  filas.push(`<tr class="${c.items.length % 2 ? 'alt' : ''}"><td class="desc">Traslado, montaje, desmontaje y recolección</td><td>1</td><td>${c.logistico ? '—' : money(0)}</td><td>${c.logistico ? '—' : c.dias}</td><td class="r">${money(c.logistico)}</td></tr>`);
  const relleno = Math.max(0, 8 - filas.length);
  for (let k = 0; k < relleno; k++) filas.push(`<tr class="${(filas.length) % 2 ? 'alt' : ''} vacia"><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>`);
  const traslado = c.fecha_traslado ? `<div>Fecha de traslado: <b>${esc(fechaLarga(c.fecha_traslado))}</b></div>` : '';
  const recoleccion = c.fecha_recoleccion ? `<div>Fecha de recolección: <b>${esc(fechaLarga(c.fecha_recoleccion))}</b></div>` : '';
  return `<!DOCTYPE html><html lang="es-MX"><head><meta charset="UTF-8"><title>${esc(c.folio)} ${esc(c.nombre)}</title>
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Calibri, Carlito, "Segoe UI", Arial, sans-serif; color: #111; font-size: 10pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 296mm; padding: 14mm 12mm; }
.box { border: 1.2px solid #222; min-height: 150mm; }
.head { display: flex; justify-content: space-between; align-items: flex-end; padding: 10px 14px 6px; }
.head img { height: 21mm; display: block; }
.titulo { font-size: 15pt; font-weight: 700; }
.info { display: grid; grid-template-columns: 1fr auto; border-top: 1px solid #aaa; padding: 7px 0 0; font-size: 9pt; }
.info .fila { display: contents; }
.info .l { display: flex; gap: 10px; padding: 3px 10px; }
.info .r { display: flex; gap: 10px; padding: 3px 14px 3px 0; justify-content: flex-end; }
.lbl { color: #ef1e78; font-weight: 700; min-width: 105px; text-align: right; }
.lbl2 { min-width: 62px; text-align: right; color: #333; }
table.t { width: 100%; border-collapse: collapse; margin-top: 8px; }
.t th { background: #5f5f5f; color: #fff; font-size: 9pt; padding: 7px 6px; text-transform: uppercase; }
.t td { text-align: center; padding: 3px 8px; font-size: 9.5pt; }
.t td.r, .t th.r { text-align: right; }
.t td.desc { text-align: center; }
.t tr.alt td { background: #f2f2f2; }
.t th.d { width: 42%; }
.tot { margin: 14px 0 0 auto; width: 52%; border-collapse: collapse; }
.tot td { padding: 2px 8px; font-size: 9pt; }
.tot td:first-child { text-align: right; } .tot td:last-child { text-align: right; width: 40%; }
.tot tr.final td { background: #ef1e78; color: #111; font-weight: 800; font-size: 11pt; padding: 5px 8px; }
.extra { padding: 16px 14px 10px; font-size: 9pt; color: #333; line-height: 1.5; }
.pie { margin-top: 8mm; text-align: center; color: #666; font-size: 8.5pt; }
</style></head><body><div class="page"><div class="box">
  <div class="head">${logoDataUri() ? `<img src="${logoDataUri()}" alt="Andamios Rosas">` : '<b>ANDAMIOS ROSAS</b>'}<div class="titulo">COTIZACIÓN</div></div>
  <div class="info">
    <div class="l"><span class="lbl">COTIZACIÓN PARA:</span><span>${esc(c.nombre)}</span></div>
    <div class="r"><span class="lbl2">Número:</span><span style="min-width:70px;text-align:center">${esc(c.folio)}</span></div>
    <div class="l"><span class="lbl">DIRECCIÓN:</span><span>${esc(c.direccion || '')}</span></div>
    <div class="r"><span class="lbl2">Fecha:</span><span style="min-width:70px;text-align:center;font-size:8pt">${esc(fechaLarga(c.fecha))}</span></div>
  </div>
  <table class="t"><thead><tr><th class="d">Descripción</th><th>Cantidad</th><th>Precio por día</th><th>Días</th><th class="r">Sub-total</th></tr></thead><tbody>${filas.join('')}</tbody></table>
  <table class="tot">
    <tr><td>SUB-TOTAL:</td><td>${money(c.subtotal + c.logistico)}</td></tr>
    <tr><td>IVA${c.iva_pct ? ` (${c.iva_pct}%)` : ''}:</td><td>${money(c.iva)}</td></tr>
    <tr class="final"><td>TOTAL:</td><td>${money(c.total)}</td></tr>
  </table>
  <div class="extra">${traslado}${recoleccion}${c.notas ? `<div>Observaciones: ${esc(c.notas)}</div>` : ''}</div>
</div><div class="pie">Andamios Rosas · WhatsApp ${WHATSAPP} · andamiosrosas.com</div></div></body></html>`;
}

// Espera (hasta límite ms) a que el PDF exista y deje de crecer; regresa su contenido o null.
async function esperarPdf(pdfPath, limite = 30000) {
  const inicio = Date.now();
  let anterior = -1;
  while (Date.now() - inicio < limite) {
    try {
      if (fs.existsSync(pdfPath)) {
        const tam = fs.statSync(pdfPath).size;
        if (tam > 500 && tam === anterior) return fs.readFileSync(pdfPath);
        anterior = tam;
      }
    } catch { /* el archivo aún se está escribiendo: se reintenta */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

// Un PDF a la vez: evita abrir varios navegadores simultáneos en equipos con poca memoria.
let cola = Promise.resolve();
function generarPdf(html) {
  const job = cola.then(() => new Promise((resolve, reject) => {
    const exe = NAVEGADORES.find(p => fs.existsSync(p));
    if (!exe) return reject(new Error('No se encontró Edge, Chrome ni Chromium para generar el PDF'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gestion-pdf-'));
    const htmlPath = path.join(dir, 'cotizacion.html');
    const pdfPath = path.join(dir, 'cotizacion.pdf');
    fs.writeFileSync(htmlPath, html, 'utf8');
    const args = ['--headless', '--disable-gpu', '--no-first-run', '--disable-extensions', '--no-pdf-header-footer',
      `--user-data-dir=${path.join(dir, 'perfil')}`, `--print-to-pdf=${pdfPath}`];
    // En Linux (contenedor de Render) Chromium corre como root y con poca memoria compartida.
    if (process.platform === 'linux') args.push('--no-sandbox', '--disable-dev-shm-usage');
    args.push(pathToFileURL(htmlPath).href);
    // El lanzador de Edge puede terminar de inmediato y dejar que otro proceso escriba el PDF unos segundos
    // después, así que no basta con esperar a que termine el comando: hay que esperar a que exista el archivo.
    execFile(exe, args, { timeout: 45000, windowsHide: true }, err => {
      esperarPdf(pdfPath).then(pdf => {
        fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }, () => {});
        if (pdf) resolve(pdf); else reject(err || new Error('No se generó el PDF'));
      });
    });
  }));
  cola = job.catch(() => {});
  return job;
}

module.exports = { htmlCotizacion, generarPdf };
