"""Motor multi-fuente para ingesta de sucursales en Colombia (VTEX, Google Places y directorio)."""

from __future__ import annotations

import argparse
import asyncio
import logging
import math
import os
import re
import unicodedata
from collections.abc import Sequence
from typing import Any

import httpx
import psycopg

from etl.locations.colombia_capitals_directory import (
    COLOMBIA_CAPITALS_DIRECTORY,
    CapitalCitySpec,
    generate_curated_colombia_branches,
)
from etl.locations.models import BranchRecord

logger = logging.getLogger("etl.locations.branch_ingestor")

SOURCE_PRIORITY: dict[str, int] = {
    "ara_api": 4,
    "google_places": 3,
    "google_places_legacy": 3,
    "vtex_pickup": 2,
    "osm": 2,
    "curated": 1,
}

VTEX_PICKUP_DOMAINS: tuple[tuple[str, str], ...] = (
    ("exito", "exitocol.vtexcommercestable.com.br"),
    ("carulla", "carulla.vtexcommercestable.com.br"),
    ("olimpica", "www.olimpica.com"),
    ("euro", "www.eurosupermercados.com.co"),
    ("mercaldas", "www.mercaldas.com"),
    ("megatiendas", "www.megatiendas.co"),
    ("mercacentro", "www.mercacentro.com"),
    ("jumbo", "www.jumbocolombia.com"),
)

GOOGLE_CHAIN_QUERIES: dict[str, str] = {
    "ara": "Tiendas Ara supermercado",
    "d1": "Tiendas D1 supermercado",
    "olimpica": "Supermercados Olímpica SAO",
    "exito": "Almacenes Éxito supermercado",
    "carulla": "Supermercados Carulla",
    "farmatodo": "Farmatodo",
    "euro": "Euro Supermercados",
    "oxxo": "Tiendas OXXO",
    "mercaldas": "Supermercados Mercaldas",
    "isimo": "Tiendas Ísimo",
    "zapatoca": "Supermercados Zapatoca",
    "makro": "Makro Supermayorista",
    "megatiendas": "Supermercados Megatiendas",
    "mercacentro": "Supermercados Mercacentro",
    "jumbo": "Tiendas Jumbo Cencosud supermercado",
}

_BRAND_KEYWORDS: dict[str, tuple[str, ...]] = {
    "ara": ("ara",),
    "d1": ("d1", "tiendas d1"),
    "olimpica": ("olimpica", "sao", "supertienda"),
    "exito": ("exito", "super inter", "surtimax", "surtimayorista"),
    "carulla": ("carulla",),
    "farmatodo": ("farmatodo",),
    "euro": ("euro",),
    "oxxo": ("oxxo",),
    "mercaldas": ("mercaldas",),
    "isimo": ("isimo",),
    "zapatoca": ("zapatoca",),
    "makro": ("makro",),
    "megatiendas": ("megatiendas",),
    "mercacentro": ("mercacentro",),
    "jumbo": ("jumbo", "metro"),
}

_CITY_ALIASES: dict[str, str] = {
    "bogota": "Bogotá",
    "bogota dc": "Bogotá",
    "bogota d c": "Bogotá",
    "santa fe de bogota": "Bogotá",
    "medellin": "Medellín",
    "envigado": "Medellín",
    "sabaneta": "Medellín",
    "bello": "Medellín",
    "itagui": "Medellín",
    "santiago de cali": "Cali",
    "cali": "Cali",
    "barranquilla": "Barranquilla",
    "soledad": "Barranquilla",
    "cartagena": "Cartagena",
    "cartagena de indias": "Cartagena",
    "bucaramanga": "Bucaramanga",
    "floridablanca": "Bucaramanga",
    "giron": "Bucaramanga",
    "pereira": "Pereira",
    "dosquebradas": "Pereira",
    "manizales": "Manizales",
    "armenia": "Armenia",
    "ibague": "Ibagué",
    "cucuta": "Cúcuta",
    "san jose de cucuta": "Cúcuta",
    "santa marta": "Santa Marta",
    "villavicencio": "Villavicencio",
    "pasto": "Pasto",
    "san juan de pasto": "Pasto",
    "monteria": "Montería",
    "neiva": "Neiva",
    "valledupar": "Valledupar",
    "popayan": "Popayán",
    "tunja": "Tunja",
    "sincelejo": "Sincelejo",
    "riohacha": "Riohacha",
    "quibdo": "Quibdó",
    "florencia": "Florencia",
    "yopal": "Yopal",
    "mocoa": "Mocoa",
    "san andres": "San Andrés",
    "leticia": "Leticia",
    "arauca": "Arauca",
    "san jose del guaviare": "San José del Guaviare",
    "inirida": "Inírida",
    "puerto inirida": "Inírida",
    "mitu": "Mitú",
    "puerto carreno": "Puerto Carreño",
    "cajic": "Cajicá",
    "cajica": "Cajicá",
    "jamundi": "Jamundí",
    "san jeronimo": "San Jerónimo",
    "tolu": "Tolú",
    "acacias": "Acacías",
    "chia": "Chía",
    "quinchia": "Quinchía",
    "apartado": "Apartadó",
    "tamesis": "Támesis",
    "sahagun": "Sahagún",
    "cerete": "Cereté",
    "chinchina": "Chinchiná",
    "tuquerres": "Túquerres",
    "magangue": "Magangué",
    "fresno": "Fresno",
    "facatativa": "Facatativá",
    "zipaquira": "Zipaquirá",
    "fusagasuga": "Fusagasugá",
    "girardot": "Girardot",
    "sogamoso": "Sogamoso",
    "duitama": "Duitama",
    "chiquinquira": "Chiquinquirá",
    "piedecuesta": "Bucaramanga",
}

_PREFIX_SAFE_ALIASES: tuple[tuple[str, str], ...] = (
    ("bogota", "Bogotá"),
    ("santa fe de bogota", "Bogotá"),
    ("santiago de cali", "Cali"),
    ("cartagena de indias", "Cartagena"),
    ("san jose de cucuta", "Cúcuta"),
    ("san juan de pasto", "Pasto"),
    ("san jose del guaviare", "San José del Guaviare"),
    ("puerto inirida", "Inírida"),
    ("puerto carreno", "Puerto Carreño"),
)

_EXCLUDED_COURIER_TOKENS = (
    "servientrega",
    "interrapidisimo",
    "inter rapidisimo",
    "coordinadora",
    "deprisa",
    "envia",
    "efecty",
    "4-72",
    "tcc",
    "locker",
    "pasarela",
)


_CORRUPT_CITY_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"^c.?cuta$", "Cúcuta"),
    (r"^cajic.?$", "Cajicá"),
    (r"^bogot.?$", "Bogotá"),
    (r"^medell.?n$", "Medellín"),
    (r"^ibagu.?$", "Ibagué"),
    (r"^monter.?a$", "Montería"),
    (r"^popay.?n$", "Popayán"),
    (r"^quibd.?$", "Quibdó"),
    (r"^in.?rida$", "Inírida"),
    (r"^mit.?$", "Mitú"),
    (r"puerto carre.?o", "Puerto Carreño"),
    (r"san andr.?s", "San Andrés"),
    (r"san jos.? del guaviare", "San José del Guaviare"),
)


def _strip_accents(value: str) -> str:
    nfkd = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch))


def _sanitize_text(value: str | None) -> str:
    if not value:
        return ""
    cleaned = re.sub(r"\ufffd+", "", str(value))
    return re.sub(r"\s+", " ", cleaned).strip()


def normalize_colombia_city(raw_city: str | None, fallback_city: str = "Bogotá") -> str:
    """Normaliza variantes municipales/VTEX hacia los nombres oficiales de capital."""
    raw = str(raw_city or "").strip()
    if not raw:
        return fallback_city
    if "\ufffd" in raw:
        lower_corrupt = raw.lower().split(",")[0].strip()
        for pattern, canonical in _CORRUPT_CITY_PATTERNS:
            if re.search(pattern, lower_corrupt):
                return canonical

    text = _sanitize_text(raw)
    cleaned = _strip_accents(text).lower()
    cleaned = re.sub(r"[.,]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if cleaned in _CITY_ALIASES:
        return _CITY_ALIASES[cleaned]
    for pattern, canonical in _CORRUPT_CITY_PATTERNS:
        if re.search(pattern, cleaned):
            return canonical
    for prefix, canonical in _PREFIX_SAFE_ALIASES:
        if cleaned == prefix or cleaned.startswith(f"{prefix} "):
            return canonical
    return text.split(",")[0].strip()[:80] or fallback_city


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calcula distancia geodésica en metros entre dos coordenadas WGS84."""
    r = 6_371_000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    return r * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def _infer_vtex_store_id(friendly_name: str, default_store_id: str) -> str | None:
    lowered = _strip_accents(friendly_name).lower()
    if any(tok in lowered for tok in _EXCLUDED_COURIER_TOKENS):
        return None
    if "carulla" in lowered:
        return "carulla"
    if "exito" in lowered:
        return "exito"
    if "olimpica" in lowered or "sao " in lowered or lowered.startswith("sao"):
        return "olimpica"
    if "euro" in lowered:
        return "euro"
    if "mercaldas" in lowered:
        return "mercaldas"
    if "megatiendas" in lowered:
        return "megatiendas"
    if "mercacentro" in lowered:
        return "mercacentro"
    if "jumbo" in lowered or "metro" in lowered:
        return "jumbo"
    if default_store_id in {
        "euro",
        "mercaldas",
        "olimpica",
        "exito",
        "carulla",
        "megatiendas",
        "mercacentro",
        "jumbo",
    }:
        return default_store_id
    return None


def parse_vtex_pickup_items(
    payload: dict[str, Any] | list[Any],
    *,
    default_store_id: str,
    fallback_city: str,
    fallback_department: str = "",
) -> list[BranchRecord]:
    """Convierte la respuesta de `/api/checkout/pub/pickup-points` en `BranchRecord`."""
    raw_items = payload.get("items", []) if isinstance(payload, dict) else payload
    if not isinstance(raw_items, list):
        return []

    records: list[BranchRecord] = []
    for entry in raw_items:
        if not isinstance(entry, dict):
            continue
        pp = entry.get("pickupPoint") if isinstance(entry.get("pickupPoint"), dict) else entry
        if not isinstance(pp, dict):
            continue

        friendly_name = _sanitize_text(pp.get("friendlyName") or pp.get("name"))
        if not friendly_name:
            continue

        store_id = _infer_vtex_store_id(friendly_name, default_store_id)
        if not store_id:
            continue

        addr = pp.get("address") if isinstance(pp.get("address"), dict) else {}
        geo = addr.get("geoCoordinates")
        if not isinstance(geo, (list, tuple)) or len(geo) < 2:
            continue
        try:
            lng = float(geo[0])
            lat = float(geo[1])
        except (TypeError, ValueError):
            continue

        if not (-5.0 <= lat <= 14.0 and -82.5 <= lng <= -66.5):
            continue

        city = normalize_colombia_city(addr.get("city"), fallback_city=fallback_city)
        department = _sanitize_text(addr.get("state") or fallback_department or city)[:80] or city
        barrio = _sanitize_text(addr.get("neighborhood") or city)[:100] or city
        street = _sanitize_text(addr.get("street"))
        number = _sanitize_text(addr.get("number"))
        address_parts = [p for p in (street, f"#{number}" if number and number not in street else "", barrio if barrio and barrio != city else "", city) if p]
        address = ", ".join(address_parts)[:240] or friendly_name

        ext_id = str(pp.get("id") or f"{store_id}:{friendly_name}:{city}")[:120]
        records.append(
            BranchRecord(
                store_id=store_id,
                branch_name=friendly_name[:150],
                city=city[:80],
                department=department,
                barrio=barrio,
                address=address,
                lat=round(lat, 6),
                lng=round(lng, 6),
                source_provider="vtex_pickup",
                external_place_id=f"vtex:{default_store_id}:{ext_id}"[:120],
            )
        )
    return records


def fetch_vtex_pickup_branches(
    capitals: Sequence[CapitalCitySpec] = COLOMBIA_CAPITALS_DIRECTORY,
    *,
    timeout: float = 12.0,
) -> list[BranchRecord]:
    """Consulta puntos físicos reales de VTEX Pickup Points alrededor de capitales colombianas."""
    collected: list[BranchRecord] = []
    # Consultar centro de cada capital + todas las zonas en las 6 principales áreas metropolitanas
    probe_points: list[tuple[str, str, float, float]] = []
    for cap in capitals:
        probe_points.append((cap.city, cap.department, cap.center_lat, cap.center_lng))
        if cap.city in {"Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Bucaramanga"}:
            for z in cap.zones:
                probe_points.append((cap.city, cap.department, z.lat, z.lng))

    transport = httpx.HTTPTransport(local_address="0.0.0.0")
    headers = {"User-Agent": "MercaSabio-Geo/1.0", "Accept": "application/json"}
    with httpx.Client(transport=transport, timeout=timeout, headers=headers) as client:
        for default_store_id, domain in VTEX_PICKUP_DOMAINS:
            domain_hits = 0
            for city, dept, lat, lng in probe_points:
                url = f"https://{domain}/api/checkout/pub/pickup-points"
                try:
                    resp = client.get(url, params={"geoCoordinates": f"{lng};{lat}"})
                    if resp.status_code != 200:
                        continue
                    parsed = parse_vtex_pickup_items(
                        resp.json(),
                        default_store_id=default_store_id,
                        fallback_city=city,
                        fallback_department=dept,
                    )
                    collected.extend(parsed)
                    domain_hits += len(parsed)
                except Exception as exc:
                    logger.debug("VTEX pickup error (%s en %s): %s", domain, city, exc)
            logger.info("VTEX pickup [%s]: %d puntos brutos recolectados", domain, domain_hits)
    return collected


def _matches_chain_brand(name: str, store_id: str) -> bool:
    """Verifica que el lugar devuelto por Google realmente corresponda a la cadena consultada."""
    normalized = _strip_accents(name).lower()
    keywords = _BRAND_KEYWORDS.get(store_id)
    if not keywords:
        return True
    for kw in keywords:
        if re.search(rf"\b{re.escape(kw)}\b", normalized):
            return True
    return False


_GENERIC_BRANCH_NAMES: frozenset[str] = frozenset({
    "d1",
    "tienda d1",
    "tiendas d1",
    "supermercado d1",
    "ara",
    "tienda ara",
    "tiendas ara",
    "oxxo",
    "tiendas oxxo",
    "farmatodo",
    "isimo",
    "tienda isimo",
    "tiendas isimo",
    "olimpica",
    "supertienda olimpica",
    "exito",
    "almacenes exito",
    "carulla",
    "mercaldas",
    "euro",
    "euro supermercados",
    "makro",
    "zapatoca",
})


_DEPARTMENT_NAMES_NORM: frozenset[str] = frozenset({
    "antioquia",
    "arauca",
    "atlantico",
    "bolivar",
    "boyaca",
    "caldas",
    "caqueta",
    "casanare",
    "cauca",
    "cesar",
    "choco",
    "cordoba",
    "cundinamarca",
    "guainia",
    "guaviare",
    "huila",
    "la guajira",
    "magdalena",
    "meta",
    "narino",
    "norte de santander",
    "putumayo",
    "quindio",
    "risaralda",
    "san andres y providencia",
    "archipielago de san andres, providencia y santa catalina",
    "santander",
    "sucre",
    "tolima",
    "valle del cauca",
    "vaupes",
    "vichada",
    "colombia",
})


def _extract_city_from_address(address: str | None, fallback_city: str) -> str:
    """Extrae la ciudad real desde una dirección de Google Places (ej. '..., Manizales, Caldas')."""
    if not address:
        return normalize_colombia_city(fallback_city, fallback_city=fallback_city)
    parts = [_sanitize_text(p) for p in address.split(",") if _sanitize_text(p)]
    while parts and _strip_accents(parts[-1]).lower() in {"colombia", "co"}:
        parts.pop()
    if not parts:
        return normalize_colombia_city(fallback_city, fallback_city=fallback_city)

    # Si el último segmento es un departamento (no una ciudad), tomar el segmento anterior como ciudad
    last_norm = _strip_accents(parts[-1]).lower()
    if len(parts) >= 2 and last_norm in _DEPARTMENT_NAMES_NORM:
        candidate = parts[-2]
    else:
        candidate = parts[-1]

    # Evitar tomar números de calle como ciudad cuando la dirección viene incompleta
    if re.search(r"[#\d]", candidate) and len(parts) >= 2:
        for seg in reversed(parts):
            seg_norm = _strip_accents(seg).lower()
            if seg_norm not in _DEPARTMENT_NAMES_NORM and not re.search(r"[#\d]", seg):
                candidate = seg
                break

    if re.search(r"[#\d]", candidate):
        return normalize_colombia_city(fallback_city, fallback_city=fallback_city)
    return normalize_colombia_city(candidate, fallback_city=fallback_city)


def _disambiguate_branch_name(name: str, address: str, barrio: str, city: str) -> str:
    """Agrega calle o barrio a nombres genéricos (ej. 'Tiendas D1') para no colisionar sedes distintas."""
    cleaned_name = _sanitize_text(name)
    norm_name = _strip_accents(cleaned_name).lower()
    if norm_name not in _GENERIC_BRANCH_NAMES:
        return cleaned_name[:150]

    street_part = ""
    if address:
        for seg in address.split(","):
            seg_clean = _sanitize_text(seg)
            if not seg_clean:
                continue
            seg_norm = _strip_accents(seg_clean).lower()
            if seg_norm in {city.lower(), _strip_accents(city).lower(), "colombia"}:
                continue
            if len(seg_clean) >= 3:
                street_part = seg_clean
                break

    suffix = street_part or _sanitize_text(barrio.split("/")[0])
    if suffix and _strip_accents(suffix).lower() not in norm_name:
        return f"{cleaned_name} · {suffix}"[:150]
    return cleaned_name[:150]


def parse_google_places_response(
    payload: dict[str, Any],
    *,
    store_id: str,
    city: str,
    department: str = "",
    barrio: str = "",
) -> list[BranchRecord]:
    """Convierte respuestas de Google Places API (New v1 o Legacy) en `BranchRecord`."""
    records: list[BranchRecord] = []
    norm_city = normalize_colombia_city(city, fallback_city=city)

    # Formato Places API (New) v1: {"places": [...]}
    places_v1 = payload.get("places")
    if isinstance(places_v1, list):
        for place in places_v1:
            if not isinstance(place, dict):
                continue
            loc = place.get("location") or {}
            lat = loc.get("latitude")
            lng = loc.get("longitude")
            if lat is None or lng is None:
                continue
            disp = place.get("displayName") or {}
            raw_name = str(disp.get("text") if isinstance(disp, dict) else disp or "").strip()
            if not raw_name or not _matches_chain_brand(raw_name, store_id):
                continue
            address = str(place.get("formattedAddress") or raw_name).strip()
            real_city = _extract_city_from_address(address, city)
            branch_name = _disambiguate_branch_name(raw_name, address, barrio, real_city)
            place_id = str(place.get("id") or "")[:110]
            records.append(
                BranchRecord(
                    store_id=store_id,
                    branch_name=branch_name,
                    city=real_city,
                    department=(department or real_city)[:80],
                    barrio=(barrio or real_city)[:100],
                    address=address[:240],
                    lat=round(float(lat), 6),
                    lng=round(float(lng), 6),
                    source_provider="google_places",
                    external_place_id=f"gplace:{place_id}"[:120] if place_id else None,
                )
            )
        return records

    # Formato Legacy Text Search: {"results": [...]}
    legacy_results = payload.get("results")
    if isinstance(legacy_results, list):
        for item in legacy_results:
            if not isinstance(item, dict):
                continue
            geom = (item.get("geometry") or {}).get("location") or {}
            lat = geom.get("lat")
            lng = geom.get("lng")
            if lat is None or lng is None:
                continue
            raw_name = str(item.get("name") or "").strip()
            if not raw_name or not _matches_chain_brand(raw_name, store_id):
                continue
            address = str(item.get("formatted_address") or raw_name).strip()
            real_city = _extract_city_from_address(address, city)
            branch_name = _disambiguate_branch_name(raw_name, address, barrio, real_city)
            place_id = str(item.get("place_id") or "")[:110]
            records.append(
                BranchRecord(
                    store_id=store_id,
                    branch_name=branch_name,
                    city=real_city,
                    department=(department or real_city)[:80],
                    barrio=(barrio or real_city)[:100],
                    address=address[:240],
                    lat=round(float(lat), 6),
                    lng=round(float(lng), 6),
                    source_provider="google_places_legacy",
                    external_place_id=f"gplace:{place_id}"[:120] if place_id else None,
                )
            )
    return records


async def _query_google_v1_task(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    *,
    api_key: str,
    store_id: str,
    query: str,
    city: str,
    department: str,
    barrio: str,
    lat: float,
    lng: float,
    radius_m: float,
    max_pages: int = 1,
) -> list[BranchRecord]:
    out: list[BranchRecord] = []
    page_token: str | None = None
    async with sem:
        for _ in range(max_pages):
            body: dict[str, Any] = {
                "textQuery": query,
                "languageCode": "es",
                "regionCode": "CO",
                "pageSize": 20,
                "locationBias": {
                    "circle": {
                        "center": {"latitude": lat, "longitude": lng},
                        "radius": radius_m,
                    }
                },
            }
            if page_token:
                body["pageToken"] = page_token
            try:
                resp = await client.post(
                    "https://places.googleapis.com/v1/places:searchText",
                    headers={
                        "X-Goog-Api-Key": api_key,
                        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,nextPageToken",
                    },
                    json=body,
                )
                if resp.status_code != 200:
                    break
                payload = resp.json()
                out.extend(
                    parse_google_places_response(
                        payload,
                        store_id=store_id,
                        city=city,
                        department=department,
                        barrio=barrio,
                    )
                )
                page_token = payload.get("nextPageToken")
                if not page_token:
                    break
            except Exception as exc:
                logger.debug("Error en Google Places v1 (%s, %s): %s", store_id, city, exc)
                break
    return out


async def _fetch_google_places_async(
    api_key: str,
    capitals: Sequence[CapitalCitySpec],
    target_stores: tuple[str, ...],
    timeout: float,
) -> list[BranchRecord]:
    sem = asyncio.Semaphore(12)
    transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")
    tasks: list[Any] = []
    async with httpx.AsyncClient(transport=transport, timeout=timeout) as client:
        for cap in capitals:
            cap_stores = {s for z in cap.zones for s in z.stores}
            for store_id in target_stores:
                if store_id not in cap_stores:
                    continue
                chain_q = GOOGLE_CHAIN_QUERIES.get(store_id, store_id)
                # 1) Búsqueda general de ciudad (hasta 3 páginas = 60 sedes)
                tasks.append(
                    _query_google_v1_task(
                        client,
                        sem,
                        api_key=api_key,
                        store_id=store_id,
                        query=f"{chain_q} en {cap.city}, Colombia",
                        city=cap.city,
                        department=cap.department,
                        barrio="",
                        lat=cap.center_lat,
                        lng=cap.center_lng,
                        radius_m=25000.0,
                        max_pages=3,
                    )
                )
            # 2) Búsqueda granular por cada barrio/zona para no perder sedes periféricas (como La Enea)
            for zone in cap.zones:
                barrio_short = zone.barrio.split("/")[0].strip()
                for store_id in zone.stores:
                    if store_id not in target_stores:
                        continue
                    chain_q = GOOGLE_CHAIN_QUERIES.get(store_id, store_id)
                    tasks.append(
                        _query_google_v1_task(
                            client,
                            sem,
                            api_key=api_key,
                            store_id=store_id,
                            query=f"{chain_q} {barrio_short}, {cap.city}, Colombia",
                            city=cap.city,
                            department=cap.department,
                            barrio=zone.barrio,
                            lat=zone.lat,
                            lng=zone.lng,
                            radius_m=4000.0,
                            max_pages=1,
                        )
                    )
        results = await asyncio.gather(*tasks)
    collected: list[BranchRecord] = []
    for chunk in results:
        collected.extend(chunk)
    return collected


def fetch_google_places_branches(
    api_key: str,
    capitals: Sequence[CapitalCitySpec] = COLOMBIA_CAPITALS_DIRECTORY,
    *,
    stores: Sequence[str] | None = None,
    timeout: float = 12.0,
) -> list[BranchRecord]:
    """Consulta Google Places API (New v1) a nivel ciudad y por barrio en toda Colombia."""
    if not api_key:
        logger.info("GOOGLE_MAPS_API_KEY no configurada; se omite consulta en vivo a Google Places.")
        return []

    target_stores = tuple(stores) if stores else tuple(GOOGLE_CHAIN_QUERIES.keys())
    collected = asyncio.run(_fetch_google_places_async(api_key, capitals, target_stores, timeout))
    logger.info("Google Places recolectó %d sedes totales (ciudad + barrios).", len(collected))
    return collected


def deduplicate_branches(
    branches: Sequence[BranchRecord],
    *,
    proximity_threshold_meters: float = 65.0,
) -> list[BranchRecord]:
    """Deduplica sedes por `external_place_id` y cercanía espacial (`< 65 m`), preservando sedes distintas con nombre genérico."""
    ranked = sorted(
        branches,
        key=lambda b: (
            -SOURCE_PRIORITY.get(b.source_provider, 0),
            b.store_id,
            b.city.lower(),
            b.branch_name.lower(),
        ),
    )

    accepted_by_store: dict[str, list[BranchRecord]] = {}
    seen_external_ids: set[str] = set()
    seen_name_keys: set[tuple[str, str, str]] = set()
    output: list[BranchRecord] = []

    for rec in ranked:
        if rec.external_place_id and rec.external_place_id in seen_external_ids:
            continue

        existing_store = accepted_by_store.setdefault(rec.store_id, [])
        too_close = any(
            haversine_meters(rec.lat, rec.lng, prev.lat, prev.lng) < proximity_threshold_meters
            for prev in existing_store
        )
        if too_close:
            continue

        candidate_name = rec.branch_name.strip()
        name_key = (rec.store_id, candidate_name.lower(), rec.city.strip().lower())
        if name_key in seen_name_keys:
            # Sucursales físicamente distintas (>65 m) que aún comparten nombre exacto
            street_tag = _sanitize_text((rec.address or "").split(",")[0])
            suffix = street_tag or f"{rec.lat:.4f},{rec.lng:.4f}"
            candidate_name = f"{candidate_name} ({suffix})"[:150]
            name_key = (rec.store_id, candidate_name.lower(), rec.city.strip().lower())
            if name_key in seen_name_keys:
                candidate_name = f"{candidate_name[:125]} [{rec.lat:.4f},{rec.lng:.4f}]"[:150]
                name_key = (rec.store_id, candidate_name.lower(), rec.city.strip().lower())
            rec = BranchRecord(
                store_id=rec.store_id,
                branch_name=candidate_name,
                city=rec.city,
                department=rec.department,
                barrio=rec.barrio,
                address=rec.address,
                lat=rec.lat,
                lng=rec.lng,
                source_provider=rec.source_provider,
                external_place_id=rec.external_place_id,
            )

        if rec.external_place_id:
            seen_external_ids.add(rec.external_place_id)
        seen_name_keys.add(name_key)
        existing_store.append(rec)
        output.append(rec)

    return output


def _load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for path in (".env", "web/.env.local", "web/.dev.vars"):
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                raw = line.strip()
                if not raw or raw.startswith("#") or "=" not in raw:
                    continue
                k, v = raw.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    for k, v in os.environ.items():
        if v:
            env.setdefault(k, v)
    return env


_BRANCH_UPSERT_SQL = """
    INSERT INTO public.store_branches (
        store_id, branch_name, city, department, barrio, address,
        source_provider, external_place_id, location
    )
    VALUES (
        %s, %s, %s, %s, %s, %s, %s, %s,
        extensions.ST_SetSRID(extensions.ST_MakePoint(%s, %s), 4326)::extensions.geography
    )
    ON CONFLICT (store_id, branch_name, city) DO UPDATE SET
        department = EXCLUDED.department,
        barrio = EXCLUDED.barrio,
        address = EXCLUDED.address,
        source_provider = EXCLUDED.source_provider,
        external_place_id = COALESCE(EXCLUDED.external_place_id, public.store_branches.external_place_id),
        location = EXCLUDED.location;
"""


def _build_branch_db_rows(branches: Sequence[BranchRecord]) -> list[tuple[Any, ...]]:
    return [
        (
            b.store_id,
            b.branch_name[:150],
            b.city[:80],
            b.department[:80] if b.department else b.city[:80],
            b.barrio[:100] if b.barrio else b.city[:100],
            b.address[:500] if b.address else b.branch_name[:150],
            b.source_provider[:40],
            b.external_place_id[:120] if b.external_place_id else None,
            b.lng,
            b.lat,
        )
        for b in branches
    ]


def parse_ara_api_stores(payload: dict[str, Any]) -> list[BranchRecord]:
    """Convierte el payload de `GET /stores` del Gateway de Ara en `BranchRecord` oficiales."""
    raw_stores = payload.get("data") or []
    if not isinstance(raw_stores, list):
        return []

    records: list[BranchRecord] = []
    seen_external_ids: set[str] = set()
    seen_name_keys: set[tuple[str, str]] = set()

    for item in raw_stores:
        if not isinstance(item, dict):
            continue
        if str(item.get("status", "1")).strip() != "1":
            continue

        store_code = str(item.get("id") or item.get("ID") or "").strip()
        if not store_code:
            continue
        external_id = f"ara:{store_code}"
        if external_id in seen_external_ids:
            continue

        try:
            lat = float(item["latitude"])
            lng = float(item["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (-5.0 <= lat <= 14.0 and -82.5 <= lng <= -66.0):
            continue

        raw_city = _sanitize_text(item.get("city"))
        city = normalize_colombia_city(raw_city, fallback_city=raw_city or "Bogotá")
        raw_dept = _sanitize_text(item.get("department"))
        department = normalize_colombia_city(raw_dept, fallback_city=raw_dept or city) if raw_dept else city

        raw_name = _sanitize_text(item.get("name")) or f"{city} - #{store_code}"
        base_name = raw_name if raw_name.lower().startswith("ara ") else f"Ara {raw_name}"
        candidate_name = base_name[:150]
        name_key = (candidate_name.lower(), city.lower())
        if name_key in seen_name_keys:
            candidate_name = f"{base_name[:132]} #{store_code}"[:150]
            name_key = (candidate_name.lower(), city.lower())

        barrio = ""
        if " - " in raw_name:
            barrio = _sanitize_text(raw_name.split(" - ", 1)[1])[:100]
        address = _sanitize_text(item.get("address")) or candidate_name

        seen_external_ids.add(external_id)
        seen_name_keys.add(name_key)
        records.append(
            BranchRecord(
                store_id="ara",
                branch_name=candidate_name,
                city=city,
                department=department[:80],
                barrio=barrio or city[:100],
                address=address[:500],
                lat=lat,
                lng=lng,
                source_provider="ara_api",
                external_place_id=external_id,
            )
        )

    return records


def fetch_ara_api_branches(
    base_url: str,
    api_key: str,
    *,
    timeout: float = 20.0,
) -> list[BranchRecord]:
    """Consulta el directorio oficial `/stores` de Tiendas Ara vía IPv4."""
    clean_base = base_url.strip().rstrip("/")
    clean_key = api_key.strip()
    if not clean_base or not clean_key:
        return []

    transport = httpx.HTTPTransport(local_address="0.0.0.0")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json",
    }
    with httpx.Client(transport=transport, timeout=timeout, headers=headers) as client:
        response = client.get(f"{clean_base}/stores", params={"key": clean_key})
        response.raise_for_status()
        payload = response.json()

    branches = parse_ara_api_stores(payload)
    logger.info("Ara API `/stores`: %d sucursales oficiales recolectadas.", len(branches))
    return branches


def upsert_branches_to_db(
    branches: Sequence[BranchRecord],
    database_url: str,
    *,
    replace_curated: bool = False,
) -> int:
    """Realiza upsert masivo de sucursales en `public.store_branches` usando PostGIS."""
    if not branches:
        return 0

    rows = _build_branch_db_rows(branches)
    with psycopg.connect(database_url, autocommit=False) as conn:
        with conn.cursor() as cur:
            if replace_curated:
                cur.execute("DELETE FROM public.store_branches WHERE source_provider = 'curated';")
                logger.info("Eliminadas sedes sintéticas 'curated' (%d filas) para priorizar ubicaciones reales.", cur.rowcount)
            cur.executemany(_BRANCH_UPSERT_SQL, rows)
        conn.commit()

    return len(rows)


def replace_store_branches_in_db(
    branches: Sequence[BranchRecord],
    database_url: str,
    *,
    store_id: str = "ara",
) -> int:
    """Reemplaza todas las sedes previas de `store_id` por la extracción oficial vigente."""
    target_branches = [b for b in branches if b.store_id == store_id]
    if not target_branches:
        raise ValueError(f"No hay sedes válidas para reemplazar store_id={store_id!r}.")

    rows = _build_branch_db_rows(target_branches)
    with psycopg.connect(database_url, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM public.store_branches WHERE store_id = %s;", (store_id,))
            deleted_count = cur.rowcount
            cur.executemany(_BRANCH_UPSERT_SQL, rows)
        conn.commit()

    logger.info(
        "[%s] Reemplazadas sedes en store_branches: eliminadas=%d, insertadas=%d.",
        store_id,
        deleted_count,
        len(rows),
    )
    return len(rows)


def run_ingestion(
    *,
    source: str = "all",
    dry_run: bool = False,
) -> tuple[list[BranchRecord], int]:
    """Ejecuta el pipeline completo de recolección, deduplicación y guardado."""
    env = _load_env()
    google_key = env.get("GOOGLE_MAPS_API_KEY", "").strip()
    ara_base = env.get("ARA_GW_BASE_URL", "").strip()
    ara_key = env.get("ARA_GW_API_KEY", "").strip()
    database_url = env.get("DATABASE_URL", "").strip()

    all_raw: list[BranchRecord] = []
    ara_official: list[BranchRecord] = []
    has_real_google = False

    if source in ("all", "ara") and ara_base and ara_key:
        ara_official = fetch_ara_api_branches(ara_base, ara_key)
    elif source == "ara":
        raise RuntimeError("Faltan ARA_GW_BASE_URL o ARA_GW_API_KEY para --source ara.")

    if source in ("all", "google") and google_key:
        google_targets = (
            [sid for sid in GOOGLE_CHAIN_QUERIES if sid != "ara"]
            if ara_official
            else None
        )
        gplaces = fetch_google_places_branches(google_key, stores=google_targets)
        if gplaces:
            has_real_google = True
            all_raw.extend(gplaces)
    elif source == "google" and not google_key:
        logger.warning("Se solicitó --source google pero GOOGLE_MAPS_API_KEY no está definida en .env")

    if source in ("all", "vtex"):
        vtex = fetch_vtex_pickup_branches()
        logger.info("VTEX Pickup Points: %d puntos recolectados.", len(vtex))
        all_raw.extend(vtex)

    if source == "curated" or (source == "all" and not has_real_google):
        curated = [
            b
            for b in generate_curated_colombia_branches()
            if not (ara_official and b.store_id == "ara")
        ]
        logger.info("Directorio 32 capitales: %d sedes generadas.", len(curated))
        all_raw.extend(curated)

    deduped = deduplicate_branches(all_raw)
    if all_raw:
        logger.info("Total tras deduplicación espacial (<65 m): %d sedes.", len(deduped))

    written = 0
    if not dry_run:
        if not database_url:
            raise RuntimeError("DATABASE_URL no encontrada en .env ni en variables de entorno.")
        if ara_official:
            written += replace_store_branches_in_db(ara_official, database_url, store_id="ara")
        if deduped:
            written += upsert_branches_to_db(
                deduped,
                database_url,
                replace_curated=has_real_google,
            )
            logger.info("Upsert completado en Supabase store_branches: %d registros totales.", written)

    combined = [*ara_official, *deduped]
    return combined, written


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    parser = argparse.ArgumentParser(description="Ingesta nacional de sedes de supermercados (Colombia)")
    parser.add_argument(
        "--source",
        choices=("all", "curated", "vtex", "google", "ara"),
        default="all",
        help="Fuente a ejecutar (por defecto all)",
    )
    parser.add_argument("--dry-run", action="store_true", help="No escribe en PostgreSQL")
    args = parser.parse_args()
    run_ingestion(source=args.source, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
