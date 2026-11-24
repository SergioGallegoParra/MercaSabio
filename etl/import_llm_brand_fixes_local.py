"""Importa la salida de auditoría de marcas generada por un LLM dedicado sobre `etl/data/local_staging.db`.

Formato esperado por línea:
  <master_id> | FIX | <marca_correcta>
  <master_id> | CLEAR |
"""

from __future__ import annotations

import argparse
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from etl.core.canonical_mapper import is_store_private_label
from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH


@dataclass(slots=True)
class BrandImportStats:
    lines_parsed: int = 0
    brands_fixed: int = 0
    brands_cleared: int = 0
    not_found: int = 0


def import_llm_brand_fixes_local(
    input_path: Path,
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    dry_run: bool = False,
) -> BrandImportStats:
    stats = BrandImportStats()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        for raw_line in input_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or "|" not in line or line.startswith("#") or line.startswith("master_id"):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 2:
                continue
            mid = parts[0]
            action = parts[1].upper()
            new_brand = parts[2].strip() if len(parts) >= 3 else ""
            if action not in {"FIX", "CLEAR"}:
                continue
            stats.lines_parsed += 1

            row = conn.execute(
                """
                SELECT m.id, m.ean, MIN(s.store_id) AS store_id
                FROM master_products m
                LEFT JOIN store_skus s ON s.master_product_id = m.id
                WHERE m.id = ?
                GROUP BY m.id
                """,
                (mid,),
            ).fetchone()
            if not row:
                stats.not_found += 1
                continue

            if action == "FIX" and new_brand:
                is_pl = (
                    1
                    if row["store_id"] and is_store_private_label(str(row["store_id"]), new_brand, row["ean"])
                    else 0
                )
                if not dry_run:
                    conn.execute(
                        "UPDATE master_products SET brand = ?, is_private_label = ? WHERE id = ?",
                        (new_brand, is_pl, mid),
                    )
                stats.brands_fixed += 1
            elif action == "CLEAR":
                if not dry_run:
                    conn.execute(
                        "UPDATE master_products SET brand = NULL WHERE id = ?",
                        (mid,),
                    )
                stats.brands_cleared += 1

        if not dry_run:
            conn.commit()
    finally:
        conn.close()
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Importa correcciones de marca del LLM a local_staging.db.")
    parser.add_argument("input_file", help="Ruta al .txt con las respuestas del LLM")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    st = import_llm_brand_fixes_local(Path(args.input_file), db_path=Path(args.db), dry_run=args.dry_run)
    print(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
