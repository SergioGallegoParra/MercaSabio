"""Pruebas unitarias e integración CDC para el detector de shrinkflation."""

from __future__ import annotations

import unittest
from decimal import Decimal

from etl.core.cdc_manager import CDCManager, InMemoryGateway
from etl.core.models import ScrapedProduct, UnitMeasure
from etl.core.normalizer import compute_pum
from etl.core.shrinkflation_detector import detect_shrinkflation


def _build_product(
    *,
    sku: str = "sku-arroz-1",
    ean: str = "7702001001234",
    raw_name: str = "Arroz Diana 1000 g",
    price: str = "5000.00",
    net_content: str = "1000.00",
    unit: UnitMeasure = UnitMeasure.G,
) -> ScrapedProduct:
    p = Decimal(price)
    n = Decimal(net_content)
    return ScrapedProduct(
        store_id="carulla",
        external_sku=sku,
        ean=ean,
        raw_name=raw_name,
        normalized_name=raw_name.lower(),
        brand="Diana",
        raw_list_price=p,
        raw_sale_price=p,
        calibrated_price=p,
        net_content=n,
        unit_measure=unit,
        pum_price=compute_pum(p, n),
        in_stock=True,
        source_origin="vtex_api",
    )


class ShrinkflationDetectorTests(unittest.IsolatedAsyncioTestCase):
    def test_detects_shrinkflation_when_content_drops_and_price_stays_flat(self) -> None:
        finding = detect_shrinkflation(
            master_product_id="mp-1",
            normalized_name="arroz blanco diana",
            previous_net_content=Decimal("1000.00"),
            current_net_content=Decimal("850.00"),
            previous_unit_measure="g",
            current_unit_measure=UnitMeasure.G,
            previous_price=Decimal("5000.00"),
            current_price=Decimal("5000.00"),
        )
        self.assertIsNotNone(finding)
        assert finding is not None
        self.assertEqual(finding.previous_net_content, Decimal("1000.00"))
        self.assertEqual(finding.current_net_content, Decimal("850.00"))
        self.assertEqual(finding.content_drop_pct, Decimal("15.00"))
        self.assertEqual(finding.hidden_inflation_pct, Decimal("17.65"))

    def test_ignores_when_price_drops_more_than_content(self) -> None:
        finding = detect_shrinkflation(
            master_product_id="mp-2",
            normalized_name="arroz blanco",
            previous_net_content=Decimal("1000.00"),
            current_net_content=Decimal("800.00"),
            previous_unit_measure="g",
            current_unit_measure="g",
            previous_price=Decimal("5000.00"),
            current_price=Decimal("3200.00"),  # PUM baja de 5.0 a 4.0
        )
        self.assertIsNone(finding)

    def test_ignores_unit_mismatch_and_minor_rounding_jitter(self) -> None:
        self.assertIsNone(
            detect_shrinkflation(
                master_product_id="mp-3",
                normalized_name="bebida",
                previous_net_content=Decimal("1000.00"),
                current_net_content=Decimal("500.00"),
                previous_unit_measure="ml",
                current_unit_measure="g",
                previous_price=Decimal("4000.00"),
                current_price=Decimal("4000.00"),
            )
        )
        self.assertIsNone(
            detect_shrinkflation(
                master_product_id="mp-4",
                normalized_name="galletas",
                previous_net_content=Decimal("1000.00"),
                current_net_content=Decimal("995.00"),  # 0.5% < 1%
                previous_unit_measure="g",
                current_unit_measure="g",
                previous_price=Decimal("4000.00"),
                current_price=Decimal("4000.00"),
            )
        )

    async def test_cdc_flags_shrinkflation_on_master_product(self) -> None:
        gateway = InMemoryGateway()
        cdc_initial = CDCManager(gateway, "carulla")
        await cdc_initial.process_batch([_build_product(net_content="1000.00", price="5000.00")])

        cdc_next = CDCManager(gateway, "carulla")
        stats = await cdc_next.process_batch(
            [
                _build_product(
                    raw_name="Arroz Diana 850 g",
                    net_content="850.00",
                    price="5000.00",
                )
            ]
        )

        self.assertEqual(stats.shrinkflation_alerts, 1)
        self.assertEqual(stats.price_or_stock_changes, 1)
        self.assertEqual(len(gateway.price_records), 2)

        master = next(iter(gateway.master_products.values()))
        self.assertTrue(master["shrinkflation_alert"])
        self.assertEqual(str(master["previous_net_content"]), "1000.00")
        self.assertEqual(str(master["net_content"]), "850.00")
