"""Pruebas de integridad y homologación de la taxonomía unificada (10x59)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from etl.core.unified_taxonomy import (
    DEFAULT_TAXONOMY_JSON,
    UNIFIED_TAXONOMY_TREE,
    VALID_CATEGORY_PAIRS,
    load_unified_classifier,
    parse_ai_studio_classifications,
)


class UnifiedTaxonomyTests(unittest.TestCase):
    def test_taxonomy_shape_and_full_coverage(self) -> None:
        self.assertEqual(len(UNIFIED_TAXONOMY_TREE), 10)
        self.assertEqual(len(VALID_CATEGORY_PAIRS), 59)

        data = json.loads(Path(DEFAULT_TAXONOMY_JSON).read_text(encoding="utf-8"))
        mappings = data["mappings"]
        self.assertEqual(len(mappings), 1895)

        ai_map = parse_ai_studio_classifications()
        self.assertEqual(len(ai_map), 1589)

        classifier = load_unified_classifier()
        for (store_id, route), (macro, sub) in ai_map.items():
            resolved = classifier.classify(store_id=store_id, category_path=route)
            self.assertEqual((resolved.macro_categoria, resolved.subcategoria), (macro, sub))
            self.assertEqual(resolved.source, "ai_studio")

    def test_homologated_contextual_cases_for_mercaldas_and_olimpica(self) -> None:
        classifier = load_unified_classifier()

        cases = [
            ("olimpica", ["Supermercado", "Pollo, Carne y Pescado", "Carne De Cerdo"], ("Carnes, Pescados y Charcutería", "Carne de cerdo")),
            ("olimpica", ["Belleza", "Cuidado facial", "Cremas Hidratantes"], ("Cuidado Personal y Bebés", "Cuidado corporal, facial y solar")),
            ("mercaldas", ["Frutas y Verduras", "Verduras", "Lechugas - Repollos - Espinacas"], ("Frutas y Verduras", "Verduras, hortalizas y tubérculos")),
            ("mercaldas", ["Limpieza", "Cuidado de la Ropa", "Detergente en Polvo - Líquido"], ("Hogar, Aseo y Mascotas", "Detergentes y cuidado de ropa")),
            ("olimpica", ["Supermercado", "Congelados", "Pasabocas Congelados"], ("Congelados y Comidas Listas", "Congelados y hielo")),
        ]
        for store_id, path, expected in cases:
            resolved = classifier.classify(store_id=store_id, category_path=path)
            self.assertEqual((resolved.macro_categoria, resolved.subcategoria), expected)


if __name__ == "__main__":
    unittest.main()
