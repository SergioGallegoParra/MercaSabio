"""Modelo canónico de sucursal física georreferenciada."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class BranchRecord:
    """Representa una sede física de supermercado normalizada para PostGIS."""

    store_id: str
    branch_name: str
    city: str
    department: str
    barrio: str
    address: str
    lat: float
    lng: float
    source_provider: str = "curated"
    external_place_id: str | None = None
