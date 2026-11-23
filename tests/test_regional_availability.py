import unittest

from etl.locations.regional_availability_sync import (
    FARMATODO_CITY_CODE_MAP,
    extract_farmatodo_cities_from_hit,
    normalize_city_key,
    parse_vtex_regional_items,
)


class RegionalAvailabilityTests(unittest.TestCase):
    def test_normalize_city_key(self) -> None:
        self.assertEqual(normalize_city_key("Bogotá D.C."), "bogota d.c.")
        self.assertEqual(normalize_city_key("  Medellín  "), "medellin")
        self.assertEqual(normalize_city_key("MANIZALES"), "manizales")
        self.assertEqual(normalize_city_key(None), "")

    def test_extract_farmatodo_cities_from_hit(self) -> None:
        hit = {
            "id": 123456,
            "objectID": "123456",
            "barcode": "7702001000012",
            "barcodeList": ["7702001000012", "7702001000099", "not-digits"],
            "fullPriceByCity": [
                {"cityCode": "BOG", "price": 15900},
                {"cityCode": "NIZ", "price": 16200},
                {"cityCode": "MED", "price": 16000},
                {"cityCode": "XXX", "price": 17000},
            ],
        }
        sku_keys, eans, cities = extract_farmatodo_cities_from_hit(hit)
        self.assertEqual(sku_keys, ["123456", "123456"])
        self.assertIn("7702001000012", eans)
        self.assertIn("7702001000099", eans)
        self.assertNotIn("not-digits", eans)
        self.assertEqual(cities, {"bogota", "manizales", "medellin"})
        self.assertEqual(FARMATODO_CITY_CODE_MAP["NIZ"], "manizales")

    def test_parse_vtex_regional_items(self) -> None:
        products = [
            {
                "productId": "10",
                "items": [
                    {
                        "itemId": "1001",
                        "ean": "7701234567890",
                        "sellers": [
                            {"commertialOffer": {"Price": 5400, "AvailableQuantity": 8}},
                        ],
                    },
                    {
                        "itemId": "1002",
                        "ean": "7701234567891",
                        "sellers": [
                            {"commertialOffer": {"Price": 5400, "AvailableQuantity": 0}},
                        ],
                    },
                    {
                        "itemId": "1003",
                        "ean": "N/A",
                        "sellers": [
                            {"commertialOffer": {"Price": 0, "AvailableQuantity": 5}},
                        ],
                    },
                ],
            }
        ]
        parsed = parse_vtex_regional_items(products)
        self.assertEqual(
            parsed,
            [
                ("1001", "7701234567890", True),
                ("1002", "7701234567891", False),
                ("1003", None, False),
            ],
        )


if __name__ == "__main__":
    unittest.main()
