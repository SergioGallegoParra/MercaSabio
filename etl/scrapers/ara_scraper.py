"""Conector para Tiendas Ara (Gateway oficial por ciudad representativa, API JSON y folletos PDF)."""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import os
import re
from collections import defaultdict
from collections.abc import AsyncIterator, Sequence
from decimal import Decimal
from typing import Any

import httpx

from etl.ara_ondemand.utils import (
    is_wholesale_x25,
    load_env_file_if_missing,
    parse_price_cop,
)
from etl.core.base_scraper import BaseScraper, ScraperHTTPError
from etl.core.calibrator import apply_calibration
from etl.core.canonical_mapper import (
    PRIVATE_LABEL_BRANDS_BY_STORE,
    infer_canonical_category_slug,
    is_store_private_label,
)
from etl.core.grocery_filter import is_mercado_product
from etl.core.models import ScrapedProduct, ScraperConfig
from etl.core.normalizer import (
    compute_pum,
    normalize_ean,
    normalize_product_name,
    resolve_content,
)
from etl.core.product_enrichment import (
    extract_product_metadata,
    infer_broad_category_slug,
    simplify_display_name,
)
from etl.locations.branch_ingestor import haversine_meters, normalize_colombia_city
from etl.locations.colombia_capitals_directory import COLOMBIA_CAPITALS_DIRECTORY
from etl.locations.regional_availability_sync import normalize_city_key

logger = logging.getLogger(__name__)

# Detecta precios colombianos con formato $4.500, $ 12.900 o $990
_COP_PRICE_RE = re.compile(r"\$\s*(\d{1,3}(?:[\.,]\d{3})+|\d{3,6})")
_BEFORE_AFTER_RE = re.compile(
    r"(?:antes|regular)\s*:?\s*\$\s*(\d{1,3}(?:[\.,]\d{3})+|\d{3,6}).*?"
    r"(?:ahora|hoy|oferta)?\s*:?\s*\$\s*(\d{1,3}(?:[\.,]\d{3})+|\d{3,6})",
    re.IGNORECASE,
)

ARA_GATEWAY_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
ARA_PRODUCTS_PAGE_LIMIT = 1000
ARA_DEFAULT_CITY_ORDER: tuple[str, ...] = tuple(
    cap.city for cap in COLOMBIA_CAPITALS_DIRECTORY
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


def _infer_ara_brand(normalized_name: str, explicit_brand: str | None = None) -> str | None:
    if explicit_brand and str(explicit_brand).strip():
        return " ".join(str(explicit_brand).strip().split())[:100]
    haystack = f" {normalized_name.lower()} "
    for known in sorted(PRIVATE_LABEL_BRANDS_BY_STORE.get("ara", ()), key=len, reverse=True):
        if f" {known} " in haystack:
            return known.title()[:100]
    return None


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


def select_representative_ara_stores(
    raw_stores: Sequence[dict[str, Any]],
    *,
    target_cities: Sequence[str] = ARA_DEFAULT_CITY_ORDER,
) -> list[tuple[str, str]]:
    """Selecciona exactamente 1 tienda Ara representativa por ciudad objetivo.

    Evita barrer las ~1,653 sucursales porque el precio por ciudad es homogéneo
    y las consultas puntuales por barrio se atienden en vivo vía `ara_ondemand`.
    Retorna lista ordenada `[(city_key, store_id), ...]`.
    """
    capitals_centers = {
        normalize_city_key(cap.city): (cap.center_lat, cap.center_lng)
        for cap in COLOMBIA_CAPITALS_DIRECTORY
    }
    by_city: dict[str, list[tuple[float, str]]] = defaultdict(list)

    for st in raw_stores:
        if not isinstance(st, dict):
            continue
        if str(st.get("status", "1")).strip() != "1":
            continue
        store_id = str(st.get("id") or st.get("ID") or "").strip()
        if not store_id:
            continue
        try:
            lat = float(st["latitude"])
            lng = float(st["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (-5.0 <= lat <= 14.0 and -82.5 <= lng <= -66.0):
            continue

        norm_city = normalize_colombia_city(st.get("city"), fallback_city="")
        city_key = normalize_city_key(norm_city)
        if not city_key:
            continue
        center = capitals_centers.get(city_key)
        dist = haversine_meters(lat, lng, center[0], center[1]) if center else 0.0
        by_city[city_key].append((dist, store_id))

    selected: list[tuple[str, str]] = []
    seen_stores: set[str] = set()
    for city_name in target_cities:
        city_key = normalize_city_key(normalize_colombia_city(city_name, fallback_city=city_name))
        candidates = by_city.get(city_key)
        if not candidates:
            continue
        candidates.sort(key=lambda item: (item[0], item[1]))
        chosen_store_id = candidates[0][1]
        if chosen_store_id in seen_stores:
            continue
        seen_stores.add(chosen_store_id)
        selected.append((city_key, chosen_store_id))

    return selected


def default_ara_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Tiendas Ara."""
    base = ScraperConfig(
        store_id="ara",
        base_url="https://aratiendas.com",
        channel_type="app_pdf",
        source_origin="ara_api",
        requests_per_second=4.0,
        max_concurrency=4,
    )
    return base.model_copy(update=overrides) if overrides else base


class AraScraper(BaseScraper):
    """Conector para Tiendas Ara por ciudad representativa (Gateway API y folletos PDF)."""

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        api_endpoints: list[str] | None = None,
        pdf_urls: list[str] | None = None,
        gw_base_url: str | None = None,
        gw_api_key: str | None = None,
        representative_cities: Sequence[str] | None = None,
    ) -> None:
        super().__init__(config or default_ara_config(), client=client)
        env_api = os.environ.get("ARA_API_URL", "").strip()
        env_pdfs = [u.strip() for u in os.environ.get("ARA_PDF_URLS", "").split(",") if u.strip()]
        self.api_endpoints = api_endpoints if api_endpoints is not None else ([env_api] if env_api else [])
        self.pdf_urls = pdf_urls if pdf_urls is not None else env_pdfs

        if api_endpoints is None and pdf_urls is None:
            load_env_file_if_missing()
            resolved_gw_base = (
                gw_base_url
                if gw_base_url is not None
                else os.environ.get("ARA_GW_BASE_URL", "")
            ).strip().rstrip("/")
            resolved_gw_key = (
                gw_api_key
                if gw_api_key is not None
                else os.environ.get("ARA_GW_API_KEY", "")
            ).strip()
        else:
            resolved_gw_base = (gw_base_url or "").strip().rstrip("/")
            resolved_gw_key = (gw_api_key or "").strip()

        self.gw_base_url = resolved_gw_base
        self.gw_api_key = resolved_gw_key
        self.representative_cities = tuple(representative_cities or ARA_DEFAULT_CITY_ORDER)
        self.sku_cities: dict[str, set[str]] = defaultdict(set)
        self.scraped_city_keys: list[str] = []

    def _build_client(self) -> httpx.AsyncClient:
        timeout = httpx.Timeout(max(self.config.timeout_seconds, 20.0), connect=10.0)
        limits = httpx.Limits(
            max_connections=max(self.config.max_concurrency * 2, 8),
            max_keepalive_connections=self.config.max_concurrency,
        )
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
            "User-Agent": ARA_GATEWAY_USER_AGENT,
            **self.config.default_headers,
        }
        return httpx.AsyncClient(
            base_url=self.config.base_url.rstrip("/"),
            transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0"),
            timeout=timeout,
            limits=limits,
            headers=headers,
            follow_redirects=True,
        )

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Extrae catálogo real desde el Gateway oficial (1 tienda/ciudad) o fuentes heredadas."""
        has_gateway = bool(self.gw_base_url and self.gw_api_key)
        if not has_gateway and not self.api_endpoints and not self.pdf_urls:
            logger.warning(
                "[ara] Sin ARA_GW_BASE_URL/ARA_GW_API_KEY, ARA_API_URL ni ARA_PDF_URLS configurados."
            )
            return

        seen_skus: set[str] = set()

        if has_gateway:
            async for batch in self._iter_gateway_representative_batches(seen_skus):
                yield batch

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

    async def _iter_gateway_representative_batches(
        self,
        seen_skus: set[str],
    ) -> AsyncIterator[list[ScrapedProduct]]:
        """Consulta 1 tienda representativa por ciudad configurada sin barrer las 1,653 sedes."""
        stores_payload = await self.get_json(
            f"{self.gw_base_url}/stores",
            params={"key": self.gw_api_key},
            headers={"User-Agent": ARA_GATEWAY_USER_AGENT},
        )
        raw_stores = self._unwrap_api_items(stores_payload)
        representatives = select_representative_ara_stores(
            raw_stores,
            target_cities=self.representative_cities,
        )
        if self.config.max_categories:
            representatives = representatives[: self.config.max_categories]

        self.scraped_city_keys = [city_key for city_key, _ in representatives]
        logger.info(
            "[ara] Consultando %d tiendas representativas (1 por ciudad, de %d activas totales).",
            len(representatives),
            len(raw_stores),
        )

        async def _load_city(city_key: str, store_id: str) -> tuple[str, str, list[dict[str, Any]]]:
            items = await self._fetch_gateway_store_products(store_id)
            return city_key, store_id, items

        tasks = [_load_city(city_key, store_id) for city_key, store_id in representatives]
        # Procesar en el orden prioritario de target_cities para fijar precio base en la capital principal
        city_results = await asyncio.gather(*tasks, return_exceptions=True)

        for entry in city_results:
            if isinstance(entry, BaseException):
                logger.warning("[ara] Error consultando tienda representativa: %s", entry)
                continue
            city_key, store_id, raw_items = entry
            batch: list[ScrapedProduct] = []
            for item in raw_items:
                parsed = self._parse_gateway_item(item)
                if parsed is None:
                    continue
                self.sku_cities[parsed.external_sku].add(city_key)
                if parsed.external_sku not in seen_skus:
                    seen_skus.add(parsed.external_sku)
                    batch.append(parsed)
            if batch:
                logger.info(
                    "[ara] Ciudad %s (tienda %s): +%d SKUs nuevos (%d totales activos).",
                    city_key,
                    store_id,
                    len(batch),
                    len(raw_items),
                )
                yield batch

    async def _fetch_gateway_store_products(self, store_id: str) -> list[dict[str, Any]]:
        """Pagina `/products` con `limit=1000` y `startAfter` hasta agotar la tienda."""
        items: list[dict[str, Any]] = []
        seen_item_ids: set[str] = set()
        cursor: str | None = None

        for _ in range(40):
            params: dict[str, Any] = {
                "storeId": store_id,
                "limit": str(ARA_PRODUCTS_PAGE_LIMIT),
                "key": self.gw_api_key,
            }
            if cursor:
                params["startAfter"] = cursor

            payload = await self.get_json(
                f"{self.gw_base_url}/products",
                params=params,
                headers={"User-Agent": ARA_GATEWAY_USER_AGENT},
            )
            page_items = self._unwrap_api_items(payload)
            if not page_items:
                break

            new_in_page = 0
            for item in page_items:
                raw_id = str(item.get("id") or "").strip()
                if not raw_id or raw_id in seen_item_ids:
                    continue
                seen_item_ids.add(raw_id)
                items.append(item)
                new_in_page += 1

            metadata = payload.get("metadata") if isinstance(payload, dict) else None
            next_token = metadata.get("nextPageToken") if isinstance(metadata, dict) else None
            clean_next = str(next_token).strip() if next_token else None
            if not clean_next or clean_next == cursor or new_in_page == 0:
                break
            cursor = clean_next

        return items

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

    def _parse_gateway_item(self, item: dict[str, Any]) -> ScrapedProduct | None:
        """Convierte un ítem de `/products` del Gateway de Ara en `ScrapedProduct` enriquecido."""
        if item.get("isDisabled") is True:
            return None

        raw_name = " ".join(str(item.get("title") or "").split())
        if not raw_name or is_wholesale_x25(raw_name):
            return None

        price_cop = parse_price_cop(item.get("price"))
        if price_cop is None:
            return None

        external_sku = str(item.get("id") or item.get("codeSAP") or "").strip()
        if not external_sku:
            return None

        raw_images = item.get("images") or []
        image_url = next((str(u).strip() for u in raw_images if u and str(u).strip()), None)

        ean = normalize_ean(item.get("codeEAN"))
        content = resolve_content(raw_name)
        normalized_name = normalize_product_name(raw_name)
        brand = _infer_ara_brand(normalized_name, item.get("brand"))
        raw_cat = str(item.get("category") or "").strip()
        category_path = [raw_cat] if raw_cat and not raw_cat.isdigit() else []
        if not is_mercado_product(
            self.config.store_id,
            raw_name,
            brand=brand,
            raw_url=None,
            category_path=category_path,
        ):
            return None

        sale_price = Decimal(price_cop).quantize(Decimal("0.01"))
        calibrated = apply_calibration(sale_price, self.config.markup_discount_factor)
        pum = compute_pum(calibrated, content.net_content)

        private_label = is_store_private_label(self.config.store_id, brand, ean)
        display_name = simplify_display_name(
            raw_name,
            net_content=content.net_content,
            unit_measure=content.unit_measure,
        )
        meta = extract_product_metadata(
            raw_name,
            normalized_name=normalized_name,
            is_private_label=private_label,
        )
        canonical_slug = infer_broad_category_slug(
            normalized_name,
            content.net_content,
            content.unit_measure,
            category_path=category_path or None,
        )

        return self.validate_product(
            {
                "store_id": self.config.store_id,
                "external_sku": external_sku,
                "ean": ean,
                "raw_name": raw_name[:255],
                "normalized_name": normalized_name[:255],
                "display_name": display_name[:255],
                "brand": brand,
                "raw_list_price": sale_price,
                "raw_sale_price": sale_price,
                "calibrated_price": calibrated,
                "net_content": content.net_content,
                "unit_measure": content.unit_measure,
                "pum_price": pum,
                "in_stock": True,
                "source_origin": "ara_api",
                "raw_url": None,
                "image_url": image_url,
                "canonical_category_slug": canonical_slug,
                "product_type": meta.product_type,
                "sub_presentation": meta.sub_presentation,
                "sub_presentation_label": meta.sub_presentation_label,
                "variant_tags": meta.variant_tags,
                "is_private_label": private_label,
                "category_path": category_path,
            }
        )

    def _parse_api_item(self, item: dict[str, Any]) -> ScrapedProduct | None:
        if "codeStore" in item or "codeSAP" in item or "isDisabled" in item:
            return self._parse_gateway_item(item)

        sku = str(item.get("sku") or item.get("id") or item.get("code") or "").strip()
        raw_name = str(item.get("name") or item.get("title") or item.get("description") or "").strip()
        if not sku or not raw_name or is_wholesale_x25(raw_name):
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
                "in_stock": True,
                "source_origin": "ara_api",
                "raw_url": item.get("url"),
                "image_url": item.get("image_url") or item.get("image"),
                "canonical_category_slug": infer_canonical_category_slug(
                    normalized_name, content.net_content, content.unit_measure
                ),
                "is_private_label": is_store_private_label(self.config.store_id, brand, ean),
            }
        )


def compute_ara_available_cities_map(
    sku_cities: dict[str, set[str]],
    scraped_city_keys: Sequence[str],
) -> dict[str, list[str] | None]:
    """Determina `available_cities` (`None` si es surtido nacional, o lista regional)."""
    total_cities = len(set(scraped_city_keys))
    national_threshold = max(3, total_cities // 2) if total_cities >= 5 else 1
    mapping: dict[str, list[str] | None] = {}
    for external_sku, cities in sku_cities.items():
        if not cities or len(cities) >= national_threshold:
            mapping[external_sku] = None
        else:
            mapping[external_sku] = sorted(cities)
    return mapping


def sync_ara_available_cities(
    sku_cities: dict[str, set[str]],
    scraped_city_keys: Sequence[str],
    database_url: str,
) -> int:
    """Actualiza `store_skus.available_cities` en PostgreSQL para Tiendas Ara."""
    import psycopg

    mapping = compute_ara_available_cities_map(sku_cities, scraped_city_keys)
    if not mapping:
        return 0

    rows = [(cities, ext_sku) for ext_sku, cities in mapping.items()]
    with psycopg.connect(database_url, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                UPDATE public.store_skus
                SET available_cities = %s
                WHERE store_id = 'ara' AND external_sku = %s;
                """,
                rows,
            )
        conn.commit()
    logger.info("[ara] Disponibilidad regional sincronizada para %d SKUs.", len(rows))
    return len(rows)
