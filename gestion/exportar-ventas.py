# -*- coding: utf-8 -*-
"""Exporta las ventas del Excel de tracking (hoja 'Reporte de Ventas', DETALLE DE RENTAS)
a ventas-iniciales.json. El sistema las importa UNA sola vez como rentas.

Uso:  py -I exportar-ventas.py "<ruta al .xlsx>" "<carpeta de datos>"
Solo LEE el Excel (no lo modifica). Imprime un resumen y los renglones que requieren revisión.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

xlsx = Path(sys.argv[1])
destino = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / "AndamiosRosasData"
destino.mkdir(parents=True, exist_ok=True)
sys.stdout.reconfigure(encoding="utf-8")

ws = openpyxl.load_workbook(xlsx, data_only=True)["Reporte de Ventas"]


def num(txt):
    return float(str(txt).replace(",", ""))


def fecha(v):
    if hasattr(v, "strftime") and v.year >= 2000:
        return v.strftime("%Y-%m-%d")
    return None  # vacía o fecha inválida (p. ej. 1900-01-25)


def telefono(v):
    d = re.sub(r"\D", "", str(v or ""))
    return f"{d[:3]} {d[3:6]} {d[6:]}" if len(d) == 10 else (str(v) if v else None)


def tipo(v):
    t = str(v or "").strip().lower()
    if t.startswith("estandar") or t.startswith("estándar"):
        return "Andamio Estandar"
    if t.startswith("plegable"):
        return "Andamio Plegable"
    return None


def pago(L, M):
    t = str(L or "").strip()
    falta = re.search(r"falta\s+pagar\s*\$?\s*([\d,\.]+)", t, re.I)
    if falta:
        return {"modo": "faltan", "valor": num(falta.group(1)), "nota": "Pago parcial"}
    montos = re.findall(r"pag[oó]\s*\$?\s*([\d,\.]+)", str(M or ""), re.I)
    if montos:
        return {"modo": "montos", "valor": [num(x) for x in montos], "nota": t or "Pago"}
    if t:
        return {"modo": "completo", "valor": None, "nota": t}
    return {"modo": "ninguno", "valor": None, "nota": None}


ventas, omitidas, revisar = [], [], []
for r in range(17, 34):
    A, B, C, D, E, F, G, H, I, J, K, L, M = [ws.cell(r, c).value for c in range(1, 14)]
    if not B:
        continue
    folio = None
    if A:
        m = re.match(r"^CO[T7](\d{3})$", str(A).strip(), re.I)
        folio = f"COT{m.group(1)}" if m else str(A).strip()
        if folio != str(A).strip():
            revisar.append(f"fila {r}: folio '{A}' corregido a {folio}")
    ini = fecha(D)
    registro = {
        "folio_cotizacion": folio, "cliente": str(B).strip(), "telefono": telefono(C),
        "fecha_inicio": ini, "tipo": tipo(F), "cantidad": int(G or 0), "dias": int(H or 0),
        "cobrado": float(I or 0), "iva": float(J or 0), "total_excel": float(K or 0),
        "pago": pago(L, M), "fila_excel": r,
    }
    if not ini or not registro["tipo"] or not registro["cantidad"] or not registro["dias"]:
        omitidas.append(registro)
        continue
    if not folio:
        revisar.append(f"fila {r} ({B}): sin número de cotización")
    if registro["pago"]["modo"] == "ninguno":
        revisar.append(f"fila {r} ({B}): sin información de pago → se importa SIN pagos (saldo pendiente)")
    if E and fecha(E) is None:
        revisar.append(f"fila {r} ({B}): fecha fin inválida en el Excel; se usaron los {registro['dias']} días capturados")
    elif E and fecha(E) and fecha(E) < ini:
        revisar.append(f"fila {r} ({B}): fecha fin ({fecha(E)}) anterior al inicio ({ini}); se usaron los {registro['dias']} días")
    ventas.append(registro)

(destino / "ventas-iniciales.json").write_text(json.dumps(ventas, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(ventas)} ventas exportadas a {destino / 'ventas-iniciales.json'}")
print(f"  Suma 'Total cobrado' del Excel de las importadas: ${sum(v['total_excel'] for v in ventas):,.2f}")
for o in omitidas:
    print(f"  OMITIDA fila {o['fila_excel']}: {o['folio_cotizacion']} {o['cliente']} (sin fechas/datos completos) total ${o['total_excel']:,.2f}")
for x in revisar:
    print("  REVISAR:", x)
