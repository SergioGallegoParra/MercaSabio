"""Utilidades geoespaciales, caché TTL y normalización para la API de Tiendas Ara."""

from __future__ import annotations

import base64
import json
import math
import os
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

EARTH_RADIUS_KM = 6371.0
DEFAULT_CACHE_TTL_SECONDS = 15 * 60  # 15 minutos

# Coincide con X25, X 25, X-25 o X.25 como palabra independiente (ventas al por mayor)
_WHOLESALE_X25_RE = re.compile(r"\bx\s*[-.]?\s*25\b", re.IGNORECASE)

T = TypeVar("T")


class AraStore(BaseModel):
    """Tienda física de Ara con distancia calculada respecto al usuario."""

    store_id: str
    name: str
    city: str
    department: str
    address: str
    latitude: float
    longitude: float
    region: str = ""
    distance_km: float


class AraProduct(BaseModel):
    """Producto crudo normalizado extraído de Tiendas Ara (precio ya en COP)."""

    id: str
    code_ean: str | None = None
    code_sap: str | None = None
    store_id: str
    title: str
    price: int
    pum: str | None = None
    category_id: str | None = None
    category: str | None = None
    images: list[str] = Field(default_factory=list)


@dataclass(slots=True)
class CachedSearchResult:
    """Entrada cacheada de resultados de `/products-search` para una tienda y query."""

    items: list[AraProduct]
    ara_next_token: str | None = None


@dataclass(slots=True)
class _CacheEntry(Generic[T]):
    expires_at: float
    value: T


class TTLMemoryCache(Generic[T]):
    """Caché en memoria con expiración por TTL y reloj inyectable para pruebas."""

    def __init__(
        self,
        default_ttl_seconds: float = DEFAULT_CACHE_TTL_SECONDS,
        *,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._default_ttl = float(default_ttl_seconds)
        self._clock = clock or time.monotonic
        self._entries: dict[str, _CacheEntry[T]] = {}

    def get(self, key: str) -> T | None:
        """Retorna el valor si existe y no ha expirado; de lo contrario elimina y retorna None."""
        entry = self._entries.get(key)
        if entry is None:
            return None
        if self._clock() >= entry.expires_at:
            self._entries.pop(key, None)
            return None
        return entry.value

    def set(self, key: str, value: T, ttl_seconds: float | None = None) -> None:
        """Almacena una entrada con vencimiento absoluto según `clock()`."""
        ttl = self._default_ttl if ttl_seconds is None else float(ttl_seconds)
        self._entries[key] = _CacheEntry(expires_at=self._clock() + ttl, value=value)

    def clear(self) -> None:
        """Vacía todas las entradas en memoria."""
        self._entries.clear()

    def purge_expired(self) -> int:
        """Limpia llaves vencidas y retorna cuántas se eliminaron."""
        now = self._clock()
        expired_keys = [k for k, v in self._entries.items() if now >= v.expires_at]
        for key in expired_keys:
            self._entries.pop(key, None)
        return len(expired_keys)

    def __len__(self) -> int:
        self.purge_expired()
        return len(self._entries)


def load_env_file_if_missing(env_path: Path | None = None) -> None:
    """Carga variables faltantes desde `.env` en la raíz del proyecto sin sobrescribir entorno."""
    candidate = env_path or (Path(__file__).resolve().parents[2] / ".env")
    if not candidate.is_file():
        return

    for raw_line in candidate.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        clean_key = key.strip()
        if not clean_key or clean_key in os.environ:
            continue
        clean_val = value.strip()
        if len(clean_val) >= 2 and clean_val[0] == clean_val[-1] and clean_val[0] in {"'", '"'}:
            clean_val = clean_val[1:-1]
        os.environ[clean_key] = clean_val


def make_search_cache_key(store_id: str, query: str) -> str:
    """Construye la llave exacta de caché `f"{store_id}_{query}"` normalizando espacios y minúsculas."""
    clean_store = store_id.strip()
    clean_query = " ".join(query.strip().lower().split())
    return f"{clean_store}_{clean_query}"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calcula la distancia ortodrómica (Haversine) en kilómetros entre dos coordenadas."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(d_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return EARTH_RADIUS_KM * c


def is_wholesale_x25(title: str) -> bool:
    """Detecta referencias al por mayor (`X25` / `X 25`) para evitar distorsiones de precio."""
    return bool(_WHOLESALE_X25_RE.search(title))


def parse_price_cop(raw_price: Any) -> int | None:
    """Convierte el campo `price` a COP entero positivo.

    Nota verificada en vivo contra `api-gw-prod-v1-501aqrta.ew.gateway.dev`:
    `price` ya viene en pesos colombianos enteros (ej. 6390 para 185g con PUM "Gramo a $34.54"),
    por lo que no debe dividirse entre 100.
    """
    if raw_price is None or isinstance(raw_price, bool):
        return None
    try:
        numeric = float(raw_price)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric) or numeric <= 0:
        return None
    return int(round(numeric))


def parse_store_record(
    raw: dict[str, Any],
    user_lat: float,
    user_lon: float,
) -> AraStore | None:
    """Valida una tienda cruda del endpoint `/stores` y calcula su distancia al usuario."""
    if str(raw.get("status", "1")).strip() != "1":
        return None

    # El campo `id` (ej. "0719") corresponde a `codeStore` en productos; `ID` es un consecutivo interno.
    store_id = str(raw.get("id") or raw.get("ID") or "").strip()
    if not store_id:
        return None

    try:
        store_lat = float(raw["latitude"])
        store_lon = float(raw["longitude"])
    except (KeyError, TypeError, ValueError):
        return None

    if not (math.isfinite(store_lat) and math.isfinite(store_lon)):
        return None
    if store_lat == 0.0 and store_lon == 0.0:
        return None

    distance = haversine_km(user_lat, user_lon, store_lat, store_lon)
    return AraStore(
        store_id=store_id,
        name=str(raw.get("name") or f"Ara {store_id}").strip(),
        city=str(raw.get("city") or "").strip(),
        department=str(raw.get("department") or "").strip(),
        address=str(raw.get("address") or "").strip(),
        latitude=store_lat,
        longitude=store_lon,
        region=str(raw.get("region") or "").strip(),
        distance_km=round(distance, 3),
    )


def select_nearest_stores(
    raw_stores: list[dict[str, Any]],
    user_lat: float,
    user_lon: float,
    radio_km: float,
    *,
    limit: int = 5,
) -> list[AraStore]:
    """Filtra tiendas activas dentro de `radio_km` y retorna hasta las `limit` más cercanas."""
    nearby: list[AraStore] = []
    for raw in raw_stores:
        parsed = parse_store_record(raw, user_lat, user_lon)
        if parsed is not None and parsed.distance_km <= radio_km:
            nearby.append(parsed)
    nearby.sort(key=lambda store: (store.distance_km, store.store_id))
    return nearby[:limit]


def normalize_ara_product(raw: dict[str, Any], *, fallback_store_id: str = "") -> AraProduct | None:
    """Extrae campos clave de un producto Ara descartando deshabilitados y `X25`/`X 25`."""
    if raw.get("isDisabled") is True:
        return None

    title = " ".join(str(raw.get("title") or "").split())
    if not title or is_wholesale_x25(title):
        return None

    price = parse_price_cop(raw.get("price"))
    if price is None:
        return None

    product_id = str(raw.get("id") or "").strip()
    store_id = str(raw.get("codeStore") or fallback_store_id).strip()
    if not product_id or not store_id:
        return None

    raw_images = raw.get("images") or []
    images = [str(img).strip() for img in raw_images if img and str(img).strip()]

    raw_ean = str(raw.get("codeEAN") or "").strip() or None
    raw_sap = str(raw.get("codeSAP") or "").strip() or None
    raw_pum = str(raw.get("pum") or "").strip() or None
    raw_cat_id = str(raw.get("categoryId") or "").strip() or None
    raw_cat_name = str(raw.get("category") or "").strip() or None

    return AraProduct(
        id=product_id,
        code_ean=raw_ean,
        code_sap=raw_sap,
        store_id=store_id,
        title=title,
        price=price,
        pum=raw_pum,
        category_id=raw_cat_id,
        category=raw_cat_name,
        images=images,
    )


def encode_page_token(store_idx: int, ara_token: str | None) -> str:
    """Serializa el cursor de lazy-loading (índice de tienda + nextPageToken de Ara)."""
    payload = json.dumps({"i": store_idx, "t": ara_token}, separators=(",", ":"))
    encoded = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii")
    return encoded.rstrip("=")


def decode_page_token(page_token: str) -> tuple[int, str | None]:
    """Decodifica el cursor de lazy-loading; lanza ValueError si el token es inválido."""
    clean = page_token.strip()
    if not clean:
        raise ValueError("Token vacío.")
    padded = clean + "=" * (-len(clean) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        data = json.loads(decoded)
    except Exception as exc:
        raise ValueError("Formato de page_token inválido.") from exc

    if not isinstance(data, dict) or not isinstance(data.get("i"), int):
        raise ValueError("Estructura de page_token inválida.")
    store_idx = data["i"]
    ara_token = data.get("t")
    if store_idx < 0 or (ara_token is not None and not isinstance(ara_token, str)):
        raise ValueError("Valores de page_token fuera de rango.")
    return store_idx, ara_token
