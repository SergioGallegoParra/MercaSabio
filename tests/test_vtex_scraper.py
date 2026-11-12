"""Pruebas del conector VTEX para Éxito, Carulla y Olímpica."""

from __future__ import annotations

import unittest
from decimal import Decimal
from typing import Any

import httpx

from etl.core.models import UnitMeasure
from etl.scrapers.vtex_scraper import VTEX_PAGE_SIZE, VtexScraper


def _make_vtex_item(
    product_id: str,
    item_id: str,
    name: str,
    *,
    ean: str | None = "7702001001234",
    price: float = 4500.0,
    list_price: float = 5200.0,
    qty: int = 10,
    is_available: bool = True,
    measurement_unit: str = "un",
    unit_multiplier: float = 1.0,
) -> dict[str, Any]:
    return {
        "productId": product_id,
        "productName": name,
        "brand": "Diana",
        "link": f"/{product_id}/p",
        "categories": ["/Mercado/Despensa/Arroz/"],
        "items": [
            {
                "itemId": item_id,
                "name": name,
                "nameComplete": name,
                "ean": ean,
                "measurementUnit": measurement_unit,
                "unitMultiplier": unit_multiplier,
                "images": [{"imageUrl": f"https://img.example.com/{item_id}.jpg"}],
                "sellers": [
                    {
                        "sellerId": "1",
                        "commertialOffer": {
                            "Price": price,
                            "ListPrice": list_price,
                            "AvailableQuantity": qty,
                            "IsAvailable": is_available,
                        },
                    }
                ],
            }
        ],
    }


class VtexScraperTests(unittest.IsolatedAsyncioTestCase):
    async def test_category_tree_pagination_and_deduplication(self) -> None:
        calls: list[tuple[str, str]] = []
        tree_payload = [
            {
                "id": 1,
                "name": "Mercado",
                "children": [
                    {"id": 10, "name": "Granos", "children": []},
                    {"id": 11, "name": "Lácteos", "children": []},
                ],
            }
        ]
        # 50 productos en página 0 + 1 producto en página 1 (incluyendo SKU duplicado entre categorías)
        page0_cat10 = [
            _make_vtex_item(f"p{i}", f"sku-{i}", f"Arroz Diana {500 + i} g", ean=f"7702001000{i:03d}")
            for i in range(VTEX_PAGE_SIZE)
        ]
        page1_cat10 = [
            _make_vtex_item(
                "p50",
                "sku-50",
                "Leche Entera Alpina 1.1 L",
                ean="7702002000050",
                price=5500.0,
                list_price=5500.0,
            )
        ]
        cat11_items = [
            # Duplicado de sku-0 (debe deduplicarse) y un agotado sin EAN
            _make_vtex_item("p0", "sku-0", "Arroz Diana 500 g"),
            _make_vtex_item(
                "p99",
                "sku-99",
                "Aceite Vegetal Sin EAN",
                ean=None,
                price=0.0,
                list_price=0.0,
                qty=0,
                is_available=False,
                measurement_unit="ml",
                unit_multiplier=900.0,
            ),
        ]

        def handler(request: httpx.Request) -> httpx.Response:
            path = request.url.path
            calls.append((path, str(request.url.query)))
            if path.endswith("/category/tree/3"):
                return httpx.Response(200, json=tree_payload)
            fq = request.url.params.get("fq")
            from_idx = int(request.url.params.get("_from", "0"))
            if fq == "C:/1/10/":
                if from_idx == 0:
                    return httpx.Response(206, json=page0_cat10)
                return httpx.Response(200, json=page1_cat10)
            if fq == "C:/1/11/":
                return httpx.Response(200, json=cat11_items)
            return httpx.Response(200, json=[])

        async with httpx.AsyncClient(
            base_url="https://www.exito.com",
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = VtexScraper.for_store(
                "exito",
                client=client,
                requests_per_second=50.0,
                backoff_base_seconds=0.01,
            )
            products = await scraper.scrape_all()

        self.assertEqual(len(products), 52)
        by_sku = {p.external_sku: p for p in products}

        self.assertEqual(by_sku["sku-0"].ean, "7702001000000")
        self.assertEqual(by_sku["sku-0"].net_content, Decimal("500.00"))
        self.assertEqual(by_sku["sku-0"].unit_measure, UnitMeasure.G)
        self.assertEqual(by_sku["sku-0"].pum_price, Decimal("9.0000"))
        self.assertEqual(by_sku["sku-0"].raw_url, "https://www.exito.com/p0/p")

        self.assertEqual(by_sku["sku-50"].net_content, Decimal("1100.00"))
        self.assertEqual(by_sku["sku-50"].unit_measure, UnitMeasure.ML)
        self.assertEqual(by_sku["sku-50"].pum_price, Decimal("5.0000"))

        self.assertFalse(by_sku["sku-99"].in_stock)
        self.assertIsNone(by_sku["sku-99"].ean)
        self.assertEqual(by_sku["sku-99"].net_content, Decimal("900.00"))
        self.assertEqual(by_sku["sku-99"].unit_measure, UnitMeasure.ML)

    async def test_falls_back_to_global_search_when_category_tree_fails(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/category/tree/3"):
                return httpx.Response(404)
            return httpx.Response(
                200,
                json=[_make_vtex_item("p1", "sku-olimpica-1", "Azúcar 1 kg", price=4200.0)],
            )

        async with httpx.AsyncClient(
            base_url="https://www.olimpica.com",
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = VtexScraper.for_store("olimpica", client=client, requests_per_second=50.0)
            products = await scraper.scrape_all()

        self.assertEqual(len(products), 1)
        self.assertEqual(products[0].store_id, "olimpica")
        self.assertEqual(products[0].net_content, Decimal("1000.00"))
        self.assertEqual(products[0].pum_price, Decimal("4.2000"))


if __name__ == "__main__":
    unittest.main()
