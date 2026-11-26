"""Recupera `image_url` faltantes de forma determinista desde APIs VTEX (`skuId` y `EAN`) hacia `local_staging.db`.

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.backfill_missing_images_vtex
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sqlite3
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.normalizer import normalize_ean
from etl.scrapers.vtex_scraper import (
    VTEX_FALLBACK_API_HOSTS,
    VTEX_SEARCH_ENDPOINT,
    VTEX_STORE_CONFIGS,
)

logger = logging.getLogger("etl.backfill_missing_images_vtex")
BATCH_SIZE = 40
PER_STORE_CONCURRENCY = 4


@dataclass(slots=True)
class ImageBackfillStats:
    missing_masters_before: int = 0
    vtex_skus_queried: int = 0
    vtex_skus_found_img: int = 0
    eans_queried: int = 0
    eans_found_img: int = 0
    masters_updated: int = 0
    missing_masters_after: int = 0


def _vtex_host(store_id: str) -> str | None:
    if store_id in VTEX_FALLBACK_API_HOSTS:
        return VTEX_FALLBACK_API_HOSTS[store_id].rstrip("/")
    cfg = VTEX_STORE_CONFIGS.get(store_id)
    return cfg.base_url.rstrip("/") if cfg else None


def _extract_images_from_vtex_products(
    products: list[dict[str, Any]],
    wanted_skus: set[str],
    wanted_eans: set[str] | None = None,
) -> tuple[dict[str, str], dict[str, str]]:
    by_sku: dict[str, str] = {}
    by_ean: dict[str, str] = {}
    for prod in products:
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
        if not fallback_img:
            continue
        for it in items:
            item_img: str | None = None
            for img in it.get("images") or []:
                url = (img.get("imageUrl") or "").strip()
                if url:
                    item_img = url
                    break
            chosen = item_img or fallback_img
            item_id = str(it.get("itemId") or "").strip()
            if item_id and item_id in wanted_skus:
                by_sku[item_id] = chosen
            if wanted_eans:
                ean = normalize_ean(it.get("ean"))
                if ean and ean in wanted_eans:
                    by_ean[ean] = chosen
    return by_sku, by_ean


async def _fetch_store_images_by_sku(
    client: httpx.AsyncClient,
    store_id: str,
    skus: list[str],
) -> dict[str, str]:
    host = _vtex_host(store_id)
    if not host or not skus:
        return {}
    sem = asyncio.Semaphore(PER_STORE_CONCURRENCY)
    batches = [skus[i : i + BATCH_SIZE] for i in range(0, len(skus), BATCH_SIZE)]
    found: dict[str, str] = {}
    url = f"{host}{VTEX_SEARCH_ENDPOINT}"

    async def _run_batch(batch: list[str]) -> None:
        params: list[tuple[str, str]] = [("_from", "0"), ("_to", "49")]
        params.extend(("fq", f"skuId:{s}") for s in batch)
        wanted = set(batch)
        async with sem:
            for attempt in range(3):
                try:
                    resp = await client.get(url, params=params, timeout=25.0)
                    if resp.status_code in (200, 206):
                        data = resp.json()
                        if isinstance(data, list):
                            sku_imgs, _ = _extract_images_from_vtex_products(data, wanted)
                            found.update(sku_imgs)
                        return
                    if resp.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                        await asyncio.sleep(1.0 * (attempt + 1))
                        continue
                    return
                except Exception:
                    if attempt < 2:
                        await asyncio.sleep(1.0 * (attempt + 1))
                        continue
                    return

    await asyncio.gather(*(_run_batch(b) for b in batches))
    logger.info("[%s] VTEX skuId imágenes: %d / %d", store_id, len(found), len(skus))
    return found


async def _fetch_images_by_ean(
    client: httpx.AsyncClient,
    eans: list[str],
) -> dict[str, str]:
    if not eans:
        return {}
    found: dict[str, str] = {}
    sem = asyncio.Semaphore(4)
    # Consultar Éxito, Jumbo, Olímpica y Carulla en cascada para EANs restantes
    for store_id in ("exito", "jumbo", "olimpica", "carulla"):
        remaining = [e for e in eans if e not in found]
        if not remaining:
            break
        host = _vtex_host(store_id)
        if not host:
            continue
        url = f"{host}{VTEX_SEARCH_ENDPOINT}"
        batches = [remaining[i : i + 25] for i in range(0, len(remaining), 25)]

        async def _run_ean_batch(batch: list[str]) -> None:
            params: list[tuple[str, str]] = [("_from", "0"), ("_to", "49")]
            params.extend(("fq", f"alternateIds_Ean:{e}") for e in batch)
            wanted_e = set(batch)
            async with sem:
                for attempt in range(2):
                    try:
                        resp = await client.get(url, params=params, timeout=25.0)
                        if resp.status_code in (200, 206):
                            data = resp.json()
                            if isinstance(data, list):
                                _, ean_imgs = _extract_images_from_vtex_products(
                                    data, set(), wanted_eans=wanted_e
                                )
                                found.update(ean_imgs)
                            return
                        if resp.status_code in (429, 500, 502, 503, 504) and attempt == 0:
                            await asyncio.sleep(1.0)
                            continue
                        return
                    except Exception:
                        if attempt == 0:
                            await asyncio.sleep(1.0)
                            continue
                        return

        await asyncio.gather(*(_run_ean_batch(b) for b in batches))
        logger.info("[%s] EAN fallback imágenes acumuladas: %d / %d", store_id, len(found), len(eans))
    return found


async def backfill_missing_images_vtex(
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
) -> ImageBackfillStats:
    stats = ImageBackfillStats()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT m.id AS mid, m.ean, s.store_id, s.external_sku
            FROM master_products m
            JOIN store_skus s ON s.master_product_id = m.id
            WHERE s.is_mercado = 1
              AND (m.image_url IS NULL OR TRIM(m.image_url) = '')
            """
        ).fetchall()

        master_eans: dict[str, str] = {}
        skus_by_store: dict[str, list[str]] = defaultdict(list)
        master_by_store_sku: dict[tuple[str, str], str] = {}
        all_missing_mids: set[str] = set()

        for r in rows:
            mid = str(r["mid"])
            all_missing_mids.add(mid)
            if r["ean"]:
                master_eans[mid] = str(r["ean"])
            st = str(r["store_id"])
            ext = str(r["external_sku"])
            if st in VTEX_STORE_CONFIGS and ext.isdigit():
                skus_by_store[st].append(ext)
                master_by_store_sku[(st, ext)] = mid

        stats.missing_masters_before = len(all_missing_mids)
        stats.vtex_skus_queried = sum(len(v) for v in skus_by_store.values())

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
        limits = httpx.Limits(max_connections=60, max_keepalive_connections=40)
        resolved_master_imgs: dict[str, str] = {}

        async with httpx.AsyncClient(headers=headers, follow_redirects=True, limits=limits) as client:
            tasks = [
                _fetch_store_images_by_sku(client, st, sorted(set(skus)))
                for st, skus in sorted(skus_by_store.items())
            ]
            store_keys = sorted(skus_by_store.keys())
            store_results = await asyncio.gather(*tasks)
            for st, sku_map in zip(store_keys, store_results):
                stats.vtex_skus_found_img += len(sku_map)
                for ext, img_url in sku_map.items():
                    mid = master_by_store_sku.get((st, ext))
                    if mid and mid not in resolved_master_imgs:
                        resolved_master_imgs[mid] = img_url

            # Fallback por EAN para maestros aún sin imagen que tengan EAN
            remaining_eans = sorted(
                {
                    ean
                    for mid, ean in master_eans.items()
                    if mid not in resolved_master_imgs
                }
            )
            stats.eans_queried = len(remaining_eans)
            ean_imgs = await _fetch_images_by_ean(client, remaining_eans)
            stats.eans_found_img = len(ean_imgs)
            for mid, ean in master_eans.items():
                if mid not in resolved_master_imgs and ean in ean_imgs:
                    resolved_master_imgs[mid] = ean_imgs[ean]

        if resolved_master_imgs:
            conn.executemany(
                "UPDATE master_products SET image_url = ? WHERE id = ? AND (image_url IS NULL OR TRIM(image_url) = '')",
                [(img, mid) for mid, img in resolved_master_imgs.items()],
            )
            conn.commit()
        stats.masters_updated = len(resolved_master_imgs)
        stats.missing_masters_after = int(
            conn.execute(
                """
                SELECT COUNT(DISTINCT m.id)
                FROM master_products m
                JOIN store_skus s ON s.master_product_id = m.id
                WHERE s.is_mercado = 1
                  AND (m.image_url IS NULL OR TRIM(m.image_url) = '')
                """
            ).fetchone()[0]
        )
    finally:
        conn.close()
    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(description="Recupera imágenes faltantes desde VTEX hacia local_staging.db.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    args = parser.parse_args(argv)
    st = asyncio.run(backfill_missing_images_vtex(Path(args.db)))
    print(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
