"""Normalización de gramajes, volúmenes, EAN, texto y cálculo de PUM."""

from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from etl.core.models import NormalizedContent, UnitMeasure

# Expresión regular especificada para extracción de contenido neto en títulos retail
CONTENT_REGEX = re.compile(
    r"(\d+(?:[\.,]\d+)?)\s*(g|gr|gramos|kg|ml|cc|l|lt|litros|und|unidades)\b",
    re.IGNORECASE,
)

# Patrón auxiliar para multipacks explícitos (ej. "6 x 330 ml", "4x500g")
MULTIPACK_REGEX = re.compile(
    r"\b(\d+)\s*[xX×]\s*(\d+(?:[\.,]\d+)?)\s*(g|gr|gramos|kg|ml|cc|l|lt|litros|und|unidades)\b",
    re.IGNORECASE,
)

_UNIT_CONVERSIONS: dict[str, tuple[UnitMeasure, Decimal]] = {
    "g": (UnitMeasure.G, Decimal("1")),
    "gr": (UnitMeasure.G, Decimal("1")),
    "gramos": (UnitMeasure.G, Decimal("1")),
    "kg": (UnitMeasure.G, Decimal("1000")),
    "ml": (UnitMeasure.ML, Decimal("1")),
    "cc": (UnitMeasure.ML, Decimal("1")),
    "l": (UnitMeasure.ML, Decimal("1000")),
    "lt": (UnitMeasure.ML, Decimal("1000")),
    "litros": (UnitMeasure.ML, Decimal("1000")),
    "und": (UnitMeasure.UND, Decimal("1")),
    "unidades": (UnitMeasure.UND, Decimal("1")),
    # Alias frecuentes de VTEX measurementUnit
    "un": (UnitMeasure.UND, Decimal("1")),
    "unidad": (UnitMeasure.UND, Decimal("1")),
    "litro": (UnitMeasure.ML, Decimal("1000")),
    "gramo": (UnitMeasure.G, Decimal("1")),
    "kilo": (UnitMeasure.G, Decimal("1000")),
    "kilogramo": (UnitMeasure.G, Decimal("1000")),
}

_THOUSANDS_DOT_UNITS = {"g", "gr", "gramos", "ml", "cc", "und", "unidades"}


def _parse_numeric_token(raw_number: str, raw_unit: str) -> Decimal:
    """Convierte números con coma o punto decimal; interpreta miles colombianos (ej. '1.000 g')."""
    unit_lower = raw_unit.lower()
    if "." in raw_number and "," not in raw_number:
        whole, frac = raw_number.split(".", maxsplit=1)
        if len(frac) == 3 and whole.isdigit() and int(whole) >= 1 and unit_lower in _THOUSANDS_DOT_UNITS:
            return Decimal(whole + frac)
    normalized = raw_number.replace(",", ".")
    return Decimal(normalized)


def standardize_unit(quantity: Decimal, raw_unit: str) -> NormalizedContent:
    """Convierte una cantidad y unidad textual a la unidad canónica (`g`, `ml`, `und`)."""
    unit_key = raw_unit.strip().lower()
    if unit_key not in _UNIT_CONVERSIONS:
        raise ValueError(f"Unidad de medida no soportada: {raw_unit!r}")
    if quantity <= 0:
        raise ValueError(f"La cantidad neta debe ser positiva: {quantity}")

    target_unit, multiplier = _UNIT_CONVERSIONS[unit_key]
    converted = (quantity * multiplier).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if converted <= 0:
        raise ValueError(f"Contenido convertido inválido: {converted}")
    return NormalizedContent(net_content=converted, unit_measure=target_unit)


def extract_content_from_text(text: str) -> NormalizedContent | None:
    """Extrae y estandariza gramaje, volumen o unidades desde el nombre de producto."""
    if not text:
        return None

    multipack_match = MULTIPACK_REGEX.search(text)
    if multipack_match:
        pack_count = int(multipack_match.group(1))
        item_qty = _parse_numeric_token(multipack_match.group(2), multipack_match.group(3))
        if pack_count > 0 and item_qty > 0:
            total_qty = item_qty * Decimal(pack_count)
            standardized = standardize_unit(total_qty, multipack_match.group(3))
            return NormalizedContent(
                net_content=standardized.net_content,
                unit_measure=standardized.unit_measure,
                raw_match=multipack_match.group(0),
            )

    match = CONTENT_REGEX.search(text)
    if not match:
        return None

    try:
        qty = _parse_numeric_token(match.group(1), match.group(2))
        if qty <= 0:
            return None
        standardized = standardize_unit(qty, match.group(2))
    except (InvalidOperation, ValueError):
        return None

    return NormalizedContent(
        net_content=standardized.net_content,
        unit_measure=standardized.unit_measure,
        raw_match=match.group(0),
    )


def resolve_content(
    raw_name: str,
    measurement_unit: str | None = None,
    unit_multiplier: float | int | Decimal | None = None,
) -> NormalizedContent:
    """Resuelve contenido neto usando regex sobre el título y fallback de VTEX si aplica."""
    extracted = extract_content_from_text(raw_name)
    if extracted is not None:
        return extracted

    if measurement_unit:
        unit_key = measurement_unit.strip().lower()
        if unit_key in _UNIT_CONVERSIONS:
            multiplier = Decimal(str(unit_multiplier)) if unit_multiplier not in (None, 0) else Decimal("1")
            if multiplier > 0:
                try:
                    standardized = standardize_unit(multiplier, unit_key)
                    return NormalizedContent(
                        net_content=standardized.net_content,
                        unit_measure=standardized.unit_measure,
                        raw_match=f"{multiplier} {measurement_unit}",
                    )
                except ValueError:
                    pass

    return NormalizedContent(net_content=Decimal("1.00"), unit_measure=UnitMeasure.UND)


def normalize_product_name(name: str) -> str:
    """Normaliza texto en minúsculas sin tildes ni ruido para búsqueda `pg_trgm`."""
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_text = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    lowered = ascii_text.lower()
    cleaned = re.sub(r"[^a-z0-9\s\.]", " ", lowered)
    cleaned = re.sub(r"(?<!\d)\.(?!\d)", " ", cleaned)
    collapsed = " ".join(cleaned.split())
    return (collapsed or lowered.strip())[:255]


def normalize_ean(raw_ean: str | None) -> str | None:
    """Normaliza un código de barras GTIN/EAN-13 o retorna `None` si es inválido."""
    if not raw_ean:
        return None
    digits = "".join(ch for ch in str(raw_ean).strip() if ch.isdigit())
    if len(digits) not in {8, 12, 13, 14} or set(digits) == {"0"}:
        return None
    return digits


def is_valid_gtin_checksum(ean: str) -> bool:
    """Verifica el dígito de control GS1 módulo 10 para códigos GTIN-8/12/13/14."""
    if not ean.isdigit() or len(ean) not in {8, 12, 13, 14}:
        return False
    digits = [int(d) for d in ean]
    check = digits[-1]
    body = digits[:-1]
    total = 0
    for idx, digit in enumerate(reversed(body)):
        total += digit * (3 if idx % 2 == 0 else 1)
    expected = (10 - (total % 10)) % 10
    return check == expected


def compute_pum(calibrated_price: Decimal, net_content: Decimal) -> Decimal:
    """Calcula el Precio por Unidad de Medida: `PUM = precio_calibrado / net_content`."""
    if net_content <= 0:
        raise ValueError(f"net_content debe ser mayor que 0 para calcular PUM, recibido: {net_content}")
    if calibrated_price < 0:
        raise ValueError(f"calibrated_price no puede ser negativo: {calibrated_price}")
    return (calibrated_price / net_content).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
