"""Pruebas unitarias para el conector Más x Menos (`mxm.com.co`)."""

from __future__ import annotations

import unittest
from decimal import Decimal

import httpx

from etl.core.grocery_filter import evaluate_category_path_whitelist
from etl.scrapers.mxm_scraper import MxmScraper, default_mxm_config


class MxmWhitelistTests(unittest.TestCase):
    def test_mxm_mixed_parent_categories_follow_whitelist(self) -> None:
        self.assertEqual(
            evaluate_category_path_whitelist(["Salud Y Belleza", "Salud Oral"])[0],
            "ALLOW",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["Salud Y Belleza", "Cuidado De Bebes"])[0],
            "ALLOW",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["Licores y cigarrillos", "Vinos"])[0],
            "DENY",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["Mascotas", "Accesorios"])[0],
            "DENY",
        )


class MxmScraperAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_mxm_discovers_categories_paginates_promos_and_presentations(self) -> None:
        requested_paths: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested_paths.append(f"{request.url.path}?{request.url.query.decode('utf-8')}")
            if request.url.path == "/api/invitado/3/categorias":
                return httpx.Response(
                    200,
                    json={
                        "categorias": [
                            {"id": 0, "nombre": "Todos"},
                            {
                                "id": 9108,
                                "nombre": "Despensa",
                                "subCategorias": [{"id": 9110, "nombre": "Harinas"}],
                            },
                            {
                                "id": 273,
                                "nombre": "Licores y cigarrillos",
                                "subCategorias": [{"id": 4322, "nombre": "Ron"}],
                            },
                            {
                                "id": 9338,
                                "nombre": "VENTA INSTITUCIONAL",
                                "subCategorias": [{"id": 9339, "nombre": "Venta Institucional"}],
                            },
                        ]
                    },
                )
            if request.url.path == "/api/invitado/9110/categorias-productos":
                page = int(request.url.params.get("page", "1"))
                if page == 1:
                    return httpx.Response(
                        200,
                        json={
                            "productos": {
                                "current_page": 1,
                                "last_page": 2,
                                "data": [
                                    {
                                        "id_producto": 7968,
                                        "nombre": "Harina de maiz blanco  MxM",
                                        "presentacion": "1000 gr",
                                        "precio": "2750.000",
                                        "compra_maxima": 0,
                                        "cantidad": "50.000",
                                        "imagen": "https://storage.googleapis.com/mxm-2022/7968.png",
                                        "promocion": 1,
                                        "data_promocion": {"promo_valor": "2300.000"},
                                    }
                                ],
                            }
                        },
                    )
                return httpx.Response(
                    200,
                    json={
                        "productos": {
                            "current_page": 2,
                            "last_page": 2,
                            "data": [
                                {
                                    "id_producto": 10465,
                                    "nombre": "Arroz 10 Roa x2500 Grm",
                                    "presentacion": "2500 Grm",
                                    "precio": "12500.000",
                                    "compra_maxima": 10,
                                    "cantidad": "12.000",
                                    "imagenes": ["https://storage.googleapis.com/mxm-2022/10465.png"],
                                    "promocion": 0,
                                    "data_promocion": {},
                                }
                            ],
                        }
                    },
                )
            return httpx.Response(404)

        cfg = default_mxm_config(requests_per_second=50.0)
        async with httpx.AsyncClient(
            base_url=cfg.base_url,
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = MxmScraper(cfg, client=client, store_ids=(3,))
            products = await scraper.scrape_all()

        self.assertFalse(any("/4322/" in p for p in requested_paths))
        self.assertFalse(any("/9339/" in p for p in requested_paths))
        self.assertEqual(len(products), 2)

        p1, p2 = products
        self.assertEqual(p1.store_id, "mxm")
        self.assertEqual(p1.external_sku, "7968")
        self.assertEqual(p1.raw_name, "Harina de maiz blanco MxM 1000 gr")
        self.assertEqual(p1.net_content, Decimal("1000.00"))
        self.assertEqual(p1.unit_measure.value, "g")
        self.assertEqual(p1.raw_list_price, Decimal("2750.00"))
        self.assertEqual(p1.raw_sale_price, Decimal("2300.00"))
        self.assertTrue(p1.in_stock)
        self.assertTrue(p1.is_private_label)
        self.assertEqual(p1.category_path, ["Despensa", "Harinas"])

        self.assertEqual(p2.raw_name, "Arroz 10 Roa x2500 Grm")
        self.assertEqual(p2.net_content, Decimal("2500.00"))
        self.assertEqual(p2.canonical_category_slug, "arroz-blanco-1000g")


if __name__ == "__main__":
    unittest.main()
