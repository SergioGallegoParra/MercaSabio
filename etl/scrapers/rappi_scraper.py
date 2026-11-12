"""Conector para Rappi (fuente secundaria agregadora con calibración de sobreprecio)."""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from etl.core.base_scraper import BaseScraper, ScraperHTTPError
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

DEFAULT_BOGOTA_LAT = 4.6768
DEFAULT_BOGOTA_LNG = -74.0483
RAPPI_GUEST_AUTH_ENDPOINT = "/api/auth/guest"
RAPPI_CORRIDOR_ENDPOINT = "/api/cpgs-marketplace/v1/corridors/products"


def default_rappi_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Rappi con factor de calibración inicial 0.9000."""
    base = ScraperConfig(
        store_id="rappi",
        base_url="https://services.rappi.com.co",
        channel_type="aggregator",
        source_origin="rappi_api",
        requests_per_second=1.5,
        max_concurrency=2,
        markup_discount_factor=Decimal("0.9000"),
    )
    return base.model_copy(update=overrides) if overrides else base


class RappiScraper(BaseScraper):
    """Extractor sobre `services.rappi.com.co` con token de invitado y calibración `alpha`."""

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        guest_token: str | None = None,
        lat: float = DEFAULT_BOGOTA_LAT,
        lng: float = DEFAULT_BOGOTA_LNG,
        corridor_ids: list[str] | None = None,
        category_alphas: dict[str, Decimal] | None = None,
    ) -> None:
        super().__init__(config or default_rappi_config(), client=client)
        self._guest_token = guest_token or os.environ.get("RAPPI_GUEST_TOKEN", "").strip() or None
        self.lat = lat
        self.lng = lng
        self.corridor_ids = corridor_ids if corridor_ids is not None else list(self.config.category_filters)
        self.category_alphas = category_alphas or {}

    async def _ensure_guest_token(self) -> str:
        if self._guest_token:
            return self._guest_token
        response = await self.request(
            "POST",
            RAPPI_GUEST_AUTH_ENDPOINT,
            json_body={"lat": self.lat, "lng": self.lng},
        )
        data = response.json()
        token = data.get("access_token") or data.get("token")
        if not token:
            raise ScraperHTTPError(response.status_code, str(response.url), "Token de invitado ausente")
        self._guest_token = str(token)
        return self._guest_token

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Consulta pasillos/catálogos con coordenadas fijas y aplica calibración de precios."""
        targets = self.corridor_ids or [None]
        if self.config.max_categories:
            targets = targets[: self.config.max_categories]

        token = await self._ensure_guest_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "x-rappi-lat": str(self.lat),
            "x-rappi-lng": str(self.lng),
        }
        seen_skus: set[str] = set()

        for corridor_id in targets:
            page = 0
            while True:
                params: dict[str, Any] = {
                    "lat": self.lat,
                    "lng": self.lng,
                    "page": page,
                    "limit": 50,
                }
                if corridor_id:
                    params["corridor_id"] = corridor_id

                payload = await self.get_json(RAPPI_CORRIDOR_ENDPOINT, params=params, headers=headers)
                raw_products = self._unwrap_products(payload)
                if not raw_products:
                    break

                batch: list[ScrapedProduct] = []
                for item in raw_products:
                    model = self._parse_rappi_product(item, corridor_id=corridor_id)
                    if model and model.external_sku not in seen_skus:
                        seen_skus.add(model.external_sku)
                        batch.append(model)

                if batch:
                    yield batch

                if len(raw_products) < 50:
                    break
                page += 1

    @staticmethod
    def _unwrap_products(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [x for x in payload if isinstance(x, dict)]
        if isinstance(payload, dict):
            for key in ("products", "items", "data"):
                val = payload.get(key)
                if isinstance(val, list):
                    return [x for x in val if isinstance(x, dict)]
        return []

    def _parse_rappi_product(
        self,
        raw: dict[str, Any],
        *,
        corridor_id: str | None = None,
    ) -> ScrapedProduct | None:
        sku = str(raw.get("product_id") or raw.get("id") or raw.get("sku") or "").strip()
        raw_name = str(raw.get("name") or "").strip()
        if not sku or not raw_name:
            return None

        sale_price = self._to_decimal(raw.get("real_price") or raw.get("price"))
        if sale_price is None:
            return None
        list_price = self._to_decimal(raw.get("price")) or sale_price
        if list_price < sale_price:
            list_price = sale_price

        content = resolve_content(
            raw_name,
            measurement_unit=raw.get("unit_type"),
            unit_multiplier=raw.get("quantity"),
        )
        normalized_name = normalize_product_name(raw_name)
        canonical_slug = infer_canonical_category_slug(
            normalized_name, content.net_content, content.unit_measure
        )

        alpha = self.category_alphas.get(
            canonical_slug or corridor_id or "",
            self.config.markup_discount_factor,
        )
        calibrated_price = apply_calibration(sale_price, alpha, round_to_tens=True)
        pum_price = compute_pum(calibrated_price, content.net_content)

        return self.validate_product(
            {
                "store_id": self.config.store_id,
                "external_sku": sku,
                "ean": normalize_ean(raw.get("ean")),
                "raw_name": raw_name,
                "normalized_name": normalized_name,
                "brand": raw.get("trademark") or raw.get("brand"),
                "raw_list_price": list_price,
                "raw_sale_price": sale_price,
                "calibrated_price": calibrated_price,
                "net_content": content.net_content,
                "unit_measure": content.unit_measure,
                "pum_price": pum_price,
                "in_stock": bool(raw.get("in_stock", raw.get("stock", 1) > 0)) and sale_price > 0,
                "source_origin": self.config.source_origin,
                "raw_url": raw.get("url"),
                "image_url": raw.get("image"),
                "canonical_category_slug": canonical_slug,
                "is_private_label": False,
                "category_path": [str(raw["category"])] if raw.get("category") else [],
            }
        )

    @staticmethod
    def _to_decimal(value: Any) -> Decimal | None:
        if value is None:
            return None
        try:
            dec = Decimal(str(value))
        except (InvalidOperation, ValueError):
            return None
        if dec < 0:
            return None
        return dec.quantize(Decimal("0.01"))
