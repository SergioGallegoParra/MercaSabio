"""Pruebas unitarias para conectores Next.js Flight RSC Instaleap (Cañaveral y Makro)."""

from __future__ import annotations

import json
import unittest
from decimal import Decimal

import httpx

from etl.core.grocery_filter import evaluate_category_path_whitelist
from etl.scrapers.canaveral_scraper import CanaveralScraper, default_canaveral_config
from etl.scrapers.makro_scraper import MakroScraper, default_makro_config


def _wrap_rsc_html(rsc_lines: list[str]) -> str:
    payload = "\n".join(rsc_lines)
    escaped = json.dumps(payload)[1:-1]
    return f'<html><body><script>self.__next_f.push([1,"{escaped}"])</script></body></html>'


class InstaleapScrapersTests(unittest.TestCase):
    def test_baby_dairy_food_category_is_allowed_by_whitelist(self) -> None:
        decision, _ = evaluate_category_path_whitelist(["MUNDO BEBES", "ALIMENTOS LACTEOS"])
        self.assertEqual(decision, "ALLOW")

    def test_pet_accessories_category_is_denied_by_whitelist(self) -> None:
        decision, _ = evaluate_category_path_whitelist(["MUNDO MASCOTAS", "ACCESORIOS"])
        self.assertEqual(decision, "DENY")

    def test_non_alcoholic_beverages_and_laundry_detergents_are_allowed(self) -> None:
        self.assertEqual(
            evaluate_category_path_whitelist(["Bebidas Sin Licor", "Bebidas", "Aguas"])[0],
            "ALLOW",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["¡Conoce Nuestras Marcas Propias!", "Limpieza", "Detergentes Para Ropa"])[0],
            "ALLOW",
        )


class InstaleapAsyncScrapersTests(unittest.IsolatedAsyncioTestCase):
    async def test_canaveral_discovers_whitelisted_categories_paginates_and_parses_promos(self) -> None:
        category_tree = [
            {
                "name": "DESPENSA",
                "slug": "despensa/010",
                "categoryNamesPath": "/DESPENSA",
                "subCategories": [
                    {
                        "name": "ACEITES",
                        "slug": "despensa/aceites/010/0037",
                        "categoryNamesPath": "/DESPENSA/ACEITES",
                        "subCategories": [],
                    }
                ],
            },
            {
                "name": "LICORES",
                "slug": "licores/03",
                "categoryNamesPath": "/LICORES",
                "subCategories": [
                    {
                        "name": "CIGARRILLOS",
                        "slug": "licores/cigarrillos/03/0143",
                        "categoryNamesPath": "/LICORES/CIGARRILLOS",
                        "subCategories": [],
                    }
                ],
            },
            {
                "name": "MARKETPLACE",
                "slug": "marketplace/023",
                "categoryNamesPath": "/MARKETPLACE",
                "subCategories": [
                    {
                        "name": "ELECTROMENORES",
                        "slug": "marketplace/electromenores/023/0298",
                        "categoryNamesPath": "/MARKETPLACE/ELECTROMENORES",
                        "subCategories": [],
                    }
                ],
            },
        ]

        home_html = _wrap_rsc_html(
            [f'10:["$","$L1",null,{{"categoryTree":{json.dumps(category_tree)}}}]']
        )

        # Página 1 con 50 productos (para forzar consulta de currentPage=2), incluyendo uno con promo activa
        page1_products = [
            {
                "sku": "35885",
                "name": "Aceite Premier Girasol *1800Ml",
                "price": 39050,
                "previousPrice": None,
                "ean": ["7701018076423"],
                "photosUrl": "$2a",
                "subUnit": "ML",
                "subQty": 1800,
                "slug": "aceite-premier-girasol-1800ml-35885",
                "brand": "PREMIER",
                "stock": 209,
                "isAvailable": True,
                "promotion": {
                    "type": "specialPrice",
                    "isActive": True,
                    "conditions": [{"quantity": 0, "price": 34900}],
                },
                "categoriesData": [{"categoryNamesPath": "/DESPENSA/ACEITES"}],
            }
        ]
        for idx in range(2, 51):
            page1_products.append(
                {
                    "sku": f"100{idx}",
                    "name": f"Aceite Prueba {idx} 1000 ml",
                    "price": 12000,
                    "ean": [],
                    "photosUrl": [],
                    "subUnit": "ML",
                    "subQty": 1000,
                    "slug": f"aceite-prueba-{idx}",
                    "brand": "CAÑAVERAL",
                    "stock": 10,
                    "isAvailable": True,
                    "promotion": None,
                    "categoriesData": [{"categoryNamesPath": "/DESPENSA/ACEITES"}],
                }
            )

        page1_html = _wrap_rsc_html(
            [
                '2a:["https://storage.googleapis.com/stcanaveral/35885.webp"]',
                f'c:["$","$L2",null,{{"products":{json.dumps(page1_products)}}}]',
            ]
        )

        page2_products = [
            {
                "sku": "46857",
                "name": "Aceite Gourmet Oliva 500 ml",
                "price": 28500,
                "ean": ["7702000000123"],
                "photosUrl": ["https://storage.googleapis.com/stcanaveral/46857.webp"],
                "subUnit": "ML",
                "subQty": 500,
                "slug": "aceite-gourmet-oliva-500ml-46857",
                "brand": "GOURMET",
                "stock": 5,
                "isAvailable": True,
                "promotion": None,
                "categoriesData": [{"categoryNamesPath": "/DESPENSA/ACEITES"}],
            }
        ]
        page2_html = _wrap_rsc_html([f'd:{json.dumps({"products": page2_products})}'])

        requested_urls: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested_urls.append(str(request.url))
            if request.url.path == "/":
                return httpx.Response(200, text=home_html)
            if request.url.path == "/ca/despensa/aceites/010/0037":
                if request.url.params.get("currentPage") == "2":
                    return httpx.Response(200, text=page2_html)
                return httpx.Response(200, text=page1_html)
            return httpx.Response(404)

        cfg = default_canaveral_config(requests_per_second=50.0)
        async with httpx.AsyncClient(
            base_url=cfg.base_url,
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = CanaveralScraper(cfg, client=client)
            products = await scraper.scrape_all()

        # Nunca debió pedir CIGARRILLOS ni ELECTROMENORES
        self.assertFalse(any("cigarrillos" in u for u in requested_urls))
        self.assertFalse(any("electromenores" in u for u in requested_urls))
        self.assertTrue(any("currentPage=2" in u for u in requested_urls))

        self.assertEqual(len(products), 51)
        premier = products[0]
        self.assertEqual(premier.store_id, "canaveral")
        self.assertEqual(premier.external_sku, "35885")
        self.assertEqual(premier.ean, "7701018076423")
        self.assertEqual(premier.raw_list_price, Decimal("39050.00"))
        self.assertEqual(premier.raw_sale_price, Decimal("34900.00"))
        self.assertEqual(premier.image_url, "https://storage.googleapis.com/stcanaveral/35885.webp")
        self.assertEqual(premier.category_path, ["DESPENSA", "ACEITES"])
        self.assertEqual(products[1].is_private_label, True)
        self.assertEqual(products[-1].external_sku, "46857")

    async def test_makro_scraper_preserves_route_scraping_and_resolves_refs(self) -> None:
        html = _wrap_rsc_html(
            [
                '1f:["https://cdn.makro.com.co/arroz.webp"]',
                '20:{"sku":"8811","name":"Arroz Blanco Diana 1000 g","price":4200,"ean":["7702511000014"],"photosUrl":"$1f","slug":"arroz-diana-1000g","brand":"DIANA","subUnit":"G","subQty":1000,"stock":12,"isAvailable":true}',
            ]
        )

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/ca/mercado-y-alimentos/CP_01":
                return httpx.Response(200, text=html)
            return httpx.Response(404)

        cfg = default_makro_config(requests_per_second=50.0, max_categories=1)
        async with httpx.AsyncClient(
            base_url=cfg.base_url,
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = MakroScraper(
                cfg,
                client=client,
                search_terms=[],
                auto_discover_categories=False,
            )
            products = await scraper.scrape_all()

        self.assertEqual(len(products), 1)
        self.assertEqual(products[0].store_id, "makro")
        self.assertEqual(products[0].ean, "7702511000014")
        self.assertEqual(products[0].image_url, "https://cdn.makro.com.co/arroz.webp")


if __name__ == "__main__":
    unittest.main()
