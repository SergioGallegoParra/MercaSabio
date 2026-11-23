"""Pruebas unitarias para el conector Odoo de Supermercados Boom (`web.superboom.net`)."""

from __future__ import annotations

import unittest
from decimal import Decimal

import httpx

from etl.scrapers.superboom_scraper import SuperboomScraper, default_superboom_config


def _pill(href: str, label: str) -> str:
    return (
        f'<li class="tp-category-pill"><a href="{href}">'
        f'<h6 class="tp-category-text">{label}</h6></a></li>'
    )


def _card(
    sku: str,
    title: str,
    href: str,
    sale_price: str,
    *,
    list_price_html: str = "19.104",
    list_price_hidden: bool = True,
) -> str:
    d_none = " d-none" if list_price_hidden else ""
    return f"""
    <form action="/shop/cart/update" method="post" class="card oe_product_cart">
      <div class="card-body p-0 oe_product_image">
        <a itemprop="url" href="{href}?category=1">
          <img src="/web/image/product.template/{sku}/image_512/foto.webp" alt="[{sku}] {title}"/>
        </a>
      </div>
      <div class="card-body p-0 o_wsale_product_information">
        <h6><a itemprop="name" title="{title}" href="{href}?category=1">{title}</a></h6>
        <div class="product_price">
          <small data-oe-expression="combination_info[&#39;list_price&#39;]" class="text-body ml-1{d_none}">
            $ <span class="oe_currency_value">{list_price_html}</span>
          </small>
          <span itemprop="price" style="display:none;">{sale_price}</span>
        </div>
        <button data-product-id="{sku}" class="tp-product-quick-view-action"></button>
      </div>
    </form>
    """


class SuperboomScraperTests(unittest.IsolatedAsyncioTestCase):
    async def test_superboom_discovers_subcategories_filters_whitelist_and_paginates(self) -> None:
        shop_html = "".join(
            [
                _pill("/shop/category/despensa-333", "Despensa"),
                _pill("/shop/category/hogar-327", "Hogar"),
                _pill("/shop/category/licores-337", "Licores"),
            ]
        )
        despensa_html = "".join(
            [
                _pill("/shop/category/despensa-granos-391", "Granos"),
            ]
        )
        hogar_html = "".join(
            [
                _pill("/shop/category/hogar-cocina-350", "Cocina"),
                _pill("/shop/category/hogar-desechables-351", "Desechables"),
            ]
        )
        granos_p1 = (
            '<a href="/shop/category/despensa-granos-391/page/2">2</a>'
            + _card(
                "27092",
                "Frijol Cargamanto Rojo 500Gr",
                "/shop/007558-frijol-500gr-27092",
                "6500.0",
                list_price_html="8.200",
                list_price_hidden=False,
            )
        )
        granos_p2 = _card(
            "27093",
            "Arroz Blanco Diana 1000Gr",
            "/shop/007559-arroz-1000gr-27093",
            "4300.0",
            list_price_html="4.300",
            list_price_hidden=True,
        )
        desechables_p1 = _card(
            "33100",
            "Bolsas de Basura Negra x10 und",
            "/shop/009000-bolsas-33100",
            "5900.0",
        )

        requested_paths: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested_paths.append(request.url.path)
            routes = {
                "/shop": shop_html,
                "/shop/category/despensa-333": despensa_html,
                "/shop/category/hogar-327": hogar_html,
                "/shop/category/despensa-granos-391": granos_p1,
                "/shop/category/despensa-granos-391/page/2": granos_p2,
                "/shop/category/hogar-desechables-351": desechables_p1,
            }
            if request.url.path in routes:
                return httpx.Response(200, text=routes[request.url.path])
            return httpx.Response(404)

        cfg = default_superboom_config(requests_per_second=50.0)
        async with httpx.AsyncClient(
            base_url=cfg.base_url,
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = SuperboomScraper(cfg, client=client)
            products = await scraper.scrape_all()

        self.assertNotIn("/shop/category/licores-337", requested_paths)
        self.assertNotIn("/shop/category/hogar-cocina-350", requested_paths)
        self.assertIn("/shop/category/despensa-granos-391/page/2", requested_paths)
        self.assertEqual(len(products), 3)

        frijol, arroz, bolsas = products
        self.assertEqual(frijol.store_id, "superboom")
        self.assertEqual(frijol.external_sku, "27092")
        self.assertEqual(frijol.raw_sale_price, Decimal("6500.00"))
        self.assertEqual(frijol.raw_list_price, Decimal("8200.00"))
        self.assertEqual(frijol.net_content, Decimal("500.00"))
        self.assertEqual(frijol.unit_measure.value, "g")
        self.assertEqual(frijol.raw_url, "https://web.superboom.net/shop/007558-frijol-500gr-27092")
        self.assertEqual(frijol.category_path, ["Despensa", "Granos"])

        self.assertEqual(arroz.raw_sale_price, Decimal("4300.00"))
        self.assertEqual(arroz.raw_list_price, Decimal("4300.00"))
        self.assertEqual(arroz.net_content, Decimal("1000.00"))
        self.assertEqual(bolsas.category_path, ["Hogar", "Desechables"])


if __name__ == "__main__":
    unittest.main()
