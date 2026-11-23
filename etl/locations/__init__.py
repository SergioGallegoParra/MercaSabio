"""Módulos geoespaciales y de extracción de sucursales físicas en Colombia."""

from etl.locations.branch_ingestor import (
    BranchRecord,
    deduplicate_branches,
    fetch_google_places_branches,
    fetch_vtex_pickup_branches,
    normalize_colombia_city,
    parse_google_places_response,
    parse_vtex_pickup_items,
    upsert_branches_to_db,
)
from etl.locations.colombia_capitals_directory import (
    COLOMBIA_CAPITALS_DIRECTORY,
    CapitalCitySpec,
    CapitalZoneSpec,
    generate_curated_colombia_branches,
)

__all__ = [
    "BranchRecord",
    "COLOMBIA_CAPITALS_DIRECTORY",
    "CapitalCitySpec",
    "CapitalZoneSpec",
    "deduplicate_branches",
    "fetch_google_places_branches",
    "fetch_vtex_pickup_branches",
    "generate_curated_colombia_branches",
    "normalize_colombia_city",
    "parse_google_places_response",
    "parse_vtex_pickup_items",
    "upsert_branches_to_db",
]
