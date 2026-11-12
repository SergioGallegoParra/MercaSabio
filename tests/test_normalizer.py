"""Pruebas unitarias del normalizador de gramajes, volúmenes, EAN y PUM."""

from __future__ import annotations

import unittest
from decimal import Decimal

from etl.core.models import UnitMeasure
from etl.core.normalizer import (
    compute_pum,
    extract_content_from_text,
    is_valid_gtin_checksum,
    normalize_ean,
    normalize_product_name,
    resolve_content,
)


class NormalizerTests(unittest.TestCase):
    def test_extracts_standard_mass_and_volume_units(self) -> None:
        cases = [
            ("Arroz Blanco Diana 1000 g", Decimal("1000.00"), UnitMeasure.G),
            ("Café Sello Rojo 500gr", Decimal("500.00"), UnitMeasure.G),
            ("Lenteja 500 gramos", Decimal("500.00"), UnitMeasure.G),
            ("Azúcar Manuelita 2.5 kg", Decimal("2500.00"), UnitMeasure.G),
            ("Leche Alquería 1,1 Litros", Decimal("1100.00"), UnitMeasure.ML),
            ("Aceite Premier 900 cc", Decimal("900.00"), UnitMeasure.ML),
            ("Gaseosa Postobón 1.5 lt", Decimal("1500.00"), UnitMeasure.ML),
            ("Jugo Hit 200 ml", Decimal("200.00"), UnitMeasure.ML),
            ("Huevos AA x 30 unidades", Decimal("30.00"), UnitMeasure.UND),
            ("Papel Higiénico Familia 12 und", Decimal("12.00"), UnitMeasure.UND),
        ]
        for title, expected_qty, expected_unit in cases:
            with self.subTest(title=title):
                result = extract_content_from_text(title)
                self.assertIsNotNone(result)
                assert result is not None
                self.assertEqual(result.net_content, expected_qty)
                self.assertEqual(result.unit_measure, expected_unit)

    def test_extracts_multipack_quantities(self) -> None:
        res = extract_content_from_text("Cerveza Poker Lata 6 x 330 ml")
        self.assertIsNotNone(res)
        assert res is not None
        self.assertEqual(res.net_content, Decimal("1980.00"))
        self.assertEqual(res.unit_measure, UnitMeasure.ML)

        res_pack = extract_content_from_text("Atún Van Camps 4x160g")
        self.assertIsNotNone(res_pack)
        assert res_pack is not None
        self.assertEqual(res_pack.net_content, Decimal("640.00"))
        self.assertEqual(res_pack.unit_measure, UnitMeasure.G)

    def test_colombian_thousands_dot_for_grams_and_decimal_for_kg(self) -> None:
        grams = extract_content_from_text("Arroz Roa 1.000 g")
        self.assertIsNotNone(grams)
        assert grams is not None
        self.assertEqual(grams.net_content, Decimal("1000.00"))
        self.assertEqual(grams.unit_measure, UnitMeasure.G)

        half_kilo = extract_content_from_text("Frijol 0.500 kg")
        self.assertIsNotNone(half_kilo)
        assert half_kilo is not None
        self.assertEqual(half_kilo.net_content, Decimal("500.00"))
        self.assertEqual(half_kilo.unit_measure, UnitMeasure.G)

    def test_resolve_content_falls_back_to_vtex_measurement_unit(self) -> None:
        res = resolve_content("Aguacate Hass a Granel", measurement_unit="kg", unit_multiplier=1.0)
        self.assertEqual(res.net_content, Decimal("1000.00"))
        self.assertEqual(res.unit_measure, UnitMeasure.G)

        res_un = resolve_content("Pan Tajado Sin Etiqueta", measurement_unit="un", unit_multiplier=1)
        self.assertEqual(res_un.net_content, Decimal("1.00"))
        self.assertEqual(res_un.unit_measure, UnitMeasure.UND)

    def test_normalize_product_name_and_ean(self) -> None:
        self.assertEqual(
            normalize_product_name("Café Águila Roja Molido x 500 g!"),
            "cafe aguila roja molido x 500 g",
        )
        self.assertEqual(normalize_ean(" 7702001001234 "), "7702001001234")
        self.assertIsNone(normalize_ean("0000000000000"))
        self.assertIsNone(normalize_ean("N/A"))
        self.assertTrue(is_valid_gtin_checksum("7701234567897"))
        self.assertFalse(is_valid_gtin_checksum("7701234567892"))

    def test_compute_pum(self) -> None:
        self.assertEqual(compute_pum(Decimal("4500.00"), Decimal("1000.00")), Decimal("4.5000"))
        with self.assertRaises(ValueError):
            compute_pum(Decimal("4500.00"), Decimal("0"))


if __name__ == "__main__":
    unittest.main()
