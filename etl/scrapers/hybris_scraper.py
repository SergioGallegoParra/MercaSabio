"""Conector SAP Commerce (Hybris) para Alkosto y Ktronix con rate limiting estricto."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlencode

import httpx

from etl.core.base_scraper import BaseScraper, ScraperHTTPError
from etl.core.calibrator import apply_calibration
from etl.core.canonical_mapper import infer_canonical_category_slug
from etl.core.models import ScrapedProduct, ScraperConfig
from etl.core.normalizer import (
    compute_pum,
    normalize_ean,
    normalize_product_name,
    resolve_content,
)

logger = logging.getLogger(__name__)

HYBRIS_PAGE_SIZE = 48
ALGOLIA_HITS_PER_PAGE = 100
ALGOLIA_MAX_BUCKET_HITS = 950
_ALGOLIA_APP_ID_RE = re.compile(r"applicationId\s*:\s*['\"]([^'\"]+)['\"]")
_ALGOLIA_API_KEY_RE = re.compile(r"apiKey\s*:\s*['\"]([^'\"]+)['\"]")
_ALGOLIA_INDEX_RE = re.compile(r"indexName\s*:\s*['\"]([^'\"]+)['\"]")

HYBRIS_STORE_CONFIGS: dict[str, tuple[ScraperConfig, str]] = {
    "alkosto": (
        ScraperConfig(
            store_id="alkosto",
            base_url="https://www.alkosto.com",
            channel_type="sap_hybris",
            source_origin="hybris_api",
            requests_per_second=1.0,
            max_concurrency=1,
            max_retries=4,
            backoff_base_seconds=2.0,
            rotate_user_agent=True,
            default_headers={
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "Referer": "https://www.alkosto.com/",
            },
        ),
        "alkosto",
    ),
    "ktronix": (
        ScraperConfig(
            store_id="ktronix",
            base_url="https://www.ktronix.com",
            channel_type="sap_hybris",
            source_origin="hybris_api",
            requests_per_second=1.0,
            max_concurrency=1,
            max_retries=4,
            backoff_base_seconds=2.0,
            rotate_user_agent=True,
            default_headers={
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "Referer": "https://www.ktronix.com/",
            },
        ),
        "ktronix",
    ),
}


class HybrisScraper(BaseScraper):
    """Extractor para endpoints OCC de SAP Commerce (Alkosto y Ktronix)."""

    def __init__(
        self,
        config: ScraperConfig,
        *,
        site_id: str | None = None,
        search_endpoint: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(config, client=client)
        self.site_id = site_id or config.store_id
        self.search_endpoint = search_endpoint or f"/occ/v2/{self.site_id}/products/search"

    @classmethod
    def for_store(
        cls,
        store_id: str,
        *,
        client: httpx.AsyncClient | None = None,
        **overrides: Any,
    ) -> HybrisScraper:
        key = store_id.strip().lower()
        if key not in HYBRIS_STORE_CONFIGS:
            supported = ", ".join(sorted(HYBRIS_STORE_CONFIGS))
            raise ValueError(f"Tienda Hybris no soportada: {store_id!r}. Disponibles: {supported}")
        base_config, site_id = HYBRIS_STORE_CONFIGS[key]
        cfg = base_config.model_copy(update=overrides) if overrides else base_config
        return cls(cfg, site_id=site_id, client=client)

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Itera OCC v2 y hace fallback automático al buscador público de Algolia si OCC devuelve 404/410."""
        seen_skus: set[str] = set()
        yielded_any = False

        try:
            async for batch in self._iter_occ_batches(seen_skus):
                yielded_any = True
                yield batch
            return
        except ScraperHTTPError as exc:
            if yielded_any or exc.status_code not in {404, 410}:
                raise
            logger.warning(
                "[%s] Endpoint OCC %s no disponible (HTTP %d); cambiando a índice público Algolia.",
                self.config.store_id,
                self.search_endpoint,
                exc.status_code,
            )

        async for batch in self._iter_algolia_batches(seen_skus):
            yield batch

    async def _iter_occ_batches(self, seen_skus: set[str]) -> AsyncIterator[list[ScrapedProduct]]:
        """Pagina el endpoint clásico OCC v2 de SAP Commerce."""
        queries = self._resolve_queries()

        for query_term in queries:
            page = 0
            while True:
                params: dict[str, Any] = {
                    "query": query_term,
                    "currentPage": page,
                    "pageSize": HYBRIS_PAGE_SIZE,
                    "fields": "FULL",
                }
                payload = await self.get_json(self.search_endpoint, params=params)
                if not isinstance(payload, dict):
                    break

                products = payload.get("products") or []
                if not isinstance(products, list) or not products:
                    break

                batch: list[ScrapedProduct] = []
                for raw_product in products:
                    if not isinstance(raw_product, dict):
                        continue
                    model = self._parse_hybris_product(raw_product)
                    if model and model.external_sku not in seen_skus:
                        seen_skus.add(model.external_sku)
                        batch.append(model)

                if batch:
                    yield batch

                pagination = payload.get("pagination") or {}
                total_pages = pagination.get("totalPages")
                if total_pages is not None:
                    if page + 1 >= int(total_pages):
                        break
                elif len(products) < HYBRIS_PAGE_SIZE:
                    break
                page += 1

    async def _fetch_algolia_credentials(self) -> tuple[str, str, str] | None:
        """Extrae `applicationId`, `apiKey` e `indexName` públicos desde la página `/search`."""
        response = await self.request("GET", "/search", params={"text": "a"})
        html = response.text
        m_app = _ALGOLIA_APP_ID_RE.search(html)
        m_key = _ALGOLIA_API_KEY_RE.search(html)
        m_idx = _ALGOLIA_INDEX_RE.search(html)
        if not (m_app and m_key and m_idx):
            logger.warning("[%s] No se encontró configuración pública de Algolia en /search.", self.config.store_id)
            return None
        return m_app.group(1), m_key.group(1), m_idx.group(1)

    async def _query_algolia(
        self,
        algolia_url: str,
        algolia_headers: dict[str, str],
        *,
        page: int = 0,
        hits_per_page: int = ALGOLIA_HITS_PER_PAGE,
        facets: list[str] | None = None,
        facet_filters: list[list[str]] | None = None,
        max_values_per_facet: int | None = None,
    ) -> dict[str, Any]:
        query_params: dict[str, Any] = {
            "query": "",
            "hitsPerPage": hits_per_page,
            "page": page,
        }
        if facets is not None:
            query_params["facets"] = json.dumps(facets, ensure_ascii=False)
        if facet_filters is not None:
            query_params["facetFilters"] = json.dumps(facet_filters, ensure_ascii=False)
        if max_values_per_facet is not None:
            query_params["maxValuesPerFacet"] = max_values_per_facet

        response = await self.request(
            "POST",
            algolia_url,
            headers=algolia_headers,
            json_body={"params": urlencode(query_params)},
        )
        data = response.json()
        return data if isinstance(data, dict) else {}

    async def _collect_algolia_facet_buckets(
        self,
        algolia_url: str,
        algolia_headers: dict[str, str],
    ) -> list[list[list[str]] | None]:
        """Divide el catálogo en cubetas <= 950 hits usando `hierarchicalcategory_string_mv`."""
        root_res = await self._query_algolia(
            algolia_url,
            algolia_headers,
            hits_per_page=1,
            facets=["hierarchicalcategory_string_mv.lvl0"],
            max_values_per_facet=100,
        )
        lvl0_facets = (root_res.get("facets") or {}).get("hierarchicalcategory_string_mv.lvl0") or {}
        if not lvl0_facets:
            return [None]

        buckets: list[list[list[str]] | None] = []
        for cat_name, count in lvl0_facets.items():
            lvl0_filter = [[f"hierarchicalcategory_string_mv.lvl0:{cat_name}"]]
            if int(count) <= ALGOLIA_MAX_BUCKET_HITS:
                buckets.append(lvl0_filter)
                continue

            sub_res = await self._query_algolia(
                algolia_url,
                algolia_headers,
                hits_per_page=1,
                facets=["hierarchicalcategory_string_mv.lvl1"],
                facet_filters=lvl0_filter,
                max_values_per_facet=200,
            )
            lvl1_facets = (sub_res.get("facets") or {}).get("hierarchicalcategory_string_mv.lvl1") or {}
            if lvl1_facets:
                for sub_name in lvl1_facets:
                    buckets.append([[f"hierarchicalcategory_string_mv.lvl1:{sub_name}"]])
            else:
                buckets.append(lvl0_filter)

        if self.config.max_categories:
            return buckets[: self.config.max_categories]
        return buckets

    async def _iter_algolia_batches(self, seen_skus: set[str]) -> AsyncIterator[list[ScrapedProduct]]:
        """Pagina el índice público Algolia de Alkosto/Ktronix por facetas jerárquicas."""
        creds = await self._fetch_algolia_credentials()
        if creds is None:
            return
        app_id, api_key, index_name = creds
        algolia_url = f"https://{app_id.lower()}-dsn.algolia.net/1/indexes/{index_name}/query"
        algolia_headers = {
            "X-Algolia-Application-Id": app_id,
            "X-Algolia-API-Key": api_key,
            "Sec-Fetch-Site": "cross-site",
        }

        buckets = await self._collect_algolia_facet_buckets(algolia_url, algolia_headers)
        for facet_filter in buckets:
            page = 0
            while True:
                payload = await self._query_algolia(
                    algolia_url,
                    algolia_headers,
                    page=page,
                    hits_per_page=ALGOLIA_HITS_PER_PAGE,
                    facet_filters=facet_filter,
                )
                hits = payload.get("hits") or []
                if not isinstance(hits, list) or not hits:
                    break

                batch: list[ScrapedProduct] = []
                for hit in hits:
                    if not isinstance(hit, dict):
                        continue
                    model = self._parse_algolia_hit(hit)
                    if model and model.external_sku not in seen_skus:
                        seen_skus.add(model.external_sku)
                        batch.append(model)

                if batch:
                    yield batch

                nb_pages = int(payload.get("nbPages") or 0)
                if page + 1 >= nb_pages or len(hits) < ALGOLIA_HITS_PER_PAGE:
                    break
                page += 1

    def _resolve_queries(self) -> list[str]:
        if self.config.category_filters:
            filters = list(self.config.category_filters)
            if self.config.max_categories:
                return filters[: self.config.max_categories]
            return filters
        return [":relevance"]

    def _resolve_absolute_url(self, raw_path: Any) -> str | None:
        if not isinstance(raw_path, str) or not raw_path.strip():
            return None
        cleaned = raw_path.strip()
        if cleaned.startswith(("http://", "https://")):
            return cleaned
        return f"{self.config.base_url.rstrip('/')}/{cleaned.lstrip('/')}"

    def _build_scraped_product(
        self,
        *,
        code: str,
        raw_name: str,
        sale_price: Decimal,
        list_price: Decimal,
        in_stock: bool,
        brand_raw: Any,
        ean_raw: Any,
        raw_url: str | None,
        image_url: str | None,
        categories: list[str],
        source_origin: str | None = None,
    ) -> ScrapedProduct | None:
        content = resolve_content(raw_name)
        calibrated = apply_calibration(sale_price, self.config.markup_discount_factor)
        pum = compute_pum(calibrated, content.net_content)
        normalized_name = normalize_product_name(raw_name)

        return self.validate_product(
            {
                "store_id": self.config.store_id,
                "external_sku": code,
                "ean": normalize_ean(ean_raw),
                "raw_name": raw_name,
                "normalized_name": normalized_name,
                "brand": brand_raw,
                "raw_list_price": max(list_price, sale_price),
                "raw_sale_price": sale_price,
                "calibrated_price": calibrated,
                "net_content": content.net_content,
                "unit_measure": content.unit_measure,
                "pum_price": pum,
                "in_stock": in_stock,
                "source_origin": source_origin or self.config.source_origin,
                "raw_url": raw_url,
                "image_url": image_url,
                "canonical_category_slug": infer_canonical_category_slug(
                    normalized_name, content.net_content, content.unit_measure
                ),
                "is_private_label": False,
                "category_path": categories,
            }
        )

    def _parse_hybris_product(self, raw: dict[str, Any]) -> ScrapedProduct | None:
        code = str(raw.get("code") or raw.get("sku") or "").strip()
        raw_name = str(raw.get("name") or "").strip()
        if not code or not raw_name:
            return None

        sale_price = self._extract_price_value(raw.get("price"))
        if sale_price is None:
            return None

        list_price = (
            self._extract_price_value(raw.get("wasPrice"))
            or self._extract_price_value(raw.get("listPrice"))
            or sale_price
        )
        stock_info = raw.get("stock") or {}
        stock_status = str(stock_info.get("stockLevelStatus") or "").lower()
        in_stock = sale_price > 0 and stock_status != "outofstock"

        brand_raw = raw.get("manufacturer") or (
            raw.get("brand", {}).get("name") if isinstance(raw.get("brand"), dict) else raw.get("brand")
        )
        images = raw.get("images") or []
        img_path = images[0].get("url") if isinstance(images, list) and images and isinstance(images[0], dict) else None
        categories = [
            str(cat.get("name")).strip()
            for cat in (raw.get("categories") or [])
            if isinstance(cat, dict) and cat.get("name")
        ]

        return self._build_scraped_product(
            code=code,
            raw_name=raw_name,
            sale_price=sale_price,
            list_price=list_price,
            in_stock=in_stock,
            brand_raw=brand_raw,
            ean_raw=raw.get("ean") or raw.get("gtin"),
            raw_url=self._resolve_absolute_url(raw.get("url")),
            image_url=self._resolve_absolute_url(img_path),
            categories=categories,
        )

    def _parse_algolia_hit(self, hit: dict[str, Any]) -> ScrapedProduct | None:
        code = str(hit.get("code_string") or hit.get("objectID") or "").strip()
        raw_name = str(hit.get("name_text_es") or "").strip()
        if not code or not raw_name:
            return None

        list_price = self._extract_price_value(hit.get("pricevalue_cop_double"))
        discount_price = self._extract_price_value(hit.get("discountprice_double"))
        sale_price = discount_price if (discount_price is not None and discount_price > 0) else list_price
        if sale_price is None:
            return None
        if list_price is None or list_price < sale_price:
            list_price = sale_price

        stock_status = str(hit.get("stocklevelstatus_string") or "").lower()
        in_stock = (
            sale_price > 0
            and bool(hit.get("instockflag_boolean", True))
            and stock_status != "outofstock"
        )
        brand_list = hit.get("brand_string_mv")
        brand_raw = hit.get("marca_text") or (
            brand_list[0] if isinstance(brand_list, list) and brand_list else None
        )
        img_path = (
            hit.get("img-820wx820h_string")
            or hit.get("img-310wx310h_string")
            or hit.get("img-750wx750h_string")
        )
        categories = [
            str(cat).strip()
            for cat in (hit.get("categoryname_text_es_mv") or [])
            if str(cat).strip()
        ]

        return self._build_scraped_product(
            code=code,
            raw_name=raw_name,
            sale_price=sale_price,
            list_price=list_price,
            in_stock=in_stock,
            brand_raw=brand_raw,
            ean_raw=hit.get("ean") or hit.get("gtin") or code,
            raw_url=self._resolve_absolute_url(hit.get("url_es_string")),
            image_url=self._resolve_absolute_url(img_path),
            categories=categories,
            source_origin="algolia_api",
        )

    @staticmethod
    def _extract_price_value(price_obj: Any) -> Decimal | None:
        if price_obj is None:
            return None
        raw_val = price_obj.get("value") if isinstance(price_obj, dict) else price_obj
        if raw_val is None:
            return None
        try:
            dec = Decimal(str(raw_val))
        except (InvalidOperation, ValueError):
            return None
        if dec < 0:
            return None
        return dec.quantize(Decimal("0.01"))
