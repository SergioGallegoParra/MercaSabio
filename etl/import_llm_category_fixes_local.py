"""Importa la salida de auditoría de categorías del LLM sobre `etl/data/local_staging.db`.

Formato esperado por línea:
  <master_id> | MOVE | <slug_categoria_correcta>
  <master_id> | PURGE |
"""

from __future__ import annotations

import argparse
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH


@dataclass(slots=True)
class CategoryImportStats:
    lines_parsed: int = 0
    moved: int = 0
    purged: int = 0
    invalid_slug: int = 0
    not_found: int = 0


def import_llm_category_fixes_local(
    input_path: Path,
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    dry_run: bool = False,
) -> CategoryImportStats:
    stats = CategoryImportStats()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        cat_by_slug = {
            str(r["slug"]): int(r["id"])
            for r in conn.execute("SELECT id, slug FROM canonical_categories").fetchall()
        }
        for raw_line in input_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or "|" not in line or line.startswith("#") or line.startswith("master_id"):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 2:
                continue
            mid = parts[0]
            action = parts[1].upper()
            target_slug = parts[2].strip() if len(parts) >= 3 else ""
            if action not in {"MOVE", "PURGE"}:
                continue
            stats.lines_parsed += 1

            exists = conn.execute("SELECT id FROM master_products WHERE id = ?", (mid,)).fetchone()
            if not exists:
                stats.not_found += 1
                continue

            if action == "MOVE":
                cid = cat_by_slug.get(target_slug)
                if cid is None:
                    stats.invalid_slug += 1
                    continue
                if not dry_run:
                    conn.execute(
                        "UPDATE master_products SET canonical_category_id = ? WHERE id = ?",
                        (cid, mid),
                    )
                stats.moved += 1
            elif action == "PURGE":
                if not dry_run:
                    conn.execute(
                        "UPDATE store_skus SET is_mercado = 0 WHERE master_product_id = ?",
                        (mid,),
                    )
                stats.purged += 1

        if not dry_run:
            conn.commit()
    finally:
        conn.close()
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Importa reclasificaciones de categoría del LLM a local_staging.db.")
    parser.add_argument("input_file", help="Ruta al .txt con las respuestas del LLM")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    st = import_llm_category_fixes_local(Path(args.input_file), db_path=Path(args.db), dry_run=args.dry_run)
    print(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
