"""Pruebas unitarias para consolidación local, CDC sin precio<=0 y dedup exacta en SQLite."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from etl.consolidate_local_db import consolidate_and_optimize
from etl.core.cdc_manager import CDCManager, InMemoryGateway
from etl.core.grocery_filter import is_mercado_product
from etl.core.local_gateway import LocalSqliteGateway
from etl.core.models import ScrapedProduct, UnitMeasure


def _mk_prod(
    store_id: str,
    sku: str,
    name: str,
    price: str,
    *,
    ean: str | None = None,
    in_stock: bool = True,
    brand: str | None = "Diana",
    net_content: Decimal = Decimal("1000.00"),
    unit_measure: UnitMeasure = UnitMeasure.G,
) -> ScrapedProduct:
    dec = Decimal(price)
    return ScrapedProduct(
        store_id=store_id,
        external_sku=sku,
        ean=ean,
        raw_name=name,
        normalized_name=" ".join(name.lower().split()),
        brand=brand,
        raw_list_price=dec,
        raw_sale_price=dec,
        calibrated_price=dec,
        net_content=net_content,
        unit_measure=unit_measure,
        pum_price=(dec / net_content).quantize(Decimal("0.0001")),
        in_stock=in_stock,
        source_origin="vtex_api",
        is_private_label=False,
    )


class OptimizationUnitTests(unittest.IsolatedAsyncioTestCase):
    async def test_cdc_skips_new_zero_price_but_tracks_existing_oos(self) -> None:
        gw = InMemoryGateway()
        cdc = CDCManager(gw, "exito")
        await cdc.initialize()

        # SKU nuevo con precio 0 no debe insertarse
        await cdc.process_batch([_mk_prod("exito", "zero-new", "Arroz 1000 g", "0.00", in_stock=False)])
        self.assertEqual(len(gw.store_skus), 0)

        # SKU existente con precio positivo luego pasa a agotado -> sí actualiza
        await cdc.process_batch([_mk_prod("exito", "ok-1", "Arroz Diana 1000 g", "4500.00", in_stock=True)])
        await cdc.process_batch([_mk_prod("exito", "ok-1", "Arroz Diana 1000 g", "4500.00", in_stock=False)])
        self.assertEqual(len(gw.store_skus), 1)
        self.assertEqual(len(gw.price_records), 2)

    async def test_local_gateway_exact_match_before_trgm_limit_and_null_vtags(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "gw.db"
            gw = LocalSqliteGateway(db_path)
            try:
                cdc = CDCManager(gw, "exito")
                await cdc.initialize()
                # Insertar >260 productos distintos con igual net_content/unit para saturar LIMIT 250
                batch = [
                    _mk_prod("exito", f"s-{i}", f"Producto Distinto Numero {i} 1000 g", "5000.00")
                    for i in range(260)
                ]
                await cdc.process_batch(batch)

                # La tienda 2 con exacto nombre del producto 255 sin EAN debe cruzar sin duplicar master
                cdc2 = CDCManager(gw, "carulla")
                await cdc2.initialize()
                st2 = await cdc2.process_batch(
                    [_mk_prod("carulla", "c-255", "Producto Distinto Numero 255 1000 g", "5200.00")]
                )
                self.assertEqual(st2.master_matches_trgm, 1)

                null_vtags = gw._conn.execute(
                    "SELECT COUNT(*) FROM store_skus WHERE variant_tags_json IS NULL"
                ).fetchone()[0]
                self.assertEqual(null_vtags, 261)
            finally:
                await gw.aclose()

    def test_grocery_filter_excludes_manicure_and_pet_collars_keeps_legit_items(self) -> None:
        self.assertFalse(is_mercado_product("carulla", "Kit Para Decoración De Uñas"))
        self.assertFalse(is_mercado_product("farmatodo", "Set de Manicure para Bebe"))
        self.assertFalse(is_mercado_product("jumbo", "Collar Gato Pet Attire Rosado"))
        self.assertFalse(is_mercado_product("mercaldas", "Correa PRANA retractil 3 metros para mascotas"))
        self.assertFalse(is_mercado_product("carulla", "Cigarrilo ROTHMANS POLAR XL (10 und)"))
        self.assertFalse(is_mercado_product("euro", "MARLBORO BLUE SELECTION KS X20"))
        self.assertFalse(is_mercado_product("carulla", "Cronografo INVICTA (1 und)"))
        self.assertFalse(is_mercado_product("d1", "Kit #3 Donación - Alimentos"))
        self.assertFalse(is_mercado_product("carulla", "Preparación Del Pedido 0000"))
        self.assertFalse(is_mercado_product("d1", "Peluche Halloween Dulce o Trcuo X 1 Ud"))
        self.assertFalse(is_mercado_product("jumbo", "Disfraz de Comando Gamer Talla 10"))
        self.assertFalse(is_mercado_product("ara", "VINO ESPU JP CHENET ICE ROS/BLAN X 750 ML."))
        self.assertFalse(is_mercado_product("ara", "RON ESENCIAL VIEJO DE CALDAS BOTELLA X 750 ML."))
        self.assertFalse(is_mercado_product("euro", "EPOD BLUEBERRY ICE V2 *34ML"))
        self.assertFalse(is_mercado_product("ara", "UNGENTO VICK VAPORUB LATA X 12 GR."))
        self.assertFalse(is_mercado_product("carulla", "Tinte para cabello LUMINANCE rubio muy claro (1 und)"))
        self.assertFalse(is_mercado_product("ara", "SERUM FACIAL BE BEAUTY VITAMINA C X 40 ML."))
        self.assertFalse(is_mercado_product("farmatodo", "500 Pesos De Propina"))
        self.assertTrue(is_mercado_product("farmatodo", "Portacomidas Termico Con Correa"))
        self.assertTrue(is_mercado_product("amy", "Aderezo ZENÚ pollo con champiñones al vino 160g"))
        self.assertTrue(is_mercado_product("exito", "Donas Glaseadas x 6 und"))
        self.assertTrue(is_mercado_product("ara", "CHORIZO DON JULIO SANTARROSANO X300G"))
        self.assertTrue(is_mercado_product("amy", "Lavaplatos AXION limón repuesto 130g"))

    def test_consolidate_merges_supabase_and_local_removes_zero_and_dups(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            sb_db = tmp_dir / "sb.db"
            lc_db = tmp_dir / "lc.db"
            out_db = tmp_dir / "out.db"

            # Crear snapshot simulado de Supabase
            sb = sqlite3.connect(sb_db)
            sb.executescript(
                """
                CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT, channel_type TEXT, markup_discount_factor TEXT, updated_at TEXT);
                CREATE TABLE canonical_categories (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, base_unit TEXT);
                CREATE TABLE master_products (id TEXT PRIMARY KEY, ean TEXT, canonical_category_id INTEGER, normalized_name TEXT, brand TEXT, net_content TEXT, unit_measure TEXT, is_private_label INTEGER, image_url TEXT, created_at TEXT, invima_registry TEXT, actual_manufacturer TEXT, positive_votes INTEGER, total_votes INTEGER, avg_yield_factor TEXT, shrinkflation_alert INTEGER, previous_net_content TEXT, product_type TEXT, sub_presentation TEXT, sub_presentation_label TEXT);
                CREATE TABLE store_skus (id TEXT PRIMARY KEY, store_id TEXT, master_product_id TEXT, external_sku TEXT, raw_name TEXT, raw_url TEXT, last_verified_at TEXT, is_mercado INTEGER, available_cities_json TEXT, display_name TEXT, product_type TEXT, sub_presentation TEXT, sub_presentation_label TEXT, variant_tags_json TEXT, is_deprecated_candidate INTEGER, deprecated_reason TEXT, rappi_promo_price TEXT, rappi_savings_cop TEXT, rappi_savings_pct TEXT, rappi_promo_url TEXT, rappi_promo_updated_at TEXT);
                CREATE TABLE price_records (id INTEGER PRIMARY KEY, store_sku_id TEXT, raw_list_price TEXT, raw_sale_price TEXT, calibrated_price TEXT, pum_price TEXT, in_stock INTEGER, source_origin TEXT, captured_at TEXT);
                CREATE TABLE product_price_daily (master_product_id TEXT, store_id TEXT, day TEXT, min_price TEXT, median_price TEXT, samples_count INTEGER, PRIMARY KEY (master_product_id, store_id, day));
                CREATE TABLE product_curation_overrides (store_sku_id TEXT PRIMARY KEY, master_product_id TEXT, override_subtype TEXT, override_broad_family TEXT, override_quality_tier TEXT, review_status TEXT, doubt_reason TEXT, admin_notes TEXT, updated_at TEXT);
                CREATE TABLE store_branches (id TEXT PRIMARY KEY, store_id TEXT, branch_name TEXT, city TEXT, address TEXT, location_wkt TEXT, created_at TEXT, department TEXT, barrio TEXT, source_provider TEXT, external_place_id TEXT);

                INSERT INTO canonical_categories VALUES (1, 'arroz-blanco-1000g', 'Arroz', 'g');
                INSERT INTO master_products VALUES ('mp-sb-1', '770111', 1, 'arroz diana 1000 g', 'Diana', '1000.00', 'g', 0, NULL, '2026-11-12', 'INV-1', NULL, 5, 6, '1.0', 0, NULL, NULL, NULL, NULL);
                INSERT INTO store_skus VALUES ('ss-sb-1', 'olimpica', 'mp-sb-1', 'ol-1', 'Arroz Diana 1000g', NULL, '2026-11-12', 1, '["bogota"]', NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL);
                INSERT INTO price_records VALUES (1, 'ss-sb-1', '4500.00', '4500.00', '4500.00', '4.5000', 1, 'vtex', '2026-11-12');
                INSERT INTO store_skus VALUES ('ss-sb-zero', 'carulla', 'mp-sb-1', 'ca-zero', 'Arroz Diana 1000g', NULL, '2026-11-12', 1, NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL);
                INSERT INTO price_records VALUES (2, 'ss-sb-zero', '0.00', '0.00', '0.00', '0.0000', 0, 'vtex', '2026-11-12');
                """
            )
            sb.commit()
            sb.close()

            # Crear local_staging con tienda nueva, duplicado intra-tienda y sin-EAN duplicado
            lc = sqlite3.connect(lc_db)
            lc.executescript(
                """
                CREATE TABLE canonical_categories (id INTEGER PRIMARY KEY, slug TEXT UNIQUE);
                CREATE TABLE master_products (id TEXT PRIMARY KEY, ean TEXT UNIQUE, canonical_category_id INTEGER, normalized_name TEXT, brand TEXT, net_content TEXT, unit_measure TEXT, image_url TEXT, is_private_label INTEGER, product_type TEXT, sub_presentation TEXT, sub_presentation_label TEXT, shrinkflation_alert INTEGER, previous_net_content TEXT, created_at TEXT);
                CREATE TABLE store_skus (id TEXT PRIMARY KEY, store_id TEXT, master_product_id TEXT, external_sku TEXT, raw_name TEXT, display_name TEXT, raw_url TEXT, product_type TEXT, sub_presentation TEXT, sub_presentation_label TEXT, variant_tags_json TEXT, last_verified_at TEXT);
                CREATE TABLE price_records (id INTEGER PRIMARY KEY, store_sku_id TEXT, raw_list_price TEXT, raw_sale_price TEXT, calibrated_price TEXT, pum_price TEXT, in_stock INTEGER, source_origin TEXT, captured_at TEXT);

                INSERT INTO canonical_categories VALUES (1, 'arroz-blanco-1000g');
                INSERT INTO master_products VALUES ('mp-lc-1', NULL, NULL, 'leche colanta 1000 ml', 'Colanta', '1000.00', 'ml', NULL, 0, NULL, NULL, NULL, 0, NULL, '2026-11-20');
                INSERT INTO master_products VALUES ('mp-lc-2', NULL, NULL, 'leche colanta 1000 ml', 'Colanta', '1000.00', 'ml', 'https://img', 0, NULL, NULL, NULL, 0, NULL, '2026-11-20');
                INSERT INTO master_products VALUES ('mp-lc-3', NULL, NULL, 'arroz diana 1000 g', 'Diana', '1000.00', 'g', NULL, 0, NULL, NULL, NULL, 0, NULL, '2026-11-20');
                INSERT INTO store_skus VALUES ('ss-lc-1', 'metro', 'mp-lc-1', 'm-1', 'Leche Colanta 1000 ml', NULL, 'https://u', NULL, NULL, NULL, '[]', '2026-11-20');
                INSERT INTO store_skus VALUES ('ss-lc-2', 'metro', 'mp-lc-2', 'm-2', 'Leche Colanta 1000 ml', NULL, NULL, NULL, NULL, NULL, '[]', '2026-11-20');
                INSERT INTO store_skus VALUES ('ss-lc-3', 'supermu', 'mp-lc-3', 'sm-3', 'Arroz Diana 1000 g', NULL, NULL, NULL, NULL, NULL, '[]', '2026-11-20');
                INSERT INTO price_records VALUES (1, 'ss-lc-1', '4200.00', '4200.00', '4200.00', '4.2000', 1, 'vtex', '2026-11-20');
                INSERT INTO price_records VALUES (2, 'ss-lc-2', '4200.00', '4200.00', '4200.00', '4.2000', 1, 'vtex', '2026-11-20');
                INSERT INTO price_records VALUES (3, 'ss-lc-3', '4600.00', '4600.00', '4600.00', '4.6000', 1, 'shopify', '2026-11-20');
                """
            )
            lc.commit()
            lc.close()

            st = consolidate_and_optimize(
                supabase_db=sb_db, local_db=lc_db, output_db=out_db, replace_local=False
            )
            self.assertEqual(st.dropped_never_positive, 1)
            self.assertEqual(st.deduped_masters_no_ean, 1)
            self.assertEqual(st.deduped_masters_ean_vs_no_ean, 1)
            self.assertEqual(st.deduped_intra_store_skus, 1)
            self.assertEqual(st.final_store_skus, 3)  # ol-1 (SB) + 1 ganador metro + sm-3 (supermu)
            self.assertEqual(st.final_master_products, 2)

            res_conn = sqlite3.connect(out_db)
            invima = res_conn.execute("SELECT invima_registry FROM master_products WHERE id = 'mp-sb-1'").fetchone()[0]
            self.assertEqual(invima, "INV-1")
            res_conn.close()

    def test_collision_split_and_exhausted_oos_pruning(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sb_db = Path(tmp) / "sb.db"
            lc_db = Path(tmp) / "lc.db"
            out_db = Path(tmp) / "out.db"

            sb = sqlite3.connect(sb_db)
            sb.executescript(
                """
                CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT, channel_type TEXT, markup_discount_factor TEXT, updated_at TEXT);
                CREATE TABLE canonical_categories (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, base_unit TEXT);
                CREATE TABLE master_products (id TEXT PRIMARY KEY, ean TEXT, canonical_category_id INTEGER, normalized_name TEXT, brand TEXT, net_content TEXT, unit_measure TEXT, is_private_label INTEGER, image_url TEXT, created_at TEXT, invima_registry TEXT, actual_manufacturer TEXT, positive_votes INTEGER, total_votes INTEGER, avg_yield_factor TEXT, shrinkflation_alert INTEGER, previous_net_content TEXT, product_type TEXT, sub_presentation TEXT, sub_presentation_label TEXT);
                CREATE TABLE store_skus (id TEXT PRIMARY KEY, store_id TEXT, master_product_id TEXT, external_sku TEXT, raw_name TEXT, raw_url TEXT, last_verified_at TEXT, is_mercado INTEGER, available_cities_json TEXT, display_name TEXT, product_type TEXT, sub_presentation TEXT, sub_presentation_label TEXT, variant_tags_json TEXT, is_deprecated_candidate INTEGER, deprecated_reason TEXT, rappi_promo_price TEXT, rappi_savings_cop TEXT, rappi_savings_pct TEXT, rappi_promo_url TEXT, rappi_promo_updated_at TEXT);
                CREATE TABLE price_records (id INTEGER PRIMARY KEY, store_sku_id TEXT, raw_list_price TEXT, raw_sale_price TEXT, calibrated_price TEXT, pum_price TEXT, in_stock INTEGER, source_origin TEXT, captured_at TEXT);
                CREATE TABLE product_price_daily (master_product_id TEXT, store_id TEXT, day TEXT, min_price TEXT, median_price TEXT, samples_count INTEGER, PRIMARY KEY (master_product_id, store_id, day));
                CREATE TABLE product_curation_overrides (store_sku_id TEXT PRIMARY KEY, master_product_id TEXT, override_subtype TEXT, override_broad_family TEXT, override_quality_tier TEXT, review_status TEXT, doubt_reason TEXT, admin_notes TEXT, updated_at TEXT);
                CREATE TABLE store_branches (id TEXT PRIMARY KEY, store_id TEXT, branch_name TEXT, city TEXT, address TEXT, location_wkt TEXT, created_at TEXT, department TEXT, barrio TEXT, source_provider TEXT, external_place_id TEXT);

                INSERT INTO stores VALUES ('exito', 'Éxito', 'retailer', '1.0000', NULL);
                INSERT INTO stores VALUES ('d1', 'D1', 'hard_discount', '1.0000', NULL);
                INSERT INTO stores VALUES ('canaveral', 'Cañaveral', 'retailer', '1.0000', NULL);
                INSERT INTO canonical_categories VALUES (1, 'arroz-blanco-1000g', 'Arroz Blanco', 'g');

                -- Maestro contaminado por colisión: Arroz Diana + Arroz Blanquita + Cooltivo bajo mismo master_id
                INSERT INTO master_products VALUES ('mp-col-arroz', '7702511000014', 1, 'arroz diana 500 g', 'Diana', '500.00', 'g', 0, 'https://diana.png', '2026-11-10', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL);
                INSERT INTO store_skus VALUES ('ss-diana', 'exito', 'mp-col-arroz', 'ex-1', 'Arroz DIANA 500 g', NULL, '2026-11-12', 1, NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL);
                INSERT INTO store_skus VALUES ('ss-blanquita', 'canaveral', 'mp-col-arroz', 'ca-1', 'Arroz BLANQUITA 500 g', NULL, '2026-11-12', 1, NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL);
                INSERT INTO store_skus VALUES ('ss-cooltivo', 'd1', 'mp-col-arroz', 'd1-1', 'Arroz COOLTIVO 500 g', NULL, '2026-11-12', 1, NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL);
                INSERT INTO price_records VALUES (1, 'ss-diana', '2500.00', '2500.00', '2500.00', '5.0000', 1, 'vtex', '2026-11-12');
                INSERT INTO price_records VALUES (2, 'ss-blanquita', '2400.00', '2400.00', '2400.00', '4.8000', 1, 'vtex', '2026-11-12');
                INSERT INTO price_records VALUES (3, 'ss-cooltivo', '2100.00', '2100.00', '2100.00', '4.2000', 1, 'd1', '2026-11-12');

                -- Duplicados agotados intra-tienda con distinto precio histórico
                INSERT INTO master_products VALUES ('mp-mant', '7702001020096', NULL, 'mantequilla alpina sin sal 125 g', 'Alpina', '125.00', 'g', 0, NULL, '2026-11-10', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL);
                INSERT INTO store_skus VALUES ('ss-m-1', 'exito', 'mp-mant', 'ex-m1', 'Mantequilla Alpina Sin Sal 125g', NULL, '2026-11-10', 1, NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL);
                INSERT INTO store_skus VALUES ('ss-m-2', 'exito', 'mp-mant', 'ex-m2', 'Mantequilla Alpina Sin Sal 125g', NULL, '2026-11-11', 1, NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL);
                INSERT INTO store_skus VALUES ('ss-m-3', 'exito', 'mp-mant', 'ex-m3', 'Mantequilla Alpina Con Sal 125g', NULL, '2026-11-12', 1, NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL);
                INSERT INTO price_records VALUES (4, 'ss-m-1', '5000.00', '5000.00', '5000.00', '40.0000', 0, 'vtex', '2026-11-10');
                INSERT INTO price_records VALUES (5, 'ss-m-2', '5500.00', '5500.00', '5500.00', '44.0000', 0, 'vtex', '2026-11-11');
                INSERT INTO price_records VALUES (6, 'ss-m-3', '5600.00', '5600.00', '5600.00', '44.8000', 1, 'vtex', '2026-11-12');
                """
            )
            sb.commit()
            sb.close()

            st = consolidate_and_optimize(
                supabase_db=sb_db, local_db=lc_db, output_db=out_db, replace_local=False
            )
            self.assertGreaterEqual(st.split_colliding_masters, 2)
            self.assertEqual(st.pruned_exhausted_dupes, 1)

            conn = sqlite3.connect(out_db)
            try:
                arroz_mids = {
                    r[0]
                    for r in conn.execute(
                        "SELECT master_product_id FROM store_skus WHERE id IN ('ss-diana', 'ss-blanquita', 'ss-cooltivo')"
                    ).fetchall()
                }
                self.assertEqual(len(arroz_mids), 3)
                mant_sin_sal_count = conn.execute(
                    "SELECT COUNT(*) FROM store_skus WHERE raw_name = 'Mantequilla Alpina Sin Sal 125g'"
                ).fetchone()[0]
                self.assertEqual(mant_sin_sal_count, 1)
            finally:
                conn.close()

    async def test_trigram_blocks_distinct_brands_in_local_and_memory_gateways(self) -> None:
        from etl.core.entity_resolver import EntityResolver

        for gateway in (InMemoryGateway(),):
            resolver = EntityResolver(gateway)
            p1 = _mk_prod(
                "exito",
                "z1",
                "Arveja con Zanahoria Zenu 300 g",
                "4500.00",
                brand="Zenu",
                net_content=Decimal("300.00"),
            )
            p2 = _mk_prod(
                "metro",
                "sj1",
                "Arveja con Zanahoria San Jorge 300 g",
                "4200.00",
                brand="San Jorge",
                net_content=Decimal("300.00"),
            )
            p3 = _mk_prod(
                "carulla",
                "c1",
                "Coca Cola 1500 ml",
                "5500.00",
                brand="Coca-Cola",
                net_content=Decimal("1500.00"),
                unit_measure=UnitMeasure.ML,
            )
            p4 = _mk_prod(
                "jumbo",
                "c2",
                "Coca Cola Zero Sin Azucar 1500 ml",
                "5500.00",
                brand="Coca-Cola",
                net_content=Decimal("1500.00"),
                unit_measure=UnitMeasure.ML,
            )
            cdc = CDCManager(gateway, "exito")
            await cdc.process_batch([p1])
            res_p2 = await resolver.resolve_batch([p2])
            res_p1 = await resolver.resolve_batch([p1])
            self.assertNotEqual(res_p2["sj1"].master_product_id, res_p1["z1"].master_product_id)

            res_p3 = await resolver.resolve_batch([p3])
            await cdc.process_batch([p3])
            res_p4 = await resolver.resolve_batch([p4])
            self.assertNotEqual(res_p4["c2"].master_product_id, res_p3["c1"].master_product_id)

        with tempfile.TemporaryDirectory() as tmp:
            lgw = LocalSqliteGateway(Path(tmp) / "t.db")
            m1 = await lgw.create_master_product(
                {
                    "normalized_name": "arveja con zanahoria zenu 300 g",
                    "brand": "Zenu",
                    "net_content": "300.00",
                    "unit_measure": "g",
                    "is_private_label": False,
                }
            )
            no_match = await lgw.match_master_product_trgm(
                "arveja con zanahoria san jorge 300 g",
                Decimal("300.00"),
                "g",
                threshold=0.65,
                brand="San Jorge",
            )
            self.assertIsNone(no_match)
            yes_match = await lgw.match_master_product_trgm(
                "arveja con zanahoria zenu x 300 g",
                Decimal("300.00"),
                "g",
                threshold=0.65,
                brand="Zenu",
            )
            self.assertEqual(yes_match, m1)
            await lgw.aclose()

    def test_import_llm_v2_local_handles_missing_headers_soft_wraps_and_splits(self) -> None:
        from etl.import_llm_v2_local import apply_llm_v2_to_local_db

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "local.db"
            index_path = root / "index.txt"
            v2_dir = root / "v2"
            res_dir = v2_dir / "Resultado"
            res_dir.mkdir(parents=True)

            m_ok = "11111111-1111-1111-1111-111111111111"
            m_no = "22222222-2222-2222-2222-222222222222"
            m_sec_a_keep = "33333333-3333-3333-3333-333333333333"
            m_sec_a_drop = "44444444-4444-4444-4444-444444444444"
            m_sec_b_split = "55555555-5555-5555-5555-555555555555"

            conn = sqlite3.connect(db_path)
            conn.executescript(
                f"""
                CREATE TABLE canonical_categories (id INTEGER PRIMARY KEY, slug TEXT UNIQUE);
                CREATE TABLE master_products (id TEXT PRIMARY KEY, ean TEXT UNIQUE, canonical_category_id INTEGER, normalized_name TEXT, brand TEXT, net_content TEXT, unit_measure TEXT, image_url TEXT, is_private_label INTEGER, product_type TEXT, sub_presentation TEXT, sub_presentation_label TEXT, shrinkflation_alert INTEGER, previous_net_content TEXT, created_at TEXT);
                CREATE TABLE store_skus (id TEXT PRIMARY KEY, store_id TEXT, master_product_id TEXT, external_sku TEXT, raw_name TEXT, display_name TEXT, raw_url TEXT, product_type TEXT, sub_presentation TEXT, sub_presentation_label TEXT, variant_tags_json TEXT, last_verified_at TEXT);
                CREATE TABLE price_records (id INTEGER PRIMARY KEY, store_sku_id TEXT, raw_list_price TEXT, raw_sale_price TEXT, calibrated_price TEXT, pum_price TEXT, in_stock INTEGER, source_origin TEXT, captured_at TEXT);
                CREATE TABLE product_price_daily (master_product_id TEXT, store_id TEXT, day TEXT, min_price TEXT, median_price TEXT, samples_count INTEGER, PRIMARY KEY (master_product_id, store_id, day));
                CREATE TABLE product_curation_overrides (store_sku_id TEXT PRIMARY KEY, master_product_id TEXT);

                INSERT INTO canonical_categories VALUES (1, 'salsas-y-condimentos'), (2, 'panaderia-y-arepas'), (3, 'vinos-cervezas-y-licores'), (4, 'frutas-y-verduras');
                INSERT INTO master_products VALUES ('{m_ok}', NULL, NULL, 'sal rosada', 'Himalaya', '110.00', 'g', NULL, 0, NULL, NULL, NULL, 0, NULL, '2026-11-21');
                INSERT INTO master_products VALUES ('{m_no}', NULL, NULL, 'cargador usb', 'Generico', '1.00', 'und', NULL, 0, NULL, NULL, NULL, 0, NULL, '2026-11-21');
                INSERT INTO master_products VALUES ('{m_sec_a_keep}', NULL, 3, 'ponque vino bimbo', 'Bimbo', '400.00', 'g', NULL, 0, NULL, NULL, NULL, 0, NULL, '2026-11-21');
                INSERT INTO master_products VALUES ('{m_sec_a_drop}', NULL, 3, 'vino tinto', 'Gato Negro', '750.00', 'ml', NULL, 0, NULL, NULL, NULL, 0, NULL, '2026-11-21');
                INSERT INTO master_products VALUES ('{m_sec_b_split}', '2821080000000', 4, 'coliflor', NULL, '500.00', 'g', NULL, 0, NULL, NULL, NULL, 0, NULL, '2026-11-21');

                INSERT INTO store_skus VALUES ('sk-ok', 'exito', '{m_ok}', 'e1', 'Sal Rosada 110g', NULL, NULL, NULL, NULL, NULL, NULL, '2026-11-21');
                INSERT INTO store_skus VALUES ('sk-no', 'exito', '{m_no}', 'e2', 'Cargador USB', NULL, NULL, NULL, NULL, NULL, NULL, '2026-11-21');
                INSERT INTO store_skus VALUES ('sk-ak', 'carulla', '{m_sec_a_keep}', 'c1', 'Ponque Vino Bimbo 400g', NULL, NULL, NULL, NULL, NULL, NULL, '2026-11-21');
                INSERT INTO store_skus VALUES ('sk-ad', 'carulla', '{m_sec_a_drop}', 'c2', 'Vino Tinto 750ml', NULL, NULL, NULL, NULL, NULL, NULL, '2026-11-21');
                INSERT INTO store_skus VALUES ('sk-b1', 'ara', '{m_sec_b_split}', 'a1', 'Coliflor x 500 g', NULL, NULL, NULL, NULL, NULL, NULL, '2026-11-21');
                INSERT INTO store_skus VALUES ('sk-b2', 'jumbo', '{m_sec_b_split}', 'j1', 'Yuca x 500 g', NULL, NULL, NULL, NULL, NULL, NULL, '2026-11-21');

                INSERT INTO price_records VALUES (1, 'sk-ok', '5000', '5000', '5000', '45.45', 1, 'vtex', '2026-11-21');
                INSERT INTO price_records VALUES (2, 'sk-no', '25000', '25000', '25000', '25000', 1, 'vtex', '2026-11-21');
                INSERT INTO price_records VALUES (3, 'sk-ak', '12000', '12000', '12000', '30.0', 1, 'vtex', '2026-11-21');
                INSERT INTO price_records VALUES (4, 'sk-ad', '35000', '35000', '35000', '46.6', 1, 'vtex', '2026-11-21');
                INSERT INTO price_records VALUES (5, 'sk-b1', '4000', '4000', '4000', '8.0', 1, 'ara', '2026-11-21');
                INSERT INTO price_records VALUES (6, 'sk-b2', '3000', '3000', '3000', '6.0', 1, 'vtex', '2026-11-21');
                """
            )
            conn.commit()
            conn.close()

            index_path.write_text(
                f"row_id\tmaster_product_id\n1\t{m_ok}\n2\t{m_no}\n",
                encoding="utf-8",
            )
            # Archivo sin encabezado y con dos registros en la misma línea (soft wrap)
            (res_dir / "Lote 1.txt").write_text(
                "1\tsalsas-y-condimentos\tOK 2\t\tNO_MERCADO\n",
                encoding="utf-8",
            )
            (v2_dir / "llm_revision_semantica_resultado.txt").write_text(
                f"--- SECCIÓN A ---\n"
                f"{m_sec_a_keep}\tMANTENER_MERCADO\tpanaderia-y-arepas\tPonqué\n"
                f"de panadería {m_sec_a_drop}\tEXCLUIR_NO_MERCADO\t\tLicor\n"
                f"--- SECCIÓN B: COLISIONES ---\n"
                f"{m_sec_b_split}\tSEPARAR_VARIANTES\tColiflor vs\nYuca\n",
                encoding="utf-8",
            )

            st = apply_llm_v2_to_local_db(
                db_path=db_path,
                llm_v2_dir=v2_dir,
                index_path=index_path,
                create_backup=False,
            )
            self.assertEqual(st.masters_categorized_ok, 1)
            self.assertEqual(st.masters_kept_sec_a, 1)
            self.assertEqual(st.skus_purged_no_mercado, 2)
            self.assertEqual(st.masters_split_sec_b, 1)

            chk = sqlite3.connect(db_path)
            try:
                self.assertEqual(
                    chk.execute("SELECT canonical_category_id FROM master_products WHERE id = ?", (m_ok,)).fetchone()[0],
                    1,
                )
                self.assertEqual(
                    chk.execute("SELECT canonical_category_id FROM master_products WHERE id = ?", (m_sec_a_keep,)).fetchone()[0],
                    2,
                )
                b1_mid = chk.execute("SELECT master_product_id FROM store_skus WHERE id = 'sk-b1'").fetchone()[0]
                b2_mid = chk.execute("SELECT master_product_id FROM store_skus WHERE id = 'sk-b2'").fetchone()[0]
                self.assertNotEqual(b1_mid, b2_mid)
                self.assertEqual(chk.execute("SELECT COUNT(*) FROM store_skus").fetchone()[0], 4)
            finally:
                chk.close()

    def test_import_llm_anomalies_local_reclassifies_and_purges_respecting_overrides(self) -> None:
        from etl.import_llm_anomalies_local import apply_llm_anomalies_to_local_db

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "local.db"
            index_path = root / "anom_index.txt"
            res_dir = root / "R"
            res_dir.mkdir(parents=True)

            m_reclas = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
            m_drop = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
            m_keep = "cccccccc-cccc-cccc-cccc-cccccccccccc"
            m_prot = "dddddddd-dddd-dddd-dddd-dddddddddddd"

            conn = sqlite3.connect(db_path)
            conn.executescript(
                f"""
                CREATE TABLE canonical_categories (id INTEGER PRIMARY KEY, slug TEXT UNIQUE);
                CREATE TABLE master_products (id TEXT PRIMARY KEY, canonical_category_id INTEGER, normalized_name TEXT);
                CREATE TABLE store_skus (id TEXT PRIMARY KEY, store_id TEXT, master_product_id TEXT, raw_name TEXT);
                CREATE TABLE price_records (id INTEGER PRIMARY KEY, store_sku_id TEXT, raw_sale_price TEXT);
                CREATE TABLE product_price_daily (master_product_id TEXT, store_id TEXT, day TEXT, PRIMARY KEY (master_product_id, store_id, day));
                CREATE TABLE product_curation_overrides (store_sku_id TEXT PRIMARY KEY, master_product_id TEXT);

                INSERT INTO canonical_categories VALUES (1, 'lacteos-y-leches'), (2, 'cuidado-personal-e-higiene'), (3, 'bebes-y-maternidad');
                INSERT INTO master_products VALUES ('{m_reclas}', 1, 'termoprotector leche y miel'), ('{m_drop}', 3, 'silla comedor bebe'), ('{m_keep}', 2, 'shampoo herbal'), ('{m_prot}', 3, 'coche protegido');
                INSERT INTO store_skus VALUES ('sk-r', 'exito', '{m_reclas}', 'Termoprotector'), ('sk-d', 'exito', '{m_drop}', 'Silla Bebe'), ('sk-k', 'd1', '{m_keep}', 'Shampoo'), ('sk-p', 'd1', '{m_prot}', 'Coche Protegido');
                INSERT INTO price_records VALUES (1, 'sk-r', '25000'), (2, 'sk-d', '350000'), (3, 'sk-k', '12000'), (4, 'sk-p', '450000');
                INSERT INTO product_price_daily VALUES ('{m_drop}', 'exito', '2026-11-23'), ('{m_keep}', 'd1', '2026-11-23');
                INSERT INTO product_curation_overrides VALUES ('sk-p', '{m_prot}');
                """
            )
            conn.commit()
            conn.close()

            index_path.write_text(
                f"row_id\tmaster_product_id\n1\t{m_reclas}\n2\t{m_drop}\n3\t{m_keep}\n4\t{m_prot}\n",
                encoding="utf-8",
            )
            (res_dir / "A1.txt").write_text(
                "1\tRECLASIFICAR\tcuidado-personal-e-higiene 2\tEXCLUIR_NO_MERCADO\n"
                "3\tMANTENER\n4\tEXCLUIR_NO_MERCADO\n",
                encoding="utf-8",
            )

            st = apply_llm_anomalies_to_local_db(
                db_path=db_path,
                results_dir=res_dir,
                index_path=index_path,
                create_backup=False,
            )
            self.assertEqual(st.reclassify_rows, 1)
            self.assertEqual(st.exclude_rows, 2)
            self.assertEqual(st.keep_rows, 1)
            self.assertEqual(st.invalid_slug_rows, 0)
            self.assertEqual(st.masters_purged, 1)
            self.assertEqual(st.skus_purged, 1)

            chk = sqlite3.connect(db_path)
            try:
                self.assertEqual(
                    chk.execute("SELECT canonical_category_id FROM master_products WHERE id = ?", (m_reclas,)).fetchone()[0],
                    2,
                )
                self.assertIsNone(
                    chk.execute("SELECT 1 FROM master_products WHERE id = ?", (m_drop,)).fetchone()
                )
                self.assertIsNotNone(
                    chk.execute("SELECT 1 FROM master_products WHERE id = ?", (m_prot,)).fetchone()
                )
                self.assertEqual(chk.execute("SELECT COUNT(*) FROM product_price_daily").fetchone()[0], 1)
                self.assertEqual(chk.execute("SELECT COUNT(*) FROM store_skus").fetchone()[0], 3)
            finally:
                chk.close()

    def test_export_llm_depuracion_lotes_unifies_toilet_paper_and_splits_batches(self) -> None:
        from etl.export_llm_depuracion_lotes import build_depuracion_batches

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "local.db"
            by_cat_path = root / "by_cat.json"
            global_path = root / "global.json"
            out_dir = root / "lotes"
            index_path = root / "idx.txt"

            conn = sqlite3.connect(db_path)
            conn.executescript(
                """
                CREATE TABLE canonical_categories (id INTEGER PRIMARY KEY, slug TEXT UNIQUE);
                CREATE TABLE master_products (id TEXT PRIMARY KEY, canonical_category_id INTEGER, normalized_name TEXT, brand TEXT);
                CREATE TABLE store_skus (id TEXT PRIMARY KEY, master_product_id TEXT, display_name TEXT, raw_name TEXT);

                INSERT INTO canonical_categories VALUES (1, 'cuidado-personal-e-higiene'), (2, 'hogar-y-desechables'), (3, 'bebes-y-maternidad');
                INSERT INTO master_products VALUES
                    ('m-ph', 2, 'papel higienico rosal x12', 'Rosal'),
                    ('m-tetero', 3, 'tetero avent 9oz', 'Avent'),
                    ('m-vela', 2, 'vela sagrado corazon', 'Sagrado'),
                    ('m-turbana', 2, 'chips turbana platano', 'Turbana');
                INSERT INTO store_skus VALUES
                    ('s1', 'm-ph', 'Papel Higiénico Rosal x12', 'Papel Higiénico Rosal x12'),
                    ('s2', 'm-tetero', 'Tetero Avent 9oz', 'Tetero Avent 9oz'),
                    ('s3', 'm-vela', 'Vela Sagrado Corazón', 'Vela Sagrado Corazón'),
                    ('s4', 'm-turbana', 'Chips Turbana Plátano', 'Chips Turbana Plátano');
                """
            )
            conn.commit()
            conn.close()

            by_cat_path.write_text(
                json.dumps({"bebes-y-maternidad#02": ["m-tetero"], "hogar-y-desechables#21": ["m-vela"]}),
                encoding="utf-8",
            )
            global_path.write_text(json.dumps({"288": ["m-turbana"]}), encoding="utf-8")

            res = build_depuracion_batches(
                db_path=db_path,
                by_cat_map_path=by_cat_path,
                global_map_path=global_path,
                out_dir=out_dir,
                index_path=index_path,
                batch_size=2,
            )
            self.assertEqual(res["toilet_paper_unified"], 1)
            self.assertEqual(res["exported_rows"], 3)
            self.assertEqual(res["batch_files"], 2)
            self.assertTrue((out_dir / "depuracion_01.txt").exists())
            self.assertTrue((out_dir / "depuracion_02.txt").exists())
            self.assertEqual(len(index_path.read_text(encoding="utf-8").splitlines()), 4)

            chk = sqlite3.connect(db_path)
            try:
                self.assertEqual(
                    chk.execute("SELECT canonical_category_id FROM master_products WHERE id = 'm-ph'").fetchone()[0],
                    1,
                )
            finally:
                chk.close()

    def test_cleanup_stores_and_categories_local(self) -> None:
        from etl.cleanup_stores_and_categories_local import apply_store_and_category_cleanup_local

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "local.db"
            conn = sqlite3.connect(db_path)
            conn.executescript(
                """
                CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT);
                CREATE TABLE store_branches (id TEXT PRIMARY KEY, store_id TEXT, branch_name TEXT);
                CREATE TABLE canonical_categories (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT);
                CREATE TABLE master_products (id TEXT PRIMARY KEY, canonical_category_id INTEGER, normalized_name TEXT);
                CREATE TABLE store_skus (id TEXT PRIMARY KEY, store_id TEXT, master_product_id TEXT);
                CREATE TABLE price_records (id INTEGER PRIMARY KEY, store_sku_id TEXT);
                CREATE TABLE product_price_daily (master_product_id TEXT, store_id TEXT, day TEXT);

                INSERT INTO stores VALUES ('exito', 'Éxito'), ('alkosto', 'Alkosto'), ('ktronix', 'Ktronix'), ('oxxo', 'OXXO'), ('rappi', 'Rappi');
                INSERT INTO store_branches VALUES ('b1', 'oxxo', 'Oxxo 1'), ('b2', 'exito', 'Exito 1');
                INSERT INTO product_price_daily VALUES ('m1', 'alkosto', '2026-11-23'), ('m1', 'exito', '2026-11-23');
                INSERT INTO canonical_categories VALUES
                    (1, 'arroz-blanco-1000g', 'Arroz Blanco 1000 g'),
                    (2, 'arroces-y-granos', 'Arroces, Granos y Cereales'),
                    (3, 'huevos-aa-30und', 'Huevos AA 30 Unidades'),
                    (4, 'huevos-y-derivados', 'Huevos (Otras Presentaciones)');
                INSERT INTO master_products VALUES ('m1', 1, 'arroz diana'), ('m2', 3, 'huevos aa');
                INSERT INTO store_skus VALUES ('s1', 'exito', 'm1'), ('s2', 'exito', 'm2');
                """
            )
            conn.commit()
            conn.close()

            st = apply_store_and_category_cleanup_local(db_path=db_path, create_backup=False)
            self.assertEqual(st.stores_deleted, 4)
            self.assertEqual(st.branches_deleted, 1)
            self.assertEqual(st.daily_deleted, 1)
            self.assertEqual(st.masters_reassigned, 2)
            self.assertEqual(st.categories_deleted, 2)
            self.assertEqual(st.final_stores, 1)
            self.assertEqual(st.final_categories, 2)

            chk = sqlite3.connect(db_path)
            try:
                self.assertEqual(
                    chk.execute("SELECT canonical_category_id FROM master_products WHERE id = 'm1'").fetchone()[0],
                    2,
                )
                self.assertEqual(
                    chk.execute("SELECT name FROM canonical_categories WHERE slug = 'huevos-y-derivados'").fetchone()[0],
                    "Huevos y Derivados",
                )
            finally:
                chk.close()


if __name__ == "__main__":
    unittest.main()
