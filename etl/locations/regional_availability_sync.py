"""Sincroniza disponibilidad regional por ciudad (`store_skus.available_cities`) usando VTEX y Algolia."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import os
import re
import unicodedata
from collections import defaultdict
from typing import Any

import httpx
import psycopg

from etl.locations.colombia_capitals_directory import COLOMBIA_CAPITALS_DIRECTORY
from etl.scrapers.farmatodo_scraper import (
    FARMATODO_ALGOLIA_API_KEY,
    FARMATODO_ALGOLIA_APP_ID,
    FARMATODO_ALGOLIA_INDEX,
    FARMATODO_GROCERY_SEARCH_TERMS,
)

logger = logging.getLogger("etl.locations.regional_availability_sync")

TARGET_REGIONAL_CITIES: tuple[str, ...] = (
    "Bogotá",
    "Medellín",
    "Cali",
    "Barranquilla",
    "Cartagena",
    "Bucaramanga",
    "Pereira",
    "Manizales",
    "Armenia",
    "Ibagué",
    "Cúcuta",
    "Santa Marta",
    "Villavicencio",
    "Montería",
    "Neiva",
    "Valledupar",
    "Pasto",
    "Tunja",
)

VTEX_REGIONAL_HOSTS: dict[str, str] = {
    "olimpica": "www.olimpica.com",
    "carulla": "carulla.vtexcommercestable.com.br",
    "exito": "exitocol.vtexcommercestable.com.br",
    "euro": "www.eurosupermercados.com.co",
}

CORE_GROCERY_PROBE_TERMS: tuple[str, ...] = (
    "arroz",
    "leche",
    "aceite",
    "huevo",
    "cafe",
    "azucar",
    "panela",
    "frijol",
    "lenteja",
    "pasta",
    "harina",
    "avena",
    "chocolate",
    "atun",
    "queso",
    "mantequilla",
    "yogurt",
    "pollo",
    "carne",
    "sal",
    "salsa",
    "detergente",
    "jabon",
    "papel higienico",
    "shampoo",
    "crema dental",
    "suavizante",
    "cloro",
)

FARMATODO_CITY_CODE_MAP: dict[str, str] = {
    "BOG": "bogota",
    "CHI": "bogota",
    "SOA": "bogota",
    "MED": "medellin",
    "ENV": "medellin",
    "ALI": "cali",
    "BAR": "barranquilla",
    "SOL": "barranquilla",
    "CTG": "cartagena",
    "BUC": "bucaramanga",
    "PIE": "bucaramanga",
    "PER": "pereira",
    "DOS": "pereira",
    "NIZ": "manizales",
    "ARM": "armenia",
    "IBA": "ibague",
    "SMR": "santa marta",
    "GAI": "santa marta",
    "IRO": "santa marta",
    "VVC": "villavicencio",
    "CUT": "cucuta",
    "TER": "monteria",
    "EIV": "neiva",
    "VUP": "valledupar",
}


def normalize_city_key(city: str | None) -> str:
    """Normaliza el nombre de ciudad a la clave usada en `store_skus.available_cities`."""
    if not city:
        return ""
    nfkd = unicodedata.normalize("NFKD", city)
    stripped = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    cleaned = re.sub(r"\s+", " ", stripped.lower()).strip()
    return cleaned


def extract_farmatodo_cities_from_hit(hit: dict[str, Any]) -> tuple[list[str], list[str], set[str]]:
    """Extrae `(sku_keys, eans, city_keys)` desde un hit Algolia de Farmatodo."""
    sku_keys: list[str] = []
    for raw_id in (hit.get("id"), hit.get("objectID")):
        if raw_id is not None and str(raw_id).strip():
            sku_keys.append(str(raw_id).strip())

    eans: list[str] = []
    bc = hit.get("barcode")
    if bc and str(bc).strip().isdigit():
        eans.append(str(bc).strip())
    for item in (hit.get("barcodeList") or []):
        if item and str(item).strip().isdigit():
            eans.append(str(item).strip())

    city_keys: set[str] = set()
    for price_entry in (hit.get("fullPriceByCity") or []):
        if not isinstance(price_entry, dict):
            continue
        code = str(price_entry.get("cityCode") or "").strip().upper()
        mapped = FARMATODO_CITY_CODE_MAP.get(code)
        if mapped:
            city_keys.add(mapped)

    return sku_keys, eans, city_keys


def parse_vtex_regional_items(products: list[dict[str, Any]]) -> list[tuple[str, str | None, bool]]:
    """Devuelve lista de `(item_id, ean, in_stock)` desde resultados VTEX de una región."""
    out: list[tuple[str, str | None, bool]] = []
    for prod in products:
        if not isinstance(prod, dict):
            continue
        for item in (prod.get("items") or []):
            if not isinstance(item, dict):
                continue
            item_id = str(item.get("itemId") or "").strip()
            if not item_id:
                continue
            raw_ean = str(item.get("ean") or "").strip()
            ean = raw_ean if raw_ean.isdigit() and 6 <= len(raw_ean) <= 20 else None
            sellers = item.get("sellers") or []
            in_stock = False
            for seller in sellers:
                offer = (seller or {}).get("commertialOffer") or {}
                price = float(offer.get("Price") or 0)
                qty = float(offer.get("AvailableQuantity") or 0)
                if price > 0 and qty > 0:
                    in_stock = True
                    break
            out.append((item_id, ean, in_stock))
    return out


async def _fetch_farmatodo_city_availability(timeout: float = 15.0) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """Mapea `{external_sku: set(city_keys)}` y `{ean: set(city_keys)}` para Farmatodo."""
    by_sku: dict[str, set[str]] = {}
    by_ean: dict[str, set[str]] = {}
    url = f"https://{FARMATODO_ALGOLIA_APP_ID.lower()}-dsn.algolia.net/1/indexes/{FARMATODO_ALGOLIA_INDEX}/query"
    headers = {
        "X-Algolia-Application-Id": FARMATODO_ALGOLIA_APP_ID,
        "X-Algolia-API-Key": FARMATODO_ALGOLIA_API_KEY,
    }
    transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")
    sem = asyncio.Semaphore(8)

    async def query_term(client: httpx.AsyncClient, term: str) -> list[dict[str, Any]]:
        async with sem:
            try:
                r = await client.post(url, headers=headers, json={"params": f"query={term}&hitsPerPage=100"})
                if r.status_code == 200:
                    return r.json().get("hits") or []
            except Exception as exc:
                logger.debug("Farmatodo Algolia term '%s' error: %s", term, exc)
            return []

    async with httpx.AsyncClient(transport=transport, timeout=timeout) as client:
        batches = await asyncio.gather(*(query_term(client, t) for t in FARMATODO_GROCERY_SEARCH_TERMS))
        for hits in batches:
            for hit in hits:
                sku_keys, eans, cities = extract_farmatodo_cities_from_hit(hit)
                if not cities:
                    continue
                for sk in sku_keys:
                    by_sku.setdefault(sk, set()).update(cities)
                for e in eans:
                    by_ean.setdefault(e, set()).update(cities)

    logger.info("Farmatodo disponibilidad regional: %d SKUs / %d EANs mapeados.", len(by_sku), len(by_ean))
    return by_sku, by_ean


async def _fetch_vtex_store_city_availability(
    store_id: str,
    domain: str,
    cities: list[tuple[str, float, float]],
    timeout: float = 15.0,
) -> tuple[dict[str, set[str]], dict[str, set[str]], dict[str, set[str]], dict[str, set[str]]]:
    """Consulta `regionId` + stock real por ciudad para una tienda VTEX."""
    sku_in_stock: dict[str, set[str]] = defaultdict(set)
    sku_checked: dict[str, set[str]] = defaultdict(set)
    ean_in_stock: dict[str, set[str]] = defaultdict(set)
    ean_checked: dict[str, set[str]] = defaultdict(set)

    transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    sem = asyncio.Semaphore(10)

    async with httpx.AsyncClient(transport=transport, timeout=timeout, headers=headers) as client:
        # 1. Resolver regionId y verificar si la tienda tiene seller activo en cada ciudad
        city_segments: list[tuple[str, str]] = []
        for city_key, lat, lng in cities:
            try:
                r = await client.get(
                    f"https://{domain}/api/checkout/pub/regions",
                    params={"country": "COL", "geoCoordinates": f"{lng};{lat}"},
                )
                if r.status_code != 200:
                    continue
                regs = r.json()
                if not isinstance(regs, list) or not regs:
                    continue
                sellers = [s for reg in regs for s in (reg.get("sellers") or [])]
                reg_id = regs[0].get("id")
                if not reg_id or not sellers:
                    continue
                seg = base64.b64encode(json.dumps({"regionId": reg_id, "countryCode": "COL"}).encode()).decode()
                city_segments.append((city_key, seg))
            except Exception as exc:
                logger.debug("Error obteniendo región VTEX (%s, %s): %s", store_id, city_key, exc)

        logger.info("[%s] Regiones activas detectadas: %d ciudades", store_id, len(city_segments))
        if not city_segments:
            return sku_in_stock, sku_checked, ean_in_stock, ean_checked

        async def probe_city_term(city_key: str, seg: str, term: str) -> None:
            async with sem:
                try:
                    resp = await client.get(
                        f"https://{domain}/api/catalog_system/pub/products/search",
                        params={"ft": term, "_from": 0, "_to": 49},
                        cookies={"vtex_segment": seg},
                    )
                    if resp.status_code not in (200, 206):
                        return
                    prods = resp.json()
                    if not isinstance(prods, list):
                        return
                    for item_id, ean, in_stock in parse_vtex_regional_items(prods):
                        sku_checked[item_id].add(city_key)
                        if in_stock:
                            sku_in_stock[item_id].add(city_key)
                        if ean:
                            ean_checked[ean].add(city_key)
                            if in_stock:
                                ean_in_stock[ean].add(city_key)
                except Exception:
                    return

        tasks = [
            probe_city_term(city_key, seg, term)
            for city_key, seg in city_segments
            for term in CORE_GROCERY_PROBE_TERMS
        ]
        await asyncio.gather(*tasks)

    logger.info(
        "[%s] Consultados %d SKUs y %d EANs en %d ciudades.",
        store_id,
        len(sku_checked),
        len(ean_checked),
        len(city_segments),
    )
    return sku_in_stock, sku_checked, ean_in_stock, ean_checked


def _load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for path in (".env", "web/.env.local", "web/.dev.vars"):
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                raw = line.strip()
                if not raw or raw.startswith("#") or "=" not in raw:
                    continue
                k, v = raw.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    for k, v in os.environ.items():
        if v:
            env.setdefault(k, v)
    return env


async def sync_regional_availability_async(*, dry_run: bool = False) -> dict[str, int]:
    """Ejecuta la sincronización de `available_cities` en Supabase."""
    env = _load_env()
    database_url = env.get("DATABASE_URL", "").strip()
    if not database_url and not dry_run:
        raise RuntimeError("DATABASE_URL no encontrada en .env")

    target_set = {normalize_city_key(c) for c in TARGET_REGIONAL_CITIES}
    city_coords: list[tuple[str, float, float]] = [
        (normalize_city_key(cap.city), cap.center_lat, cap.center_lng)
        for cap in COLOMBIA_CAPITALS_DIRECTORY
        if normalize_city_key(cap.city) in target_set
    ]

    farm_by_sku, farm_by_ean = await _fetch_farmatodo_city_availability()

    vtex_results: dict[str, tuple[dict[str, set[str]], dict[str, set[str]], dict[str, set[str]], dict[str, set[str]]]] = {}
    for store_id, domain in VTEX_REGIONAL_HOSTS.items():
        vtex_results[store_id] = await _fetch_vtex_store_city_availability(store_id, domain, city_coords)

    stats: dict[str, int] = {}
    if dry_run:
        stats["farmatodo_skus"] = len(farm_by_sku)
        for sid, (_, checked, _, _) in vtex_results.items():
            stats[f"{sid}_skus"] = len(checked)
        return stats

    with psycopg.connect(database_url, autocommit=False) as conn:
        with conn.cursor() as cur:
            # 1. Farmatodo: coincidencia por external_sku o por master_products.ean
            cur.execute(
                """
                SELECT ss.id, ss.external_sku, mp.ean
                FROM public.store_skus ss
                LEFT JOIN public.master_products mp ON mp.id = ss.master_product_id
                WHERE ss.store_id = 'farmatodo' AND ss.is_mercado = TRUE
                """
            )
            farm_updates: list[tuple[list[str], str]] = []
            for sku_uuid, ext_sku, ean in cur.fetchall():
                cities = farm_by_sku.get(ext_sku) or (farm_by_ean.get(ean) if ean else None)
                if cities:
                    farm_updates.append((sorted(cities), str(sku_uuid)))
            if farm_updates:
                cur.executemany(
                    "UPDATE public.store_skus SET available_cities = %s WHERE id = %s::uuid",
                    farm_updates,
                )
            stats["farmatodo"] = len(farm_updates)

            # 2. Cadenas VTEX (olimpica, carulla, exito, euro)
            for store_id, (sku_in, sku_chk, ean_in, ean_chk) in vtex_results.items():
                cur.execute(
                    """
                    SELECT ss.id, ss.external_sku, mp.ean
                    FROM public.store_skus ss
                    LEFT JOIN public.master_products mp ON mp.id = ss.master_product_id
                    WHERE ss.store_id = %s AND ss.is_mercado = TRUE
                    """,
                    (store_id,),
                )
                updates: list[tuple[list[str], str]] = []
                for sku_uuid, ext_sku, ean in cur.fetchall():
                    if ext_sku in sku_chk:
                        updates.append((sorted(sku_in.get(ext_sku, set())), str(sku_uuid)))
                    elif ean and ean in ean_chk:
                        updates.append((sorted(ean_in.get(ean, set())), str(sku_uuid)))
                if updates:
                    cur.executemany(
                        "UPDATE public.store_skus SET available_cities = %s WHERE id = %s::uuid",
                        updates,
                    )
                stats[store_id] = len(updates)

            # Refrescar vista materializada de /admin
            cur.execute("REFRESH MATERIALIZED VIEW public.mv_admin_store_catalog;")
        conn.commit()

    logger.info("Actualización de disponibilidad regional completada: %s", stats)
    return stats


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    parser = argparse.ArgumentParser(description="Sincroniza disponibilidad regional de SKUs por ciudad")
    parser.add_argument("--dry-run", action="store_true", help="No escribe en PostgreSQL")
    args = parser.parse_args()
    asyncio.run(sync_regional_availability_async(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
