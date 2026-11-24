"""Consolida `supabase_snapshot.db` + `local_staging.db`, purga basura/duplicados, enriquece y compacta en local."""

from __future__ import annotations

import argparse
import json
import logging
import re
import shutil
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from etl.core.canonical_mapper import CANONICAL_RULES, is_store_private_label
from etl.core.grocery_filter import is_mercado_product
from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.match_safety import (
    brands_compatible,
    build_known_brands_vocab,
    extract_product_signature,
    normalize_brand,
    signatures_compatible,
    strip_accents_lower,
)
from etl.core.normalizer import normalize_product_name
from etl.core.product_enrichment import extract_product_metadata
from etl.enrich_catalog_backfill import run_local_backfill

logger = logging.getLogger("etl.consolidate_local_db")

DEFAULT_SUPABASE_SNAPSHOT_PATH = Path("etl/data/supabase_snapshot.db")
DEFAULT_UNIFIED_DB_PATH = Path("etl/data/local_staging_unified.db")


@dataclass(slots=True)
class ConsolidationStats:
    supabase_skus_read: int = 0
    local_skus_read: int = 0
    dropped_never_positive: int = 0
    dropped_non_mercado: int = 0
    split_colliding_masters: int = 0
    split_skus_reassigned: int = 0
    deduped_masters_no_ean: int = 0
    deduped_masters_ean_vs_no_ean: int = 0
    deduped_intra_store_skus: int = 0
    pruned_exhausted_dupes: int = 0
    orphaned_masters_purged: int = 0
    final_master_products: int = 0
    final_store_skus: int = 0
    final_price_records: int = 0
    output_size_bytes: int = 0


def _to_float(val: Any) -> float:
    try:
        return float(Decimal(str(val)))
    except (InvalidOperation, TypeError, ValueError):
        return 0.0


def _norm_raw_title_key(raw_name: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", strip_accents_lower(raw_name))
    return " ".join(cleaned.split())


def _create_unified_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;

        CREATE TABLE stores (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            channel_type TEXT NOT NULL,
            markup_discount_factor TEXT NOT NULL DEFAULT '1.0000',
            updated_at TEXT
        );

        CREATE TABLE canonical_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            name TEXT,
            base_unit TEXT
        );

        CREATE TABLE master_products (
            id TEXT PRIMARY KEY,
            ean TEXT UNIQUE,
            canonical_category_id INTEGER,
            normalized_name TEXT NOT NULL,
            brand TEXT,
            net_content TEXT NOT NULL,
            unit_measure TEXT NOT NULL,
            image_url TEXT,
            is_private_label INTEGER NOT NULL DEFAULT 0,
            product_type TEXT,
            sub_presentation TEXT,
            sub_presentation_label TEXT,
            shrinkflation_alert INTEGER NOT NULL DEFAULT 0,
            previous_net_content TEXT,
            created_at TEXT NOT NULL,
            invima_registry TEXT,
            actual_manufacturer TEXT,
            positive_votes INTEGER,
            total_votes INTEGER,
            avg_yield_factor TEXT
        );

        CREATE TABLE store_skus (
            id TEXT PRIMARY KEY,
            store_id TEXT NOT NULL,
            master_product_id TEXT NOT NULL,
            external_sku TEXT NOT NULL,
            raw_name TEXT NOT NULL,
            display_name TEXT,
            raw_url TEXT,
            product_type TEXT,
            sub_presentation TEXT,
            sub_presentation_label TEXT,
            variant_tags_json TEXT,
            last_verified_at TEXT NOT NULL,
            is_mercado INTEGER NOT NULL DEFAULT 1,
            available_cities_json TEXT,
            is_deprecated_candidate INTEGER NOT NULL DEFAULT 0,
            deprecated_reason TEXT,
            rappi_promo_price TEXT,
            rappi_savings_cop TEXT,
            rappi_savings_pct TEXT,
            rappi_promo_url TEXT,
            rappi_promo_updated_at TEXT,
            UNIQUE(store_id, external_sku)
        );

        CREATE TABLE price_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_sku_id TEXT NOT NULL,
            raw_list_price TEXT NOT NULL,
            raw_sale_price TEXT NOT NULL,
            calibrated_price TEXT NOT NULL,
            pum_price TEXT NOT NULL,
            in_stock INTEGER NOT NULL,
            source_origin TEXT NOT NULL,
            captured_at TEXT NOT NULL
        );

        CREATE TABLE product_price_daily (
            master_product_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            day TEXT NOT NULL,
            min_price TEXT,
            median_price TEXT,
            samples_count INTEGER,
            PRIMARY KEY (master_product_id, store_id, day)
        );

        CREATE TABLE product_curation_overrides (
            store_sku_id TEXT PRIMARY KEY,
            master_product_id TEXT,
            override_subtype TEXT,
            override_broad_family TEXT,
            override_quality_tier TEXT,
            review_status TEXT,
            doubt_reason TEXT,
            admin_notes TEXT,
            updated_at TEXT
        );

        CREATE TABLE store_branches (
            id TEXT PRIMARY KEY,
            store_id TEXT NOT NULL,
            branch_name TEXT,
            city TEXT,
            address TEXT,
            location_wkt TEXT,
            created_at TEXT,
            department TEXT,
            barrio TEXT,
            source_provider TEXT,
            external_place_id TEXT
        );
        """
    )


def _load_price_histories(conn: sqlite3.Connection, source_rank: int) -> dict[str, list[tuple[Any, ...]]]:
    histories: dict[str, list[tuple[Any, ...]]] = defaultdict(list)
    for row in conn.execute(
        """
        SELECT store_sku_id, raw_list_price, raw_sale_price, calibrated_price,
               pum_price, in_stock, source_origin, captured_at, id
        FROM price_records
        ORDER BY captured_at ASC, id ASC
        """
    ):
        histories[str(row[0])].append(
            (
                str(row[7] or ""),
                source_rank,
                int(row[8]),
                str(row[1]),
                str(row[2]),
                str(row[3]),
                str(row[4]),
                int(row[5]),
                str(row[6] or "local"),
            )
        )
    return histories


def _compact_price_series(events: list[tuple[Any, ...]]) -> list[tuple[Any, ...]]:
    """Ordena cronológicamente y compacta lecturas sin precio positivo o duplicadas consecutivas."""
    if not events:
        return []
    ordered = sorted(events, key=lambda e: (e[0], e[1], e[2]))
    compacted: list[tuple[Any, ...]] = []
    last_pos: tuple[str, str, str, str] | None = None

    for captured_at, _rank, _rid, r_list, r_sale, cal, pum, in_stock, origin in ordered:
        sale_val = _to_float(r_sale)
        if sale_val <= 0:
            if last_pos is None:
                continue
            r_list, r_sale, cal, pum = last_pos
            in_stock = 0
        else:
            if _to_float(r_list) < sale_val:
                r_list = r_sale
            last_pos = (r_list, r_sale, cal, pum)

        if compacted:
            prev = compacted[-1]
            if prev[0] == r_list and prev[1] == r_sale and prev[4] == in_stock:
                continue
        compacted.append((r_list, r_sale, cal, pum, in_stock, origin, captured_at))

    return compacted


def _load_sku_rows(conn: sqlite3.Connection, *, has_sb_cols: bool) -> dict[tuple[str, str], dict[str, Any]]:
    if has_sb_cols:
        sql = """
            SELECT
                ss.id, ss.store_id, ss.master_product_id, ss.external_sku, ss.raw_name,
                ss.display_name, ss.raw_url, ss.product_type, ss.sub_presentation,
                ss.sub_presentation_label, ss.variant_tags_json, ss.last_verified_at,
                ss.is_mercado, ss.available_cities_json, ss.is_deprecated_candidate,
                ss.deprecated_reason, ss.rappi_promo_price, ss.rappi_savings_cop,
                ss.rappi_savings_pct, ss.rappi_promo_url, ss.rappi_promo_updated_at,
                mp.ean, mp.canonical_category_id, mp.normalized_name, mp.brand,
                mp.net_content, mp.unit_measure, mp.image_url, mp.is_private_label,
                mp.product_type AS mp_ptype, mp.sub_presentation AS mp_sp,
                mp.sub_presentation_label AS mp_spl, mp.shrinkflation_alert,
                mp.previous_net_content, mp.created_at, mp.invima_registry,
                mp.actual_manufacturer, mp.positive_votes, mp.total_votes, mp.avg_yield_factor
            FROM store_skus ss
            JOIN master_products mp ON mp.id = ss.master_product_id
        """
    else:
        sql = """
            SELECT
                ss.id, ss.store_id, ss.master_product_id, ss.external_sku, ss.raw_name,
                ss.display_name, ss.raw_url, ss.product_type, ss.sub_presentation,
                ss.sub_presentation_label, ss.variant_tags_json, ss.last_verified_at,
                1 AS is_mercado, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL,
                mp.ean, mp.canonical_category_id, mp.normalized_name, mp.brand,
                mp.net_content, mp.unit_measure, mp.image_url, mp.is_private_label,
                mp.product_type AS mp_ptype, mp.sub_presentation AS mp_sp,
                mp.sub_presentation_label AS mp_spl, mp.shrinkflation_alert,
                mp.previous_net_content, mp.created_at, NULL, NULL, NULL, NULL, NULL
            FROM store_skus ss
            JOIN master_products mp ON mp.id = ss.master_product_id
        """

    out: dict[tuple[str, str], dict[str, Any]] = {}
    for r in conn.execute(sql):
        key = (str(r[1]), str(r[3]))
        out[key] = {
            "id": str(r[0]),
            "store_id": str(r[1]),
            "master_product_id": str(r[2]),
            "external_sku": str(r[3]),
            "raw_name": str(r[4]),
            "display_name": r[5],
            "raw_url": r[6],
            "product_type": r[7],
            "sub_presentation": r[8],
            "sub_presentation_label": r[9],
            "variant_tags_json": r[10],
            "last_verified_at": str(r[11] or ""),
            "is_mercado": int(r[12] if r[12] is not None else 1),
            "available_cities_json": r[13],
            "is_deprecated_candidate": int(r[14] or 0),
            "deprecated_reason": r[15],
            "rappi_promo_price": r[16],
            "rappi_savings_cop": r[17],
            "rappi_savings_pct": r[18],
            "rappi_promo_url": r[19],
            "rappi_promo_updated_at": r[20],
            "ean": r[21],
            "canonical_category_id": r[22],
            "normalized_name": str(r[23]),
            "brand": r[24],
            "net_content": str(r[25]),
            "unit_measure": str(r[26]),
            "image_url": r[27],
            "is_private_label": int(r[28] or 0),
            "mp_ptype": r[29],
            "mp_sp": r[30],
            "mp_spl": r[31],
            "shrinkflation_alert": int(r[32] or 0),
            "previous_net_content": r[33],
            "created_at": str(r[34] or ""),
            "invima_registry": r[35],
            "actual_manufacturer": r[36],
            "positive_votes": r[37],
            "total_votes": r[38],
            "avg_yield_factor": r[39],
        }
    return out


def consolidate_and_optimize(
    *,
    supabase_db: Path | str = DEFAULT_SUPABASE_SNAPSHOT_PATH,
    local_db: Path | str = DEFAULT_LOCAL_DB_PATH,
    output_db: Path | str = DEFAULT_UNIFIED_DB_PATH,
    replace_local: bool = False,
) -> ConsolidationStats:
    """Consolida Supabase + Local en un único SQLite limpio, deduplicado, enriquecido y compactado."""
    sb_path = Path(supabase_db)
    lc_path = Path(local_db)
    out_path = Path(output_db)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()

    stats = ConsolidationStats()

    sb_conn = sqlite3.connect(sb_path) if sb_path.exists() else None
    lc_conn = sqlite3.connect(lc_path) if lc_path.exists() else None
    out_conn = sqlite3.connect(out_path)
    _create_unified_schema(out_conn)

    try:
        sb_skus = _load_sku_rows(sb_conn, has_sb_cols=True) if sb_conn else {}
        lc_skus = _load_sku_rows(lc_conn, has_sb_cols=False) if lc_conn else {}
        stats.supabase_skus_read = len(sb_skus)
        stats.local_skus_read = len(lc_skus)

        sb_prices = _load_price_histories(sb_conn, 0) if sb_conn else {}
        lc_prices = _load_price_histories(lc_conn, 1) if lc_conn else {}

        # Tablas de referencia y contexto desde Supabase snapshot
        override_sku_ids: set[str] = set()
        override_master_ids: set[str] = set()
        daily_master_ids: set[str] = set()
        sb_master_id_by_ean: dict[str, str] = {}

        if sb_conn:
            for row in sb_conn.execute("SELECT id, slug, name, base_unit FROM canonical_categories ORDER BY id"):
                out_conn.execute("INSERT OR IGNORE INTO canonical_categories VALUES (?, ?, ?, ?)", row)

            for row in sb_conn.execute("SELECT id, name, channel_type, markup_discount_factor, updated_at FROM stores"):
                out_conn.execute("INSERT OR IGNORE INTO stores VALUES (?, ?, ?, ?, ?)", row)

            for row in sb_conn.execute("SELECT * FROM store_branches"):
                out_conn.execute("INSERT OR IGNORE INTO store_branches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", row)

            for row in sb_conn.execute("SELECT * FROM product_curation_overrides"):
                out_conn.execute("INSERT OR IGNORE INTO product_curation_overrides VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", row)
                if row[0]:
                    override_sku_ids.add(str(row[0]))
                if row[1]:
                    override_master_ids.add(str(row[1]))

            for row in sb_conn.execute("SELECT * FROM product_price_daily"):
                out_conn.execute("INSERT OR IGNORE INTO product_price_daily VALUES (?, ?, ?, ?, ?, ?)", row)
                daily_master_ids.add(str(row[0]))

            for mid, ean in sb_conn.execute("SELECT id, ean FROM master_products WHERE ean IS NOT NULL AND ean != ''"):
                sb_master_id_by_ean[str(ean)] = str(mid)

        # Asegurar slugs base de CANONICAL_RULES y todas las tiendas presentes en skus
        for rule in CANONICAL_RULES:
            out_conn.execute("INSERT OR IGNORE INTO canonical_categories (slug) VALUES (?)", (rule.slug,))

        all_store_ids = {k[0] for k in sb_skus} | {k[0] for k in lc_skus}
        for sid in sorted(all_store_ids):
            out_conn.execute(
                "INSERT OR IGNORE INTO stores (id, name, channel_type, markup_discount_factor) VALUES (?, ?, 'local', '1.0000')",
                (sid, sid.title()),
            )

        # Catálogo de canonical_categories para mapear IDs de local a Supabase cuando difieran
        out_slug_to_id = {
            str(s): int(i)
            for i, s in out_conn.execute("SELECT id, slug FROM canonical_categories").fetchall()
        }
        lc_id_to_out_id: dict[int, int] = {}
        if lc_conn:
            for lid, lslug in lc_conn.execute("SELECT id, slug FROM canonical_categories").fetchall():
                if str(lslug) in out_slug_to_id:
                    lc_id_to_out_id[int(lid)] = out_slug_to_id[str(lslug)]

        # Fusión por (store_id, external_sku)
        all_keys = sorted(set(sb_skus) | set(lc_skus))
        masters_by_id: dict[str, dict[str, Any]] = {}
        master_by_ean: dict[str, str] = dict(sb_master_id_by_ean)
        sku_records: list[dict[str, Any]] = []
        price_rows: list[tuple[Any, ...]] = []

        for key in all_keys:
            sb_row = sb_skus.get(key)
            lc_row = lc_skus.get(key)

            events: list[tuple[Any, ...]] = []
            if sb_row:
                events.extend(sb_prices.get(sb_row["id"], []))
            if lc_row:
                events.extend(lc_prices.get(lc_row["id"], []))

            compacted_prices = _compact_price_series(events)
            if not compacted_prices:
                stats.dropped_never_positive += 1
                continue

            primary = lc_row or sb_row
            assert primary is not None
            sku_id = sb_row["id"] if sb_row else lc_row["id"]
            raw_name = primary["raw_name"]
            brand = (lc_row["brand"] if lc_row and lc_row["brand"] else None) or (sb_row["brand"] if sb_row else None)
            raw_url = (lc_row["raw_url"] if lc_row and lc_row["raw_url"] else None) or (sb_row["raw_url"] if sb_row else None)

            if sku_id not in override_sku_ids and not is_mercado_product(
                key[0], raw_name, brand=brand, raw_url=raw_url
            ):
                stats.dropped_non_mercado += 1
                continue

            sb_ean = str(sb_row["ean"]).strip() if sb_row and sb_row["ean"] else None
            lc_ean = str(lc_row["ean"]).strip() if lc_row and lc_row["ean"] else None
            ean = sb_ean or lc_ean

            # Determinar master_product_id preservando los IDs de Supabase / EAN únicos
            if sb_row:
                master_id = sb_row["master_product_id"]
                if (
                    ean
                    and ean in master_by_ean
                    and master_by_ean[ean] != master_id
                ):
                    if not sb_ean and master_id not in override_master_ids and master_id not in daily_master_ids:
                        master_id = master_by_ean[ean]
                    else:
                        ean = None
            elif ean and ean in master_by_ean:
                master_id = master_by_ean[ean]
            else:
                master_id = primary["master_product_id"]
                if master_id in masters_by_id:
                    existing_m = masters_by_id[master_id]
                    if existing_m["ean"] != ean or existing_m["normalized_name"] != primary["normalized_name"]:
                        master_id = str(uuid4())

            if ean and ean not in master_by_ean:
                master_by_ean[ean] = master_id
            elif ean and master_by_ean[ean] != master_id:
                ean = None

            # Categoría canónica válida
            sb_cat = sb_row["canonical_category_id"] if sb_row else None
            lc_cat_raw = lc_row["canonical_category_id"] if lc_row else None
            lc_cat = lc_id_to_out_id.get(int(lc_cat_raw)) if lc_cat_raw is not None else None
            canon_cat_id = sb_cat if sb_cat is not None else lc_cat

            img = (lc_row["image_url"] if lc_row and lc_row["image_url"] else None) or (sb_row["image_url"] if sb_row else None)
            norm_name = primary["normalized_name"]
            net_content = primary["net_content"]
            unit_measure = primary["unit_measure"]
            is_pl = int(primary["is_private_label"] or (sb_row["is_private_label"] if sb_row else 0))

            if master_id not in masters_by_id:
                masters_by_id[master_id] = {
                    "id": master_id,
                    "ean": ean,
                    "canonical_category_id": canon_cat_id,
                    "normalized_name": norm_name,
                    "brand": brand,
                    "net_content": net_content,
                    "unit_measure": unit_measure,
                    "image_url": img,
                    "is_private_label": is_pl,
                    "product_type": primary.get("mp_ptype") or (sb_row.get("mp_ptype") if sb_row else None),
                    "sub_presentation": primary.get("mp_sp") or (sb_row.get("mp_sp") if sb_row else None),
                    "sub_presentation_label": primary.get("mp_spl") or (sb_row.get("mp_spl") if sb_row else None),
                    "shrinkflation_alert": int(primary.get("shrinkflation_alert") or (sb_row.get("shrinkflation_alert") if sb_row else 0)),
                    "previous_net_content": primary.get("previous_net_content") or (sb_row.get("previous_net_content") if sb_row else None),
                    "created_at": (sb_row["created_at"] if sb_row and sb_row["created_at"] else primary["created_at"]),
                    "invima_registry": sb_row.get("invima_registry") if sb_row else None,
                    "actual_manufacturer": sb_row.get("actual_manufacturer") if sb_row else None,
                    "positive_votes": sb_row.get("positive_votes") if sb_row else None,
                    "total_votes": sb_row.get("total_votes") if sb_row else None,
                    "avg_yield_factor": sb_row.get("avg_yield_factor") if sb_row else None,
                }
            else:
                m = masters_by_id[master_id]
                if not m["image_url"] and img:
                    m["image_url"] = img
                if not m["brand"] and brand:
                    m["brand"] = brand
                if m["canonical_category_id"] is None and canon_cat_id is not None:
                    m["canonical_category_id"] = canon_cat_id
                if sb_row:
                    for col in ("invima_registry", "actual_manufacturer", "positive_votes", "total_votes", "avg_yield_factor"):
                        if m[col] is None and sb_row.get(col) is not None:
                            m[col] = sb_row[col]

            vtags = primary["variant_tags_json"]
            if vtags == "[]":
                vtags = None

            sku_records.append(
                {
                    "id": sku_id,
                    "store_id": key[0],
                    "master_product_id": master_id,
                    "external_sku": key[1],
                    "raw_name": raw_name,
                    "display_name": primary["display_name"],
                    "raw_url": raw_url,
                    "product_type": primary["product_type"] or (sb_row["product_type"] if sb_row else None),
                    "sub_presentation": primary["sub_presentation"] or (sb_row["sub_presentation"] if sb_row else None),
                    "sub_presentation_label": primary["sub_presentation_label"] or (sb_row["sub_presentation_label"] if sb_row else None),
                    "variant_tags_json": vtags,
                    "last_verified_at": (lc_row["last_verified_at"] if lc_row and lc_row["last_verified_at"] else primary["last_verified_at"]),
                    "is_mercado": 1,
                    "available_cities_json": sb_row.get("available_cities_json") if sb_row else None,
                    "is_deprecated_candidate": 0,
                    "deprecated_reason": None,
                    "rappi_promo_price": sb_row.get("rappi_promo_price") if sb_row else None,
                    "rappi_savings_cop": sb_row.get("rappi_savings_cop") if sb_row else None,
                    "rappi_savings_pct": sb_row.get("rappi_savings_pct") if sb_row else None,
                    "rappi_promo_url": sb_row.get("rappi_promo_url") if sb_row else None,
                    "rappi_promo_updated_at": sb_row.get("rappi_promo_updated_at") if sb_row else None,
                    "_prices": compacted_prices,
                    "_in_sb": sb_row is not None,
                    "_has_override": sku_id in override_sku_ids,
                    "_brand": brand,
                    "_is_private_label": is_pl,
                }
            )

        # Vocabulario limpio de marcas conocidas en la BD para detectar colisiones textuales
        single_brands, multi_brands = build_known_brands_vocab(
            [m.get("brand") for m in masters_by_id.values()] + [s.get("_brand") for s in sku_records]
        )

        # Fase 0: Separar colisiones existentes dentro de `master_products` (marcas/variantes distintas fusionadas)
        skus_by_master: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for s in sku_records:
            skus_by_master[s["master_product_id"]].append(s)

        for old_mid, group_skus in list(skus_by_master.items()):
            if len(group_skus) <= 1:
                continue
            old_m = masters_by_id[old_mid]
            old_brand_norm = normalize_brand(old_m.get("brand"))

            sku_with_sigs: list[tuple[dict[str, Any], Any]] = []
            for s in group_skus:
                sku_pl = bool(s["_is_private_label"])
                raw_sig = extract_product_signature(
                    s["raw_name"],
                    is_private_label=sku_pl,
                    store_id=s["store_id"],
                    single_brands=single_brands,
                    multi_brands=multi_brands,
                )
                s_brand = s.get("_brand")
                s_brand_norm = normalize_brand(s_brand)
                s_brand_in_text = bool(
                    s_brand_norm
                    and (
                        s_brand_norm in raw_sig.norm_text.replace("-", "")
                        or any(brands_compatible(s_brand, db) for db in raw_sig.detected_brands)
                    )
                )
                eff_brand = s_brand if s_brand_in_text else None
                sig = (
                    extract_product_signature(
                        s["raw_name"],
                        brand=eff_brand,
                        is_private_label=sku_pl,
                        store_id=s["store_id"],
                        single_brands=single_brands,
                        multi_brands=multi_brands,
                    )
                    if eff_brand
                    else raw_sig
                )
                sku_with_sigs.append((s, sig))

            # Anclar primero SKUs con marca detectada y presencia en Supabase
            sku_with_sigs.sort(
                key=lambda item: (
                    1 if (old_brand_norm and any(brands_compatible(old_brand_norm, b) for b in item[1].detected_brands)) else 0,
                    1 if item[1].detected_brands else 0,
                    1 if item[0]["_in_sb"] else 0,
                    len(item[0]["_prices"]),
                ),
                reverse=True,
            )

            clusters: list[tuple[Any, list[tuple[dict[str, Any], Any]]]] = []
            for s, sig in sku_with_sigs:
                placed = False
                for rep_sig, members in clusters:
                    ok, _reason = signatures_compatible(rep_sig, sig, strict_trigram=False)
                    if ok:
                        members.append((s, sig))
                        placed = True
                        break
                if not placed:
                    clusters.append((sig, [(s, sig)]))

            if len(clusters) <= 1:
                continue

            # Elegir el cluster primario que conserva old_mid y su EAN original
            primary_idx = max(
                range(len(clusters)),
                key=lambda idx: (
                    1
                    if (
                        old_brand_norm
                        and any(brands_compatible(old_brand_norm, b) for _s, sg in clusters[idx][1] for b in sg.detected_brands)
                    )
                    else 0,
                    sum(1 for s, _sg in clusters[idx][1] if s["_in_sb"]),
                    len(clusters[idx][1]),
                ),
            )

            stats.split_colliding_masters += 1
            for idx, (rep_sig, members) in enumerate(clusters):
                if idx == primary_idx:
                    continue
                rep = max(
                    [s for s, _sg in members],
                    key=lambda s: (
                        1 if s["_in_sb"] else 0,
                        1 if s["display_name"] else 0,
                        len(s["raw_name"]),
                    ),
                )
                new_norm = normalize_product_name(rep["raw_name"]) or old_m["normalized_name"]
                cand_id = str(uuid5(NAMESPACE_URL, f"split:{old_mid}:{idx}:{new_norm}"))
                new_mid = cand_id if cand_id not in masters_by_id else str(uuid4())

                detected_list = sorted(rep_sig.detected_brands)
                rep_brand = rep.get("_brand")
                rep_brand_norm = normalize_brand(rep_brand)
                rep_brand_in_text = bool(
                    rep_brand_norm
                    and (
                        rep_brand_norm in rep_sig.norm_text.replace("-", "")
                        or (detected_list and any(brands_compatible(rep_brand_norm, db) for db in detected_list))
                    )
                )
                new_brand: str | None = None
                if rep_brand and rep_brand_in_text:
                    new_brand = rep_brand
                elif detected_list:
                    first_brand = detected_list[0]
                    new_brand = "P.A.N." if first_brand == "harina pan" else first_brand.title()

                new_pl = 1 if is_store_private_label(rep["store_id"], new_brand, None) else 0
                meta = extract_product_metadata(rep["raw_name"], new_norm, is_private_label=bool(new_pl))
                masters_by_id[new_mid] = {
                    "id": new_mid,
                    "ean": None,
                    "canonical_category_id": None,
                    "normalized_name": new_norm,
                    "brand": new_brand,
                    "net_content": old_m["net_content"],
                    "unit_measure": old_m["unit_measure"],
                    "image_url": None,
                    "is_private_label": new_pl,
                    "product_type": meta.product_type,
                    "sub_presentation": meta.sub_presentation,
                    "sub_presentation_label": meta.sub_presentation_label,
                    "shrinkflation_alert": 0,
                    "previous_net_content": None,
                    "created_at": rep.get("last_verified_at") or old_m["created_at"],
                    "invima_registry": None,
                    "actual_manufacturer": None,
                    "positive_votes": None,
                    "total_votes": None,
                    "avg_yield_factor": None,
                }
                for s, _sg in members:
                    s["master_product_id"] = new_mid
                    stats.split_skus_reassigned += 1

        # Deduplicación A: master_products sin EAN idénticos (normalized_name, net_content, unit_measure, is_private_label)
        no_ean_groups: dict[tuple[str, str, str, int], list[str]] = defaultdict(list)
        sku_counts_by_master: dict[str, int] = defaultdict(int)
        for s in sku_records:
            sku_counts_by_master[s["master_product_id"]] += 1

        for mid, m in masters_by_id.items():
            if not m["ean"]:
                gkey = (m["normalized_name"], m["net_content"], m["unit_measure"], int(m["is_private_label"]))
                no_ean_groups[gkey].append(mid)

        def _apply_master_remap(remap: dict[str, str]) -> None:
            if not remap:
                return
            for s in sku_records:
                mid = s["master_product_id"]
                if mid in remap:
                    s["master_product_id"] = remap[mid]
            for loser, winner in remap.items():
                wm = masters_by_id.get(winner)
                lm = masters_by_id.pop(loser, None)
                if wm is not None and lm is not None:
                    if not wm["image_url"] and lm["image_url"]:
                        wm["image_url"] = lm["image_url"]
                    if wm["canonical_category_id"] is None and lm["canonical_category_id"] is not None:
                        wm["canonical_category_id"] = lm["canonical_category_id"]
                    if not wm["brand"] and lm["brand"]:
                        wm["brand"] = lm["brand"]
                out_conn.execute(
                    """
                    INSERT OR IGNORE INTO product_price_daily (master_product_id, store_id, day, min_price, median_price, samples_count)
                    SELECT ?, store_id, day, min_price, median_price, samples_count
                    FROM product_price_daily WHERE master_product_id = ?
                    """,
                    (winner, loser),
                )
                out_conn.execute("DELETE FROM product_price_daily WHERE master_product_id = ?", (loser,))

        def _master_priority(mid: str) -> tuple[int, int, int, int, int]:
            return (
                1 if mid in override_master_ids else 0,
                1 if mid in daily_master_ids else 0,
                1 if masters_by_id[mid]["canonical_category_id"] is not None else 0,
                1 if masters_by_id[mid]["image_url"] else 0,
                sku_counts_by_master[mid],
            )

        def _master_sig(mid: str) -> Any:
            mm = masters_by_id[mid]
            return extract_product_signature(
                mm["normalized_name"],
                normalized_name=mm["normalized_name"],
                brand=mm.get("brand"),
                is_private_label=bool(mm["is_private_label"]),
                single_brands=single_brands,
                multi_brands=multi_brands,
            )

        master_remap: dict[str, str] = {}
        for _gkey, mids in no_ean_groups.items():
            if len(mids) <= 1:
                continue
            mids_sorted = sorted(mids, key=_master_priority, reverse=True)
            winner = mids_sorted[0]
            w_sig = _master_sig(winner)
            for loser in mids_sorted[1:]:
                if signatures_compatible(w_sig, _master_sig(loser), strict_trigram=False)[0]:
                    master_remap[loser] = winner
                    stats.deduped_masters_no_ean += 1
        _apply_master_remap(master_remap)

        # Deduplicación A2: master_products no marca propia idénticos donde unos tienen 1 único EAN y otros NO_EAN
        mixed_ean_groups: dict[tuple[str, str, str], list[str]] = defaultdict(list)
        for mid, m in masters_by_id.items():
            if int(m["is_private_label"]) == 0:
                mixed_ean_groups[(m["normalized_name"], m["net_content"], m["unit_measure"])].append(mid)

        mixed_remap: dict[str, str] = {}
        for _gkey, mids in mixed_ean_groups.items():
            if len(mids) <= 1:
                continue
            with_ean = [mid for mid in mids if masters_by_id[mid]["ean"]]
            without_ean = [mid for mid in mids if not masters_by_id[mid]["ean"]]
            distinct_eans = {masters_by_id[mid]["ean"] for mid in with_ean}
            if len(distinct_eans) != 1 or not without_ean:
                continue
            winner = sorted(with_ean, key=_master_priority, reverse=True)[0]
            w_sig = _master_sig(winner)
            for loser in without_ean:
                if signatures_compatible(w_sig, _master_sig(loser), strict_trigram=False)[0]:
                    mixed_remap[loser] = winner
                    stats.deduped_masters_ean_vs_no_ean += 1
        _apply_master_remap(mixed_remap)

        # Deduplicación B1: duplicados exactos intra-tienda (store_id, normalized_name, net_content, unit_measure, latest_sale_price)
        intra_groups: dict[tuple[str, str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
        for s in sku_records:
            m = masters_by_id[s["master_product_id"]]
            latest_sale = s["_prices"][-1][1]
            ikey = (s["store_id"], m["normalized_name"], m["net_content"], m["unit_measure"], latest_sale)
            intra_groups[ikey].append(s)

        b1_skus: list[dict[str, Any]] = []
        for ikey, group in intra_groups.items():
            if len(group) == 1:
                b1_skus.append(group[0])
                continue
            # Conservar cualquier SKU protegido por override + exactamente 1 ganador del resto
            overrides = [s for s in group if s["_has_override"]]
            if overrides:
                b1_skus.extend(overrides)
                stats.deduped_intra_store_skus += len(group) - len(overrides)
                continue

            winner = max(
                group,
                key=lambda s: (
                    int(s["_prices"][-1][4]),  # in_stock
                    1 if s["_in_sb"] else 0,
                    1 if masters_by_id[s["master_product_id"]]["ean"] else 0,
                    1 if masters_by_id[s["master_product_id"]]["image_url"] else 0,
                    1 if s["raw_url"] else 0,
                    len(s["_prices"]),
                    -len(s["external_sku"]),
                ),
            )
            b1_skus.append(winner)
            stats.deduped_intra_store_skus += len(group) - 1

        # Deduplicación B2: podar variantes agotadas (in_stock=0) repetidas intra-tienda con idéntico título/contenido
        exhausted_groups: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
        for s in b1_skus:
            m = masters_by_id[s["master_product_id"]]
            ekey = (
                s["store_id"],
                _norm_raw_title_key(s["raw_name"]),
                m["net_content"],
                m["unit_measure"],
            )
            exhausted_groups[ekey].append(s)

        kept_skus: list[dict[str, Any]] = []
        for _ekey, group in exhausted_groups.items():
            if len(group) == 1:
                kept_skus.append(group[0])
                continue
            protected = [s for s in group if s["_has_override"]]
            active = [s for s in group if not s["_has_override"] and int(s["_prices"][-1][4]) == 1]
            oos = [s for s in group if not s["_has_override"] and int(s["_prices"][-1][4]) == 0]
            kept_skus.extend(protected)
            kept_skus.extend(active)
            if active or protected:
                # Si ya existe al menos un SKU activo o protegido con título idéntico, descartar los in_stock=0 redundantes
                stats.pruned_exhausted_dupes += len(oos)
            elif oos:
                best_oos = max(
                    oos,
                    key=lambda s: (
                        1 if s["_in_sb"] else 0,
                        1 if masters_by_id[s["master_product_id"]]["ean"] else 0,
                        1 if s["raw_url"] else 0,
                        str(s["_prices"][-1][6]),  # captured_at más reciente
                        len(s["_prices"]),
                        -len(s["external_sku"]),
                    ),
                )
                kept_skus.append(best_oos)
                stats.pruned_exhausted_dupes += len(oos) - 1

        # Filtrar master_products huérfanos tras dedup intra-tienda
        used_masters = {s["master_product_id"] for s in kept_skus} | override_master_ids
        all_master_ids = set(masters_by_id)
        for orphan_mid in all_master_ids - used_masters:
            masters_by_id.pop(orphan_mid, None)
            stats.orphaned_masters_purged += 1

        out_conn.executemany(
            """
            INSERT INTO master_products (
                id, ean, canonical_category_id, normalized_name, brand, net_content, unit_measure,
                image_url, is_private_label, product_type, sub_presentation, sub_presentation_label,
                shrinkflation_alert, previous_net_content, created_at, invima_registry,
                actual_manufacturer, positive_votes, total_votes, avg_yield_factor
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    m["id"], m["ean"], m["canonical_category_id"], m["normalized_name"], m["brand"],
                    m["net_content"], m["unit_measure"], m["image_url"], m["is_private_label"],
                    m["product_type"], m["sub_presentation"], m["sub_presentation_label"],
                    m["shrinkflation_alert"], m["previous_net_content"], m["created_at"],
                    m["invima_registry"], m["actual_manufacturer"], m["positive_votes"],
                    m["total_votes"], m["avg_yield_factor"],
                )
                for m in masters_by_id.values()
            ],
        )

        out_conn.executemany(
            """
            INSERT INTO store_skus (
                id, store_id, master_product_id, external_sku, raw_name, display_name, raw_url,
                product_type, sub_presentation, sub_presentation_label, variant_tags_json,
                last_verified_at, is_mercado, available_cities_json, is_deprecated_candidate,
                deprecated_reason, rappi_promo_price, rappi_savings_cop, rappi_savings_pct,
                rappi_promo_url, rappi_promo_updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    s["id"], s["store_id"], s["master_product_id"], s["external_sku"], s["raw_name"],
                    s["display_name"], s["raw_url"], s["product_type"], s["sub_presentation"],
                    s["sub_presentation_label"], s["variant_tags_json"], s["last_verified_at"],
                    s["is_mercado"], s["available_cities_json"], s["is_deprecated_candidate"],
                    s["deprecated_reason"], s["rappi_promo_price"], s["rappi_savings_cop"],
                    s["rappi_savings_pct"], s["rappi_promo_url"], s["rappi_promo_updated_at"],
                )
                for s in kept_skus
            ],
        )

        for s in kept_skus:
            sid = s["id"]
            for r_list, r_sale, cal, pum, in_stock, origin, cap in s["_prices"]:
                price_rows.append((sid, r_list, r_sale, cal, pum, in_stock, origin, cap))

        out_conn.executemany(
            """
            INSERT INTO price_records (
                store_sku_id, raw_list_price, raw_sale_price, calibrated_price,
                pum_price, in_stock, source_origin, captured_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            price_rows,
        )

        # Limpiar product_price_daily huérfanos sin master_product activo
        out_conn.execute(
            "DELETE FROM product_price_daily WHERE master_product_id NOT IN (SELECT id FROM master_products)"
        )
        # Re-evaluar categorías canónicas no-mercado heredadas antes del backfill
        out_conn.execute(
            """
            UPDATE master_products
            SET canonical_category_id = NULL
            WHERE canonical_category_id IN (
                SELECT id FROM canonical_categories
                WHERE slug IN (
                    'vinos-cervezas-y-licores',
                    'cigarrillos-tabaco-y-vapeadores',
                    'juguetes-y-peluches',
                    'electrodomesticos-menores',
                    'organizacion-y-muebles-hogar',
                    'decoracion-y-temporada',
                    'bienestar-sexual-y-juguetes',
                    'accesorios-moda-y-relojeria',
                    'accesorios-y-otras-mascotas',
                    'bonos-boletas-y-servicios',
                    'papeleria-prensa-y-regalos'
                )
            )
            """
        )
        out_conn.commit()
    finally:
        out_conn.close()
        if sb_conn:
            sb_conn.close()
        if lc_conn:
            lc_conn.close()

    # Backfill completo de categorías canónicas, display_name y subpresentaciones en SQLite
    run_local_backfill(out_path, dry_run=False)

    # Compactar índices óptimos + eliminar redundancia display_name == raw_name + VACUUM
    opt_conn = sqlite3.connect(out_path)
    try:
        opt_conn.execute(
            "UPDATE store_skus SET display_name = NULL WHERE LOWER(TRIM(COALESCE(display_name, ''))) = LOWER(TRIM(raw_name))"
        )
        opt_conn.executescript(
            """
            CREATE INDEX IF NOT EXISTS idx_local_mp_content ON master_products (net_content, unit_measure);
            CREATE INDEX IF NOT EXISTS idx_local_mp_exact ON master_products (normalized_name, net_content, unit_measure);
            CREATE INDEX IF NOT EXISTS idx_local_skus_store ON store_skus (store_id);
            CREATE INDEX IF NOT EXISTS idx_local_skus_master ON store_skus (master_product_id);
            CREATE INDEX IF NOT EXISTS idx_local_pr_sku ON price_records (store_sku_id, id DESC);
            """
        )
        opt_conn.commit()
        opt_conn.execute("VACUUM;")
        opt_conn.execute("ANALYZE;")
        opt_conn.execute("PRAGMA optimize;")
        opt_conn.execute("PRAGMA journal_mode=WAL;")
        opt_conn.execute("PRAGMA synchronous=NORMAL;")

        stats.final_master_products = opt_conn.execute("SELECT COUNT(*) FROM master_products").fetchone()[0]
        stats.final_store_skus = opt_conn.execute("SELECT COUNT(*) FROM store_skus").fetchone()[0]
        stats.final_price_records = opt_conn.execute("SELECT COUNT(*) FROM price_records").fetchone()[0]
    finally:
        opt_conn.close()

    stats.output_size_bytes = out_path.stat().st_size

    if replace_local:
        if lc_path.exists():
            backup_path = lc_path.with_name("local_staging_pre_merge.db.bak")
            if not backup_path.exists():
                shutil.copy2(lc_path, backup_path)
                logger.info("Respaldo creado en %s", backup_path)
            for suffix in ("-wal", "-shm"):
                wal = Path(str(lc_path) + suffix)
                if wal.exists():
                    wal.unlink()
        shutil.copy2(out_path, lc_path)
        stats.output_size_bytes = lc_path.stat().st_size

    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser(description="Consolida Supabase + Local y optimiza SQLite en tu PC.")
    parser.add_argument("--supabase-db", default=str(DEFAULT_SUPABASE_SNAPSHOT_PATH))
    parser.add_argument("--local-db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--output-db", default=str(DEFAULT_UNIFIED_DB_PATH))
    parser.add_argument("--replace-local", action="store_true", help="Respalda local_staging.db y lo reemplaza con la versión optimizada.")
    args = parser.parse_args(argv)
    res = consolidate_and_optimize(
        supabase_db=args.supabase_db,
        local_db=args.local_db,
        output_db=args.output_db,
        replace_local=args.replace_local,
    )
    print(res)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
