"""Base compartida Next.js Flight RSC para storefronts Instaleap Colombia."""

from __future__ import annotations

import json
import logging
import re
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

_NEXT_F_CHUNK_RE = re.compile(r'self\.__next_f\.push\(\[\d+,"((?:\\.|[^"\\])*)"\]\)')
_RSC_LINE_JSON_RE = re.compile(r'(?:^|\n)([0-9a-fA-F]+):([\[{][^\n]*)')
_RSC_INLINE_PRODUCT_RE = re.compile(
    r'\{"name":"((?:\\.|[^"\\])+)","price":([0-9.]+),.*?"sku":"([^"]+)".*?"slug":"([^"]*)","brand":"([^"]*)"'
)
_CATEGORY_LEAF_FALLBACK_RE = re.compile(
    r'"hasChildren":(true|false),"categoryNamesPath":("[^"]+"|null),"isAvailableInHome":(?:true|false),'
    r'"level":(\d+|null),"name":"((?:\\.|[^"\\])+)","path":"[^"]*","reference":"[^"]*","slug":"([^"]+)"'
)

_SUBUNIT_MAP: dict[str, str] = {
    "G": "g",
    "GR": "g",
    "KG": "kg",
    "ML": "ml",
    "L": "l",
    "LT": "l",
}


def _resolve_rsc_refs(value: Any, refs: dict[str, Any], *, depth: int = 0) -> Any:
    if depth > 4:
        return value
    if isinstance(value, str) and value.startswith("$") and value in refs:
        return _resolve_rsc_refs(refs[value], refs, depth=depth + 1)
    if isinstance(value, list):
        return [_resolve_rsc_refs(item, refs, depth=depth + 1) for item in value]
    if isinstance(value, dict):
        return {k: _resolve_rsc_refs(v, refs, depth=depth + 1) for k, v in value.items()}
    return value


def _walk_product_dicts(node: Any, out: list[dict[str, Any]]) -> None:
    if isinstance(node, dict):
        if "sku" in node and "price" in node and "name" in node:
            out.append(node)
            return
        for val in node.values():
            _walk_product_dicts(val, out)
    elif isinstance(node, list):
        for item in node:
            _walk_product_dicts(item, out)


def _walk_category_nodes(
    nodes: list[dict[str, Any]],
    *,
    prefix: list[str] | None = None,
    out: list[tuple[str, list[str]]] | None = None,
) -> list[tuple[str, list[str]]]:
    """Extrae pares `(slug, path_segments)` de los nodos hoja del árbol Instaleap."""
    acc = out if out is not None else []
    base = list(prefix or [])
    for node in nodes:
        if not isinstance(node, dict):
            continue
        name = str(node.get("name") or "").strip()
        raw_path_names = str(node.get("categoryNamesPath") or "").strip()
        if raw_path_names:
            segments = [seg.strip() for seg in raw_path_names.split("/") if seg.strip()]
        else:
            segments = [*base, name] if name else list(base)

        children = node.get("subCategories") or node.get("children") or []
        if isinstance(children, list) and children:
            _walk_category_nodes(children, prefix=segments, out=acc)
            continue

        slug = str(node.get("slug") or "").strip().lstrip("/")
        if slug:
            acc.append((slug, segments))
    return acc


def _extract_balanced_json_array(text: str, start_idx: int) -> list[Any] | None:
    if start_idx < 0 or start_idx >= len(text) or text[start_idx] != "[":
        return None
    depth = 0
    in_string = False
    escaped = False
    for idx in range(start_idx, len(text)):
        ch = text[idx]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                try:
                    parsed = json.loads(text[start_idx : idx + 1])
                    return parsed if isinstance(parsed, list) else None
                except Exception:
                    return None
    return None


class InstaleapRscScraper(BaseScraper):
    """Extractor Next.js Flight RSC paginable para comercios Instaleap."""

    _PAGE_SIZE = 50
    _MAX_PAGES_PER_CATEGORY = 30

    def __init__(
        self,
        config: ScraperConfig,
        *,
        client: httpx.AsyncClient | None = None,
        category_paths: list[str] | None = None,
        search_terms: list[str] | None = None,
        auto_discover_categories: bool = False,
        paginate_categories: bool = False,
    ) -> None:
        super().__init__(config, client=client)
        self.category_paths = list(category_paths or [])
        self.search_terms = list(search_terms or [])
        self.auto_discover_categories = auto_discover_categories
        self.paginate_categories = paginate_categories

    @staticmethod
    def _decode_rsc_stream(html: str) -> str:
        parts: list[str] = []
        for raw_chunk in _NEXT_F_CHUNK_RE.findall(html):
            try:
                parts.append(json.loads(f'"{raw_chunk}"'))
            except Exception:
                parts.append(raw_chunk.replace('\\"', '"').replace("\\n", "\n"))
        return "".join(parts)

    @classmethod
    def extract_category_entries_from_html(cls, html: str) -> list[tuple[str, list[str]]]:
        """Descubre rutas `/ca/<slug>` y segmentos desde el `categoryTree` embebido en RSC."""
        stream = cls._decode_rsc_stream(html)
        marker = '"categoryTree":['
        pos = stream.find(marker)
        if pos != -1:
            arr_start = stream.find("[", pos)
            tree = _extract_balanced_json_array(stream, arr_start)
            if tree:
                leaves = _walk_category_nodes(tree)
                if leaves:
                    return leaves

        # Fallback por patrón plano si `categoryTree` vino fragmentado entre referencias
        seen: dict[str, list[str]] = {}
        for match in _CATEGORY_LEAF_FALLBACK_RE.finditer(stream):
            has_children = match.group(1) == "true"
            if has_children:
                continue
            raw_cpath = match.group(2)
            name = match.group(4).strip()
            slug = match.group(5).strip().lstrip("/")
            if not slug or slug in seen:
                continue
            if raw_cpath != "null":
                segs = [seg.strip() for seg in raw_cpath.strip('"').split("/") if seg.strip()]
            else:
                segs = [name] if name else []
            seen[slug] = segs
        return list(seen.items())

    @classmethod
    def extract_raw_products_from_html(cls, html: str) -> list[dict[str, Any]]:
        """Reconstruye objetos de producto desde Next.js Flight RSC (incluyendo nodos anidados)."""
        stream = cls._decode_rsc_stream(html)
        refs: dict[str, Any] = {}
        products: list[dict[str, Any]] = []
        seen_ids: set[int] = set()

        for match in _RSC_LINE_JSON_RE.finditer(stream):
            ref_id = "$" + match.group(1)
            raw_json = match.group(2).strip()
            try:
                parsed = json.loads(raw_json)
            except Exception:
                continue
            refs[ref_id] = parsed
            found: list[dict[str, Any]] = []
            _walk_product_dicts(parsed, found)
            for item in found:
                obj_id = id(item)
                if obj_id not in seen_ids:
                    seen_ids.add(obj_id)
                    products.append(item)

        if not products:
            for match in _RSC_INLINE_PRODUCT_RE.finditer(stream):
                products.append(
                    {
                        "name": match.group(1),
                        "price": float(match.group(2)),
                        "sku": match.group(3),
                        "slug": match.group(4),
                        "brand": match.group(5),
                    }
                )

        resolved: list[dict[str, Any]] = []
        for item in products:
            copy = dict(item)
            for ref_field in ("photosUrl", "ean", "promotion", "promotions", "categoriesData"):
                if ref_field in copy:
                    copy[ref_field] = _resolve_rsc_refs(copy[ref_field], refs)
            resolved.append(copy)
        return resolved

    async def discover_allowed_categories(self) -> list[tuple[str, list[str]]]:
        """Obtiene subcategorías `/ca/<slug>` filtradas pre-scraping por lista blanca contextual."""
        entries: list[tuple[str, list[str]]] = []
        if self.auto_discover_categories:
            try:
                home_resp = await self.request("GET", "/")
                entries = self.extract_category_entries_from_html(home_resp.text)
            except ScraperHTTPError as exc:
                logger.warning("[%s] Error consultando árbol de categorías: %s", self.config.store_id, exc)

        if not entries and self.category_paths:
            return [(path, self._segments_from_path(path)) for path in self.category_paths]

        allowed: list[tuple[str, list[str]]] = []
        unknown_previews: list[str] = []
        seen_paths: set[str] = set()

        for slug, segments in entries:
            path = slug if slug.startswith("/ca/") else f"/ca/{slug.lstrip('/')}"
            if path in seen_paths:
                continue
            seen_paths.add(path)

            decision, _reason = evaluate_category_path_whitelist(segments)
            if decision == "DENY":
                continue
            if decision == "UNKNOWN":
                if segments:
                    unknown_previews.append(" > ".join(segments))
                continue
            allowed.append((path, segments))

        if unknown_previews:
            logger.info(
                "[%s] Lista blanca omitió %d categorías desconocidas pre-scraping (ej.: %s).",
                self.config.store_id,
                len(unknown_previews),
                ", ".join(unknown_previews[:8]),
            )
        return allowed

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Consulta categorías (paginadas si aplica) y búsquedas emitiendo lotes validados."""
        seen_skus: set[str] = set()
        targets: list[tuple[str, list[str] | None, dict[str, Any] | None, bool]] = []

        if self.auto_discover_categories:
            for path, segments in await self.discover_allowed_categories():
                targets.append((path, segments, None, True))
        else:
            for path in self.category_paths:
                targets.append((path, self._segments_from_path(path), None, False))

        for term in self.search_terms:
            targets.append(("/search", None, {"name": term}, False))

        if self.config.max_categories:
            targets = targets[: self.config.max_categories]

        for path, fallback_segments, params, can_paginate in targets:
            use_pagination = can_paginate or self.paginate_categories
            max_pages = self._MAX_PAGES_PER_CATEGORY if use_pagination and params is None else 1
            cat_seen: set[str] = set()

            for page in range(1, max_pages + 1):
                req_params = dict(params or {})
                if use_pagination and page > 1:
                    req_params["currentPage"] = page
                try:
                    response = await self.request("GET", path, params=req_params or None)
                except ScraperHTTPError as exc:
                    logger.warning("[%s] Error consultando %s (p=%d): %s", self.config.store_id, path, page, exc)
                    break

                raw_items = self.extract_raw_products_from_html(response.text)
                if not raw_items:
                    break

                page_skus: set[str] = set()
                batch: list[ScrapedProduct] = []
                for raw in raw_items:
                    sku_val = str(raw.get("sku") or "").strip()
                    if sku_val:
                        page_skus.add(sku_val)
                    model = self._parse_instaleap_item(raw, fallback_category_path=fallback_segments)
                    if model and model.external_sku not in seen_skus:
                        seen_skus.add(model.external_sku)
                        batch.append(model)

                if batch:
                    yield batch

                # Detener si la página ya no trajo SKUs nuevos para esta categoría o es la última página
                if not page_skus or page_skus.issubset(cat_seen) or len(raw_items) < self._PAGE_SIZE:
                    break
                cat_seen.update(page_skus)

    def _parse_instaleap_item(
        self,
        raw: dict[str, Any],
        *,
        fallback_category_path: list[str] | None = None,
    ) -> ScrapedProduct | None:
        sku = str(raw.get("sku") or "").strip()
        raw_name = str(raw.get("name") or "").strip()
        if not sku or not raw_name:
            return None

        base_price = self._to_decimal(raw.get("price"))
        if base_price is None or base_price <= 0:
            return None

        sale_price = base_price
        list_price = self._to_decimal(raw.get("previousPrice")) or base_price
        promo_price = self._extract_promo_price(raw.get("promotion"))
        if promo_price is not None and promo_price < sale_price:
            list_price = max(list_price, sale_price)
            sale_price = promo_price
        elif list_price < sale_price:
            list_price = sale_price

        brand_raw = raw.get("brand")
        brand = str(brand_raw).strip() if isinstance(brand_raw, str) and brand_raw.strip() else None

        slug = str(raw.get("slug") or "").strip()
        raw_url = (
            f"{self.config.base_url.rstrip('/')}/p/{slug.lstrip('/')}"
            if slug
            else self.config.base_url
        )

        category_path = self._extract_category_path(raw) or list(fallback_category_path or [])
        if not is_mercado_product(
            self.config.store_id,
            raw_name,
            brand=brand,
            raw_url=raw_url,
            category_path=category_path or None,
        ):
            return None

        ean_candidate: Any = raw.get("ean")
        if isinstance(ean_candidate, list):
            ean_candidate = ean_candidate[0] if ean_candidate else None
        elif isinstance(ean_candidate, str) and ean_candidate.startswith("$"):
            ean_candidate = None
        ean = normalize_ean(ean_candidate)

        photos = raw.get("photosUrl")
        image_url = (
            str(photos[0]).strip()
            if isinstance(photos, list) and photos and isinstance(photos[0], str)
            else None
        )

        sub_unit = raw.get("subUnit")
        sub_qty = raw.get("subQty")
        unit_key = str(sub_unit).strip().upper() if isinstance(sub_unit, str) else ""
        meas_unit = _SUBUNIT_MAP.get(unit_key)
        unit_mult = float(sub_qty) if isinstance(sub_qty, (int, float)) and sub_qty > 0 and meas_unit else 1.0

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
        in_stock = bool(raw.get("isAvailable", True)) and int(raw.get("stock", 1) or 0) > 0

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

    @classmethod
    def _extract_promo_price(cls, promo: Any) -> Decimal | None:
        if not isinstance(promo, dict) or not promo.get("isActive"):
            return None
        conditions = promo.get("conditions")
        if not isinstance(conditions, list) or not conditions:
            return None
        first = conditions[0]
        if not isinstance(first, dict):
            return None
        dec = cls._to_decimal(first.get("price"))
        return dec if dec is not None and dec > 0 else None

    @staticmethod
    def _extract_category_path(raw: dict[str, Any]) -> list[str]:
        cat_data = raw.get("categoriesData")
        if isinstance(cat_data, list):
            for entry in cat_data:
                if not isinstance(entry, dict):
                    continue
                cpath = str(entry.get("categoryNamesPath") or "").strip()
                if cpath:
                    segs = [seg.strip() for seg in cpath.split("/") if seg.strip()]
                    if segs:
                        return segs
        cats = raw.get("categories")
        if isinstance(cats, list):
            for entry in cats:
                if isinstance(entry, dict) and isinstance(entry.get("name"), str) and entry["name"].strip():
                    return [entry["name"].strip()]
        return []

    @staticmethod
    def _segments_from_path(path: str) -> list[str]:
        clean = path.strip().strip("/")
        if clean.startswith("ca/"):
            clean = clean[3:]
        parts = [p for p in clean.split("/") if p and not p.isdigit() and not re.match(r"^[A-Z]+_\d+$", p)]
        return [p.replace("-", " ").strip() for p in parts if p.strip()]

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
