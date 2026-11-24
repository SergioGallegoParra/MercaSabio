"""Importa 100% en local los resultados de anomalías semánticas revisados por LLM.

Lee los archivos de resultado en `exports/lotes_anomalias/R` (ej. `A1.txt`..`A4.txt`),
resuelve cada `row_id` mediante `exports/llm_anomalias_indice.txt` y aplica sobre
`etl/data/local_staging.db`:
  - `RECLASIFICAR`: actualiza `master_products.canonical_category_id` al slug validado.
  - `EXCLUIR_NO_MERCADO`: purga precios, SKUs y maestros huérfanos respetando
    `product_curation_overrides`.
  - `MANTENER` (o filas omitidas): conserva la categoría actual sin cambios.

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.import_llm_anomalies_local --dry-run
    .\\.venv\\Scripts\\python.exe -m etl.import_llm_anomalies_local
"""

from __future__ import annotations

import argparse
import logging
import re
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.import_llm_v2_local import (
    load_protected_curation_ids,
    load_row_id_to_master_index,
    purge_masters_respecting_overrides,
)

logger = logging.getLogger("etl.import_llm_anomalies_local")

DEFAULT_ANOMALIES_RESULTS_DIR = Path("exports/lotes_anomalias/R")
DEFAULT_ANOMALIES_INDEX_PATH = Path("exports/llm_anomalias_indice.txt")

_ANOMALY_ROW_RE = re.compile(
    r"(?:^|\s)(\d+)\t(RECLASIFICAR|EXCLUIR_NO_MERCADO|MANTENER)(?:\t([a-z0-9-]+))?(?=\s|$)"
)


@dataclass(slots=True)
class AnomalyImportStats:
    files_read: int = 0
    rows_parsed: int = 0
    reclassify_rows: int = 0
    exclude_rows: int = 0
    keep_rows: int = 0
    invalid_slug_rows: int = 0
    unmapped_rows: int = 0
    masters_reclassified: int = 0
    skus_purged: int = 0
    masters_purged: int = 0
    final_master_products: int = 0
    final_store_skus: int = 0
    final_price_records: int = 0


def _natural_sort_key(path: Path) -> tuple[int, str]:
    match = re.search(r"(\d+)", path.stem)
    return (int(match.group(1)) if match else 0, path.name)


def parse_anomaly_results(
    results_dir: Path,
    valid_slugs: set[str],
) -> tuple[dict[int, tuple[str, str | None]], int, int]:
    """Parsea `*.txt` de resultados tolerando ausencia de encabezados y soft wraps.

    Retorna `(parsed_by_row_id, files_read, invalid_slug_rows)`.
    """
    if not results_dir.exists():
        raise FileNotFoundError(f"No existe el directorio de resultados LLM: {results_dir}")

    files = sorted((p for p in results_dir.glob("*.txt") if p.is_file()), key=_natural_sort_key)
    parsed: dict[int, tuple[str, str | None]] = {}
    invalid_slug_rows = 0

    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace").strip()
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*|\s*```$", "", text).strip()
        text = re.sub(r"^row_id\taccion[^\r\n]*", "", text).strip()
        for row_id_str, action, raw_slug in _ANOMALY_ROW_RE.findall(text):
            row_id = int(row_id_str)
            slug = raw_slug.strip() if raw_slug else None
            if action == "RECLASIFICAR":
                if not slug or slug not in valid_slugs:
                    invalid_slug_rows += 1
                    logger.warning("Slug inválido o ausente en %s row_id=%s: %r", path.name, row_id, raw_slug)
                    continue
                parsed[row_id] = (action, slug)
            else:
                parsed[row_id] = (action, None)

    return parsed, len(files), invalid_slug_rows


def apply_llm_anomalies_to_local_db(
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    results_dir: Path = DEFAULT_ANOMALIES_RESULTS_DIR,
    index_path: Path = DEFAULT_ANOMALIES_INDEX_PATH,
    create_backup: bool = True,
    dry_run: bool = False,
) -> AnomalyImportStats:
    """Aplica reclasificaciones y exclusiones semánticas sobre `local_staging.db`."""
    if not db_path.exists():
        raise FileNotFoundError(f"No existe la base SQLite local: {db_path}")

    if create_backup and not dry_run:
        backup_path = db_path.with_name("local_staging_pre_anomalies.db.bak")
        if not backup_path.exists():
            shutil.copy2(db_path, backup_path)
            logger.info("Respaldo previo a anomalías creado en %s", backup_path)

    row_to_master = load_row_id_to_master_index(index_path)
    stats = AnomalyImportStats()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cat_rows = conn.execute("SELECT id, slug FROM canonical_categories").fetchall()
        slug_to_cat_id: dict[str, int] = {str(r["slug"]): int(r["id"]) for r in cat_rows}

        parsed, files_read, invalid_slug_rows = parse_anomaly_results(results_dir, set(slug_to_cat_id))
        stats.files_read = files_read
        stats.invalid_slug_rows = invalid_slug_rows
        stats.rows_parsed = len(parsed)

        protected_sku_ids, protected_master_ids = load_protected_curation_ids(conn)

        cat_updates: list[tuple[int, str]] = []
        purge_master_ids: set[str] = set()

        for row_id, (action, slug) in parsed.items():
            mid = row_to_master.get(row_id)
            if not mid:
                stats.unmapped_rows += 1
                continue
            if action == "RECLASIFICAR" and slug and slug in slug_to_cat_id:
                cat_updates.append((slug_to_cat_id[slug], mid))
                stats.reclassify_rows += 1
            elif action == "EXCLUIR_NO_MERCADO":
                purge_master_ids.add(mid)
                stats.exclude_rows += 1
            elif action == "MANTENER":
                stats.keep_rows += 1

        if dry_run:
            effective_purge = purge_master_ids - protected_master_ids
            if cat_updates:
                existing = {
                    str(r[0]): r[1]
                    for r in conn.execute(
                        f"SELECT id, canonical_category_id FROM master_products WHERE id IN ({','.join('?' for _ in cat_updates)})",
                        [mid for _, mid in cat_updates],
                    ).fetchall()
                }
                stats.masters_reclassified = sum(
                    1 for cat_id, mid in cat_updates if mid in existing and existing[mid] != cat_id
                )
            if effective_purge:
                ph = ",".join("?" for _ in effective_purge)
                sku_rows = conn.execute(
                    f"SELECT id, master_product_id FROM store_skus WHERE master_product_id IN ({ph})",
                    list(effective_purge),
                ).fetchall()
                surviving_masters = {
                    str(r["master_product_id"])
                    for r in sku_rows
                    if str(r["id"]) in protected_sku_ids
                }
                stats.skus_purged = sum(1 for r in sku_rows if str(r["id"]) not in protected_sku_ids)
                stats.masters_purged = conn.execute(
                    f"SELECT COUNT(*) FROM master_products WHERE id IN ({ph})",
                    list(effective_purge),
                ).fetchone()[0] - len(surviving_masters)
        else:
            if cat_updates:
                cur = conn.executemany(
                    "UPDATE master_products SET canonical_category_id = ? WHERE id = ?",
                    cat_updates,
                )
                stats.masters_reclassified = int(cur.rowcount if cur.rowcount != -1 else len(cat_updates))

            skus_purged, masters_purged = purge_masters_respecting_overrides(
                conn, purge_master_ids, protected_sku_ids, protected_master_ids
            )
            stats.skus_purged = skus_purged
            stats.masters_purged = masters_purged

            conn.commit()
            conn.execute("VACUUM;")
            conn.execute("ANALYZE;")

        stats.final_master_products = int(conn.execute("SELECT COUNT(*) FROM master_products").fetchone()[0])
        stats.final_store_skus = int(conn.execute("SELECT COUNT(*) FROM store_skus").fetchone()[0])
        stats.final_price_records = int(conn.execute("SELECT COUNT(*) FROM price_records").fetchone()[0])
    finally:
        conn.close()

    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser(description="Ingesta resultados de anomalías LLM sobre SQLite local.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--results-dir", default=str(DEFAULT_ANOMALIES_RESULTS_DIR))
    parser.add_argument("--index", default=str(DEFAULT_ANOMALIES_INDEX_PATH))
    parser.add_argument("--no-backup", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    st = apply_llm_anomalies_to_local_db(
        db_path=Path(args.db),
        results_dir=Path(args.results_dir),
        index_path=Path(args.index),
        create_backup=not args.no_backup,
        dry_run=args.dry_run,
    )
    print(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
