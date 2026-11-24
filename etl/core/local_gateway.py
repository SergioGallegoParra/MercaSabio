"""Gateway SQLite local para ejecutar scrapers y CDC 100% en tu PC sin tocar Supabase."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from decimal import Decimal
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from uuid import uuid4

from etl.core.canonical_mapper import CANONICAL_RULES
from etl.core.match_safety import extract_product_signature, signatures_compatible

DEFAULT_LOCAL_DB_PATH = Path("etl/data/local_staging.db")


def _char_trigrams(text: str) -> set[str]:
    padded = f"  {text} "
    return {padded[i : i + 3] for i in range(max(len(padded) - 2, 1))}


def _trigram_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    ta = _char_trigrams(a)
    tb = _char_trigrams(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    # Similitud de Dice/Sorensen + respaldo de SequenceMatcher
    dice = (2.0 * inter) / (len(ta) + len(tb))
    return max(dice, SequenceMatcher(None, a, b).ratio() * 0.9)


class LocalSqliteGateway:
    """Implementación persistente local (`sqlite3`) compatible con `DatabaseGateway`."""

    def __init__(self, db_path: Path | str = DEFAULT_LOCAL_DB_PATH) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA synchronous=NORMAL;")
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS canonical_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS master_products (
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
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_local_mp_content
                ON master_products (net_content, unit_measure);
            CREATE INDEX IF NOT EXISTS idx_local_mp_exact
                ON master_products (normalized_name, net_content, unit_measure);

            CREATE TABLE IF NOT EXISTS store_skus (
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
                UNIQUE(store_id, external_sku)
            );
            CREATE INDEX IF NOT EXISTS idx_local_skus_store ON store_skus (store_id);
            CREATE INDEX IF NOT EXISTS idx_local_skus_master ON store_skus (master_product_id);

            CREATE TABLE IF NOT EXISTS price_records (
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
            CREATE INDEX IF NOT EXISTS idx_local_pr_sku
                ON price_records (store_sku_id, id DESC);
            """
        )
        slugs = sorted({rule.slug for rule in CANONICAL_RULES})
        self._conn.executemany(
            "INSERT OR IGNORE INTO canonical_categories (slug) VALUES (?)",
            [(slug,) for slug in slugs],
        )
        self._conn.commit()

    async def aclose(self) -> None:
        self._conn.close()

    async def fetch_canonical_categories(self) -> dict[str, int]:
        rows = self._conn.execute("SELECT id, slug FROM canonical_categories").fetchall()
        return {str(r["slug"]): int(r["id"]) for r in rows}

    async def fetch_store_skus(self, store_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT id, external_sku, master_product_id FROM store_skus WHERE store_id = ?",
            (store_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    async def fetch_latest_prices(self, store_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT
                ss.id AS store_sku_id,
                ss.master_product_id,
                mp.normalized_name,
                pr.raw_sale_price,
                pr.calibrated_price,
                mp.net_content,
                mp.unit_measure,
                pr.pum_price,
                pr.in_stock
            FROM store_skus ss
            LEFT JOIN master_products mp ON mp.id = ss.master_product_id
            JOIN price_records pr ON pr.id = (
                SELECT pr_in.id
                FROM price_records pr_in
                WHERE pr_in.store_sku_id = ss.id
                ORDER BY pr_in.id DESC
                LIMIT 1
            )
            WHERE ss.store_id = ?
            """,
            (store_id,),
        ).fetchall()
        return [
            {
                "store_sku_id": r["store_sku_id"],
                "master_product_id": r["master_product_id"],
                "normalized_name": r["normalized_name"],
                "raw_sale_price": r["raw_sale_price"],
                "calibrated_price": r["calibrated_price"],
                "net_content": r["net_content"],
                "unit_measure": r["unit_measure"],
                "pum_price": r["pum_price"],
                "in_stock": bool(r["in_stock"]),
            }
            for r in rows
        ]

    async def fetch_master_products_by_eans(self, eans: list[str]) -> dict[str, str]:
        if not eans:
            return {}
        mapping: dict[str, str] = {}
        for start in range(0, len(eans), 400):
            chunk = eans[start : start + 400]
            placeholders = ",".join("?" for _ in chunk)
            rows = self._conn.execute(
                f"SELECT id, ean FROM master_products WHERE ean IN ({placeholders})",
                chunk,
            ).fetchall()
            for r in rows:
                if r["ean"]:
                    mapping[str(r["ean"])] = str(r["id"])
        return mapping

    async def match_master_product_trgm(
        self,
        normalized_name: str,
        net_content: Decimal,
        unit_measure: str,
        threshold: float = 0.65,
        *,
        brand: str | None = None,
    ) -> str | None:
        target_sig = extract_product_signature(normalized_name, normalized_name=normalized_name, brand=brand)

        exacts = self._conn.execute(
            """
            SELECT id, normalized_name, brand
            FROM master_products
            WHERE normalized_name = ? AND net_content = ? AND unit_measure = ? AND is_private_label = 0
            """,
            (normalized_name, str(net_content), unit_measure),
        ).fetchall()
        for exact in exacts:
            cand_sig = extract_product_signature(
                str(exact["normalized_name"]),
                normalized_name=str(exact["normalized_name"]),
                brand=exact["brand"],
            )
            if signatures_compatible(target_sig, cand_sig, strict_trigram=True)[0]:
                return str(exact["id"])

        rows = self._conn.execute(
            """
            SELECT id, normalized_name, brand
            FROM master_products
            WHERE net_content = ? AND unit_measure = ? AND is_private_label = 0
            LIMIT 250
            """,
            (str(net_content), unit_measure),
        ).fetchall()
        best_id: str | None = None
        best_score = threshold
        for r in rows:
            cand_name = str(r["normalized_name"])
            score = _trigram_similarity(normalized_name, cand_name)
            if score < best_score:
                continue
            cand_sig = extract_product_signature(
                cand_name,
                normalized_name=cand_name,
                brand=r["brand"],
            )
            if not signatures_compatible(target_sig, cand_sig, strict_trigram=True)[0]:
                continue
            best_score = score
            best_id = str(r["id"])
        return best_id

    async def create_master_product(self, payload: dict[str, Any]) -> str:
        ean = payload.get("ean")
        if ean:
            existing = self._conn.execute(
                "SELECT id FROM master_products WHERE ean = ?",
                (ean,),
            ).fetchone()
            if existing is not None:
                return str(existing["id"])

        new_id = str(uuid4())
        now_iso = datetime.now(UTC).isoformat()
        self._conn.execute(
            """
            INSERT INTO master_products (
                id, ean, canonical_category_id, normalized_name, brand,
                net_content, unit_measure, image_url, is_private_label,
                product_type, sub_presentation, sub_presentation_label, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id,
                ean,
                payload.get("canonical_category_id"),
                str(payload.get("normalized_name") or ""),
                payload.get("brand"),
                str(payload.get("net_content") or "1"),
                str(payload.get("unit_measure") or "und"),
                payload.get("image_url"),
                1 if payload.get("is_private_label") else 0,
                payload.get("product_type"),
                payload.get("sub_presentation"),
                payload.get("sub_presentation_label"),
                now_iso,
            ),
        )
        self._conn.commit()
        return new_id

    async def backfill_master_images(self, updates: dict[str, str]) -> int:
        if not updates:
            return 0
        rows = [(url, mid) for mid, url in updates.items() if url]
        if not rows:
            return 0
        cur = self._conn.executemany(
            """
            UPDATE master_products
            SET image_url = ?
            WHERE id = ?
              AND (image_url IS NULL OR TRIM(image_url) = '')
            """,
            rows,
        )
        self._conn.commit()
        return int(cur.rowcount if cur.rowcount != -1 else 0)

    async def upsert_store_skus(self, rows: list[dict[str, Any]]) -> dict[str, str]:
        if not rows:
            return {}
        now_iso = datetime.now(UTC).isoformat()
        mapping: dict[str, str] = {}
        for row in rows:
            store_id = str(row["store_id"])
            ext_sku = str(row["external_sku"])
            existing = self._conn.execute(
                "SELECT id FROM store_skus WHERE store_id = ? AND external_sku = ?",
                (store_id, ext_sku),
            ).fetchone()
            sku_id = str(existing["id"]) if existing is not None else str(uuid4())
            self._conn.execute(
                """
                INSERT INTO store_skus (
                    id, store_id, master_product_id, external_sku, raw_name,
                    display_name, raw_url, product_type, sub_presentation,
                    sub_presentation_label, variant_tags_json, last_verified_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(store_id, external_sku) DO UPDATE SET
                    master_product_id = excluded.master_product_id,
                    raw_name = excluded.raw_name,
                    display_name = excluded.display_name,
                    raw_url = excluded.raw_url,
                    product_type = excluded.product_type,
                    sub_presentation = excluded.sub_presentation,
                    sub_presentation_label = excluded.sub_presentation_label,
                    variant_tags_json = excluded.variant_tags_json,
                    last_verified_at = excluded.last_verified_at
                """,
                (
                    sku_id,
                    store_id,
                    str(row["master_product_id"]),
                    ext_sku,
                    str(row["raw_name"]),
                    row.get("display_name"),
                    row.get("raw_url"),
                    row.get("product_type"),
                    row.get("sub_presentation"),
                    row.get("sub_presentation_label"),
                    (
                        json.dumps(list(row["variant_tags"]), ensure_ascii=False)
                        if row.get("variant_tags")
                        else None
                    ),
                    now_iso,
                ),
            )
            mapping[ext_sku] = sku_id
        self._conn.commit()
        return mapping

    async def insert_price_records(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        now_iso = datetime.now(UTC).isoformat()
        self._conn.executemany(
            """
            INSERT INTO price_records (
                store_sku_id, raw_list_price, raw_sale_price,
                calibrated_price, pum_price, in_stock, source_origin, captured_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    str(r["store_sku_id"]),
                    str(r["raw_list_price"]),
                    str(r["raw_sale_price"]),
                    str(r["calibrated_price"]),
                    str(r["pum_price"]),
                    1 if r.get("in_stock", True) else 0,
                    str(r.get("source_origin") or "local"),
                    now_iso,
                )
                for r in rows
            ],
        )
        self._conn.commit()
        return len(rows)

    async def touch_store_skus_verified(self, store_sku_ids: list[str]) -> int:
        if not store_sku_ids:
            return 0
        now_iso = datetime.now(UTC).isoformat()
        updated = 0
        for start in range(0, len(store_sku_ids), 400):
            chunk = store_sku_ids[start : start + 400]
            placeholders = ",".join("?" for _ in chunk)
            cur = self._conn.execute(
                f"UPDATE store_skus SET last_verified_at = ? WHERE id IN ({placeholders})",
                [now_iso, *chunk],
            )
            updated += cur.rowcount
        self._conn.commit()
        return updated

    async def flag_shrinkflation(
        self,
        master_product_id: str,
        *,
        previous_net_content: Decimal,
        current_net_content: Decimal,
    ) -> None:
        self._conn.execute(
            """
            UPDATE master_products
            SET shrinkflation_alert = 1, previous_net_content = ?, net_content = ?
            WHERE id = ?
            """,
            (str(previous_net_content), str(current_net_content), master_product_id),
        )
        self._conn.commit()
