"""Recupera `image_url` faltantes desde APIs/endpoints oficiales no-VTEX hacia `local_staging.db`.

Soporta:
  - Farmatodo (Algolia `objects` batch)
  - D1 (VTEX `d1tiendas.vtexcommercestable.com.br` `skuId`)
  - Ara (EAN embebido en `external_sku` -> match con maestros/VTEX)
  - Amy & Belalcázar (WooCommerce `/wp-json/wc/store/v1/products?include=...`)
  - Supermú (Shopify `{raw_url}.json`)
  - Superboom (Odoo `/web/image/product.template/{id}/image_512` verificado HTTP 200)
  - Mercamío (Waco `all_paginate`)
  - Cañaveral (PDP `photosUrl` / GCS `e-products/{sku}.webp`)
  - Makro (PDP `photosUrl`)

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.backfill_missing_images_nonvtex
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.normalizer import normalize_ean
from etl.scrapers.farmatodo_scraper import (
    FARMATODO_ALGOLIA_API_KEY,
    FARMATODO_ALGOLIA_APP_ID,
    FARMATODO_ALGOLIA_INDEX,
)
from etl.scrapers.mercamio_scraper import default_mercamio_config
from etl.scrapers.vtex_scraper import VTEX_FALLBACK_API_HOSTS, VTEX_SEARCH_ENDPOINT, VTEX_STORE_CONFIGS

logger = logging.getLogger("etl.backfill_missing_images_nonvtex")

_PHOTOS_URL_RX = re.compile(r'photosUrl\\?":\[\\?"(https://[^"\\]+)')


@dataclass(slots=True)
class NonVtexImageStats:
    missing_before: int = 0
    recovered_by_store: dict[str, int] | None = None
    total_masters_updated: int = 0
    missing_after: int = 0


async def _recover_farmatodo(client: httpx.AsyncClient, skus: list[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    url = f"https://{FARMATODO_ALGOLIA_APP_ID.lower()}-dsn.algolia.net/1/indexes/*/objects"
    headers = {
        "X-Algolia-Application-Id": FARMATODO_ALGOLIA_APP_ID,
        "X-Algolia-API-Key": FARMATODO_ALGOLIA_API_KEY,
        "Content-Type": "application/json",
    }
    for i in range(0, len(skus), 200):
        batch = skus[i : i + 200]
        body = {"requests": [{"indexName": FARMATODO_ALGOLIA_INDEX, "objectID": s} for s in batch]}
        try:
            resp = await client.post(url, headers=headers, json=body, timeout=20.0)
            if resp.status_code == 200:
                for hit in resp.json().get("results") or []:
                    if not isinstance(hit, dict):
                        continue
                    oid = str(hit.get("id") or hit.get("objectID") or "").strip()
                    img = str(hit.get("mediaImageUrl") or "").strip()
                    if oid and img.startswith("http"):
                        found[oid] = img
        except Exception as exc:
            logger.warning("[farmatodo] Algolia error: %s", exc)
    logger.info("[farmatodo] Algolia imágenes: %d / %d", len(found), len(skus))
    return found


async def _recover_d1(client: httpx.AsyncClient, skus: list[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    url = "https://d1tiendas.vtexcommercestable.com.br/api/catalog_system/pub/products/search"
    for i in range(0, len(skus), 25):
        batch = skus[i : i + 25]
        params: list[tuple[str, str]] = [("_from", "0"), ("_to", "49")]
        params.extend(("fq", f"skuId:{s}") for s in batch)
        try:
            resp = await client.get(url, params=params, timeout=20.0)
            if resp.status_code in (200, 206):
                data = resp.json()
                if isinstance(data, list):
                    for prod in data:
                        for it in prod.get("items") or []:
                            item_id = str(it.get("itemId") or "").strip()
                            for img in it.get("images") or []:
                                u = str(img.get("imageUrl") or "").strip()
                                if u and item_id:
                                    found[item_id] = u
                                    break
        except Exception as exc:
            logger.warning("[d1] VTEX error: %s", exc)
    logger.info("[d1] VTEX imágenes: %d / %d", len(found), len(skus))
    return found


async def _recover_woocommerce(
    client: httpx.AsyncClient, store_id: str, base_url: str, skus: list[str]
) -> dict[str, str]:
    found: dict[str, str] = {}
    numeric = [s for s in skus if s.isdigit()]
    for i in range(0, len(numeric), 50):
        batch = numeric[i : i + 50]
        try:
            resp = await client.get(
                f"{base_url.rstrip('/')}/wp-json/wc/store/v1/products",
                params={"include": ",".join(batch), "per_page": 50},
                timeout=20.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    for prod in data:
                        pid = str(prod.get("id") or "").strip()
                        imgs = prod.get("images") or []
                        if pid and imgs and isinstance(imgs[0], dict):
                            src = str(imgs[0].get("src") or "").strip()
                            if src.startswith("http"):
                                found[pid] = src
        except Exception as exc:
            logger.warning("[%s] WooCommerce error: %s", store_id, exc)
    logger.info("[%s] WooCommerce imágenes: %d / %d", store_id, len(found), len(skus))
    return found


async def _recover_supermu(
    client: httpx.AsyncClient, rows: list[tuple[str, str | None]]
) -> dict[str, str]:
    found: dict[str, str] = {}
    sem = asyncio.Semaphore(8)

    async def _one(sku: str, raw_url: str | None) -> None:
        if not raw_url or "/products/" not in raw_url:
            return
        json_url = raw_url.split("?", 1)[0].rstrip("/") + ".json"
        async with sem:
            try:
                resp = await client.get(json_url, timeout=15.0)
                if resp.status_code == 200:
                    imgs = (resp.json().get("product") or {}).get("images") or []
                    if imgs and isinstance(imgs[0], dict):
                        src = str(imgs[0].get("src") or "").strip()
                        if src.startswith("http"):
                            found[sku] = src
            except Exception:
                return

    await asyncio.gather(*(_one(s, u) for s, u in rows))
    logger.info("[supermu] Shopify imágenes: %d / %d", len(found), len(rows))
    return found


async def _recover_superboom(
    client: httpx.AsyncClient, rows: list[tuple[str, str | None]]
) -> dict[str, str]:
    found: dict[str, str] = {}
    sem = asyncio.Semaphore(10)

    async def _one(sku: str, raw_url: str | None) -> None:
        if not raw_url:
            return
        m = re.search(r"-(\d+)$", raw_url.split("?", 1)[0].rstrip("/"))
        if not m:
            return
        img_url = f"https://web.superboom.net/web/image/product.template/{m.group(1)}/image_512"
        async with sem:
            try:
                resp = await client.head(img_url, timeout=12.0)
                if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("image/"):
                    clen = int(resp.headers.get("content-length") or 0)
                    # Ignorar placeholder transparente minúsculo si existiera
                    if clen == 0 or clen > 1200:
                        found[sku] = img_url
            except Exception:
                return

    await asyncio.gather(*(_one(s, u) for s, u in rows))
    logger.info("[superboom] Odoo imágenes: %d / %d", len(found), len(rows))
    return found


async def _recover_mercamio(client: httpx.AsyncClient, wanted_skus: set[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    cfg = default_mercamio_config()
    headers = dict(cfg.default_headers)
    # Descubrir todas las páginas de all_paginate
    base = cfg.base_url.rstrip("/")
    page = 0
    total_pages = 100
    while page < total_pages and len(found) < len(wanted_skus):
        try:
            resp = await client.get(
                f"{base}/api/v1/products/all_paginate",
                params={"page": page, "limitPerPage": 200},
                headers=headers,
                timeout=20.0,
            )
            if resp.status_code != 200:
                break
            box = (resp.json() or {}).get("data") or {}
            items = box.get("list") or []
            if not items:
                break
            for it in items:
                if not isinstance(it, dict):
                    continue
                img = str(it.get("photoUrl") or it.get("imageUrl") or "").strip()
                if not img.startswith("http"):
                    continue
                for k in (str(it.get("id_item") or "").strip(), str(it.get("id") or "").strip()):
                    if k and k in wanted_skus:
                        found[k] = img
            pag = box.get("pagination") or {}
            if isinstance(pag.get("totalPages"), int):
                total_pages = pag["totalPages"]
            page += 1
        except Exception as exc:
            logger.warning("[mercamio] Error p=%d: %s", page, exc)
            break
    logger.info("[mercamio] Waco imágenes: %d / %d", len(found), len(wanted_skus))
    return found


async def _recover_instaleap_pdps(
    client: httpx.AsyncClient,
    store_id: str,
    rows: list[tuple[str, str | None]],
) -> dict[str, str]:
    found: dict[str, str] = {}
    sem = asyncio.Semaphore(12)

    async def _one(sku: str, raw_url: str | None) -> None:
        if not raw_url or "/p/" not in raw_url:
            return
        async with sem:
            try:
                resp = await client.get(raw_url, timeout=15.0)
                if resp.status_code == 200:
                    m = _PHOTOS_URL_RX.search(resp.text)
                    if m:
                        img = m.group(1).replace("\\u0026", "&").strip()
                        if img.startswith("http"):
                            found[sku] = img
            except Exception:
                return

    await asyncio.gather(*(_one(s, u) for s, u in rows))
    logger.info("[%s] Instaleap PDP imágenes: %d / %d", store_id, len(found), len(rows))
    return found


async def _recover_ara_via_sku_ean(
    client: httpx.AsyncClient, conn: sqlite3.Connection, skus: list[str]
) -> dict[str, str]:
    found: dict[str, str] = {}
    sku_to_ean: dict[str, str] = {}
    for s in skus:
        if "-" in s:
            cand = normalize_ean(s.split("-")[-1])
            if cand:
                sku_to_ean[s] = cand
    if not sku_to_ean:
        return found

    # 1. Buscar primero en master_products local que ya tienen ese EAN + imagen
    eans = sorted(set(sku_to_ean.values()))
    ean_imgs: dict[str, str] = {}
    for i in range(0, len(eans), 500):
        chunk = eans[i : i + 500]
        ph = ",".join("?" for _ in chunk)
        for ean, img in conn.execute(
            f"SELECT ean, image_url FROM master_products WHERE ean IN ({ph}) AND image_url IS NOT NULL AND TRIM(image_url) != ''",
            chunk,
        ).fetchall():
            ean_imgs[str(ean)] = str(img)

    # 2. Para EANs restantes, consultar Éxito/Jumbo/Carulla/Olímpica por alternateIds_Ean
    missing_eans = [e for e in eans if e not in ean_imgs]
    for st in ("exito", "jumbo", "olimpica", "carulla"):
        rem = [e for e in missing_eans if e not in ean_imgs]
        if not rem:
            break
        host = (VTEX_FALLBACK_API_HOSTS.get(st) or VTEX_STORE_CONFIGS[st].base_url).rstrip("/")
        for i in range(0, len(rem), 25):
            batch = rem[i : i + 25]
            params: list[tuple[str, str]] = [("_from", "0"), ("_to", "49")]
            params.extend(("fq", f"alternateIds_Ean:{e}") for e in batch)
            try:
                resp = await client.get(f"{host}{VTEX_SEARCH_ENDPOINT}", params=params, timeout=20.0)
                if resp.status_code in (200, 206):
                    for prod in resp.json() or []:
                        for it in prod.get("items") or []:
                            e = normalize_ean(it.get("ean"))
                            if e and e in batch:
                                for img in it.get("images") or []:
                                    u = str(img.get("imageUrl") or "").strip()
                                    if u:
                                        ean_imgs[e] = u
                                        break
            except Exception:
                continue

    for s, e in sku_to_ean.items():
        if e in ean_imgs:
            found[s] = ean_imgs[e]
    logger.info("[ara] EAN-en-SKU imágenes: %d / %d", len(found), len(skus))
    return found


async def backfill_missing_images_nonvtex(
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
) -> NonVtexImageStats:
    stats = NonVtexImageStats(recovered_by_store={})
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT m.id AS mid, s.store_id, s.external_sku, s.raw_url
            FROM master_products m
            JOIN store_skus s ON s.master_product_id = m.id
            WHERE s.is_mercado = 1
              AND (m.image_url IS NULL OR TRIM(m.image_url) = '')
            """
        ).fetchall()

        by_store: dict[str, list[tuple[str, str, str | None]]] = defaultdict(list)
        all_missing_mids: set[str] = set()
        for r in rows:
            mid = str(r["mid"])
            all_missing_mids.add(mid)
            by_store[str(r["store_id"])].append((mid, str(r["external_sku"]), r["raw_url"]))

        stats.missing_before = len(all_missing_mids)
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            "Accept": "application/json,text/html",
        }
        limits = httpx.Limits(max_connections=60, max_keepalive_connections=40)
        resolved_master_imgs: dict[str, str] = {}

        def _record(store_id: str, sku_img_map: dict[str, str]) -> None:
            sku_to_mid = {ext: mid for mid, ext, _u in by_store.get(store_id, [])}
            cnt = 0
            for ext, img in sku_img_map.items():
                mid = sku_to_mid.get(ext)
                if mid and mid not in resolved_master_imgs:
                    resolved_master_imgs[mid] = img
                    cnt += 1
            stats.recovered_by_store[store_id] = cnt  # type: ignore[index]

        async with httpx.AsyncClient(headers=headers, follow_redirects=True, limits=limits) as client:
            tasks = []
            task_stores = []
            if "farmatodo" in by_store:
                tasks.append(_recover_farmatodo(client, [x[1] for x in by_store["farmatodo"]]))
                task_stores.append("farmatodo")
            if "d1" in by_store:
                tasks.append(_recover_d1(client, [x[1] for x in by_store["d1"]]))
                task_stores.append("d1")
            if "amy" in by_store:
                tasks.append(_recover_woocommerce(client, "amy", "https://www.amy.com.co", [x[1] for x in by_store["amy"]]))
                task_stores.append("amy")
            if "belalcazar" in by_store:
                tasks.append(_recover_woocommerce(client, "belalcazar", "https://supermercadobelalcazar.com.co", [x[1] for x in by_store["belalcazar"]]))
                task_stores.append("belalcazar")
            if "supermu" in by_store:
                tasks.append(_recover_supermu(client, [(x[1], x[2]) for x in by_store["supermu"]]))
                task_stores.append("supermu")
            if "superboom" in by_store:
                tasks.append(_recover_superboom(client, [(x[1], x[2]) for x in by_store["superboom"]]))
                task_stores.append("superboom")
            if "mercamio" in by_store:
                tasks.append(_recover_mercamio(client, {x[1] for x in by_store["mercamio"]}))
                task_stores.append("mercamio")
            if "canaveral" in by_store:
                tasks.append(_recover_instaleap_pdps(client, "canaveral", [(x[1], x[2]) for x in by_store["canaveral"]]))
                task_stores.append("canaveral")
            if "makro" in by_store:
                tasks.append(_recover_instaleap_pdps(client, "makro", [(x[1], x[2]) for x in by_store["makro"]]))
                task_stores.append("makro")

            results = await asyncio.gather(*tasks)
            for st, res_map in zip(task_stores, results):
                _record(st, res_map)

            if "ara" in by_store:
                ara_map = await _recover_ara_via_sku_ean(client, conn, [x[1] for x in by_store["ara"]])
                _record("ara", ara_map)

        if resolved_master_imgs:
            conn.executemany(
                "UPDATE master_products SET image_url = ? WHERE id = ? AND (image_url IS NULL OR TRIM(image_url) = '')",
                [(img, mid) for mid, img in resolved_master_imgs.items()],
            )
            conn.commit()
        stats.total_masters_updated = len(resolved_master_imgs)
        stats.missing_after = int(
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
    parser = argparse.ArgumentParser(description="Recupera imágenes faltantes desde tiendas no-VTEX.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    args = parser.parse_args(argv)
    st = asyncio.run(backfill_missing_images_nonvtex(Path(args.db)))
    print(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
