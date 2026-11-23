"""Conector Shopify público (`/products.json`) para Supermercados Supermú (`www.supermu.com`)."""

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
    is_mercado_category_path,
    is_mercado_product,
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

_NOISE_TAG_PREFIXES: tuple[str, ...] = (
    "aplica para ",
    "no aplica",
)

_NOISE_TAGS: frozenset[str] = frozenset(
    {
        "aplica para ecommerce",
        "aplica para trasnochon",
        "no aplica para trasnochon",
        "carro de compras",
        "producto",
        "productos comercializados",
        "promocion",
        "generico",
        "navidad",
        "especiales",
        "descuentos",
        "ofertas",
    }
)

_HARD_BLOCKED_TAG_RE = re.compile(
    r"\b(?:"
    r"bebidas\s+alcoholicas|licores|aguardiente|cervezas?|vinos?|whisky|whiskey|tequila|vodka|ron(?:es)?|ginebra|cocteles?|"
    r"cigarrillos?|tabaco|vapeadores?|vaporizadores?|"
    r"juguetes?|jugueteria|electrodomesticos?|tecnologia|celulares?|televisores?|ferreteria|"
    r"mascotas\s+accesorios|accesorios\s+para\s+mascotas|"
    r"coloracion|tintes?|maquillaje|cosmeticos?|dermocosmetica|perfumeria|"
    r"pinateria|kit\s+navidad|arreglos?\s+navidenos?|automovil|llantas|motos"
    r")\b"
)


def default_supermu_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Supermú Colombia (Shopify JSON público)."""
    base = ScraperConfig(
        store_id="supermu",
        base_url="https://www.supermu.com",
        channel_type="shopify_json",
        source_origin="supermu_web",
        requests_per_second=3.0,
        max_concurrency=2,
        default_headers={"Accept": "application/json"},
    )
    return base.model_copy(update=overrides) if overrides else base


class SupermuScraper(BaseScraper):
    """Extractor paginado sobre `/products.json?limit=250&page=N` de Supermú."""

    _PAGE_LIMIT = 250
    _MAX_PAGES = 100

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(config or default_supermu_config(), client=client)

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Pagina `/products.json` hasta agotar el catálogo emitiendo lotes validados."""
        seen_skus: set[str] = set()
        max_pages = min(self._MAX_PAGES, self.config.max_categories or self._MAX_PAGES)

        for page in range(1, max_pages + 1):
            try:
                response = await self.request(
                    "GET",
                    "/products.json",
                    params={"limit": self._PAGE_LIMIT, "page": page},
                )
                payload = response.json()
            except (ScraperHTTPError, ValueError) as exc:
                logger.warning("[supermu] Error consultando /products.json p=%d: %s", page, exc)
                break

            raw_products = payload.get("products") if isinstance(payload, dict) else None
            if not isinstance(raw_products, list) or not raw_products:
                break

            batch: list[ScrapedProduct] = []
            for raw in raw_products:
                if not isinstance(raw, dict):
                    continue
                for model in self._parse_supermu_product(raw):
                    if model.external_sku not in seen_skus:
                        seen_skus.add(model.external_sku)
                        batch.append(model)

            if batch:
                yield batch

            if len(raw_products) < self._PAGE_LIMIT:
                break

    def _parse_supermu_product(self, raw: dict[str, Any]) -> list[ScrapedProduct]:
        base_title = " ".join(str(raw.get("title") or "").split()).strip()
        if not base_title:
            return []

        vendor_raw = raw.get("vendor")
        brand = str(vendor_raw).strip() if isinstance(vendor_raw, str) and vendor_raw.strip() else None

        category_path = self._extract_clean_category_path(raw, brand=brand)
        if category_path is None:
            return []

        handle = str(raw.get("handle") or "").strip()
        raw_url = (
            f"{self.config.base_url.rstrip('/')}/products/{handle.lstrip('/')}"
            if handle
            else self.config.base_url
        )
        default_image = self._extract_default_image(raw)

        variants = raw.get("variants")
        if not isinstance(variants, list) or not variants:
            return []

        multi_variant = len(variants) > 1
        results: list[ScrapedProduct] = []

        for variant in variants:
            if not isinstance(variant, dict):
                continue

            variant_sku = str(variant.get("sku") or "").strip()
            variant_id = str(variant.get("id") or "").strip()
            prod_id = str(raw.get("id") or "").strip()
            external_sku = variant_sku or variant_id or prod_id
            if not external_sku:
                continue

            sale_price = self._to_decimal(variant.get("price"))
            if sale_price is None or sale_price <= 0:
                continue

            compare_price = self._to_decimal(variant.get("compare_at_price"))
            list_price = compare_price if compare_price is not None and compare_price > sale_price else sale_price

            variant_title = str(variant.get("title") or "").strip()
            if multi_variant and variant_title and variant_title.lower() != "default title":
                raw_name = f"{base_title} {variant_title}".strip()
            else:
                raw_name = base_title

            if not is_mercado_product(
                self.config.store_id,
                raw_name,
                brand=brand,
                raw_url=raw_url,
                category_path=category_path or None,
            ):
                continue

            ean = normalize_ean(variant.get("barcode"))
            grams_val = variant.get("grams")
            meas_unit = "g" if isinstance(grams_val, (int, float)) and grams_val > 0 else None
            unit_mult = float(grams_val) if meas_unit else 1.0

            content = resolve_content(
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
            in_stock = bool(variant.get("available", True))

            feat_img = variant.get("featured_image")
            image_url = (
                str(feat_img.get("src")).strip()
                if isinstance(feat_img, dict) and isinstance(feat_img.get("src"), str) and feat_img["src"].strip()
                else default_image
            )

            results.append(
                self.validate_product(
                    {
                        "store_id": self.config.store_id,
                        "external_sku": external_sku,
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
                        "image_url": image_url,
                        "canonical_category_slug": canonical_slug,
                        "is_private_label": is_store_private_label(self.config.store_id, brand, ean),
                        "category_path": list(category_path),
                    }
                )
            )
        return results

    @classmethod
    def _extract_clean_category_path(
        cls,
        raw: dict[str, Any],
        *,
        brand: str | None,
    ) -> list[str] | None:
        """Filtra tags ruidosos de Shopify y retorna ruta limpia o `None` si es ajena al mercado."""
        brand_norm = strip_accents_lower(brand)
        candidates: list[str] = []

        ptype = str(raw.get("product_type") or "").strip()
        if ptype:
            candidates.append(ptype)

        raw_tags = raw.get("tags")
        if isinstance(raw_tags, str):
            raw_tags = [t.strip() for t in raw_tags.split(",") if t.strip()]
        if isinstance(raw_tags, list):
            for tag in raw_tags:
                txt = str(tag or "").strip()
                if txt:
                    candidates.append(txt)

        clean_tags: list[str] = []
        seen_norms: set[str] = set()
        for cand in candidates:
            norm = strip_accents_lower(cand)
            if not norm or norm in seen_norms:
                continue
            seen_norms.add(norm)
            if _HARD_BLOCKED_TAG_RE.search(norm):
                return None
            if norm in _NOISE_TAGS or any(norm.startswith(pref) for pref in _NOISE_TAG_PREFIXES):
                continue
            if brand_norm and norm == brand_norm:
                continue
            clean_tags.append(cand)

        if not clean_tags:
            return []

        # Shopify ordena tags alfabéticamente (ej. "BELLEZA Y CUIDADO PERSONAL" antes de "JABON");
        # evaluamos los tags individuales permitidos para no penalizar por orden alfabético.
        allowed_tags: list[str] = []
        for tag in clean_tags:
            dec, _ = evaluate_category_path_whitelist([tag])
            if dec == "ALLOW" and is_mercado_category_path([tag]):
                allowed_tags.append(tag)

        if not allowed_tags:
            # Si todos los tags cayeron en categorías mixtas/no permitidas (ej. sólo "BELLEZA"), omitir
            if any(evaluate_category_path_whitelist([t])[0] == "DENY" for t in clean_tags):
                return None
            return clean_tags[:2]

        # Ordenar del tag más corto/general al más específico sin duplicar demasiados segmentos
        return allowed_tags[:3]

    @staticmethod
    def _extract_default_image(raw: dict[str, Any]) -> str | None:
        imgs = raw.get("images")
        if isinstance(imgs, list) and imgs and isinstance(imgs[0], dict):
            src = imgs[0].get("src")
            if isinstance(src, str) and src.strip():
                return src.strip()
        img = raw.get("image")
        if isinstance(img, dict) and isinstance(img.get("src"), str) and img["src"].strip():
            return img["src"].strip()
        return None

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
