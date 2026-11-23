"""Base reutilizable para supermercados sobre WooCommerce Store API (`/wp-json/wc/store/v1`)."""

from __future__ import annotations

import html as html_lib
import logging
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from etl.core.base_scraper import BaseScraper, ScraperHTTPError
from etl.core.calibrator import apply_calibration
from etl.core.canonical_mapper import infer_canonical_category_slug, is_store_private_label
from etl.core.grocery_filter import evaluate_category_path_whitelist, is_mercado_product
from etl.core.models import ScrapedProduct, ScraperConfig
from etl.core.normalizer import (
    compute_pum,
    normalize_ean,
    normalize_product_name,
    resolve_content,
)

logger = logging.getLogger(__name__)


class WooCommerceStoreScraper(BaseScraper):
    """Conector genérico sobre `/wp-json/wc/store/v1/products` y `/products/categories`."""

    _PER_PAGE = 100
    _MAX_PAGES = 100
    _MAX_CATEGORY_PAGES = 20

    def __init__(
        self,
        config: ScraperConfig,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(config, client=client)

    async def _fetch_category_paths(self) -> dict[int, list[str]]:
        """Construye mapa `{category_id: [root, ..., leaf]}` desde Store API."""
        raw_cats: list[dict[str, Any]] = []
        for page in range(1, self._MAX_CATEGORY_PAGES + 1):
            try:
                resp = await self.request(
                    "GET",
                    "/wp-json/wc/store/v1/products/categories",
                    params={"per_page": 100, "page": page},
                )
                batch = resp.json()
            except (ScraperHTTPError, ValueError) as exc:
                logger.warning("[%s] Error consultando categorías p=%d: %s", self.config.store_id, page, exc)
                break

            if not isinstance(batch, list) or not batch:
                break
            raw_cats.extend(item for item in batch if isinstance(item, dict))

            total_pages_hdr = resp.headers.get("X-WP-TotalPages")
            total_pages = int(total_pages_hdr) if total_pages_hdr and total_pages_hdr.isdigit() else None
            if total_pages is not None:
                if page >= total_pages:
                    break
            elif len(batch) < 100:
                break

        by_id = {int(c["id"]): c for c in raw_cats if c.get("id") is not None}
        paths: dict[int, list[str]] = {}
        for cid in by_id:
            segs: list[str] = []
            cur = by_id.get(cid)
            visited: set[int] = set()
            while cur and int(cur["id"]) not in visited:
                visited.add(int(cur["id"]))
                name = html_lib.unescape(str(cur.get("name") or "")).strip()
                if name:
                    segs.append(name)
                parent_id = cur.get("parent")
                cur = by_id.get(int(parent_id)) if isinstance(parent_id, int) and parent_id else None
            paths[cid] = list(reversed(segs))
        return paths

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Pagina `/wp-json/wc/store/v1/products` emitiendo lotes validados."""
        category_paths = await self._fetch_category_paths()
        seen_skus: set[str] = set()
        max_pages = min(self._MAX_PAGES, self.config.max_categories or self._MAX_PAGES)

        for page in range(1, max_pages + 1):
            try:
                resp = await self.request(
                    "GET",
                    "/wp-json/wc/store/v1/products",
                    params={"per_page": self._PER_PAGE, "page": page},
                )
                items = resp.json()
            except (ScraperHTTPError, ValueError) as exc:
                logger.warning("[%s] Error consultando productos p=%d: %s", self.config.store_id, page, exc)
                break

            if not isinstance(items, list) or not items:
                break

            batch: list[ScrapedProduct] = []
            for raw in items:
                if not isinstance(raw, dict):
                    continue
                model = self._parse_wc_product(raw, category_paths=category_paths)
                if model and model.external_sku not in seen_skus:
                    seen_skus.add(model.external_sku)
                    batch.append(model)
            if batch:
                yield batch

            total_pages_hdr = resp.headers.get("X-WP-TotalPages")
            total_pages = int(total_pages_hdr) if total_pages_hdr and total_pages_hdr.isdigit() else None
            if total_pages is not None:
                if page >= total_pages:
                    break
            elif len(items) < self._PER_PAGE:
                break

    def _infer_brand(
        self,
        raw: dict[str, Any],
        *,
        normalized_name: str,
        resolved_path: list[str],
    ) -> str | None:
        """Extrae marca reportada por WooCommerce Brands cuando esté presente."""
        brands = raw.get("brands")
        if isinstance(brands, list):
            for entry in brands:
                if isinstance(entry, dict):
                    bname = html_lib.unescape(str(entry.get("name") or "")).strip()
                    if bname:
                        return bname
        return None

    def _parse_wc_product(
        self,
        raw: dict[str, Any],
        *,
        category_paths: dict[int, list[str]],
    ) -> ScrapedProduct | None:
        prod_id = raw.get("id")
        if prod_id is None:
            return None
        external_sku = str(prod_id).strip()
        raw_name = " ".join(html_lib.unescape(str(raw.get("name") or "")).split()).strip()
        if not external_sku or not raw_name:
            return None

        resolved_path = self._resolve_allowed_category_path(
            raw.get("categories"),
            category_paths=category_paths,
        )
        if resolved_path is None:
            return None

        prices = raw.get("prices") if isinstance(raw.get("prices"), dict) else {}
        minor_unit = int(prices.get("currency_minor_unit") or 0)
        divisor = Decimal(10) ** max(0, minor_unit)

        sale_price = self._to_decimal(prices.get("sale_price") or prices.get("price"), divisor=divisor)
        if sale_price is None or sale_price <= 0:
            sale_price = self._to_decimal(prices.get("price"), divisor=divisor)
        if sale_price is None or sale_price <= 0:
            return None

        list_price = self._to_decimal(prices.get("regular_price"), divisor=divisor) or sale_price
        if list_price < sale_price:
            list_price = sale_price

        raw_url = str(raw.get("permalink") or "").strip() or None
        ean = normalize_ean(raw.get("sku"))

        content = resolve_content(raw_name)
        normalized_name = normalize_product_name(raw_name)
        inferred_brand = self._infer_brand(
            raw,
            normalized_name=normalized_name,
            resolved_path=resolved_path,
        )

        if not is_mercado_product(
            self.config.store_id,
            raw_name,
            brand=inferred_brand,
            raw_url=raw_url,
            category_path=resolved_path or None,
        ):
            return None

        image_url: str | None = None
        images = raw.get("images")
        if isinstance(images, list) and images and isinstance(images[0], dict):
            src = images[0].get("src")
            if isinstance(src, str) and src.strip():
                image_url = src.strip()

        calibrated = apply_calibration(sale_price, self.config.markup_discount_factor)
        pum = compute_pum(calibrated, content.net_content)
        canonical_slug = infer_canonical_category_slug(
            normalized_name, content.net_content, content.unit_measure
        )
        in_stock = bool(raw.get("is_in_stock", True))

        return self.validate_product(
            {
                "store_id": self.config.store_id,
                "external_sku": external_sku,
                "ean": ean,
                "raw_name": raw_name,
                "normalized_name": normalized_name,
                "brand": inferred_brand,
                "raw_list_price": list_price,
                "raw_sale_price": sale_price,
                "calibrated_price": calibrated,
                "net_content": content.net_content,
                "unit_measure": content.unit_measure,
                "pum_price": pum,
                "in_stock": in_stock,
                "source_origin": self.config.source_origin,
                "raw_url": raw_url,
                "image_url": image_url,
                "canonical_category_slug": canonical_slug,
                "is_private_label": is_store_private_label(
                    self.config.store_id, inferred_brand, ean
                ),
                "category_path": resolved_path,
            }
        )

    @staticmethod
    def _resolve_allowed_category_path(
        raw_cats: Any,
        *,
        category_paths: dict[int, list[str]],
    ) -> list[str] | None:
        if not isinstance(raw_cats, list) or not raw_cats:
            return []

        best_allowed: list[str] | None = None
        for entry in raw_cats:
            if not isinstance(entry, dict):
                continue
            cid = entry.get("id")
            if isinstance(cid, int) and cid in category_paths:
                path = category_paths[cid]
            else:
                cname = html_lib.unescape(str(entry.get("name") or "")).strip()
                path = [cname] if cname else []
            if not path:
                continue

            dec, _ = evaluate_category_path_whitelist(path)
            if dec == "DENY":
                return None
            if dec == "ALLOW" and (best_allowed is None or len(path) > len(best_allowed)):
                best_allowed = path

        return best_allowed

    @staticmethod
    def _to_decimal(val: Any, *, divisor: Decimal) -> Decimal | None:
        if val is None or val == "":
            return None
        try:
            num = Decimal(str(val).strip()) / divisor
        except (InvalidOperation, ValueError):
            return None
        return num.quantize(Decimal("0.01"))
