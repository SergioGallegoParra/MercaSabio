"""Extractor conservador de atributos dietarios y sellos frontales (Res. 810/2021)."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Mapping, Optional


@dataclass(frozen=True)
class NutritionAttributes:
    """Atributos dietarios compatibles con public.product_attributes."""

    lactose_free: Optional[bool] = None
    gluten_free: Optional[bool] = None
    vegan: Optional[bool] = None
    vegetarian: Optional[bool] = None
    sugar_g_100: Optional[float] = None
    protein_g_100: Optional[float] = None
    sodium_mg_100: Optional[float] = None
    front_warning_seals: tuple[str, ...] = field(default_factory=tuple)
    source: str = "inferred_name"
    confidence: float = 0.5


def _norm(text: str) -> str:
    ascii_str = "".join(
        ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch)
    )
    return " ".join(ascii_str.lower().split())


def _parse_metric(specs: Mapping[str, str], keys: tuple[str, ...]) -> Optional[float]:
    for key, val in specs.items():
        k_norm = _norm(str(key))
        if any(k in k_norm for k in keys):
            num_match = re.search(r"(\d+(?:[.,]\d+)?)", str(val))
            if num_match:
                try:
                    return float(num_match.group(1).replace(",", "."))
                except ValueError:
                    return None
    return None


def extract_nutrition_attributes(
    title: str,
    description: str = "",
    specs: Optional[Mapping[str, str]] = None,
) -> NutritionAttributes:
    """Extrae atributos nutricionales sin asumir falsos positivos."""
    specs = specs or {}
    combined = _norm(f"{title} {description}")

    lactose_free: Optional[bool] = None
    if re.search(r"\b(deslactosad\w*|sin lactosa|lactose free|bebida de almendra\w*|bebida de soya|bebida de avena)\b", combined):
        lactose_free = True
    elif re.search(r"\b(leche entera|leche semidescremada|yogur\w*|queso|mantequilla|crema de leche)\b", combined):
        lactose_free = False

    gluten_free: Optional[bool] = None
    if re.search(r"\b(sin gluten|gluten free|libre de gluten)\b", combined):
        gluten_free = True
    elif re.search(r"\b(trigo|cebada|centeno|pasta\b|espagueti|spaghetti|pan tajado|galleta)\b", combined):
        gluten_free = False

    vegan: Optional[bool] = None
    if re.search(r"\b(vegano|vegana|plant based|100% vegetal)\b", combined):
        vegan = True
    elif re.search(r"\b(leche\b|queso|huevos?|pollo|carne|res|cerdo|atun|miel|yogur)\b", combined):
        vegan = False

    seals: list[str] = []
    if "exceso en azucares" in combined or "alto en azucares" in combined:
        seals.append("exceso_azucares")
    if "exceso en sodio" in combined or "alto en sodio" in combined:
        seals.append("exceso_sodio")
    if "exceso en grasas saturadas" in combined:
        seals.append("exceso_grasas_saturadas")

    sugar = _parse_metric(specs, ("azucar", "azucares"))
    protein = _parse_metric(specs, ("proteina", "proteinas"))
    sodium = _parse_metric(specs, ("sodio",))

    has_structured_nutrition = any(v is not None for v in (sugar, protein, sodium)) or bool(seals)
    source = "label_scrape" if has_structured_nutrition else "inferred_name"
    confidence = 0.85 if has_structured_nutrition else 0.55

    return NutritionAttributes(
        lactose_free=lactose_free,
        gluten_free=gluten_free,
        vegan=vegan,
        vegetarian=True if vegan is True else None,
        sugar_g_100=sugar,
        protein_g_100=protein,
        sodium_mg_100=sodium,
        front_warning_seals=tuple(seals),
        source=source,
        confidence=confidence,
    )
