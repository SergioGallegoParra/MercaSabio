"""Conector WooCommerce Store API para Supermercado Belalcázar (`supermercadobelalcazar.com.co`)."""

from __future__ import annotations

from typing import Any

import httpx

from etl.core.models import ScraperConfig
from etl.scrapers.woocommerce_store_scraper import WooCommerceStoreScraper


def default_belalcazar_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Supermercado Belalcázar (Cali / Valle)."""
    base = ScraperConfig(
        store_id="belalcazar",
        base_url="https://supermercadobelalcazar.com.co",
        channel_type="woocommerce_store",
        source_origin="belalcazar_web",
        requests_per_second=3.0,
        max_concurrency=2,
        default_headers={"Accept": "application/json"},
    )
    return base.model_copy(update=overrides) if overrides else base


class BelalcazarScraper(WooCommerceStoreScraper):
    """Extractor sobre `/wp-json/wc/store/v1/products` de Supermercado Belalcázar."""

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(config or default_belalcazar_config(), client=client)

    def _infer_brand(
        self,
        raw: dict[str, Any],
        *,
        normalized_name: str,
        resolved_path: list[str],
    ) -> str | None:
        is_private = "belalcazar" in normalized_name.split() or any(
            "marca propia" in " ".join(cat.lower().split()) for cat in resolved_path
        )
        if is_private:
            return "Belalcázar"
        return super()._infer_brand(raw, normalized_name=normalized_name, resolved_path=resolved_path)
