'use strict';
// Junta la base de la PC (gestion.db + gestion.db-wal) en UN solo archivo para subirlo a Railway.
// No toca la base original: primero la copia a una carpeta temporal y trabaja sobre la copia.
// Uso: node exportar-base.js   (o doble clic en preparar-base-para-railway.bat)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.GESTION_DATA_DIR || path.join(os.homedir(), 'AndamiosRosasData');
const origen = path.join(DATA_DIR, 'gestion.db');
if (!fs.existsSync(origen)) { console.error(`No se encontró la base en ${origen}`); process.exit(1); }

const hoy = new Date().toLocaleDateString('en-CA');
const destino = path.resolve(process.argv[2] || path.join(__dirname, `base-para-railway-${hoy}.db`));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gestion-export-'));
try {
  for (const ext of ['', '-wal']) {
    if (fs.existsSync(origen + ext)) fs.copyFileSync(origen + ext, path.join(tmp, 'gestion.db' + ext));
  }
  const copia = new DatabaseSync(path.join(tmp, 'gestion.db'));
  const n = t => copia.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  const resumen = { activos: n('activos'), rentas: n('rentas'), clientes: n('clientes'), cotizaciones: n('cotizaciones') };
  fs.rmSync(destino, { force: true });
  copia.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  copia.close();
  console.log(`Listo: ${destino}`);
  console.log(`Contiene ${resumen.activos} activos, ${resumen.rentas} rentas, ${resumen.clientes} clientes y ${resumen.cotizaciones} cotizaciones.`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
