"""Punto de entrada CLI del pipeline ETL diario (`python -m etl.main --store ...`)."""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from typing import Sequence

from etl.core.base_scraper import BaseScraper
from etl.core.cdc_manager import CDCManager, DatabaseGateway, InMemoryGateway, SupabaseGateway
from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH, LocalSqliteGateway
from etl.core.models import CDCStats
from etl.scrapers.amy_scraper import AmyScraper, default_amy_config
from etl.scrapers.ara_scraper import AraScraper, default_ara_config
from etl.scrapers.belalcazar_scraper import BelalcazarScraper, default_belalcazar_config
from etl.scrapers.canaveral_scraper import CanaveralScraper, default_canaveral_config
from etl.scrapers.catalog_seed_scraper import CatalogStoreScraper
from etl.scrapers.d1_scraper import D1Scraper, default_d1_config
from etl.scrapers.farmatodo_scraper import FarmatodoScraper, default_farmatodo_config
from etl.scrapers.hybris_scraper import HYBRIS_STORE_CONFIGS, HybrisScraper
from etl.scrapers.isimo_scraper import (
    IsimoRappiScraper,
    default_isimo_config,
    sync_isimo_rappi_discounts,
    sync_isimo_rappi_discounts_gateway,
)
from etl.scrapers.makro_scraper import MakroScraper, default_makro_config
from etl.scrapers.mercamio_scraper import MercamioScraper, default_mercamio_config
from etl.scrapers.mxm_scraper import MxmScraper, default_mxm_config
from etl.scrapers.rappi_scraper import RappiScraper, default_rappi_config
from etl.scrapers.superboom_scraper import SuperboomScraper, default_superboom_config
from etl.scrapers.supermu_scraper import SupermuScraper, default_supermu_config
from etl.scrapers.vtex_scraper import VTEX_STORE_CONFIGS, VtexScraper

SEED_ONLY_STORES: tuple[str, ...] = ("oxxo", "zapatoca")

SUPPORTED_STORES: tuple[str, ...] = (
    *sorted(VTEX_STORE_CONFIGS),
    "d1",
    "ara",
    "isimo",
    "farmatodo",
    "makro",
    "canaveral",
    "mxm",
    "supermu",
    "superboom",
    "mercamio",
    "belalcazar",
    "amy",
    *SEED_ONLY_STORES,
    *sorted(HYBRIS_STORE_CONFIGS),
    "rappi",
)


def build_scraper(store_id: str, *, max_categories: int | None = None) -> BaseScraper:
    """Construye el conector apropiado para la cadena solicitada."""
    normalized = store_id.strip().lower()
    overrides = {"max_categories": max_categories} if max_categories else {}

    if normalized in VTEX_STORE_CONFIGS:
        return VtexScraper.for_store(normalized, **overrides)
    if normalized == "d1":
        return D1Scraper(default_d1_config(**overrides))
    if normalized == "ara":
        return AraScraper(default_ara_config(**overrides))
    if normalized == "isimo":
        return IsimoRappiScraper(default_isimo_config(**overrides))
    if normalized == "farmatodo":
        return FarmatodoScraper(default_farmatodo_config(**overrides))
    if normalized == "makro":
        return MakroScraper(default_makro_config(**overrides))
    if normalized == "canaveral":
        return CanaveralScraper(default_canaveral_config(**overrides))
    if normalized == "mxm":
        return MxmScraper(default_mxm_config(**overrides))
    if normalized == "supermu":
        return SupermuScraper(default_supermu_config(**overrides))
    if normalized == "superboom":
        return SuperboomScraper(default_superboom_config(**overrides))
    if normalized == "mercamio":
        return MercamioScraper(default_mercamio_config(**overrides))
    if normalized == "belalcazar":
        return BelalcazarScraper(default_belalcazar_config(**overrides))
    if normalized == "amy":
        return AmyScraper(default_amy_config(**overrides))
    if normalized in SEED_ONLY_STORES:
        return CatalogStoreScraper.for_store(normalized, **overrides)
    if normalized in HYBRIS_STORE_CONFIGS:
        return HybrisScraper.for_store(normalized, **overrides)
    if normalized == "rappi":
        return RappiScraper(default_rappi_config(**overrides))

    supported = ", ".join(SUPPORTED_STORES)
    raise ValueError(f"Tienda desconocida: {store_id!r}. Soportadas: {supported}")


def _is_truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "si", "on"}


async def run_pipeline(
    store_id: str,
    *,
    gateway: DatabaseGateway | None = None,
    dry_run: bool = False,
    local_only: bool = False,
    local_db_path: str | None = None,
    max_categories: int | None = None,
    refresh_browser: bool = False,
) -> CDCStats:
    """Ejecuta extracción en streaming + homologación + CDC en memoria para una tienda."""
    logger = logging.getLogger("etl.main")
    normalized = store_id.strip().lower()

    if normalized == "isimo" and (refresh_browser or _is_truthy_env("ISIMO_REFRESH_BROWSER")):
        from etl.scrapers.isimo_browser_refresh import refresh_isimo_snapshots

        refresh_result = await refresh_isimo_snapshots(dry_run=dry_run)
        logger.info("[isimo] Refresco Playwright previo al ETL -> %s", refresh_result)

    scraper = build_scraper(normalized, max_categories=max_categories)

    owns_gateway = gateway is None
    if gateway is None:
        if dry_run:
            gateway = InMemoryGateway()
        elif local_only:
            db_target = local_db_path.strip() if local_db_path else str(DEFAULT_LOCAL_DB_PATH)
            gateway = LocalSqliteGateway(db_target)
            logger.info("[%s] Modo local activado (SQLite=%s, 0 IO en Supabase).", normalized, db_target)
        else:
            supabase_url = os.environ.get("SUPABASE_URL", "").strip()
            supabase_key = os.environ.get("SUPABASE_KEY", "").strip()
            if not supabase_url or not supabase_key:
                raise RuntimeError(
                    "Faltan variables de entorno SUPABASE_URL y/o SUPABASE_KEY (usa --dry-run o --local para correr en tu PC)."
                )
            gateway = await SupabaseGateway.from_credentials(supabase_url, supabase_key)

    cdc = CDCManager(gateway, normalized)
    try:
        await cdc.initialize()
        async with scraper:
            async for batch in scraper.iter_batches():
                await cdc.process_batch(batch)

        if (
            normalized == "isimo"
            and not dry_run
            and not local_only
            and isinstance(scraper, IsimoRappiScraper)
        ):
            database_url = os.environ.get("DATABASE_URL", "").strip()
            synced_via_db = False
            if database_url:
                try:
                    sync_isimo_rappi_discounts(scraper.rappi_promos_by_sku, database_url)
                    synced_via_db = True
                except ImportError:
                    logger.info("[isimo] psycopg no instalado; sincronizando descuentos vía API Supabase.")
            if not synced_via_db:
                await sync_isimo_rappi_discounts_gateway(scraper.rappi_promos_by_sku, gateway)
    finally:
        if owns_gateway:
            await gateway.aclose()

    logger.info(
        "[%s] Resumen CDC -> procesados=%d | nuevos=%d | cambios=%d | sin_cambios=%d (reducción=%.2f%%)",
        normalized,
        cdc.stats.total_processed,
        cdc.stats.new_skus,
        cdc.stats.price_or_stock_changes,
        cdc.stats.unchanged_skipped,
        cdc.stats.reduction_percentage,
    )
    return cdc.stats


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extractor diario y gestor CDC para Comparador de Precios Retail Colombia",
    )
    parser.add_argument(
        "--store",
        required=True,
        help=f"Identificador de tienda ({', '.join(SUPPORTED_STORES)})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Ejecuta contra almacenamiento en memoria sin conectarse a Supabase.",
    )
    parser.add_argument(
        "--local",
        action="store_true",
        help="Guarda todo el scrapeo y CDC en SQLite local (0 lecturas/escrituras en Supabase).",
    )
    parser.add_argument(
        "--local-db",
        default=str(DEFAULT_LOCAL_DB_PATH),
        help="Ruta opcional de la base SQLite local para --local.",
    )
    parser.add_argument(
        "--max-categories",
        type=int,
        default=None,
        help="Limita la cantidad de categorías/pasillos consultados.",
    )
    parser.add_argument(
        "--refresh-browser",
        action="store_true",
        help="Refresca snapshots dinámicos por Playwright antes del ETL (aplicable a Ísimo).",
    )
    parser.add_argument(
        "--log-level",
        default=os.environ.get("LOG_LEVEL", "INFO"),
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Nivel de logging.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    try:
        asyncio.run(
            run_pipeline(
                args.store,
                dry_run=args.dry_run,
                local_only=args.local,
                local_db_path=args.local_db,
                max_categories=args.max_categories,
                refresh_browser=args.refresh_browser,
            )
        )
    except ValueError as exc:
        logging.getLogger("etl.main").error("%s", exc)
        return 2
    except Exception:
        logging.getLogger("etl.main").exception("Fallo crítico durante la ejecución del ETL.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
