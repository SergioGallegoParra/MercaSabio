"""Extractor de fabricante y registro sanitario INVIMA desde fichas de producto.

Estado del módulo (Modificación #6): creado y listo para poblar la tabla
`product_manufacturing` / `invima_registry` cuando los scrapers o el catálogo
INVIMA suministren datos verificados. Nunca inventa registros sanitarios.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Mapping, Optional

INVIMA_REGISTRY_RE = re.compile(
    r"\b(NSA[A-Z]?\s*-?\s*\d{4,}[A-Z]?\s*-?\s*\d{2,4}|RSA[A-Z]?\s*-?\s*\d{4,}[A-Z]?\s*-?\s*\d{2,4}|NSOC\s*-?\s*\d{4,}[A-Z]?\s*-?\s*\d{2,4}|SD\d{4}-\d{7})\b",
    re.IGNORECASE,
)

MANUFACTURER_STOP_WORDS = (
    "fabricado por",
    "producido por",
    "elaborado por",
    "envasado por",
    "maquilado por",
    "titular",
)


@dataclass(frozen=True)
class ManufacturingMatch:
    """Resultado normalizado de fabricante y registro INVIMA."""

    invima_registry: Optional[str]
    manufacturer_name: Optional[str]
    plant_hint: Optional[str]
    confidence: float
    evidence_type: str


def _strip_accents(value: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFKD", value) if not unicodedata.combining(ch)
    )


def normalize_invima_registry(raw_value: Optional[str]) -> Optional[str]:
    """Normaliza un código de registro sanitario INVIMA (NSA/RSA/NSOC/SD)."""
    if not raw_value:
        return None
    match = INVIMA_REGISTRY_RE.search(raw_value)
    if not match:
        return None
    compact = re.sub(r"\s+", "", match.group(1).upper())
    return compact


def normalize_manufacturer_name(raw_name: Optional[str]) -> Optional[str]:
    """Limpia prefijos legales comunes conservando la razón social real."""
    if not raw_name:
        return None
    clean = " ".join(raw_name.split()).strip(" ,:;")
    lower_no_accents = _strip_accents(clean).lower()
    for prefix in MANUFACTURER_STOP_WORDS:
        if lower_no_accents.startswith(prefix):
            clean = clean[len(prefix) :].strip(" ,:;")
            break
    if len(clean) < 3:
        return None
    return clean[:180]


def extract_manufacturing_info(
    raw_description: str = "",
    specs: Optional[Mapping[str, str]] = None,
) -> ManufacturingMatch:
    """Extrae registro INVIMA y fabricante desde ficha técnica o descripción."""
    specs = specs or {}
    invima_candidate: Optional[str] = None
    manufacturer_candidate: Optional[str] = None
    plant_hint: Optional[str] = None

    for key, val in specs.items():
        key_norm = _strip_accents(str(key)).lower()
        val_str = str(val or "").strip()
        if not val_str:
            continue
        if any(k in key_norm for k in ("invima", "registro sanitario", "notificacion")):
            invima_candidate = invima_candidate or normalize_invima_registry(val_str)
        elif any(k in key_norm for k in ("fabricante", "productor", "titular", "razon social")):
            manufacturer_candidate = manufacturer_candidate or normalize_manufacturer_name(val_str)
        elif any(k in key_norm for k in ("planta", "ciudad", "origen")):
            plant_hint = plant_hint or val_str[:120]

    if not invima_candidate and raw_description:
        invima_candidate = normalize_invima_registry(raw_description)

    if not manufacturer_candidate and raw_description:
        fab_match = re.search(
            r"(?:fabricado|producido|elaborado|envasado|maquilado)\s+por\s+([A-ZÁÉÍÓÚÑ0-9][A-Za-zÁÉÍÓÚÑáéíóúñ0-9\s.,&\-]{3,90})",
            raw_description,
            re.IGNORECASE,
        )
        if fab_match:
            manufacturer_candidate = normalize_manufacturer_name(fab_match.group(1))

    confidence = 0.0
    evidence_type = "label_scrape"
    if invima_candidate and manufacturer_candidate:
        confidence = 0.90
        evidence_type = "invima_registry"
    elif invima_candidate:
        confidence = 0.85
        evidence_type = "invima_registry"
    elif manufacturer_candidate:
        confidence = 0.65

    return ManufacturingMatch(
        invima_registry=invima_candidate,
        manufacturer_name=manufacturer_candidate,
        plant_hint=plant_hint,
        confidence=confidence,
        evidence_type=evidence_type,
    )
