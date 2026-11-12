"""Pruebas unitarias para el filtro de catálogo solo-mercado y reglas canónicas."""

from __future__ import annotations

import unittest
from decimal import Decimal

from etl.core.canonical_mapper import infer_canonical_category_slug
from etl.core.grocery_filter import (
    is_mercado_category_name,
    is_mercado_product,
    is_priority_grocery_category_name,
)
from etl.core.models import UnitMeasure
from etl.scrapers.vtex_scraper import VtexScraper


class GroceryFilterTests(unittest.TestCase):
    def test_excludes_non_grocery_stores_and_categories(self) -> None:
        self.assertFalse(is_mercado_product("alkosto", "Arroz Blanco 1000 g", brand="Diana"))
        self.assertFalse(is_mercado_product("ktronix", "Celular Samsung S25", brand="Samsung"))
        self.assertFalse(
            is_mercado_product(
                "olimpica",
                "Televisor Caixun 55 Pulgadas Smart TV QLED",
                brand="CAIXUN",
            )
        )
        self.assertFalse(
            is_mercado_product(
                "olimpica",
                "Camisa JSN Azul Talla XXL",
                brand="JSN",
            )
        )
        self.assertFalse(
            is_mercado_product(
                "d1",
                "Papel Regalo Navideño 70 cm x 5 metros",
                brand="NAVIDAD",
            )
        )

    def test_preserves_false_positive_grocery_names(self) -> None:
        self.assertTrue(
            is_mercado_product(
                "carulla",
                "Pastas LA MUÑECA spaghetti (500 gr)",
                brand="LA MUÑECA",
            )
        )
        self.assertTrue(
            is_mercado_product(
                "carulla",
                "Queso Sabana ALPINA 7 tajadas (91 gr)",
                brand="ALPINA",
            )
        )
        self.assertTrue(
            is_mercado_product(
                "carulla",
                "Sazonador MAGGI jugoso al sartén finas hierbas (23.4 gr)",
                brand="MAGGI",
            )
        )
        self.assertTrue(
            is_mercado_product(
                "d1",
                "Mezcla de verduras Wok Cooltivo 400 g",
                brand="COOLTIVO",
            )
        )
        self.assertTrue(
            is_mercado_product(
                "d1",
                "Papa Airfryer McCain x 500 g",
                brand="MCCAIN",
            )
        )
        self.assertTrue(
            is_mercado_product(
                "d1",
                "Detergente Líquido Bonaropa Ecoplanet 1 L",
                brand="BONAROPA",
            )
        )

    def test_vtex_tree_skips_non_grocery_and_prioritizes_supermercado(self) -> None:
        tree = [
            {"id": 6000000, "name": "Electrodomésticos y Tecnología", "children": [{"id": 61, "name": "TV", "children": []}]},
            {"id": 11000000, "name": "Juguetería", "children": [{"id": 12, "name": "Muñecas", "children": []}]},
            {"id": 13000000, "name": "Cuidado personal", "children": []},
            {"id": 900000000, "name": "Supermercado", "children": [{"id": 91, "name": "Despensa", "children": []}]},
        ]
        self.assertFalse(is_mercado_category_name("Electrodomésticos y Tecnología"))
        self.assertFalse(is_mercado_category_name("Juguetería"))
        self.assertTrue(is_priority_grocery_category_name("Supermercado"))

        flattened = VtexScraper._flatten_category_tree(tree)
        self.assertEqual(flattened, ["C:/900000000/91/", "C:/13000000/"])

    def test_canonical_mapper_ignores_non_food_false_positives(self) -> None:
        self.assertIsNone(
            infer_canonical_category_slug(
                "shampoo h s aceite de argan 650 ml",
                Decimal("650"),
                UnitMeasure.ML,
            )
        )
        self.assertIsNone(
            infer_canonical_category_slug(
                "jabon en barra palmolive cafe y aceite de almendra 330 gr",
                Decimal("330"),
                UnitMeasure.G,
            )
        )
        self.assertIsNone(
            infer_canonical_category_slug(
                "yogurt tapioka semidescremado sin azucar 1750 gr",
                Decimal("1750"),
                UnitMeasure.G,
            )
        )
        self.assertEqual(
            infer_canonical_category_slug(
                "aceite vegetal imata 900 ml",
                Decimal("900"),
                UnitMeasure.ML,
            ),
            "aceite-vegetal-900ml",
        )


if __name__ == "__main__":
    unittest.main()
