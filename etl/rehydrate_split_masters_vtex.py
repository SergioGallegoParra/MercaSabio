"""Re-hidrata de forma determinista `brand`, `ean` e `image_url` de maestros creados por split usando APIs VTEX.

Opera 100% Local-First sobre `etl/data/local_staging.db`.
Solo aplica cambios verificados directamente contra el catálogo oficial VTEX del supermercado.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import re
import sqlite3
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from etl.core.canonical_mapper import is_store_private_label
from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.match_safety import brands_compatible
from etl.core.normalizer import normalize_ean
from etl.scrapers.vtex_scraper import (
    VTEX_FALLBACK_API_HOSTS,
    VTEX_SEARCH_ENDPOINT,
    VTEX_STORE_CONFIGS,
)

logger = logging.getLogger("etl.rehydrate_split_masters_vtex")

DEFAULT_SNAPSHOT_PATH = Path("etl/data/supabase_snapshot.db")
DEFAULT_PRE_MERGE_PATH = Path("etl/data/local_staging_pre_merge.db.bak")
BATCH_SIZE = 25


@dataclass(slots=True)
class RehydrateStats:
    candidates_scanned: int = 0
    vtex_skus_queried: int = 0
    vtex_skus_found: int = 0
    brands_updated: int = 0
    images_filled: int = 0
    eans_assigned: int = 0
    skus_merged_into_existing_ean: int = 0
    orphan_masters_deleted: int = 0


def _norm_text(s: str | None) -> str:
    ascii_s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", " ", ascii_s).strip()


def _brand_absent_from_name(brand: str | None, normalized_name: str | None, raw_name: str | None) -> bool:
    if not brand:
        return True
    bn = _norm_text(brand)
    if not bn or bn in ("generico", "generica", "sin marca", "varios", "na", "n a"):
        return True
    comb = f"{_norm_text(normalized_name)} {_norm_text(raw_name)}"
    bcomp = bn.replace(" ", "")
    toks = set(comb.split())
    btoks = [t for t in bn.split() if len(t) >= 2]
    in_name = (
        bn in comb
        or (len(bcomp) >= 3 and bcomp in toks)
        or (bool(btoks) and all(t in toks for t in btoks))
    )
    return not in_name


def _vtex_host_for_store(store_id: str) -> str | None:
    if store_id in VTEX_FALLBACK_API_HOSTS:
        return VTEX_FALLBACK_API_HOSTS[store_id].rstrip("/")
    cfg = VTEX_STORE_CONFIGS.get(store_id)
    if not cfg:
        return None
    return cfg.base_url.rstrip("/")


def _extract_sku_metadata_from_vtex(products: list[dict[str, Any]], wanted_skus: set[str]) -> dict[str, dict[str, str | None]]:
    found: dict[str, dict[str, str | None]] = {}
    for prod in products:
        brand = (prod.get("brand") or "").strip() or None
        items = prod.get("items") or []
        fallback_img: str | None = None
        for it in items:
            for img in it.get("images") or []:
                url = (img.get("imageUrl") or "").strip()
                if url:
                    fallback_img = url
                    break
            if fallback_img:
                break
        for it in items:
            item_id = str(it.get("itemId") or "").strip()
            if not item_id or item_id not in wanted_skus:
                continue
            ean = normalize_ean(it.get("ean"))
            img_url: str | None = None
            for img in it.get("images") or []:
                url = (img.get("imageUrl") or "").strip()
                if url:
                    img_url = url
                    break
            found[item_id] = {
                "brand": brand,
                "ean": ean,
                "image_url": img_url or fallback_img,
                "product_name": (prod.get("productName") or "").strip() or None,
            }
    return found


async def _fetch_store_skus_vtex(
    client: httpx.AsyncClient,
    store_id: str,
    skus: list[str],
    sem: asyncio.Semaphore,
) -> dict[str, dict[str, str | None]]:
    host = _vtex_host_for_store(store_id)
    if not host or not skus:
        return {}

    results: dict[str, dict[str, str | None]] = {}
    batches = [skus[i : i + BATCH_SIZE] for i in range(0, len(skus), BATCH_SIZE)]

    async def _run_batch(batch: list[str]) -> None:
        params = [("fq", f"skuId:{sku}") for sku in batch]
        url = f"{host}{VTEX_SEARCH_ENDPOINT}"
        wanted = set(batch)
        async with sem:
            for attempt in range(2):
                try:
                    resp = await client.get(url, params=params, timeout=20.0)
                    if resp.status_code in (200, 206):
                        data = resp.json()
                        if isinstance(data, list):
                            results.update(_extract_sku_metadata_from_vtex(data, wanted))
                        return
                    if resp.status_code in (429, 500, 502, 503, 504) and attempt == 0:
                        await asyncio.sleep(1.0)
                        continue
                    logger.warning("[%s] VTEX batch HTTP %s (size=%d)", store_id, resp.status_code, len(batch))
                    return
                except Exception as exc:
                    if attempt == 0:
                        await asyncio.sleep(0.8)
                        continue
                    logger.warning("[%s] VTEX batch error: %s", store_id, exc)
                    return

    await asyncio.gather(*(_run_batch(b) for b in batches))
    return results


async def rehydrate_split_masters_vtex(
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    *,
    dry_run: bool = False,
    concurrency: int = 8,
) -> tuple[RehydrateStats, list[dict[str, Any]]]:
    stats = RehydrateStats()
    brand_changes: list[dict[str, Any]] = []

    old_mids: set[str] = set()
    for ref_path in (DEFAULT_SNAPSHOT_PATH, DEFAULT_PRE_MERGE_PATH):
        if ref_path.exists():
            c_ref = sqlite3.connect(str(ref_path))
            old_mids.update(r[0] for r in c_ref.execute("SELECT id FROM master_products").fetchall())
            c_ref.close()

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT m.id AS mid, m.ean, m.normalized_name, m.brand, m.net_content, m.unit_measure,
                   m.image_url, m.is_private_label,
                   s.id AS sku_uuid, s.store_id, s.external_sku, s.raw_name
            FROM master_products m
            JOIN store_skus s ON s.master_product_id = m.id
            WHERE m.ean IS NULL
            """
        ).fetchall()

        masters_map: dict[str, dict[str, Any]] = {}
        skus_by_master: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in rows:
            mid = str(r["mid"])
            if old_mids and mid in old_mids:
                continue
            if mid not in masters_map:
                masters_map[mid] = {
                    "id": mid,
                    "ean": r["ean"],
                    "normalized_name": r["normalized_name"],
                    "brand": r["brand"],
                    "net_content": str(r["net_content"]),
                    "unit_measure": str(r["unit_measure"]),
                    "image_url": r["image_url"],
                    "is_private_label": int(r["is_private_label"] or 0),
                }
            skus_by_master[mid].append(
                {
                    "id": str(r["sku_uuid"]),
                    "store_id": str(r["store_id"]),
                    "external_sku": str(r["external_sku"]),
                    "raw_name": str(r["raw_name"]),
                }
            )

        # Seleccionar maestros candidatos con brand ausente del nombre (o sin brand) y al menos 1 SKU VTEX
        skus_to_query_by_store: dict[str, set[str]] = defaultdict(set)
        candidate_mids: list[str] = []
        for mid, mp in masters_map.items():
            skus = skus_by_master[mid]
            sample_raw = skus[0]["raw_name"]
            if not _brand_absent_from_name(mp["brand"], mp["normalized_name"], sample_raw):
                continue
            vtex_skus = [s for s in skus if s["store_id"] in VTEX_STORE_CONFIGS and s["external_sku"].isdigit()]
            if not vtex_skus:
                continue
            candidate_mids.append(mid)
            for s in vtex_skus:
                skus_to_query_by_store[s["store_id"]].add(s["external_sku"])

        stats.candidates_scanned = len(candidate_mids)
        stats.vtex_skus_queried = sum(len(v) for v in skus_to_query_by_store.values())
        logger.info(
            "Candidatos split VTEX: %d maestros (%d SKUs en %d tiendas)",
            stats.candidates_scanned,
            stats.vtex_skus_queried,
            len(skus_to_query_by_store),
        )

        # Consultar VTEX en paralelo por tienda
        vtex_meta: dict[tuple[str, str], dict[str, str | None]] = {}
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
        sem = asyncio.Semaphore(concurrency)
        async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
            tasks = [
                _fetch_store_skus_vtex(client, store_id, sorted(sku_set), sem)
                for store_id, sku_set in skus_to_query_by_store.items()
            ]
            store_ids = list(skus_to_query_by_store.keys())
            store_results = await asyncio.gather(*tasks)
            for store_id, res_map in zip(store_ids, store_results):
                for ext_sku, meta in res_map.items():
                    vtex_meta[(store_id, ext_sku)] = meta

        stats.vtex_skus_found = len(vtex_meta)
        logger.info("SKUs recuperados desde API VTEX: %d / %d", stats.vtex_skus_found, stats.vtex_skus_queried)

        # Índice de EANs ya existentes en master_products para evitar UNIQUE constraint y poder fusionar seguros
        existing_ean_map: dict[str, dict[str, Any]] = {}
        for r in conn.execute(
            "SELECT id, ean, brand, net_content, unit_measure, image_url FROM master_products WHERE ean IS NOT NULL"
        ).fetchall():
            existing_ean_map[str(r["ean"])] = dict(r)

        for mid in candidate_mids:
            mp = masters_map[mid]
            skus = skus_by_master[mid]
            matched_metas = [
                (s, vtex_meta[(s["store_id"], s["external_sku"])])
                for s in skus
                if (s["store_id"], s["external_sku"]) in vtex_meta
            ]
            if not matched_metas:
                continue

            # Consenso determinista: si hay varios SKUs en el mismo maestro, elegir primera metadata con marca/imagen/ean
            rep_sku, rep_meta = matched_metas[0]
            off_brand = rep_meta.get("brand")
            off_ean = rep_meta.get("ean")
            off_img = rep_meta.get("image_url")

            # Verificar si el EAN oficial ya existe en otro maestro compatible (mismo net_content y unit_measure)
            if off_ean and off_ean in existing_ean_map:
                target_mp = existing_ean_map[off_ean]
                if (
                    str(target_mp["id"]) != mid
                    and str(target_mp["net_content"]) == mp["net_content"]
                    and str(target_mp["unit_measure"]) == mp["unit_measure"]
                    and (not off_brand or not target_mp["brand"] or brands_compatible(off_brand, target_mp["brand"]))
                ):
                    if not dry_run:
                        for s in skus:
                            conn.execute(
                                "UPDATE store_skus SET master_product_id = ? WHERE id = ?",
                                (target_mp["id"], s["id"]),
                            )
                        if not target_mp["image_url"] and off_img:
                            conn.execute(
                                "UPDATE master_products SET image_url = ? WHERE id = ? AND image_url IS NULL",
                                (off_img, target_mp["id"]),
                            )
                            target_mp["image_url"] = off_img
                            stats.images_filled += 1
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO product_price_daily (master_product_id, store_id, day, min_price, median_price, samples_count)
                            SELECT ?, store_id, day, min_price, median_price, samples_count
                            FROM product_price_daily WHERE master_product_id = ?
                            """,
                            (target_mp["id"], mid),
                        )
                        conn.execute("DELETE FROM product_price_daily WHERE master_product_id = ?", (mid,))
                        conn.execute("DELETE FROM master_products WHERE id = ?", (mid,))
                    stats.skus_merged_into_existing_ean += len(skus)
                    stats.orphan_masters_deleted += 1
                    brand_changes.append(
                        {
                            "action": "merged_to_ean",
                            "store": rep_sku["store_id"],
                            "raw_name": rep_sku["raw_name"],
                            "old_brand": mp["brand"],
                            "new_brand": target_mp["brand"] or off_brand,
                            "ean": off_ean,
                        }
                    )
                    continue

            # Si no se fusiona, actualizar brand / image_url / ean directamente en este maestro
            updates: dict[str, Any] = {}
            if off_brand and _norm_text(off_brand) != _norm_text(mp["brand"]):
                updates["brand"] = off_brand
                updates["is_private_label"] = 1 if is_store_private_label(rep_sku["store_id"], off_brand, off_ean) else 0
                stats.brands_updated += 1
                brand_changes.append(
                    {
                        "action": "brand_updated",
                        "store": rep_sku["store_id"],
                        "raw_name": rep_sku["raw_name"],
                        "old_brand": mp["brand"],
                        "new_brand": off_brand,
                        "ean": off_ean,
                    }
                )
            if not mp["image_url"] and off_img:
                updates["image_url"] = off_img
                stats.images_filled += 1
            if off_ean and off_ean not in existing_ean_map:
                updates["ean"] = off_ean
                existing_ean_map[off_ean] = {
                    "id": mid,
                    "ean": off_ean,
                    "brand": updates.get("brand", mp["brand"]),
                    "net_content": mp["net_content"],
                    "unit_measure": mp["unit_measure"],
                    "image_url": updates.get("image_url", mp["image_url"]),
                }
                stats.eans_assigned += 1

            if updates and not dry_run:
                set_clause = ", ".join(f"{k} = ?" for k in updates)
                conn.execute(
                    f"UPDATE master_products SET {set_clause} WHERE id = ?",
                    (*updates.values(), mid),
                )

        if not dry_run:
            conn.commit()
    finally:
        conn.close()

    return stats, brand_changes


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser(description="Re-hidrata maestros split desde APIs VTEX (local-first).")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    stats, changes = asyncio.run(rehydrate_split_masters_vtex(Path(args.db), dry_run=args.dry_run))
    print(stats)
    print(f"\nSample changes ({len(changes)} total):")
    for ch in changes[:25]:
        print(
            f"  - [{ch['action']}] [{ch['store']}] {ch['raw_name']} | "
            f"{ch['old_brand']!r} -> {ch['new_brand']!r} | ean={ch['ean']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
