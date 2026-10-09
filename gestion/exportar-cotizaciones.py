# -*- coding: utf-8 -*-
"""Exporta la hoja 'COTIZACIONES' del Excel de tracking a cotizaciones-iniciales.json.

Uso:  py -I exportar-cotizaciones.py "<ruta al .xlsx>" "<carpeta de datos>"
Solo LEE el Excel (no lo modifica). El JSON queda fuera del repositorio, en la
carpeta de datos del sistema (por defecto ~/AndamiosRosasData). El sistema lo
importa una sola vez, cuando la tabla de cotizaciones está vacía.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

MESES = {m: i for i, m in enumerate(
    ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"], 1)}
TIPOS = {"estandar": "Andamio Estandar", "estándar": "Andamio Estandar", "plegable": "Andamio Plegable"}
ESTATUS = {"contratado": "Contratada", "no contratado": "No contratada"}
ACCESORIOS = [(6, "llantas"), (7, "niveladores"), (8, "charola"), (9, "escalera plegable"), (10, "escalera estándar")]


def fecha(valor):
    """'12 de agosto del 2026' (o datetime) -> '2026-08-12'; None si no es fecha."""
    if hasattr(valor, "strftime"):
        return valor.strftime("%Y-%m-%d")
    m = re.match(r"\s*(\d{1,2})\s+de\s+([a-záéíóú]+)\s+del?\s+(\d{4})", str(valor or ""), re.I)
    if not m or m.group(2).lower() not in MESES:
        return None
    return f"{int(m.group(3)):04d}-{MESES[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"


def numero(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


xlsx = Path(sys.argv[1])
destino = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / "AndamiosRosasData"
destino.mkdir(parents=True, exist_ok=True)

ws = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)["COTIZACIONES"]
salida = []
for f in ws.iter_rows(min_row=3, values_only=True):
    folio, nombre = f[1], f[3]
    if not folio or not nombre:
        continue  # filas de plantilla vacías (COT0xx sin datos)
    dias = int(numero(f[11])) or 1
    cantidad = int(numero(f[5]))
    precio = numero(f[15])
    logistico = numero(f[16])
    base = precio + logistico
    iva = numero(f[17])
    incluye = [nombre_acc for col, nombre_acc in ACCESORIOS if str(f[col] or "").strip().upper() == "SI"]
    tipo = TIPOS.get(str(f[4] or "").strip().lower())
    salida.append({
        "folio": str(folio).strip(),
        "fecha": fecha(f[2]) or "2026-01-01",
        "nombre": str(nombre).strip(),
        "direccion": str(f[14]).strip() if f[14] else None,
        "dias": dias,
        "fecha_traslado": fecha(f[12]),
        "fecha_recoleccion": fecha(f[13]),
        "tipo": tipo,
        "cantidad": cantidad if tipo else 0,
        # El precio del Excel ya incluye accesorios: se guarda como precio promedio por andamio por día.
        "precio_dia": round(precio / (cantidad * dias), 2) if tipo and cantidad else 0,
        "subtotal": precio,
        "logistico": logistico,
        "iva_pct": round(iva / base * 100) if base and iva else 0,
        "estatus": ESTATUS.get(str(f[19] or "").strip().lower(), "Pendiente"),
        "notas": ("Incluye: " + ", ".join(incluye)) if incluye else None,
    })

(destino / "cotizaciones-iniciales.json").write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
resumen = {}
for q in salida:
    resumen[q["estatus"]] = resumen.get(q["estatus"], 0) + 1
print(f"{len(salida)} cotizaciones exportadas a {destino / 'cotizaciones-iniciales.json'}  {resumen}")
