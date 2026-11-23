"""Conector WooCommerce Store API para Amy Supermercado (`www.amy.com.co`)."""

from __future__ import annotations

from typing import Any

import httpx

from etl.core.models import ScraperConfig
from etl.scrapers.woocommerce_store_scraper import WooCommerceStoreScraper


def default_amy_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Amy Supermercado (Guarne / Antioquia)."""
    base = ScraperConfig(
        store_id="amy",
        base_url="https://www.amy.com.co",
        channel_type="woocommerce_store",
        source_origin="amy_web",
        requests_per_second=3.0,
        max_concurrency=2,
        default_headers={"Accept": "application/json"},
    )
    return base.model_copy(update=overrides) if overrides else base


class AmyScraper(WooCommerceStoreScraper):
    """Extractor sobre `/wp-json/wc/store/v1/products` de Amy Supermercado."""

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(config or default_amy_config(), client=client)

    def _infer_brand(
        self,
        raw: dict[str, Any],
        *,
        normalized_name: str,
        resolved_path: list[str],
    ) -> str | None:
        tokens = set(normalized_name.split())
        if "mua" in tokens:
            return "MUA"
        if "amercar" in tokens:
            return "Amercar"
        if "amy" in tokens:
            return "Amy"
        return super()._infer_brand(raw, normalized_name=normalized_name, resolved_path=resolved_path)
