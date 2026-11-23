import unittest

from etl.import_llm_categories import parse_wrapped_llm_tsv


class ImportLlmCategoriesTests(unittest.TestCase):
    def test_reconstructs_wrapped_lines_and_repairs_sequential_row_id_typo(self) -> None:
        sample = """row_id\tcanonical_slug\tcanonical_name\tproduct_type\tsub_presentation\tsub_presentation_label\tvariant_tags\tsuggested_display_name
1544\tcongelados-y-helados\tCongelados, Helados y
Listos\tcarimanola\tcarimanola_queso\tCarimañola con queso\t\tCarimañola con Queso
Frescampo 145\tcongelados-y-helados\tCongelados, Helados y
Listos\tcarimanola\tcarimanola_carne\tCarimañolas con carne\tmultipack\tCarimañolas
con Carne Farah 1546\tsalud-y-farmacia\tSalud, Vitaminas y
Farmacia\tantibiotico\tcapsula\tCápsula 500 mg\tmultipack\t"""

        rows = parse_wrapped_llm_tsv(
            sample,
            ["congelados-y-helados", "salud-y-farmacia"],
            expected_range=(1, 2500),
        )
        self.assertEqual([r.row_id for r in rows], [1544, 1545, 1546])
        self.assertEqual(rows[0].canonical_name, "Congelados, Helados y Listos")
        self.assertEqual(rows[0].suggested_display_name, "Carimañola con Queso Frescampo")
        self.assertEqual(rows[1].sub_presentation, "carimanola_carne")
        self.assertEqual(rows[1].variant_tags, ("multipack",))
        self.assertEqual(rows[1].suggested_display_name, "Carimañolas con Carne Farah")


if __name__ == "__main__":
    unittest.main()
