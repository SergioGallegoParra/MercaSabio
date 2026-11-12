"""Pruebas de homologación en cascada (EAN, Trigram, Canónica) y CDC en memoria."""

from __future__ import annotations

import unittest
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import httpx

from etl.core.cdc_manager import CDCManager, InMemoryGateway, SupabaseGateway
from etl.core.models import ScrapedProduct, UnitMeasure
from etl.core.normalizer import compute_pum, normalize_product_name


def _make_product(
    store_id: str,
    sku: str,
    name: str,
    price: str,
    *,
    ean: str | None = None,
    net_content: str = "1000.00",
    unit: UnitMeasure = UnitMeasure.G,
    in_stock: bool = True,
    is_private_label: bool = False,
    canonical_slug: str | None = None,
) -> ScrapedProduct:
    sale = Decimal(price)
    content = Decimal(net_content)
    return ScrapedProduct(
        store_id=store_id,
        external_sku=sku,
        ean=ean,
        raw_name=name,
        normalized_name=normalize_product_name(name),
        brand="Diana" if not is_private_label else "Marca Propia",
        raw_list_price=sale,
        raw_sale_price=sale,
        calibrated_price=sale,
        net_content=content,
        unit_measure=unit,
        pum_price=compute_pum(sale, content),
        in_stock=in_stock,
        source_origin="vtex_api",
        canonical_category_slug=canonical_slug,
        is_private_label=is_private_label,
    )


class CDCAndResolutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_cascade_resolution_ean_trgm_and_canonical(self) -> None:
        gateway = InMemoryGateway()
        gateway.canonical_categories["arroz-blanco-1000g"] = 1

        # Día 1 en Éxito: crea master_product con EAN
        cdc_exito = CDCManager(gateway, "exito")
        await cdc_exito.initialize()
        p_exito = _make_product(
            "exito",
            "ex-1",
            "Arroz Blanco Diana 1000 g",
            "4500.00",
            ean="7702001001234",
        )
        await cdc_exito.process_batch([p_exito])

        # Carulla con mismo EAN -> Nivel 1 (mismo master_product_id)
        cdc_carulla = CDCManager(gateway, "carulla")
        await cdc_carulla.initialize()
        p_carulla = _make_product(
            "carulla",
            "ca-1",
            "Arroz Diana Tradicional 1000 g",
            "4700.00",
            ean="7702001001234",
        )
        stats_carulla = await cdc_carulla.process_batch([p_carulla])
        self.assertEqual(stats_carulla.master_matches_ean, 1)

        # Olímpica sin EAN pero nombre muy similar y mismo gramaje -> Nivel 2 (trigram >= 0.65)
        cdc_olimpica = CDCManager(gateway, "olimpica")
        await cdc_olimpica.initialize()
        p_olimpica = _make_product(
            "olimpica",
            "ol-1",
            "Arroz Blanco Diana x 1000 g",
            "4450.00",
            ean=None,
        )
        stats_olimpica = await cdc_olimpica.process_batch([p_olimpica])
        self.assertEqual(stats_olimpica.master_matches_trgm, 1)

        # Producto sin EAN con distinto gramaje (500 g vs 1000 g) NO debe homologarse al de 1000 g
        p_olimpica_500 = _make_product(
            "olimpica",
            "ol-2",
            "Arroz Blanco Diana x 500 g",
            "2400.00",
            ean=None,
            net_content="500.00",
        )
        stats_olimpica_2 = await cdc_olimpica.process_batch([p_olimpica_500])
        self.assertEqual(stats_olimpica_2.master_created, 1)

        # Verificamos que los tres SKUs de 1000 g apuntan al mismo master_product_id
        skus_1000g = {
            row["master_product_id"]
            for (sid, ext), row in gateway.store_skus.items()
            if ext in {"ex-1", "ca-1", "ol-1"}
        }
        self.assertEqual(len(skus_1000g), 1)

        # D1 marca propia (Nivel 3): no se fusiona con Diana pero vincula canonical_category_id
        cdc_d1 = CDCManager(gateway, "d1")
        await cdc_d1.initialize()
        p_d1 = _make_product(
            "d1",
            "d1-1",
            "Arroz Blanco El Molinero 1000 g",
            "3800.00",
            ean=None,
            is_private_label=True,
            canonical_slug="arroz-blanco-1000g",
        )
        stats_d1 = await cdc_d1.process_batch([p_d1])
        self.assertEqual(stats_d1.master_matches_canonical, 1)
        self.assertEqual(len(gateway.master_products), 3)

    async def test_cdc_reduces_inserts_over_92_percent_and_detects_stock_changes(self) -> None:
        gateway = InMemoryGateway()

        # Día 1: carga inicial de 100 SKUs
        day1_items = [
            _make_product(
                "exito",
                f"sku-{i}",
                f"Producto Prueba {i} 500 g",
                f"{3000 + i * 10}.00",
                ean=f"7709990000{i:03d}",
                net_content="500.00",
            )
            for i in range(100)
        ]
        cdc_day1 = CDCManager(gateway, "exito")
        await cdc_day1.initialize()
        await cdc_day1.process_batch(day1_items)
        self.assertEqual(len(gateway.price_records), 100)

        # Día 2 (nuevo proceso que carga v_latest_prices desde cero):
        # 95 sin cambios, 3 con cambio de precio, 2 con cambio de disponibilidad (in_stock=False)
        day2_items = []
        for i in range(100):
            price = f"{3000 + i * 10}.00"
            in_stock = True
            if i in {0, 1, 2}:
                price = f"{3100 + i * 10}.00"
            elif i in {3, 4}:
                in_stock = False
            day2_items.append(
                _make_product(
                    "exito",
                    f"sku-{i}",
                    f"Producto Prueba {i} 500 g",
                    price,
                    ean=f"7709990000{i:03d}",
                    net_content="500.00",
                    in_stock=in_stock,
                )
            )

        gateway.verified_touches.clear()
        cdc_day2 = CDCManager(gateway, "exito")
        await cdc_day2.initialize()
        stats = await cdc_day2.process_batch(day2_items)

        self.assertEqual(stats.total_processed, 100)
        self.assertEqual(stats.unchanged_skipped, 95)
        self.assertEqual(stats.price_or_stock_changes, 5)
        self.assertGreaterEqual(stats.reduction_percentage, 92.0)
        self.assertEqual(len(gateway.price_records), 105)
        self.assertEqual(len(gateway.verified_touches), 100)

    async def test_supabase_gateway_paginates_over_1000_rows(self) -> None:
        requested_ranges: list[tuple[int, int]] = []

        class _FakeQuery:
            def __init__(self, total_rows: int) -> None:
                self._total = total_rows
                self._start = 0
                self._end = 999

            def select(self, cols: str) -> _FakeQuery:
                return self

            def eq(self, col: str, val: Any) -> _FakeQuery:
                return self

            def range(self, start: int, end: int) -> _FakeQuery:
                self._start = start
                self._end = end
                requested_ranges.append((start, end))
                return self

            async def execute(self) -> SimpleNamespace:
                rows = [
                    {
                        "store_sku_id": f"id-{i}",
                        "master_product_id": None,
                        "raw_sale_price": "4500.00",
                        "calibrated_price": "4500.00",
                        "in_stock": True,
                    }
                    for i in range(self._start, min(self._end + 1, self._total))
                ]
                return SimpleNamespace(data=rows)

        fake_client = SimpleNamespace(table=lambda name: _FakeQuery(total_rows=1250))
        gateway = SupabaseGateway(fake_client)
        rows = await gateway.fetch_latest_prices("exito")

        self.assertEqual(len(rows), 1250)
        self.assertEqual(requested_ranges, [(0, 999), (1000, 1999)])

    async def test_supabase_gateway_recycles_client_and_retries_remote_protocol_error(self) -> None:
        calls = 0
        closed_sessions = 0
        created_clients = 0

        class _FakeSession:
            async def aclose(self) -> None:
                nonlocal closed_sessions
                closed_sessions += 1

        class _FakeQuery:
            def __init__(self, fail_first: bool) -> None:
                self._fail_first = fail_first

            def select(self, cols: str) -> _FakeQuery:
                return self

            def eq(self, col: str, val: Any) -> _FakeQuery:
                return self

            def range(self, start: int, end: int) -> _FakeQuery:
                return self

            async def execute(self) -> SimpleNamespace:
                nonlocal calls
                calls += 1
                if self._fail_first and calls == 1:
                    raise httpx.RemoteProtocolError("ConnectionTerminated last_stream_id:19999")
                return SimpleNamespace(data=[{"slug": "arroz-blanco-1000g", "id": 1}])

        async def fake_factory() -> SimpleNamespace:
            nonlocal created_clients
            created_clients += 1
            return SimpleNamespace(
                postgrest=SimpleNamespace(session=_FakeSession()),
                table=lambda name: _FakeQuery(fail_first=(created_clients == 1)),
            )

        initial_client = await fake_factory()
        gateway = SupabaseGateway(
            initial_client,
            client_factory=fake_factory,
            max_requests_before_recycle=10,
        )
        categories = await gateway.fetch_canonical_categories()

        self.assertEqual(categories, {"arroz-blanco-1000g": 1})
        self.assertEqual(calls, 2)
        self.assertEqual(closed_sessions, 1)
        self.assertEqual(created_clients, 2)

    async def test_cdc_skips_out_of_range_numeric_pum(self) -> None:
        gateway = InMemoryGateway()
        cdc = CDCManager(gateway, "olimpica")
        await cdc.initialize()
        valid = _make_product("olimpica", "ol-ok", "Televisor 100 und", "1899000.00", net_content="1.00", unit=UnitMeasure.UND)
        extreme = ScrapedProduct(
            store_id="olimpica",
            external_sku="ol-overflow",
            raw_name="Referencia Corrupta 1 g",
            normalized_name="referencia corrupta 1 g",
            raw_list_price=Decimal("9999999999999.00"),
            raw_sale_price=Decimal("9999999999999.00"),
            calibrated_price=Decimal("9999999999999.00"),
            net_content=Decimal("1.00"),
            unit_measure=UnitMeasure.G,
            pum_price=Decimal("9999999999999.0000"),
            in_stock=True,
            source_origin="vtex_api",
        )
        await cdc.process_batch([valid, extreme])
        self.assertEqual(len(gateway.price_records), 1)
        self.assertEqual(gateway.price_records[0]["pum_price"], "1899000.0000")


if __name__ == "__main__":
    unittest.main()
