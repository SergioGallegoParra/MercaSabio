"""Pruebas unitarias para el conector REST Waco de Mercamio (`mercamio.com`)."""

from __future__ import annotations

import unittest
from decimal import Decimal

import httpx

from etl.core.grocery_filter import evaluate_category_path_whitelist
from etl.scrapers.mercamio_scraper import MercamioScraper, default_mercamio_config


class MercamioWhitelistTests(unittest.TestCase):
    def test_mercamio_alinos_and_complementos_infantiles_are_allowed(self) -> None:
        self.assertEqual(evaluate_category_path_whitelist(["Aliños"])[0], "ALLOW")
        self.assertEqual(
            evaluate_category_path_whitelist(["Complementos Infantiles"])[0],
            "ALLOW",
        )
        self.assertEqual(evaluate_category_path_whitelist(["Licores"])[0], "DENY")
        self.assertEqual(evaluate_category_path_whitelist(["Botiquín"])[0], "DENY")


class MercamioScraperAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_mercamio_fetches_offices_filters_categories_and_paginates(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.headers.get("x-business"), "mercamio")
            if request.url.path == "/api/v2/offices":
                return httpx.Response(
                    200,
                    json={
                        "offices": [
                            {"id": "off-bog", "city": "Bogota", "name": "Bogota"},
                            {"id": "off-cali", "city": "Cali", "name": "Ciudad Jardin"},
                        ]
                    },
                )
            if request.url.path == "/api/v2/categories":
                self.assertEqual(request.url.params.get("branch_id"), "off-cali")
                return httpx.Response(
                    200,
                    json={
                        "data": {
                            "items": [
                                {"id": "cat-granos", "categoryName": "Granos", "inactive": False},
                                {"id": "cat-alinos", "categoryName": "Aliños", "inactive": False},
                                {"id": "cat-licores", "categoryName": "Licores", "inactive": False},
                                {"id": "cat-mascotas", "categoryName": "Mascotas", "inactive": False},
                            ]
                        }
                    },
                )
            if request.url.path == "/api/v1/products/all_paginate":
                self.assertEqual(request.headers.get("x-office"), "off-cali")
                page = int(request.url.params.get("page", "0"))
                if page == 0:
                    return httpx.Response(
                        200,
                        json={
                            "data": {
                                "pagination": {"page": 0, "totalPages": 2},
                                "list": [
                                    {
                                        "id": "p1",
                                        "id_item": "077089",
                                        "title": "Arroz Balmoral Super Premium",
                                        "subTitle": "1000 gr",
                                        "brand": "BALMORAL",
                                        "bar_code": "7707059300404",
                                        "category_id": "cat-granos",
                                        "photoUrl": "https://storage.googleapis.com/waco/077089.jpg",
                                        "stock_branch_offices": [
                                            {
                                                "id": "off-cali",
                                                "price": 10200,
                                                "price_neto": 8160,
                                                "discount": 20,
                                                "quantity_pum": 1000,
                                                "stock": 10,
                                            }
                                        ],
                                    },
                                    {
                                        "id": "p-whisky",
                                        "id_item": "099001",
                                        "title": "Whisky Old Parr 750ml",
                                        "category_id": "cat-licores",
                                        "stock_branch_offices": [
                                            {"id": "off-cali", "price": 120000, "price_neto": 120000, "stock": 5}
                                        ],
                                    },
                                    {
                                        "id": "p-pet-acc",
                                        "id_item": "099002",
                                        "title": "Collar Nylon Perro",
                                        "category_id": "cat-mascotas",
                                        "tags": ["Mascotas accesorios"],
                                        "stock_branch_offices": [
                                            {"id": "off-cali", "price": 18000, "price_neto": 18000, "stock": 5}
                                        ],
                                    },
                                ],
                            }
                        },
                    )
                return httpx.Response(
                    200,
                    json={
                        "data": {
                            "pagination": {"page": 1, "totalPages": 2},
                            "list": [
                                {
                                    "id": "p2",
                                    "id_item": "005128",
                                    "title": "Comino Molido El Rey",
                                    "subTitle": "Sobre",
                                    "brand": "XXXXXXXXXXXXX",
                                    "bar_code": "7702001002003",
                                    "category_id": "cat-alinos",
                                    "unit_measurement_pum": "g",
                                    "quantity_pum": 50,
                                    "photoUrl": "https://storage.googleapis.com/waco/005128.jpg",
                                    "stock_branch_offices": [
                                        {
                                            "id": "off-cali",
                                            "price": 3200,
                                            "price_neto": 3200,
                                            "discount": 0,
                                            "quantity_pum": 50,
                                            "stock": 4,
                                        }
                                    ],
                                }
                            ],
                        }
                    },
                )
            return httpx.Response(404)

        cfg = default_mercamio_config(requests_per_second=50.0)
        async with httpx.AsyncClient(
            base_url=cfg.base_url,
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = MercamioScraper(cfg, client=client)
            products = await scraper.scrape_all()

        self.assertEqual(len(products), 2)
        arroz, comino = products
        self.assertEqual(arroz.store_id, "mercamio")
        self.assertEqual(arroz.external_sku, "077089")
        self.assertEqual(arroz.ean, "7707059300404")
        self.assertEqual(arroz.raw_name, "Arroz Balmoral Super Premium 1000 gr")
        self.assertEqual(arroz.raw_list_price, Decimal("10200.00"))
        self.assertEqual(arroz.raw_sale_price, Decimal("8160.00"))
        self.assertEqual(arroz.net_content, Decimal("1000.00"))
        self.assertEqual(arroz.unit_measure.value, "g")
        self.assertEqual(arroz.category_path, ["Granos"])

        self.assertIsNone(comino.brand)
        self.assertEqual(comino.net_content, Decimal("50.00"))
        self.assertEqual(comino.category_path, ["Aliños"])


if __name__ == "__main__":
    unittest.main()
