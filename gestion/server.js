'use strict';
// Gestión Andamios Rosas — servidor local (sin dependencias, Node 22+).
// Datos en SQLite (node:sqlite) fuera de OneDrive; acceso protegido con PIN.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { htmlCotizacion, generarPdf } = require('./cotizacion-pdf');

require(path.join(__dirname, '..', 'sitio-web', 'logic.js')); // define globalThis.AR (tarifario)
const AR = globalThis.AR;

const DATA_DIR = process.env.GESTION_DATA_DIR || path.join(os.homedir(), 'AndamiosRosasData');
fs.mkdirSync(DATA_DIR, { recursive: true });
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* primera vez */ }
let primeraVez = false;
if (!config.pin || !config.secret) {
  config.pin = config.pin || String(crypto.randomInt(100000, 1000000));
  config.secret = config.secret || crypto.randomBytes(32).toString('hex');
  config.port = config.port || 8810;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  primeraVez = true;
}
const PORT = Number(process.env.PORT) || config.port;
const PUBLIC_DIR = path.join(__dirname, 'public');
const FOTOS_DIR = path.join(__dirname, '..', 'sitio-web', 'assets', 'productos');
const BACKUP_DIRS = [path.join(DATA_DIR, 'respaldos'), path.join(__dirname, 'respaldos')];

// ---------- Base de datos ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'gestion.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS activos (
  id INTEGER PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, tipo TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'accesorio', valor REAL DEFAULT 0, renta_dia REAL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'Disponible', condicion TEXT, ubicacion TEXT, notas TEXT
);
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, telefono TEXT, direccion TEXT, notas TEXT
);
CREATE TABLE IF NOT EXISTS rentas (
  id INTEGER PRIMARY KEY, folio TEXT, cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha_inicio TEXT NOT NULL, dias INTEGER NOT NULL, direccion TEXT,
  estado TEXT NOT NULL DEFAULT 'apartada', fecha_devolucion TEXT,
  extra REAL NOT NULL DEFAULT 0, extra_concepto TEXT, notas TEXT, creada TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS renta_activos (
  renta_id INTEGER NOT NULL REFERENCES rentas(id) ON DELETE CASCADE,
  activo_id INTEGER NOT NULL REFERENCES activos(id), precio_dia REAL NOT NULL,
  PRIMARY KEY (renta_id, activo_id)
);
CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY, renta_id INTEGER NOT NULL REFERENCES rentas(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL, monto REAL NOT NULL, tipo TEXT NOT NULL DEFAULT 'pago', nota TEXT
);
CREATE INDEX IF NOT EXISTS idx_ra_activo ON renta_activos(activo_id);
CREATE INDEX IF NOT EXISTS idx_pagos_renta ON pagos(renta_id);
CREATE TABLE IF NOT EXISTS cotizaciones (
  id INTEGER PRIMARY KEY, folio TEXT UNIQUE, fecha TEXT NOT NULL,
  cliente_id INTEGER REFERENCES clientes(id), nombre TEXT NOT NULL, telefono TEXT, direccion TEXT,
  dias INTEGER NOT NULL, fecha_traslado TEXT, fecha_recoleccion TEXT,
  subtotal REAL NOT NULL DEFAULT 0, logistico REAL NOT NULL DEFAULT 0, iva_pct REAL NOT NULL DEFAULT 16,
  estatus TEXT NOT NULL DEFAULT 'Pendiente', notas TEXT,
  renta_id INTEGER REFERENCES rentas(id), creada TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS importaciones (nombre TEXT PRIMARY KEY, fecha TEXT NOT NULL);
-- Equipo realmente entregado en cada renta (por tipo). Es lo que mide la utilización y el inventario en renta;
-- las piezas de renta_activos solo sirven para el precio.
CREATE TABLE IF NOT EXISTS renta_equipo (
  renta_id INTEGER NOT NULL REFERENCES rentas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (renta_id, tipo)
);
CREATE TABLE IF NOT EXISTS cotizacion_items (
  cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, cantidad INTEGER NOT NULL, precio_dia REAL NOT NULL,
  PRIMARY KEY (cotizacion_id, tipo)
);
`);
// Migración: las rentas pueden llevar IVA (viene de la cotización).
// Migración: vigencia de cotizaciones pendientes (pasan solas a "No contratada" a los N días).
const colsCot = db.prepare('PRAGMA table_info(cotizaciones)').all().map(c => c.name);
if (!colsCot.includes('pendiente_desde')) {
  db.exec('ALTER TABLE cotizaciones ADD COLUMN pendiente_desde TEXT');
  db.exec('UPDATE cotizaciones SET pendiente_desde = fecha WHERE pendiente_desde IS NULL');
}
if (!colsCot.includes('cerrada_auto')) db.exec('ALTER TABLE cotizaciones ADD COLUMN cerrada_auto TEXT');
if (!db.prepare('PRAGMA table_info(rentas)').all().some(c => c.name === 'iva_pct')) {
  db.exec('ALTER TABLE rentas ADD COLUMN iva_pct REAL NOT NULL DEFAULT 0');
}
// Migración: forma de pago por pago (efectivo / transferencia) y factura por renta.
if (!db.prepare('PRAGMA table_info(pagos)').all().some(c => c.name === 'forma')) {
  db.exec('ALTER TABLE pagos ADD COLUMN forma TEXT');
  // Los pagos importados traían la forma escrita en la nota ("Transferencia", "Efectivo", "Pagado en efectivo").
  db.exec("UPDATE pagos SET forma = 'transferencia' WHERE lower(COALESCE(nota, '')) LIKE '%transfer%'");
  db.exec("UPDATE pagos SET forma = 'efectivo' WHERE forma IS NULL AND lower(COALESCE(nota, '')) LIKE '%efectivo%'");
}
const colsRentas = db.prepare('PRAGMA table_info(rentas)').all().map(c => c.name);
if (!colsRentas.includes('facturada')) db.exec('ALTER TABLE rentas ADD COLUMN facturada INTEGER NOT NULL DEFAULT 0');
if (!colsRentas.includes('factura_folio')) db.exec('ALTER TABLE rentas ADD COLUMN factura_folio TEXT');
const FORMAS_PAGO = { efectivo: 'Efectivo', transferencia: 'Transferencia' };

const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
// Transacción reentrante: la primera abre BEGIN; las anidadas usan SAVEPOINT.
let txProfundidad = 0;
function tx(fn) {
  const sp = `sp${txProfundidad}`;
  db.exec(txProfundidad === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
  txProfundidad++;
  try {
    const r = fn();
    txProfundidad--;
    db.exec(txProfundidad === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    txProfundidad--;
    db.exec(txProfundidad === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

// Carga inicial del inventario (exportado una sola vez desde el Excel).
if (get('SELECT COUNT(*) c FROM activos').c === 0) {
  const seed = path.join(DATA_DIR, 'inventario-inicial.json');
  if (fs.existsSync(seed)) {
    const rows = JSON.parse(fs.readFileSync(seed, 'utf8'));
    tx(() => rows.forEach(a => run(
      'INSERT OR IGNORE INTO activos (codigo,tipo,categoria,valor,renta_dia,estado,condicion,ubicacion,notas) VALUES (?,?,?,?,?,?,?,?,?)',
      a.codigo, a.tipo, /^andamio/i.test(a.tipo) ? 'andamio' : 'accesorio', a.valor || 0, a.renta_dia || 0,
      a.estado || 'Disponible', a.condicion || null, a.ubicacion || null, a.notas || null)));
    console.log(`Inventario inicial importado: ${rows.length} activos.`);
  }
}

// Carga inicial de cotizaciones históricas (exportadas una sola vez desde el Excel).
if (get('SELECT COUNT(*) c FROM cotizaciones').c === 0) {
  const seed = path.join(DATA_DIR, 'cotizaciones-iniciales.json');
  if (fs.existsSync(seed)) {
    const rows = JSON.parse(fs.readFileSync(seed, 'utf8'));
    tx(() => rows.forEach(q => {
      const id = Number(run(`INSERT OR IGNORE INTO cotizaciones (folio, fecha, nombre, direccion, dias, fecha_traslado, fecha_recoleccion,
        subtotal, logistico, iva_pct, estatus, notas, creada, pendiente_desde) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      q.folio, q.fecha, q.nombre, q.direccion || null, q.dias || 1, q.fecha_traslado || null, q.fecha_recoleccion || null,
      q.subtotal || 0, q.logistico || 0, q.iva_pct ?? 16, q.estatus || 'Pendiente', q.notas || null, new Date().toISOString(), q.fecha).lastInsertRowid);
      if (id && q.tipo && q.cantidad) {
        run('INSERT OR IGNORE INTO cotizacion_items (cotizacion_id, tipo, cantidad, precio_dia) VALUES (?,?,?,?)', id, q.tipo, q.cantidad, q.precio_dia || 0);
      }
    }));
    console.log(`Cotizaciones históricas importadas: ${rows.length}.`);
  }
}

// ---------- Fechas ----------
const fmt = d => d.toLocaleDateString('en-CA');
const hoy = () => fmt(new Date());
const parse = s => new Date(`${s}T00:00:00`);
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 86400000); // a - b
const esFecha = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parse(s));

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = msg => new HttpError(400, msg);

// ---------- Disponibilidad ----------
function ocupados(tipo, inicio, dias, excluirRenta = 0) {
  const fin = addDays(inicio, dias);
  const t = hoy();
  const set = new Set();
  const rows = all(`SELECT ra.activo_id, r.fecha_inicio, r.dias, r.estado
    FROM renta_activos ra JOIN rentas r ON r.id = ra.renta_id JOIN activos a ON a.id = ra.activo_id
    WHERE r.estado IN ('apartada','activa') AND a.tipo = ? AND r.id != ?`, tipo, excluirRenta);
  for (const r of rows) {
    let finR = addDays(r.fecha_inicio, r.dias);
    if (r.estado === 'activa' && finR <= t) finR = addDays(t, 1); // vencida: sigue en obra
    if (r.fecha_inicio < fin && finR > inicio) set.add(r.activo_id);
  }
  return set;
}
function libres(tipo, inicio, dias, excluirRenta = 0) {
  const busy = ocupados(tipo, inicio, dias, excluirRenta);
  return all("SELECT * FROM activos WHERE tipo = ? AND estado = 'Disponible' ORDER BY codigo", tipo)
    .filter(a => !busy.has(a.id));
}
// La disponibilidad y lo "en renta" salen del EQUIPO ENTREGADO de cada renta (renta_equipo), por cantidad de cada tipo.
const operativosTipo = tipo => get("SELECT COUNT(*) n FROM activos WHERE tipo = ? AND estado = 'Disponible'", tipo).n;
function usoMaximo(tipo, inicio, dias, excluirRenta = 0) { // máximo de piezas del tipo en uso en un mismo día del periodo
  const fin = addDays(inicio, dias), t = hoy();
  const rows = all(`SELECT e.cantidad, r.fecha_inicio, r.dias, r.estado FROM renta_equipo e JOIN rentas r ON r.id = e.renta_id
    WHERE e.tipo = ? AND r.estado IN ('apartada','activa') AND r.id != ?`, tipo, excluirRenta);
  const periodos = rows.map(r => {
    let finR = addDays(r.fecha_inicio, r.dias);
    if (r.estado === 'activa' && finR <= t) finR = addDays(t, 1); // vencida: sigue en obra
    return { ini: r.fecha_inicio, fin: finR, n: r.cantidad };
  }).filter(p => p.ini < fin && p.fin > inicio);
  let max = 0;
  for (let d = inicio; d < fin; d = addDays(d, 1)) max = Math.max(max, periodos.filter(p => p.ini <= d && d < p.fin).reduce((s, p) => s + p.n, 0));
  return max;
}
const disponiblesTipo = (tipo, inicio, dias, excluirRenta = 0) => Math.max(0, operativosTipo(tipo) - usoMaximo(tipo, inicio, dias, excluirRenta));
function tiposResumen(inicio = hoy(), dias = 1) {
  const tipos = all(`SELECT tipo, categoria, COUNT(*) total,
      SUM(estado = 'Disponible') operativos, SUM(estado = 'Mantenimiento') mantenimiento, SUM(estado = 'Baja') baja,
      MIN(renta_dia) renta_dia FROM activos GROUP BY tipo, categoria ORDER BY categoria, tipo`);
  const enRenta = new Map(all(`SELECT e.tipo, SUM(e.cantidad) n FROM renta_equipo e JOIN rentas r ON r.id = e.renta_id
      WHERE r.estado = 'activa' GROUP BY e.tipo`).map(x => [x.tipo, x.n]));
  return tipos.map(t => ({
    ...t, rentados: enRenta.get(t.tipo) || 0,
    disponibles: disponiblesTipo(t.tipo, inicio, dias),
    foto: fotoDe(t.tipo),
  }));
}
function fotoDe(tipo) {
  const t = tipo.toLowerCase();
  // Fotos propias del sistema (gestion/public/fotos): las plataformas de cada andamio no son la charola.
  const plataforma = !t.includes('plataforma') ? null : t.includes('plegable') ? 'plataforma-plegable.jpg'
    : t.includes('estandar') || t.includes('estándar') ? 'plataforma-estandar.jpg' : null;
  if (plataforma && fs.existsSync(path.join(PUBLIC_DIR, 'fotos', plataforma))) return `/fotos/${plataforma}`;
  const f = t.includes('andamio plegable') ? 'plegable.jpg'
    : t.includes('andamio estandar') || t.includes('andamio estándar') ? 'estandar.jpg'
    : t.includes('llanta') ? 'llantas.jpg'
    : t.includes('nivelador') ? 'niveladores.jpg'
    : t.includes('escalera') && t.includes('plegable') ? 'escalera.jpg'
    : t.includes('escalera') ? 'escalera-tradicional.jpg'
    : t.includes('repisa') || t.includes('charola') || t.includes('plataforma') ? 'charola.jpg' : null;
  return f && fs.existsSync(path.join(FOTOS_DIR, f)) ? `/img/${f}` : null;
}

// ---------- Rentas ----------
function rentaCompleta(r) {
  const piezas = all(`SELECT a.id, a.codigo, a.tipo, a.categoria, ra.precio_dia FROM renta_activos ra
    JOIN activos a ON a.id = ra.activo_id WHERE ra.renta_id = ? ORDER BY a.tipo, a.codigo`, r.id);
  const grupos = new Map();
  for (const p of piezas) {
    const g = grupos.get(p.tipo) || { tipo: p.tipo, categoria: p.categoria, cantidad: 0, precio_dia: p.precio_dia, codigos: [] };
    g.cantidad++; g.codigos.push(p.codigo); grupos.set(p.tipo, g);
  }
  const pagos = all('SELECT * FROM pagos WHERE renta_id = ? ORDER BY fecha, id', r.id);
  const subtotal = piezas.reduce((s, p) => s + p.precio_dia, 0) * r.dias;
  const iva = Math.round((subtotal + r.extra) * (r.iva_pct || 0)) / 100;
  const total = subtotal + r.extra + iva;
  const pagado = pagos.reduce((s, p) => s + p.monto, 0);
  const fin = addDays(r.fecha_inicio, r.dias);
  const t = hoy();
  let restantes = null;
  if (r.estado === 'activa') restantes = diffDays(fin, t);
  return {
    ...r, cliente_nombre: r.cliente_nombre, cliente_telefono: r.cliente_telefono,
    fecha_fin: fin, restantes, vencida: r.estado === 'activa' && fin < t,
    grupos: [...grupos.values()], pagos, subtotal, iva, total, pagado, saldo: Math.round((total - pagado) * 100) / 100,
    equipo: all('SELECT tipo, cantidad FROM renta_equipo WHERE renta_id = ? ORDER BY tipo', r.id),
  };
}
const SELECT_RENTA = `SELECT r.*, c.nombre cliente_nombre, c.telefono cliente_telefono
  FROM rentas r JOIN clientes c ON c.id = r.cliente_id`;
const rentaPorId = id => {
  const r = get(`${SELECT_RENTA} WHERE r.id = ?`, id);
  if (!r) throw new HttpError(404, 'Renta no encontrada');
  return rentaCompleta(r);
};
const todasRentas = () => all(`${SELECT_RENTA} ORDER BY r.fecha_inicio DESC, r.id DESC`).map(rentaCompleta);

function crearRenta(b) {
  const dias = Number(b.dias);
  if (!esFecha(b.fecha_inicio)) throw bad('Fecha de inicio inválida');
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw bad('Días de renta inválidos');
  const estado = b.estado === 'activa' ? 'activa' : 'apartada';
  const lineas = (Array.isArray(b.items) ? b.items : []).filter(i => Number(i.cantidad) > 0);
  if (!lineas.length) throw bad('Agrega al menos una pieza');
  const extra = Number(b.extra) || 0;
  return tx(() => {
    let clienteId = Number(b.cliente_id);
    if (!clienteId) {
      const nombre = String(b.cliente?.nombre || '').trim();
      if (!nombre) throw bad('Falta el cliente');
      clienteId = Number(run('INSERT INTO clientes (nombre, telefono, direccion) VALUES (?,?,?)',
        nombre, String(b.cliente?.telefono || '').trim() || null, b.direccion || null).lastInsertRowid);
    } else if (!get('SELECT id FROM clientes WHERE id = ?', clienteId)) throw bad('Cliente no encontrado');

    const tiposInfo = lineas.map(l => {
      const cant = Number(l.cantidad);
      if (!Number.isInteger(cant)) throw bad('Cantidad inválida');
      const tipo = String(l.tipo);
      const hay = disponiblesTipo(tipo, b.fecha_inicio, dias);
      if (hay < cant) throw bad(`Solo hay ${hay} de "${tipo}" disponibles del ${b.fecha_inicio} al ${addDays(b.fecha_inicio, dias)}`);
      // Las piezas (códigos) solo se asignan como referencia y para el precio: primero las libres en esas fechas.
      const libresIds = libres(tipo, b.fecha_inicio, dias);
      const todas = all("SELECT * FROM activos WHERE tipo = ? AND estado = 'Disponible' ORDER BY codigo", tipo);
      const piezas = [...libresIds, ...todas.filter(a => !libresIds.some(x => x.id === a.id))].slice(0, cant);
      return { l, cant, piezas };
    });
    const totalAndamios = tiposInfo.filter(t => t.piezas[0].categoria === 'andamio').reduce((s, t) => s + t.cant, 0);
    const ivaPct = Number(b.iva_pct) > 0 ? Number(b.iva_pct) : 0;
    const rid = Number(run(`INSERT INTO rentas (cliente_id, fecha_inicio, dias, direccion, estado, extra, extra_concepto, notas, iva_pct, creada)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, clienteId, b.fecha_inicio, dias, b.direccion || null, estado, extra,
      b.extra_concepto || null, b.notas || null, ivaPct, new Date().toISOString()).lastInsertRowid);
    run('UPDATE rentas SET folio = ? WHERE id = ?', `R-${String(rid).padStart(4, '0')}`, rid);
    for (const { l, piezas } of tiposInfo) {
      const esAndamio = piezas[0].categoria === 'andamio';
      const manual = l.precio_dia !== undefined && l.precio_dia !== null && l.precio_dia !== '' ? Number(l.precio_dia) : null;
      if (manual !== null && !(manual >= 0)) throw bad('Precio inválido');
      for (const p of piezas) {
        const precio = manual !== null ? manual : esAndamio ? AR.precioAndamioPorDia(dias, totalAndamios) : p.renta_dia;
        run('INSERT INTO renta_activos (renta_id, activo_id, precio_dia) VALUES (?,?,?)', rid, p.id, precio);
      }
      // El equipo entregado arranca igual a lo cotizado; se ajusta después en la ficha de la renta.
      run(`INSERT INTO renta_equipo (renta_id, tipo, cantidad) VALUES (?,?,?)
        ON CONFLICT (renta_id, tipo) DO UPDATE SET cantidad = cantidad + excluded.cantidad`, rid, piezas[0].tipo, piezas.length);
    }
    return rid;
  });
}

// ---------- Cotizaciones ----------
const ESTATUS_COT = ['Pendiente', 'Contratada', 'No contratada'];
// Una cotización Pendiente pasa sola a "No contratada" cuando se cumplen N días naturales
// desde que quedó pendiente (su fecha, o el día en que se reabrió). Configurable en config.json.
const DIAS_VIGENCIA_COT = Number(config.diasVigenciaCotizacion) > 0 ? Number(config.diasVigenciaCotizacion) : 15;
function expirarCotizaciones() {
  const t = hoy();
  const r = run("UPDATE cotizaciones SET estatus = 'No contratada', cerrada_auto = ? WHERE estatus = 'Pendiente' AND renta_id IS NULL AND pendiente_desde <= ?",
    t, addDays(t, -DIAS_VIGENCIA_COT));
  if (r.changes) console.log(`${r.changes} cotización(es) pasaron a "No contratada" por cumplir ${DIAS_VIGENCIA_COT} días.`);
  return r.changes;
}
function cotizacionCompleta(c) {
  const items = all('SELECT tipo, cantidad, precio_dia FROM cotizacion_items WHERE cotizacion_id = ? ORDER BY tipo', c.id);
  const iva = Math.round((c.subtotal + c.logistico) * c.iva_pct) / 100;
  const vence = c.estatus === 'Pendiente' ? addDays(c.pendiente_desde || c.fecha, DIAS_VIGENCIA_COT) : null;
  return { ...c, items, iva, total: c.subtotal + c.logistico + iva, vence, restantes: vence ? diffDays(vence, hoy()) : null, dias_vigencia: DIAS_VIGENCIA_COT };
}
function cotizacionPorId(id) {
  expirarCotizaciones();
  const c = get('SELECT * FROM cotizaciones WHERE id = ?', id);
  if (!c) throw new HttpError(404, 'Cotización no encontrada');
  return cotizacionCompleta(c);
}
const todasCotizaciones = () => { expirarCotizaciones(); return all('SELECT * FROM cotizaciones ORDER BY fecha DESC, id DESC').map(cotizacionCompleta); };
const siguienteFolio = () => `COT${String(get('SELECT COALESCE(MAX(CAST(SUBSTR(folio, 4) AS INTEGER)), 0) n FROM cotizaciones').n + 1).padStart(3, '0')}`;

// Valida los datos de una cotización (nueva o editada) y calcula precios y subtotal.
function prepararCotizacion(b) {
  const dias = Number(b.dias);
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw bad('Días de renta inválidos');
  const nombre = String(b.nombre || '').trim();
  if (!nombre) throw bad('Falta el nombre del cliente');
  const fecha = esFecha(b.fecha) ? b.fecha : hoy();
  for (const f of ['fecha_traslado', 'fecha_recoleccion']) if (b[f] && !esFecha(b[f])) throw bad('Fecha inválida');
  const logistico = Number(b.logistico) || 0;
  if (logistico < 0) throw bad('La logística no puede ser negativa');
  const ivaPct = b.iva_pct !== undefined && b.iva_pct !== null && b.iva_pct !== '' && Number.isFinite(Number(b.iva_pct)) ? Number(b.iva_pct) : 16;
  const porTipo = new Map();
  for (const i of Array.isArray(b.items) ? b.items : []) {
    const cant = Number(i.cantidad);
    if (!(cant > 0)) continue;
    if (!Number.isInteger(cant)) throw bad('Cantidad inválida');
    const prev = porTipo.get(String(i.tipo));
    porTipo.set(String(i.tipo), { ...i, cantidad: (prev?.cantidad || 0) + cant });
  }
  if (!porTipo.size) throw bad('Agrega al menos una pieza');
  const lineas = [...porTipo.entries()].map(([tipo, l]) => {
    const info = get('SELECT categoria, MIN(renta_dia) renta_dia FROM activos WHERE tipo = ?', tipo);
    if (!info?.categoria) throw bad(`Tipo de pieza desconocido: ${tipo}`);
    return { tipo, cantidad: l.cantidad, categoria: info.categoria, renta_dia: info.renta_dia, manual: l.precio_dia };
  });
  const nAndamios = lineas.filter(l => l.categoria === 'andamio').reduce((s, l) => s + l.cantidad, 0);
  let subtotal = 0;
  for (const l of lineas) {
    const manual = l.manual !== undefined && l.manual !== null && l.manual !== '' ? Number(l.manual) : null;
    if (manual !== null && !(manual >= 0)) throw bad('Precio inválido');
    l.precio = manual !== null ? manual : l.categoria === 'andamio' ? AR.precioAndamioPorDia(dias, nAndamios) : l.renta_dia;
    subtotal += l.cantidad * l.precio * dias;
  }
  const clienteId = Number(b.cliente_id) || null;
  if (clienteId && !get('SELECT id FROM clientes WHERE id = ?', clienteId)) throw bad('Cliente no encontrado');
  return { dias, nombre, fecha, logistico, ivaPct, lineas, subtotal, clienteId,
    telefono: String(b.telefono || '').trim() || null, direccion: b.direccion || null,
    traslado: b.fecha_traslado || null, recoleccion: b.fecha_recoleccion || null, notas: b.notas || null };
}

function crearCotizacion(b) {
  const d = prepararCotizacion(b);
  return tx(() => {
    const id = Number(run(`INSERT INTO cotizaciones (folio, fecha, cliente_id, nombre, telefono, direccion, dias, fecha_traslado, fecha_recoleccion,
      subtotal, logistico, iva_pct, estatus, notas, creada, pendiente_desde) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    siguienteFolio(), d.fecha, d.clienteId, d.nombre, d.telefono, d.direccion, d.dias, d.traslado, d.recoleccion, d.subtotal, d.logistico, d.ivaPct,
    'Pendiente', d.notas, new Date().toISOString(), d.fecha).lastInsertRowid); // toda cotización nueva nace Pendiente
    for (const l of d.lineas) run('INSERT INTO cotizacion_items (cotizacion_id, tipo, cantidad, precio_dia) VALUES (?,?,?,?)', id, l.tipo, l.cantidad, l.precio);
    return id;
  });
}

// Edición completa de una cotización. Conserva folio, estatus y vigencia.
// Si ya se convirtió en renta, lo que cambie aquí (días, precios, logística, IVA) se aplica también a la renta, para que
// lo cotizado y lo cobrado cuadren; las piezas no se pueden cambiar porque ya están asignadas a la renta.
function actualizarCotizacion(id, b) {
  const c = get('SELECT * FROM cotizaciones WHERE id = ?', id);
  if (!c) throw new HttpError(404, 'Cotización no encontrada');
  const d = prepararCotizacion(b);
  if (c.renta_id) {
    const antes = new Map(all('SELECT tipo, cantidad FROM cotizacion_items WHERE cotizacion_id = ?', id).map(i => [i.tipo, i.cantidad]));
    const igual = antes.size === d.lineas.length && d.lineas.every(l => antes.get(l.tipo) === l.cantidad);
    if (!igual) throw bad('Esta cotización ya es una renta: aquí puedes cambiar días, precios, logística e IVA, pero no las piezas (ajústalas en "Equipo entregado" de la renta)');
  }
  // Una renta apartada (aún no entregada) sigue la fecha de traslado de su cotización: si la mueves, la renta se mueve con ella,
  // y se revisa que el equipo esté disponible en las nuevas fechas. Una renta ya entregada conserva su fecha de inicio.
  let nuevoInicio = null;
  if (c.renta_id) {
    const ren = get('SELECT estado, fecha_inicio, dias FROM rentas WHERE id = ?', c.renta_id);
    if (ren.estado === 'apartada') {
      const inicio = d.traslado && d.traslado !== ren.fecha_inicio ? d.traslado : ren.fecha_inicio;
      if (inicio !== ren.fecha_inicio || d.dias !== ren.dias) {
        for (const e of all('SELECT tipo, cantidad FROM renta_equipo WHERE renta_id = ?', c.renta_id)) {
          if (disponiblesTipo(e.tipo, inicio, d.dias, c.renta_id) < e.cantidad) {
            throw bad(`No hay ${e.cantidad} de "${e.tipo}" disponibles del ${inicio} al ${addDays(inicio, d.dias)}`);
          }
        }
      }
      if (inicio !== ren.fecha_inicio) nuevoInicio = inicio;
    }
  }
  tx(() => {
    run(`UPDATE cotizaciones SET fecha = ?, cliente_id = ?, nombre = ?, telefono = ?, direccion = ?, dias = ?, fecha_traslado = ?, fecha_recoleccion = ?,
      subtotal = ?, logistico = ?, iva_pct = ?, notas = ? WHERE id = ?`,
    d.fecha, d.clienteId, d.nombre, d.telefono, d.direccion, d.dias, d.traslado, d.recoleccion, d.subtotal, d.logistico, d.ivaPct, d.notas, id);
    run('DELETE FROM cotizacion_items WHERE cotizacion_id = ?', id);
    for (const l of d.lineas) run('INSERT INTO cotizacion_items (cotizacion_id, tipo, cantidad, precio_dia) VALUES (?,?,?,?)', id, l.tipo, l.cantidad, l.precio);
    if (c.renta_id) {
      const r = get('SELECT extra_concepto FROM rentas WHERE id = ?', c.renta_id);
      run('UPDATE rentas SET dias = ?, iva_pct = ?, extra = ?, extra_concepto = ?, direccion = COALESCE(?, direccion), fecha_inicio = COALESCE(?, fecha_inicio) WHERE id = ?',
        d.dias, d.ivaPct > 0 ? d.ivaPct : 0, d.logistico,
        d.logistico > 0 ? (r?.extra_concepto || `Traslado, montaje, desmontaje y recolección (${c.folio})`) : null, d.direccion, nuevoInicio, c.renta_id);
      for (const l of d.lineas) {
        run('UPDATE renta_activos SET precio_dia = ? WHERE renta_id = ? AND activo_id IN (SELECT id FROM activos WHERE tipo = ?)', l.precio, c.renta_id, l.tipo);
      }
    }
  });
}

// ---------- Reportes ----------
function reportes(desde, hasta) {
  const rentas = todasRentas().filter(r => r.estado !== 'cancelada' && r.fecha_inicio >= desde && r.fecha_inicio <= hasta);
  const cobrado = get('SELECT COALESCE(SUM(monto),0) s FROM pagos p JOIN rentas r ON r.id = p.renta_id WHERE r.estado != ? AND p.fecha BETWEEN ? AND ?',
    'cancelada', desde, hasta).s;
  const masRentado = all(`SELECT a.tipo, a.categoria, COUNT(*) piezas, SUM(r.dias) pz_dia, SUM(ra.precio_dia * r.dias) ingreso
    FROM renta_activos ra JOIN rentas r ON r.id = ra.renta_id JOIN activos a ON a.id = ra.activo_id
    WHERE r.estado != 'cancelada' AND r.fecha_inicio BETWEEN ? AND ? GROUP BY a.tipo, a.categoria ORDER BY pz_dia DESC`, desde, hasta);
  const clientes = new Map();
  for (const r of rentas) {
    const c = clientes.get(r.cliente_id) || { nombre: r.cliente_nombre, rentas: 0, total: 0, pagado: 0 };
    c.rentas++; c.total += r.total; c.pagado += r.pagado; clientes.set(r.cliente_id, c);
  }
  const facturado = rentas.reduce((s, r) => s + r.total, 0);
  // Lo cobrado en el periodo por forma de pago (lo que no tiene forma capturada queda en "sin")
  const porForma = { efectivo: 0, transferencia: 0, sin: 0 };
  for (const x of all(`SELECT COALESCE(p.forma, 'sin') forma, SUM(p.monto) monto FROM pagos p JOIN rentas r ON r.id = p.renta_id
    WHERE r.estado != 'cancelada' AND p.fecha BETWEEN ? AND ? GROUP BY 1`, desde, hasta)) porForma[x.forma] = x.monto;
  const conFactura = rentas.filter(r => r.facturada);
  const pagadas = rentas.filter(r => r.saldo <= 0.5), conSaldo = rentas.filter(r => r.saldo > 0.5);
  const orden = [...rentas].sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio) || a.id - b.id);
  return {
    desde, hasta, rentas: rentas.length,
    facturado, cobrado,
    iva: rentas.reduce((s, r) => s + r.iva, 0), sinIva: rentas.reduce((s, r) => s + r.subtotal + r.extra, 0),
    porCobrar: rentas.reduce((s, r) => s + Math.max(r.saldo, 0), 0),
    ticket: rentas.length ? facturado / rentas.length : 0,
    diasRentados: rentas.reduce((s, r) => s + r.dias, 0),
    primera: orden[0]?.fecha_inicio || null, ultima: orden.at(-1)?.fecha_inicio || null,
    estadoPago: { pagadas: { n: pagadas.length, importe: pagadas.reduce((s, r) => s + r.total, 0) },
      pendientes: { n: conSaldo.length, importe: conSaldo.reduce((s, r) => s + r.saldo, 0) } },
    porForma,
    facturas: { n: conFactura.length, importe: conFactura.reduce((s, r) => s + r.total, 0), sinFactura: rentas.length - conFactura.length },
    conIva: rentas.filter(r => r.iva_pct > 0).length, sinIvaN: rentas.filter(r => !(r.iva_pct > 0)).length,
    detalle: orden.map(r => ({
      id: r.id, folio: r.folio, cliente: r.cliente_nombre, telefono: r.cliente_telefono, estado: r.estado,
      fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin, dias: r.dias,
      piezas: r.grupos.map(g => `${g.cantidad} ${g.tipo}`).join(' · '),
      cobrado: r.subtotal + r.extra, iva: r.iva, total: r.total, pagado: r.pagado, saldo: r.saldo,
      forma_pago: [...new Set(r.pagos.map(p => FORMAS_PAGO[p.forma] || p.nota).filter(Boolean))].join(', '),
      facturada: !!r.facturada, factura_folio: r.factura_folio, con_iva: r.iva_pct > 0,
    })),
    masRentado, mejoresClientes: [...clientes.values()].sort((a, b) => b.total - a.total).slice(0, 10),
  };
}

// ---------- Importación única de ventas históricas (desde el Excel) ----------
// Cada venta del "Reporte de Ventas" se vuelve una renta con su IVA y sus pagos, y se vincula a su cotización.
const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(p => p.length > 2);
const nombresParecidos = (a, b) => { const x = sinAcentos(a), y = sinAcentos(b); return x.some(p => y.some(q => p === q || p.startsWith(q) || q.startsWith(p))); };
function importarVentas(ventas) {
  const t = hoy();
  const orden = [...ventas].sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
  return tx(() => {
    for (const v of orden) {
      const rid = crearRenta({
        cliente_id: get('SELECT id FROM clientes WHERE lower(nombre) = lower(?)', v.cliente)?.id || null,
        cliente: { nombre: v.cliente, telefono: v.telefono },
        fecha_inicio: v.fecha_inicio, dias: v.dias, estado: 'apartada',
        items: [{ tipo: v.tipo, cantidad: v.cantidad, precio_dia: v.cobrado / (v.cantidad * v.dias) }], // el "cobrado" ya incluye accesorios/traslado
        iva_pct: v.iva > 0 ? 16 : 0,
        notas: `${v.folio_cotizacion ? `Cotización ${v.folio_cotizacion} · ` : ''}Importada del Excel (reporte de ventas)`,
      });
      const fin = addDays(v.fecha_inicio, v.dias);
      if (fin <= t) run("UPDATE rentas SET estado = 'devuelta', fecha_devolucion = ? WHERE id = ?", fin, rid);
      else run("UPDATE rentas SET estado = 'activa' WHERE id = ?", rid);
      const total = rentaPorId(rid).total, p = v.pago || { modo: 'ninguno' };
      const pagos = p.modo === 'completo' ? [total] : p.modo === 'faltan' ? [Math.round((total - p.valor) * 100) / 100] : p.modo === 'montos' ? p.valor : [];
      for (const monto of pagos) {
        const forma = /transfer/i.test(p.nota || '') ? 'transferencia' : /efectivo/i.test(p.nota || '') ? 'efectivo' : null;
        if (monto > 0) run('INSERT INTO pagos (renta_id, fecha, monto, tipo, nota, forma) VALUES (?,?,?,?,?,?)', rid, v.fecha_inicio, monto, 'pago', p.nota || null, forma);
      }
      // Solo se liga si el cliente coincide: en el Excel algunos números de cotización de la hoja de ventas están recorridos.
      const cot = v.folio_cotizacion && get('SELECT id, nombre FROM cotizaciones WHERE folio = ? AND renta_id IS NULL', v.folio_cotizacion);
      if (cot && nombresParecidos(cot.nombre, v.cliente)) {
        run("UPDATE cotizaciones SET estatus = 'Contratada', renta_id = ?, cliente_id = ?, cerrada_auto = NULL WHERE id = ?",
          rid, get('SELECT cliente_id FROM rentas WHERE id = ?', rid).cliente_id, cot.id);
      }
    }
    return orden.length;
  });
}
function importarVentasIniciales() {
  if (get("SELECT 1 x FROM importaciones WHERE nombre = 'ventas'")) return;
  const archivo = path.join(DATA_DIR, 'ventas-iniciales.json');
  if (!fs.existsSync(archivo)) return;
  if (get('SELECT COUNT(*) c FROM rentas').c > 0) { console.log('Ventas iniciales NO importadas: ya hay rentas capturadas en el sistema.'); return; }
  try {
    const n = tx(() => {
      const total = importarVentas(JSON.parse(fs.readFileSync(archivo, 'utf8')));
      run("INSERT INTO importaciones (nombre, fecha) VALUES ('ventas', ?)", hoy());
      return total;
    });
    console.log(`Ventas históricas importadas: ${n} rentas.`);
  } catch (e) { console.error('No se pudieron importar las ventas (no se guardó nada):', e.message); }
}

function resumen() {
  expirarCotizaciones();
  const rentas = todasRentas().filter(r => r.estado !== 'cancelada');
  const activas = rentas.filter(r => r.estado === 'activa');
  const mes = hoy().slice(0, 7);
  return {
    hoy: hoy(),
    activas: activas.length,
    vencidas: activas.filter(r => r.vencida).length,
    apartadas: rentas.filter(r => r.estado === 'apartada').length,
    cotizacionesPendientes: get("SELECT COUNT(*) c FROM cotizaciones WHERE estatus = 'Pendiente'").c,
    ventasTotal: rentas.reduce((s, r) => s + r.total, 0),
    ventasMes: rentas.filter(r => r.fecha_inicio.slice(0, 7) === mes).reduce((s, r) => s + r.total, 0),
    porCobrar: rentas.reduce((s, r) => s + Math.max(r.saldo, 0), 0),
    cobradoMes: get("SELECT COALESCE(SUM(p.monto),0) s FROM pagos p JOIN rentas r ON r.id = p.renta_id WHERE r.estado != 'cancelada' AND substr(p.fecha,1,7) = ?", mes).s,
    porRegresar: activas.sort((a, b) => a.fecha_fin.localeCompare(b.fecha_fin)).slice(0, 12),
    proximas: rentas.filter(r => r.estado === 'apartada').sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio)).slice(0, 8),
    conSaldo: rentas.filter(r => r.saldo > 0 && r.estado !== 'apartada').sort((a, b) => b.saldo - a.saldo).slice(0, 8),
    tipos: tiposResumen(),
  };
}

// ---------- Autenticación ----------
const firma = exp => crypto.createHmac('sha256', config.secret).update(String(exp)).digest('hex');
const nuevaSesion = () => { const exp = Date.now() + 30 * 86400000; return `${exp}.${firma(exp)}`; };
function sesionValida(req) {
  const m = /(?:^|;\s*)ar_sid=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const esperado = firma(exp);
  return sig.length === esperado.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado));
}
const intentos = new Map(); // ip -> {n, hasta}
function pinCorrecto(ip, pin) {
  const reg = intentos.get(ip) || { n: 0, hasta: 0 };
  if (reg.n >= 5 && Date.now() < reg.hasta) throw new HttpError(429, 'Demasiados intentos. Espera un minuto.');
  const a = Buffer.from(String(pin || '')), b = Buffer.from(config.pin);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (ok) intentos.delete(ip); else intentos.set(ip, { n: reg.n + 1, hasta: Date.now() + 60000 });
  return ok;
}

// ---------- Rutas API ----------
const ESTADOS_ACTIVO = ['Disponible', 'Mantenimiento', 'Baja'];
const routes = [];
const route = (method, re, fn, publica = false) => routes.push({ method, re, fn, publica });

route('POST', /^\/api\/login$/, (ctx) => {
  if (!pinCorrecto(ctx.ip, ctx.body.pin)) throw new HttpError(401, 'PIN incorrecto');
  ctx.setCookie = `ar_sid=${nuevaSesion()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}`;
  return { ok: true };
}, true);
route('POST', /^\/api\/logout$/, (ctx) => { ctx.setCookie = 'ar_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'; return { ok: true }; }, true);
route('GET', /^\/api\/me$/, (ctx) => ({ ok: sesionValida(ctx.req) }), true);

route('GET', /^\/api\/resumen$/, () => resumen());
route('GET', /^\/api\/tipos$/, (ctx) => {
  const inicio = esFecha(ctx.query.get('inicio')) ? ctx.query.get('inicio') : hoy();
  const dias = Math.max(1, Number(ctx.query.get('dias')) || 1);
  return tiposResumen(inicio, dias);
});
route('GET', /^\/api\/activos$/, (ctx) => {
  const tipo = ctx.query.get('tipo');
  const rows = tipo ? all('SELECT * FROM activos WHERE tipo = ? ORDER BY codigo', tipo) : all('SELECT * FROM activos ORDER BY tipo, codigo');
  return rows.map(a => ({ ...a, en_renta: null })); // lo "en renta" se mide por cantidad (equipo entregado), no por pieza
});
// Rentas activas que tienen en campo piezas de un tipo (según el equipo entregado).
route('GET', /^\/api\/equipo-en-campo$/, (ctx) => {
  const t = hoy();
  return all(`SELECT r.folio, c.nombre cliente, e.cantidad, r.fecha_inicio, r.dias FROM renta_equipo e
    JOIN rentas r ON r.id = e.renta_id JOIN clientes c ON c.id = r.cliente_id
    WHERE e.tipo = ? AND r.estado = 'activa' ORDER BY r.fecha_inicio`, String(ctx.query.get('tipo') || ''))
    .map(x => ({ ...x, fecha_fin: addDays(x.fecha_inicio, x.dias), vencida: addDays(x.fecha_inicio, x.dias) < t }));
});
route('POST', /^\/api\/activos$/, (ctx) => {
  const b = ctx.body;
  const codigo = String(b.codigo || '').trim(), tipo = String(b.tipo || '').trim();
  if (!codigo || !tipo) throw bad('Código y tipo son obligatorios');
  if (get('SELECT id FROM activos WHERE codigo = ?', codigo)) throw bad('Ese código ya existe');
  const base = get('SELECT categoria, renta_dia, valor FROM activos WHERE tipo = ? LIMIT 1', tipo);
  run('INSERT INTO activos (codigo,tipo,categoria,valor,renta_dia,estado,condicion,ubicacion,notas) VALUES (?,?,?,?,?,?,?,?,?)',
    codigo, tipo, base?.categoria || (/^andamio/i.test(tipo) ? 'andamio' : 'accesorio'),
    Number(b.valor) || base?.valor || 0, Number(b.renta_dia) || base?.renta_dia || 0, 'Disponible', b.condicion || null, b.ubicacion || 'Bodega', b.notas || null);
  return { ok: true };
});
route('PATCH', /^\/api\/activos\/(\d+)$/, (ctx, id) => {
  const b = ctx.body;
  if (b.estado !== undefined && !ESTADOS_ACTIVO.includes(b.estado)) throw bad('Estado inválido');
  const a = get('SELECT * FROM activos WHERE id = ?', id);
  if (!a) throw new HttpError(404, 'Activo no encontrado');
  run('UPDATE activos SET estado = ?, condicion = ?, ubicacion = ?, notas = ?, renta_dia = ? WHERE id = ?',
    b.estado ?? a.estado, b.condicion ?? a.condicion, b.ubicacion ?? a.ubicacion, b.notas ?? a.notas,
    b.renta_dia !== undefined ? Number(b.renta_dia) || 0 : a.renta_dia, id);
  return { ok: true };
});

route('GET', /^\/api\/clientes$/, () => {
  const rentas = todasRentas().filter(r => r.estado !== 'cancelada');
  return all('SELECT * FROM clientes ORDER BY nombre COLLATE NOCASE').map(c => {
    const rs = rentas.filter(r => r.cliente_id === c.id);
    return { ...c, rentas: rs.length, total: rs.reduce((s, r) => s + r.total, 0), saldo: rs.reduce((s, r) => s + Math.max(r.saldo, 0), 0) };
  });
});
route('POST', /^\/api\/clientes$/, (ctx) => {
  const nombre = String(ctx.body.nombre || '').trim();
  if (!nombre) throw bad('El nombre es obligatorio');
  return { id: Number(run('INSERT INTO clientes (nombre, telefono, direccion, notas) VALUES (?,?,?,?)', nombre,
    String(ctx.body.telefono || '').trim() || null, ctx.body.direccion || null, ctx.body.notas || null).lastInsertRowid) };
});
route('PATCH', /^\/api\/clientes\/(\d+)$/, (ctx, id) => {
  const c = get('SELECT * FROM clientes WHERE id = ?', id);
  if (!c) throw new HttpError(404, 'Cliente no encontrado');
  const b = ctx.body, nombre = String(b.nombre ?? c.nombre).trim();
  if (!nombre) throw bad('El nombre es obligatorio');
  run('UPDATE clientes SET nombre = ?, telefono = ?, direccion = ?, notas = ? WHERE id = ?', nombre,
    b.telefono ?? c.telefono, b.direccion ?? c.direccion, b.notas ?? c.notas, id);
  return { ok: true };
});

route('GET', /^\/api\/rentas$/, () => todasRentas());
route('GET', /^\/api\/rentas\/(\d+)$/, (ctx, id) => rentaPorId(id));
route('POST', /^\/api\/rentas$/, (ctx) => rentaPorId(crearRenta(ctx.body)));
route('PATCH', /^\/api\/rentas\/(\d+)$/, (ctx, id) => {
  const r = get('SELECT * FROM rentas WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Renta no encontrada');
  const b = ctx.body;
  const extra = b.extra !== undefined ? Number(b.extra) : r.extra;
  if (!Number.isFinite(extra)) throw bad('Monto inválido');
  const dias = b.dias !== undefined ? Number(b.dias) : r.dias;
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw bad('Días inválidos');
  // IVA: el cliente puede decidir pagar en efectivo (sin IVA) o con IVA después de cotizar; se puede cambiar aquí.
  const iva = b.iva_pct !== undefined ? Number(b.iva_pct) : r.iva_pct;
  if (!Number.isFinite(iva) || iva < 0 || iva > 100) throw bad('IVA inválido');
  const facturada = b.facturada !== undefined ? (b.facturada ? 1 : 0) : r.facturada;
  run('UPDATE rentas SET extra = ?, extra_concepto = ?, notas = ?, dias = ?, direccion = ?, iva_pct = ?, facturada = ?, factura_folio = ? WHERE id = ?', extra,
    b.extra_concepto ?? r.extra_concepto, b.notas ?? r.notas, dias, b.direccion ?? r.direccion, iva, facturada,
    b.factura_folio !== undefined ? (String(b.factura_folio).trim() || null) : r.factura_folio, id);
  return rentaPorId(id);
});
// Equipo entregado (casillas con cantidad por tipo de andamio y accesorio). Cantidad 0 = casilla sin marcar.
route('PATCH', /^\/api\/rentas\/(\d+)\/equipo$/, (ctx, id) => {
  const r = get('SELECT * FROM rentas WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Renta no encontrada');
  if (r.estado === 'cancelada') throw bad('La renta está cancelada');
  const tipos = new Set(all('SELECT DISTINCT tipo FROM activos').map(x => x.tipo));
  const limpio = new Map();
  for (const i of Array.isArray(ctx.body.items) ? ctx.body.items : []) {
    const c = Number(i.cantidad);
    if (!tipos.has(i.tipo)) throw bad(`Tipo de pieza desconocido: ${i.tipo}`);
    if (!Number.isInteger(c) || c < 0 || c > 999) throw bad('Cantidad inválida');
    limpio.set(i.tipo, c);
  }
  if (r.estado !== 'devuelta') { // en rentas vigentes no se puede entregar más de lo que hay libre en esas fechas
    for (const [tipo, c] of limpio) {
      const hay = disponiblesTipo(tipo, r.fecha_inicio, r.dias, r.id);
      if (c > hay) throw bad(`Solo hay ${hay} de "${tipo}" disponibles del ${r.fecha_inicio} al ${addDays(r.fecha_inicio, r.dias)}`);
    }
  }
  tx(() => {
    run('DELETE FROM renta_equipo WHERE renta_id = ?', id);
    for (const [tipo, c] of limpio) if (c > 0) run('INSERT INTO renta_equipo (renta_id, tipo, cantidad) VALUES (?,?,?)', id, tipo, c);
  });
  return rentaPorId(id);
});
route('POST', /^\/api\/rentas\/(\d+)\/entregar$/, (ctx, id) => {
  const r = get('SELECT * FROM rentas WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Renta no encontrada');
  if (r.estado !== 'apartada') throw bad('Solo se puede entregar una renta apartada');
  run("UPDATE rentas SET estado = 'activa' WHERE id = ?", id);
  return rentaPorId(id);
});
route('POST', /^\/api\/rentas\/(\d+)\/devolver$/, (ctx, id) => {
  const r = get('SELECT * FROM rentas WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Renta no encontrada');
  if (r.estado !== 'activa') throw bad('Solo se puede devolver una renta activa');
  const fecha = esFecha(ctx.body.fecha) ? ctx.body.fecha : hoy();
  run("UPDATE rentas SET estado = 'devuelta', fecha_devolucion = ? WHERE id = ?", fecha, id);
  return rentaPorId(id);
});
route('POST', /^\/api\/rentas\/(\d+)\/cancelar$/, (ctx, id) => {
  const r = get('SELECT * FROM rentas WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Renta no encontrada');
  if (r.estado === 'devuelta') throw bad('No se puede cancelar una renta ya devuelta');
  tx(() => {
    run("UPDATE rentas SET estado = 'cancelada' WHERE id = ?", id);
    // Si venía de una cotización, esta deja de estar contratada (el cliente ya no la quiso) y se puede volver a abrir.
    run("UPDATE cotizaciones SET estatus = 'No contratada', renta_id = NULL, cerrada_auto = NULL WHERE renta_id = ?", id);
  });
  return rentaPorId(id);
});
route('POST', /^\/api\/rentas\/(\d+)\/pagos$/, (ctx, id) => {
  if (!get('SELECT id FROM rentas WHERE id = ?', id)) throw new HttpError(404, 'Renta no encontrada');
  const monto = Number(ctx.body.monto);
  if (!(monto > 0)) throw bad('Monto inválido');
  const fecha = esFecha(ctx.body.fecha) ? ctx.body.fecha : hoy();
  const forma = ctx.body.forma ? String(ctx.body.forma) : null;
  if (forma && !FORMAS_PAGO[forma]) throw bad('Forma de pago inválida (efectivo o transferencia)');
  run('INSERT INTO pagos (renta_id, fecha, monto, tipo, nota, forma) VALUES (?,?,?,?,?,?)', id, fecha, monto,
    ctx.body.tipo === 'anticipo' ? 'anticipo' : 'pago', ctx.body.nota || null, forma);
  return rentaPorId(id);
});
route('PATCH', /^\/api\/pagos\/(\d+)$/, (ctx, id) => { // cambiar la forma de pago de un pago ya registrado
  const p = get('SELECT renta_id FROM pagos WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'Pago no encontrado');
  const forma = ctx.body.forma ? String(ctx.body.forma) : null;
  if (forma && !FORMAS_PAGO[forma]) throw bad('Forma de pago inválida (efectivo o transferencia)');
  run('UPDATE pagos SET forma = ? WHERE id = ?', forma, id);
  return rentaPorId(p.renta_id);
});
route('DELETE', /^\/api\/pagos\/(\d+)$/, (ctx, id) => {
  const p = get('SELECT renta_id FROM pagos WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'Pago no encontrado');
  run('DELETE FROM pagos WHERE id = ?', id);
  return rentaPorId(p.renta_id);
});
route('GET', /^\/api\/reportes$/, (ctx) => {
  const desde = ctx.query.get('desde'), hasta = ctx.query.get('hasta');
  if (!esFecha(desde) || !esFecha(hasta)) throw bad('Periodo inválido');
  return reportes(desde, hasta);
});

// Ventas agrupadas por mes de inicio de la renta (con IVA); "cobrado" + "porCobrar" = total.
route('GET', /^\/api\/ventas-mensuales$/, () => {
  const meses = new Map();
  for (const r of todasRentas().filter(x => x.estado !== 'cancelada')) {
    const k = r.fecha_inicio.slice(0, 7);
    const b = meses.get(k) || { mes: k, rentas: 0, total: 0, sinIva: 0, iva: 0, cobrado: 0, porCobrar: 0 };
    const pendiente = Math.max(r.saldo, 0);
    b.rentas++; b.total += r.total; b.sinIva += r.subtotal + r.extra; b.iva += r.iva;
    b.porCobrar += pendiente; b.cobrado += r.total - pendiente;
    meses.set(k, b);
  }
  return [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes));
});
// Valor en activos: valor de compra (sin IVA) de la flota por tipo, lo que está en renta, disponible, en mantenimiento
// o dado de baja, y cuánto de la inversión llevan recuperado las ventas (sin IVA). El IVA se calcula al 16%.
route('GET', /^\/api\/valor-activos$/, () => {
  const enRenta = new Map(all(`SELECT e.tipo, SUM(e.cantidad) n FROM renta_equipo e JOIN rentas r ON r.id = e.renta_id
    WHERE r.estado = 'activa' GROUP BY e.tipo`).map(x => [x.tipo, x.n]));
  const tipos = all(`SELECT tipo, categoria, COUNT(*) piezas, SUM(valor) valor,
      SUM(estado = 'Disponible') operativas, SUM(estado = 'Mantenimiento') mantenimiento, SUM(estado = 'Baja') baja,
      SUM(CASE WHEN estado = 'Mantenimiento' THEN valor ELSE 0 END) valor_mantenimiento,
      SUM(CASE WHEN estado = 'Baja' THEN valor ELSE 0 END) valor_baja
    FROM activos GROUP BY tipo, categoria ORDER BY (categoria = 'andamio') DESC, valor DESC`).map(t => {
    const unitario = t.piezas ? t.valor / t.piezas : 0, rentadas = Math.min(enRenta.get(t.tipo) || 0, t.piezas);
    return { ...t, unitario, en_renta: rentadas, valor_en_renta: rentadas * unitario };
  });
  const suma = k => tipos.reduce((s, t) => s + t[k], 0);
  const valor = suma('valor');
  const ventasSinIva = todasRentas().filter(r => r.estado !== 'cancelada').reduce((s, r) => s + r.subtotal + r.extra, 0);
  return {
    tipos, valor, valorConIva: valor * 1.16, piezas: suma('piezas'), enRenta: suma('en_renta'), valorEnRenta: suma('valor_en_renta'),
    valorMantenimiento: suma('valor_mantenimiento'), valorBaja: suma('valor_baja'), piezasMantenimiento: suma('mantenimiento'), piezasBaja: suma('baja'),
    ventasSinIva, recuperado: valor ? ventasSinIva / valor : 0,
  };
});
// Utilización de la flota: andamios rentados por día (solo Estándar y Plegable; los accesorios no cuentan).
// Un andamio cuenta como "en uso" desde el día de inicio hasta el día anterior a su fin/devolución; una renta
// activa y vencida sigue en uso hasta hoy. La serie arranca el día de la primera renta y llega hasta hoy.
route('GET', /^\/api\/utilizacion$/, () => {
  const t = hoy();
  const flota = tipo => get("SELECT COUNT(*) n FROM activos WHERE tipo = ? AND estado != 'Baja'", tipo).n;
  // Se mide con el EQUIPO ENTREGADO (casillas de la ficha de la renta), no con las piezas del precio.
  const filas = all(`SELECT r.id, r.fecha_inicio, r.dias, r.estado, r.fecha_devolucion, e.tipo, e.cantidad n
    FROM renta_equipo e JOIN rentas r ON r.id = e.renta_id
    WHERE r.estado IN ('activa','devuelta') AND e.tipo IN ('Andamio Estandar','Andamio Plegable')`);
  const porDia = new Map();
  let desde = t;
  for (const f of filas) {
    const fin = f.estado === 'devuelta' ? (f.fecha_devolucion || addDays(f.fecha_inicio, f.dias)) : addDays(f.fecha_inicio, f.dias);
    const ultimo = f.estado === 'activa' && fin <= t ? t : addDays(fin, -1);
    if (f.fecha_inicio < desde) desde = f.fecha_inicio;
    for (let d = f.fecha_inicio; d <= ultimo && d <= t; d = addDays(d, 1)) {
      const reg = porDia.get(d) || { e: 0, p: 0 };
      if (f.tipo === 'Andamio Estandar') reg.e += f.n; else reg.p += f.n;
      porDia.set(d, reg);
    }
  }
  const dias = [];
  for (let d = desde; d <= t; d = addDays(d, 1)) dias.push({ f: d, ...(porDia.get(d) || { e: 0, p: 0 }) });
  return { flota: { e: flota('Andamio Estandar'), p: flota('Andamio Plegable') }, desde, hasta: t, dias };
});
route('GET', /^\/api\/cotizaciones$/, () => todasCotizaciones());
route('GET', /^\/api\/cotizaciones\/(\d+)$/, (ctx, id) => cotizacionPorId(id));
route('POST', /^\/api\/cotizaciones$/, (ctx) => cotizacionPorId(crearCotizacion(ctx.body)));
route('PUT', /^\/api\/cotizaciones\/(\d+)$/, (ctx, id) => { actualizarCotizacion(id, ctx.body); return cotizacionPorId(id); });
route('PATCH', /^\/api\/cotizaciones\/(\d+)$/, (ctx, id) => {
  const c = get('SELECT * FROM cotizaciones WHERE id = ?', id);
  if (!c) throw new HttpError(404, 'Cotización no encontrada');
  const b = ctx.body;
  if (b.estatus !== undefined && !ESTATUS_COT.includes(b.estatus)) throw bad('Estatus inválido');
  const estatus = b.estatus ?? c.estatus;
  // Si el cliente se echa para atrás después de contratar: la cotización vuelve a Pendiente o pasa a No contratada y la renta
  // apartada se cancela (las piezas quedan libres). Una renta ya entregada o devuelta no se puede deshacer desde aquí.
  if (c.renta_id && estatus !== 'Contratada') {
    const ren = get('SELECT estado FROM rentas WHERE id = ?', c.renta_id);
    if (ren?.estado === 'activa') throw bad('El equipo ya se entregó: registra la devolución desde la renta (o cancélala allí si no se usó)');
    if (ren?.estado === 'devuelta') throw bad('La renta ya se realizó y no se puede deshacer');
    tx(() => {
      if (ren?.estado === 'apartada') {
        run("UPDATE rentas SET estado = 'cancelada', notas = COALESCE(notas || ' · ', '') || ? WHERE id = ?",
          `Cancelada el ${hoy()}: la cotización ${c.folio} pasó a ${estatus}`, c.renta_id);
      }
      run('UPDATE cotizaciones SET renta_id = NULL WHERE id = ?', id);
    });
    c.renta_id = null;
  }
  // Al reabrir una cotización (volver a Pendiente) empieza de nuevo su vigencia de N días.
  const reabierta = estatus === 'Pendiente' && c.estatus !== 'Pendiente';
  // IVA: se puede activar o quitar mientras la cotización no se haya convertido en renta (el cliente decide cómo paga).
  const iva = b.iva_pct !== undefined ? Number(b.iva_pct) : c.iva_pct;
  if (!Number.isFinite(iva) || iva < 0 || iva > 100) throw bad('IVA inválido');
  if (iva !== c.iva_pct && c.renta_id) throw bad('Ya se convirtió en renta: cambia el IVA desde la renta');
  run('UPDATE cotizaciones SET estatus = ?, notas = ?, telefono = ?, direccion = ?, pendiente_desde = ?, cerrada_auto = ?, iva_pct = ? WHERE id = ?',
    estatus, b.notas ?? c.notas, b.telefono ?? c.telefono, b.direccion ?? c.direccion,
    reabierta ? hoy() : c.pendiente_desde, estatus !== c.estatus ? null : c.cerrada_auto, iva, id);
  return cotizacionPorId(id);
});
route('DELETE', /^\/api\/cotizaciones\/(\d+)$/, (ctx, id) => {
  const c = get('SELECT renta_id FROM cotizaciones WHERE id = ?', id);
  if (!c) throw new HttpError(404, 'Cotización no encontrada');
  if (c.renta_id) throw bad('No se puede borrar: ya se convirtió en renta');
  run('DELETE FROM cotizaciones WHERE id = ?', id);
  return { ok: true };
});
route('GET', /^\/api\/cotizaciones\/(\d+)\/pdf$/, async (ctx, id) => {
  const c = cotizacionPorId(id);
  const html = htmlCotizacion(c);
  const nombre = `${c.folio} ${c.nombre} ANDAMIOS ROSAS`.replace(/[^\p{L}\p{N} ._-]/gu, '').trim();
  const ascii = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');
  const disp = ctx.query.get('descargar') ? 'attachment' : 'inline';
  try {
    const pdf = await generarPdf(html);
    return { raw: pdf, headers: { 'Content-Type': 'application/pdf',
      'Content-Disposition': `${disp}; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(nombre)}.pdf` } };
  } catch (e) { // sin Edge/Chrome disponible: se entrega la versión imprimible
    console.error('PDF:', e.message);
    return { raw: html.replace('</body>', '<script>onload=()=>print()</script></body>'), headers: { 'Content-Type': 'text/html; charset=utf-8' } };
  }
});
route('POST', /^\/api\/cotizaciones\/(\d+)\/convertir$/, (ctx, id) => {
  const c = cotizacionPorId(id);
  if (c.renta_id) throw bad('Esta cotización ya se convirtió en renta');
  const clienteId = c.cliente_id || get('SELECT id FROM clientes WHERE lower(nombre) = lower(?)', c.nombre)?.id || null;
  const rid = crearRenta({
    cliente_id: clienteId, cliente: { nombre: c.nombre, telefono: c.telefono },
    fecha_inicio: esFecha(ctx.body.fecha_inicio) ? ctx.body.fecha_inicio : (c.fecha_traslado || hoy()),
    dias: c.dias, estado: ctx.body.estado === 'activa' ? 'activa' : 'apartada', direccion: c.direccion,
    items: c.items.map(i => ({ tipo: i.tipo, cantidad: i.cantidad, precio_dia: i.precio_dia })),
    extra: c.logistico, extra_concepto: c.logistico ? `Traslado, montaje, desmontaje y recolección (${c.folio})` : null, iva_pct: c.iva_pct,
    notas: `Cotización ${c.folio}${c.notas ? ' · ' + c.notas : ''}`,
  });
  const cli = get('SELECT cliente_id FROM rentas WHERE id = ?', rid).cliente_id;
  run("UPDATE cotizaciones SET estatus = 'Contratada', renta_id = ?, cliente_id = ?, cerrada_auto = NULL WHERE id = ?", rid, cli, id);
  return { renta: rentaPorId(rid), cotizacion: cotizacionPorId(id) };
});

// ---------- Servidor HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(data));
}
function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'Solicitud muy grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(bad('JSON inválido')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) {
      const ctx = { req, ip: req.socket.remoteAddress, query: url.searchParams, body: {}, setCookie: null };
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(p);
        if (!m) continue;
        if (!r.publica && !sesionValida(req)) throw new HttpError(401, 'Sesión requerida');
        if (req.method !== 'GET' && req.method !== 'DELETE') ctx.body = await readBody(req);
        const out = await r.fn(ctx, ...m.slice(1).map(Number).map((n, i) => (isNaN(n) ? m[i + 1] : n)));
        if (out && out.raw) { // respuesta binaria/HTML (PDF de cotización)
          res.writeHead(200, { 'Cache-Control': 'no-store', ...out.headers });
          return res.end(out.raw);
        }
        return sendJson(res, 200, out, ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {});
      }
      throw new HttpError(404, 'Ruta no encontrada');
    }
    if (p === '/logic.js') return sendFile(res, path.join(__dirname, '..', 'sitio-web', 'logic.js'));
    if (p.startsWith('/img/')) {
      const f = path.basename(p);
      return sendFile(res, path.join(FOTOS_DIR, f));
    }
    const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    return sendFile(res, file);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    sendJson(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Error interno' });
  }
});

// ---------- Respaldos diarios ----------
function respaldar() {
  const nombre = `gestion-${hoy()}.db`;
  for (const dir of BACKUP_DIRS) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const destino = path.join(dir, nombre);
      if (!fs.existsSync(destino)) db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
      fs.readdirSync(dir).filter(f => /^gestion-.*\.db$/.test(f)).sort().slice(0, -30).forEach(f => fs.unlinkSync(path.join(dir, f)));
    } catch (e) { console.error('No se pudo respaldar en', dir, e.message); }
  }
}
respaldar();
setInterval(respaldar, 6 * 3600 * 1000).unref();
// Una sola vez: las rentas que ya existían reciben como equipo entregado lo que traían cotizado (por tipo).
function llenarEquipoInicial() {
  if (get("SELECT 1 x FROM importaciones WHERE nombre = 'equipo_inicial'")) return;
  tx(() => {
    run(`INSERT OR IGNORE INTO renta_equipo (renta_id, tipo, cantidad)
      SELECT ra.renta_id, a.tipo, COUNT(*) FROM renta_activos ra JOIN activos a ON a.id = ra.activo_id GROUP BY ra.renta_id, a.tipo`);
    run("INSERT INTO importaciones (nombre, fecha) VALUES ('equipo_inicial', ?)", hoy());
  });
  console.log('Equipo entregado inicializado en las rentas existentes.');
}
llenarEquipoInicial();
importarVentasIniciales();
expirarCotizaciones();
setInterval(expirarCotizaciones, 30 * 60 * 1000).unref(); // además se revisa al abrir cotizaciones y el resumen

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n=== Gestión Andamios Rosas ===');
  console.log(`En esta computadora:  http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`En tu celular (misma Wi-Fi):  http://${ip}:${PORT}`));
  console.log(primeraVez ? `\nPIN de acceso (guárdalo): ${config.pin}` : `\nPIN de acceso: está en ${CONFIG_PATH}`);
  console.log('Para cerrar el sistema: Ctrl+C\n');
});
