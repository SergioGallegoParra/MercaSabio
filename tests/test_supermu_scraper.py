"""Pruebas unitarias para el conector Shopify de Supermú (`www.supermu.com`)."""

from __future__ import annotations

import unittest
from decimal import Decimal

import httpx

from etl.scrapers.supermu_scraper import SupermuScraper, default_supermu_config


class SupermuScraperTests(unittest.IsolatedAsyncioTestCase):
    async def test_supermu_paginates_filters_noise_tags_and_resolves_promos_and_grams(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/products.json")
            page = int(request.url.params.get("page", "1"))
            if page == 1:
                return httpx.Response(
                    200,
                    json={
                        "products": [
                            {
                                "id": 1001,
                                "title": "JABON LIQ PALMOLIVE 390ML DURAZNO & MANG",
                                "handle": "jabon-liq-palmolive-390ml-durazno-mang",
                                "vendor": "COLGATE PALMOLIVE",
                                "product_type": "",
                                "tags": [
                                    "APLICA PARA ECOMMERCE",
                                    "ASEO",
                                    "ASEO PERSONAL",
                                    "BELLEZA Y CUIDADO PERSONAL",
                                    "CUIDADO CORPORAL JABON",
                                ],
                                "images": [{"src": "https://cdn.shopify.com/palmolive.webp"}],
                                "variants": [
                                    {
                                        "id": 2001,
                                        "title": "Default Title",
                                        "sku": "001122",
                                        "price": "12900.00",
                                        "compare_at_price": "15900.00",
                                        "grams": 0,
                                        "available": True,
                                        "barcode": "7702010012345",
                                    }
                                ],
                            },
                            {
                                "id": 1002,
                                "title": "PEPINO CALABAZIN",
                                "handle": "pepino-calabazin",
                                "vendor": "SUPERMU",
                                "product_type": "Frutas y verduras",
                                "tags": ["FRUTAS Y VERDURAS", "VERDURAS"],
                                "images": [{"src": "https://cdn.shopify.com/pepino.webp"}],
                                "variants": [
                                    {
                                        "id": 2002,
                                        "title": "Default Title",
                                        "sku": "035761",
                                        "price": "4200.00",
                                        "compare_at_price": None,
                                        "grams": 600,
                                        "available": True,
                                        "barcode": "",
                                    }
                                ],
                            },
                            {
                                "id": 1003,
                                "title": "CERVEZA KAUFMANN 6U 1860ML LATA",
                                "handle": "cerveza-kaufmann-6u",
                                "vendor": "KOOPS",
                                "product_type": "",
                                "tags": ["BEBIDAS ALCOHOLICAS", "BEBIDAS ALCOHOLICAS CERVEZAS"],
                                "variants": [
                                    {
                                        "id": 2003,
                                        "sku": "009999",
                                        "price": "24000.00",
                                        "grams": 0,
                                        "available": True,
                                    }
                                ],
                            },
                            {
                                "id": 1004,
                                "title": "CARRO A FRICCIÓN CRAZY CLIMB",
                                "handle": "carro-friccion",
                                "vendor": "GENERICO",
                                "product_type": "",
                                "tags": ["JUGUETE"],
                                "variants": [
                                    {
                                        "id": 2004,
                                        "sku": "008888",
                                        "price": "19000.00",
                                        "grams": 0,
                                        "available": True,
                                    }
                                ],
                            },
                            {
                                "id": 1005,
                                "title": "CREMA PONDS CLARANT B3 POTE X50G",
                                "handle": "crema-ponds-clarant-50g",
                                "vendor": "PONDS",
                                "product_type": "",
                                "tags": ["CUIDADO FACIAL", "DERMOCOSMETICA", "PONDS"],
                                "variants": [
                                    {
                                        "id": 2005,
                                        "sku": "007777",
                                        "price": "28000.00",
                                        "grams": 50,
                                        "available": True,
                                    }
                                ],
                            },
                        ]
                    },
                )
            return httpx.Response(200, json={"products": []})

        cfg = default_supermu_config(requests_per_second=50.0)
        async with httpx.AsyncClient(
            base_url=cfg.base_url,
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = SupermuScraper(cfg, client=client)
            products = await scraper.scrape_all()

        self.assertEqual(len(products), 2)

        jabon, pepino = products
        self.assertEqual(jabon.store_id, "supermu")
        self.assertEqual(jabon.external_sku, "001122")
        self.assertEqual(jabon.ean, "7702010012345")
        self.assertEqual(jabon.raw_list_price, Decimal("15900.00"))
        self.assertEqual(jabon.raw_sale_price, Decimal("12900.00"))
        self.assertEqual(jabon.net_content, Decimal("390.00"))
        self.assertEqual(jabon.unit_measure.value, "ml")
        self.assertIn("ASEO PERSONAL", jabon.category_path)

        self.assertEqual(pepino.external_sku, "035761")
        self.assertEqual(pepino.net_content, Decimal("600.00"))
        self.assertEqual(pepino.unit_measure.value, "g")
        self.assertTrue(pepino.is_private_label)


if __name__ == "__main__":
    unittest.main()
