"""Conector real para Tiendas Ísimo desde el storefront de Rappi (`900468086-isimo-mt-nc`).

Reglas de negocio implementadas:
1. Precio estándar: si un producto tiene descuento en Rappi (`real_price` tachado > `price`),
   se sube el precio estándar sin descuento (`real_price`) como precio oficial de Ísimo.
2. Descuentos reales de Rappi: compara el precio promocional de Rappi (`price`) contra
   el precio estándar y contra el histórico en `price_records`; solo si hay ahorro real
   persiste `rappi_promo_price`, `rappi_savings_cop` y `rappi_savings_pct` en `store_skus`.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import unicodedata
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import httpx

from etl.core.base_scraper import BaseScraper
from etl.core.calibrator import apply_calibration
from etl.core.canonical_mapper import is_store_private_label
from etl.core.grocery_filter import is_mercado_product
from etl.core.models import ScrapedProduct, ScraperConfig, UnitMeasure
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

logger = logging.getLogger(__name__)

ISIMO_RAPPI_STORE_SLUG = "900468086-isimo-mt-nc"
ISIMO_RAPPI_BASE_URL = "https://www.rappi.com.co"
ISIMO_RAPPI_CATALOG_URL = f"{ISIMO_RAPPI_BASE_URL}/tiendas/{ISIMO_RAPPI_STORE_SLUG}/catalogo"
ISIMO_SOURCE_ORIGIN = "rappi_isimo"

DEFAULT_ISIMO_DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_ISIMO_SSR_SNAPSHOT = DEFAULT_ISIMO_DATA_DIR / "isimo_rappi_ssr.json"
DEFAULT_ISIMO_BROWSER_SNAPSHOT = DEFAULT_ISIMO_DATA_DIR / "isimo_rappi_browser.json"

_NEXT_DATA_RE = re.compile(
    r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>',
    re.DOTALL,
)
_PUM_PARENS_RE = re.compile(
    r"\(\s*\$\s*[\d.,]+\s*/\s*(g|gr|ml|und|u|combo|kg|l)\s*\)",
    re.IGNORECASE,
)
_COP_TOKEN_RE = re.compile(r"\$\s*([\d.]+)")


@dataclass(frozen=True, slots=True)
class RappiPromoObservation:
    """Descuento observado en Rappi para comparar contra precio estándar/histórico."""

    external_sku: str
    standard_price: Decimal
    promo_price: Decimal
    promo_url: str


def _slugify(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_text = "".join(ch for ch in nfkd if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text).strip("-")


def _to_decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        dec = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None
    if not dec.is_finite() or dec <= 0:
        return None
    return dec.quantize(Decimal("0.01"))


def _parse_cop_digits(digits: str) -> Decimal | None:
    cleaned = digits.replace(".", "").replace(",", "").strip()
    return _to_decimal(cleaned)


def parse_rappi_dom_item(
    raw_text: str,
    *,
    item_id: str | None = None,
    image_url: str | None = None,
    section: str | None = None,
    href: str | None = None,
) -> tuple[dict[str, Any], Decimal | None] | None:
    """Convierte texto de tarjeta DOM de Rappi en dict estructurado + precio promo opcional."""
    normalized_raw = " ".join(raw_text.replace("|", " ").split())
    if not normalized_raw or len(normalized_raw) > 260:
        return None

    pum_match = _PUM_PARENS_RE.search(normalized_raw)
    if not pum_match:
        return None

    before_pum = normalized_raw[: pum_match.start()].strip()
    title_part = normalized_raw[pum_match.end() :].strip(" -|")
    if len(title_part) < 3 or not any(ch.isalpha() for ch in title_part):
        return None

    prices = [
        val
        for token in _COP_TOKEN_RE.findall(before_pum)
        if (val := _parse_cop_digits(token)) is not None
    ]
    if not prices:
        return None

    promo_price: Decimal | None = None
    if len(prices) >= 2 and prices[1] > prices[0]:
        promo_price = prices[0]
        standard_price = prices[1]
    else:
        standard_price = prices[0]

    pum_unit = pum_match.group(1).lower()
    is_combo = pum_unit == "combo" or (section or "") == "combos" or title_part.lower().startswith("combo ")

    master_id: str | None = None
    if item_id and str(item_id).strip().isdigit():
        master_id = str(item_id).strip()
    elif href:
        m_href = re.search(r"-(\d+)$", href.strip())
        if m_href:
            master_id = m_href.group(1)

    return (
        {
            "master_product_id": master_id,
            "name": title_part,
            "description": title_part,
            "real_price": str(standard_price),
            "price": str(promo_price if promo_price is not None else standard_price),
            "image_url": image_url,
            "category_name": section.replace("-", " ").replace("/", " ") if section else "",
            "is_combo": is_combo,
            "pum_unit_hint": pum_unit,
            "raw_url": (f"{ISIMO_RAPPI_BASE_URL}{href}" if href and href.startswith("/") else href),
        },
        promo_price,
    )


def default_isimo_config(**overrides: Any) -> ScraperConfig:
    """Configuración por defecto para Tiendas Ísimo desde Rappi."""
    base = ScraperConfig(
        store_id="isimo",
        base_url=ISIMO_RAPPI_BASE_URL,
        channel_type="hard_discount",
        source_origin=ISIMO_SOURCE_ORIGIN,
        requests_per_second=1.2,
        max_concurrency=1,
        markup_discount_factor=Decimal("1.0000"),
        default_headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "es-CO,es;q=0.9",
        },
    )
    return base.model_copy(update=overrides) if overrides else base


class IsimoRappiScraper(BaseScraper):
    """Extractor oficial de Tiendas Ísimo combinando SSR Next.js y captura DOM paginada."""

    def __init__(
        self,
        config: ScraperConfig | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        ssr_snapshot_path: Path | None = DEFAULT_ISIMO_SSR_SNAPSHOT,
        browser_snapshot_path: Path | None = DEFAULT_ISIMO_BROWSER_SNAPSHOT,
        fetch_live_ssr: bool = True,
    ) -> None:
        super().__init__(config or default_isimo_config(), client=client)
        self.ssr_snapshot_path = ssr_snapshot_path
        self.browser_snapshot_path = browser_snapshot_path
        self.fetch_live_ssr = fetch_live_ssr
        self.rappi_promos_by_sku: dict[str, RappiPromoObservation] = {}

    def _build_client(self) -> httpx.AsyncClient:
        timeout = httpx.Timeout(max(self.config.timeout_seconds, 20.0), connect=10.0)
        limits = httpx.Limits(max_connections=4, max_keepalive_connections=2)
        return httpx.AsyncClient(
            base_url=self.config.base_url.rstrip("/"),
            transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0"),
            timeout=timeout,
            limits=limits,
            headers=self.config.default_headers,
            follow_redirects=True,
        )

    async def _fetch_fallback_json(self, path: str, expected_key: str) -> dict[str, Any]:
        for attempt in range(3):
            await self._rate_limiter.acquire()
            try:
                resp = await self.client.get(path)
            except httpx.HTTPError as exc:
                logger.debug("[isimo] Error de red en %s: %s", path, exc)
                await asyncio.sleep(0.8 * (attempt + 1))
                continue

            if resp.status_code != 200:
                logger.warning("[isimo] HTTP %s en %s", resp.status_code, path)
                if resp.status_code in {403, 429}:
                    break
                await asyncio.sleep(0.8 * (attempt + 1))
                continue
            if resp.history and str(resp.url.path).rstrip("/") != path.rstrip("/"):
                break

            match = _NEXT_DATA_RE.search(resp.text)
            if not match:
                continue
            try:
                payload = json.loads(match.group(1))
            except ValueError:
                continue
            fallback = (payload.get("props") or {}).get("pageProps", {}).get("fallback", {})
            if isinstance(fallback, dict) and expected_key in fallback:
                data = fallback[expected_key]
                return data if isinstance(data, dict) else {}
            await asyncio.sleep(0.6 * (attempt + 1))
        return {}

    async def _collect_live_ssr_items(self) -> list[dict[str, Any]]:
        prefix = f"/tiendas/{ISIMO_RAPPI_STORE_SLUG}"
        cat = await self._fetch_fallback_json(
            f"{prefix}/catalogo",
            f"storefront/{ISIMO_RAPPI_STORE_SLUG}/catalog",
        )
        aisles = ((cat.get("aisles_tree_response") or {}).get("data") or {}).get("components") or []
        if not aisles:
            return []

        by_id: dict[str, dict[str, Any]] = {}
        pending_subs: list[tuple[str, str]] = []

        for aisle in aisles:
            aslug = str((aisle.get("resource") or {}).get("friendly_url") or "").strip()
            if not aslug or aslug == "combos":
                continue
            fb = await self._fetch_fallback_json(
                f"{prefix}/{aslug}",
                f"storefront/{ISIMO_RAPPI_STORE_SLUG}/{aslug}",
            )
            sub_data = (fb.get("sub_aisles_response") or {}).get("data") or {}
            components = sub_data.get("components") or []
            for comp in components:
                for prod in ((comp.get("resource") or {}).get("products") or []):
                    pid = str(prod.get("product_id") or prod.get("id") or "").strip()
                    if pid:
                        by_id[pid] = prod

            headers_list = sub_data.get("headers") or []
            cats = (
                (headers_list[0].get("resource") or {}).get("categories") or []
                if headers_list
                else []
            )
            for idx, sub in enumerate(cats):
                sub_count = int(sub.get("product_count") or 0)
                comp_len = (
                    len(((components[idx].get("resource") or {}).get("products") or []))
                    if idx < len(components)
                    else 0
                )
                if idx >= 3 or comp_len < sub_count:
                    sslug = _slugify(str(sub.get("name") or ""))
                    if sslug:
                        pending_subs.append((aslug, sslug))

        for aslug, sslug in pending_subs:
            sfb = await self._fetch_fallback_json(
                f"{prefix}/{aslug}/{sslug}",
                f"storefront/{ISIMO_RAPPI_STORE_SLUG}/{aslug}/{sslug}",
            )
            adet = (sfb.get("aisle_detail_response") or {}).get("data") or {}
            for comp in adet.get("components") or []:
                for prod in ((comp.get("resource") or {}).get("products") or []):
                    pid = str(prod.get("product_id") or prod.get("id") or "").strip()
                    if pid:
                        by_id[pid] = prod

        return list(by_id.values())

    def _load_ssr_items_fallback(self) -> list[dict[str, Any]]:
        if self.ssr_snapshot_path and self.ssr_snapshot_path.is_file():
            raw = json.loads(self.ssr_snapshot_path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                return [item for item in raw if isinstance(item, dict)]
        return []

    def _load_browser_items(self) -> list[dict[str, Any]]:
        if self.browser_snapshot_path and self.browser_snapshot_path.is_file():
            raw = json.loads(self.browser_snapshot_path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                return [item for item in raw if isinstance(item, dict)]
        return []

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Emite lotes de productos Ísimo normalizados con precio estándar y registra promos Rappi."""
        ssr_items: list[dict[str, Any]] = []
        if self.fetch_live_ssr:
            ssr_items = await self._collect_live_ssr_items()
        if not ssr_items:
            ssr_items = self._load_ssr_items_fallback()

        browser_items = self._load_browser_items()
        logger.info(
            "[isimo] Fuentes recolectadas -> ssr=%d, browser_extra=%d",
            len(ssr_items),
            len(browser_items),
        )

        seen_skus: set[str] = set()
        seen_master_ids: set[str] = set()
        seen_signatures: set[tuple[str, str, str]] = set()
        batch: list[ScrapedProduct] = []

        # 1. Procesar primero JSON SSR (contiene description, trademark, category_name, real_price/price)
        for raw in ssr_items:
            model, promo_obs = self._parse_ssr_item(raw)
            if model is None or model.external_sku in seen_skus:
                continue
            seen_skus.add(model.external_sku)
            master_id = str(raw.get("master_product_id") or "").strip()
            if master_id:
                seen_master_ids.add(master_id)
            seen_signatures.add(
                (model.normalized_name, str(model.net_content), model.unit_measure.value)
            )
            if promo_obs is not None:
                self.rappi_promos_by_sku[model.external_sku] = promo_obs
            batch.append(model)

        # 2. Completar con capturas DOM paginadas (>24 ítems por pasillo y combos)
        for entry in browser_items:
            parsed_pair = parse_rappi_dom_item(
                str(entry.get("raw") or ""),
                item_id=str(entry.get("id") or "").strip() or None,
                image_url=str(entry.get("img") or "").strip() or None,
                section=str(entry.get("section") or "").strip() or None,
                href=str(entry.get("href") or "").strip() or None,
            )
            if parsed_pair is None:
                continue
            dom_dict, promo_price = parsed_pair
            master_id = str(dom_dict.get("master_product_id") or "").strip()
            if master_id and master_id in seen_master_ids:
                continue

            model, promo_obs = self._build_model_from_fields(
                dom_dict,
                explicit_promo_price=promo_price,
            )
            if model is None or model.external_sku in seen_skus:
                continue
            sig = (model.normalized_name, str(model.net_content), model.unit_measure.value)
            if sig in seen_signatures:
                continue

            seen_skus.add(model.external_sku)
            if master_id:
                seen_master_ids.add(master_id)
            seen_signatures.add(sig)
            if promo_obs is not None:
                self.rappi_promos_by_sku[model.external_sku] = promo_obs
            batch.append(model)

        if batch:
            yield batch

    def _parse_ssr_item(
        self,
        raw: dict[str, Any],
    ) -> tuple[ScrapedProduct | None, RappiPromoObservation | None]:
        if raw.get("discontinued") or raw.get("is_discontinued"):
            return None, None
        promo_candidate = _to_decimal(raw.get("price"))
        real_candidate = _to_decimal(raw.get("real_price"))
        promo_price = (
            promo_candidate
            if (promo_candidate is not None and real_candidate is not None and promo_candidate < real_candidate)
            else None
        )
        return self._build_model_from_fields(raw, explicit_promo_price=promo_price)

    def _build_model_from_fields(
        self,
        raw: dict[str, Any],
        *,
        explicit_promo_price: Decimal | None = None,
    ) -> tuple[ScrapedProduct | None, RappiPromoObservation | None]:
        raw_title = " ".join(str(raw.get("name") or "").split())
        raw_desc = " ".join(str(raw.get("description") or "").split())
        if not raw_title:
            return None, None

        sale_candidate = _to_decimal(raw.get("price"))
        real_candidate = _to_decimal(raw.get("real_price"))
        # Regla 1: Usar siempre el precio estándar sin descuento como precio oficial de Ísimo
        if real_candidate is not None and sale_candidate is not None:
            standard_price = max(real_candidate, sale_candidate)
        else:
            standard_price = real_candidate or sale_candidate
        if standard_price is None or standard_price <= 0:
            return None, None

        master_id = str(raw.get("master_product_id") or "").strip()
        product_id = str(raw.get("product_id") or "").strip()
        content_source = raw_desc if len(raw_desc) >= len(raw_title) else raw_title
        content = resolve_content(
            content_source,
            measurement_unit=raw.get("unit_type"),
            unit_multiplier=raw.get("quantity"),
        )
        if raw.get("is_combo") and content.unit_measure != UnitMeasure.UND and content.net_content == Decimal("1"):
            content = resolve_content("1 und")

        normalized_name = normalize_product_name(raw_title)
        if master_id:
            external_sku = f"isimo-{master_id}"
        elif product_id:
            external_sku = f"isimo-p-{product_id}"
        else:
            digest = hashlib.sha1(
                f"{normalized_name}:{content.net_content}:{content.unit_measure.value}".encode("utf-8")
            ).hexdigest()[:14]
            external_sku = f"isimo-dom-{digest}"

        brand_raw = str(raw.get("trademark") or raw.get("brand") or "").strip()
        brand = brand_raw[:100] if brand_raw else None
        ean = normalize_ean(raw.get("ean"))
        cat_name = str(raw.get("category_name") or raw.get("category") or "").strip()
        category_path = [cat_name] if cat_name else []

        image_url = str(raw.get("image_url") or "").strip() or None
        if not image_url and raw.get("image"):
            img_token = str(raw["image"]).strip()
            if img_token.startswith("http"):
                image_url = img_token
            else:
                image_url = f"https://images.rappi.com/products/{img_token}"

        calibrated = apply_calibration(standard_price, self.config.markup_discount_factor)
        pum = compute_pum(calibrated, content.net_content)
        display_name = simplify_display_name(
            raw_title,
            net_content=content.net_content,
            unit_measure=content.unit_measure,
        )
        private_label = is_store_private_label(self.config.store_id, brand, ean)
        meta = extract_product_metadata(
            raw_title,
            normalized_name=normalized_name,
            is_private_label=private_label,
        )
        canonical_slug = infer_broad_category_slug(
            normalized_name,
            content.net_content,
            content.unit_measure,
            category_path=category_path or None,
        )
        raw_url = str(raw.get("raw_url") or ISIMO_RAPPI_CATALOG_URL).strip()
        if not is_mercado_product(
            self.config.store_id,
            raw_title,
            brand=brand,
            raw_url=raw_url,
            category_path=category_path,
        ):
            return None, None

        model = self.validate_product(
            {
                "store_id": self.config.store_id,
                "external_sku": external_sku,
                "ean": ean,
                "raw_name": raw_title[:255],
                "normalized_name": normalized_name[:255],
                "display_name": display_name[:255],
                "brand": brand,
                "raw_list_price": standard_price,
                "raw_sale_price": standard_price,
                "calibrated_price": calibrated,
                "net_content": content.net_content,
                "unit_measure": content.unit_measure,
                "pum_price": pum,
                "in_stock": True,
                "source_origin": ISIMO_SOURCE_ORIGIN,
                "raw_url": raw_url,
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
        if model is None:
            return None, None

        promo_obs: RappiPromoObservation | None = None
        if explicit_promo_price is not None and explicit_promo_price < calibrated:
            promo_obs = RappiPromoObservation(
                external_sku=model.external_sku,
                standard_price=calibrated,
                promo_price=explicit_promo_price,
                promo_url=raw_url,
            )

        return model, promo_obs


def compute_verified_rappi_discount(
    *,
    current_standard_price: Decimal,
    historical_standard_price: Decimal | None,
    rappi_promo_price: Decimal | None,
) -> tuple[Decimal, Decimal, Decimal] | None:
    """Compara descuento Rappi contra precio estándar actual e histórico en BD.

    Retorna `(reference_standard, savings_cop, savings_pct)` solo si el ahorro es real (> 0).
    """
    if rappi_promo_price is None or rappi_promo_price <= 0:
        return None
    if historical_standard_price is not None and historical_standard_price > 0:
        reference_standard = min(current_standard_price, historical_standard_price)
    else:
        reference_standard = current_standard_price

    if rappi_promo_price >= reference_standard:
        return None

    savings_cop = (reference_standard - rappi_promo_price).quantize(Decimal("0.01"))
    savings_pct = ((savings_cop / reference_standard) * Decimal("100")).quantize(Decimal("0.01"))
    return reference_standard, savings_cop, savings_pct


def _plan_rappi_discount_sync(
    promos_by_sku: dict[str, RappiPromoObservation],
    historical_by_sku: dict[str, Decimal],
) -> tuple[list[tuple[str, Decimal, Decimal, Decimal, str]], list[str]]:
    """Calcula altas/actualizaciones y limpiezas de descuentos Rappi sobre el catálogo."""
    promo_updates: list[tuple[str, Decimal, Decimal, Decimal, str]] = []
    clear_skus: list[str] = []

    for ext_sku in historical_by_sku:
        obs = promos_by_sku.get(ext_sku)
        if obs is None:
            clear_skus.append(ext_sku)
            continue
        verified = compute_verified_rappi_discount(
            current_standard_price=obs.standard_price,
            historical_standard_price=historical_by_sku.get(ext_sku),
            rappi_promo_price=obs.promo_price,
        )
        if verified is None:
            clear_skus.append(ext_sku)
            continue
        _, savings_cop, savings_pct = verified
        promo_updates.append((ext_sku, obs.promo_price, savings_cop, savings_pct, obs.promo_url))

    return promo_updates, clear_skus


def sync_isimo_rappi_discounts(
    promos_by_sku: dict[str, RappiPromoObservation],
    database_url: str,
) -> dict[str, int]:
    """Sincroniza descuentos reales de Rappi en `store_skus` y limpia promos caducadas."""
    import psycopg

    with psycopg.connect(database_url, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    ss.external_sku,
                    (
                        SELECT pr.calibrated_price
                        FROM public.price_records pr
                        WHERE pr.store_sku_id = ss.id
                        ORDER BY pr.captured_at DESC, pr.id DESC
                        LIMIT 1
                    ) AS latest_standard
                FROM public.store_skus ss
                WHERE ss.store_id = 'isimo';
                """
            )
            historical_by_sku: dict[str, Decimal] = {
                str(ext_sku): Decimal(str(std))
                for ext_sku, std in cur.fetchall()
                if std is not None and Decimal(str(std)) > 0
            }

            planned_updates, planned_clears = _plan_rappi_discount_sync(
                promos_by_sku,
                historical_by_sku,
            )
            promo_updates = [
                (
                    str(promo_price),
                    str(savings_cop),
                    str(savings_pct),
                    promo_url,
                    ext_sku,
                )
                for ext_sku, promo_price, savings_cop, savings_pct, promo_url in planned_updates
            ]
            clear_skus = [(ext_sku,) for ext_sku in planned_clears]

            if promo_updates:
                cur.executemany(
                    """
                    UPDATE public.store_skus
                    SET
                        rappi_promo_price = %s::numeric,
                        rappi_savings_cop = %s::numeric,
                        rappi_savings_pct = %s::numeric,
                        rappi_promo_url = %s,
                        rappi_promo_updated_at = NOW(),
                        available_cities = NULL
                    WHERE store_id = 'isimo' AND external_sku = %s;
                    """,
                    promo_updates,
                )
            if clear_skus:
                cur.executemany(
                    """
                    UPDATE public.store_skus
                    SET
                        rappi_promo_price = NULL,
                        rappi_savings_cop = NULL,
                        rappi_savings_pct = NULL,
                        rappi_promo_url = NULL,
                        rappi_promo_updated_at = NOW(),
                        available_cities = NULL
                    WHERE store_id = 'isimo' AND external_sku = %s;
                    """,
                    clear_skus,
                )
        conn.commit()

    stats = {
        "total_isimo_skus": len(historical_by_sku),
        "verified_rappi_discounts": len(promo_updates),
        "cleared_non_discounted": len(clear_skus),
    }
    logger.info("[isimo] Sincronización de descuentos Rappi completada: %s", stats)
    return stats


async def sync_isimo_rappi_discounts_gateway(
    promos_by_sku: dict[str, RappiPromoObservation],
    gateway: Any,
) -> dict[str, int]:
    """Sincroniza descuentos reales de Rappi vía `SupabaseGateway` (sin requerir `DATABASE_URL`)."""
    sku_rows = await gateway.fetch_store_skus("isimo")
    latest_rows = await gateway.fetch_latest_prices("isimo")

    ext_by_id = {
        str(row["id"]): str(row["external_sku"])
        for row in sku_rows
        if row.get("id") and row.get("external_sku")
    }
    historical_by_sku: dict[str, Decimal] = {}
    for row in latest_rows:
        sku_id = str(row.get("store_sku_id") or "")
        ext_sku = ext_by_id.get(sku_id)
        std = _to_decimal(row.get("calibrated_price"))
        if ext_sku and std is not None:
            historical_by_sku[ext_sku] = std

    promo_updates, clear_skus = _plan_rappi_discount_sync(promos_by_sku, historical_by_sku)
    now_iso = datetime.now(UTC).isoformat()

    if hasattr(gateway, "_execute"):
        for start in range(0, len(clear_skus), 100):
            chunk = clear_skus[start : start + 100]
            await gateway._execute(
                lambda client, c=chunk: (
                    client.table("store_skus")
                    .update(
                        {
                            "rappi_promo_price": None,
                            "rappi_savings_cop": None,
                            "rappi_savings_pct": None,
                            "rappi_promo_url": None,
                            "rappi_promo_updated_at": now_iso,
                            "available_cities": None,
                        }
                    )
                    .eq("store_id", "isimo")
                    .in_("external_sku", c)
                    .execute()
                )
            )
        for ext_sku, promo_price, savings_cop, savings_pct, promo_url in promo_updates:
            await gateway._execute(
                lambda client, sku=ext_sku, pp=promo_price, sc=savings_cop, sp=savings_pct, pu=promo_url: (
                    client.table("store_skus")
                    .update(
                        {
                            "rappi_promo_price": str(pp),
                            "rappi_savings_cop": str(sc),
                            "rappi_savings_pct": str(sp),
                            "rappi_promo_url": pu,
                            "rappi_promo_updated_at": now_iso,
                            "available_cities": None,
                        }
                    )
                    .eq("store_id", "isimo")
                    .eq("external_sku", sku)
                    .execute()
                )
            )

    stats = {
        "total_isimo_skus": len(historical_by_sku),
        "verified_rappi_discounts": len(promo_updates),
        "cleared_non_discounted": len(clear_skus),
    }
    logger.info("[isimo] Sincronización de descuentos Rappi (API) completada: %s", stats)
    return stats
