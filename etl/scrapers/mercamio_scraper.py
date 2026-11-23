"""Conector REST Waco e-commerce para Supermercados Mercamio (`mercamio.com` / Cali y Bogotá)."""

from __future__ import annotations

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
    is_mercado_product,
    strip_accents_lower,
)
from etl.core.models import ScrapedProduct, ScraperConfig
from etl.core.normalizer import (
    compute_pum,
    extract_content_from_text,
    normalize_ean,
    normalize_product_name,
    resolve_content,
)

logger = logging.getLogger(__name__)

_DEFAULT_OFFICE_ID = "663967781694525f877d0fb0"  # Ciudad Jardín (Cali)
_PUBLIC_SITE_ORIGIN = "https://mercamio-domicilios.firebaseapp.com"
_PLACEHOLDER_BRAND_RE = re.compile(r"^[xX.\s_-]+$")
_NOISE_PUM_UNITS: dict[str, str] = {
    "g": "g",
    "gr": "g",
    "grm": "g",
    "gramo": "g",
    "gramos": "g",
    "kg": "kg",
    "kilogramo": "kg",
    "ml": "ml",
    "cc": "ml",
    "l": "l",
    "lt": "l",
    "litro": "l",
    "litros": "l",
}


def default_mercamio_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Supermercados Mercamio (Waco REST)."""
    base = ScraperConfig(
        store_id="mercamio",
        base_url="https://wacoecommerce-js4zy.ondigitalocean.app",
        channel_type="waco_rest",
        source_origin="mercamio_web",
        requests_per_second=3.0,
        max_concurrency=2,
        default_headers={
            "Origin": _PUBLIC_SITE_ORIGIN,
            "Referer": f"{_PUBLIC_SITE_ORIGIN}/",
            "x-business": "mercamio",
            "at-business": "mercamio",
            "Accept": "application/json",
        },
    )
    return base.model_copy(update=overrides) if overrides else base


class MercamioScraper(BaseScraper):
    """Extractor del catálogo público Waco `/api/v2/categories` + `/api/v1/products/all_paginate`."""

    _PAGE_SIZE = 200
    _MAX_PAGES = 100

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        office_id: str | None = None,
    ) -> None:
        super().__init__(config or default_mercamio_config(), client=client)
        self.office_id = office_id

    async def _resolve_office_id(self) -> str:
        if self.office_id:
            return self.office_id
        try:
            resp = await self.request("GET", "/api/v2/offices")
            offices = resp.json().get("offices") if isinstance(resp.json(), dict) else []
            if isinstance(offices, list) and offices:
                preferred = next(
                    (o for o in offices if isinstance(o, dict) and str(o.get("city") or "").lower() == "cali"),
                    offices[0],
                )
                if isinstance(preferred, dict) and preferred.get("id"):
                    return str(preferred["id"])
        except (ScraperHTTPError, ValueError) as exc:
            logger.warning("[mercamio] Error consultando sedes (/api/v2/offices): %s", exc)
        return _DEFAULT_OFFICE_ID

    async def _discover_allowed_categories(self, office_id: str) -> dict[str, list[str]]:
        """Obtiene categorías `/api/v2/categories` aprobadas por la lista blanca."""
        try:
            resp = await self.request(
                "GET",
                "/api/v2/categories",
                params={"branch_id": office_id},
                headers={"x-office": office_id},
            )
            payload = resp.json()
        except (ScraperHTTPError, ValueError) as exc:
            logger.warning("[mercamio] Error consultando categorías: %s", exc)
            return {}

        items = (
            payload.get("data", {}).get("items", [])
            if isinstance(payload, dict) and isinstance(payload.get("data"), dict)
            else []
        )
        allowed: dict[str, list[str]] = {}
        unknown_previews: list[str] = []

        for cat in items:
            if not isinstance(cat, dict) or cat.get("inactive") or cat.get("disabled"):
                continue
            cat_id = str(cat.get("id") or "").strip()
            name = str(cat.get("categoryName") or cat.get("originalName") or "").strip()
            if not cat_id or not name:
                continue
            decision, _reason = evaluate_category_path_whitelist([name])
            if decision == "ALLOW":
                allowed[cat_id] = [name]
            elif decision == "UNKNOWN":
                unknown_previews.append(name)

        if unknown_previews:
            logger.info(
                "[mercamio] Lista blanca omitió %d categorías desconocidas (ej.: %s).",
                len(unknown_previews),
                ", ".join(unknown_previews[:8]),
            )
        return allowed

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Pagina `/api/v1/products/all_paginate` filtrando por categorías permitidas."""
        office_id = await self._resolve_office_id()
        allowed_categories = await self._discover_allowed_categories(office_id)
        seen_skus: set[str] = set()

        max_pages = min(self._MAX_PAGES, self.config.max_categories or self._MAX_PAGES)
        req_headers = {"x-office": office_id}

        for page in range(max_pages):
            try:
                resp = await self.request(
                    "GET",
                    "/api/v1/products/all_paginate",
                    params={"page": page, "limitPerPage": self._PAGE_SIZE},
                    headers=req_headers,
                )
                payload = resp.json()
            except (ScraperHTTPError, ValueError) as exc:
                logger.warning("[mercamio] Error consultando all_paginate p=%d: %s", page, exc)
                break

            data_box = payload.get("data") if isinstance(payload, dict) else None
            if not isinstance(data_box, dict):
                break
            items = data_box.get("list")
            if not isinstance(items, list) or not items:
                break

            batch: list[ScrapedProduct] = []
            for raw in items:
                if not isinstance(raw, dict):
                    continue
                model = self._parse_mercamio_item(
                    raw,
                    office_id=office_id,
                    allowed_categories=allowed_categories,
                )
                if model and model.external_sku not in seen_skus:
                    seen_skus.add(model.external_sku)
                    batch.append(model)
            if batch:
                yield batch

            pagination = data_box.get("pagination") if isinstance(data_box.get("pagination"), dict) else {}
            total_pages = pagination.get("totalPages")
            if isinstance(total_pages, int) and page + 1 >= total_pages:
                break
            if len(items) < self._PAGE_SIZE and total_pages is None:
                break

    def _parse_mercamio_item(
        self,
        raw: dict[str, Any],
        *,
        office_id: str,
        allowed_categories: dict[str, list[str]],
    ) -> ScrapedProduct | None:
        if raw.get("inactive"):
            return None

        sku = str(raw.get("id_item") or raw.get("id") or "").strip()
        base_title = " ".join(str(raw.get("title") or "").split()).strip()
        if not sku or not base_title:
            return None

        cat_id = str(raw.get("category_id") or "").strip()
        main_cat = str(raw.get("main_category_name") or "").strip()
        tags = [str(t).strip() for t in (raw.get("tags") or []) if str(t).strip()]

        if allowed_categories:
            if cat_id in allowed_categories:
                category_path = list(allowed_categories[cat_id])
            else:
                # Si la categoría exacta no está aprobada (p. ej. Licores / Botiquín), descartar pre-mapeo
                return None
        else:
            fallback_path = [main_cat] if main_cat else []
            if fallback_path and evaluate_category_path_whitelist(fallback_path)[0] != "ALLOW":
                return None
            category_path = fallback_path

        # Bloqueo contextual por tags (ej. 'Mascotas accesorios' dentro de 'Mascotas')
        for tag in tags:
            if "accesorio" in strip_accents_lower(tag) and any("mascota" in strip_accents_lower(c) for c in category_path):
                return None

        branch_info = self._select_branch_offer(raw, office_id)
        list_price = self._to_decimal(
            (branch_info or {}).get("price") if branch_info else raw.get("price")
        )
        if list_price is None or list_price <= 0:
            return None

        sale_candidate = self._to_decimal(
            (branch_info or {}).get("price_neto") if branch_info else raw.get("price_neto")
        )
        sale_price = sale_candidate if sale_candidate is not None and 0 < sale_candidate <= list_price else list_price

        sub_title = " ".join(str(raw.get("subTitle") or "").split()).strip()
        title_content = extract_content_from_text(base_title)
        sub_content = extract_content_from_text(sub_title) if sub_title else None

        if title_content is None and sub_content is not None and sub_title.lower() not in base_title.lower():
            raw_name = f"{base_title} {sub_title}".strip()
        else:
            raw_name = base_title

        brand = self._clean_brand(raw.get("brand"))
        prod_id = str(raw.get("id") or sku).strip()
        raw_url = f"https://www.mercamio.com/product/{prod_id}"

        if not is_mercado_product(
            self.config.store_id,
            raw_name,
            brand=brand,
            raw_url=raw_url,
            category_path=category_path or None,
        ):
            return None

        ean = normalize_ean(raw.get("bar_code"))
        if ean is None and isinstance(raw.get("barcodes"), list):
            for bc in raw["barcodes"]:
                ean = normalize_ean(bc)
                if ean:
                    break

        meas_unit, unit_mult = self._extract_unit_fallback(raw, branch_info)
        content = title_content or sub_content or resolve_content(
            raw_name,
            measurement_unit=meas_unit,
            unit_multiplier=unit_mult,
        )

        normalized_name = normalize_product_name(raw_name)
        calibrated = apply_calibration(sale_price, self.config.markup_discount_factor)
        pum = compute_pum(calibrated, content.net_content)
        canonical_slug = infer_canonical_category_slug(
            normalized_name, content.net_content, content.unit_measure
        )

        stock_val = (branch_info or {}).get("stock") if branch_info else None
        in_stock = (
            bool(float(stock_val) > 0)
            if isinstance(stock_val, (int, float))
            else not bool(raw.get("withoutStock", False))
        )

        image_url = raw.get("photoUrl") or raw.get("imageUrl")
        clean_image = str(image_url).strip() if isinstance(image_url, str) and image_url.strip() else None

        return self.validate_product(
            {
                "store_id": self.config.store_id,
                "external_sku": sku,
                "ean": ean,
                "raw_name": raw_name,
                "normalized_name": normalized_name,
                "brand": brand,
                "raw_list_price": list_price,
                "raw_sale_price": sale_price,
                "calibrated_price": calibrated,
                "net_content": content.net_content,
                "unit_measure": content.unit_measure,
                "pum_price": pum,
                "in_stock": in_stock,
                "source_origin": self.config.source_origin,
                "raw_url": raw_url,
                "image_url": clean_image,
                "canonical_category_slug": canonical_slug,
                "is_private_label": is_store_private_label(self.config.store_id, brand, ean),
                "category_path": category_path,
            }
        )

    @staticmethod
    def _select_branch_offer(raw: dict[str, Any], office_id: str) -> dict[str, Any] | None:
        branches = raw.get("stock_branch_offices")
        if isinstance(branches, list):
            for entry in branches:
                if isinstance(entry, dict) and str(entry.get("id") or "") == office_id:
                    return entry
            for entry in branches:
                if isinstance(entry, dict) and (entry.get("price") or 0) > 0:
                    return entry
        return None

    @staticmethod
    def _clean_brand(raw_brand: Any) -> str | None:
        if not isinstance(raw_brand, str):
            return None
        cleaned = " ".join(raw_brand.split()).strip()
        if not cleaned or _PLACEHOLDER_BRAND_RE.match(cleaned):
            return None
        if strip_accents_lower(cleaned) in {"fruver", "generico"}:
            return None
        return cleaned

    @staticmethod
    def _extract_unit_fallback(
        raw: dict[str, Any],
        branch_info: dict[str, Any] | None,
    ) -> tuple[str | None, float]:
        pum_unit = strip_accents_lower(raw.get("unit_measurement_pum"))
        meas_unit = _NOISE_PUM_UNITS.get(pum_unit)
        if not meas_unit:
            full_unit = strip_accents_lower(raw.get("unit_measurement"))
            meas_unit = _NOISE_PUM_UNITS.get(full_unit)

        qty = (branch_info or {}).get("quantity_pum") or raw.get("quantity_pum") or raw.get("unit_gram")
        if meas_unit and isinstance(qty, (int, float)) and qty > 0:
            return meas_unit, float(qty)
        return None, 1.0

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
