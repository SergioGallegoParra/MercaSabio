"""Conector VTEX para Éxito, Carulla y Olímpica (/api/catalog_system/pub/products/search)."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation
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

VTEX_SEARCH_ENDPOINT = "/api/catalog_system/pub/products/search"
VTEX_CATEGORY_TREE_ENDPOINT = "/api/catalog_system/pub/category/tree/3"
VTEX_PAGE_SIZE = 50
VTEX_MAX_OFFSET = 2500

VTEX_STORE_CONFIGS: dict[str, ScraperConfig] = {
    "exito": ScraperConfig(
        store_id="exito",
        base_url="https://www.exito.com",
        channel_type="vtex_io",
        source_origin="vtex_api",
        requests_per_second=2.5,
        max_concurrency=3,
    ),
    "carulla": ScraperConfig(
        store_id="carulla",
        base_url="https://www.carulla.com",
        channel_type="vtex_io",
        source_origin="vtex_api",
        requests_per_second=2.5,
        max_concurrency=3,
    ),
    "olimpica": ScraperConfig(
        store_id="olimpica",
        base_url="https://www.olimpica.com",
        channel_type="vtex_legacy",
        source_origin="vtex_api",
        requests_per_second=2.0,
        max_concurrency=2,
    ),
}


class VtexScraper(BaseScraper):
    """Extractor paginado por categorías para catálogos VTEX IO y VTEX Legacy."""

    def __init__(
        self,
        config: ScraperConfig,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(config, client=client)

    @classmethod
    def for_store(
        cls,
        store_id: str,
        *,
        client: httpx.AsyncClient | None = None,
        **overrides: Any,
    ) -> VtexScraper:
        """Instancia el conector usando los valores predeterminados para la tienda VTEX."""
        key = store_id.strip().lower()
        if key not in VTEX_STORE_CONFIGS:
            supported = ", ".join(sorted(VTEX_STORE_CONFIGS))
            raise ValueError(f"Tienda VTEX no soportada: {store_id!r}. Disponibles: {supported}")
        base_config = VTEX_STORE_CONFIGS[key]
        config = base_config.model_copy(update=overrides) if overrides else base_config
        return cls(config, client=client)

    async def fetch_category_filters(self) -> list[str | None]:
        """Obtiene filtros `fq=C:/.../` desde el árbol de categorías VTEX (o usa override)."""
        if self.config.category_filters:
            filters: list[str | None] = list(self.config.category_filters)
            if self.config.max_categories:
                return filters[: self.config.max_categories]
            return filters

        try:
            tree = await self.get_json(VTEX_CATEGORY_TREE_ENDPOINT)
        except (ScraperHTTPError, ValueError) as exc:
            logger.warning(
                "[%s] No se pudo consultar árbol de categorías VTEX (%s); usando búsqueda global.",
                self.config.store_id,
                exc,
            )
            return [None]

        if not isinstance(tree, list) or not tree:
            return [None]

        fq_paths = self._flatten_category_tree(tree)
        if not fq_paths:
            return [None]

        if self.config.max_categories:
            return fq_paths[: self.config.max_categories]
        return fq_paths

    @classmethod
    def _flatten_category_tree(cls, nodes: list[dict[str, Any]]) -> list[str]:
        """Convierte nodos hoja del árbol VTEX en filtros `fq=C:/id1/id2/.../`."""
        filters: list[str] = []

        def walk(node: dict[str, Any], prefix: list[str]) -> None:
            node_id = node.get("id")
            if node_id is None:
                return
            current_path = [*prefix, str(node_id)]
            children = node.get("children") or []
            if children:
                for child in children:
                    walk(child, current_path)
            else:
                filters.append(f"C:/{'/'.join(current_path)}/")

        for root in nodes:
            walk(root, [])
        return filters

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Itera por categorías y páginas de 50 SKUs emitiendo lotes validados."""
        category_filters = await self.fetch_category_filters()
        seen_skus: set[str] = set()

        for fq in category_filters:
            offset = 0
            while offset < VTEX_MAX_OFFSET:
                to_offset = min(offset + VTEX_PAGE_SIZE - 1, VTEX_MAX_OFFSET - 1)
                params: dict[str, Any] = {
                    "_from": offset,
                    "_to": to_offset,
                }
                if fq:
                    params["fq"] = fq

                payload = await self.get_json(VTEX_SEARCH_ENDPOINT, params=params)
                if not isinstance(payload, list) or not payload:
                    break

                batch: list[ScrapedProduct] = []
                for raw_product in payload:
                    if not isinstance(raw_product, dict):
                        continue
                    for product_model in self._parse_product(raw_product):
                        if product_model.external_sku in seen_skus:
                            continue
                        seen_skus.add(product_model.external_sku)
                        batch.append(product_model)

                if batch:
                    yield batch

                if len(payload) < VTEX_PAGE_SIZE:
                    break
                offset += VTEX_PAGE_SIZE

    def _parse_product(self, raw_product: dict[str, Any]) -> list[ScrapedProduct]:
        """Extrae y valida cada SKU (`items[]`) dentro de un producto VTEX."""
        return parse_vtex_product_payload(raw_product, self.config)


def parse_vtex_product_payload(
    raw_product: dict[str, Any],
    config: ScraperConfig,
) -> list[ScrapedProduct]:
    """Parsea un nodo de producto VTEX REST o GraphQL hacia registros `ScrapedProduct`."""
    items = raw_product.get("items") or []
    if not isinstance(items, list) or not items:
        return []

    product_name = str(raw_product.get("productName") or "").strip()
    brand = raw_product.get("brand")
    raw_url = _build_vtex_product_url(raw_product, config.base_url)
    category_path = _extract_vtex_category_path(raw_product)

    parsed: list[ScrapedProduct] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        sku_id = str(item.get("itemId") or raw_product.get("productId") or "").strip()
        if not sku_id:
            continue

        offer = _select_vtex_commercial_offer(item)
        if offer is None:
            continue

        raw_name = _resolve_vtex_item_name(product_name, item)
        if not raw_name:
            continue

        sale_price = _to_vtex_decimal(offer.get("Price") if "Price" in offer else offer.get("price"))
        list_price = _to_vtex_decimal(
            offer.get("ListPrice") if "ListPrice" in offer else offer.get("listPrice")
        )
        if sale_price is None:
            continue
        if list_price is None or list_price < sale_price:
            list_price = sale_price

        in_stock = _resolve_vtex_stock(offer, sale_price)

        content = resolve_content(
            raw_name,
            measurement_unit=item.get("measurementUnit"),
            unit_multiplier=item.get("unitMultiplier"),
        )
        calibrated_price = apply_calibration(sale_price, config.markup_discount_factor)
        pum_price = compute_pum(calibrated_price, content.net_content)

        image_url = _extract_vtex_image_url(item)
        ean = normalize_ean(item.get("ean"))
        normalized_name = normalize_product_name(raw_name)
        canonical_slug = infer_canonical_category_slug(
            normalized_name,
            content.net_content,
            content.unit_measure,
        )
        private_label = is_store_private_label(config.store_id, brand, ean)

        validated = BaseScraper.validate_product(
            {
                "store_id": config.store_id,
                "external_sku": sku_id,
                "ean": ean,
                "raw_name": raw_name,
                "normalized_name": normalized_name,
                "brand": brand,
                "raw_list_price": list_price,
                "raw_sale_price": sale_price,
                "calibrated_price": calibrated_price,
                "net_content": content.net_content,
                "unit_measure": content.unit_measure,
                "pum_price": pum_price,
                "in_stock": in_stock,
                "source_origin": config.source_origin,
                "raw_url": raw_url,
                "image_url": image_url,
                "canonical_category_slug": canonical_slug,
                "is_private_label": private_label,
                "category_path": category_path,
            }
        )
        if validated is not None:
            parsed.append(validated)

    return parsed


def _select_vtex_commercial_offer(item: dict[str, Any]) -> dict[str, Any] | None:
    sellers = item.get("sellers") or []
    if not isinstance(sellers, list) or not sellers:
        return None

    ordered = sorted(
        (s for s in sellers if isinstance(s, dict)),
        key=lambda s: 0 if str(s.get("sellerId")) == "1" else 1,
    )
    for seller in ordered:
        offer = seller.get("commertialOffer") or seller.get("commercialOffer")
        if isinstance(offer, dict):
            return offer
    return None


def _resolve_vtex_item_name(product_name: str, item: dict[str, Any]) -> str:
    name_complete = str(item.get("nameComplete") or "").strip()
    item_name = str(item.get("name") or "").strip()
    if name_complete:
        return name_complete
    if product_name and item_name and item_name.lower() not in product_name.lower():
        return f"{product_name} {item_name}".strip()
    return product_name or item_name


def _to_vtex_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        dec = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if dec < 0:
        return None
    return dec.quantize(Decimal("0.01"))


def _resolve_vtex_stock(offer: dict[str, Any], sale_price: Decimal) -> bool:
    if sale_price <= 0:
        return False
    is_available = offer.get("IsAvailable") if "IsAvailable" in offer else offer.get("isAvailable")
    qty = offer.get("AvailableQuantity") if "AvailableQuantity" in offer else offer.get("availableQuantity")
    if is_available is False:
        return False
    if qty is not None:
        try:
            if float(qty) <= 0:
                return False
        except (TypeError, ValueError):
            pass
    return True


def _build_vtex_product_url(raw_product: dict[str, Any], base_url: str) -> str | None:
    link = raw_product.get("link")
    if isinstance(link, str) and link.strip():
        cleaned = link.strip()
        if cleaned.startswith(("http://", "https://")):
            return cleaned
        return f"{base_url.rstrip('/')}/{cleaned.lstrip('/')}"
    link_text = raw_product.get("linkText")
    if isinstance(link_text, str) and link_text.strip():
        return f"{base_url.rstrip('/')}/{link_text.strip().lstrip('/')}/p"
    return None


def _extract_vtex_image_url(item: dict[str, Any]) -> str | None:
    images = item.get("images") or []
    if isinstance(images, list) and images and isinstance(images[0], dict):
        url = images[0].get("imageUrl")
        if isinstance(url, str) and url.strip():
            return url.strip()
    return None


def _extract_vtex_category_path(raw_product: dict[str, Any]) -> list[str]:
    categories = raw_product.get("categories") or []
    if isinstance(categories, list) and categories and isinstance(categories[0], str):
        return [seg.strip() for seg in categories[0].split("/") if seg.strip()]
    return []
