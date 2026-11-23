"""Pruebas unitarias para el conector WooCommerce Store API de Amy Supermercado."""

from __future__ import annotations

import unittest
from decimal import Decimal

import httpx

from etl.core.grocery_filter import evaluate_category_path_whitelist
from etl.scrapers.amy_scraper import AmyScraper, default_amy_config


class AmyWhitelistTests(unittest.TestCase):
    def test_amy_categories_pets_baby_and_liquor(self) -> None:
        self.assertEqual(
            evaluate_category_path_whitelist(
                ["Congelados y Refrigerados", "Lácteos y refrigerados", "Nutrición infantil"]
            )[0],
            "ALLOW",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(
                ["Aseo del hogar", "Cuidado del hogar", "Limpieza muebles y otros"]
            )[0],
            "ALLOW",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["Droguería y mascotas", "Perros"])[0],
            "ALLOW",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["Droguería y mascotas", "Droguería y otros"])[0],
            "DENY",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["Rancho y Licores", "Aguardiente"])[0],
            "DENY",
        )


class AmyScraperAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_amy_paginates_filters_and_detects_mua_private_label(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/wp-json/wc/store/v1/products/categories":
                return httpx.Response(
                    200,
                    headers={"X-WP-TotalPages": "1"},
                    json=[
                        {"id": 95, "name": "Bebidas", "parent": 0},
                        {"id": 116, "name": "Aguas", "parent": 95},
                        {"id": 94, "name": "Amercar Saludable", "parent": 0},
                        {"id": 96, "name": "Rancho y Licores", "parent": 0},
                        {"id": 122, "name": "Aguardiente", "parent": 96},
                    ],
                )
            if request.url.path == "/wp-json/wc/store/v1/products":
                page = int(request.url.params.get("page", "1"))
                if page == 1:
                    return httpx.Response(
                        200,
                        headers={"X-WP-TotalPages": "2"},
                        json=[
                            {
                                "id": 9205,
                                "name": "Aguardiente ANTIOQUEÑO rojo 1000ml",
                                "sku": "8632",
                                "permalink": "https://www.amy.com.co/producto/aguardiente/",
                                "prices": {
                                    "price": "45000",
                                    "regular_price": "45000",
                                    "sale_price": "45000",
                                    "currency_minor_unit": 0,
                                },
                                "categories": [{"id": 122, "name": "Aguardiente"}],
                                "images": [],
                                "is_in_stock": True,
                            },
                            {
                                "id": 363646,
                                "name": "Agua MUA potable 1000ml",
                                "sku": "744",
                                "permalink": "https://www.amy.com.co/producto/agua-mua-potable-1000ml/",
                                "prices": {
                                    "price": "1100",
                                    "regular_price": "1300",
                                    "sale_price": "1100",
                                    "currency_minor_unit": 0,
                                },
                                "categories": [{"id": 116, "name": "Aguas"}],
                                "images": [{"src": "https://www.amy.com.co/wp-content/uploads/agua.webp"}],
                                "is_in_stock": True,
                            },
                        ],
                    )
                if page == 2:
                    return httpx.Response(
                        200,
                        headers={"X-WP-TotalPages": "2"},
                        json=[
                            {
                                "id": 361636,
                                "name": "Pancakes WHY NOT a base de almendra 285g",
                                "sku": "15517",
                                "permalink": "https://www.amy.com.co/producto/pancakes/",
                                "prices": {
                                    "price": "43300",
                                    "regular_price": "43300",
                                    "sale_price": "43300",
                                    "currency_minor_unit": 0,
                                },
                                "categories": [{"id": 94, "name": "Amercar Saludable"}],
                                "images": [],
                                "is_in_stock": False,
                            }
                        ],
                    )
            return httpx.Response(404)

        cfg = default_amy_config(requests_per_second=50.0)
        async with httpx.AsyncClient(
            base_url=cfg.base_url,
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = AmyScraper(cfg, client=client)
            products = await scraper.scrape_all()

        self.assertEqual(len(products), 2)
        agua, pancakes = products
        self.assertEqual(agua.store_id, "amy")
        self.assertEqual(agua.external_sku, "363646")
        self.assertIsNone(agua.ean)
        self.assertEqual(agua.brand, "MUA")
        self.assertTrue(agua.is_private_label)
        self.assertEqual(agua.raw_list_price, Decimal("1300.00"))
        self.assertEqual(agua.raw_sale_price, Decimal("1100.00"))
        self.assertEqual(agua.category_path, ["Bebidas", "Aguas"])
        self.assertTrue(agua.in_stock)

        self.assertEqual(pancakes.external_sku, "361636")
        self.assertFalse(pancakes.is_private_label)
        self.assertFalse(pancakes.in_stock)


if __name__ == "__main__":
    unittest.main()
