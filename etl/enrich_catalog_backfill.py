r"""Backfill masivo determinista para categorizar SKUs, simplificar nombres y poblar subpresentaciones.

Ejecuta sobre toda la base Postgres por lotes de 10.000 filas (para evitar statement_timeout):
1. Asigna `canonical_category_id` a `master_products` que están en NULL (conservando las 10 canastas estrictas
   y completando con las ~27 categorías de pasillo de supermercado).
2. Simplifica y homogeneiza `store_skus.display_name` (sin repetir gramajes ya capturados ni colas VTEX duplicadas,
   en Title Case inteligente en español).
3. Pobla `product_type`, `sub_presentation`, `sub_presentation_label` y `variant_tags` en `store_skus` y
   `master_products`.
4. Refresca `public.mv_admin_store_catalog`.

Uso:
    .\.venv\Scripts\python.exe -m etl.enrich_catalog_backfill
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
from collections import Counter
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Sequence, TypeVar

import psycopg

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.models import UnitMeasure
from etl.core.product_enrichment import (
    extract_product_metadata,
    infer_broad_category_slug,
    simplify_display_name,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("etl.enrich_catalog_backfill")

T = TypeVar("T")
BATCH_SIZE = 10_000


def _chunks(items: list[T], size: int) -> list[list[T]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _load_env_database_url() -> str:
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
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL no configurado en .env o entorno")
    return db_url


def _compute_enrichment_plan(
    rows: Iterable[tuple[Any, ...]],
    cat_id_by_slug: dict[str, int],
) -> tuple[
    list[tuple[str, str, str | None, str | None, str | None, list[str]]],
    list[tuple[str, int]],
    list[tuple[str, str | None, str | None, str | None]],
    dict[str, int],
]:
    """Calcula lotes deterministas de enriquecimiento compartidos entre Postgres y SQLite."""
    sku_updates: list[tuple[str, str, str | None, str | None, str | None, list[str]]] = []
    master_cat_votes: dict[str, Counter[int]] = {}
    master_meta_votes: dict[str, tuple[str | None, str | None, str | None]] = {}

    before_master_cats: set[str] = set()
    all_masters: set[str] = set()
    mercado_total = 0
    mercado_cat_after = 0
    subpres_matched = 0

    for (
        sku_id,
        master_id,
        raw_name,
        norm_name,
        brand,
        net_content,
        unit_measure,
        is_private_label,
        existing_cat_id,
        is_mercado,
    ) in rows:
        all_masters.add(master_id)
        if existing_cat_id is not None:
            before_master_cats.add(master_id)

        unit_enum = (
            UnitMeasure(unit_measure)
            if unit_measure in ("g", "ml", "und")
            else UnitMeasure.UND
        )
        content_dec = Decimal(str(net_content)) if net_content is not None else Decimal("1")

        disp = simplify_display_name(
            raw_name,
            brand=brand,
            net_content=content_dec,
            unit_measure=unit_enum,
        )
        meta = extract_product_metadata(
            raw_name,
            norm_name,
            is_private_label=bool(is_private_label),
        )
        if meta.sub_presentation is not None:
            subpres_matched += 1

        sku_updates.append(
            (
                sku_id,
                disp,
                meta.product_type,
                meta.sub_presentation,
                meta.sub_presentation_label,
                list(meta.variant_tags),
            )
        )

        if meta.sub_presentation is not None and master_id not in master_meta_votes:
            master_meta_votes[master_id] = (
                meta.product_type,
                meta.sub_presentation,
                meta.sub_presentation_label,
            )

        inferred_cat_id: int | None = existing_cat_id
        if inferred_cat_id is None and bool(is_mercado):
            slug = infer_broad_category_slug(norm_name or raw_name, content_dec, unit_enum)
            if slug and slug in cat_id_by_slug:
                inferred_cat_id = cat_id_by_slug[slug]

        if inferred_cat_id is not None and existing_cat_id is None:
            master_cat_votes.setdefault(master_id, Counter())[inferred_cat_id] += 1

        if bool(is_mercado):
            mercado_total += 1
            if existing_cat_id is not None or (
                master_id in master_cat_votes and len(master_cat_votes[master_id]) > 0
            ):
                mercado_cat_after += 1

    master_cat_updates: list[tuple[str, int]] = [
        (mid, votes.most_common(1)[0][0])
        for mid, votes in master_cat_votes.items()
        if votes
    ]
    master_meta_list: list[tuple[str, str | None, str | None, str | None]] = [
        (mid, pt, sp, spl) for mid, (pt, sp, spl) in master_meta_votes.items()
    ]

    logger.info(
        "Masters con categoría: antes=%d / %d -> nuevos asignados=+%d (total=%d)",
        len(before_master_cats),
        len(all_masters),
        len(master_cat_updates),
        len(before_master_cats) + len(master_cat_updates),
    )
    logger.info(
        "SKUs is_mercado categorizados estimados: %d / %d (%.1f%%) | con subpresentación=%d",
        mercado_cat_after,
        mercado_total,
        (mercado_cat_after / mercado_total * 100.0) if mercado_total else 0.0,
        subpres_matched,
    )
    stats = {
        "total_skus": len(sku_updates),
        "masters_categorized_added": len(master_cat_updates),
        "subpresentations_tagged": subpres_matched,
    }
    return sku_updates, master_cat_updates, master_meta_list, stats


def run_backfill(*, dry_run: bool = False) -> dict[str, int]:
    db_url = _load_env_database_url()

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = 0")
            cur.execute("SELECT slug, id FROM public.canonical_categories")
            cat_id_by_slug = {slug: cid for slug, cid in cur.fetchall()}

            cur.execute(
                """
                SELECT
                    ss.id::text,
                    ss.master_product_id::text,
                    ss.raw_name,
                    mp.normalized_name,
                    mp.brand,
                    mp.net_content,
                    mp.unit_measure,
                    mp.is_private_label,
                    mp.canonical_category_id,
                    ss.is_mercado
                FROM public.store_skus ss
                JOIN public.master_products mp ON mp.id = ss.master_product_id
                """
            )
            rows = cur.fetchall()
            logger.info("SKUs cargados desde Postgres: %d", len(rows))

        sku_updates, master_cat_updates, master_meta_list, dry_stats = _compute_enrichment_plan(
            rows, cat_id_by_slug
        )

        if dry_run:
            return dry_stats

        conn.rollback()

        total_sku_updated = 0
        sku_batches = _chunks(sku_updates, BATCH_SIZE)
        for idx, batch in enumerate(sku_batches, start=1):
            with conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = 0")
                cur.execute(
                    """
                    CREATE TEMP TABLE tmp_sku_enrichment (
                        id UUID PRIMARY KEY,
                        display_name VARCHAR(255),
                        product_type VARCHAR(80),
                        sub_presentation VARCHAR(80),
                        sub_presentation_label VARCHAR(100),
                        variant_tags TEXT[]
                    ) ON COMMIT DROP
                    """
                )
                with cur.copy(
                    "COPY tmp_sku_enrichment (id, display_name, product_type, sub_presentation, sub_presentation_label, variant_tags) FROM STDIN"
                ) as copy:
                    for rec in batch:
                        copy.write_row(rec)

                cur.execute(
                    """
                    UPDATE public.store_skus ss
                    SET
                        display_name = tmp.display_name,
                        product_type = tmp.product_type,
                        sub_presentation = tmp.sub_presentation,
                        sub_presentation_label = tmp.sub_presentation_label,
                        variant_tags = tmp.variant_tags
                    FROM tmp_sku_enrichment tmp
                    WHERE ss.id = tmp.id
                    """
                )
                total_sku_updated += cur.rowcount
            conn.commit()
            if idx % 3 == 0 or idx == len(sku_batches):
                logger.info("store_skus lote %d/%d (%d filas actualizadas)", idx, len(sku_batches), total_sku_updated)

        total_master_cat = 0
        for batch in _chunks(master_cat_updates, BATCH_SIZE):
            with conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = 0")
                cur.execute(
                    """
                    CREATE TEMP TABLE tmp_master_cat_enrichment (
                        id UUID PRIMARY KEY,
                        canonical_category_id INT NOT NULL
                    ) ON COMMIT DROP
                    """
                )
                with cur.copy(
                    "COPY tmp_master_cat_enrichment (id, canonical_category_id) FROM STDIN"
                ) as copy:
                    for mid, cid in batch:
                        copy.write_row((mid, cid))

                cur.execute(
                    """
                    UPDATE public.master_products mp
                    SET canonical_category_id = tmp.canonical_category_id
                    FROM tmp_master_cat_enrichment tmp
                    WHERE mp.id = tmp.id
                      AND mp.canonical_category_id IS NULL
                    """
                )
                total_master_cat += cur.rowcount
            conn.commit()
        logger.info("master_products categorizados actualizados: %d", total_master_cat)

        total_master_meta = 0
        for batch in _chunks(master_meta_list, BATCH_SIZE):
            with conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = 0")
                cur.execute(
                    """
                    CREATE TEMP TABLE tmp_master_meta_enrichment (
                        id UUID PRIMARY KEY,
                        product_type VARCHAR(80),
                        sub_presentation VARCHAR(80),
                        sub_presentation_label VARCHAR(100)
                    ) ON COMMIT DROP
                    """
                )
                with cur.copy(
                    "COPY tmp_master_meta_enrichment (id, product_type, sub_presentation, sub_presentation_label) FROM STDIN"
                ) as copy:
                    for row in batch:
                        copy.write_row(row)

                cur.execute(
                    """
                    UPDATE public.master_products mp
                    SET
                        product_type = COALESCE(mp.product_type, tmp.product_type),
                        sub_presentation = COALESCE(mp.sub_presentation, tmp.sub_presentation),
                        sub_presentation_label = COALESCE(mp.sub_presentation_label, tmp.sub_presentation_label)
                    FROM tmp_master_meta_enrichment tmp
                    WHERE mp.id = tmp.id
                    """
                )
                total_master_meta += cur.rowcount
            conn.commit()
        logger.info("master_products subpresentación actualizados: %d", total_master_meta)

        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = 0")
            cur.execute("ANALYZE public.store_skus; ANALYZE public.master_products;")
        conn.commit()

    return {
        "total_skus": total_sku_updated,
        "masters_categorized_added": total_master_cat,
        "subpresentations_tagged": dry_stats["subpresentations_tagged"],
    }


def run_local_backfill(
    db_path: Path | str = DEFAULT_LOCAL_DB_PATH,
    *,
    dry_run: bool = False,
) -> dict[str, int]:
    """Ejecuta el backfill determinista en SQLite local (0 IO en Supabase)."""
    conn = sqlite3.connect(Path(db_path))
    try:
        cur = conn.cursor()
        cat_id_by_slug = {
            str(slug): int(cid)
            for cid, slug in cur.execute("SELECT id, slug FROM canonical_categories").fetchall()
        }
        rows = cur.execute(
            """
            SELECT
                ss.id,
                ss.master_product_id,
                ss.raw_name,
                mp.normalized_name,
                mp.brand,
                mp.net_content,
                mp.unit_measure,
                mp.is_private_label,
                mp.canonical_category_id,
                1 AS is_mercado
            FROM store_skus ss
            JOIN master_products mp ON mp.id = ss.master_product_id
            """
        ).fetchall()
        logger.info("SKUs cargados desde SQLite local: %d", len(rows))

        sku_updates, master_cat_updates, master_meta_list, stats = _compute_enrichment_plan(
            rows, cat_id_by_slug
        )
        if dry_run:
            return stats

        cur.executemany(
            """
            UPDATE store_skus
            SET
                display_name = ?,
                product_type = ?,
                sub_presentation = ?,
                sub_presentation_label = ?,
                variant_tags_json = ?
            WHERE id = ?
            """,
            [
                (
                    disp,
                    pt,
                    sp,
                    spl,
                    json.dumps(vtags, ensure_ascii=False) if vtags else None,
                    sku_id,
                )
                for sku_id, disp, pt, sp, spl, vtags in sku_updates
            ],
        )
        cur.executemany(
            """
            UPDATE master_products
            SET canonical_category_id = ?
            WHERE id = ? AND canonical_category_id IS NULL
            """,
            [(cid, mid) for mid, cid in master_cat_updates],
        )
        cur.executemany(
            """
            UPDATE master_products
            SET
                product_type = COALESCE(product_type, ?),
                sub_presentation = COALESCE(sub_presentation, ?),
                sub_presentation_label = COALESCE(sub_presentation_label, ?)
            WHERE id = ?
            """,
            [(pt, sp, spl, mid) for mid, pt, sp, spl in master_meta_list],
        )
        conn.commit()
        return stats
    finally:
        conn.close()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill determinista de categorías y nombres.")
    parser.add_argument("--local", action="store_true", help="Ejecuta sobre SQLite local (0 IO Supabase).")
    parser.add_argument("--local-db", default=str(DEFAULT_LOCAL_DB_PATH), help="Ruta de SQLite local.")
    parser.add_argument("--dry-run", action="store_true", help="Simula sin persistir cambios.")
    args = parser.parse_args(argv)
    if args.local:
        summary = run_local_backfill(args.local_db, dry_run=args.dry_run)
    else:
        summary = run_backfill(dry_run=args.dry_run)
    print("Backfill summary:", summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
