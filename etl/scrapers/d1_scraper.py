"""Conector VTEX IO / GraphQL para Tiendas D1 con cookie geolocalizada `vtex_segment`."""

from __future__ import annotations

import base64
import json
import logging
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx

from etl.core.base_scraper import BaseScraper
from etl.core.models import ScrapedProduct, ScraperConfig
from etl.scrapers.vtex_scraper import parse_vtex_product_payload

logger = logging.getLogger(__name__)

D1_GRAPHQL_ENDPOINT = "/_v/private/graphql/v1"
D1_PAGE_SIZE = 50
D1_MAX_OFFSET = 2500

D1_PRODUCT_SEARCH_QUERY = """
query ProductSearch($from: Int, $to: Int, $selectedFacets: [SelectedFacetInput]) {
  productSearch(
    from: $from
    to: $to
    selectedFacets: $selectedFacets
    hideUnavailableItems: false
  ) {
    products {
      productId
      productName
      brand
      link
      linkText
      categories
      items {
        itemId
        name
        nameComplete
        ean
        measurementUnit
        unitMultiplier
        images {
          imageUrl
        }
        sellers {
          sellerId
          commertialOffer {
            Price
            ListPrice
            AvailableQuantity
            IsAvailable
          }
        }
      }
    }
    recordsFiltered
  }
}
""".strip()


def build_vtex_segment_cookie(
    *,
    sales_channel: str = "1",
    country_code: str = "COL",
    currency_code: str = "COP",
    culture_info: str = "es-CO",
    region_id: str | None = None,
    postal_code: str | None = "110111",
) -> str:
    """Construye la cookie base64 `vtex_segment` requerida para resolver inventario en D1."""
    payload: dict[str, Any] = {
        "campaigns": None,
        "channel": sales_channel,
        "priceTables": None,
        "regionId": region_id,
        "utm_campaign": None,
        "utm_source": None,
        "utmi_campaign": None,
        "currencyCode": currency_code,
        "currencySymbol": "$",
        "countryCode": country_code,
        "cultureInfo": culture_info,
    }
    if postal_code:
        payload["geoCoordinates"] = [-74.0721, 4.7110]
        payload["postalCode"] = postal_code
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.b64encode(encoded).decode("ascii")


def default_d1_config(**overrides: Any) -> ScraperConfig:
    """Genera configuración predeterminada para Tiendas D1 (VTEX IO / GraphQL)."""
    segment = os.environ.get("D1_VTEX_SEGMENT", "").strip() or build_vtex_segment_cookie()
    headers = {"Cookie": f"vtex_segment={segment}"}
    base = ScraperConfig(
        store_id="d1",
        base_url="https://domicilios.tiendasd1.com",
        channel_type="vtex_graphql",
        source_origin="vtex_graphql",
        requests_per_second=1.5,
        max_concurrency=2,
        default_headers=headers,
    )
    return base.model_copy(update=overrides) if overrides else base


class D1Scraper(BaseScraper):
    """Extractor GraphQL para Tiendas D1 con sesión `vtex_segment`."""

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        vtex_segment: str | None = None,
    ) -> None:
        cfg = config or default_d1_config()
        if vtex_segment:
            headers = {**cfg.default_headers, "Cookie": f"vtex_segment={vtex_segment}"}
            cfg = cfg.model_copy(update={"default_headers": headers})
        super().__init__(cfg, client=client)

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Pagina consultas GraphQL por facetas de categoría devolviendo lotes validados."""
        facets_list = self._resolve_facet_queries()
        seen_skus: set[str] = set()

        for facet in facets_list:
            offset = 0
            while offset < D1_MAX_OFFSET:
                to_offset = min(offset + D1_PAGE_SIZE - 1, D1_MAX_OFFSET - 1)
                variables: dict[str, Any] = {
                    "from": offset,
                    "to": to_offset,
                    "selectedFacets": [{"key": "c", "value": facet}] if facet else [],
                }
                response = await self.request(
                    "POST",
                    D1_GRAPHQL_ENDPOINT,
                    json_body={
                        "query": D1_PRODUCT_SEARCH_QUERY,
                        "variables": variables,
                    },
                )
                payload = response.json()
                search_data = (payload.get("data") or {}).get("productSearch") or {}
                raw_products = search_data.get("products") or []
                if not isinstance(raw_products, list) or not raw_products:
                    break

                batch: list[ScrapedProduct] = []
                for raw_product in raw_products:
                    if not isinstance(raw_product, dict):
                        continue
                    for model in parse_vtex_product_payload(raw_product, self.config):
                        if model.external_sku in seen_skus:
                            continue
                        seen_skus.add(model.external_sku)
                        batch.append(model)

                if batch:
                    yield batch

                if len(raw_products) < D1_PAGE_SIZE:
                    break
                offset += D1_PAGE_SIZE

    def _resolve_facet_queries(self) -> list[str | None]:
        if self.config.category_filters:
            filters: list[str | None] = list(self.config.category_filters)
            if self.config.max_categories:
                return filters[: self.config.max_categories]
            return filters
        return [None]
