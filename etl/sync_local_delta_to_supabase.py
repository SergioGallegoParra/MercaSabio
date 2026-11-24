"""Sincroniza el delta exacto entre `etl/data/local_staging.db` y Supabase.

Evita re-subir todo el catálogo (`152k` SKUs / `185k` precios): calcula el diff
exacto contra Postgres y aplica únicamente:
  - Purga de `price_records`, `store_skus`, `product_price_daily` y `master_products` eliminados en local
  - Actualización de `master_products.canonical_category_id` modificados (reclasificaciones + fusión de categorías)
  - Actualización/eliminación de `canonical_categories` y `stores` (`store_branches`, etc.)
  - Refresco final de `public.refresh_catalog_stats_snapshot(0)`

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.sync_local_delta_to_supabase --dry-run
    .\\.venv\\Scripts\\python.exe -m etl.sync_local_delta_to_supabase
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import psycopg

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.push_local_to_supabase import _load_database_url

logger = logging.getLogger("etl.sync_local_delta_to_supabase")


@dataclass(slots=True)
class DeltaSyncStats:
    skus_to_delete: int = 0
    masters_to_delete: int = 0
    masters_to_recategorize: int = 0
    categories_to_delete: int = 0
    categories_to_rename: int = 0
    stores_to_delete: int = 0
    final_stores: int = 0
    final_categories: int = 0
    final_master_products: int = 0
    final_store_skus: int = 0
    final_price_records: int = 0


def sync_local_delta_to_supabase(
    *,
    local_db_path: Path = DEFAULT_LOCAL_DB_PATH,
    dry_run: bool = False,
) -> DeltaSyncStats:
    if not local_db_path.exists():
        raise FileNotFoundError(f"No existe la base local: {local_db_path}")

    lc = sqlite3.connect(local_db_path)
    try:
        local_stores = {str(r[0]) for r in lc.execute("SELECT id FROM stores").fetchall()}
        local_cats = {
            int(r[0]): (str(r[1]), str(r[2]))
            for r in lc.execute("SELECT id, slug, name FROM canonical_categories").fetchall()
        }
        local_masters = {
            str(r[0]): r[1]
            for r in lc.execute("SELECT id, canonical_category_id FROM master_products").fetchall()
        }
        local_skus = {str(r[0]) for r in lc.execute("SELECT id FROM store_skus").fetchall()}
    finally:
        lc.close()

    stats = DeltaSyncStats()
    db_url = _load_database_url()

    with psycopg.connect(db_url) as pg:
        with pg.cursor() as cur:
            cur.execute("SELECT id FROM public.stores")
            pg_stores = {str(r[0]) for r in cur.fetchall()}

            cur.execute("SELECT id, slug, name FROM public.canonical_categories")
            pg_cats = {int(r[0]): (str(r[1]), str(r[2])) for r in cur.fetchall()}

            cur.execute("SELECT id::text, canonical_category_id FROM public.master_products")
            pg_masters = {str(r[0]): r[1] for r in cur.fetchall()}

            cur.execute("SELECT id::text FROM public.store_skus")
            pg_skus = {str(r[0]) for r in cur.fetchall()}

        del_store_ids = sorted(pg_stores - local_stores)
        del_cat_ids = sorted(set(pg_cats) - set(local_cats))
        rename_cats = [
            (local_cats[cid][1], cid)
            for cid in local_cats
            if cid in pg_cats and pg_cats[cid][1] != local_cats[cid][1]
        ]
        del_sku_ids = sorted(pg_skus - local_skus)
        del_master_ids = sorted(set(pg_masters) - set(local_masters))
        recat_masters = [
            (local_cat_id, mid)
            for mid, local_cat_id in local_masters.items()
            if mid in pg_masters and pg_masters[mid] != local_cat_id
        ]

        stats.skus_to_delete = len(del_sku_ids)
        stats.masters_to_delete = len(del_master_ids)
        stats.masters_to_recategorize = len(recat_masters)
        stats.categories_to_delete = len(del_cat_ids)
        stats.categories_to_rename = len(rename_cats)
        stats.stores_to_delete = len(del_store_ids)

        if not dry_run:
            try:
                with pg.cursor() as cur:
                    cur.execute("ALTER TABLE public.store_skus DISABLE TRIGGER trg_store_skus_sync_is_mercado")
                    cur.execute("ALTER TABLE public.price_records DISABLE TRIGGER trg_price_records_stats_snapshot")
                pg.commit()

                if del_sku_ids:
                    with pg.cursor() as cur:
                        cur.execute("SET LOCAL statement_timeout = '120s'")
                        cur.execute(
                            "DELETE FROM public.price_records WHERE store_sku_id = ANY(%s::uuid[])",
                            (del_sku_ids,),
                        )
                        cur.execute(
                            "DELETE FROM public.product_curation_overrides WHERE store_sku_id = ANY(%s::uuid[])",
                            (del_sku_ids,),
                        )
                        cur.execute(
                            "DELETE FROM public.store_skus WHERE id = ANY(%s::uuid[])",
                            (del_sku_ids,),
                        )
                    pg.commit()
                    logger.info("SKUs y precios eliminados en Supabase: %d", len(del_sku_ids))

                if del_master_ids:
                    with pg.cursor() as cur:
                        cur.execute("SET LOCAL statement_timeout = '120s'")
                        cur.execute(
                            "DELETE FROM public.product_price_daily WHERE master_product_id = ANY(%s::uuid[])",
                            (del_master_ids,),
                        )
                        cur.execute(
                            "UPDATE public.purchase_events SET master_product_id = NULL WHERE master_product_id = ANY(%s::uuid[])",
                            (del_master_ids,),
                        )
                        cur.execute(
                            "DELETE FROM public.master_products WHERE id = ANY(%s::uuid[])",
                            (del_master_ids,),
                        )
                    pg.commit()
                    logger.info("Maestros eliminados en Supabase: %d", len(del_master_ids))

                if recat_masters:
                    with pg.cursor() as cur:
                        cur.execute("SET LOCAL statement_timeout = '120s'")
                        cur.executemany(
                            "UPDATE public.master_products SET canonical_category_id = %s WHERE id = %s::uuid",
                            recat_masters,
                        )
                    pg.commit()
                    logger.info("Maestros recategorizados en Supabase: %d", len(recat_masters))

                if rename_cats:
                    with pg.cursor() as cur:
                        cur.executemany(
                            "UPDATE public.canonical_categories SET name = %s WHERE id = %s",
                            rename_cats,
                        )
                    pg.commit()

                if del_cat_ids:
                    with pg.cursor() as cur:
                        cur.execute(
                            "DELETE FROM public.canonical_categories WHERE id = ANY(%s::int[])",
                            (del_cat_ids,),
                        )
                    pg.commit()
                    logger.info("Categorías eliminadas en Supabase: %d", len(del_cat_ids))

                if del_store_ids:
                    with pg.cursor() as cur:
                        cur.execute("SET LOCAL statement_timeout = '120s'")
                        cur.execute(
                            "DELETE FROM public.bank_promotions WHERE store_id = ANY(%s::text[])",
                            (del_store_ids,),
                        )
                        cur.execute(
                            "DELETE FROM public.payment_promotions WHERE store_id = ANY(%s::text[])",
                            (del_store_ids,),
                        )
                        cur.execute(
                            "DELETE FROM public.product_price_daily WHERE store_id = ANY(%s::text[])",
                            (del_store_ids,),
                        )
                        cur.execute(
                            "DELETE FROM public.store_branches WHERE store_id = ANY(%s::text[])",
                            (del_store_ids,),
                        )
                        cur.execute(
                            "DELETE FROM public.stores WHERE id = ANY(%s::text[])",
                            (del_store_ids,),
                        )
                    pg.commit()
                    logger.info("Tiendas eliminadas en Supabase: %s", del_store_ids)
            finally:
                pg.rollback()
                with pg.cursor() as cur:
                    cur.execute("ALTER TABLE public.store_skus ENABLE TRIGGER trg_store_skus_sync_is_mercado")
                    cur.execute("ALTER TABLE public.price_records ENABLE TRIGGER trg_price_records_stats_snapshot")
                pg.commit()

            with pg.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = '120s'")
                cur.execute("SELECT public.refresh_catalog_stats_snapshot(0)")
            pg.commit()

        with pg.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM public.stores")
            stats.final_stores = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM public.canonical_categories")
            stats.final_categories = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM public.master_products")
            stats.final_master_products = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM public.store_skus")
            stats.final_store_skus = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM public.price_records")
            stats.final_price_records = int(cur.fetchone()[0])

    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser(description="Sincroniza el delta local hacia Supabase.")
    parser.add_argument("--local-db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    st = sync_local_delta_to_supabase(local_db_path=Path(args.local_db), dry_run=args.dry_run)
    print(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
