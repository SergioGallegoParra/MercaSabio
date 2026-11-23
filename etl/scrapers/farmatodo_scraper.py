"""Conector Algolia público para Farmatodo Colombia (`products-colombia`)."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx

from etl.core.base_scraper import BaseScraper
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

FARMATODO_ALGOLIA_APP_ID = "VCOJEYD2PO"
FARMATODO_ALGOLIA_API_KEY = "eb9544fe7bfe7ec4c1aa5e5bf7740feb"
FARMATODO_ALGOLIA_INDEX = "products-colombia"

FARMATODO_GROCERY_SEARCH_TERMS: tuple[str, ...] = (
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
    "salsa de tomate",
    "cafe",
    "chocolate",
    "leche",
    "queso",
    "mantequilla",
    "margarina",
    "yogurt",
    "kumis",
    "pollo",
    "carne",
    "atun",
    "huevo",
    "detergente",
    "suavizante",
    "lavaloza",
    "limpiador",
    "cloro",
    "jabon",
    "crema dental",
    "papel higienico",
    "galletas",
    "agua",
)

DEFAULT_CATEGORY_SNAPSHOT_PATH = Path(__file__).resolve().parent / "data" / "other_stores_categories_snapshot.json"

FARMATODO_GROCERY_DEPARTMENTS: tuple[str, ...] = (
    "Alimentos y bebidas",
    "Hogar, Mascotas y Otros",
    "Cuidado Personal",
    "Bebé",
)


def default_farmatodo_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Farmatodo Colombia vía Algolia público."""
    base = ScraperConfig(
        store_id="farmatodo",
        base_url="https://www.farmatodo.com.co",
        channel_type="algolia_spa",
        source_origin="algolia_api",
        requests_per_second=3.0,
        max_concurrency=3,
    )
    return base.model_copy(update=overrides) if overrides else base


class FarmatodoScraper(BaseScraper):
    """Extractor de catálogo de mercado para Farmatodo Colombia usando su índice público Algolia."""

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        app_id: str = FARMATODO_ALGOLIA_APP_ID,
        api_key: str = FARMATODO_ALGOLIA_API_KEY,
        index_name: str = FARMATODO_ALGOLIA_INDEX,
        search_terms: list[str] | None = None,
        department_filters: list[str] | None = None,
        category_paths: list[list[str]] | None = None,
    ) -> None:
        super().__init__(config or default_farmatodo_config(), client=client)
        self.app_id = app_id
        self.api_key = api_key
        self.index_name = index_name
        self.search_terms = (
            list(search_terms)
            if search_terms is not None
            else list(FARMATODO_GROCERY_SEARCH_TERMS)
        )
        self.department_filters = (
            list(department_filters)
            if department_filters is not None
            else list(FARMATODO_GROCERY_DEPARTMENTS)
        )
        self._explicit_department_override = department_filters is not None
        self.category_paths = category_paths

    @staticmethod
    def _build_facet_filters_for_path(path: list[str]) -> list[str]:
        filters: list[str] = []
        if len(path) >= 1 and path[0]:
            filters.append(f"departments:{path[0]}")
        if len(path) >= 2 and path[1]:
            filters.append(f"categorie:{path[1]}")
        if len(path) >= 3 and path[2]:
            filters.append(f"subCategory:{path[2]}")
        return filters

    def _resolve_whitelisted_category_paths(self) -> list[list[str]]:
        raw_paths = self.category_paths
        if raw_paths is None and not self._explicit_department_override and DEFAULT_CATEGORY_SNAPSHOT_PATH.is_file():
            try:
                data = json.loads(DEFAULT_CATEGORY_SNAPSHOT_PATH.read_text(encoding="utf-8"))
                ft = data.get("farmatodo")
                if isinstance(ft, list):
                    raw_paths = [[str(x) for x in row] for row in ft if isinstance(row, list) and row]
            except (OSError, ValueError):
                raw_paths = None

        if not raw_paths:
            return []

        allowed: list[list[str]] = []
        unknown: list[str] = []
        for path in raw_paths:
            decision, _ = evaluate_category_path_whitelist(path)
            if decision == "ALLOW":
                allowed.append(path)
            elif decision == "UNKNOWN":
                unknown.append(" > ".join(path))

        if unknown:
            logger.info(
                "[%s] Lista blanca omitió %d rutas desconocidas pre-scraping (ej.: %s).",
                self.config.store_id,
                len(unknown),
                ", ".join(unknown[:6]),
            )
        return allowed

    @property
    def _algolia_url(self) -> str:
        return f"https://{self.app_id.lower()}-dsn.algolia.net/1/indexes/{self.index_name}/query"

    @property
    def _algolia_headers(self) -> dict[str, str]:
        return {
            "X-Algolia-Application-Id": self.app_id,
            "X-Algolia-API-Key": self.api_key,
        }

    async def _query_algolia(
        self,
        *,
        query: str = "",
        page: int = 0,
        hits_per_page: int = 100,
        facet_filters: list[str] | None = None,
    ) -> dict[str, Any]:
        params_dict: dict[str, Any] = {
            "query": query,
            "hitsPerPage": hits_per_page,
            "page": page,
        }
        if facet_filters:
            params_dict["facetFilters"] = json.dumps(facet_filters, ensure_ascii=False)

        response = await self.request(
            "POST",
            self._algolia_url,
            headers=self._algolia_headers,
            json_body={"params": urlencode(params_dict)},
        )
        data = response.json()
        return data if isinstance(data, dict) else {}

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Consulta rutas aprobadas por lista blanca contextual y términos esenciales en Farmatodo."""
        seen_skus: set[str] = set()

        whitelisted_paths = self._resolve_whitelisted_category_paths()
        if whitelisted_paths:
            if self.config.max_categories:
                whitelisted_paths = whitelisted_paths[: self.config.max_categories]
            for path in whitelisted_paths:
                facet_filters = self._build_facet_filters_for_path(path)
                page = 0
                while page < 5:
                    payload = await self._query_algolia(
                        query="",
                        page=page,
                        hits_per_page=100,
                        facet_filters=facet_filters,
                    )
                    hits = payload.get("hits") or []
                    if not isinstance(hits, list) or not hits:
                        break
                    batch: list[ScrapedProduct] = []
                    for hit in hits:
                        if not isinstance(hit, dict):
                            continue
                        model = self._parse_hit(hit)
                        if model and model.external_sku not in seen_skus:
                            seen_skus.add(model.external_sku)
                            batch.append(model)
                    if batch:
                        yield batch
                    nb_pages = int(payload.get("nbPages") or 0)
                    if page + 1 >= nb_pages or len(hits) < 100:
                        break
                    page += 1
        else:
            departments = [
                dept
                for dept in self.department_filters
                if evaluate_category_path_whitelist([dept])[0] == "ALLOW"
            ]
            if self.config.max_categories:
                departments = departments[: self.config.max_categories]

            for dept in departments:
                page = 0
                while page < 5:
                    payload = await self._query_algolia(
                        query="",
                        page=page,
                        hits_per_page=100,
                        facet_filters=[f"departments:{dept}"],
                    )
                    hits = payload.get("hits") or []
                    if not isinstance(hits, list) or not hits:
                        break
                    batch = []
                    for hit in hits:
                        if not isinstance(hit, dict):
                            continue
                        model = self._parse_hit(hit)
                        if model and model.external_sku not in seen_skus:
                            seen_skus.add(model.external_sku)
                            batch.append(model)
                    if batch:
                        yield batch
                    nb_pages = int(payload.get("nbPages") or 0)
                    if page + 1 >= nb_pages or len(hits) < 100:
                        break
                    page += 1

        for term in self.search_terms:
            payload = await self._query_algolia(query=term, page=0, hits_per_page=80)
            hits = payload.get("hits") or []
            batch = []
            for hit in hits:
                if not isinstance(hit, dict):
                    continue
                model = self._parse_hit(hit)
                if model and model.external_sku not in seen_skus:
                    seen_skus.add(model.external_sku)
                    batch.append(model)
            if batch:
                yield batch

    def _parse_hit(self, hit: dict[str, Any]) -> ScrapedProduct | None:
        req_rx = str(hit.get("requirePrescription") or "").strip().lower()
        if req_rx in {"true", "1", "si", "sí"}:
            return None

        sku = str(hit.get("id") or hit.get("objectID") or "").strip()
        raw_name = str(
            hit.get("mediaDescription") or hit.get("description") or hit.get("largeDescription") or ""
        ).strip()
        if not sku or not raw_name:
            return None

        list_price = self._to_decimal(hit.get("fullPrice"))
        offer_price = self._to_decimal(hit.get("offerPrice"))
        sale_price = offer_price if (offer_price is not None and offer_price > 0) else list_price
        if sale_price is None or sale_price <= 0:
            return None
        if list_price is None or list_price < sale_price:
            list_price = sale_price

        brand_raw = hit.get("marca")
        brand = str(brand_raw).strip() if isinstance(brand_raw, str) and brand_raw.strip() else None

        category_path = [
            str(seg).strip()
            for seg in [
                *(hit.get("departments") or []),
                hit.get("categorie"),
                hit.get("subCategory"),
            ]
            if isinstance(seg, str) and seg.strip()
        ]
        raw_slug = str(hit.get("url") or hit.get("urlCanonical") or "").strip()
        if raw_slug.startswith(("http://", "https://")):
            raw_url = raw_slug
        elif raw_slug:
            cleaned = raw_slug.lstrip("/")
            if not cleaned.startswith("producto/"):
                cleaned = f"producto/{cleaned}"
            raw_url = f"{self.config.base_url.rstrip('/')}/{cleaned}"
        else:
            raw_url = self.config.base_url

        if not is_mercado_product(
            self.config.store_id,
            raw_name,
            brand=brand,
            raw_url=raw_url,
            category_path=category_path,
        ):
            return None

        ean = normalize_ean(hit.get("barcode"))
        content = resolve_content(raw_name)
        normalized_name = normalize_product_name(raw_name)
        calibrated = apply_calibration(sale_price, self.config.markup_discount_factor)
        pum = compute_pum(calibrated, content.net_content)
        canonical_slug = infer_canonical_category_slug(
            normalized_name, content.net_content, content.unit_measure
        )

        in_stock = sale_price > 0 and not bool(hit.get("outofstore", False))
        img = hit.get("mediaImageUrl")
        image_url = str(img).strip() if isinstance(img, str) and img.strip().startswith("http") else None

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
                "image_url": image_url,
                "canonical_category_slug": canonical_slug,
                "is_private_label": is_store_private_label(self.config.store_id, brand, ean),
                "category_path": category_path,
            }
        )

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
