"""Pruebas unitarias para el conector de Tiendas Ísimo (`etl.scrapers.isimo_scraper`)."""

from __future__ import annotations

import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

import httpx

from etl.core.cdc_manager import InMemoryGateway
from etl.scrapers.isimo_scraper import (
    IsimoRappiScraper,
    RappiPromoObservation,
    compute_verified_rappi_discount,
    default_isimo_config,
    parse_rappi_dom_item,
    sync_isimo_rappi_discounts_gateway,
)


class IsimoScraperTests(unittest.IsolatedAsyncioTestCase):
    def test_parse_rappi_dom_item_variants(self) -> None:
        disc = parse_rappi_dom_item(
            "$ 4.990$ 5.550 10% ($9.98/g) Savoria Salsa de Tomate 1 x 500 g",
            item_id="6843590",
            image_url="https://images.rappi.com/products/salsa.png",
            section="despensa/condimentos-y-salsas",
        )
        self.assertIsNotNone(disc)
        assert disc is not None
        item_dict, promo = disc
        self.assertEqual(item_dict["master_product_id"], "6843590")
        self.assertEqual(item_dict["real_price"], "5550.00")
        self.assertEqual(promo, Decimal("4990.00"))
        self.assertEqual(item_dict["name"], "Savoria Salsa de Tomate 1 x 500 g")

        reg = parse_rappi_dom_item(
            "Sin azúcar | $ 7.690 | ($23.31/g) | Pure Valley Yogurt Griego Azúcar 0% | 1 x 330 g",
            item_id="6843661",
            image_url="https://images.rappi.com/products/yogurt.png",
            section="lacteos-y-refrigerados/yogurt-y-bebidas-lacteas",
        )
        self.assertIsNotNone(reg)
        assert reg is not None
        self.assertIsNone(reg[1])
        self.assertEqual(reg[0]["real_price"], "7690.00")

        combo = parse_rappi_dom_item(
            "$ 73.330 Combo ($73330/combo) Combo Antioqueño + Coronita",
            item_id="combo_0",
            image_url="https://images.rappi.com/products/combo.png",
            section="combos",
        )
        self.assertIsNotNone(combo)
        assert combo is not None
        self.assertTrue(combo[0]["is_combo"])
        self.assertEqual(combo[0]["real_price"], "73330.00")

        # Descarta nodos concatenados
        self.assertIsNone(parse_rappi_dom_item("$ 1.000 ($10/g) " + ("A " * 140)))

    def test_verified_rappi_discount_validates_against_historical_standard(self) -> None:
        # Descuento real frente a estándar actual y sin histórico
        res = compute_verified_rappi_discount(
            current_standard_price=Decimal("3390.00"),
            historical_standard_price=None,
            rappi_promo_price=Decimal("3090.00"),
        )
        self.assertIsNotNone(res)
        assert res is not None
        self.assertEqual(res[0], Decimal("3390.00"))
        self.assertEqual(res[1], Decimal("300.00"))
        self.assertEqual(res[2], Decimal("8.85"))

        # Descuento ficticio: Rappi sube real_price a 4000 y vende a 3500 cuando nuestro histórico estándar era 3390
        fake = compute_verified_rappi_discount(
            current_standard_price=Decimal("4000.00"),
            historical_standard_price=Decimal("3390.00"),
            rappi_promo_price=Decimal("3500.00"),
        )
        self.assertIsNone(fake)

    async def test_merges_ssr_and_browser_snapshots_keeping_standard_price(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            ssr_path = tmp / "ssr.json"
            browser_path = tmp / "browser.json"

            ssr_path.write_text(
                json.dumps(
                    [
                        {
                            "id": "900468086_2125808695",
                            "product_id": "2125808695",
                            "master_product_id": 5462969,
                            "name": "Leche Entera Uht - Lele",
                            "description": "Leche Entera UHT - Lele x 900 ml",
                            "real_price": 3390,
                            "price": 3090,
                            "unit_type": "ml",
                            "quantity": 900,
                            "image_url": "https://images.rappi.com/products/lele.webp",
                            "category_name": "Leche natural",
                            "trademark": "Lele",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            browser_path.write_text(
                json.dumps(
                    [
                        {
                            # Duplicado con el SSR por master_product_id: debe omitirse
                            "section": "lacteos-y-refrigerados/yogurt-y-bebidas-lacteas",
                            "id": "5462969",
                            "img": "https://images.rappi.com/products/lele.webp",
                            "raw": "$ 3.090$ 3.390 8% ($3.44/ml) Leche Entera Uht - Lele 900 ml",
                        },
                        {
                            # Nuevo ítem paginado (>24) capturado en navegador con descuento real
                            "section": "despensa/condimentos-y-salsas",
                            "id": "6843590",
                            "img": "https://images.rappi.com/products/savoria.png",
                            "raw": "$ 4.990$ 5.550 10% ($9.98/g) Savoria Salsa de Tomate 1 x 500 g",
                        },
                    ]
                ),
                encoding="utf-8",
            )

            def fail_handler(_req: httpx.Request) -> httpx.Response:
                return httpx.Response(404)

            cfg = default_isimo_config(requests_per_second=50.0)
            async with httpx.AsyncClient(
                base_url=cfg.base_url,
                transport=httpx.MockTransport(fail_handler),
            ) as client:
                scraper = IsimoRappiScraper(
                    cfg,
                    client=client,
                    ssr_snapshot_path=ssr_path,
                    browser_snapshot_path=browser_path,
                    fetch_live_ssr=False,
                )
                products = await scraper.scrape_all()

            self.assertEqual(len(products), 2)
            lele = next(p for p in products if p.external_sku == "isimo-5462969")
            salsa = next(p for p in products if p.external_sku == "isimo-6843590")

            # Regla 1: precio subido es el estándar sin descuento
            self.assertEqual(lele.raw_sale_price, Decimal("3390.00"))
            self.assertEqual(lele.calibrated_price, Decimal("3390.00"))
            self.assertEqual(lele.source_origin, "rappi_isimo")
            self.assertEqual(salsa.raw_sale_price, Decimal("5550.00"))

            # Regla 2: promos Rappi registradas aparte para mostrar ahorro en la web
            self.assertEqual(scraper.rappi_promos_by_sku["isimo-5462969"].promo_price, Decimal("3090.00"))
            self.assertEqual(scraper.rappi_promos_by_sku["isimo-6843590"].promo_price, Decimal("4990.00"))

    async def test_sync_isimo_rappi_discounts_gateway_updates_and_clears(self) -> None:
        gateway = InMemoryGateway()
        gateway.store_skus[("isimo", "isimo-5462969")] = {
            "id": "sku-1",
            "store_id": "isimo",
            "external_sku": "isimo-5462969",
            "master_product_id": "mp-1",
        }
        gateway.store_skus[("isimo", "isimo-999")] = {
            "id": "sku-2",
            "store_id": "isimo",
            "external_sku": "isimo-999",
            "master_product_id": "mp-2",
        }
        gateway.master_products["mp-1"] = {
            "normalized_name": "leche entera uht lele",
            "net_content": "900",
            "unit_measure": "ml",
        }
        gateway.master_products["mp-2"] = {
            "normalized_name": "arroz blanco 1000g",
            "net_content": "1000",
            "unit_measure": "g",
        }
        gateway.price_records.append(
            {
                "store_sku_id": "sku-1",
                "raw_sale_price": "3390.00",
                "calibrated_price": "3390.00",
                "pum_price": "3.7667",
                "in_stock": True,
            }
        )
        gateway.price_records.append(
            {
                "store_sku_id": "sku-2",
                "raw_sale_price": "4100.00",
                "calibrated_price": "4100.00",
                "pum_price": "4.1000",
                "in_stock": True,
            }
        )

        recorded_ops: list[dict[str, object]] = []

        class _FakeQuery:
            def __init__(self) -> None:
                self._payload: dict[str, object] = {}
                self._filters: list[tuple[str, object]] = []

            def table(self, name: str) -> "_FakeQuery":
                self._table = name
                return self

            def update(self, payload: dict[str, object]) -> "_FakeQuery":
                self._payload = payload
                return self

            def eq(self, col: str, val: object) -> "_FakeQuery":
                self._filters.append((col, val))
                return self

            def in_(self, col: str, vals: object) -> "_FakeQuery":
                self._filters.append((col, vals))
                return self

            def execute(self) -> object:
                recorded_ops.append({"payload": self._payload, "filters": self._filters})
                return type("Resp", (), {"data": []})()

        class _GatewayWithExec:
            def __init__(self, inner: InMemoryGateway) -> None:
                self._inner = inner

            async def fetch_store_skus(self, store_id: str) -> list[dict[str, object]]:
                return await self._inner.fetch_store_skus(store_id)

            async def fetch_latest_prices(self, store_id: str) -> list[dict[str, object]]:
                return await self._inner.fetch_latest_prices(store_id)

            async def _execute(self, fn):
                return fn(_FakeQuery())

        promos = {
            "isimo-5462969": RappiPromoObservation(
                external_sku="isimo-5462969",
                standard_price=Decimal("3390.00"),
                promo_price=Decimal("3090.00"),
                promo_url="https://www.rappi.com.co/tiendas/900468086-isimo-mt-nc/catalogo",
            )
        }
        stats = await sync_isimo_rappi_discounts_gateway(promos, _GatewayWithExec(gateway))
        self.assertEqual(
            stats,
            {
                "total_isimo_skus": 2,
                "verified_rappi_discounts": 1,
                "cleared_non_discounted": 1,
            },
        )
        self.assertEqual(len(recorded_ops), 2)
        clear_op, update_op = recorded_ops
        self.assertIsNone(clear_op["payload"]["rappi_promo_price"])  # type: ignore[index]
        self.assertEqual(update_op["payload"]["rappi_promo_price"], "3090.00")  # type: ignore[index]
        self.assertEqual(update_op["payload"]["rappi_savings_cop"], "300.00")  # type: ignore[index]


if __name__ == "__main__":
    unittest.main()
