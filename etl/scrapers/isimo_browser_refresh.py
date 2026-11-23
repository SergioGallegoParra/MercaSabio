"""Refresco determinístico (sin LLM) del catálogo dinámico de Tiendas Ísimo en Rappi.

Usa Playwright para navegar la tienda ``900468086-isimo-mt-nc``, capturar datos
``_next/data`` / ``__NEXT_DATA__`` y expandir botones ``+ Ver más`` en las secciones
con más de 24 ítems y en ``combos``, guardando los snapshots de forma atómica solo
cuando la extracción supera los umbrales mínimos de seguridad.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from etl.scrapers.isimo_scraper import (
    DEFAULT_ISIMO_BROWSER_SNAPSHOT,
    DEFAULT_ISIMO_SSR_SNAPSHOT,
    ISIMO_RAPPI_BASE_URL,
    ISIMO_RAPPI_CATALOG_URL,
    ISIMO_RAPPI_STORE_SLUG,
    _slugify,
    parse_rappi_dom_item,
)

logger = logging.getLogger(__name__)

DEFAULT_DYNAMIC_SECTIONS: tuple[str, ...] = (
    "despensa/condimentos-y-salsas",
    "lacteos-y-refrigerados/yogurt-y-bebidas-lacteas",
    "snacks-y-dulces/snacks-salados",
    "snacks-y-dulces/galletas",
    "bebidas/gaseosas-y-maltas",
    "cuidado-hogar/limpieza-cocina",
    "combos",
)

DEFAULT_MEDELLIN_COORDS: tuple[float, float] = (6.1702, -75.6113)
_CARD_ID_RE = re.compile(r"(\d+)$")

_DOM_EXTRACT_JS = """() => {
    const out = [];
    const seen = new Set();
    const imgs = Array.from(document.querySelectorAll('img[src*="images.rappi.com/products"], img[data-testid*="product"], article img'));
    for (const img of imgs) {
        let card = img.closest('article, li, div');
        while (card && card.parentElement && !(card.innerText || '').includes('$')) {
            card = card.parentElement;
        }
        if (!card) continue;
        for (let step = 0; step < 3; step++) {
            const txt = (card.innerText || '');
            if (/\\(\\s*\\$[\\d.,]+\\s*\\/\\s*(g|gr|ml|und|u|combo|kg|l)\\s*\\)/i.test(txt)) {
                break;
            }
            if (card.parentElement) {
                card = card.parentElement;
            }
        }
        const raw = (card.innerText || '').replace(/\\s+/g, ' ').trim();
        if (!raw || raw.length > 260) continue;
        const src = (img.getAttribute('src') || img.getAttribute('data-src') || '').trim();
        const anchor = card.querySelector('a[href*="/producto/"], a[href*="-"]');
        const href = anchor ? (anchor.getAttribute('href') || '').trim() || null : null;
        const rawId = card.getAttribute('data-item-id')
            || card.getAttribute('data-product-id')
            || card.getAttribute('data-id')
            || img.getAttribute('data-id')
            || '';
        const key = `${src}|${href || ''}|${raw}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: rawId || null, img: src || null, href, raw });
    }
    return out;
}"""


@dataclass(frozen=True, slots=True)
class RefreshResult:
    """Resultado de una ejecución del refresco determinístico por navegador."""

    status: str  # "updated" | "dry_run" | "blocked" | "insufficient" | "unavailable" | "error"
    ssr_items_count: int = 0
    browser_items_count: int = 0
    sections_visited: int = 0
    message: str = ""


def _atomic_write_json(path: Path, payload: Any) -> None:
    """Escribe JSON de forma atómica evitando truncar snapshots válidos si ocurre un fallo."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(tmp_path, path)


def extract_products_from_next_payload(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Extrae productos estructurados desde un JSON `__NEXT_DATA__` o `_next/data` de Rappi."""
    page_props = (payload.get("props") or {}).get("pageProps") or payload.get("pageProps") or {}
    fallback = page_props.get("fallback") or {}
    if not isinstance(fallback, dict):
        return {}

    products_by_id: dict[str, dict[str, Any]] = {}
    for entry in fallback.values():
        if not isinstance(entry, dict):
            continue
        for key in ("aisles_tree_response", "sub_aisles_response", "aisle_detail_response"):
            components = ((entry.get(key) or {}).get("data") or {}).get("components") or []
            for comp in components:
                for prod in ((comp.get("resource") or {}).get("products") or []):
                    pid = str(prod.get("product_id") or prod.get("id") or "").strip()
                    if pid:
                        products_by_id[pid] = prod
    return products_by_id


def discover_paginated_sections_from_next_payload(payload: dict[str, Any]) -> list[str]:
    """Descubre subpasillos cuya cantidad esperada supera los ítems embebidos en SSR."""
    page_props = (payload.get("props") or {}).get("pageProps") or payload.get("pageProps") or {}
    fallback = page_props.get("fallback") or {}
    if not isinstance(fallback, dict):
        return []

    discovered: list[str] = []
    prefix = f"storefront/{ISIMO_RAPPI_STORE_SLUG}/"
    for key, entry in fallback.items():
        if not isinstance(entry, dict) or not str(key).startswith(prefix):
            continue
        aisle_slug = str(key)[len(prefix) :].strip("/")
        if not aisle_slug or "/" in aisle_slug or aisle_slug in {"catalog", "combos"}:
            continue
        sub_data = (entry.get("sub_aisles_response") or {}).get("data") or {}
        components = sub_data.get("components") or []
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
                    full = f"{aisle_slug}/{sslug}"
                    if full not in discovered:
                        discovered.append(full)
    return discovered


def normalize_browser_cards(
    raw_cards: Sequence[dict[str, Any]],
    *,
    section: str,
) -> list[dict[str, Any]]:
    """Filtra y normaliza tarjetas DOM usando `parse_rappi_dom_item` antes de persistir."""
    normalized: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for idx, card in enumerate(raw_cards):
        raw_text = " ".join(str(card.get("raw") or "").split())
        if not raw_text:
            continue
        raw_id = str(card.get("id") or "").strip() or None
        href = str(card.get("href") or "").strip() or None
        img = str(card.get("img") or "").strip() or None
        parsed = parse_rappi_dom_item(
            raw_text,
            item_id=raw_id,
            image_url=img,
            section=section,
            href=href,
        )
        if parsed is None:
            continue
        dom_dict, _ = parsed
        resolved_id = dom_dict.get("master_product_id")
        if not resolved_id and section == "combos":
            resolved_id = f"combo_{idx}"

        dedup_key = f"{section}:{resolved_id or raw_text}"
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        normalized.append(
            {
                "section": section,
                "id": resolved_id,
                "img": img,
                "href": href,
                "raw": raw_text,
            }
        )
    return normalized


def _is_waf_or_auth_wall(title: str, body_text: str, status_code: int | None = None) -> str | None:
    """Detecta bloqueos WAF (403/CloudFront), login o CAPTCHA para detenerse limpiamente."""
    if status_code in {403, 429}:
        return f"HTTP {status_code} detectado en Rappi"
    lowered_title = title.lower()
    if "error: the request could not be satisfied" in lowered_title or "access denied" in lowered_title:
        return f"Bloqueo CloudFront/WAF ({title})"
    lowered_body = body_text.lower()
    if "verify you are human" in lowered_body or "captcha" in lowered_body:
        return "Verificación anti-bot/CAPTCHA detectada; abortando sin evasión"
    return None


async def _launch_browser_context(
    playwright_obj: Any,
    *,
    headless: bool,
    channel: str,
    user_data_dir: Path | None,
) -> tuple[Any, Any]:
    """Lanza navegador Chromium/Chrome/Edge respetando perfil persistente si se suministra."""
    channels_to_try: list[str | None]
    if channel == "auto":
        channels_to_try = ["chrome", "msedge", None]
    elif channel == "chromium":
        channels_to_try = [None]
    else:
        channels_to_try = [channel, None]

    context_opts: dict[str, Any] = {
        "viewport": {"width": 1280, "height": 900},
        "locale": "es-CO",
        "geolocation": {
            "latitude": DEFAULT_MEDELLIN_COORDS[0],
            "longitude": DEFAULT_MEDELLIN_COORDS[1],
        },
        "permissions": ["geolocation"],
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
    }

    last_exc: Exception | None = None
    for ch in channels_to_try:
        launch_kwargs: dict[str, Any] = {"headless": headless}
        if ch is not None:
            launch_kwargs["channel"] = ch
        try:
            if user_data_dir is not None:
                user_data_dir.mkdir(parents=True, exist_ok=True)
                ctx = await playwright_obj.chromium.launch_persistent_context(
                    str(user_data_dir),
                    **launch_kwargs,
                    **context_opts,
                )
                return None, ctx
            browser = await playwright_obj.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(**context_opts)
            return browser, ctx
        except Exception as exc:
            last_exc = exc
            logger.debug("[isimo-browser] Canal %r no disponible: %s", ch, exc)
            continue

    raise RuntimeError(f"No se pudo iniciar ningún navegador Playwright: {last_exc}")


async def _navigate_section_cleanly(
    page: Any,
    *,
    base_url: str,
    store_slug: str,
    section: str,
    delay_ms: int,
) -> tuple[int | None, bool]:
    """Navega a una subsección intentando ruta directa o navegación por barra lateral."""
    target_url = f"{base_url.rstrip('/')}/tiendas/{store_slug}/{section}"
    resp = await page.goto(target_url, wait_until="domcontentloaded", timeout=35000)
    status_code = resp.status if resp is not None else None
    await page.wait_for_timeout(delay_ms)

    # Si Rappi redirige fuera de la tienda por GeoIP anónimo, volvemos al catálogo y navegamos por sidebar
    if store_slug not in (page.url or "") or section.split("/")[-1] not in (page.url or ""):
        parts = [p for p in section.split("/") if p]
        catalog_url = f"{base_url.rstrip('/')}/tiendas/{store_slug}/catalogo"
        if store_slug not in (page.url or ""):
            resp_cat = await page.goto(catalog_url, wait_until="domcontentloaded", timeout=35000)
            status_code = resp_cat.status if resp_cat is not None else status_code
            await page.wait_for_timeout(delay_ms)

        navigated = False
        for part in parts:
            link = page.locator(f'a[href*="/{part}"]:visible').first
            if await link.count() == 0:
                link = page.locator(f'a[href*="/{part}"]').first
            if await link.count() > 0:
                try:
                    await link.scroll_into_view_if_needed(timeout=4000)
                    await link.click(timeout=6000)
                    await page.wait_for_timeout(delay_ms)
                    navigated = True
                except Exception:
                    navigated = False
                    break
            else:
                navigated = False
                break
        return status_code, navigated

    return status_code, True


async def _expand_ver_mas(page: Any, *, delay_ms: int, max_clicks: int = 12) -> int:
    """Pulsa repetidamente `+ Ver más` / `Ver más` visible para cargar productos paginados."""
    clicks = 0
    while clicks < max_clicks:
        btn = page.locator("button:visible").filter(
            has_text=re.compile(r"^\+?\s*ver\s+m[aá]s$", re.IGNORECASE)
        ).first
        if await btn.count() == 0:
            break
        try:
            await btn.scroll_into_view_if_needed(timeout=4000)
            await btn.click(timeout=6000)
        except Exception:
            break
        clicks += 1
        await page.wait_for_timeout(max(delay_ms, 1500))
    return clicks


async def refresh_isimo_snapshots(
    *,
    sections: Sequence[str] = DEFAULT_DYNAMIC_SECTIONS,
    ssr_snapshot_path: Path = DEFAULT_ISIMO_SSR_SNAPSHOT,
    browser_snapshot_path: Path = DEFAULT_ISIMO_BROWSER_SNAPSHOT,
    base_url: str = ISIMO_RAPPI_BASE_URL,
    store_slug: str = ISIMO_RAPPI_STORE_SLUG,
    headless: bool = True,
    channel: str = "auto",
    user_data_dir: Path | None = None,
    delay_ms: int = 2400,
    max_clicks_per_section: int = 12,
    min_browser_items: int = 40,
    min_ssr_items: int = 150,
    dry_run: bool = False,
) -> RefreshResult:
    """Refresca `isimo_rappi_ssr.json` e `isimo_rappi_browser.json` sin intervención LLM."""
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        msg = f"Playwright no está instalado ({exc}); manteniendo snapshots actuales."
        logger.warning("[isimo-browser] %s", msg)
        return RefreshResult(status="unavailable", message=msg)

    ssr_products: dict[str, dict[str, Any]] = {}
    collected_browser_cards: list[dict[str, Any]] = []
    seen_browser_keys: set[str] = set()
    visited_sections: list[str] = []
    queue: list[str] = list(sections)
    queued_set = set(queue)

    browser = None
    ctx = None
    try:
        async with async_playwright() as p:
            browser, ctx = await _launch_browser_context(
                p,
                headless=headless,
                channel=channel,
                user_data_dir=user_data_dir,
            )
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()

            async def _on_response(response: Any) -> None:
                url = response.url or ""
                if "/_next/data/" not in url or response.status != 200:
                    return
                if store_slug not in url:
                    return
                try:
                    payload = await response.json()
                except Exception:
                    return
                if not isinstance(payload, dict):
                    return
                ssr_products.update(extract_products_from_next_payload(payload))
                for extra_sec in discover_paginated_sections_from_next_payload(payload):
                    if extra_sec not in queued_set:
                        queued_set.add(extra_sec)
                        queue.append(extra_sec)

            page.on("response", _on_response)

            # Paso 1: Abrir catálogo base y verificar estado no bloqueado
            catalog_url = (
                f"{base_url.rstrip('/')}/tiendas/{store_slug}/catalogo"
                if base_url != ISIMO_RAPPI_BASE_URL
                else ISIMO_RAPPI_CATALOG_URL
            )
            resp = await page.goto(catalog_url, wait_until="domcontentloaded", timeout=35000)
            await page.wait_for_timeout(delay_ms)

            title = await page.title()
            body_head = await page.evaluate("() => (document.body?.innerText || '').slice(0, 600)")
            block_reason = _is_waf_or_auth_wall(title, body_head, resp.status if resp else None)
            if block_reason:
                logger.warning("[isimo-browser] %s; abortando sin tocar snapshots.", block_reason)
                return RefreshResult(status="blocked", message=block_reason)

            # Extraer __NEXT_DATA__ inicial si existe
            next_data = await page.evaluate(
                """() => {
                    const el = document.querySelector('#__NEXT_DATA__');
                    if (!el || !el.textContent) return null;
                    try { return JSON.parse(el.textContent); } catch { return null; }
                }"""
            )
            if isinstance(next_data, dict):
                ssr_products.update(extract_products_from_next_payload(next_data))
                for extra_sec in discover_paginated_sections_from_next_payload(next_data):
                    if extra_sec not in queued_set:
                        queued_set.add(extra_sec)
                        queue.append(extra_sec)

            # Paso 2: Recorrer cada sección dinámica y expandir '+ Ver más'
            idx = 0
            while idx < len(queue):
                section = queue[idx]
                idx += 1

                status_code, ok_nav = await _navigate_section_cleanly(
                    page,
                    base_url=base_url,
                    store_slug=store_slug,
                    section=section,
                    delay_ms=delay_ms,
                )
                sec_title = await page.title()
                sec_body = await page.evaluate("() => (document.body?.innerText || '').slice(0, 400)")
                sec_block = _is_waf_or_auth_wall(sec_title, sec_body, status_code)
                if sec_block:
                    logger.warning("[isimo-browser] Bloqueo en sección %s (%s); abortando.", section, sec_block)
                    return RefreshResult(
                        status="blocked",
                        ssr_items_count=len(ssr_products),
                        browser_items_count=len(collected_browser_cards),
                        sections_visited=len(visited_sections),
                        message=sec_block,
                    )
                if not ok_nav:
                    logger.info("[isimo-browser] Sección %s omitida (ruta no disponible sin ubicación fija).", section)
                    continue

                clicks = await _expand_ver_mas(
                    page,
                    delay_ms=delay_ms,
                    max_clicks=max_clicks_per_section,
                )
                raw_cards = await page.evaluate(_DOM_EXTRACT_JS)
                normalized = normalize_browser_cards(raw_cards or [], section=section)
                visited_sections.append(section)

                added = 0
                for item in normalized:
                    key = f"{item['section']}:{item.get('id') or item['raw']}"
                    if key in seen_browser_keys:
                        continue
                    seen_browser_keys.add(key)
                    collected_browser_cards.append(item)
                    added += 1

                logger.info(
                    "[isimo-browser] Sección %s -> clicks=%d, extraídos=%d (nuevos=%d)",
                    section,
                    clicks,
                    len(normalized),
                    added,
                )

    except Exception as exc:
        logger.warning("[isimo-browser] Error durante el refresco Playwright: %s", exc)
        return RefreshResult(
            status="error",
            ssr_items_count=len(ssr_products),
            browser_items_count=len(collected_browser_cards),
            sections_visited=len(visited_sections),
            message=str(exc),
        )
    finally:
        if ctx is not None:
            try:
                await ctx.close()
            except Exception:
                pass
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass

    if len(collected_browser_cards) < min_browser_items and len(ssr_products) < min_ssr_items:
        msg = (
            f"Extracción insuficiente (ssr={len(ssr_products)}, browser={len(collected_browser_cards)}); "
            "snapshots anteriores conservados."
        )
        logger.warning("[isimo-browser] %s", msg)
        return RefreshResult(
            status="insufficient",
            ssr_items_count=len(ssr_products),
            browser_items_count=len(collected_browser_cards),
            sections_visited=len(visited_sections),
            message=msg,
        )

    if dry_run:
        return RefreshResult(
            status="dry_run",
            ssr_items_count=len(ssr_products),
            browser_items_count=len(collected_browser_cards),
            sections_visited=len(visited_sections),
            message="Simulación dry-run completada sin sobrescribir archivos.",
        )

    updated_targets: list[str] = []
    if len(ssr_products) >= min_ssr_items:
        _atomic_write_json(ssr_snapshot_path, list(ssr_products.values()))
        updated_targets.append(f"ssr={len(ssr_products)}")
    if len(collected_browser_cards) >= min_browser_items:
        _atomic_write_json(browser_snapshot_path, collected_browser_cards)
        updated_targets.append(f"browser={len(collected_browser_cards)}")

    status = "updated" if updated_targets else "insufficient"
    summary = ", ".join(updated_targets) if updated_targets else "ningún snapshot alcanzó el umbral mínimo"
    logger.info("[isimo-browser] Resultado final (%s): %s", status, summary)
    return RefreshResult(
        status=status,
        ssr_items_count=len(ssr_products),
        browser_items_count=len(collected_browser_cards),
        sections_visited=len(visited_sections),
        message=summary,
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Refresco determinístico Playwright (sin LLM) para Tiendas Ísimo en Rappi.",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Ejecuta Chrome visible en lugar de headless.",
    )
    parser.add_argument(
        "--channel",
        default="auto",
        choices=["auto", "chrome", "msedge", "chromium"],
        help="Navegador a usar con Playwright.",
    )
    parser.add_argument(
        "--user-data-dir",
        default=os.environ.get("ISIMO_CHROME_USER_DATA_DIR", ""),
        help="Directorio opcional de perfil Chrome para conservar ubicación/sesión.",
    )
    parser.add_argument(
        "--delay-ms",
        type=int,
        default=2400,
        help="Pausa de cortesía en ms tras cada carga o clic en `+ Ver más`.",
    )
    parser.add_argument(
        "--min-browser-items",
        type=int,
        default=40,
        help="Mínimo de tarjetas válidas para reemplazar `isimo_rappi_browser.json`.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Ejecuta la captura sin escribir archivos JSON en disco.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    args = parse_args(argv)
    profile_dir = Path(args.user_data_dir) if args.user_data_dir.strip() else None
    result = asyncio.run(
        refresh_isimo_snapshots(
            headless=not args.headed,
            channel=args.channel,
            user_data_dir=profile_dir,
            delay_ms=max(args.delay_ms, 200),
            min_browser_items=max(args.min_browser_items, 1),
            dry_run=args.dry_run,
        )
    )
    logger.info("[isimo-browser] %s", result)
    return 0 if result.status in {"updated", "dry_run"} else 1


if __name__ == "__main__":
    sys.exit(main())
