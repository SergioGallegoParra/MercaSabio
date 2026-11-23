"""Pruebas unitarias para el directorio nacional de 32 capitales y conectores geoespaciales."""

from __future__ import annotations

import unittest

from etl.locations.branch_ingestor import (
    BranchRecord,
    deduplicate_branches,
    haversine_meters,
    normalize_colombia_city,
    parse_ara_api_stores,
    parse_google_places_response,
    parse_vtex_pickup_items,
)
from etl.locations.colombia_capitals_directory import (
    COLOMBIA_CAPITALS_DIRECTORY,
    generate_curated_colombia_branches,
)

EXPECTED_12_STORES = {
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
}


class BranchIngestorTests(unittest.TestCase):
    def test_32_colombian_capitals_and_12_chains(self) -> None:
        cities = [cap.city for cap in COLOMBIA_CAPITALS_DIRECTORY]
        self.assertEqual(len(cities), 32)
        self.assertEqual(len(set(cities)), 32)

        for required in (
            "Bogotá",
            "Medellín",
            "Cali",
            "Barranquilla",
            "Cartagena",
            "Bucaramanga",
            "Pereira",
            "Manizales",
            "Armenia",
            "Pasto",
            "Leticia",
            "San Andrés",
            "Puerto Carreño",
        ):
            self.assertIn(required, set(cities))

        branches = generate_curated_colombia_branches()
        self.assertGreater(len(branches), 1000)
        self.assertEqual({b.store_id for b in branches}, EXPECTED_12_STORES)
        self.assertEqual(len({b.city for b in branches}), 32)

    def test_normalize_colombia_city_variants_and_mojibake(self) -> None:
        self.assertEqual(normalize_colombia_city("Bogotá, D.c."), "Bogotá")
        self.assertEqual(normalize_colombia_city("Cartagena de Indias"), "Cartagena")
        self.assertEqual(normalize_colombia_city("Medellin"), "Medellín")
        self.assertEqual(normalize_colombia_city("C\ufffdcuta"), "Cúcuta")
        self.assertEqual(normalize_colombia_city("Cajic\ufffd"), "Cajicá")
        self.assertEqual(normalize_colombia_city("San Jose del Guaviare"), "San José del Guaviare")

    def test_parse_vtex_pickup_items_classifies_and_filters_couriers(self) -> None:
        payload = {
            "items": [
                {
                    "pickupPoint": {
                        "id": "ptorecogida_277",
                        "friendlyName": "Carulla Express Galerías",
                        "address": {
                            "city": "Bogotá, D.c.",
                            "state": "Bogotá, D.C.",
                            "neighborhood": "Galerías",
                            "street": "Calle 53 #24-30",
                            "number": "2430",
                            "geoCoordinates": [-74.0736, 4.6431],
                        },
                    }
                },
                {
                    "pickupPoint": {
                        "id": "courier_99",
                        "friendlyName": "Punto Interrapidisimo Centro",
                        "address": {
                            "city": "Bucaramanga",
                            "state": "Santander",
                            "street": "Calle 36 #12-10",
                            "geoCoordinates": [-73.128, 7.121],
                        },
                    }
                },
            ]
        }

        parsed = parse_vtex_pickup_items(
            payload,
            default_store_id="exito",
            fallback_city="Bogotá",
            fallback_department="Bogotá D.C.",
        )
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].store_id, "carulla")
        self.assertEqual(parsed[0].city, "Bogotá")
        self.assertAlmostEqual(parsed[0].lat, 4.6431, places=4)
        self.assertAlmostEqual(parsed[0].lng, -74.0736, places=4)
        self.assertEqual(parsed[0].source_provider, "vtex_pickup")

    def test_parse_google_places_response_v1_and_legacy(self) -> None:
        v1_payload = {
            "places": [
                {
                    "id": "ChIJ123",
                    "displayName": {"text": "Tiendas D1 Cabecera"},
                    "formattedAddress": "Cra. 33 #48-10, Bucaramanga, Santander, Colombia",
                    "location": {"latitude": 7.1162, "longitude": -73.1114},
                }
            ]
        }
        v1_parsed = parse_google_places_response(
            v1_payload,
            store_id="d1",
            city="Bucaramanga",
            department="Santander",
        )
        self.assertEqual(len(v1_parsed), 1)
        self.assertEqual(v1_parsed[0].source_provider, "google_places")
        self.assertEqual(v1_parsed[0].external_place_id, "gplace:ChIJ123")

        legacy_payload = {
            "results": [
                {
                    "place_id": "LEG_456",
                    "name": "Supermercados Ara Circunvalar",
                    "formatted_address": "Av. Circunvalar #12-30, Pereira, Colombia",
                    "geometry": {"location": {"lat": 4.8072, "lng": -75.6841}},
                }
            ]
        }
        leg_parsed = parse_google_places_response(
            legacy_payload,
            store_id="ara",
            city="Pereira",
            department="Risaralda",
        )
        self.assertEqual(len(leg_parsed), 1)
        self.assertEqual(leg_parsed[0].source_provider, "google_places_legacy")
        self.assertEqual(leg_parsed[0].city, "Pereira")

    def test_deduplicate_branches_prioritizes_higher_source_within_65m(self) -> None:
        curated = BranchRecord(
            store_id="d1",
            branch_name="D1 Cabecera",
            city="Bucaramanga",
            department="Santander",
            barrio="Cabecera",
            address="Cra. 33 #48-25",
            lat=7.1160,
            lng=-73.1110,
            source_provider="curated",
        )
        vtex_close = BranchRecord(
            store_id="d1",
            branch_name="D1 Cabecera Principal",
            city="Bucaramanga",
            department="Santander",
            barrio="Cabecera",
            address="Cra. 33 #48-20",
            lat=7.1162,
            lng=-73.1111,
            source_provider="vtex_pickup",
        )
        google_close = BranchRecord(
            store_id="d1",
            branch_name="Tiendas D1 Cabecera Parque",
            city="Bucaramanga",
            department="Santander",
            barrio="Cabecera",
            address="Cra. 33 #48-18",
            lat=7.1161,
            lng=-73.1112,
            source_provider="google_places",
            external_place_id="gplace:abc",
        )
        different_store_same_spot = BranchRecord(
            store_id="ara",
            branch_name="Ara Cabecera",
            city="Bucaramanga",
            department="Santander",
            barrio="Cabecera",
            address="Cra. 33 #48-19",
            lat=7.1161,
            lng=-73.1112,
            source_provider="curated",
        )
        far_same_store = BranchRecord(
            store_id="d1",
            branch_name="D1 Cañaveral",
            city="Bucaramanga",
            department="Santander",
            barrio="Cañaveral",
            address="Autopista Floridablanca",
            lat=7.0680,
            lng=-73.1050,
            source_provider="curated",
        )

        self.assertLess(haversine_meters(curated.lat, curated.lng, google_close.lat, google_close.lng), 65.0)
        deduped = deduplicate_branches(
            [curated, vtex_close, google_close, different_store_same_spot, far_same_store]
        )
        self.assertEqual(len(deduped), 3)
        sources = {(b.store_id, b.branch_name): b.source_provider for b in deduped}
        self.assertEqual(sources[("d1", "Tiendas D1 Cabecera Parque")], "google_places")
        self.assertIn(("d1", "D1 Cañaveral"), sources)
        self.assertIn(("ara", "Ara Cabecera"), sources)

    def test_preserves_distinct_generic_named_branches_in_same_city(self) -> None:
        payload = {
            "places": [
                {
                    "id": "ChIJ_la_enea",
                    "displayName": {"text": "Tiendas D1"},
                    "formattedAddress": "Cra. 32 #105c, Manizales, Caldas",
                    "location": {"latitude": 5.0315, "longitude": -75.4581},
                },
                {
                    "id": "ChIJ_santander",
                    "displayName": {"text": "Tiendas D1"},
                    "formattedAddress": "Av. Santander #46a-59, Manizales, Caldas",
                    "location": {"latitude": 5.0642, "longitude": -75.4951},
                },
            ]
        }
        parsed = parse_google_places_response(
            payload,
            store_id="d1",
            city="Manizales",
            department="Caldas",
            barrio="La Enea",
        )
        deduped = deduplicate_branches(parsed)
        self.assertEqual(len(deduped), 2)
        names = {b.branch_name for b in deduped}
        self.assertIn("Tiendas D1 · Cra. 32 #105c", names)
        self.assertIn("Tiendas D1 · Av. Santander #46a-59", names)

    def test_parse_ara_api_stores_and_prevent_city_substring_collisions(self) -> None:
        self.assertEqual(normalize_colombia_city("Quinchia"), "Quinchía")
        self.assertEqual(normalize_colombia_city("Pueblo Bello"), "Pueblo Bello")

        payload = {
            "data": [
                {
                    "ID": "584",
                    "id": "0719",
                    "name": "Tamesis - Centro",
                    "city": "Tamesis",
                    "department": "Antioquia",
                    "address": "Calle 11 # 9 - 14/16",
                    "latitude": "5.66324",
                    "longitude": "-75.7126",
                    "status": "1",
                },
                {
                    "ID": "585",
                    "id": "0719",  # Duplicado por id oficial: debe ignorarse
                    "name": "Duplicada",
                    "city": "Tamesis",
                    "department": "Antioquia",
                    "address": "Otra",
                    "latitude": "5.66325",
                    "longitude": "-75.7127",
                    "status": "1",
                },
                {
                    "ID": "586",
                    "id": "0800",
                    "name": "Inactiva",
                    "city": "Medellin",
                    "department": "Antioquia",
                    "latitude": "6.25",
                    "longitude": "-75.56",
                    "status": "0",
                },
                {
                    "ID": "587",
                    "id": "0900",
                    "name": "Fuera de rango",
                    "city": "Quinchia",
                    "department": "Risaralda",
                    "latitude": "40.0",
                    "longitude": "-75.0",
                    "status": "1",
                },
            ]
        }
        parsed = parse_ara_api_stores(payload)
        self.assertEqual(len(parsed), 1)
        rec = parsed[0]
        self.assertEqual(rec.store_id, "ara")
        self.assertEqual(rec.branch_name, "Ara Tamesis - Centro")
        self.assertEqual(rec.city, "Támesis")
        self.assertEqual(rec.barrio, "Centro")
        self.assertEqual(rec.source_provider, "ara_api")
        self.assertEqual(rec.external_place_id, "ara:0719")


if __name__ == "__main__":
    unittest.main()
