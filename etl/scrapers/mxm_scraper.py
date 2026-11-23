"""Conector REST público para Más x Menos Colombia (`mxm.com.co`)."""

from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator, Sequence
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
    extract_content_from_text,
    normalize_product_name,
    resolve_content,
)

logger = logging.getLogger(__name__)

_MXM_PUBLIC_STORE_URL = "https://mxm.com.co"
_MXM_PRIVATE_LABEL_RE = re.compile(r"\b(?:mxm|mas\s+x\s+menos)\b", re.IGNORECASE)
DEFAULT_MXM_STORE_IDS: tuple[int, ...] = (3,)


def default_mxm_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Supermercados Más x Menos (Santander)."""
    base = ScraperConfig(
        store_id="mxm",
        base_url="https://api-cliente-mxm.peermarket.app/api",
        channel_type="peermarket_rest",
        source_origin="mxm_web",
        requests_per_second=3.0,
        max_concurrency=2,
        default_headers={
            "Origin": _MXM_PUBLIC_STORE_URL,
            "Referer": f"{_MXM_PUBLIC_STORE_URL}/",
            "Accept": "application/json",
        },
    )
    return base.model_copy(update=overrides) if overrides else base


class MxmScraper(BaseScraper):
    """Extractor del endpoint `/invitado/*` usado por la SPA de `mxm.com.co`."""

    _MAX_PAGES_PER_CATEGORY = 50

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        store_ids: Sequence[int] | None = None,
    ) -> None:
        super().__init__(config or default_mxm_config(), client=client)
        self.store_ids: tuple[int, ...] = (
            tuple(store_ids) if store_ids is not None else DEFAULT_MXM_STORE_IDS
        )

    async def discover_allowed_categories(
        self,
        store_id: int,
    ) -> list[tuple[int, list[str]]]:
        """Consulta el árbol `/invitado/{id}/categorias` y aplica lista blanca pre-scraping."""
        try:
            response = await self.request("GET", f"/invitado/{store_id}/categorias")
            payload = response.json()
        except (ScraperHTTPError, ValueError) as exc:
            logger.warning("[mxm] Error consultando categorías tienda=%s: %s", store_id, exc)
            return []

        raw_cats = payload.get("categorias") if isinstance(payload, dict) else []
        if not isinstance(raw_cats, list):
            return []

        allowed: list[tuple[int, list[str]]] = []
        unknown_previews: list[str] = []
        seen_ids: set[int] = set()

        for root in raw_cats:
            if not isinstance(root, dict):
                continue
            root_id = self._to_int(root.get("id"))
            root_name = str(root.get("nombre") or "").strip()
            if not root_id or not root_name:
                continue

            subcats = root.get("subCategorias")
            candidates: list[tuple[int, list[str]]] = []
            if isinstance(subcats, list) and subcats:
                for sub in subcats:
                    if not isinstance(sub, dict):
                        continue
                    sub_id = self._to_int(sub.get("id"))
                    sub_name = str(sub.get("nombre") or "").strip()
                    if sub_id and sub_name:
                        candidates.append((sub_id, [root_name, sub_name]))
            else:
                candidates.append((root_id, [root_name]))

            for cat_id, segments in candidates:
                if cat_id in seen_ids:
                    continue
                seen_ids.add(cat_id)
                decision, _reason = evaluate_category_path_whitelist(segments)
                if decision == "DENY":
                    continue
                if decision == "UNKNOWN":
                    unknown_previews.append(" > ".join(segments))
                    continue
                allowed.append((cat_id, segments))

        if unknown_previews:
            logger.info(
                "[mxm] Lista blanca omitió %d categorías desconocidas pre-scraping (ej.: %s).",
                len(unknown_previews),
                ", ".join(unknown_previews[:8]),
            )

        if self.config.max_categories:
            return allowed[: self.config.max_categories]
        return allowed

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Pagina las subcategorías aprobadas de MXM emitiendo lotes validados."""
        seen_skus: set[str] = set()

        for mxm_store_id in self.store_ids:
            categories = await self.discover_allowed_categories(mxm_store_id)
            for cat_id, category_path in categories:
                for page in range(1, self._MAX_PAGES_PER_CATEGORY + 1):
                    try:
                        response = await self.request(
                            "GET",
                            f"/invitado/{cat_id}/categorias-productos",
                            params={"idTienda": mxm_store_id, "page": page},
                        )
                        payload = response.json()
                    except (ScraperHTTPError, ValueError) as exc:
                        logger.warning(
                            "[mxm] Error consultando cat=%s page=%d tienda=%s: %s",
                            cat_id,
                            page,
                            mxm_store_id,
                            exc,
                        )
                        break

                    prod_box = payload.get("productos") if isinstance(payload, dict) else None
                    if not isinstance(prod_box, dict):
                        break
                    items = prod_box.get("data")
                    if not isinstance(items, list) or not items:
                        break

                    batch: list[ScrapedProduct] = []
                    for raw in items:
                        if not isinstance(raw, dict):
                            continue
                        model = self._parse_mxm_item(raw, category_path=category_path)
                        if model and model.external_sku not in seen_skus:
                            seen_skus.add(model.external_sku)
                            batch.append(model)
                    if batch:
                        yield batch

                    current_page = self._to_int(prod_box.get("current_page")) or page
                    last_page = self._to_int(prod_box.get("last_page")) or current_page
                    if current_page >= last_page:
                        break

    def _parse_mxm_item(
        self,
        raw: dict[str, Any],
        *,
        category_path: list[str],
    ) -> ScrapedProduct | None:
        sku = str(raw.get("id_producto") or "").strip()
        base_name = " ".join(str(raw.get("nombre") or "").split()).strip()
        if not sku or not base_name:
            return None

        list_price = self._to_decimal(raw.get("precio"))
        if list_price is None or list_price <= 0:
            return None

        sale_price = list_price
        promo_price = self._extract_promo_price(raw)
        if promo_price is not None and promo_price < list_price:
            sale_price = promo_price

        presentation = " ".join(str(raw.get("presentacion") or "").split()).strip()
        title_content = extract_content_from_text(base_name)
        pres_content = extract_content_from_text(presentation) if presentation else None

        if title_content is None and pres_content is not None and presentation.lower() not in base_name.lower():
            raw_name = f"{base_name} {presentation}".strip()
        else:
            raw_name = base_name

        content = title_content or pres_content or resolve_content(raw_name)
        brand = "MxM" if _MXM_PRIVATE_LABEL_RE.search(base_name) else None
        raw_url = f"{_MXM_PUBLIC_STORE_URL}/invitado/producto/{sku}"

        if not is_mercado_product(
            self.config.store_id,
            raw_name,
            brand=brand,
            raw_url=raw_url,
            category_path=category_path or None,
        ):
            return None

        image_url = self._extract_image_url(raw)
        normalized_name = normalize_product_name(raw_name)
        calibrated = apply_calibration(sale_price, self.config.markup_discount_factor)
        pum = compute_pum(calibrated, content.net_content)
        canonical_slug = infer_canonical_category_slug(
            normalized_name, content.net_content, content.unit_measure
        )

        qty_dec = self._to_decimal(raw.get("cantidad"))
        in_stock = qty_dec > 0 if qty_dec is not None else True

        return self.validate_product(
            {
                "store_id": self.config.store_id,
                "external_sku": sku,
                "ean": None,
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
                "image_url": image_url,
                "canonical_category_slug": canonical_slug,
                "is_private_label": is_store_private_label(self.config.store_id, brand, None),
                "category_path": list(category_path),
            }
        )

    @classmethod
    def _extract_promo_price(cls, raw: dict[str, Any]) -> Decimal | None:
        if not raw.get("promocion"):
            return None
        data_promo = raw.get("data_promocion")
        if not isinstance(data_promo, dict):
            return None
        dec = cls._to_decimal(data_promo.get("promo_valor"))
        return dec if dec is not None and dec > 0 else None

    @staticmethod
    def _extract_image_url(raw: dict[str, Any]) -> str | None:
        direct = raw.get("imagen")
        if isinstance(direct, str) and direct.strip().startswith("http"):
            return direct.strip()
        imgs = raw.get("imagenes")
        if isinstance(imgs, list):
            for img in imgs:
                if isinstance(img, str) and img.strip().startswith("http"):
                    return img.strip()
        return None

    @staticmethod
    def _to_int(val: Any) -> int | None:
        try:
            return int(val)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _to_decimal(val: Any) -> Decimal | None:
        if val is None:
            return None
        try:
            dec = Decimal(str(val))
        except (InvalidOperation, ValueError):
            return None
        if dec < 0:
            return None
        return dec.quantize(Decimal("0.01"))
