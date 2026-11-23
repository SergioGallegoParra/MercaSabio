"""Conector SSR/RSC para Supertiendas Cañaveral (`www.domicilioscanaveral.com`)."""

from __future__ import annotations

from typing import Any

import httpx

from etl.core.models import ScraperConfig
from etl.scrapers.instaleap_scraper import InstaleapRscScraper

CANAVERAL_FALLBACK_CATEGORY_PATHS: tuple[str, ...] = (
    "/ca/carnes/01",
    "/ca/frutas-y-verduras/02",
    "/ca/despensa/010",
    "/ca/lacteos-y-refrigerados/011",
    "/ca/panaderia-y-reposteria/019",
    "/ca/cuidado-personal-y-belleza/08",
    "/ca/bebidas-pasabocas-dulceria-y-desechables/04",
    "/ca/congelados-y-comidas-preparadas/020",
    "/ca/delicatessen/09",
    "/ca/limpieza-y-cuidado-del-hogar/07",
    "/ca/mundo-bebes/016",
    "/ca/mundo-mascotas/017",
    "/ca/mundo-saludable/018",
)


def default_canaveral_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Supertiendas Cañaveral (Instaleap SSR)."""
    base = ScraperConfig(
        store_id="canaveral",
        base_url="https://www.domicilioscanaveral.com",
        channel_type="instaleap_ssr",
        source_origin="canaveral_web",
        requests_per_second=3.0,
        max_concurrency=2,
    )
    return base.model_copy(update=overrides) if overrides else base


class CanaveralScraper(InstaleapRscScraper):
    """Extractor Next.js RSC con autodescubrimiento de categorías y paginación."""

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
            config or default_canaveral_config(),
            client=client,
            category_paths=(
                list(category_paths)
                if category_paths is not None
                else list(CANAVERAL_FALLBACK_CATEGORY_PATHS)
            ),
            search_terms=list(search_terms or ()),
            auto_discover_categories=auto_discover_categories,
            paginate_categories=paginate_categories,
        )
