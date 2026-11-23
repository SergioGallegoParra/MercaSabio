"""Pruebas para el gateway local SQLite (`LocalSqliteGateway`) y reporte de categorías."""

from __future__ import annotations

import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from etl.core.cdc_manager import CDCManager
from etl.core.local_gateway import LocalSqliteGateway
from etl.core.models import ScrapedProduct, UnitMeasure
from etl.export_store_categories_report import classify_category_segments, generate_report_files


def _sample_product(store_id: str, external_sku: str, *, price: str, ean: str | None) -> ScrapedProduct:
    dec_price = Decimal(price)
    return ScrapedProduct(
        store_id=store_id,
        external_sku=external_sku,
        ean=ean,
        raw_name="Arroz Diana Blanco 1000 g",
        normalized_name="arroz diana blanco 1000 g",
        display_name="Arroz Diana Blanco",
        brand="DIANA",
        raw_list_price=dec_price,
        raw_sale_price=dec_price,
        calibrated_price=dec_price,
        net_content=Decimal("1000.00"),
        unit_measure=UnitMeasure.G,
        pum_price=Decimal("4.5000"),
        in_stock=True,
        source_origin="vtex_api",
        canonical_category_slug="arroz-blanco-1kg",
        is_private_label=False,
    )


class LocalGatewayTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_sqlite_cdc_persists_and_skips_unchanged_without_supabase(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "staging.db"
            gw1 = LocalSqliteGateway(db_path)
            try:
                cdc1 = CDCManager(gw1, "exito")
                await cdc1.initialize()
                await cdc1.process_batch([_sample_product("exito", "sku-1", price="4500.00", ean="7701234567890")])
                self.assertEqual(cdc1.stats.new_skus, 1)
            finally:
                await gw1.aclose()

            # Segunda ejecución local con otro supermercado cruza por EAN y trigrama en SQLite
            gw2 = LocalSqliteGateway(db_path)
            try:
                cdc2 = CDCManager(gw2, "carulla")
                await cdc2.initialize()
                await cdc2.process_batch([_sample_product("carulla", "sku-c1", price="4700.00", ean=None)])
                self.assertEqual(cdc2.stats.new_skus, 1)
                self.assertEqual(cdc2.stats.master_matches_trgm, 1)
            finally:
                await gw2.aclose()

            # Tercera ejecución misma tienda sin cambio de precio omite insert; con cambio inserta
            gw3 = LocalSqliteGateway(db_path)
            try:
                cdc3 = CDCManager(gw3, "exito")
                await cdc3.initialize()
                await cdc3.process_batch([_sample_product("exito", "sku-1", price="4500.00", ean="7701234567890")])
                self.assertEqual(cdc3.stats.unchanged_skipped, 1)
                await cdc3.process_batch([_sample_product("exito", "sku-1", price="4800.00", ean="7701234567890")])
                self.assertEqual(cdc3.stats.price_or_stock_changes, 1)
            finally:
                await gw3.aclose()

    def test_category_report_classification_and_export(self) -> None:
        self.assertEqual(classify_category_segments("exito", ["Mercado", "Despensa"])[0], "INCLUIDA")
        self.assertEqual(classify_category_segments("carulla", ["Bebes", "Coches y sillas de carro"])[0], "EXCLUIDA")
        self.assertEqual(classify_category_segments("carulla", ["Bebes", "Salud y aseo del bebe"])[0], "INCLUIDA")
        self.assertEqual(classify_category_segments("d1", ["Hogar", "Aseo y limpieza"])[0], "INCLUIDA")
        self.assertEqual(classify_category_segments("exito", ["Mercado", "Vinos y Licores"])[0], "EXCLUIDA")
        self.assertEqual(classify_category_segments("carulla", ["Aseo del hogar", "Desechables"])[0], "INCLUIDA")
        self.assertEqual(classify_category_segments("carulla", ["Bebes", "Alimentacion del bebe", "Teteros y tetinas"])[0], "REVISAR")
        self.assertEqual(classify_category_segments("alkosto", ["Tecnologia"])[0], "EXCLUIDA")

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            md_out = tmp / "cats.md"
            csv_out = tmp / "cats.csv"
            xlsx_out = tmp / "cats.xlsx"
            txt_out = tmp / "cats.txt"
            summary = generate_report_files(md_out=md_out, csv_out=csv_out, xlsx_out=xlsx_out, txt_out=txt_out)
            self.assertIn("exito", summary)
            self.assertIn("oxxo", summary)
            self.assertIn("alkosto", summary)
            self.assertTrue(md_out.is_file())
            self.assertTrue(csv_out.is_file())
            self.assertTrue(xlsx_out.is_file())
            self.assertTrue(txt_out.is_file())
            txt_content = txt_out.read_text(encoding="utf-8")
            self.assertNotIn("alkosto |", txt_content)
            self.assertNotIn("Incontinencia", txt_content)


if __name__ == "__main__":
    unittest.main()
