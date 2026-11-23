import unittest

from etl.core.manufacturer_resolver import (
    extract_manufacturing_info,
    normalize_invima_registry,
    normalize_manufacturer_name,
)
from etl.core.nutrition_extractor import extract_nutrition_attributes


class V3ResolversTests(unittest.TestCase):
    def test_invima_and_manufacturer_extraction(self):
        self.assertEqual(
            normalize_invima_registry("Registro Sanitario INVIMA RSA-0001234-2023"),
            "RSA-0001234-2023",
        )
        self.assertEqual(
            normalize_manufacturer_name("Fabricado por Alpina Productos Alimenticios S.A."),
            "Alpina Productos Alimenticios S.A.",
        )
        res = extract_manufacturing_info(
            raw_description="Fabricado por Alimentos del Valle S.A.S. INVIMA NSA-009876-2024",
            specs={"Planta": "Sopó, Cundinamarca"},
        )
        self.assertEqual(res.invima_registry, "NSA-009876-2024")
        self.assertEqual(res.plant_hint, "Sopó, Cundinamarca")
        self.assertGreaterEqual(res.confidence, 0.85)

    def test_invima_returns_none_when_absent(self):
        res = extract_manufacturing_info(raw_description="Arroz blanco bolsa 500 g")
        self.assertIsNone(res.invima_registry)
        self.assertIsNone(res.manufacturer_name)
        self.assertEqual(res.confidence, 0.0)

    def test_nutrition_conservative_extraction(self):
        lactose_free_item = extract_nutrition_attributes("Leche deslactosada 6x1L")
        self.assertTrue(lactose_free_item.lactose_free)

        whole_milk = extract_nutrition_attributes("Leche entera larga vida 1L")
        self.assertFalse(whole_milk.lactose_free)

        ambiguous = extract_nutrition_attributes("Detergente líquido o producto neutro")
        self.assertIsNone(ambiguous.lactose_free)

        yogurt = extract_nutrition_attributes(
            "Yogur griego natural 150 g",
            specs={"Proteína": "11,5 g", "Azúcares": "3,2 g"},
        )
        self.assertEqual(yogurt.protein_g_100, 11.5)
        self.assertEqual(yogurt.sugar_g_100, 3.2)
        self.assertEqual(yogurt.source, "label_scrape")


if __name__ == "__main__":
    unittest.main()
