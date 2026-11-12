"""Conector para Tiendas Ara (API JSON de App móvil y folletos PDF semanales sin navegador)."""

from __future__ import annotations

import hashlib
import io
import logging
import os
import re
from collections.abc import AsyncIterator
from decimal import Decimal
from typing import Any

import httpx

from etl.core.base_scraper import BaseScraper, ScraperHTTPError
from etl.core.calibrator import apply_calibration
from etl.core.canonical_mapper import infer_canonical_category_slug, is_store_private_label
from etl.core.models import ScrapedProduct, ScraperConfig
from etl.core.normalizer import (
    compute_pum,
    normalize_ean,
    normalize_product_name,
    resolve_content,
)

logger = logging.getLogger(__name__)

# Detecta precios colombianos con formato $4.500, $ 12.900 o $990
_COP_PRICE_RE = re.compile(r"\$\s*(\d{1,3}(?:[\.,]\d{3})+|\d{3,6})")
_BEFORE_AFTER_RE = re.compile(
    r"(?:antes|regular)\s*:?\s*\$\s*(\d{1,3}(?:[\.,]\d{3})+|\d{3,6}).*?"
    r"(?:ahora|hoy|oferta)?\s*:?\s*\$\s*(\d{1,3}(?:[\.,]\d{3})+|\d{3,6})",
    re.IGNORECASE,
)


def _parse_cop_price(raw_digits: str) -> Decimal:
    cleaned = raw_digits.replace(".", "").replace(",", "").strip()
    return Decimal(cleaned).quantize(Decimal("0.01"))


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """Extrae texto plano de un folleto PDF usando `pypdf` en memoria."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages)


def parse_ara_brochure_text(
    text: str,
    config: ScraperConfig,
    *,
    source_url: str | None = None,
) -> list[ScrapedProduct]:
    """Extrae productos promocionales y precios desde texto de folletos semanales de Ara."""
    lines = [" ".join(line.split()) for line in text.splitlines()]
    lines = [line for line in lines if line]

    results: list[ScrapedProduct] = []
    seen_skus: set[str] = set()
    pending_title: str | None = None

    for line in lines:
        before_after = _BEFORE_AFTER_RE.search(line)
        price_matches = list(_COP_PRICE_RE.finditer(line))

        if not price_matches:
            # Acumula posible título ubicado en la línea inmediatamente anterior al precio
            if len(line) >= 4 and any(ch.isalpha() for ch in line):
                pending_title = line
            continue

        if before_after:
            list_price = _parse_cop_price(before_after.group(1))
            sale_price = _parse_cop_price(before_after.group(2))
            title_part = line[: before_after.start()].strip(" -:|*")
        else:
            sale_price = _parse_cop_price(price_matches[-1].group(1))
            list_price = sale_price
            title_part = line[: price_matches[0].start()].strip(" -:|*")

        raw_name = title_part or (pending_title or "")
        pending_title = None

        if len(raw_name) < 3 or not any(ch.isalpha() for ch in raw_name) or sale_price <= 0:
            continue

        content = resolve_content(raw_name)
        normalized_name = normalize_product_name(raw_name)
        sku_hash = hashlib.sha1(
            f"{normalized_name}:{content.net_content}:{content.unit_measure.value}".encode("utf-8")
        ).hexdigest()[:14]
        external_sku = f"ara-pdf-{sku_hash}"
        if external_sku in seen_skus:
            continue
        seen_skus.add(external_sku)

        calibrated = apply_calibration(sale_price, config.markup_discount_factor)
        pum = compute_pum(calibrated, content.net_content)
        canonical_slug = infer_canonical_category_slug(
            normalized_name,
            content.net_content,
            content.unit_measure,
        )

        model = BaseScraper.validate_product(
            {
                "store_id": config.store_id,
                "external_sku": external_sku,
                "ean": None,
                "raw_name": raw_name,
                "normalized_name": normalized_name,
                "brand": None,
                "raw_list_price": max(list_price, sale_price),
                "raw_sale_price": sale_price,
                "calibrated_price": calibrated,
                "net_content": content.net_content,
                "unit_measure": content.unit_measure,
                "pum_price": pum,
                "in_stock": True,
                "source_origin": "pdf_folleto",
                "raw_url": source_url,
                "canonical_category_slug": canonical_slug,
                "is_private_label": is_store_private_label(config.store_id, None, None),
            }
        )
        if model is not None:
            results.append(model)

    return results


def default_ara_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Tiendas Ara."""
    base = ScraperConfig(
        store_id="ara",
        base_url="https://aratiendas.com",
        channel_type="app_pdf",
        source_origin="ara_api",
        requests_per_second=1.5,
        max_concurrency=2,
    )
    return base.model_copy(update=overrides) if overrides else base


class AraScraper(BaseScraper):
    """Conector híbrido para Tiendas Ara (API JSON móvil y/o folletos PDF semanales)."""

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        api_endpoints: list[str] | None = None,
        pdf_urls: list[str] | None = None,
    ) -> None:
        super().__init__(config or default_ara_config(), client=client)
        env_api = os.environ.get("ARA_API_URL", "").strip()
        env_pdfs = [u.strip() for u in os.environ.get("ARA_PDF_URLS", "").split(",") if u.strip()]
        self.api_endpoints = api_endpoints if api_endpoints is not None else ([env_api] if env_api else [])
        self.pdf_urls = pdf_urls if pdf_urls is not None else env_pdfs

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Extrae productos de endpoints JSON configurados y luego de folletos PDF."""
        if not self.api_endpoints and not self.pdf_urls:
            logger.warning(
                "[ara] No hay ARA_API_URL ni ARA_PDF_URLS configurados; no se procesaron fuentes."
            )
            return

        seen_skus: set[str] = set()

        for endpoint in self.api_endpoints:
            try:
                payload = await self.get_json(endpoint)
            except (ScraperHTTPError, ValueError) as exc:
                logger.warning("[ara] Error consultando API JSON %s: %s", endpoint, exc)
                continue

            raw_items = self._unwrap_api_items(payload)
            batch: list[ScrapedProduct] = []
            for item in raw_items:
                model = self._parse_api_item(item)
                if model and model.external_sku not in seen_skus:
                    seen_skus.add(model.external_sku)
                    batch.append(model)
            if batch:
                yield batch

        for pdf_url in self.pdf_urls:
            try:
                response = await self.request("GET", pdf_url)
                text = extract_text_from_pdf_bytes(response.content)
            except Exception as exc:
                logger.warning("[ara] No se pudo procesar folleto PDF %s: %s", pdf_url, exc)
                continue

            pdf_batch = [
                p
                for p in parse_ara_brochure_text(text, self.config, source_url=pdf_url)
                if p.external_sku not in seen_skus
            ]
            for p in pdf_batch:
                seen_skus.add(p.external_sku)
            if pdf_batch:
                yield pdf_batch

    @staticmethod
    def _unwrap_api_items(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [x for x in payload if isinstance(x, dict)]
        if isinstance(payload, dict):
            for key in ("products", "items", "data", "results"):
                val = payload.get(key)
                if isinstance(val, list):
                    return [x for x in val if isinstance(x, dict)]
        return []

    def _parse_api_item(self, item: dict[str, Any]) -> ScrapedProduct | None:
        sku = str(item.get("sku") or item.get("id") or item.get("code") or "").strip()
        raw_name = str(item.get("name") or item.get("title") or item.get("description") or "").strip()
        if not sku or not raw_name:
            return None

        raw_sale = item.get("sale_price") or item.get("offer_price") or item.get("price")
        raw_list = item.get("list_price") or item.get("regular_price") or raw_sale
        if raw_sale is None:
            return None

        sale_price = Decimal(str(raw_sale)).quantize(Decimal("0.01"))
        list_price = Decimal(str(raw_list)).quantize(Decimal("0.01"))
        brand = item.get("brand")
        ean = normalize_ean(item.get("ean") or item.get("barcode"))
        content = resolve_content(
            raw_name,
            measurement_unit=item.get("unit"),
            unit_multiplier=item.get("net_content"),
        )
        calibrated = apply_calibration(sale_price, self.config.markup_discount_factor)
        pum = compute_pum(calibrated, content.net_content)
        normalized_name = normalize_product_name(raw_name)

        return self.validate_product(
            {
                "store_id": self.config.store_id,
                "external_sku": sku,
                "ean": ean,
                "raw_name": raw_name,
                "normalized_name": normalized_name,
                "brand": brand,
                "raw_list_price": max(list_price, sale_price),
                "raw_sale_price": sale_price,
                "calibrated_price": calibrated,
                "net_content": content.net_content,
                "unit_measure": content.unit_measure,
                "pum_price": pum,
                "in_stock": bool(item.get("in_stock", sale_price > 0)),
                "source_origin": "ara_api",
                "raw_url": item.get("url"),
                "image_url": item.get("image_url") or item.get("image"),
                "canonical_category_slug": infer_canonical_category_slug(
                    normalized_name, content.net_content, content.unit_measure
                ),
                "is_private_label": is_store_private_label(self.config.store_id, brand, ean),
            }
        )
