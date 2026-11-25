"""Importa los lotes resueltos por LLM (`<group_id> | <slug> | <product_type> | <variant_core> | <clean_name>`) a `local_staging.db`.

Puebla:
- `canonical_category_id`
- `product_type`, `variant_core`, `clean_canonical_name`
- `product_group_key` (para Producto Agregador)
- `canonical_search_text` (búsqueda fonética independiente del orden)

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.import_llm_catalog_v3_local etl/data/lotes_catalogo_completo/solved/
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from etl.core.catalog_infra import (
    build_product_group_key,
    ensure_local_catalog_infra,
    phonetic_search_normalize,
)
from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH


@dataclass(slots=True)
class CatalogV3ImportStats:
    files_read: int = 0
    lines_parsed: int = 0
    masters_updated: int = 0
    masters_purged: int = 0
    invalid_slug: int = 0
    unknown_group: int = 0


def import_llm_catalog_v3_local(
    input_path: Path,
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    group_map_path: Path | None = None,
    dry_run: bool = False,
) -> CatalogV3ImportStats:
    stats = CatalogV3ImportStats()
    files = sorted(input_path.glob("*.txt")) if input_path.is_dir() else [input_path]

    if group_map_path is None:
        candidate = (
            input_path / "group_map.json"
            if input_path.is_dir()
            else input_path.parent / "group_map.json"
        )
        if not candidate.exists():
            candidate = Path("etl/data/lotes_catalogo_completo/group_map.json")
        group_map_path = candidate

    group_map: dict[str, list[str]] = (
        json.loads(group_map_path.read_text(encoding="utf-8"))
        if group_map_path and group_map_path.exists()
        else {}
    )

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        ensure_local_catalog_infra(conn)
        cat_by_slug = {
            str(r["slug"]): int(r["id"])
            for r in conn.execute("SELECT id, slug FROM canonical_categories").fetchall()
        }
        master_brands = {
            str(r["id"]): (str(r["brand"]) if r["brand"] else None, str(r["normalized_name"] or ""))
            for r in conn.execute("SELECT id, brand, normalized_name FROM master_products").fetchall()
        }

        for fpath in files:
            stats.files_read += 1
            for raw_line in fpath.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if (
                    not line
                    or "|" not in line
                    or line.startswith("#")
                    or line.startswith("group_id")
                    or line.startswith("INSTRUCCIONES")
                ):
                    continue
                parts = [p.strip() for p in line.split("|")]
                if len(parts) < 2:
                    continue
                gid = parts[0]
                slug = parts[1].strip()
                if not gid.startswith("G") and gid not in master_brands:
                    continue
                stats.lines_parsed += 1

                mids = group_map.get(gid) or ([gid] if gid in master_brands else None)
                if not mids:
                    stats.unknown_group += 1
                    continue

                if slug.upper() == "PURGE":
                    if not dry_run:
                        for mid in mids:
                            conn.execute(
                                "UPDATE store_skus SET is_mercado = 0 WHERE master_product_id = ?",
                                (mid,),
                            )
                    stats.masters_purged += len(mids)
                    continue

                cid = cat_by_slug.get(slug)
                if cid is None:
                    stats.invalid_slug += 1
                    continue

                product_type = parts[2].strip() if len(parts) >= 3 and parts[2].strip() else None
                variant_core = parts[3].strip() if len(parts) >= 4 and parts[3].strip() else None
                clean_name = parts[4].strip()[:255] if len(parts) >= 5 and parts[4].strip() else None

                for mid in mids:
                    brand, norm_name = master_brands.get(mid, (None, ""))
                    gkey = build_product_group_key(product_type, brand, variant_core)
                    search_txt = phonetic_search_normalize(
                        " ".join(
                            part
                            for part in (
                                clean_name,
                                (product_type or "").replace("_", " "),
                                brand,
                                norm_name,
                            )
                            if part
                        )
                    )
                    if not dry_run:
                        conn.execute(
                            """
                            UPDATE master_products
                            SET canonical_category_id = ?,
                                product_type = COALESCE(?, product_type),
                                variant_core = COALESCE(?, variant_core),
                                clean_canonical_name = COALESCE(?, clean_canonical_name),
                                product_group_key = COALESCE(?, product_group_key),
                                canonical_search_text = ?
                            WHERE id = ?
                            """,
                            (cid, product_type, variant_core, clean_name, gkey, search_txt, mid),
                        )
                    stats.masters_updated += 1

        if not dry_run:
            conn.commit()
    finally:
        conn.close()

    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Importa lotes v3 del LLM a local_staging.db.")
    parser.add_argument("input_path", help="Archivo .txt o carpeta con lotes resueltos")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--group-map", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    st = import_llm_catalog_v3_local(
        Path(args.input_path),
        db_path=Path(args.db),
        group_map_path=Path(args.group_map) if args.group_map else None,
        dry_run=args.dry_run,
    )
    print(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
