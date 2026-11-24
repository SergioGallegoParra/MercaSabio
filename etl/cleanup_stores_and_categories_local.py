"""Elimina tiendas obsoletas y fusiona las 10 categorías heredadas por tamaño en local.

Acciones sobre `etl/data/local_staging.db`:
  1. Elimina `alkosto`, `ktronix`, `oxxo` y `rappi` de `product_price_daily`,
     `store_branches`, `price_records`/`store_skus` (si quedara alguno) y `stores`.
  2. Reubica los `master_products` de las 10 categorías específicas heredadas
     (`aceite-vegetal-900ml`, `arroz-blanco-1000g`, `atun-lata-160g`,
      `azucar-refinada-1000g`, `cafe-molido-500g`, `frijol-500g`, `lenteja-500g`,
      `huevos-aa-30und`, `leche-entera-1000ml`, `pasta-espagueti-500g`)
     hacia sus categorías generales correspondientes, renombra `huevos-y-derivados`
     a `Huevos y Derivados`, y elimina las 10 categorías vacías.

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.cleanup_stores_and_categories_local --dry-run
    .\\.venv\\Scripts\\python.exe -m etl.cleanup_stores_and_categories_local
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH

logger = logging.getLogger("etl.cleanup_stores_and_categories_local")

DELETE_STORE_IDS: tuple[str, ...] = ("alkosto", "ktronix", "oxxo", "rappi")

CATEGORY_MERGE_MAP: dict[str, str] = {
    "aceite-vegetal-900ml": "aceites-y-vinagres",
    "arroz-blanco-1000g": "arroces-y-granos",
    "atun-lata-160g": "enlatados-y-conservas",
    "azucar-refinada-1000g": "azucar-panela-miel",
    "cafe-molido-500g": "cafe-te-y-chocolate",
    "frijol-500g": "arroces-y-granos",
    "lenteja-500g": "arroces-y-granos",
    "huevos-aa-30und": "huevos-y-derivados",
    "leche-entera-1000ml": "lacteos-y-leches",
    "pasta-espagueti-500g": "pastas-y-fideos",
}


@dataclass(slots=True)
class CleanupStats:
    stores_deleted: int = 0
    branches_deleted: int = 0
    daily_deleted: int = 0
    skus_deleted: int = 0
    masters_reassigned: int = 0
    categories_deleted: int = 0
    final_stores: int = 0
    final_categories: int = 0
    final_master_products: int = 0
    final_store_skus: int = 0


def apply_store_and_category_cleanup_local(
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    create_backup: bool = True,
    dry_run: bool = False,
) -> CleanupStats:
    if not db_path.exists():
        raise FileNotFoundError(f"No existe la base SQLite local: {db_path}")

    if create_backup and not dry_run:
        backup_path = db_path.with_name("local_staging_pre_cat_store_cleanup.db.bak")
        if not backup_path.exists():
            shutil.copy2(db_path, backup_path)
            logger.info("Respaldo creado en %s", backup_path)

    stats = CleanupStats()
    conn = sqlite3.connect(db_path)
    try:
        store_ph = ",".join("?" for _ in DELETE_STORE_IDS)
        slug_to_id = {
            str(r[0]): int(r[1])
            for r in conn.execute("SELECT slug, id FROM canonical_categories").fetchall()
        }

        if dry_run:
            stats.stores_deleted = int(
                conn.execute(f"SELECT COUNT(*) FROM stores WHERE id IN ({store_ph})", DELETE_STORE_IDS).fetchone()[0]
            )
            stats.branches_deleted = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM store_branches WHERE store_id IN ({store_ph})", DELETE_STORE_IDS
                ).fetchone()[0]
            )
            stats.daily_deleted = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM product_price_daily WHERE store_id IN ({store_ph})", DELETE_STORE_IDS
                ).fetchone()[0]
            )
            stats.skus_deleted = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM store_skus WHERE store_id IN ({store_ph})", DELETE_STORE_IDS
                ).fetchone()[0]
            )
            for src_slug, dst_slug in CATEGORY_MERGE_MAP.items():
                if src_slug in slug_to_id and dst_slug in slug_to_id:
                    stats.masters_reassigned += int(
                        conn.execute(
                            "SELECT COUNT(*) FROM master_products WHERE canonical_category_id = ?",
                            (slug_to_id[src_slug],),
                        ).fetchone()[0]
                    )
                    stats.categories_deleted += 1
        else:
            sku_ids = [
                (str(r[0]),)
                for r in conn.execute(
                    f"SELECT id FROM store_skus WHERE store_id IN ({store_ph})", DELETE_STORE_IDS
                ).fetchall()
            ]
            if sku_ids:
                conn.execute("CREATE TEMP TABLE IF NOT EXISTS _tmp_del_skus (id TEXT PRIMARY KEY)")
                conn.execute("DELETE FROM _tmp_del_skus")
                conn.executemany("INSERT OR IGNORE INTO _tmp_del_skus (id) VALUES (?)", sku_ids)
                conn.execute("DELETE FROM price_records WHERE store_sku_id IN (SELECT id FROM _tmp_del_skus)")
                cur_skus = conn.execute("DELETE FROM store_skus WHERE id IN (SELECT id FROM _tmp_del_skus)")
                stats.skus_deleted = int(cur_skus.rowcount if cur_skus.rowcount != -1 else len(sku_ids))

            cur_daily = conn.execute(
                f"DELETE FROM product_price_daily WHERE store_id IN ({store_ph})", DELETE_STORE_IDS
            )
            stats.daily_deleted = int(cur_daily.rowcount if cur_daily.rowcount != -1 else 0)

            cur_br = conn.execute(
                f"DELETE FROM store_branches WHERE store_id IN ({store_ph})", DELETE_STORE_IDS
            )
            stats.branches_deleted = int(cur_br.rowcount if cur_br.rowcount != -1 else 0)

            cur_st = conn.execute(f"DELETE FROM stores WHERE id IN ({store_ph})", DELETE_STORE_IDS)
            stats.stores_deleted = int(cur_st.rowcount if cur_st.rowcount != -1 else 0)

            for src_slug, dst_slug in CATEGORY_MERGE_MAP.items():
                src_id = slug_to_id.get(src_slug)
                dst_id = slug_to_id.get(dst_slug)
                if src_id is None or dst_id is None:
                    continue
                cur_mp = conn.execute(
                    "UPDATE master_products SET canonical_category_id = ? WHERE canonical_category_id = ?",
                    (dst_id, src_id),
                )
                stats.masters_reassigned += int(cur_mp.rowcount if cur_mp.rowcount != -1 else 0)
                cur_cat = conn.execute("DELETE FROM canonical_categories WHERE id = ?", (src_id,))
                stats.categories_deleted += int(cur_cat.rowcount if cur_cat.rowcount != -1 else 0)

            conn.execute(
                "UPDATE canonical_categories SET name = 'Huevos y Derivados' WHERE slug = 'huevos-y-derivados'"
            )

            conn.commit()
            conn.execute("VACUUM;")
            conn.execute("ANALYZE;")

        stats.final_stores = int(conn.execute("SELECT COUNT(*) FROM stores").fetchone()[0])
        stats.final_categories = int(conn.execute("SELECT COUNT(*) FROM canonical_categories").fetchone()[0])
        stats.final_master_products = int(conn.execute("SELECT COUNT(*) FROM master_products").fetchone()[0])
        stats.final_store_skus = int(conn.execute("SELECT COUNT(*) FROM store_skus").fetchone()[0])
    finally:
        conn.close()

    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser(description="Elimina tiendas obsoletas y fusiona categorías heredadas.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--no-backup", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    st = apply_store_and_category_cleanup_local(
        db_path=Path(args.db),
        create_backup=not args.no_backup,
        dry_run=args.dry_run,
    )
    print(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
