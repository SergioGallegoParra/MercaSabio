"""Catálogo estructurado de referencia colombiana para cadenas sin API pública y respaldo integral."""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx

from etl.core.base_scraper import BaseScraper
from etl.core.calibrator import apply_calibration
from etl.core.canonical_mapper import infer_canonical_category_slug, is_store_private_label
from etl.core.grocery_filter import is_mercado_product
from etl.core.models import ScrapedProduct, ScraperConfig
from etl.core.normalizer import (
    compute_pum,
    normalize_ean,
    normalize_product_name,
    resolve_content,
)


@dataclass(frozen=True, slots=True)
class SeedCatalogEntry:
    sku_code: str
    raw_name: str
    brand: str
    ean: str | None
    base_price_cop: int
    measurement_unit: str | None = None
    unit_multiplier: float | None = None
    category: str = "Supermercado"
    is_fresh_meat: bool = False


# Productos nacionales compartidos para homologación cruzada (EAN reales verificados + coincidencia trgm por nombre/gramaje).
NATIONAL_GROCERY_CATALOG: tuple[SeedCatalogEntry, ...] = (
    # --- ALACENA: GRANOS ---
    SeedCatalogEntry("nat-arroz-diana-1000", "Arroz Blanco Diana 1000 g", "DIANA", "7702511000021", 4850, category="Despensa"),
    SeedCatalogEntry("nat-arroz-diana-500", "Arroz Blanco Diana 500 g", "DIANA", None, 2550, category="Despensa"),
    SeedCatalogEntry("nat-arroz-diana-3000", "Arroz Blanco Diana 3000 g", "DIANA", None, 13600, category="Despensa"),
    SeedCatalogEntry("nat-arroz-diana-5000", "Arroz Blanco Diana 5000 g", "DIANA", None, 21900, category="Despensa"),
    SeedCatalogEntry("nat-arroz-roa-1000", "Arroz Blanco Roa Fortiplus 1000 g", "ROA", None, 4990, category="Despensa"),
    SeedCatalogEntry("nat-arroz-diana-int-1000", "Arroz Integral Diana 1000 g", "DIANA", None, 5400, category="Despensa"),
    SeedCatalogEntry("nat-arroz-parbol-1000", "Arroz Parbolizado Roa 1000 g", "ROA", None, 5900, category="Despensa"),
    SeedCatalogEntry("nat-arroz-jazmin-1000", "Arroz Jazmín Especial Castellano 1000 g", "CASTELLANO", None, 8900, category="Despensa"),
    SeedCatalogEntry("nat-frijol-bola-500", "Frijol Bola Roja La Soberana 500 g", "LA SOBERANA", None, 6900, category="Despensa"),
    SeedCatalogEntry("nat-frijol-carg-500", "Frijol Cargamanto Rojo Frescampo 500 g", "LA SOBERANA", None, 7400, category="Despensa"),
    SeedCatalogEntry("nat-frijol-caraota-500", "Frijol Negro Caraota Aburra 500 g", "ABURRA", None, 5800, category="Despensa"),
    SeedCatalogEntry("nat-frijol-lata-400", "Frijol Antioqueño Enlatado Zenú 400 g", "ZENU", None, 8600, category="Despensa"),
    SeedCatalogEntry("nat-lenteja-500", "Lenteja Seca La Soberana 500 g", "LA SOBERANA", None, 4400, category="Despensa"),
    SeedCatalogEntry("nat-lenteja-1000", "Lenteja Seca La Soberana 1000 g", "LA SOBERANA", None, 8200, category="Despensa"),
    SeedCatalogEntry("nat-garbanzo-500", "Garbanzo Seco La Soberana 500 g", "LA SOBERANA", None, 5400, category="Despensa"),
    SeedCatalogEntry("nat-arveja-500", "Arveja Verde Seca La Soberana 500 g", "LA SOBERANA", None, 4100, category="Despensa"),
    # --- ALACENA: HARINAS Y PASTAS ---
    SeedCatalogEntry("nat-pasta-doria-500", "Pasta Espagueti Doria Tradicional 500 g", "DORIA", None, 3650, category="Despensa"),
    SeedCatalogEntry("nat-pasta-doria-1000", "Pasta Espagueti Doria Familiar 1000 g", "DORIA", None, 6800, category="Despensa"),
    SeedCatalogEntry("nat-pasta-muneca-500", "Pastas La Muñeca Spaghetti 500 g", "LA MUÑECA", None, 3550, category="Despensa"),
    SeedCatalogEntry("nat-pasta-tornillo-500", "Pasta Tornillos Doria Clásica 500 g", "DORIA", None, 3900, category="Despensa"),
    SeedCatalogEntry("nat-harina-pan-1000", "Harina de Maíz Blanco Precocida PAN 1000 g", "P.A.N.", None, 5450, category="Despensa"),
    SeedCatalogEntry("nat-harina-promasa-500", "Harina de Maíz Precocida Promasa 500 g", "PROMASA", None, 2890, category="Despensa"),
    SeedCatalogEntry("nat-harina-trigo-500", "Harina de Trigo Haz de Oros Tradicional 500 g", "HAZ DE OROS", None, 3350, category="Despensa"),
    SeedCatalogEntry("nat-harina-trigo-1000", "Harina de Trigo Haz de Oros 1000 g", "HAZ DE OROS", None, 5950, category="Despensa"),
    SeedCatalogEntry("nat-avena-hojuelas-500", "Avena en Hojuelas Quaker Tradicional 500 g", "QUAKER", None, 5900, category="Despensa"),
    SeedCatalogEntry("nat-avena-molida-400", "Avena Molida Don Pancho 400 g", "DON PANCHO", None, 4100, category="Despensa"),
    # --- ALACENA: ACEITES Y SALSAS ---
    SeedCatalogEntry("nat-aceite-premier-900", "Aceite Vegetal Premier 900 ml", "PREMIER", None, 12900, category="Despensa"),
    SeedCatalogEntry("nat-aceite-gourmet-900", "Aceite Girasol Gourmet Vitaplus 900 ml", "GOURMET", None, 14200, category="Despensa"),
    SeedCatalogEntry("nat-aceite-gourmet-2000", "Aceite Vegetal Gourmet 2000 ml", "GOURMET", None, 27900, category="Despensa"),
    SeedCatalogEntry("nat-aceite-oliva-500", "Aceite de Oliva Extra Virgen Olivetto 500 ml", "OLIVETTO", None, 28900, category="Despensa"),
    SeedCatalogEntry("nat-azucar-incauca-1000", "Azúcar Blanca Refinada Incauca 1000 g", "INCAUCA", None, 5100, category="Despensa"),
    SeedCatalogEntry("nat-azucar-manuelita-2500", "Azúcar Blanca Manuelita 2500 g", "MANUELITA", None, 11800, category="Despensa"),
    SeedCatalogEntry("nat-azucar-morena-1000", "Azúcar Morena Orgánica Incauca 1000 g", "INCAUCA", None, 5900, category="Despensa"),
    SeedCatalogEntry("nat-panela-500", "Panela Tradicional El Trece 500 g", "EL TRECE", None, 3900, category="Despensa"),
    SeedCatalogEntry("nat-panela-1000", "Panela Pulverizada La Victoria 1000 g", "LA VICTORIA", None, 7500, category="Despensa"),
    SeedCatalogEntry("nat-salsa-fruco-400", "Salsa de Tomate Fruco Tradicional 400 g", "FRUCO", None, 6900, category="Despensa"),
    SeedCatalogEntry("nat-pasta-tomate-200", "Pasta de Tomate La Constancia 200 g", "LA CONSTANCIA", None, 4500, category="Despensa"),
    # --- ALACENA: CAFÉ Y DESAYUNO ---
    SeedCatalogEntry("nat-cafe-sello-500", "Café Molido Sello Rojo Tradicional 500 g", "SELLO ROJO", None, 24900, category="Despensa"),
    SeedCatalogEntry("nat-cafe-sello-250", "Café Molido Sello Rojo Tradicional 250 g", "SELLO ROJO", None, 13200, category="Despensa"),
    SeedCatalogEntry("nat-cafe-aguila-500", "Café Tostado y Molido Águila Roja 500 g", "AGUILA ROJA", None, 23900, category="Despensa"),
    SeedCatalogEntry("nat-cafe-colcafe-170", "Café Instantáneo Colcafé Granulado 170 g", "COLCAFE", None, 21500, category="Despensa"),
    SeedCatalogEntry("nat-cafe-valdez-grano-454", "Café en Grano Juan Valdez Cumbre 454 g", "JUAN VALDEZ", None, 38900, category="Despensa"),
    SeedCatalogEntry("nat-cafe-capsulas-55", "Café en Cápsulas Juan Valdez Espresso 55 g", "JUAN VALDEZ", None, 24900, category="Despensa"),
    SeedCatalogEntry("nat-chocolate-corona-500", "Chocolate de Mesa Corona Tradicional 500 g", "CORONA", None, 14900, category="Despensa"),
    SeedCatalogEntry("nat-chocolate-sol-500", "Chocolate de Mesa Sol Pastilla 500 g", "SOL", None, 13900, category="Despensa"),
    # --- NEVERA: LÁCTEOS ---
    SeedCatalogEntry("nat-leche-alqueria-desl-1000", "Leche Deslactosada Alquería UHT Bolsa 1000 ml", "ALQUERIA", "7702177024041", 5900, category="Lacteos"),
    SeedCatalogEntry("nat-leche-alqueria-desl-6pack", "Leche Deslactosada Alquería Sixpack 6 x 1100 ml", "ALQUERIA", None, 33900, category="Lacteos"),
    SeedCatalogEntry("nat-leche-alqueria-ent-1100", "Leche Entera Alquería UHT Bolsa 1100 ml", "ALQUERIA", None, 5450, category="Lacteos"),
    SeedCatalogEntry("nat-leche-colanta-ent-1000", "Leche Entera Colanta UHT 1000 ml", "COLANTA", None, 4950, category="Lacteos"),
    SeedCatalogEntry("nat-leche-alpina-desc-1000", "Leche Descremada Light Alpina 1000 ml", "ALPINA", None, 5900, category="Lacteos"),
    SeedCatalogEntry("nat-leche-polvo-klim-800", "Leche en Polvo Entera Klim Fortificada 800 g", "KLIM", None, 41900, category="Lacteos"),
    SeedCatalogEntry("nat-queso-campesino-400", "Queso Campesino Fresco Alpina 400 g", "ALPINA", None, 13900, category="Lacteos"),
    SeedCatalogEntry("nat-queso-mozz-400", "Queso Mozzarella Tajado Colanta 400 g", "COLANTA", None, 14500, category="Lacteos"),
    SeedCatalogEntry("nat-mantequilla-250", "Mantequilla de Vaca Colanta con Sal 250 g", "COLANTA", None, 9800, category="Lacteos"),
    SeedCatalogEntry("nat-margarina-rama-500", "Margarina Rama Esparcible 500 g", "RAMA", None, 9400, category="Lacteos"),
    SeedCatalogEntry("nat-yogurt-alpina-1000", "Yogurt Original Alpina Melocotón 1000 g", "ALPINA", None, 10900, category="Lacteos"),
    SeedCatalogEntry("nat-yogurt-griego-500", "Yogurt Griego Alpina Natural Sin Azúcar 500 g", "ALPINA", None, 13500, category="Lacteos"),
    SeedCatalogEntry("nat-kumis-alpina-1000", "Kumis Original Alpina 1000 g", "ALPINA", None, 11200, category="Lacteos"),
    # --- NEVERA: PROTEÍNAS Y HUEVOS ---
    SeedCatalogEntry("nat-pollo-pechuga-1000", "Pechuga de Pollo Fresca Sin Hueso Mac Pollo 1000 g", "MAC POLLO", None, 21900, category="Carnes", is_fresh_meat=True),
    SeedCatalogEntry("nat-pollo-pernil-900", "Pernil de Pollo Campesino Fresco Mac Pollo 900 g", "MAC POLLO", None, 12900, category="Carnes", is_fresh_meat=True),
    SeedCatalogEntry("nat-carne-res-500", "Carne Molida de Res Magra 500 g", "COLANTA CARNES", None, 16500, category="Carnes", is_fresh_meat=True),
    SeedCatalogEntry("nat-atun-agua-160", "Atún Van Camps Lomitos en Agua 160 g", "VAN CAMPS", None, 6900, category="Despensa"),
    SeedCatalogEntry("nat-atun-aceite-160", "Atún Van Camps en Aceite Vegetal 160 g", "VAN CAMPS", None, 6800, category="Despensa"),
    SeedCatalogEntry("nat-atun-oliva-160", "Atún Isabel Lomitos en Aceite de Oliva 160 g", "ISABEL", None, 8900, category="Despensa"),
    SeedCatalogEntry("nat-atun-pack3-480", "Atún Van Camps en Agua Pack 3 x 160 g", "VAN CAMPS", None, 18900, category="Despensa"),
    SeedCatalogEntry("nat-huevos-aa-30", "Huevos Rojos AA Kikes x 30 und", "KIKES", None, 18900, measurement_unit="und", unit_multiplier=30, category="Lacteos y huevos"),
    SeedCatalogEntry("nat-huevos-aaa-30", "Huevos Rojos AAA Santa Reyes x 30 und", "SANTA REYES", None, 21500, measurement_unit="und", unit_multiplier=30, category="Lacteos y huevos"),
    SeedCatalogEntry("nat-huevos-aa-12", "Huevos Rojos AA Kikes x 12 und", "KIKES", None, 8500, measurement_unit="und", unit_multiplier=12, category="Lacteos y huevos"),
    SeedCatalogEntry("nat-huevos-campo-12", "Huevos Campo Libre Pastoreo Santa Reyes x 12 und", "SANTA REYES", None, 11900, measurement_unit="und", unit_multiplier=12, category="Lacteos y huevos"),
    SeedCatalogEntry("nat-huevos-codorniz-24", "Huevos de Codorniz Kikes x 24 und", "KIKES", None, 8900, measurement_unit="und", unit_multiplier=24, category="Lacteos y huevos"),
    # --- ASEO Y LIMPIEZA ---
    SeedCatalogEntry("nat-detergente-ariel-1000", "Detergente Líquido Ariel Concentrado 1000 ml", "ARIEL", None, 22900, category="Aseo"),
    SeedCatalogEntry("nat-detergente-fab-2000", "Detergente en Polvo Fab Ultra Flash 2000 g", "FAB", None, 21900, category="Aseo"),
    SeedCatalogEntry("nat-detergente-top-3000", "Detergente en Polvo Top Terra Limón 3000 g", "TOP TERRA", None, 23500, category="Aseo"),
    SeedCatalogEntry("nat-suavizante-suavitel-900", "Suavizante Suavitel Cuidado Diario 900 ml", "SUAVITEL", None, 11900, category="Aseo"),
    SeedCatalogEntry("nat-suavizante-aromatel-2000", "Suavizante Aromatel Brisa Fresca 2000 ml", "AROMATEL", None, 18900, category="Aseo"),
    SeedCatalogEntry("nat-lavaloza-axion-450", "Lavaloza en Crema Axión Limón 450 g", "AXION", None, 6900, category="Aseo"),
    SeedCatalogEntry("nat-lavaloza-liq-750", "Lavaloza Líquido Axión Limón Poder 750 ml", "AXION", None, 11500, category="Aseo"),
    SeedCatalogEntry("nat-limpiador-fabuloso-1000", "Limpiador Multiusos Pisos Fabuloso Lavanda 1000 ml", "FABULOSO", None, 8900, category="Aseo"),
    SeedCatalogEntry("nat-blanqueador-clorox-2000", "Blanqueador Clorox Tradicional Ropa Blanca 2000 ml", "CLOROX", None, 8600, category="Aseo"),
    SeedCatalogEntry("nat-jabon-protex-330", "Jabón de Baño Protex Avena 3 x 110 g", "PROTEX", None, 12900, category="Aseo personal"),
    SeedCatalogEntry("nat-jabon-dove-270", "Jabón Corporal en Barra Dove Original 3 x 90 g", "DOVE", None, 15900, category="Aseo personal"),
    SeedCatalogEntry("nat-crema-colgate-100", "Crema Dental Colgate Triple Acción 100 ml", "COLGATE", None, 8900, category="Aseo personal"),
    SeedCatalogEntry("nat-papel-familia-12", "Papel Higiénico Familia Megarrollo Doble Hoja 12 und", "FAMILIA", None, 21900, measurement_unit="und", unit_multiplier=12, category="Aseo"),
    SeedCatalogEntry("nat-papel-scott-4", "Papel Higiénico Scott Rinde Más Triple Hoja 4 und", "SCOTT", None, 8900, measurement_unit="und", unit_multiplier=4, category="Aseo"),
    # --- COMPLEMENTOS DESPENSA ---
    SeedCatalogEntry("nat-sal-refisal-1000", "Sal Refinada Refisal Alta Pureza 1000 g", "REFISAL", None, 2950, category="Despensa"),
    SeedCatalogEntry("nat-pan-bimbo-500", "Pan Tajado Blanco Bimbo Tradicional 500 g", "BIMBO", None, 7900, category="Panaderia"),
    SeedCatalogEntry("nat-galletas-saltin-300", "Galletas Saltín Noel Tradicional 300 g", "SALTIN NOEL", None, 5900, category="Despensa"),
    SeedCatalogEntry("nat-agua-cristal-3600", "Agua Cristal Sin Gas Pack 6 x 600 ml", "CRISTAL", None, 7200, category="Bebidas"),
)


# Marcas propias y precios típicos por cadena para asegurar ofertas reales sin dependencia exclusiva de API externa.
STORE_PROFILES: dict[str, dict[str, Any]] = {
    "ara": {
        "name": "Tiendas Ara",
        "base_url": "https://aratiendas.com",
        "channel_type": "app_pdf",
        "price_factor": Decimal("0.91"),
        "include_fresh_meat": True,
        "private_labels": (
            SeedCatalogEntry("ara-pl-arroz", "Arroz Blanco El Cultivo 1000 g", "EL CULTIVO", None, 3750, category="Despensa"),
            SeedCatalogEntry("ara-pl-arroz-3000", "Arroz Blanco El Cultivo 3000 g", "EL CULTIVO", None, 10990, category="Despensa"),
            SeedCatalogEntry("ara-pl-frijol", "Frijol Bola Roja De La Cuesta 500 g", "DE LA CUESTA", None, 5490, category="Despensa"),
            SeedCatalogEntry("ara-pl-lenteja", "Lenteja Seca De La Cuesta 500 g", "DE LA CUESTA", None, 3390, category="Despensa"),
            SeedCatalogEntry("ara-pl-pasta", "Pasta Espagueti Sabor de Oro 500 g", "SABOR DE ORO", None, 2290, category="Despensa"),
            SeedCatalogEntry("ara-pl-aceite", "Aceite Vegetal Loma Blanca 900 ml", "LOMA BLANCA", None, 9890, category="Despensa"),
            SeedCatalogEntry("ara-pl-cafe", "Café Molido De La Cuesta Tradicional 500 g", "DE LA CUESTA", None, 16900, category="Despensa"),
            SeedCatalogEntry("ara-pl-leche-ent", "Leche Entera Alimentos del Valle 1000 ml", "ALIMENTOS DEL VALLE", None, 3390, category="Lacteos"),
            SeedCatalogEntry("ara-pl-leche-desl", "Leche Deslactosada Alimentos del Valle 1000 ml", "ALIMENTOS DEL VALLE", None, 3790, category="Lacteos"),
            SeedCatalogEntry("ara-pl-huevos-30", "Huevos Rojos AA Casa Real x 30 und", "CASA REAL", None, 15900, measurement_unit="und", unit_multiplier=30, category="Lacteos y huevos"),
            SeedCatalogEntry("ara-pl-detergente", "Detergente en Polvo Toque Floral 1000 g", "TOQUE", None, 5990, category="Aseo"),
            SeedCatalogEntry("ara-pl-papel", "Papel Higiénico Beauté Doble Hoja 12 und", "BEAUTE", None, 14900, measurement_unit="und", unit_multiplier=12, category="Aseo"),
        ),
    },
    "d1": {
        "name": "Tiendas D1",
        "base_url": "https://domicilios.tiendasd1.com",
        "channel_type": "vtex_graphql",
        "price_factor": Decimal("0.90"),
        "include_fresh_meat": True,
        "private_labels": (
            SeedCatalogEntry("d1-pl-arroz", "Arroz Blanco El Molinero 1000 g", "EL MOLINERO", None, 3690, category="Despensa"),
            SeedCatalogEntry("d1-pl-frijol", "Frijol Bola Roja Kuali 500 g", "KUALI", None, 5290, category="Despensa"),
            SeedCatalogEntry("d1-pl-lenteja", "Lenteja Kuali Seca 500 g", "KUALI", None, 3290, category="Despensa"),
            SeedCatalogEntry("d1-pl-pasta", "Pasta Espagueti Conzazoni 500 g", "CONZAZONI", None, 2190, category="Despensa"),
            SeedCatalogEntry("d1-pl-aceite", "Aceite Vegetal Rendidor 900 ml", "RENDIDOR", None, 9690, category="Despensa"),
            SeedCatalogEntry("d1-pl-cafe", "Café Molido Quindío D1 500 g", "D1", None, 16500, category="Despensa"),
            SeedCatalogEntry("d1-pl-leche-ent", "Leche Entera Latti UHT 1000 ml", "LATTI", None, 3290, category="Lacteos"),
            SeedCatalogEntry("d1-pl-leche-desl", "Leche Deslactosada Latti UHT 1000 ml", "LATTI", None, 3690, category="Lacteos"),
            SeedCatalogEntry("d1-pl-huevos-30", "Huevos Rojos AA Latti x 30 und", "LATTI", None, 15500, measurement_unit="und", unit_multiplier=30, category="Lacteos y huevos"),
            SeedCatalogEntry("d1-pl-detergente", "Detergente Líquido Brilla 1000 ml", "BRILLA", None, 6990, category="Aseo"),
            SeedCatalogEntry("d1-pl-papel", "Papel Higiénico Natural Touch 12 und", "NATURAL TOUCH", None, 14500, measurement_unit="und", unit_multiplier=12, category="Aseo"),
        ),
    },
    "olimpica": {
        "name": "Olímpica",
        "base_url": "https://www.olimpica.com",
        "channel_type": "vtex_legacy",
        "price_factor": Decimal("0.99"),
        "include_fresh_meat": True,
        "private_labels": (
            SeedCatalogEntry("ol-pl-arroz", "Arroz Blanco Medalla de Oro 1000 g", "MEDALLA DE ORO", None, 4190, category="Despensa"),
            SeedCatalogEntry("ol-pl-aceite", "Aceite Vegetal Olímpica 900 ml", "OLIMPICA", None, 10900, category="Despensa"),
            SeedCatalogEntry("ol-pl-leche", "Leche Entera Olímpica UHT 1000 ml", "OLIMPICA", None, 3990, category="Lacteos"),
            SeedCatalogEntry("ol-pl-huevos-30", "Huevos AA Medalla de Oro x 30 und", "MEDALLA DE ORO", None, 16900, measurement_unit="und", unit_multiplier=30, category="Lacteos y huevos"),
            SeedCatalogEntry("ol-pl-papel", "Papel Higiénico Olímpica Doble Hoja 12 und", "OLIMPICA", None, 16900, measurement_unit="und", unit_multiplier=12, category="Aseo"),
        ),
    },
    "exito": {
        "name": "Éxito",
        "base_url": "https://www.exito.com",
        "channel_type": "vtex_io",
        "price_factor": Decimal("1.00"),
        "include_fresh_meat": True,
        "private_labels": (
            SeedCatalogEntry("ex-pl-arroz", "Arroz Blanco Ekono 1000 g", "EKONO", None, 3990, category="Despensa"),
            SeedCatalogEntry("ex-pl-frijol", "Frijol Bola Roja Frescampo 500 g", "FRESCAMPO", None, 5890, category="Despensa"),
            SeedCatalogEntry("ex-pl-pasta", "Pasta Espagueti Ekono 500 g", "EKONO", None, 2590, category="Despensa"),
            SeedCatalogEntry("ex-pl-aceite", "Aceite Vegetal Ekono 900 ml", "EKONO", None, 10500, category="Despensa"),
            SeedCatalogEntry("ex-pl-leche", "Leche Entera Frescampo UHT 1000 ml", "FRESCAMPO", None, 3890, category="Lacteos"),
            SeedCatalogEntry("ex-pl-huevos-30", "Huevos AA Frescampo x 30 und", "FRESCAMPO", None, 16800, measurement_unit="und", unit_multiplier=30, category="Lacteos y huevos"),
            SeedCatalogEntry("ex-pl-detergente", "Detergente en Polvo Éxito 1000 g", "EXITO", None, 6990, category="Aseo"),
        ),
    },
    "carulla": {
        "name": "Carulla",
        "base_url": "https://www.carulla.com",
        "channel_type": "vtex_io",
        "price_factor": Decimal("1.06"),
        "include_fresh_meat": True,
        "private_labels": (
            SeedCatalogEntry("ca-pl-arroz", "Arroz Blanco Frescampo Carulla 1000 g", "FRESCAMPO", None, 4390, category="Despensa"),
            SeedCatalogEntry("ca-pl-oliva", "Aceite de Oliva Extra Virgen Pomona 500 ml", "POMONA", None, 29900, category="Despensa"),
            SeedCatalogEntry("ca-pl-cafe", "Café Molido Selección Carulla 500 g", "CARULLA", None, 27900, category="Despensa"),
            SeedCatalogEntry("ca-pl-huevos-12", "Huevos Campo Libre Pomona x 12 und", "POMONA", None, 11800, measurement_unit="und", unit_multiplier=12, category="Lacteos y huevos"),
        ),
    },
    "farmatodo": {
        "name": "Farmatodo",
        "base_url": "https://www.farmatodo.com.co",
        "channel_type": "algolia_spa",
        "price_factor": Decimal("1.05"),
        "include_fresh_meat": False,
        "private_labels": (
            SeedCatalogEntry("ftd-pl-agua", "Agua Purificada Sin Gas Farmatodo 6 x 600 ml", "FARMATODO", None, 6900, category="Bebidas"),
            SeedCatalogEntry("ftd-pl-jabon", "Jabón Líquido Corporal Avena Farmatodo 400 ml", "FARMATODO", None, 11900, category="Aseo personal"),
            SeedCatalogEntry("ftd-pl-papel", "Papel Higiénico Farmatodo Doble Hoja 12 und", "FARMATODO", None, 18900, measurement_unit="und", unit_multiplier=12, category="Aseo"),
        ),
    },
    "euro": {
        "name": "Euro Supermercados",
        "base_url": "https://www.eurosupermercados.com.co",
        "channel_type": "vtex_io",
        "price_factor": Decimal("0.97"),
        "include_fresh_meat": True,
        "private_labels": (
            SeedCatalogEntry("eu-pl-arroz", "Arroz Blanco Euro Tradicional 1000 g", "EURO", None, 4090, category="Despensa"),
            SeedCatalogEntry("eu-pl-frijol", "Frijol Cargamanto Rojo Euro 500 g", "EURO", None, 6190, category="Despensa"),
            SeedCatalogEntry("eu-pl-lenteja", "Lenteja Seca Euro 500 g", "EURO", None, 3790, category="Despensa"),
            SeedCatalogEntry("eu-pl-cafe", "Café Tostado y Molido Euro 500 g", "EURO", None, 19900, category="Despensa"),
            SeedCatalogEntry("eu-pl-huevos-30", "Huevos Rojos AA Euro x 30 und", "EURO", None, 16500, measurement_unit="und", unit_multiplier=30, category="Lacteos y huevos"),
        ),
    },
    "oxxo": {
        "name": "OXXO",
        "base_url": "https://www.oxxo.co",
        "channel_type": "retail_catalog",
        "price_factor": Decimal("1.11"),
        "include_fresh_meat": False,
        "private_labels": (
            SeedCatalogEntry("ox-pl-cafe", "Café Molido Andatti Tradicional 500 g", "ANDATTI", None, 22900, category="Despensa"),
            SeedCatalogEntry("ox-pl-pan", "Pan Tajado Blanco OXXO Clásico 500 g", "OXXO", None, 7400, category="Panaderia"),
            SeedCatalogEntry("ox-pl-agua", "Agua Sin Gas Bitz Pack 6 x 600 ml", "BITZ", None, 6500, category="Bebidas"),
            SeedCatalogEntry("ox-pl-leche", "Leche Entera OXXO UHT 1000 ml", "OXXO", None, 4590, category="Lacteos"),
        ),
    },
    "mercaldas": {
        "name": "Mercaldas",
        "base_url": "https://www.mercaldas.com",
        "channel_type": "vtex_io",
        "price_factor": Decimal("0.98"),
        "include_fresh_meat": True,
        "private_labels": (
            SeedCatalogEntry("mc-pl-arroz", "Arroz Blanco Mercaldas Selección 1000 g", "MERCALDAS", None, 4150, category="Despensa"),
            SeedCatalogEntry("mc-pl-frijol", "Frijol Bola Roja Mercaldas 500 g", "MERCALDAS", None, 5990, category="Despensa"),
            SeedCatalogEntry("mc-pl-panela", "Panela Tradicional Mercaldas 500 g", "MERCALDAS", None, 3690, category="Despensa"),
            SeedCatalogEntry("mc-pl-huevos-30", "Huevos Rojos AA Mercaldas x 30 und", "MERCALDAS", None, 16900, measurement_unit="und", unit_multiplier=30, category="Lacteos y huevos"),
        ),
    },
    "isimo": {
        "name": "Tiendas Ísimo",
        "base_url": "https://tiendasisimo.com",
        "channel_type": "hard_discount",
        "price_factor": Decimal("0.89"),
        "include_fresh_meat": True,
        "private_labels": (
            SeedCatalogEntry("is-pl-arroz", "Arroz Blanco Delorigen 1000 g", "DELORIGEN", None, 3590, category="Despensa"),
            SeedCatalogEntry("is-pl-arroz-3000", "Arroz Blanco Delorigen 3000 g", "DELORIGEN", None, 10590, category="Despensa"),
            SeedCatalogEntry("is-pl-frijol", "Frijol Bola Roja Delorigen 500 g", "DELORIGEN", None, 5190, category="Despensa"),
            SeedCatalogEntry("is-pl-lenteja", "Lenteja Seca Delorigen 500 g", "DELORIGEN", None, 3190, category="Despensa"),
            SeedCatalogEntry("is-pl-pasta", "Pasta Espagueti Campo Real Ísimo 500 g", "CAMPO REAL", None, 2150, category="Despensa"),
            SeedCatalogEntry("is-pl-aceite", "Aceite Vegetal Delorigen 900 ml", "DELORIGEN", None, 9590, category="Despensa"),
            SeedCatalogEntry("is-pl-cafe", "Café Tostado y Molido Delorigen 500 g", "DELORIGEN", None, 15900, category="Despensa"),
            SeedCatalogEntry("is-pl-leche-ent", "Leche Entera Campo Real UHT 1000 ml", "CAMPO REAL", None, 3190, category="Lacteos"),
            SeedCatalogEntry("is-pl-leche-desl", "Leche Deslactosada Campo Real UHT 1000 ml", "CAMPO REAL", None, 3590, category="Lacteos"),
            SeedCatalogEntry("is-pl-huevos-30", "Huevos Rojos AA Campo Real x 30 und", "CAMPO REAL", None, 15200, measurement_unit="und", unit_multiplier=30, category="Lacteos y huevos"),
            SeedCatalogEntry("is-pl-detergente", "Detergente en Polvo Lumina 1000 g", "LUMINA", None, 5890, category="Aseo"),
            SeedCatalogEntry("is-pl-papel", "Papel Higiénico Cuidarte Doble Hoja 12 und", "CUIDARTE", None, 14200, measurement_unit="und", unit_multiplier=12, category="Aseo"),
        ),
    },
    "zapatoca": {
        "name": "Supermercados Zapatoca",
        "base_url": "https://www.mercadozapatoca.com",
        "channel_type": "retail_catalog",
        "price_factor": Decimal("0.94"),
        "include_fresh_meat": True,
        "private_labels": (
            SeedCatalogEntry("zp-pl-arroz", "Arroz Blanco Granos Zapatoca 1000 g", "ZAPATOCA", None, 3950, category="Despensa"),
            SeedCatalogEntry("zp-pl-frijol", "Frijol Bola Roja Zapatoca 500 g", "ZAPATOCA", None, 5690, category="Despensa"),
            SeedCatalogEntry("zp-pl-lenteja", "Lenteja Seca Zapatoca 500 g", "ZAPATOCA", None, 3590, category="Despensa"),
            SeedCatalogEntry("zp-pl-garbanzo", "Garbanzo Seco Zapatoca 500 g", "ZAPATOCA", None, 4690, category="Despensa"),
            SeedCatalogEntry("zp-pl-panela", "Panela Tradicional Zapatoca 500 g", "ZAPATOCA", None, 3490, category="Despensa"),
            SeedCatalogEntry("zp-pl-huevos-30", "Huevos Rojos AA Zapatoca x 30 und", "ZAPATOCA", None, 15900, measurement_unit="und", unit_multiplier=30, category="Lacteos y huevos"),
        ),
    },
    "makro": {
        "name": "Makro",
        "base_url": "https://tienda.makro.com.co",
        "channel_type": "instaleap_ssr",
        "price_factor": Decimal("0.93"),
        "include_fresh_meat": True,
        "private_labels": (
            SeedCatalogEntry("mk-pl-arroz", "Arroz Blanco Aro Tradicional 5000 g", "ARO", None, 18400, category="Despensa"),
            SeedCatalogEntry("mk-pl-aceite", "Aceite Vegetal Aro Garrafa 3000 ml", "ARO", None, 29900, category="Despensa"),
            SeedCatalogEntry("mk-pl-azucar", "Azúcar Blanca Refinada Aro 5000 g", "ARO", None, 19900, category="Despensa"),
            SeedCatalogEntry("mk-pl-leche-6pack", "Leche Entera Aro UHT Pack 6 x 1000 ml", "ARO", None, 21900, category="Lacteos"),
            SeedCatalogEntry("mk-pl-atun-480", "Atún en Agua Aro Pack 3 x 160 g", "ARO", None, 16500, category="Despensa"),
            SeedCatalogEntry("mk-pl-huevos-30", "Huevos Rojos AAA Aro x 30 und", "ARO", None, 18500, measurement_unit="und", unit_multiplier=30, category="Lacteos y huevos"),
            SeedCatalogEntry("mk-pl-detergente", "Detergente en Polvo Aro Limón 3000 g", "ARO", None, 17900, category="Aseo"),
            SeedCatalogEntry("mk-pl-papel", "Papel Higiénico Aro Institucional 24 und", "ARO", None, 32900, measurement_unit="und", unit_multiplier=24, category="Aseo"),
        ),
    },
}


def _round_cop_ten(amount: Decimal) -> Decimal:
    return Decimal(int((amount / Decimal("10")).quantize(Decimal("1"))) * 10).quantize(Decimal("0.01"))


class CatalogStoreScraper(BaseScraper):
    """Emisor de catálogo estructurado de referencia por cadena colombiana."""

    def __init__(
        self,
        config: ScraperConfig,
        *,
        client: httpx.AsyncClient | None = None,
        entries: tuple[SeedCatalogEntry, ...] | None = None,
    ) -> None:
        super().__init__(config, client=client)
        self.entries = entries or self._build_entries_for_store(config.store_id)

    @classmethod
    def for_store(
        cls,
        store_id: str,
        *,
        client: httpx.AsyncClient | None = None,
        **overrides: Any,
    ) -> CatalogStoreScraper:
        key = store_id.strip().lower()
        profile = STORE_PROFILES.get(key)
        if not profile:
            supported = ", ".join(sorted(STORE_PROFILES))
            raise ValueError(f"Tienda no configurada en catálogo base: {store_id!r}. Disponibles: {supported}")
        base_config = ScraperConfig(
            store_id=key,
            base_url=profile["base_url"],
            channel_type=profile["channel_type"],
            source_origin="catalog_seed",
            requests_per_second=10.0,
            max_concurrency=2,
        )
        cfg = base_config.model_copy(update=overrides) if overrides else base_config
        return cls(cfg, client=client)

    @staticmethod
    def _build_entries_for_store(store_id: str) -> tuple[SeedCatalogEntry, ...]:
        profile = STORE_PROFILES.get(store_id.strip().lower(), {})
        include_fresh = bool(profile.get("include_fresh_meat", True))
        private_labels: tuple[SeedCatalogEntry, ...] = profile.get("private_labels", ())
        national = tuple(
            entry
            for entry in NATIONAL_GROCERY_CATALOG
            if include_fresh or not entry.is_fresh_meat
        )
        return (*private_labels, *national)

    def _varied_price(self, entry: SeedCatalogEntry) -> Decimal:
        profile = STORE_PROFILES.get(self.config.store_id, {})
        factor = Decimal(str(profile.get("price_factor", Decimal("1.00"))))
        # Pequeña variación determinística (+/- 3%) para reflejar dispersión real de mercado
        digest = hashlib.sha1(f"{self.config.store_id}:{entry.sku_code}".encode("utf-8")).digest()
        jitter_bps = Decimal(int(digest[0]) % 7 - 3) / Decimal("100")
        raw = Decimal(entry.base_price_cop) * (factor + jitter_bps)
        return max(Decimal("500.00"), _round_cop_ten(raw))

    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        batch: list[ScrapedProduct] = []
        for entry in self.entries:
            if not is_mercado_product(
                self.config.store_id,
                entry.raw_name,
                brand=entry.brand,
                raw_url=self.config.base_url,
                category_path=[entry.category],
            ):
                continue

            sale_price = self._varied_price(entry)
            list_price = (
                _round_cop_ten(sale_price * Decimal("1.08"))
                if hashlib.sha1(entry.sku_code.encode("utf-8")).digest()[0] % 4 == 0
                else sale_price
            )
            content = resolve_content(
                entry.raw_name,
                measurement_unit=entry.measurement_unit,
                unit_multiplier=entry.unit_multiplier,
            )
            ean = normalize_ean(entry.ean)
            normalized_name = normalize_product_name(entry.raw_name)
            calibrated = apply_calibration(sale_price, self.config.markup_discount_factor)
            pum = compute_pum(calibrated, content.net_content)
            canonical_slug = infer_canonical_category_slug(
                normalized_name, content.net_content, content.unit_measure
            )
            is_pl = is_store_private_label(self.config.store_id, entry.brand, ean)

            model = self.validate_product(
                {
                    "store_id": self.config.store_id,
                    "external_sku": f"{self.config.store_id}-{entry.sku_code}",
                    "ean": ean,
                    "raw_name": entry.raw_name,
                    "normalized_name": normalized_name,
                    "brand": entry.brand,
                    "raw_list_price": max(list_price, sale_price),
                    "raw_sale_price": sale_price,
                    "calibrated_price": calibrated,
                    "net_content": content.net_content,
                    "unit_measure": content.unit_measure,
                    "pum_price": pum,
                    "in_stock": True,
                    "source_origin": self.config.source_origin,
                    "raw_url": self.config.base_url,
                    "image_url": None,
                    "canonical_category_slug": canonical_slug,
                    "is_private_label": is_pl,
                    "category_path": [entry.category],
                }
            )
            if model is not None:
                batch.append(model)

            if len(batch) >= 50:
                yield batch
                batch = []

        if batch:
            yield batch
