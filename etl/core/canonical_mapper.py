"""Mapeo de categorías canónicas y detección de marcas propias (Nivel 3)."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from etl.core.models import UnitMeasure


@dataclass(frozen=True, slots=True)
class CanonicalRule:
    slug: str
    unit_measure: UnitMeasure
    required_keywords: tuple[str, ...]
    excluded_keywords: tuple[str, ...] = ()
    min_content: Decimal | None = None
    max_content: Decimal | None = None


CANONICAL_RULES: tuple[CanonicalRule, ...] = (
    CanonicalRule(
        slug="arroz-blanco-1000g",
        unit_measure=UnitMeasure.G,
        required_keywords=("arroz",),
        excluded_keywords=("integral", "leche", "sopa", "fideo", "inflado"),
        min_content=Decimal("400"),
        max_content=Decimal("5000"),
    ),
    CanonicalRule(
        slug="leche-entera-1000ml",
        unit_measure=UnitMeasure.ML,
        required_keywords=("leche", "entera"),
        excluded_keywords=("condensada", "polvo", "deslactosada", "almendra", "soya", "coco"),
        min_content=Decimal("400"),
        max_content=Decimal("2000"),
    ),
    CanonicalRule(
        slug="aceite-vegetal-900ml",
        unit_measure=UnitMeasure.ML,
        required_keywords=("aceite",),
        excluded_keywords=("oliva", "coco", "motor", "corporal", "bebe"),
        min_content=Decimal("400"),
        max_content=Decimal("3000"),
    ),
    CanonicalRule(
        slug="huevos-aa-30und",
        unit_measure=UnitMeasure.UND,
        required_keywords=("huevo",),
        excluded_keywords=("chocolate", "kinder", "pascua"),
        min_content=Decimal("6"),
        max_content=Decimal("60"),
    ),
    CanonicalRule(
        slug="azucar-refinada-1000g",
        unit_measure=UnitMeasure.G,
        required_keywords=("azucar",),
        excluded_keywords=("morena", "pulverizada", "impalpable"),
        min_content=Decimal("400"),
        max_content=Decimal("5000"),
    ),
    CanonicalRule(
        slug="cafe-molido-500g",
        unit_measure=UnitMeasure.G,
        required_keywords=("cafe",),
        excluded_keywords=("soluble", "instantaneo", "capsula", "descafeinado", "leche"),
        min_content=Decimal("200"),
        max_content=Decimal("1000"),
    ),
    CanonicalRule(
        slug="pasta-espagueti-500g",
        unit_measure=UnitMeasure.G,
        required_keywords=("espagueti",),
        min_content=Decimal("200"),
        max_content=Decimal("1000"),
    ),
    CanonicalRule(
        slug="lenteja-500g",
        unit_measure=UnitMeasure.G,
        required_keywords=("lenteja",),
        excluded_keywords=("sopa", "harina"),
        min_content=Decimal("250"),
        max_content=Decimal("2000"),
    ),
    CanonicalRule(
        slug="frijol-500g",
        unit_measure=UnitMeasure.G,
        required_keywords=("frijol",),
        excluded_keywords=("enlatado", "lata", "refrito"),
        min_content=Decimal("250"),
        max_content=Decimal("2000"),
    ),
    CanonicalRule(
        slug="atun-lata-160g",
        unit_measure=UnitMeasure.G,
        required_keywords=("atun",),
        min_content=Decimal("80"),
        max_content=Decimal("500"),
    ),
)

PRIVATE_LABEL_BRANDS_BY_STORE: dict[str, frozenset[str]] = {
    "d1": frozenset(
        {
            "d1",
            "latti",
            "zafari",
            "brilla",
            "kuali",
            "el molinero",
            "rendidor",
            "bonito",
            "deli",
            "quinoa",
            "nativa",
            "casalinda",
            "monte rojo",
        }
    ),
    "ara": frozenset(
        {
            "ara",
            "de la cuesta",
            "el cultivo",
            "loma blanca",
            "alimentos del valle",
            "don julio",
            "sabor de oro",
            "casa real",
            "frescampo",
        }
    ),
    "exito": frozenset({"ekono", "exito", "taeq", "frescampo"}),
    "carulla": frozenset({"carulla", "pomona"}),
    "olimpica": frozenset({"olimpica", "medalla de oro"}),
}


def infer_canonical_category_slug(
    normalized_name: str,
    net_content: Decimal,
    unit_measure: UnitMeasure,
) -> str | None:
    """Asocia un producto normalizado a una categoría canónica común para comparación PUM."""
    tokens = set(normalized_name.split())
    text = f" {normalized_name} "

    for rule in CANONICAL_RULES:
        if rule.unit_measure != unit_measure:
            continue
        if rule.min_content is not None and net_content < rule.min_content:
            continue
        if rule.max_content is not None and net_content > rule.max_content:
            continue
        if not all((kw in tokens or f" {kw}" in text) for kw in rule.required_keywords):
            continue
        if any((ex in tokens or f" {ex} " in text) for ex in rule.excluded_keywords):
            continue
        return rule.slug
    return None


def is_store_private_label(
    store_id: str,
    brand: str | None,
    ean: str | None = None,
) -> bool:
    """Detecta marcas exclusivas de cadena (especialmente Hard Discount D1 y Ara)."""
    store_key = store_id.strip().lower()
    known_brands = PRIVATE_LABEL_BRANDS_BY_STORE.get(store_key, frozenset())
    if brand:
        brand_norm = " ".join(brand.strip().lower().split())
        if brand_norm in known_brands:
            return True
    if store_key in {"d1", "ara"} and ean is None:
        return True
    return False
