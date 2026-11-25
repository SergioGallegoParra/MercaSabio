"""Infraestructura backend para Producto Agregador, Sustitutos de Ahorro y Búsqueda Fonética.

1. `product_group_key`: agrupa presentaciones de distinto tamaño (`500g`, `1kg`, `5kg`)
   del mismo producto base (`product_type|brand_norm|variant_core`).
2. `canonical_search_text`: texto normalizado sin tildes y con colapso de letras dobles
   (`mozzarella` == `mozarela`) + alias comunes, para búsqueda independiente del orden
   y tolerante a errores ortográficos sin índices trigram pesados.
3. `substitution_groups`: tabla pequeña (~30 filas) que mapea `product_type` de alto impacto
   económico a grupos de sustitución funcional (proteínas, aceites, detergentes, granos).
"""

from __future__ import annotations

import re
import sqlite3
import unicodedata

# (substitution_group, product_type, impact_tier, yield_factor_note)
SUBSTITUTION_SEEDS: tuple[tuple[str, str, str, str], ...] = (
    # Proteínas diarias (alto impacto en factura)
    ("proteina_diaria", "pechuga_pollo", "high", "1.0"),
    ("proteina_diaria", "muslo_pollo", "high", "1.0"),
    ("proteina_diaria", "pollo_entero", "high", "1.0"),
    ("proteina_diaria", "lomo_cerdo", "high", "1.0"),
    ("proteina_diaria", "chuleta_cerdo", "high", "1.0"),
    ("proteina_diaria", "carne_res", "high", "1.0"),
    ("proteina_diaria", "carne_molida", "high", "1.0"),
    ("proteina_diaria", "filete_pescado", "high", "1.0"),
    ("proteina_diaria", "atun_lata", "high", "1.0"),
    ("proteina_diaria", "huevo_gallina", "high", "1.0"),
    # Aceites de cocina (alto impacto)
    ("aceite_cocina", "aceite_girasol", "high", "1.0"),
    ("aceite_cocina", "aceite_canola", "high", "1.0"),
    ("aceite_cocina", "aceite_soya", "high", "1.0"),
    ("aceite_cocina", "aceite_vegetal", "high", "1.0"),
    ("aceite_cocina", "aceite_maiz", "high", "1.0"),
    # Lavado de ropa (alto impacto)
    ("lavado_ropa", "detergente_liquido", "high", "1.0"),
    ("lavado_ropa", "detergente_polvo", "high", "1.0"),
    # Lácteos líquidos base
    ("leche_liquida", "leche_entera", "medium", "1.0"),
    ("leche_liquida", "leche_semidescremada", "medium", "1.0"),
    ("leche_liquida", "leche_deslactosada", "medium", "1.0"),
    # Carbohidratos base
    ("carbohidrato_base", "arroz_blanco", "medium", "1.0"),
    ("carbohidrato_base", "pasta_espagueti", "medium", "1.0"),
    ("carbohidrato_base", "papa_fresca", "medium", "1.0"),
    # Granos leguminosos
    ("leguminosa_seca", "frijol_seco", "medium", "1.0"),
    ("leguminosa_seca", "lenteja_seca", "medium", "1.0"),
    ("leguminosa_seca", "garbanzo_seco", "medium", "1.0"),
)

_SEARCH_ALIASES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bchampu\b"), "shampoo"),
    (re.compile(r"\byogurt\b"), "yogur"),
    (re.compile(r"\bketchup\b"), "salsa tomate"),
    (re.compile(r"\bdesl\b"), "deslactosada"),
    (re.compile(r"\bp\.?\s*a\.?\s*n\.?\b"), "harina pan"),
)


def phonetic_search_normalize(text: str | None) -> str:
    """Normaliza texto para búsqueda tolerante a tildes, letras dobles y alias."""
    if not text:
        return ""
    ascii_s = (
        unicodedata.normalize("NFKD", text)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    for rx, repl in _SEARCH_ALIASES:
        ascii_s = rx.sub(repl, ascii_s)
    # Colapsar consonantes/vocales repetidas (mozzarella -> mozarela, spaghetti -> spageti)
    collapsed = re.sub(r"([a-z])\1+", r"\1", ascii_s)
    cleaned = re.sub(r"[^a-z0-9]+", " ", collapsed).strip()
    return " ".join(dict.fromkeys(cleaned.split()))


def build_product_group_key(
    product_type: str | None,
    brand: str | None,
    variant_core: str | None,
) -> str | None:
    """Construye clave estable para agrupar presentaciones de distinto tamaño."""
    pt = re.sub(r"[^a-z0-9_]+", "_", (product_type or "").strip().lower()).strip("_")
    if not pt:
        return None
    br = re.sub(
        r"[^a-z0-9]+",
        "",
        unicodedata.normalize("NFKD", brand or "")
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower(),
    )
    if not br or br in {"sinmarca", "generico", "generica", "sm", "varios", "na"}:
        br = "generica"
    vc = re.sub(
        r"[^a-z0-9_]+",
        "_",
        unicodedata.normalize("NFKD", variant_core or "tradicional")
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower(),
    ).strip("_") or "tradicional"
    return f"{pt}|{br}|{vc}"[:160]


def ensure_local_catalog_infra(conn: sqlite3.Connection) -> None:
    """Asegura columnas de agrupación/búsqueda y tabla `substitution_groups` en SQLite local."""
    cols = {str(r[1]) for r in conn.execute("PRAGMA table_info(master_products)").fetchall()}
    for col_name, col_type in (
        ("product_group_key", "TEXT"),
        ("variant_core", "TEXT"),
        ("clean_canonical_name", "TEXT"),
        ("canonical_search_text", "TEXT"),
    ):
        if col_name not in cols:
            conn.execute(f"ALTER TABLE master_products ADD COLUMN {col_name} {col_type}")

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_local_mp_group_key ON master_products (product_group_key)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS substitution_groups (
            product_type TEXT PRIMARY KEY,
            substitution_group TEXT NOT NULL,
            impact_tier TEXT NOT NULL DEFAULT 'medium',
            yield_factor TEXT NOT NULL DEFAULT '1.0'
        )
        """
    )
    conn.executemany(
        """
        INSERT OR IGNORE INTO substitution_groups (
            product_type, substitution_group, impact_tier, yield_factor
        ) VALUES (?, ?, ?, ?)
        """,
        [(pt, grp, tier, yf) for grp, pt, tier, yf in SUBSTITUTION_SEEDS],
    )
    conn.commit()
