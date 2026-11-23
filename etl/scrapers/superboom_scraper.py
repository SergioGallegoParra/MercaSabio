"""Conector Odoo SSR público (`/shop`) para Supermercados Boom (`web.superboom.net`)."""

from __future__ import annotations

import html as html_lib
import logging
import re
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from etl.core.base_scraper import BaseScraper, ScraperHTTPError
from etl.core.calibrator import apply_calibration
from etl.core.canonical_mapper import infer_canonical_category_slug, is_store_private_label
from etl.core.grocery_filter import (
    evaluate_category_path_whitelist,
    is_mercado_category_path,
    is_mercado_product,
    strip_accents_lower,
)
from etl.core.models import ScrapedProduct, ScraperConfig
from etl.core.normalizer import compute_pum, normalize_product_name, resolve_content

logger = logging.getLogger(__name__)

_MIXED_ROOT_NORMS: frozenset[str] = frozenset({"hogar", "aseo personal"})
_PILL_RE = re.compile(
    r'class="[^"]*tp-category-pill[^"]*"[^>]*>\s*<a[^>]+href="(/shop/category/[^"]+)"[^>]*>.*?<h6[^>]*>(.*?)</h6>',
    re.DOTALL,
)
_FORM_CARD_RE = re.compile(
    r'<form\b[^>]*class="[^"]*oe_product_cart[^"]*"[^>]*>.*?</form>',
    re.DOTALL,
)
_PRODUCT_ID_RE = re.compile(r'data-product-id="(\d+)"')
_URL_ATTR_RE = re.compile(r'itemprop="url"\s+href="([^"]+)"|href="([^"]+)"[^>]*itemprop="url"')
_NAME_TITLE_RE = re.compile(
    r'itemprop="name"[^>]*title="([^"]+)"|title="([^"]+)"[^>]*itemprop="name"'
)
_IMG_SRC_RE = re.compile(r'<img[^>]+src="(/web/image/product\.template/[^"]+)"')
_ITEMPROP_PRICE_RE = re.compile(r'itemprop="price"[^>]*>([0-9.]+)</span>')
_LIST_PRICE_SMALL_RE = re.compile(
    r'<small\b([^>]*list_price[^>]*)>.*?<span[^>]*class="[^"]*oe_currency_value[^"]*"[^>]*>([^<]+)</span>.*?</small>',
    re.DOTALL,
)


def default_superboom_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Supermercados Boom (Odoo SSR, Medellín)."""
    base = ScraperConfig(
        store_id="superboom",
        base_url="https://web.superboom.net",
        channel_type="odoo_ssr",
        source_origin="superboom_web",
        requests_per_second=3.0,
        max_concurrency=2,
    )
    return base.model_copy(update=overrides) if overrides else base


class SuperboomScraper(BaseScraper):
    """Extractor HTML Odoo `/shop` con árbol de categorías y lista blanca pre-scraping."""

    _MAX_PAGES_PER_CATEGORY = 60

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(config or default_superboom_config(), client=client)

    @staticmethod
    def extract_category_pills(html: str) -> list[tuple[str, str]]:
        """Extrae pares `(href, nombre)` de las píldoras `tp-category-pill` de Odoo."""
        out: list[tuple[str, str]] = []
        seen: set[str] = set()
        for href, raw_title in _PILL_RE.findall(html):
            clean_href = html_lib.unescape(href).split("?", 1)[0].strip()
            if not clean_href or clean_href in seen:
                continue
            seen.add(clean_href)
            title = " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", raw_title)).split()).strip()
            if title:
                out.append((clean_href, title))
        return out

    @classmethod
    def extract_raw_products_from_html(cls, html: str) -> list[dict[str, Any]]:
        """Parsea tarjetas `oe_product_cart` de una página de listado Odoo."""
        cards: list[dict[str, Any]] = []
        for block in _FORM_CARD_RE.findall(html):
            sku_match = _PRODUCT_ID_RE.search(block)
            url_match = _URL_ATTR_RE.search(block)
            name_match = _NAME_TITLE_RE.search(block)
            price_match = _ITEMPROP_PRICE_RE.search(block)
            if not (sku_match and name_match and price_match):
                continue

            raw_name = html_lib.unescape((name_match.group(1) or name_match.group(2) or "")).strip()
            raw_href = html_lib.unescape((url_match.group(1) or url_match.group(2) or "")) if url_match else ""
            raw_href = raw_href.split("?", 1)[0].strip()
            img_match = _IMG_SRC_RE.search(block)
            img_path = html_lib.unescape(img_match.group(1)).strip() if img_match else None

            list_price_str: str | None = None
            lp_match = _LIST_PRICE_SMALL_RE.search(block)
            if lp_match and "d-none" not in lp_match.group(1):
                list_price_str = lp_match.group(2).strip()

            cards.append(
                {
                    "sku": sku_match.group(1).strip(),
                    "name": raw_name,
                    "href": raw_href,
                    "image_path": img_path,
                    "sale_price": price_match.group(1).strip(),
                    "list_price": list_price_str,
                }
            )
        return cards

    async def discover_allowed_categories(self) -> list[tuple[str, list[str]]]:
        """Descubre categorías/subcategorías en `/shop` filtradas pre-scraping."""
        try:
            shop_resp = await self.request("GET", "/shop")
        except ScraperHTTPError as exc:
            logger.warning("[superboom] Error consultando /shop: %s", exc)
            return []

        roots = self.extract_category_pills(shop_resp.text)
        allowed: list[tuple[str, list[str]]] = []
        unknown_previews: list[str] = []
        seen_paths: set[str] = set()

        for root_href, root_name in roots:
            root_norm = strip_accents_lower(root_name)
            if not is_mercado_category_path([root_name]) and root_norm not in _MIXED_ROOT_NORMS:
                continue

            root_prefix = root_href.removeprefix("/shop/category/").rsplit("-", 1)[0]
            try:
                root_resp = await self.request("GET", root_href)
            except ScraperHTTPError as exc:
                logger.warning("[superboom] Error consultando raíz %s: %s", root_href, exc)
                continue

            sub_pills = [
                (sub_href, sub_name)
                for sub_href, sub_name in self.extract_category_pills(root_resp.text)
                if sub_href != root_href
                and sub_href.removeprefix("/shop/category/").startswith(f"{root_prefix}-")
            ]

            candidates = (
                [(sub_href, [root_name, sub_name]) for sub_href, sub_name in sub_pills]
                if sub_pills
                else [(root_href, [root_name])]
            )

            for cat_href, segments in candidates:
                if cat_href in seen_paths:
                    continue
                seen_paths.add(cat_href)
                decision, _reason = evaluate_category_path_whitelist(segments)
                if decision == "DENY":
                    continue
                if decision == "UNKNOWN":
                    unknown_previews.append(" > ".join(segments))
                    continue
                allowed.append((cat_href, segments))

        if unknown_previews:
            logger.info(
                "[superboom] Lista blanca omitió %d categorías desconocidas pre-scraping (ej.: %s).",
                len(unknown_previews),
                ", ".join(unknown_previews[:8]),
            )

        if self.config.max_categories:
            return allowed[: self.config.max_categories]
        return allowed

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Pagina las subcategorías aprobadas de Supermercados Boom emitiendo lotes validados."""
        seen_skus: set[str] = set()
        categories = await self.discover_allowed_categories()

        for cat_href, category_path in categories:
            cat_seen: set[str] = set()
            max_page_seen = 1

            for page in range(1, self._MAX_PAGES_PER_CATEGORY + 1):
                if page > max_page_seen and page > 1:
                    break
                page_path = cat_href if page == 1 else f"{cat_href}/page/{page}"
                try:
                    response = await self.request("GET", page_path)
                except ScraperHTTPError as exc:
                    logger.warning("[superboom] Error consultando %s: %s", page_path, exc)
                    break

                page_nums = [
                    int(num)
                    for num in re.findall(rf"{re.escape(cat_href)}/page/(\d+)", response.text)
                ]
                if page_nums:
                    max_page_seen = max(max_page_seen, max(page_nums))

                raw_cards = self.extract_raw_products_from_html(response.text)
                if not raw_cards:
                    break

                page_skus: set[str] = set()
                batch: list[ScrapedProduct] = []
                for raw in raw_cards:
                    sku = raw["sku"]
                    page_skus.add(sku)
                    model = self._parse_boom_card(raw, category_path=category_path)
                    if model and model.external_sku not in seen_skus:
                        seen_skus.add(model.external_sku)
                        batch.append(model)

                if batch:
                    yield batch

                if page_skus.issubset(cat_seen) or page >= max_page_seen:
                    break
                cat_seen.update(page_skus)

    def _parse_boom_card(
        self,
        raw: dict[str, Any],
        *,
        category_path: list[str],
    ) -> ScrapedProduct | None:
        sku = str(raw.get("sku") or "").strip()
        raw_name = " ".join(str(raw.get("name") or "").split()).strip()
        if not sku or not raw_name:
            return None

        sale_price = self._to_decimal(raw.get("sale_price"))
        if sale_price is None or sale_price <= 0:
            return None

        list_price = self._parse_colombian_currency(raw.get("list_price")) or sale_price
        if list_price < sale_price:
            list_price = sale_price

        href = str(raw.get("href") or "").strip()
        base = self.config.base_url.rstrip("/")
        raw_url = f"{base}/{href.lstrip('/')}" if href else base

        if not is_mercado_product(
            self.config.store_id,
            raw_name,
            brand=None,
            raw_url=raw_url,
            category_path=category_path or None,
        ):
            return None

        image_path = raw.get("image_path")
        image_url = (
            f"{base}/{image_path.lstrip('/')}"
            if isinstance(image_path, str) and image_path.strip()
            else None
        )

        content = resolve_content(raw_name)
        normalized_name = normalize_product_name(raw_name)
        calibrated = apply_calibration(sale_price, self.config.markup_discount_factor)
        pum = compute_pum(calibrated, content.net_content)
        canonical_slug = infer_canonical_category_slug(
            normalized_name, content.net_content, content.unit_measure
        )

        return self.validate_product(
            {
                "store_id": self.config.store_id,
                "external_sku": sku,
                "ean": None,
                "raw_name": raw_name,
                "normalized_name": normalized_name,
                "brand": None,
                "raw_list_price": list_price,
                "raw_sale_price": sale_price,
                "calibrated_price": calibrated,
                "net_content": content.net_content,
                "unit_measure": content.unit_measure,
                "pum_price": pum,
                "in_stock": True,
                "source_origin": self.config.source_origin,
                "raw_url": raw_url,
                "image_url": image_url,
                "canonical_category_slug": canonical_slug,
                "is_private_label": is_store_private_label(self.config.store_id, None, None),
                "category_path": list(category_path),
            }
        )

    @staticmethod
    def _to_decimal(val: Any) -> Decimal | None:
        if val is None or val == "":
            return None
        try:
            dec = Decimal(str(val))
        except (InvalidOperation, ValueError):
            return None
        if dec < 0:
            return None
        return dec.quantize(Decimal("0.01"))

    @classmethod
    def _parse_colombian_currency(cls, raw: str | None) -> Decimal | None:
        if not raw:
            return None
        cleaned = raw.strip().replace("$", "").replace("\xa0", "").replace(" ", "")
        if not cleaned:
            return None
        if "," in cleaned:
            cleaned = cleaned.replace(".", "").replace(",", ".")
        elif re.match(r"^\d{1,3}(?:\.\d{3})+$", cleaned):
            cleaned = cleaned.replace(".", "")
        return cls._to_decimal(cleaned)
