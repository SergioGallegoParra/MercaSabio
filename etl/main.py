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
from etl.core.models import CDCStats
from etl.scrapers.ara_scraper import AraScraper, default_ara_config
from etl.scrapers.d1_scraper import D1Scraper, default_d1_config
from etl.scrapers.hybris_scraper import HYBRIS_STORE_CONFIGS, HybrisScraper
from etl.scrapers.rappi_scraper import RappiScraper, default_rappi_config
from etl.scrapers.vtex_scraper import VTEX_STORE_CONFIGS, VtexScraper

SUPPORTED_STORES: tuple[str, ...] = (
    *sorted(VTEX_STORE_CONFIGS),
    "d1",
    "ara",
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
    if normalized in HYBRIS_STORE_CONFIGS:
        return HybrisScraper.for_store(normalized, **overrides)
    if normalized == "rappi":
        return RappiScraper(default_rappi_config(**overrides))

    supported = ", ".join(SUPPORTED_STORES)
    raise ValueError(f"Tienda desconocida: {store_id!r}. Soportadas: {supported}")


async def run_pipeline(
    store_id: str,
    *,
    gateway: DatabaseGateway | None = None,
    dry_run: bool = False,
    max_categories: int | None = None,
) -> CDCStats:
    """Ejecuta extracción en streaming + homologación + CDC en memoria para una tienda."""
    logger = logging.getLogger("etl.main")
    normalized = store_id.strip().lower()
    scraper = build_scraper(normalized, max_categories=max_categories)

    owns_gateway = gateway is None
    if gateway is None:
        if dry_run:
            gateway = InMemoryGateway()
        else:
            supabase_url = os.environ.get("SUPABASE_URL", "").strip()
            supabase_key = os.environ.get("SUPABASE_KEY", "").strip()
            if not supabase_url or not supabase_key:
                raise RuntimeError(
                    "Faltan variables de entorno SUPABASE_URL y/o SUPABASE_KEY (usa --dry-run para pruebas locales)."
                )
            gateway = await SupabaseGateway.from_credentials(supabase_url, supabase_key)

    cdc = CDCManager(gateway, normalized)
    try:
        await cdc.initialize()
        async with scraper:
            async for batch in scraper.iter_batches():
                await cdc.process_batch(batch)
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
        "--max-categories",
        type=int,
        default=None,
        help="Limita la cantidad de categorías/pasillos consultados.",
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
                max_categories=args.max_categories,
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
