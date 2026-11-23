import unittest
from decimal import Decimal

from etl.core.models import UnitMeasure
from etl.core.product_enrichment import (
    extract_product_metadata,
    infer_broad_category_slug,
    simplify_display_name,
)


class ProductEnrichmentTests(unittest.TestCase):
    def test_simplify_display_name_collapses_duplicates_strips_weights_and_title_cases(self) -> None:
        self.assertEqual(
            simplify_display_name(
                "Té Bitaco Verde Lulo 20 G TE BITACO VERDE LULO 20g",
                brand="Bitaco",
                net_content=Decimal("20"),
                unit_measure=UnitMeasure.G,
            ),
            "Té Bitaco Verde Lulo",
        )
        self.assertEqual(
            simplify_display_name(
                "Papel Higiénico Familia Húmedo Acolchamax x 50 und",
                brand="Familia",
                net_content=Decimal("50"),
                unit_measure=UnitMeasure.UND,
            ),
            "Papel Higiénico Familia Húmedo Acolchamax",
        )
        self.assertEqual(
            simplify_display_name(
                "Empanada Del Origen Espinaca 580 G X12 Unds EMPANADA DEL ORIGEN ESPINACA X12un 580g",
                brand="Del Origen",
                net_content=Decimal("580"),
                unit_measure=UnitMeasure.G,
            ),
            "Empanada del Origen Espinaca x12",
        )
        self.assertEqual(
            simplify_display_name(
                "LECHE ALPINA DESLACTOSADA EN BOLSA DE 1100 ML",
                brand="Alpina",
                net_content=Decimal("1100"),
                unit_measure=UnitMeasure.ML,
            ),
            "Leche Alpina Deslactosada en Bolsa",
        )

    def test_simplify_display_name_preserves_acronyms_and_connectors(self) -> None:
        res = simplify_display_name(
            "SHAMPOO PARA EL CABELLO Y BARBA UHT CON ALOE 400 ML",
            unit_measure=UnitMeasure.ML,
        )
        self.assertEqual(res, "Shampoo para el Cabello y Barba UHT con Aloe")

    def test_infer_broad_category_slug_covers_non_strict_aisles(self) -> None:
        self.assertEqual(
            infer_broad_category_slug("leche alpina deslactosada 1100 ml", Decimal("1100"), UnitMeasure.ML),
            "lacteos-y-leches",
        )
        self.assertEqual(
            infer_broad_category_slug("cafe juan valdez liofilizado 95 g", Decimal("95"), UnitMeasure.G),
            "cafe-te-y-chocolate",
        )
        self.assertEqual(
            infer_broad_category_slug("shampoo head shoulders limpieza 400 ml", Decimal("400"), UnitMeasure.ML),
            "cuidado-personal-e-higiene",
        )
        self.assertEqual(
            infer_broad_category_slug("detergente liquido ariel 2000 ml", Decimal("2000"), UnitMeasure.ML),
            "aseo-hogar-y-lavanderia",
        )
        # Mantiene las 10 categorías estrictas canónicas cuando aplica
        self.assertEqual(
            infer_broad_category_slug("arroz blanco diana 1000 g", Decimal("1000"), UnitMeasure.G),
            "arroz-blanco-1000g",
        )

    def test_extract_product_metadata_separates_subpresentations(self) -> None:
        deslact = extract_product_metadata("Leche Alpina Deslactosada 1100 ml")
        entera = extract_product_metadata("Leche Alpina Entera UHT 1100 ml")
        self.assertEqual(deslact.sub_presentation, "leche_deslactosada")
        self.assertEqual(deslact.sub_presentation_label, "Leche deslactosada")
        self.assertEqual(entera.sub_presentation, "leche_entera")
        self.assertNotEqual(deslact.sub_presentation, entera.sub_presentation)

        liof = extract_product_metadata("Café Juan Valdez Liofilizado Clásico 95 g")
        inst = extract_product_metadata("Café Colcafé Instantáneo Granulado 170 g")
        mol = extract_product_metadata("Café Sello Rojo Molido Tradicional 500 g")
        self.assertEqual(liof.sub_presentation, "cafe_liofilizado")
        self.assertEqual(inst.sub_presentation, "cafe_instantaneo")
        self.assertEqual(mol.sub_presentation, "cafe_molido")
        self.assertEqual(len({liof.sub_presentation, inst.sub_presentation, mol.sub_presentation}), 3)

        sugar_free = extract_product_metadata("Yogurt Griego Alpina Sin Azúcar 150 g")
        self.assertEqual(sugar_free.sub_presentation, "yogurt_griego")
        self.assertIn("sin_azucar", sugar_free.variant_tags)


if __name__ == "__main__":
    unittest.main()
