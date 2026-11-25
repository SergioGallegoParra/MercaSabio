"""Descarga de forma determinista el `raw_category_path` oficial de las 9 tiendas VTEX hacia `local_staging.db`.

Opera 100% Local-First sobre `etl/data/local_staging.db`:
- Añade la columna `store_skus.raw_category_path` si no existe.
- Consulta las APIs VTEX por lotes de 40 `skuId` por petición, en paralelo por tienda.
- Persiste la ruta más específica reportada por la tienda (p.ej. `Mercado > Carnes y Pescados > Pollo`).
- Es completamente reanudable: solo consulta SKUs con `raw_category_path IS NULL`.

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.backfill_store_categories_vtex
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
from etl.scrapers.vtex_scraper import (
    VTEX_FALLBACK_API_HOSTS,
    VTEX_SEARCH_ENDPOINT,
    VTEX_STORE_CONFIGS,
)

logger = logging.getLogger("etl.backfill_store_categories_vtex")

BATCH_SIZE = 40
PER_STORE_CONCURRENCY = 4


@dataclass(slots=True)
class StoreBackfillResult:
    store_id: str
    queried: int = 0
    found: int = 0
    batches_failed: int = 0
    elapsed_s: float = 0.0


def _vtex_host_for_store(store_id: str) -> str | None:
    if store_id in VTEX_FALLBACK_API_HOSTS:
        return VTEX_FALLBACK_API_HOSTS[store_id].rstrip("/")
    cfg = VTEX_STORE_CONFIGS.get(store_id)
    if not cfg:
        return None
    return cfg.base_url.rstrip("/")


def _extract_best_category_path(raw_categories: Any) -> str | None:
    if not isinstance(raw_categories, list):
        return None
    paths: list[list[str]] = []
    for entry in raw_categories:
        if not isinstance(entry, str):
            continue
        segs = [s.strip() for s in entry.strip("/").split("/") if s.strip()]
        if segs:
            paths.append(segs)
    if not paths:
        return None
    best = max(paths, key=lambda segs: (len(segs), sum(len(s) for s in segs)))
    return " > ".join(best)[:500]


def _extract_categories_by_sku(
    products: list[dict[str, Any]], wanted: set[str]
) -> dict[str, str]:
    found: dict[str, str] = {}
    for prod in products:
        cat_path = _extract_best_category_path(prod.get("categories"))
        if not cat_path:
            continue
        for it in prod.get("items") or []:
            item_id = str(it.get("itemId") or "").strip()
            if item_id and item_id in wanted:
                found[item_id] = cat_path
    return found


async def _fetch_store_categories(
    client: httpx.AsyncClient,
    store_id: str,
    skus: list[str],
    per_store_concurrency: int = PER_STORE_CONCURRENCY,
) -> tuple[StoreBackfillResult, dict[str, str]]:
    t0 = time.monotonic()
    res = StoreBackfillResult(store_id=store_id, queried=len(skus))
    host = _vtex_host_for_store(store_id)
    if not host or not skus:
        return res, {}

    sem = asyncio.Semaphore(per_store_concurrency)
    batches = [skus[i : i + BATCH_SIZE] for i in range(0, len(skus), BATCH_SIZE)]
    cat_by_sku: dict[str, str] = {}
    url = f"{host}{VTEX_SEARCH_ENDPOINT}"

    async def _run_batch(batch: list[str]) -> None:
        params: list[tuple[str, str]] = [("_from", "0"), ("_to", "49")]
        params.extend(("fq", f"skuId:{sku}") for sku in batch)
        wanted = set(batch)
        async with sem:
            for attempt in range(3):
                try:
                    resp = await client.get(url, params=params, timeout=25.0)
                    if resp.status_code in (200, 206):
                        data = resp.json()
                        if isinstance(data, list):
                            cat_by_sku.update(_extract_categories_by_sku(data, wanted))
                        return
                    if resp.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                        await asyncio.sleep(1.0 * (attempt + 1))
                        continue
                    res.batches_failed += 1
                    return
                except Exception:
                    if attempt < 2:
                        await asyncio.sleep(1.0 * (attempt + 1))
                        continue
                    res.batches_failed += 1
                    return

    await asyncio.gather(*(_run_batch(b) for b in batches))
    res.found = len(cat_by_sku)
    res.elapsed_s = time.monotonic() - t0
    logger.info(
        "[%s] Completado: %d / %d SKUs con categoría oficial (%.1f%%) | fallos=%d | %.1fs",
        store_id,
        res.found,
        res.queried,
        (res.found * 100.0 / res.queried) if res.queried else 0.0,
        res.batches_failed,
        res.elapsed_s,
    )
    return res, cat_by_sku


def ensure_raw_category_path_column(conn: sqlite3.Connection) -> None:
    cols = {str(r[1]) for r in conn.execute("PRAGMA table_info(store_skus)").fetchall()}
    if "raw_category_path" not in cols:
        conn.execute("ALTER TABLE store_skus ADD COLUMN raw_category_path TEXT")
        conn.commit()


async def backfill_store_categories_vtex(
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    *,
    stores: list[str] | None = None,
    per_store_concurrency: int = PER_STORE_CONCURRENCY,
) -> list[StoreBackfillResult]:
    conn = sqlite3.connect(str(db_path))
    try:
        ensure_raw_category_path_column(conn)
        target_stores = sorted(stores) if stores else sorted(VTEX_STORE_CONFIGS.keys())
        placeholders = ",".join("?" for _ in target_stores)
        rows = conn.execute(
            f"""
            SELECT store_id, external_sku
            FROM store_skus
            WHERE store_id IN ({placeholders})
              AND (raw_category_path IS NULL OR TRIM(raw_category_path) = '')
              AND external_sku GLOB '[0-9]*'
              AND external_sku NOT GLOB '*[^0-9]*'
            """,
            target_stores,
        ).fetchall()

        skus_by_store: dict[str, list[str]] = defaultdict(list)
        for st, sku in rows:
            skus_by_store[str(st)].append(str(sku))

        total_skus = sum(len(v) for v in skus_by_store.values())
        logger.info(
            "Iniciando descarga de categorías oficiales VTEX: %d SKUs en %d tiendas",
            total_skus,
            len(skus_by_store),
        )
        if not total_skus:
            return []

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
        limits = httpx.Limits(max_connections=60, max_keepalive_connections=40)
        results: list[StoreBackfillResult] = []
        async with httpx.AsyncClient(headers=headers, follow_redirects=True, limits=limits) as client:
            tasks = [
                _fetch_store_categories(client, st, skus, per_store_concurrency=per_store_concurrency)
                for st, skus in sorted(skus_by_store.items())
            ]
            for coro in asyncio.as_completed(tasks):
                res, cat_map = await coro
                results.append(res)
                if cat_map:
                    conn.executemany(
                        "UPDATE store_skus SET raw_category_path = ? WHERE store_id = ? AND external_sku = ?",
                        [(cat_path, res.store_id, sku) for sku, cat_path in cat_map.items()],
                    )
                    conn.commit()
    finally:
        conn.close()

    results.sort(key=lambda r: r.store_id)
    return results


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(description="Descarga raw_category_path oficial desde VTEX hacia local_staging.db.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--store", action="append", help="Filtrar una o más tiendas VTEX específicas")
    parser.add_argument("--concurrency", type=int, default=PER_STORE_CONCURRENCY)
    args = parser.parse_args(argv)

    results = asyncio.run(
        backfill_store_categories_vtex(
            Path(args.db),
            stores=args.store,
            per_store_concurrency=args.concurrency,
        )
    )
    tot_q = sum(r.queried for r in results)
    tot_f = sum(r.found for r in results)
    print(f"\nResumen total VTEX: {tot_f:,} / {tot_q:,} SKUs con categoría oficial ({(tot_f*100/tot_q) if tot_q else 0:.1f}%)")
    for r in results:
        print(f"  {r.store_id:14s}: {r.found:6,d} / {r.queried:6,d} ({(r.found*100/r.queried) if r.queried else 0:5.1f}%) | fail={r.batches_failed} | {r.elapsed_s:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
