"""Conector VTEX para Éxito, Carulla, Olímpica, Euro y Mercaldas."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from etl.core.base_scraper import BaseScraper, ScraperHTTPError
from etl.core.calibrator import apply_calibration
from etl.core.canonical_mapper import infer_canonical_category_slug, is_store_private_label
from etl.core.grocery_filter import (
    _MIXED_PARENT_CONTAINER_NORMS,
    evaluate_category_path_whitelist,
    is_mercado_category_name,
    is_mercado_product,
    is_priority_grocery_category_name,
    strip_accents_lower,
)
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

# Hosts VTEX estables de respaldo cuando el dominio frontal tiene WAF (HTTP 403/503).
VTEX_FALLBACK_API_HOSTS: dict[str, str] = {
    "exito": "https://exitocol.vtexcommercestable.com.br",
    "carulla": "https://carulla.vtexcommercestable.com.br",
}

DEFAULT_GROCERY_SEARCH_TERMS: tuple[str, ...] = (
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
    "salsa tomate",
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
    "blanqueador",
    "jabon",
    "crema dental",
    "papel higienico",
)

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
    "euro": ScraperConfig(
        store_id="euro",
        base_url="https://www.eurosupermercados.com.co",
        channel_type="vtex_io",
        source_origin="vtex_api",
        requests_per_second=3.0,
        max_concurrency=3,
    ),
    "mercaldas": ScraperConfig(
        store_id="mercaldas",
        base_url="https://www.mercaldas.com",
        channel_type="vtex_io",
        source_origin="vtex_api",
        requests_per_second=3.0,
        max_concurrency=3,
    ),
    "megatiendas": ScraperConfig(
        store_id="megatiendas",
        base_url="https://www.megatiendas.co",
        channel_type="vtex_io",
        source_origin="vtex_api",
        requests_per_second=3.0,
        max_concurrency=3,
    ),
    "mercacentro": ScraperConfig(
        store_id="mercacentro",
        base_url="https://www.mercacentro.com",
        channel_type="vtex_io",
        source_origin="vtex_api",
        requests_per_second=3.0,
        max_concurrency=3,
    ),
    "jumbo": ScraperConfig(
        store_id="jumbo",
        base_url="https://www.jumbocolombia.com",
        channel_type="vtex_io",
        source_origin="vtex_api",
        requests_per_second=3.0,
        max_concurrency=3,
    ),
    "metro": ScraperConfig(
        store_id="metro",
        base_url="https://metrocolombiafood.vtexcommercestable.com.br",
        channel_type="vtex_io",
        source_origin="vtex_api",
        requests_per_second=3.0,
        max_concurrency=3,
    ),
}


class VtexScraper(BaseScraper):
    """Extractor paginado por categorías y términos clave para catálogos VTEX."""

    def __init__(
        self,
        config: ScraperConfig,
        *,
        client: httpx.AsyncClient | None = None,
        search_terms: list[str] | None = None,
    ) -> None:
        super().__init__(config, client=client)
        self._api_host_override: str | None = None
        self.search_terms: list[str] = list(search_terms) if search_terms else []

    def _endpoint(self, path: str) -> str:
        if self._api_host_override:
            return f"{self._api_host_override.rstrip('/')}{path}"
        return path

    async def _get_vtex_json(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> Any:
        try:
            return await self.get_json(self._endpoint(path), params=params)
        except ScraperHTTPError as exc:
            fallback_host = VTEX_FALLBACK_API_HOSTS.get(self.config.store_id)
            if (
                exc.status_code in {403, 503}
                and fallback_host
                and self._api_host_override != fallback_host
            ):
                logger.warning(
                    "[%s] HTTP %d en %s; usando host VTEX estable %s",
                    self.config.store_id,
                    exc.status_code,
                    exc.url,
                    fallback_host,
                )
                self._api_host_override = fallback_host
                return await self.get_json(self._endpoint(path), params=params)
            raise

    @classmethod
    def for_store(
        cls,
        store_id: str,
        *,
        client: httpx.AsyncClient | None = None,
        search_terms: list[str] | None = None,
        **overrides: Any,
    ) -> VtexScraper:
        """Instancia el conector usando los valores predeterminados para la tienda VTEX."""
        key = store_id.strip().lower()
        if key not in VTEX_STORE_CONFIGS:
            supported = ", ".join(sorted(VTEX_STORE_CONFIGS))
            raise ValueError(f"Tienda VTEX no soportada: {store_id!r}. Disponibles: {supported}")
        base_config = VTEX_STORE_CONFIGS[key]
        config = base_config.model_copy(update=overrides) if overrides else base_config
        return cls(config, client=client, search_terms=search_terms)

    async def fetch_category_filters(self) -> list[str | None]:
        """Obtiene filtros `fq=C:/.../` desde el árbol de categorías VTEX (o usa override)."""
        if self.config.category_filters:
            filters: list[str | None] = list(self.config.category_filters)
            if self.config.max_categories:
                return filters[: self.config.max_categories]
            return filters

        try:
            tree = await self._get_vtex_json(VTEX_CATEGORY_TREE_ENDPOINT)
        except (ScraperHTTPError, ValueError) as exc:
            logger.warning(
                "[%s] No se pudo consultar árbol de categorías VTEX (%s); usando búsqueda global.",
                self.config.store_id,
                exc,
            )
            return [None]

        if not isinstance(tree, list) or not tree:
            return [None]

        unknown_paths: list[str] = []
        fq_paths = self._flatten_category_tree(tree, unknown_paths_out=unknown_paths)
        if unknown_paths:
            preview = ", ".join(unknown_paths[:8])
            logger.info(
                "[%s] Lista blanca omitió %d categorías desconocidas pre-scraping (ej.: %s).",
                self.config.store_id,
                len(unknown_paths),
                preview,
            )
        if not fq_paths:
            return [None]

        if self.config.max_categories:
            return fq_paths[: self.config.max_categories]
        return fq_paths

    @classmethod
    def _flatten_category_tree(
        cls,
        nodes: list[dict[str, Any]],
        *,
        max_depth: int = 3,
        unknown_paths_out: list[str] | None = None,
    ) -> list[str]:
        """Convierte nodos hoja o nivel 3 aprobados por lista blanca contextual en `fq=C:/.../`."""
        priority_filters: list[str] = []
        regular_filters: list[str] = []

        def walk(
            node: dict[str, Any],
            prefix_ids: list[str],
            prefix_names: list[str],
            is_priority_branch: bool,
        ) -> None:
            node_id = node.get("id")
            if node_id is None:
                return
            node_name = node.get("name")
            children = node.get("children") or []
            norm_name = strip_accents_lower(node_name) if isinstance(node_name, str) else ""
            if isinstance(node_name, str) and not is_mercado_category_name(node_name):
                # Contenedores padre mixtos (ej. D1 "Hogar" / "Cuidado personal y belleza", Carulla
                # "Salud y belleza", Olímpica "Belleza" / "Hogar Cocina") se exploran por sus hijos.
                if not (children and norm_name in _MIXED_PARENT_CONTAINER_NORMS):
                    return

            current_names = [*prefix_names, str(node_name).strip()] if isinstance(node_name, str) and str(node_name).strip() else list(prefix_names)
            branch_priority = is_priority_branch or (
                isinstance(node_name, str) and is_priority_grocery_category_name(node_name)
            )
            current_path = [*prefix_ids, str(node_id)]
            if children and len(current_path) < max_depth:
                for child in children:
                    walk(child, current_path, current_names, branch_priority)
            else:
                decision, _reason = evaluate_category_path_whitelist(current_names)
                if decision == "DENY":
                    return
                if decision == "UNKNOWN":
                    if unknown_paths_out is not None and current_names:
                        unknown_paths_out.append(" > ".join(current_names))
                    return
                fq = f"C:/{'/'.join(current_path)}/"
                if branch_priority:
                    priority_filters.append(fq)
                else:
                    regular_filters.append(fq)

        for root in nodes:
            walk(root, [], [], False)
        return [*priority_filters, *regular_filters]

    async def _scrape_query_params(
        self,
        base_params: dict[str, Any],
        seen_skus: set[str],
        *,
        max_offset: int = VTEX_MAX_OFFSET,
    ) -> AsyncIterator[list[ScrapedProduct]]:
        offset = 0
        while offset < max_offset:
            to_offset = min(offset + VTEX_PAGE_SIZE - 1, max_offset - 1)
            params: dict[str, Any] = {
                **base_params,
                "_from": offset,
                "_to": to_offset,
            }
            payload = await self._get_vtex_json(VTEX_SEARCH_ENDPOINT, params=params)
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

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Itera por términos clave (opcional) y categorías emitiendo lotes validados."""
        seen_skus: set[str] = set()

        for term in self.search_terms:
            clean_term = term.strip()
            if not clean_term:
                continue
            async for batch in self._scrape_query_params(
                {"ft": clean_term},
                seen_skus,
                max_offset=VTEX_PAGE_SIZE * 2,
            ):
                yield batch

        category_filters = await self.fetch_category_filters()
        for fq in category_filters:
            params: dict[str, Any] = {"fq": fq} if fq else {}
            async for batch in self._scrape_query_params(params, seen_skus):
                yield batch

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
    if not is_mercado_product(
        config.store_id,
        product_name,
        brand=str(brand) if brand is not None else None,
        raw_url=raw_url,
        category_path=category_path,
    ):
        return []

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

        if not is_mercado_product(
            config.store_id,
            raw_name,
            brand=str(brand) if brand is not None else None,
            raw_url=raw_url,
            category_path=category_path,
        ):
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

        image_url = _extract_vtex_image_url(item, raw_product)
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
        for internal_host in VTEX_FALLBACK_API_HOSTS.values():
            if cleaned.startswith(internal_host):
                cleaned = f"{base_url.rstrip('/')}{cleaned[len(internal_host):]}"
                break
        if cleaned.startswith(("http://", "https://")):
            return cleaned
        return f"{base_url.rstrip('/')}/{cleaned.lstrip('/')}"
    link_text = raw_product.get("linkText")
    if isinstance(link_text, str) and link_text.strip():
        return f"{base_url.rstrip('/')}/{link_text.strip().lstrip('/')}/p"
    return None


def _extract_vtex_image_url(item: dict[str, Any], raw_product: dict[str, Any] | None = None) -> str | None:
    candidates: list[dict[str, Any]] = [item]
    if raw_product:
        for sibling in raw_product.get("items") or []:
            if isinstance(sibling, dict) and sibling is not item:
                candidates.append(sibling)
    for cand in candidates:
        images = cand.get("images") or []
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
