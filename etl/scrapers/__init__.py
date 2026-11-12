"""Conectores de extracción por cadena retail."""

from etl.scrapers.ara_scraper import AraScraper
from etl.scrapers.d1_scraper import D1Scraper
from etl.scrapers.hybris_scraper import HYBRIS_STORE_CONFIGS, HybrisScraper
from etl.scrapers.rappi_scraper import RappiScraper
from etl.scrapers.vtex_scraper import VTEX_STORE_CONFIGS, VtexScraper

__all__ = [
    "AraScraper",
    "D1Scraper",
    "HYBRIS_STORE_CONFIGS",
    "HybrisScraper",
    "RappiScraper",
    "VTEX_STORE_CONFIGS",
    "VtexScraper",
]
