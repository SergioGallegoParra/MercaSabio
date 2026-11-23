"""Pruebas unitarias para el conector WooCommerce Store API de Belalcázar."""

from __future__ import annotations

import unittest
from decimal import Decimal

import httpx

from etl.core.grocery_filter import evaluate_category_path_whitelist
from etl.scrapers.belalcazar_scraper import BelalcazarScraper, default_belalcazar_config


class BelalcazarWhitelistTests(unittest.TestCase):
    def test_belalcazar_categories_and_exemptions(self) -> None:
        self.assertEqual(
            evaluate_category_path_whitelist(["Canasta familiar", "Huevo", "Huevo rojo"])[0],
            "ALLOW",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["Blanqueadores y quitamanchas ropa color y ropa blanca"])[0],
            "ALLOW",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(
                ["Pan, tortillas y tostados", "Variedades tortillas y tostados", "Tostados"]
            )[0],
            "ALLOW",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["Vinos y licores", "Ron"])[0],
            "DENY",
        )


class BelalcazarScraperAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_belalcazar_paginates_filters_liquor_and_parses_ean_and_prices(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/wp-json/wc/store/v1/products/categories":
                return httpx.Response(
                    200,
                    headers={"X-WP-TotalPages": "1"},
                    json=[
                        {"id": 84, "name": "Canasta familiar", "parent": 0},
                        {"id": 98, "name": "Aceites", "parent": 84},
                        {"id": 353, "name": "Ron", "parent": 0},
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
                                "id": 19487,
                                "name": "Ron marques del valle 8 años 375 cc",
                                "sku": "7702055001409",
                                "permalink": "https://supermercadobelalcazar.com.co/producto/ron/",
                                "prices": {
                                    "price": "31500",
                                    "regular_price": "31500",
                                    "sale_price": "31500",
                                    "currency_minor_unit": 0,
                                },
                                "categories": [{"id": 353, "name": "Ron"}],
                                "images": [],
                                "is_in_stock": True,
                            },
                            {
                                "id": 20001,
                                "name": "Aceite Premier Girasol 1000 ml",
                                "sku": "7701018012345",
                                "permalink": "https://supermercadobelalcazar.com.co/producto/aceite-premier/",
                                "prices": {
                                    "price": "15900",
                                    "regular_price": "18900",
                                    "sale_price": "15900",
                                    "currency_minor_unit": 0,
                                },
                                "categories": [{"id": 98, "name": "Aceites"}],
                                "images": [{"src": "https://supermercadobelalcazar.com.co/img/aceite.jpg"}],
                                "is_in_stock": True,
                            },
                        ],
                    )
                return httpx.Response(
                    200,
                    headers={"X-WP-TotalPages": "2"},
                    json=[
                        {
                            "id": 20002,
                            "name": "Huevo Rojo AA Belalcazar x 30 und",
                            "sku": "INT-99",
                            "permalink": "https://supermercadobelalcazar.com.co/producto/huevos/",
                            "prices": {
                                "price": "17500",
                                "regular_price": "17500",
                                "sale_price": "17500",
                                "currency_minor_unit": 0,
                            },
                            "categories": [{"id": 84, "name": "Canasta familiar"}],
                            "images": [],
                            "is_in_stock": False,
                        }
                    ],
                )
            return httpx.Response(404)

        cfg = default_belalcazar_config(requests_per_second=50.0)
        async with httpx.AsyncClient(
            base_url=cfg.base_url,
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = BelalcazarScraper(cfg, client=client)
            products = await scraper.scrape_all()

        self.assertEqual(len(products), 2)
        aceite, huevo = products
        self.assertEqual(aceite.store_id, "belalcazar")
        self.assertEqual(aceite.external_sku, "20001")
        self.assertEqual(aceite.ean, "7701018012345")
        self.assertEqual(aceite.raw_list_price, Decimal("18900.00"))
        self.assertEqual(aceite.raw_sale_price, Decimal("15900.00"))
        self.assertEqual(aceite.category_path, ["Canasta familiar", "Aceites"])
        self.assertTrue(aceite.in_stock)

        self.assertEqual(huevo.external_sku, "20002")
        self.assertIsNone(huevo.ean)
        self.assertTrue(huevo.is_private_label)
        self.assertFalse(huevo.in_stock)


if __name__ == "__main__":
    unittest.main()
