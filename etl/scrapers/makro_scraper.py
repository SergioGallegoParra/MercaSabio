"""Conector SSR/RSC para Makro Colombia (`tienda.makro.com.co`)."""

from __future__ import annotations

from typing import Any

import httpx

from etl.core.models import ScraperConfig
from etl.scrapers.instaleap_scraper import InstaleapRscScraper

MAKRO_CATEGORY_PATHS: tuple[str, ...] = (
    "/ca/mercado-y-alimentos/CP_01",
    "/ca/bebidas/CP_03",
    "/ca/cuidado-y-aseo/CP_08",
    "/ca/dulces-postres-y-snacks/CP_02",
    "/ca/para-tu-hogar/CP_05",
)

MAKRO_SEARCH_TERMS: tuple[str, ...] = (
    "arroz",
    "frijol",
    "lenteja",
    "garbanzo",
    "pasta",
    "espagueti",
    "harina",
    "avena",
    "aceite",
    "azucar",
    "panela",
    "salsa de tomate",
    "cafe",
    "chocolate",
    "leche",
    "queso",
    "mantequilla",
    "yogurt",
    "pollo",
    "carne",
    "atun",
    "huevo",
    "detergente",
    "suavizante",
    "lavaloza",
    "limpiador",
    "cloro",
    "jabon",
    "crema dental",
    "papel higienico",
)


def default_makro_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Makro Supermayorista Colombia."""
    base = ScraperConfig(
        store_id="makro",
        base_url="https://tienda.makro.com.co",
        channel_type="instaleap_ssr",
        source_origin="makro_web",
        requests_per_second=2.0,
        max_concurrency=2,
    )
    return base.model_copy(update=overrides) if overrides else base


class MakroScraper(InstaleapRscScraper):
    """Extractor Next.js RSC para `tienda.makro.com.co`."""

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        category_paths: list[str] | None = None,
        search_terms: list[str] | None = None,
        auto_discover_categories: bool = True,
        paginate_categories: bool = True,
    ) -> None:
        super().__init__(
            config or default_makro_config(),
            client=client,
            category_paths=(
                list(category_paths) if category_paths is not None else list(MAKRO_CATEGORY_PATHS)
            ),
            search_terms=(
                list(search_terms) if search_terms is not None else list(MAKRO_SEARCH_TERMS)
            ),
            auto_discover_categories=auto_discover_categories,
            paginate_categories=paginate_categories,
        )
