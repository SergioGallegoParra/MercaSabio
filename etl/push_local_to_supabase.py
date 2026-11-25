"""Sincroniza de forma eficiente y por lotes el catálogo local optimizado hacia Supabase.

Diseñado para cuidar cuota de IO y RAM en Supabase:
  - Respalda en disco local (`etl/data/_sb_user_backup.json`) los registros de usuario/curación.
  - Desactiva temporalmente triggers pesados en `try/finally` garantizando su reactivación.
  - Limpia el catálogo anterior con `TRUNCATE price_records` y `DELETE` por tabla con `commit`.
  - Inserta `master_products`, `store_skus`, `price_records` y `product_price_daily`
    mediante `COPY` en lotes pequeños (`10,000` filas) con `commit` intermedio para no
    saturar memoria ni exceder `statement_timeout`.
  - Restaura registros de usuario y refresca `mv_admin_store_catalog` + `catalog_stats_snapshot`.

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.push_local_to_supabase --dry-run
    .\\.venv\\Scripts\\python.exe -m etl.push_local_to_supabase
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import time
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, TypeVar

import psycopg

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH

logger = logging.getLogger("etl.push_local_to_supabase")
_T = TypeVar("_T")
COPY_BATCH_SIZE = 10_000
USER_BACKUP_PATH = Path("etl/data/_sb_user_backup.json")


def _chunked(items: list[_T], size: int) -> Iterable[list[_T]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _load_database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    if os.path.exists(".env"):
        with open(".env", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL no configurado en entorno ni en .env")
    return url


def _parse_json_list(val: Any, *, default_empty: bool = False) -> list[str] | None:
    if val is None or val == "":
        return [] if default_empty else None
    if isinstance(val, list):
        return [str(x) for x in val]
    try:
        parsed = json.loads(str(val))
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
    except Exception:
        pass
    return [] if default_empty else None


@dataclass(slots=True)
class PushStats:
    stores_upserted: int = 0
    masters_copied: int = 0
    skus_copied: int = 0
    prices_copied: int = 0
    daily_copied: int = 0
    overrides_restored: int = 0
    votes_restored: int = 0
    sabiometro_restored: int = 0
    purchases_restored: int = 0


def _backup_user_rows_if_needed(cur: psycopg.Cursor[Any]) -> dict[str, list[dict[str, Any]]]:
    """Respalda tablas de usuario/curación en JSON local si aún tienen datos en Postgres."""
    tables = {
        "overrides": "SELECT * FROM public.product_curation_overrides",
        "votes": "SELECT * FROM public.product_votes",
        "sabiometro": "SELECT * FROM public.sabiometro_scores",
        "purchases": "SELECT id::text AS id, master_product_id::text AS master_product_id FROM public.purchase_events WHERE master_product_id IS NOT NULL",
    }
    snap: dict[str, list[dict[str, Any]]] = {}
    for key, query in tables.items():
        cur.execute(query)
        cols = [d.name for d in cur.description or ()]
        snap[key] = [
            {col: (val.isoformat() if hasattr(val, "isoformat") else (str(val) if isinstance(val, Decimal) else val)) for col, val in zip(cols, row)}
            for row in cur.fetchall()
        ]

    # Solo sobrescribir el respaldo si Postgres aún tiene registros (protege ante reintentos tras borrado)
    total_live = sum(len(v) for v in snap.values())
    if total_live > 0 or not USER_BACKUP_PATH.exists():
        USER_BACKUP_PATH.write_text(json.dumps(snap, ensure_ascii=False, default=str), encoding="utf-8")
        logger.info("Respaldo de tablas de usuario guardado (%s registros totales).", total_live)
        return snap

    logger.info("Cargando respaldo previo desde %s.", USER_BACKUP_PATH)
    return json.loads(USER_BACKUP_PATH.read_text(encoding="utf-8"))


def push_local_to_supabase(
    *,
    local_db_path: Path = DEFAULT_LOCAL_DB_PATH,
    dry_run: bool = False,
) -> PushStats:
    if not local_db_path.exists():
        raise FileNotFoundError(f"No existe la base local: {local_db_path}")

    db_url = _load_database_url()
    stats = PushStats()

    lc = sqlite3.connect(local_db_path)
    lc.row_factory = sqlite3.Row
    try:
        stores = lc.execute(
            "SELECT id, name, channel_type, markup_discount_factor, COALESCE(updated_at, CURRENT_TIMESTAMP) AS updated_at FROM stores"
        ).fetchall()
        lc_mp_cols = {str(r[1]) for r in lc.execute("PRAGMA table_info(master_products)").fetchall()}
        has_v3_cols = {"product_group_key", "variant_core", "clean_canonical_name", "canonical_search_text"} <= lc_mp_cols
        v3_select = (
            "product_group_key, variant_core, clean_canonical_name, canonical_search_text"
            if has_v3_cols
            else "NULL AS product_group_key, NULL AS variant_core, NULL AS clean_canonical_name, NULL AS canonical_search_text"
        )
        masters = lc.execute(
            f"""
            SELECT id, ean, canonical_category_id, normalized_name, brand, net_content, unit_measure,
                   is_private_label, image_url, created_at, invima_registry, actual_manufacturer,
                   COALESCE(positive_votes, 0) AS positive_votes,
                   COALESCE(total_votes, 0) AS total_votes,
                   COALESCE(avg_yield_factor, '1.0000') AS avg_yield_factor,
                   shrinkflation_alert, previous_net_content, product_type, sub_presentation,
                   sub_presentation_label, {v3_select}
            FROM master_products
            """
        ).fetchall()
        has_sub_table = bool(
            lc.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='substitution_groups'"
            ).fetchone()
        )
        sub_groups = (
            lc.execute(
                "SELECT product_type, substitution_group, impact_tier, yield_factor FROM substitution_groups"
            ).fetchall()
            if has_sub_table
            else []
        )
        skus = lc.execute(
            """
            SELECT id, store_id, master_product_id, external_sku, raw_name, raw_url, last_verified_at,
                   is_mercado, available_cities_json, display_name, product_type, sub_presentation,
                   sub_presentation_label, variant_tags_json, is_deprecated_candidate, deprecated_reason,
                   rappi_promo_price, rappi_savings_cop, rappi_savings_pct, rappi_promo_url, rappi_promo_updated_at
            FROM store_skus
            """
        ).fetchall()
        prices = lc.execute(
            """
            SELECT store_sku_id, raw_list_price, raw_sale_price, calibrated_price,
                   pum_price, in_stock, source_origin, captured_at
            FROM price_records
            ORDER BY id ASC
            """
        ).fetchall()
        daily = lc.execute(
            """
            SELECT master_product_id, store_id, day, min_price, median_price, samples_count
            FROM product_price_daily
            """
        ).fetchall()
    finally:
        lc.close()

    stats.stores_upserted = len(stores)
    stats.masters_copied = len(masters)
    stats.skus_copied = len(skus)
    stats.prices_copied = len(prices)
    stats.daily_copied = len(daily)

    if dry_run:
        return stats

    with psycopg.connect(db_url) as pg:
        with pg.cursor() as cur:
            # 1. Upsert tiendas
            cur.executemany(
                """
                INSERT INTO public.stores (id, name, channel_type, markup_discount_factor, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    channel_type = EXCLUDED.channel_type,
                    markup_discount_factor = EXCLUDED.markup_discount_factor,
                    updated_at = EXCLUDED.updated_at
                """,
                [
                    (
                        str(r["id"]),
                        str(r["name"]),
                        str(r["channel_type"]),
                        Decimal(str(r["markup_discount_factor"])),
                        r["updated_at"],
                    )
                    for r in stores
                ],
            )
            user_backup = _backup_user_rows_if_needed(cur)
        pg.commit()

        try:
            with pg.cursor() as cur:
                cur.execute("ALTER TABLE public.store_skus DISABLE TRIGGER trg_store_skus_sync_is_mercado")
                cur.execute("ALTER TABLE public.price_records DISABLE TRIGGER trg_price_records_stats_snapshot")
                cur.execute("ALTER TABLE public.product_votes DISABLE TRIGGER USER")
            pg.commit()

            # 2. Limpiar catálogo anterior en pasos pequeños y rápidos
            for stmt in (
                "TRUNCATE TABLE public.price_records RESTART IDENTITY",
                "DELETE FROM public.product_price_daily",
                "DELETE FROM public.store_skus",
                "DELETE FROM public.master_products",
            ):
                with pg.cursor() as cur:
                    cur.execute("SET LOCAL statement_timeout = '180s'")
                    cur.execute(stmt)
                pg.commit()
                logger.info("Limpieza ejecutada: %s", stmt)

            # 3. COPY por lotes de 10,000 filas (bajo uso de RAM e IO estable)
            for idx, chunk in enumerate(_chunked(masters, COPY_BATCH_SIZE), start=1):
                with pg.cursor() as cur:
                    cur.execute("SET LOCAL statement_timeout = '120s'")
                    with cur.copy(
                        """
                        COPY public.master_products (
                            id, ean, canonical_category_id, normalized_name, brand, net_content, unit_measure,
                            is_private_label, image_url, created_at, invima_registry, actual_manufacturer,
                            positive_votes, total_votes, avg_yield_factor, shrinkflation_alert,
                            previous_net_content, product_type, sub_presentation, sub_presentation_label,
                            product_group_key, variant_core, clean_canonical_name, canonical_search_text
                        ) FROM STDIN
                        """
                    ) as copy:
                        for r in chunk:
                            copy.write_row(
                                (
                                    r["id"],
                                    r["ean"],
                                    r["canonical_category_id"],
                                    r["normalized_name"],
                                    r["brand"],
                                    Decimal(str(r["net_content"])),
                                    r["unit_measure"],
                                    bool(r["is_private_label"]),
                                    r["image_url"],
                                    r["created_at"],
                                    r["invima_registry"],
                                    r["actual_manufacturer"],
                                    int(r["positive_votes"]),
                                    int(r["total_votes"]),
                                    Decimal(str(r["avg_yield_factor"])),
                                    bool(r["shrinkflation_alert"]),
                                    Decimal(str(r["previous_net_content"])) if r["previous_net_content"] is not None else None,
                                    str(r["product_type"])[:80] if r["product_type"] else None,
                                    str(r["sub_presentation"])[:80] if r["sub_presentation"] else None,
                                    str(r["sub_presentation_label"])[:100] if r["sub_presentation_label"] else None,
                                    str(r["product_group_key"])[:160] if r["product_group_key"] else None,
                                    str(r["variant_core"])[:80] if r["variant_core"] else None,
                                    str(r["clean_canonical_name"])[:255] if r["clean_canonical_name"] else None,
                                    r["canonical_search_text"],
                                )
                            )
                pg.commit()
                time.sleep(0.15)
            logger.info("master_products cargados: %s", len(masters))

            for idx, chunk in enumerate(_chunked(skus, COPY_BATCH_SIZE), start=1):
                with pg.cursor() as cur:
                    cur.execute("SET LOCAL statement_timeout = '120s'")
                    with cur.copy(
                        """
                        COPY public.store_skus (
                            id, store_id, master_product_id, external_sku, raw_name, raw_url, last_verified_at,
                            is_mercado, available_cities, display_name, product_type, sub_presentation,
                            sub_presentation_label, variant_tags, is_deprecated_candidate, deprecated_reason,
                            rappi_promo_price, rappi_savings_cop, rappi_savings_pct, rappi_promo_url, rappi_promo_updated_at
                        ) FROM STDIN
                        """
                    ) as copy:
                        for r in chunk:
                            copy.write_row(
                                (
                                    r["id"],
                                    r["store_id"],
                                    r["master_product_id"],
                                    r["external_sku"],
                                    r["raw_name"],
                                    r["raw_url"],
                                    r["last_verified_at"],
                                    bool(r["is_mercado"]),
                                    _parse_json_list(r["available_cities_json"], default_empty=False),
                                    r["display_name"],
                                    r["product_type"],
                                    r["sub_presentation"],
                                    r["sub_presentation_label"],
                                    _parse_json_list(r["variant_tags_json"], default_empty=True),
                                    bool(r["is_deprecated_candidate"]),
                                    r["deprecated_reason"],
                                    Decimal(str(r["rappi_promo_price"])) if r["rappi_promo_price"] is not None else None,
                                    Decimal(str(r["rappi_savings_cop"])) if r["rappi_savings_cop"] is not None else None,
                                    Decimal(str(r["rappi_savings_pct"])) if r["rappi_savings_pct"] is not None else None,
                                    r["rappi_promo_url"],
                                    r["rappi_promo_updated_at"],
                                )
                            )
                pg.commit()
                time.sleep(0.15)
            logger.info("store_skus cargados: %s", len(skus))

            for idx, chunk in enumerate(_chunked(prices, COPY_BATCH_SIZE), start=1):
                with pg.cursor() as cur:
                    cur.execute("SET LOCAL statement_timeout = '120s'")
                    with cur.copy(
                        """
                        COPY public.price_records (
                            store_sku_id, raw_list_price, raw_sale_price, calibrated_price,
                            pum_price, in_stock, source_origin, captured_at
                        ) FROM STDIN
                        """
                    ) as copy:
                        for r in chunk:
                            copy.write_row(
                                (
                                    r["store_sku_id"],
                                    Decimal(str(r["raw_list_price"])),
                                    Decimal(str(r["raw_sale_price"])),
                                    Decimal(str(r["calibrated_price"])),
                                    Decimal(str(r["pum_price"])),
                                    bool(r["in_stock"]),
                                    r["source_origin"],
                                    r["captured_at"],
                                )
                            )
                pg.commit()
                time.sleep(0.15)
            logger.info("price_records cargados: %s", len(prices))

            for idx, chunk in enumerate(_chunked(daily, COPY_BATCH_SIZE), start=1):
                with pg.cursor() as cur:
                    cur.execute("SET LOCAL statement_timeout = '120s'")
                    with cur.copy(
                        """
                        COPY public.product_price_daily (
                            master_product_id, store_id, day, min_price, median_price, samples_count
                        ) FROM STDIN
                        """
                    ) as copy:
                        for r in chunk:
                            copy.write_row(
                                (
                                    r["master_product_id"],
                                    r["store_id"],
                                    r["day"],
                                    Decimal(str(r["min_price"])),
                                    Decimal(str(r["median_price"])),
                                    int(r["samples_count"]),
                                )
                            )
                pg.commit()
                time.sleep(0.1)
            logger.info("product_price_daily cargados: %s", len(daily))

            if sub_groups:
                with pg.cursor() as cur:
                    cur.execute("DELETE FROM public.substitution_groups")
                    cur.executemany(
                        """
                        INSERT INTO public.substitution_groups (
                            product_type, substitution_group, impact_tier, yield_factor
                        ) VALUES (%s, %s, %s, %s)
                        ON CONFLICT (product_type) DO UPDATE SET
                            substitution_group = EXCLUDED.substitution_group,
                            impact_tier = EXCLUDED.impact_tier,
                            yield_factor = EXCLUDED.yield_factor
                        """,
                        [
                            (
                                str(r["product_type"])[:80],
                                str(r["substitution_group"])[:80],
                                str(r["impact_tier"])[:20],
                                Decimal(str(r["yield_factor"])),
                            )
                            for r in sub_groups
                        ],
                    )
                pg.commit()
                logger.info("substitution_groups sincronizados: %s", len(sub_groups))

            # 4. Restaurar registros de usuario/curación
            with pg.cursor() as cur:
                for row in user_backup.get("overrides", []):
                    cur.execute(
                        """
                        INSERT INTO public.product_curation_overrides (
                            store_sku_id, master_product_id, override_subtype, override_broad_family,
                            override_quality_tier, review_status, doubt_reason, admin_notes, updated_at
                        )
                        SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s
                        WHERE EXISTS (SELECT 1 FROM public.store_skus s WHERE s.id = %s)
                        ON CONFLICT (store_sku_id) DO NOTHING
                        """,
                        (
                            row["store_sku_id"],
                            row.get("master_product_id"),
                            row.get("override_subtype"),
                            row.get("override_broad_family"),
                            row.get("override_quality_tier"),
                            row.get("review_status"),
                            row.get("doubt_reason"),
                            row.get("admin_notes"),
                            row.get("updated_at"),
                            row["store_sku_id"],
                        ),
                    )
                    stats.overrides_restored += cur.rowcount

                for row in user_backup.get("votes", []):
                    cur.execute(
                        """
                        INSERT INTO public.product_votes (
                            id, workspace_id, user_id, master_product_id, satisfaction,
                            yield_factor, comment, verified_purchase_id, created_at, updated_at
                        )
                        SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                        WHERE EXISTS (SELECT 1 FROM public.master_products m WHERE m.id = %s)
                        ON CONFLICT DO NOTHING
                        """,
                        (
                            row["id"],
                            row.get("workspace_id"),
                            row.get("user_id"),
                            row["master_product_id"],
                            row["satisfaction"],
                            row.get("yield_factor", "1.0"),
                            row.get("comment"),
                            row.get("verified_purchase_id"),
                            row.get("created_at"),
                            row.get("updated_at"),
                            row["master_product_id"],
                        ),
                    )
                    stats.votes_restored += cur.rowcount

                for row in user_backup.get("sabiometro", []):
                    cur.execute(
                        """
                        INSERT INTO public.sabiometro_scores (
                            master_product_id, vote_mass, p_hat, r_bad, f_yield, wilson_lower,
                            value_index, status, consensus_label, support_label, votes_count,
                            under_review, frozen_at, computed_at
                        )
                        SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                        WHERE EXISTS (SELECT 1 FROM public.master_products m WHERE m.id = %s)
                        ON CONFLICT (master_product_id) DO NOTHING
                        """,
                        (
                            row["master_product_id"],
                            row["vote_mass"],
                            row.get("p_hat"),
                            row.get("r_bad"),
                            row.get("f_yield"),
                            row.get("wilson_lower"),
                            row.get("value_index"),
                            row["status"],
                            row["consensus_label"],
                            row.get("support_label"),
                            row.get("votes_count", 0),
                            row.get("under_review", False),
                            row.get("frozen_at"),
                            row["computed_at"],
                            row["master_product_id"],
                        ),
                    )
                    stats.sabiometro_restored += cur.rowcount

                for row in user_backup.get("purchases", []):
                    cur.execute(
                        """
                        UPDATE public.purchase_events
                        SET master_product_id = %s
                        WHERE id = %s
                          AND EXISTS (SELECT 1 FROM public.master_products m WHERE m.id = %s)
                        """,
                        (row["master_product_id"], row["id"], row["master_product_id"]),
                    )
                    stats.purchases_restored += cur.rowcount
            pg.commit()
        finally:
            # Siempre reactivar triggers incluso ante cualquier error intermedio
            pg.rollback()
            with pg.cursor() as cur:
                cur.execute("ALTER TABLE public.store_skus ENABLE TRIGGER trg_store_skus_sync_is_mercado")
                cur.execute("ALTER TABLE public.price_records ENABLE TRIGGER trg_price_records_stats_snapshot")
                cur.execute("ALTER TABLE public.product_votes ENABLE TRIGGER USER")
            pg.commit()

        # 5. Refrescar métricas cacheadas
        with pg.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = '120s'")
            cur.execute("SELECT public.refresh_catalog_stats_snapshot(0)")
        pg.commit()

    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser(description="Sube el catálogo optimizado local hacia Supabase.")
    parser.add_argument("--local-db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    st = push_local_to_supabase(local_db_path=Path(args.local_db), dry_run=args.dry_run)
    print(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
