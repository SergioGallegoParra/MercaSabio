"""Conector SAP Commerce (Hybris) para Alkosto y Ktronix con rate limiting estricto."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from etl.core.base_scraper import BaseScraper
from etl.core.calibrator import apply_calibration
from etl.core.canonical_mapper import infer_canonical_category_slug
from etl.core.models import ScrapedProduct, ScraperConfig
from etl.core.normalizer import (
    compute_pum,
    normalize_ean,
    normalize_product_name,
    resolve_content,
)

logger = logging.getLogger(__name__)

HYBRIS_PAGE_SIZE = 48

HYBRIS_STORE_CONFIGS: dict[str, tuple[ScraperConfig, str]] = {
    "alkosto": (
        ScraperConfig(
            store_id="alkosto",
            base_url="https://www.alkosto.com",
            channel_type="sap_hybris",
            source_origin="hybris_api",
            requests_per_second=1.0,
            max_concurrency=1,
            max_retries=4,
            backoff_base_seconds=2.0,
            rotate_user_agent=True,
            default_headers={
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "Referer": "https://www.alkosto.com/",
            },
        ),
        "alkosto",
    ),
    "ktronix": (
        ScraperConfig(
            store_id="ktronix",
            base_url="https://www.ktronix.com",
            channel_type="sap_hybris",
            source_origin="hybris_api",
            requests_per_second=1.0,
            max_concurrency=1,
            max_retries=4,
            backoff_base_seconds=2.0,
            rotate_user_agent=True,
            default_headers={
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "Referer": "https://www.ktronix.com/",
            },
        ),
        "ktronix",
    ),
}


class HybrisScraper(BaseScraper):
    """Extractor para endpoints OCC de SAP Commerce (Alkosto y Ktronix)."""

    def __init__(
        self,
        config: ScraperConfig,
        *,
        site_id: str | None = None,
        search_endpoint: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(config, client=client)
        self.site_id = site_id or config.store_id
        self.search_endpoint = search_endpoint or f"/occ/v2/{self.site_id}/products/search"

    @classmethod
    def for_store(
        cls,
        store_id: str,
        *,
        client: httpx.AsyncClient | None = None,
        **overrides: Any,
    ) -> HybrisScraper:
        key = store_id.strip().lower()
        if key not in HYBRIS_STORE_CONFIGS:
            supported = ", ".join(sorted(HYBRIS_STORE_CONFIGS))
            raise ValueError(f"Tienda Hybris no soportada: {store_id!r}. Disponibles: {supported}")
        base_config, site_id = HYBRIS_STORE_CONFIGS[key]
        cfg = base_config.model_copy(update=overrides) if overrides else base_config
        return cls(cfg, site_id=site_id, client=client)

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Itera por consultas/categorías Hybris paginando con `currentPage` y `pageSize`."""
        queries = self._resolve_queries()
        seen_skus: set[str] = set()

        for query_term in queries:
            page = 0
            while True:
                params: dict[str, Any] = {
                    "query": query_term,
                    "currentPage": page,
                    "pageSize": HYBRIS_PAGE_SIZE,
                    "fields": "FULL",
                }
                payload = await self.get_json(self.search_endpoint, params=params)
                if not isinstance(payload, dict):
                    break

                products = payload.get("products") or []
                if not isinstance(products, list) or not products:
                    break

                batch: list[ScrapedProduct] = []
                for raw_product in products:
                    if not isinstance(raw_product, dict):
                        continue
                    model = self._parse_hybris_product(raw_product)
                    if model and model.external_sku not in seen_skus:
                        seen_skus.add(model.external_sku)
                        batch.append(model)

                if batch:
                    yield batch

                pagination = payload.get("pagination") or {}
                total_pages = pagination.get("totalPages")
                if total_pages is not None:
                    if page + 1 >= int(total_pages):
                        break
                elif len(products) < HYBRIS_PAGE_SIZE:
                    break
                page += 1

    def _resolve_queries(self) -> list[str]:
        if self.config.category_filters:
            filters = list(self.config.category_filters)
            if self.config.max_categories:
                return filters[: self.config.max_categories]
            return filters
        return [":relevance"]

    def _parse_hybris_product(self, raw: dict[str, Any]) -> ScrapedProduct | None:
        code = str(raw.get("code") or raw.get("sku") or "").strip()
        raw_name = str(raw.get("name") or "").strip()
        if not code or not raw_name:
            return None

        sale_price = self._extract_price_value(raw.get("price"))
        if sale_price is None:
            return None

        list_price = (
            self._extract_price_value(raw.get("wasPrice"))
            or self._extract_price_value(raw.get("listPrice"))
            or sale_price
        )
        stock_info = raw.get("stock") or {}
        stock_status = str(stock_info.get("stockLevelStatus") or "").lower()
        in_stock = sale_price > 0 and stock_status != "outofstock"

        brand_raw = raw.get("manufacturer") or (
            raw.get("brand", {}).get("name") if isinstance(raw.get("brand"), dict) else raw.get("brand")
        )
        ean = normalize_ean(raw.get("ean") or raw.get("gtin"))
        content = resolve_content(raw_name)
        calibrated = apply_calibration(sale_price, self.config.markup_discount_factor)
        pum = compute_pum(calibrated, content.net_content)
        normalized_name = normalize_product_name(raw_name)

        url_path = raw.get("url")
        raw_url = (
            url_path
            if isinstance(url_path, str) and url_path.startswith(("http://", "https://"))
            else (
                f"{self.config.base_url.rstrip('/')}/{str(url_path).lstrip('/')}"
                if url_path
                else None
            )
        )

        image_url = None
        images = raw.get("images") or []
        if isinstance(images, list) and images and isinstance(images[0], dict):
            img_path = images[0].get("url")
            if isinstance(img_path, str) and img_path.strip():
                image_url = (
                    img_path
                    if img_path.startswith(("http://", "https://"))
                    else f"{self.config.base_url.rstrip('/')}/{img_path.lstrip('/')}"
                )

        categories = [
            str(cat.get("name")).strip()
            for cat in (raw.get("categories") or [])
            if isinstance(cat, dict) and cat.get("name")
        ]

        return self.validate_product(
            {
                "store_id": self.config.store_id,
                "external_sku": code,
                "ean": ean,
                "raw_name": raw_name,
                "normalized_name": normalized_name,
                "brand": brand_raw,
                "raw_list_price": max(list_price, sale_price),
                "raw_sale_price": sale_price,
                "calibrated_price": calibrated,
                "net_content": content.net_content,
                "unit_measure": content.unit_measure,
                "pum_price": pum,
                "in_stock": in_stock,
                "source_origin": self.config.source_origin,
                "raw_url": raw_url,
                "image_url": image_url,
                "canonical_category_slug": infer_canonical_category_slug(
                    normalized_name, content.net_content, content.unit_measure
                ),
                "is_private_label": False,
                "category_path": categories,
            }
        )

    @staticmethod
    def _extract_price_value(price_obj: Any) -> Decimal | None:
        if price_obj is None:
            return None
        raw_val = price_obj.get("value") if isinstance(price_obj, dict) else price_obj
        if raw_val is None:
            return None
        try:
            dec = Decimal(str(raw_val))
        except (InvalidOperation, ValueError):
            return None
        if dec < 0:
            return None
        return dec.quantize(Decimal("0.01"))
