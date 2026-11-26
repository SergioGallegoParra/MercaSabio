"""Exporta todo el catálogo en lotes `.txt` compactos y priorizados ("a ciegas") para clasificación definitiva con LLM.

Cada fila representa un grupo base (agrupando múltiples tamaños del mismo producto, p.ej. 500g/1kg/5kg)
y omite la categoría actual de la BD para evitar sesgo de confirmación.
Prioridad de lotes:
  - P1: Productos con desacuerdo entre la categoría oficial VTEX y nuestra BD actual.
  - P2: Productos de tiendas sin ruta oficial VTEX (D1, Ara, Ísimo, Makro, Mercamío, etc.).
  - P3: Productos con consenso VTEX (para estandarizar `product_type`, `variant_core` y `clean_canonical_name`).

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.export_llm_catalog_v3
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from etl.core.catalog_infra import ensure_local_catalog_infra
from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.normalizer import normalize_product_name
from etl.core.product_enrichment import infer_category_from_store_path

DEFAULT_OUT_DIR = Path("etl/data/lotes_catalogo_completo")
DEFAULT_BATCH_SIZE = 500

_SIZE_RX = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*(?:grs?|g|kg|ml|cc|l|lt|lts|unds?|u|un|oz|lb)\b",
    re.IGNORECASE,
)
_PACK_RX = re.compile(
    r"\b(?:x\s*\d+|\d+\s*x\s*\d*|bolsa|caja|frasco|botella|paquete|lata|doypack|pet|tetra|pack|pouch|sobre|bandeja|und|unidad|unidades)\b",
    re.IGNORECASE,
)


def _norm_ascii(s: str | None) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii").lower()


def _base_group_key(normalized_name: str, brand: str | None, unit_measure: str) -> str:
    s = _norm_ascii(normalized_name)
    s = _SIZE_RX.sub(" ", s)
    s = _PACK_RX.sub(" ", s)
    s = re.sub(r"[^a-z]+", " ", s).strip()
    head = " ".join(s.split()[:4])
    b = re.sub(r"[^a-z0-9]+", "", _norm_ascii(brand)) or "nobrand"
    return f"{head}|{b}|{unit_measure.lower()}"


def export_llm_catalog_v3(
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    out_dir: Path = DEFAULT_OUT_DIR,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> dict[str, int]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        ensure_local_catalog_infra(conn)
        cats = conn.execute(
            "SELECT id, slug, name FROM canonical_categories ORDER BY slug ASC"
        ).fetchall()
        valid_slugs_block = "\n".join(f"  - {c['slug']} ({c['name']})" for c in cats)

        rows = conn.execute(
            """
            SELECT m.id AS mid, m.normalized_name, m.brand, m.unit_measure,
                   c.slug AS our_slug,
                   s.raw_name, s.raw_category_path
            FROM master_products m
            JOIN store_skus s ON s.master_product_id = m.id
            LEFT JOIN canonical_categories c ON c.id = m.canonical_category_id
            WHERE s.is_mercado = 1
            """
        ).fetchall()
    finally:
        conn.close()

    by_master: dict[str, dict[str, object]] = {}
    for r in rows:
        mid = str(r["mid"])
        entry = by_master.get(mid)
        if entry is None:
            entry = {
                "mid": mid,
                "normalized_name": str(r["normalized_name"] or ""),
                "brand": str(r["brand"] or "").strip(),
                "unit_measure": str(r["unit_measure"] or "und"),
                "our_slug": str(r["our_slug"]) if r["our_slug"] else None,
                "sample_raw": str(r["raw_name"] or r["normalized_name"] or ""),
                "vtex_paths": Counter(),
                "vtex_slugs": Counter(),
            }
            by_master[mid] = entry
        rcp = str(r["raw_category_path"] or "").strip()
        if rcp:
            entry["vtex_paths"][rcp] += 1  # type: ignore[index]
            segs = [p.strip() for p in rcp.split(">") if p.strip()]
            inferred = infer_category_from_store_path(segs)
            if inferred:
                entry["vtex_slugs"][inferred] += 1  # type: ignore[index]

    # Agrupar maestros en productos base usando su raw_name real (evita agrupar por normalized_name corrupto)
    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
    for m in by_master.values():
        live_norm = normalize_product_name(str(m["sample_raw"])) or str(m["normalized_name"])
        gkey = _base_group_key(
            live_norm, str(m["brand"]), str(m["unit_measure"])
        )
        grouped[gkey].append(m)

    # Clasificar cada grupo por prioridad: P1 desacuerdo VTEX, P2 sin VTEX mapeado, P3 consenso VTEX
    records: list[tuple[int, str, str, str, str, str, list[str]]] = []
    for _gkey, members in grouped.items():
        all_vtex_paths: Counter[str] = Counter()
        all_vtex_slugs: Counter[str] = Counter()
        has_disagree = False
        has_mapped = False
        for m in members:
            all_vtex_paths.update(m["vtex_paths"])  # type: ignore[arg-type]
            vs: Counter[str] = m["vtex_slugs"]  # type: ignore[assignment]
            all_vtex_slugs.update(vs)
            if vs:
                has_mapped = True
                top_v = vs.most_common(1)[0][0]
                if top_v != m["our_slug"]:
                    has_disagree = True

        prio = 1 if has_disagree else (2 if not has_mapped else 3)
        rep = min(members, key=lambda x: len(str(x["sample_raw"])))
        brand = str(rep["brand"] or "").replace("|", " ").strip()
        unit = str(rep["unit_measure"])
        vtex_ctx = (
            all_vtex_paths.most_common(1)[0][0].replace("|", "/")
            if all_vtex_paths
            else "-"
        )
        sample = " ".join(str(rep["sample_raw"]).replace("|", " ").split())[:130]
        if len(members) > 1:
            sample = f"{sample} ({len(members)} tam.)"
        mids = [str(m["mid"]) for m in members]
        records.append((prio, brand, unit, vtex_ctx, sample, str(rep["normalized_name"]), mids))

    records.sort(key=lambda x: (x[0], x[3], x[5]))

    out_dir.mkdir(parents=True, exist_ok=True)
    # Limpiar lotes previos
    for old_f in out_dir.glob("lote_*.txt"):
        old_f.unlink()

    group_map: dict[str, list[str]] = {}
    counts_prio = Counter()
    total_batches = (len(records) + batch_size - 1) // batch_size

    for b_idx in range(total_batches):
        chunk = records[b_idx * batch_size : (b_idx + 1) * batch_size]
        prio_label = f"P{chunk[0][0]}"
        header = f"""INSTRUCCIONES PARA EL LLM (CLASIFICACION INTEGRAL A CIEGAS - LOTE {b_idx + 1}/{total_batches} [{prio_label}])
===========================================================================
Objetivo:
Para cada grupo base de producto (que ya agrupa sus distintos tamaños), devuelve 5 columnas separadas por `|`:
  <group_id> | <category_slug> | <product_type> | <variant_core> | <clean_canonical_name>

1) <category_slug> — USA EXACTAMENTE UNO DE ESTOS 27 SLUGS (o `PURGE` si NO es de supermercado):
{valid_slugs_block}

2) <product_type> — Tipo base estandarizado en `snake_case` (sin marca ni tamaño), por ejemplo:
   `arroz_blanco`, `arroz_integral`, `pollo_entero`, `pechuga_pollo`, `lomo_cerdo`, `carne_res`, `atun_lata`,
   `queso_mozzarella`, `queso_campesino`, `mantequilla`, `leche_entera`, `leche_deslactosada`, `yogur_griego`,
   `pan_tajado`, `tostadas`, `galletas_saladas`, `detergente_liquido`, `detergente_polvo`, `jabon_corporal`,
   `shampoo`, `crema_dental`, `papel_higienico`, `aceite_girasol`, `cafe_molido`, `bebida_refrescante`, etc.

3) <variant_core> — Variante funcional corta (`tradicional`, `integral`, `deslactosada`, `light`, `sin_azucar`, `rallado`, `tajado`, `bloque`, `limon`, `fresa`, etc.).

4) <clean_canonical_name> — Nombre limpio en español (Tipo + Variante + Marca, SIN tamaño/gramaje/empaque).
   Ej: `Arroz Blanco Diana`, `Pollo Entero Campesino Bucanero`, `Queso Mozzarella Rallado Latti`.

FORMATO EXACTO DE SALIDA (UNA LINEA POR GRUPO, SIN EXPLICACIONES NI NUMERACION):
- Si no es de supermercado (ropa, juguetes, repuestos): `<group_id> | PURGE | | |`
- Para todos los demás: `<group_id> | <category_slug> | <product_type> | <variant_core> | <clean_canonical_name>`

ENTRADA: group_id | marca | unidad | categoria_tienda_vtex | producto_ejemplo
---------------------------------------------------------------------------
"""
        lines = [header]
        for offset, (prio, brand, unit, vtex_ctx, sample, _nname, mids) in enumerate(chunk):
            gid = f"G{b_idx * batch_size + offset + 1:05d}"
            group_map[gid] = mids
            counts_prio[f"P{prio}"] += 1
            lines.append(f"{gid} | {brand} | {unit} | {vtex_ctx} | {sample}\n")

        batch_path = out_dir / f"lote_{b_idx + 1:03d}_{prio_label}.txt"
        batch_path.write_text("".join(lines), encoding="utf-8")

    (out_dir / "group_map.json").write_text(
        json.dumps(group_map, ensure_ascii=False), encoding="utf-8"
    )
    return {
        "total_masters": len(by_master),
        "total_groups": len(records),
        "total_batches": total_batches,
        "p1_disagree": counts_prio["P1"],
        "p2_no_vtex": counts_prio["P2"],
        "p3_agree": counts_prio["P3"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Exporta catálogo compacto a ciegas en lotes .txt.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    args = parser.parse_args(argv)
    stats = export_llm_catalog_v3(
        db_path=Path(args.db),
        out_dir=Path(args.out_dir),
        batch_size=args.batch_size,
    )
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
