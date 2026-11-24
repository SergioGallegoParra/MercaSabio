"""Unifica papel higiénico en local y exporta mini-lotes TSV para depuración LLM.

Aplica primero la regla determinística verificada de papel higiénico (`papel hig`
fuera de `cuidado-personal-e-higiene` -> `cuidado-personal-e-higiene`) sobre
`etl/data/local_staging.db`, y luego exporta en mini-lotes de 400 filas sin UUID
(`exports/lotes_depuracion/depuracion_*.txt` + `exports/llm_depuracion_indice.txt`)
los casos semánticos pendientes:
  - Velas/velones y grupos mixtos en `hogar-y-desechables` y otras categorías
  - Puericultura, mobiliario y grupos mixtos en `bebes-y-maternidad`
  - Grupos mixtos/accesorios en `mascotas`
  - Grupos pendientes del Archivo 1 (`288`, `447`)

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.export_llm_depuracion_lotes
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import sqlite3
from pathlib import Path

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.semantic_catalog_audit import _clean_cell

logger = logging.getLogger("etl.export_llm_depuracion_lotes")

DEFAULT_BY_CAT_MAP_PATH = Path("etl/data/semantic_clusters_by_category_map.json")
DEFAULT_GLOBAL_MAP_PATH = Path("etl/data/semantic_clusters_map.json")
DEFAULT_OUT_DIR = Path("exports/lotes_depuracion")
DEFAULT_INDEX_PATH = Path("exports/llm_depuracion_indice.txt")

PURE_BEBES_CONSUMABLE_CLUSTERS = {
    "bebes-y-maternidad#01",
    "bebes-y-maternidad#06",
    "bebes-y-maternidad#08",
    "bebes-y-maternidad#10",
    "bebes-y-maternidad#11",
    "bebes-y-maternidad#12",
    "bebes-y-maternidad#13",
    "bebes-y-maternidad#16",
    "bebes-y-maternidad#20",
    "bebes-y-maternidad#23",
    "bebes-y-maternidad#24",
    "bebes-y-maternidad#26",
    "bebes-y-maternidad#27",
    "bebes-y-maternidad#34",
    "bebes-y-maternidad#36",
    "bebes-y-maternidad#37",
    "bebes-y-maternidad#38",
    "bebes-y-maternidad#50",
}

HOGAR_REVIEW_CLUSTERS = (
    "hogar-y-desechables#03",
    "hogar-y-desechables#13",
    "hogar-y-desechables#14",
    "hogar-y-desechables#15",
    "hogar-y-desechables#16",
    "hogar-y-desechables#18",
    "hogar-y-desechables#19",
    "hogar-y-desechables#21",
    "hogar-y-desechables#25",
)

MASCOTAS_REVIEW_CLUSTERS = (
    "mascotas#01",
    "mascotas#07",
    "mascotas#09",
    "mascotas#14",
    "mascotas#25",
    "mascotas#38",
    "mascotas#39",
)

GLOBAL_EXTRA_CLUSTERS = ("288", "447")


def unify_toilet_paper_local(conn: sqlite3.Connection) -> int:
    """Mueve los ítems inequívocos de papel higiénico hacia `cuidado-personal-e-higiene`."""
    target_row = conn.execute(
        "SELECT id FROM canonical_categories WHERE slug = 'cuidado-personal-e-higiene'"
    ).fetchone()
    if target_row is None:
        return 0
    target_cat_id = int(target_row[0])

    cur = conn.execute(
        """
        UPDATE master_products
        SET canonical_category_id = ?
        WHERE canonical_category_id != ?
          AND (
            normalized_name LIKE '%papel hig%'
            OR normalized_name LIKE '%pap hig%'
          )
        """,
        (target_cat_id, target_cat_id),
    )
    return int(cur.rowcount if cur.rowcount != -1 else 0)


def build_depuracion_batches(
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    by_cat_map_path: Path = DEFAULT_BY_CAT_MAP_PATH,
    global_map_path: Path = DEFAULT_GLOBAL_MAP_PATH,
    out_dir: Path = DEFAULT_OUT_DIR,
    index_path: Path = DEFAULT_INDEX_PATH,
    batch_size: int = 400,
) -> dict[str, int]:
    """Aplica papel higiénico en local y exporta mini-lotes TSV para curación LLM."""
    if not db_path.exists():
        raise FileNotFoundError(f"No existe la base local: {db_path}")

    by_cat = json.loads(by_cat_map_path.read_text(encoding="utf-8"))
    global_map = json.loads(global_map_path.read_text(encoding="utf-8"))

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        moved_ph = unify_toilet_paper_local(conn)
        if moved_ph:
            conn.commit()
            logger.info("Papel higiénico unificado en cuidado-personal-e-higiene: %d maestros", moved_ph)

        valid_slugs = [
            str(r[0]) for r in conn.execute("SELECT slug FROM canonical_categories ORDER BY slug ASC").fetchall()
        ]

        source_by_mid: dict[str, str] = {}
        for cluster_key, mids in by_cat.items():
            if cluster_key.startswith("bebes-y-maternidad#") and cluster_key not in PURE_BEBES_CONSUMABLE_CLUSTERS:
                for mid in mids:
                    source_by_mid.setdefault(str(mid), cluster_key)

        for cluster_key in HOGAR_REVIEW_CLUSTERS + MASCOTAS_REVIEW_CLUSTERS:
            for mid in by_cat.get(cluster_key, []):
                source_by_mid.setdefault(str(mid), cluster_key)

        for cid in GLOBAL_EXTRA_CLUSTERS:
            for mid in global_map.get(cid, []):
                source_by_mid.setdefault(str(mid), f"global#{cid}")

        candle_rows = conn.execute(
            """
            SELECT mp.id
            FROM master_products mp
            JOIN canonical_categories cc ON cc.id = mp.canonical_category_id
            WHERE (mp.normalized_name GLOB '*vela*' OR mp.normalized_name GLOB '*velon*' OR mp.normalized_name GLOB '*cirio*')
              AND cc.slug NOT IN ('hogar-y-desechables', 'jamones-y-embutidos')
            """
        ).fetchall()
        for r in candle_rows:
            source_by_mid.setdefault(str(r["id"]), "sospecha_vela")

        all_mids = list(source_by_mid)
        rows_data: list[tuple[str, str, str, str, str]] = []
        for idx in range(0, len(all_mids), 500):
            chunk = all_mids[idx : idx + 500]
            ph = ",".join("?" for _ in chunk)
            db_rows = conn.execute(
                f"""
                SELECT
                    mp.id AS master_product_id,
                    COALESCE(NULLIF(TRIM(MIN(ss.display_name)), ''), MIN(ss.raw_name), mp.normalized_name) AS title,
                    mp.brand,
                    cc.slug AS current_slug
                FROM master_products mp
                JOIN canonical_categories cc ON cc.id = mp.canonical_category_id
                LEFT JOIN store_skus ss ON ss.master_product_id = mp.id
                WHERE mp.id IN ({ph})
                GROUP BY mp.id
                """,
                chunk,
            ).fetchall()
            for r in db_rows:
                mid = str(r["master_product_id"])
                rows_data.append(
                    (
                        mid,
                        _clean_cell(r["title"]),
                        _clean_cell(r["brand"]),
                        str(r["current_slug"]),
                        source_by_mid[mid],
                    )
                )
    finally:
        conn.close()

    rows_data.sort(key=lambda item: (item[3], item[4], item[1], item[0]))

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path.parent.mkdir(parents=True, exist_ok=True)

    index_lines = ["row_id\tmaster_product_id"]
    total = len(rows_data)
    batch_files = 0
    slugs_str = ", ".join(valid_slugs)

    for start in range(0, total, batch_size):
        batch_files += 1
        end = min(start + batch_size, total)
        chunk = rows_data[start:end]
        lines = [
            f"# LOTE {batch_files} (row_id {start + 1}..{end} de {total})",
            "# Responde SOLO las filas que necesiten cambio en TSV: row_id\\taccion (RECLASIFICAR | EXCLUIR_NO_MERCADO)\\tcanonical_slug_final",
            "# Reglas: EXCLUIR_NO_MERCADO = velas/velones/veladoras, puericultura y mobiliario/accesorios de bebé (sillas, bañeras, teteros, biberones, chupos, tetinas, mordedores, vajilla/cubiertos, calentadores, extractores, juguetes, coches, ropa; SÍ mantener pañales, pañitos, fórmulas, compotas y aseo bebé), y accesorios/mobiliario de mascotas (mantas, rascadores, pecheras, juguetes, casetas). RECLASIFICAR = productos de supermercado válidos en categoría errónea. Omitir filas MANTENER.",
            f"# CATEGORÍAS OFICIALES VÁLIDAS: {slugs_str}",
            "row_id\ttitle\tbrand\tcurrent_slug\tsource_group",
        ]
        for offset, (mid, title, brand, cur_slug, src_group) in enumerate(chunk, start=1):
            row_id = start + offset
            index_lines.append(f"{row_id}\t{mid}")
            lines.append(f"{row_id}\t{title}\t{brand}\t{cur_slug}\t{src_group}")

        batch_path = out_dir / f"depuracion_{batch_files:02d}.txt"
        batch_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    index_path.write_text("\n".join(index_lines) + "\n", encoding="utf-8")
    return {
        "toilet_paper_unified": moved_ph,
        "exported_rows": total,
        "batch_files": batch_files,
    }


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser(description="Unifica papel higiénico y exporta lotes TSV de depuración LLM.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    parser.add_argument("--index", default=str(DEFAULT_INDEX_PATH))
    parser.add_argument("--batch-size", type=int, default=400)
    args = parser.parse_args()
    res = build_depuracion_batches(
        db_path=Path(args.db),
        out_dir=Path(args.out_dir),
        index_path=Path(args.index),
        batch_size=args.batch_size,
    )
    print(res)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
