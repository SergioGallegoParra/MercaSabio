"""Pruebas unitarias para el filtro de catálogo solo-mercado y reglas canónicas."""

from __future__ import annotations

import unittest
from decimal import Decimal

from etl.core.canonical_mapper import infer_canonical_category_slug
from etl.core.grocery_filter import (
    evaluate_category_path_whitelist,
    is_mercado_category_name,
    is_mercado_category_path,
    is_mercado_product,
    is_priority_grocery_category_name,
)
from etl.core.models import UnitMeasure
from etl.scrapers.farmatodo_scraper import FarmatodoScraper
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
        for store_id in (
            "ara",
            "d1",
            "olimpica",
            "exito",
            "carulla",
            "farmatodo",
            "euro",
            "oxxo",
            "mercaldas",
            "isimo",
            "zapatoca",
            "makro",
        ):
            with self.subTest(store_id=store_id):
                self.assertTrue(
                    is_mercado_product(store_id, "Arroz Blanco Diana 1000 g", brand="DIANA")
                )
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
            {"id": 14000000, "name": "Mascotas", "children": []},
            {"id": 13000000, "name": "Cuidado personal", "children": []},
            {"id": 900000000, "name": "Supermercado", "children": [{"id": 91, "name": "Despensa", "children": []}]},
        ]
        self.assertFalse(is_mercado_category_name("Electrodomésticos y Tecnología"))
        self.assertFalse(is_mercado_category_name("Juguetería"))
        self.assertTrue(is_priority_grocery_category_name("Supermercado"))
        self.assertTrue(is_priority_grocery_category_name("Cuidado personal"))

        flattened = VtexScraper._flatten_category_tree(tree)
        self.assertEqual(flattened, ["C:/13000000/", "C:/900000000/91/", "C:/14000000/"])

    def test_confirmed_categories_and_false_positives_are_handled(self) -> None:
        self.assertTrue(is_mercado_category_path(["Cuidado personal y belleza", "Cuidado oral"]))
        self.assertTrue(is_mercado_category_path(["Hogar", "Aseo y limpieza", "Cuidado de la ropa"]))
        self.assertTrue(is_mercado_category_path(["Carnes Frías - Embutidos", "Salchichas - Salchichones - Cabanos"]))
        self.assertFalse(is_mercado_category_path(["Cuidado personal y belleza", "Cosmética y maquillaje"]))
        self.assertFalse(is_mercado_category_path(["Haceb", "Calentadores", "De Paso"]))
        self.assertFalse(is_mercado_category_path(["Escuela de cocina", "Chef en Línea", "Clase parrilla"]))
        self.assertFalse(is_mercado_category_path(["Alimentos y bebidas", "Bebidas alcohólicas"]))
        self.assertFalse(is_mercado_category_path(["Mercado", "Aseo personal", "Incontinencia"]))
        self.assertFalse(is_mercado_category_path(["Cuidado personal", "Bienestar sexual", "Lubricantes"]))
        self.assertFalse(is_mercado_category_path(["Cuidado personal", "Higiene personal", "Incontinencia"]))
        self.assertFalse(is_mercado_category_path(["Mundo Bebés", "Aseo E Higiene Infantil", "Entrenadores"]))
        self.assertFalse(is_mercado_category_path(["Mercado", "Aseo Hogar", "Alfombras"]))
        self.assertTrue(is_mercado_category_path(["Limpieza", "Cuidado del Hogar", "Limpiadores de Alfombras - Multiusos"]))
        self.assertTrue(is_mercado_category_path(["Cuidado personal y belleza", "Cuidado solar"]))
        self.assertTrue(is_mercado_category_path(["Limpieza", "Desechables - Plásticos", "Otros"]))
        self.assertTrue(is_mercado_category_path(["Belleza", "Cuidado para el cabello", "Fijadores y moldeadores"]))
        self.assertTrue(is_mercado_category_path(["Belleza", "Cuidado para el cabello", "Cremas de peinar"]))

    def test_contextual_whitelist_blocks_unknown_and_disambiguates_subcategories(self) -> None:
        self.assertEqual(
            evaluate_category_path_whitelist(["Vehiculos", "Aceites y lubricantes"])[0],
            "DENY",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["Cuidado del bebe", "Higiene del bebe", "Aceites"])[0],
            "ALLOW",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["Bebes", "Disfraces halloween"])[0],
            "UNKNOWN",
        )
        self.assertEqual(
            evaluate_category_path_whitelist(["Coleccionables raros", "Estampas"])[0],
            "UNKNOWN",
        )

        unknowns: list[str] = []
        tree = [
            {"id": 100, "name": "Despensa", "children": []},
            {"id": 200, "name": "Coleccionables raros", "children": []},
        ]
        flattened = VtexScraper._flatten_category_tree(tree, unknown_paths_out=unknowns)
        self.assertEqual(flattened, ["C:/100/"])
        self.assertEqual(unknowns, ["Coleccionables raros"])

        ft = FarmatodoScraper(
            category_paths=[
                ["Alimentos y bebidas", "Despensa", "Arroz"],
                ["Cuidado personal", "Bienestar sexual", "Lubricantes"],
                ["Hogar, mascotas y otros.", "Gatos", "Arenero"],
                ["Categoría rara nueva", "Subnodo desconocido"],
            ]
        )
        self.assertEqual(ft._resolve_whitelisted_category_paths(), [["Alimentos y bebidas", "Despensa", "Arroz"]])

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

    def test_excludes_alcohol_cigarettes_medicines_toys_and_variedades(self) -> None:
        self.assertFalse(is_mercado_category_name("Vinos y Licores"))
        self.assertFalse(is_mercado_category_name("Cigarrillos y Tabacos"))
        self.assertFalse(is_mercado_category_name("Salud y Bienestar"))
        self.assertFalse(is_mercado_category_name("Variedades"))
        self.assertFalse(is_mercado_category_name("Accesorios para mascotas"))

        self.assertFalse(is_mercado_product("carulla", "Cerveza Club Colombia Dorada 330 ml", raw_url="https://www.carulla.com/cervezas/p"))
        self.assertFalse(is_mercado_product("exito", "Whisky Old Parr 12 Años 750 ml"))
        self.assertFalse(is_mercado_product("olimpica", "Cigarrillos Marlboro Gold Cajetilla x 20"))
        self.assertFalse(is_mercado_product("farmatodo", "Dolex Forte Acetaminofen 500 mg Caja x 24"))
        self.assertFalse(is_mercado_product("jumbo", "3 en 1 Caminadora para Bebe", raw_url="https://www.jumbocolombia.com/mundo-bebes/p"))

        # Falsos positivos culinarios, de aseo y comida de mascotas deben mantenerse
        self.assertTrue(is_mercado_product("carulla", "Vinagre de Vino Blanco Carbonell 500 ml"))
        self.assertTrue(is_mercado_product("exito", "Helado Crem Helado Ron con Pasas 1 L"))
        self.assertTrue(is_mercado_product("d1", "Chicharron Americano 150 g"))
        self.assertTrue(is_mercado_product("jumbo", "Alimento para Perro Dog Chow Adultos 2 kg"))
        self.assertTrue(is_mercado_product("ara", "Detergente Liquido Ariel 2 L"))

        # Inclusiones confirmadas por el usuario (aseo/cuidado personal, energizantes, bebe cuidado/papillas, carnes, quesos, cafes, natillas)
        self.assertTrue(is_mercado_product("d1", "Limpiador Multiusos", category_path=["Hogar", "Aseo y limpieza"]))
        self.assertFalse(is_mercado_product("d1", "Sarten Teflon", category_path=["Hogar", "Cocina y mesa"]))
        self.assertTrue(is_mercado_product("carulla", "Crema Antipanalitis Bebes", category_path=["Bebes", "Salud y aseo del bebe"]))
        self.assertTrue(is_mercado_product("carulla", "Compota de Manzana Gerbers 113 g", category_path=["Bebes", "Alimentacion del bebe"]))
        self.assertFalse(is_mercado_product("carulla", "Coche Paseador Bebe", category_path=["Bebes", "Coches y sillas de carro"]))
        self.assertTrue(is_mercado_product("exito", "Natilla Maizena Tradicional 300 g", category_path=["Navidad", "Natillas y bunuelos"]))
        self.assertTrue(is_mercado_product("carulla", "Cafe Especial Juan Valdez 500 g", category_path=["Despensa", "Cafe"]))
        self.assertTrue(is_mercado_product("olimpica", "Bebida Energizante Monster 473 ml", category_path=["Supermercado", "Energizantes"]))


if __name__ == "__main__":
    unittest.main()
