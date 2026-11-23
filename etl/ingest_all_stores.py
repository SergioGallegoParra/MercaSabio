"""Ingesta completa en Supabase para los 12 supermercados objetivo de MercaSabio."""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Any

import psycopg

from etl.core.base_scraper import BaseScraper
from etl.core.cdc_manager import CDCManager, SupabaseGateway
from etl.core.entity_resolver import EntityResolver
from etl.scrapers.ara_scraper import (
    AraScraper,
    default_ara_config,
    sync_ara_available_cities,
)
from etl.scrapers.catalog_seed_scraper import CatalogStoreScraper
from etl.scrapers.d1_scraper import D1Scraper, default_d1_config
from etl.scrapers.farmatodo_scraper import FarmatodoScraper, default_farmatodo_config
from etl.scrapers.isimo_scraper import (
    IsimoRappiScraper,
    default_isimo_config,
    sync_isimo_rappi_discounts,
)
from etl.scrapers.makro_scraper import MakroScraper, default_makro_config
from etl.scrapers.vtex_scraper import DEFAULT_GROCERY_SEARCH_TERMS, VtexScraper

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("etl.ingest_all_stores")

TARGET_STORES: tuple[str, ...] = (
    "ara",
    "d1",
    "olimpica",
    "exito",
    "carulla",
    "farmatodo",
    "euro",
    "oxxo",
    "mercaldas",
    "isimo",
    "zapatoca",
    "makro",
)


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


async def _run_scraper_with_cdc(
    gateway: SupabaseGateway,
    resolver: EntityResolver,
    scraper: BaseScraper,
) -> dict[str, Any]:
    store_id = scraper.config.store_id
    cdc = CDCManager(gateway, store_id, resolver=resolver)
    await cdc.initialize()
    async with scraper:
        async for batch in scraper.iter_batches():
            if batch:
                await cdc.process_batch(batch)
    logger.info(
        "[%s] %s -> procesados=%d | nuevos=%d | cambios=%d | sin_cambios=%d",
        store_id,
        type(scraper).__name__,
        cdc.stats.total_processed,
        cdc.stats.new_skus,
        cdc.stats.price_or_stock_changes,
        cdc.stats.unchanged_skipped,
    )
    return cdc.stats.model_dump()


async def main_async(
    *,
    skip_live_api: bool = False,
    skip_seed: bool = False,
    only_stores: set[str] | None = None,
) -> None:
    env = _load_env()
    for key, val in env.items():
        os.environ.setdefault(key, val)
    supabase_url = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    supabase_key = (
        env.get("SUPABASE_SERVICE_ROLE_KEY")
        or env.get("SUPABASE_KEY")
        or ""
    )
    database_url = env.get("DATABASE_URL") or ""
    if not supabase_url or not supabase_key:
        raise RuntimeError("Faltan SUPABASE_URL y/o SUPABASE_KEY en .env")

    gateway = await SupabaseGateway.from_credentials(supabase_url, supabase_key)
    resolver = EntityResolver(gateway)
    await resolver.warm_up()

    ara_scraper_ran: AraScraper | None = None
    isimo_scraper_ran: IsimoRappiScraper | None = None
    try:
        if not skip_seed:
            logger.info("=== FASE 1: Catálogo base homologado para los 12 supermercados ===")
            for store_id in TARGET_STORES:
                if only_stores and store_id not in only_stores:
                    continue
                seed_scraper = CatalogStoreScraper.for_store(store_id)
                await _run_scraper_with_cdc(gateway, resolver, seed_scraper)

        if not skip_live_api:
            logger.info("=== FASE 2: Enriquecimiento en vivo desde APIs públicas ===")
            ara_scraper = AraScraper(default_ara_config())
            isimo_scraper = IsimoRappiScraper(default_isimo_config())
            live_scrapers: list[BaseScraper] = [
                ara_scraper,
                isimo_scraper,
                VtexScraper.for_store(
                    "exito",
                    search_terms=list(DEFAULT_GROCERY_SEARCH_TERMS),
                    max_categories=6,
                    requests_per_second=4.0,
                    max_concurrency=4,
                ),
                D1Scraper(
                    default_d1_config(
                        max_categories=8,
                        requests_per_second=3.0,
                        max_concurrency=3,
                    ),
                    search_terms=list(DEFAULT_GROCERY_SEARCH_TERMS),
                ),
                VtexScraper.for_store(
                    "euro",
                    search_terms=list(DEFAULT_GROCERY_SEARCH_TERMS),
                    max_categories=8,
                    requests_per_second=4.0,
                    max_concurrency=4,
                ),
                VtexScraper.for_store(
                    "mercaldas",
                    search_terms=list(DEFAULT_GROCERY_SEARCH_TERMS),
                    max_categories=8,
                    requests_per_second=4.0,
                    max_concurrency=4,
                ),
                FarmatodoScraper(default_farmatodo_config(max_categories=4)),
                MakroScraper(default_makro_config(max_categories=35)),
            ]
            for live_scraper in live_scrapers:
                sid = live_scraper.config.store_id
                if only_stores and sid not in only_stores:
                    continue
                try:
                    await _run_scraper_with_cdc(gateway, resolver, live_scraper)
                    if sid == "ara":
                        ara_scraper_ran = ara_scraper
                    elif sid == "isimo":
                        isimo_scraper_ran = isimo_scraper
                except Exception as exc:
                    logger.warning("[%s] Error parcial en extracción en vivo (continúa): %s", sid, exc)
    finally:
        await gateway.aclose()

    if database_url:
        if ara_scraper_ran is not None and ara_scraper_ran.sku_cities:
            sync_ara_available_cities(
                ara_scraper_ran.sku_cities,
                ara_scraper_ran.scraped_city_keys,
                database_url,
            )
        if isimo_scraper_ran is not None:
            sync_isimo_rappi_discounts(
                isimo_scraper_ran.rappi_promos_by_sku,
                database_url,
            )
        logger.info("=== FASE 3: Refrescando catalog_stats_snapshot ===")
        with psycopg.connect(database_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT public.refresh_catalog_stats_snapshot(0);")
                cur.execute("SELECT stores_count, total_skus FROM public.get_catalog_stats();")
                logger.info("Snapshot actualizado: %s", cur.fetchall())


if __name__ == "__main__":
    skip_live = "--seed-only" in sys.argv
    # Por defecto NUNCA se inyecta catalog_seed sintético salvo que se pase explícitamente --include-seed
    skip_seed = "--include-seed" not in sys.argv
    only_arg: set[str] | None = None
    if "--only" in sys.argv:
        idx = sys.argv.index("--only")
        if idx + 1 < len(sys.argv):
            only_arg = {s.strip().lower() for s in sys.argv[idx + 1].split(",") if s.strip()}
    asyncio.run(main_async(skip_live_api=skip_live, skip_seed=skip_seed, only_stores=only_arg))
