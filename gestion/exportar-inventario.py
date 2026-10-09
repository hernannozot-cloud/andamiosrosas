# -*- coding: utf-8 -*-
"""Exporta la hoja 'Inventario' del Excel de tracking a inventario-inicial.json.

Uso:  py -I exportar-inventario.py "<ruta al .xlsx>" "<carpeta de datos>"
Solo LEE el Excel (no lo modifica). El JSON queda fuera del repositorio, en la
carpeta de datos del sistema (por defecto ~/AndamiosRosasData).
"""
import json
import sys
from pathlib import Path

import openpyxl

xlsx = Path(sys.argv[1])
destino = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / "AndamiosRosasData"
destino.mkdir(parents=True, exist_ok=True)

wb = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)
ws = wb["Inventario"]
activos = []
for fila in ws.iter_rows(min_row=2, values_only=True):
    codigo, nombre = fila[0], fila[1]
    if not codigo or not nombre:
        continue
    activos.append({
        "codigo": str(codigo).strip(),
        "tipo": str(nombre).strip(),
        "valor": float(fila[2] or 0),
        "renta_dia": float(fila[4] or 0),
        "estado": "Disponible",
        "condicion": fila[6],
        "ubicacion": fila[8],
        "notas": fila[9],
    })

(destino / "inventario-inicial.json").write_text(json.dumps(activos, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(activos)} activos exportados a {destino / 'inventario-inicial.json'}")
