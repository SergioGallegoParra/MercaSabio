"""Pruebas unitarias para el conector VTEX de Tiendas Metro Colombia."""

from __future__ import annotations

import unittest
from decimal import Decimal

import httpx

from etl.scrapers.vtex_scraper import VtexScraper


class MetroVtexScraperTests(unittest.IsolatedAsyncioTestCase):
    async def test_metro_for_store_scrapes_categories_and_private_labels(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/catalog_system/pub/category/tree/3":
                return httpx.Response(
                    200,
                    json=[
                        {
                            "id": 63,
                            "name": "Supermercado",
                            "children": [
                                {
                                    "id": 71,
                                    "name": "Despensa",
                                    "children": [
                                        {"id": 711, "name": "Arroz y granos", "children": []}
                                    ],
                                },
                                {
                                    "id": 507,
                                    "name": "Vinos y licores",
                                    "children": [{"id": 510, "name": "Whisky", "children": []}],
                                },
                            ],
                        },
                        {
                            "id": 2,
                            "name": "Juguetería",
                            "children": [{"id": 3, "name": "Muñecas", "children": []}],
                        },
                    ],
                )
            if request.url.path == "/api/catalog_system/pub/products/search":
                self.assertEqual(request.url.params.get("fq"), "C:/63/71/711/")
                return httpx.Response(
                    200,
                    json=[
                        {
                            "productId": "140189",
                            "productName": "Arroz Castellano premium jazmin x500g",
                            "brand": "CASTELLANO",
                            "link": "https://metrocolombiafood.vtexcommercestable.com.br/arroz-castellano/p",
                            "categories": ["/Supermercado/Despensa/Arroz y granos/"],
                            "items": [
                                {
                                    "itemId": "1401891",
                                    "ean": "7702511073889",
                                    "measurementUnit": "g",
                                    "unitMultiplier": 1,
                                    "images": [{"imageUrl": "https://img.example/arroz.jpg"}],
                                    "sellers": [
                                        {
                                            "sellerId": "1",
                                            "commertialOffer": {
                                                "Price": 6990.0,
                                                "ListPrice": 7990.0,
                                                "AvailableQuantity": 10,
                                                "IsAvailable": True,
                                            },
                                        }
                                    ],
                                }
                            ],
                        },
                        {
                            "productId": "55501",
                            "productName": "Arequipe Cuisine&Co x250g",
                            "brand": "CUISINE & CO NBE MP",
                            "link": "https://metrocolombiafood.vtexcommercestable.com.br/arequipe-cuisine/p",
                            "categories": ["/Supermercado/Dulces y postres/"],
                            "items": [
                                {
                                    "itemId": "555011",
                                    "ean": "7709999000111",
                                    "images": [],
                                    "sellers": [
                                        {
                                            "sellerId": "1",
                                            "commertialOffer": {
                                                "Price": 5200.0,
                                                "ListPrice": 5200.0,
                                                "AvailableQuantity": 5,
                                                "IsAvailable": True,
                                            },
                                        }
                                    ],
                                }
                            ],
                        },
                    ],
                )
            return httpx.Response(404)

        async with httpx.AsyncClient(
            base_url="https://metrocolombiafood.vtexcommercestable.com.br",
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = VtexScraper.for_store("metro", client=client, requests_per_second=50.0)
            products = await scraper.scrape_all()

        self.assertEqual(len(products), 2)
        arroz, arequipe = products
        self.assertEqual(arroz.store_id, "metro")
        self.assertEqual(arroz.ean, "7702511073889")
        self.assertEqual(arroz.raw_list_price, Decimal("7990.00"))
        self.assertEqual(arroz.raw_sale_price, Decimal("6990.00"))
        self.assertFalse(arroz.is_private_label)

        self.assertEqual(arequipe.external_sku, "555011")
        self.assertTrue(arequipe.is_private_label)


if __name__ == "__main__":
    unittest.main()
