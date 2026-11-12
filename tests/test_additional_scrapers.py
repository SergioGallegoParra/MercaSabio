"""Pruebas unitarias para D1 (GraphQL), Ara (API + PDF), Alkosto/Ktronix (Hybris) y Rappi."""

from __future__ import annotations

import io
import json
import unittest
from decimal import Decimal

import httpx

from etl.core.canonical_mapper import infer_canonical_category_slug
from etl.core.models import UnitMeasure
from etl.scrapers.ara_scraper import AraScraper, default_ara_config
from etl.scrapers.d1_scraper import D1Scraper, build_vtex_segment_cookie, default_d1_config
from etl.scrapers.hybris_scraper import HybrisScraper
from etl.scrapers.rappi_scraper import RappiScraper, default_rappi_config


def _build_pdf_bytes(lines: list[str]) -> bytes:
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 760
    for line in lines:
        c.drawString(50, y, line)
        y -= 24
    c.save()
    return buf.getvalue()


class AdditionalScrapersTests(unittest.IsolatedAsyncioTestCase):
    async def test_d1_graphql_sends_vtex_segment_cookie_and_marks_private_label(self) -> None:
        captured_cookies: list[str] = []
        segment = build_vtex_segment_cookie(postal_code="110111")

        def handler(request: httpx.Request) -> httpx.Response:
            captured_cookies.append(request.headers.get("Cookie", ""))
            body = json.loads(request.content.decode("utf-8"))
            self.assertIn("productSearch", body["query"])
            return httpx.Response(
                200,
                json={
                    "data": {
                        "productSearch": {
                            "recordsFiltered": 1,
                            "products": [
                                {
                                    "productId": "d1-100",
                                    "productName": "Leche Entera Latti 1000 ml",
                                    "brand": "Latti",
                                    "link": "/leche-entera-latti-1000ml/p",
                                    "categories": ["/Lácteos/"],
                                    "items": [
                                        {
                                            "itemId": "sku-latti-1000",
                                            "name": "1000 ml",
                                            "nameComplete": "Leche Entera Latti 1000 ml",
                                            "ean": None,
                                            "measurementUnit": "ml",
                                            "unitMultiplier": 1000,
                                            "images": [],
                                            "sellers": [
                                                {
                                                    "sellerId": "1",
                                                    "commertialOffer": {
                                                        "Price": 3290,
                                                        "ListPrice": 3290,
                                                        "AvailableQuantity": 15,
                                                        "IsAvailable": True,
                                                    },
                                                }
                                            ],
                                        }
                                    ],
                                }
                            ],
                        }
                    }
                },
            )

        cfg = default_d1_config(requests_per_second=50.0)
        async with httpx.AsyncClient(base_url=cfg.base_url, transport=httpx.MockTransport(handler)) as client:
            scraper = D1Scraper(cfg, client=client, vtex_segment=segment)
            products = await scraper.scrape_all()

        self.assertEqual(len(products), 1)
        self.assertIn(f"vtex_segment={segment}", captured_cookies[0])
        self.assertTrue(products[0].is_private_label)
        self.assertEqual(products[0].canonical_category_slug, "leche-entera-1000ml")
        self.assertEqual(products[0].pum_price, Decimal("3.2900"))

    async def test_ara_extracts_both_json_api_and_pdf_brochure(self) -> None:
        pdf_bytes = _build_pdf_bytes(
            [
                "Arroz Blanco El Cultivo 1000 g $3.790",
                "Aceite Vegetal Loma Blanca 900 ml Antes $11.500 Ahora $9.900",
            ]
        )

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/app/catalog":
                return httpx.Response(
                    200,
                    json={
                        "products": [
                            {
                                "sku": "ara-api-1",
                                "name": "Café Molido De La Cuesta 500 g",
                                "brand": "De la Cuesta",
                                "sale_price": 11900,
                                "list_price": 12900,
                            }
                        ]
                    },
                )
            if request.url.path == "/folletos/semana.pdf":
                return httpx.Response(200, content=pdf_bytes, headers={"Content-Type": "application/pdf"})
            return httpx.Response(404)

        cfg = default_ara_config(requests_per_second=50.0)
        async with httpx.AsyncClient(base_url=cfg.base_url, transport=httpx.MockTransport(handler)) as client:
            scraper = AraScraper(
                cfg,
                client=client,
                api_endpoints=["/api/app/catalog"],
                pdf_urls=["/folletos/semana.pdf"],
            )
            products = await scraper.scrape_all()

        self.assertEqual(len(products), 3)
        api_item = products[0]
        self.assertEqual(api_item.source_origin, "ara_api")
        self.assertEqual(api_item.canonical_category_slug, "cafe-molido-500g")
        self.assertTrue(api_item.is_private_label)

        pdf_items = products[1:]
        self.assertEqual(pdf_items[0].source_origin, "pdf_folleto")
        self.assertEqual(pdf_items[0].raw_sale_price, Decimal("3790.00"))
        self.assertEqual(pdf_items[0].canonical_category_slug, "arroz-blanco-1000g")
        self.assertEqual(pdf_items[1].raw_list_price, Decimal("11500.00"))
        self.assertEqual(pdf_items[1].raw_sale_price, Decimal("9900.00"))
        self.assertEqual(pdf_items[1].canonical_category_slug, "aceite-vegetal-900ml")

    async def test_hybris_scraper_paginates_alkosto_occ(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            page = int(request.url.params.get("currentPage", "0"))
            if page == 0:
                return httpx.Response(
                    200,
                    json={
                        "pagination": {"currentPage": 0, "totalPages": 2},
                        "products": [
                            {
                                "code": "alk-1",
                                "name": "Aceite Girasol Premier 900 ml",
                                "manufacturer": "Premier",
                                "ean": "7702001009991",
                                "price": {"value": 12900},
                                "wasPrice": {"value": 14500},
                                "stock": {"stockLevelStatus": "inStock"},
                                "url": "/aceite-premier/p/alk-1",
                            }
                        ],
                    },
                )
            return httpx.Response(
                200,
                json={
                    "pagination": {"currentPage": 1, "totalPages": 2},
                    "products": [
                        {
                            "code": "alk-2",
                            "name": "Arroz Diana 1000 g",
                            "manufacturer": "Diana",
                            "price": {"value": 4600},
                            "stock": {"stockLevelStatus": "outOfStock"},
                        }
                    ],
                },
            )

        async with httpx.AsyncClient(
            base_url="https://www.alkosto.com",
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = HybrisScraper.for_store("alkosto", client=client, requests_per_second=50.0)
            products = await scraper.scrape_all()

        self.assertEqual(len(products), 2)
        self.assertEqual(products[0].raw_list_price, Decimal("14500.00"))
        self.assertTrue(products[0].in_stock)
        self.assertFalse(products[1].in_stock)

    async def test_rappi_acquires_guest_token_and_applies_calibration(self) -> None:
        seen_auth: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/auth/guest":
                return httpx.Response(200, json={"access_token": "guest-jwt-123"})
            seen_auth.append(request.headers.get("Authorization", ""))
            return httpx.Response(
                200,
                json={
                    "products": [
                        {
                            "id": "rap-1",
                            "name": "Arroz Blanco Roa 1000 g",
                            "trademark": "Roa",
                            "ean": "7702001007777",
                            "real_price": 5250,
                            "price": 5500,
                            "in_stock": True,
                        }
                    ]
                },
            )

        cfg = default_rappi_config(requests_per_second=50.0, markup_discount_factor=Decimal("0.9000"))
        async with httpx.AsyncClient(base_url=cfg.base_url, transport=httpx.MockTransport(handler)) as client:
            scraper = RappiScraper(cfg, client=client, corridor_ids=["despensa"])
            products = await scraper.scrape_all()

        self.assertEqual(seen_auth, ["Bearer guest-jwt-123"])
        self.assertEqual(len(products), 1)
        # 5250 * 0.90 = 4725 -> ROUND(4725, -1) = 4730.00
        self.assertEqual(products[0].raw_sale_price, Decimal("5250.00"))
        self.assertEqual(products[0].calibrated_price, Decimal("4730.00"))
        self.assertEqual(products[0].pum_price, Decimal("4.7300"))

    def test_canonical_mapper_distinguishes_variants(self) -> None:
        self.assertEqual(
            infer_canonical_category_slug("arroz blanco diana 1000 g", Decimal("1000"), UnitMeasure.G),
            "arroz-blanco-1000g",
        )
        self.assertIsNone(
            infer_canonical_category_slug("arroz con leche alpina 200 g", Decimal("200"), UnitMeasure.G)
        )


if __name__ == "__main__":
    unittest.main()
