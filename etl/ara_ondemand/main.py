"""Backend FastAPI On-Demand para comparación y búsqueda en tiempo real en Tiendas Ara."""

from __future__ import annotations

import asyncio
import logging
import os
import random
import socket
import time
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import aiohttp
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator

try:
    from etl.ara_ondemand.utils import (
        AraProduct,
        AraStore,
        CachedSearchResult,
        TTLMemoryCache,
        decode_page_token,
        encode_page_token,
        load_env_file_if_missing,
        make_search_cache_key,
        normalize_ara_product,
        select_nearest_stores,
    )
except ImportError:  # pragma: no cover - soporte al ejecutar uvicorn desde etl/ara_ondemand/
    from utils import (  # type: ignore[no-redef]
        AraProduct,
        AraStore,
        CachedSearchResult,
        TTLMemoryCache,
        decode_page_token,
        encode_page_token,
        load_env_file_if_missing,
        make_search_cache_key,
        normalize_ara_product,
        select_nearest_stores,
    )

logger = logging.getLogger(__name__)

DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
MAX_RADIO_KM = 8.0
MAX_NEARBY_STORES = 5
MAX_CONCURRENT_API_REQUESTS = 5
PRODUCT_CACHE_TTL_SECONDS = 15 * 60  # 15 minutos
STORES_CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 horas
REQUEST_TIMEOUT_SECONDS = 4.0
STORES_TIMEOUT_SECONDS = 12.0  # /stores retorna ~1,653 tiendas (~6.9s medidos en vivo)
MAX_RETRIES = 3
PAGE_SIZE = 20
MAX_CATEGORY_SCAN_PAGES = 3
RATE_LIMIT_JITTER_RANGE = (0.2, 0.5)


class AraStoreRequestError(Exception):
    """Error transitorio o agotamiento de reintentos al consultar una tienda específica."""


class AraBadRequestError(Exception):
    """Error 4xx no reintentable devuelto por la API de Ara."""


@dataclass(frozen=True, slots=True)
class AraConfig:
    """Configuración del cliente Ara Gateway cargada desde variables de entorno."""

    base_url: str
    api_key: str
    user_agent: str = DEFAULT_USER_AGENT
    semaphore_limit: int = MAX_CONCURRENT_API_REQUESTS
    product_cache_ttl_seconds: float = PRODUCT_CACHE_TTL_SECONDS
    stores_cache_ttl_seconds: float = STORES_CACHE_TTL_SECONDS
    request_timeout_seconds: float = REQUEST_TIMEOUT_SECONDS
    stores_timeout_seconds: float = STORES_TIMEOUT_SECONDS
    max_retries: int = MAX_RETRIES
    jitter_min_seconds: float = RATE_LIMIT_JITTER_RANGE[0]
    jitter_max_seconds: float = RATE_LIMIT_JITTER_RANGE[1]

    @classmethod
    def from_env(cls) -> "AraConfig":
        """Carga credenciales obligatorias desde variables de entorno o `.env`."""
        load_env_file_if_missing()
        base_url = os.environ.get("ARA_GW_BASE_URL", "").strip().rstrip("/")
        api_key = os.environ.get("ARA_GW_API_KEY", "").strip()
        if not base_url or not api_key:
            raise RuntimeError(
                "Faltan ARA_GW_BASE_URL o ARA_GW_API_KEY en el entorno o archivo .env."
            )
        return cls(base_url=base_url, api_key=api_key)


class BasketEvaluateRequest(BaseModel):
    """Entrada del Endpoint 1: Evaluador de Canasta (2 a 50 productos)."""

    lat: float = Field(..., ge=-90.0, le=90.0, description="Latitud del usuario")
    lon: float = Field(..., ge=-180.0, le=180.0, description="Longitud del usuario")
    radio_km: float = Field(5.0, gt=0.0, le=MAX_RADIO_KM, description="Radio máximo 8 km")
    lista_productos: list[str] = Field(
        ...,
        min_length=2,
        max_length=50,
        description="Lista de 2 a 50 nombres o términos de producto",
    )

    @field_validator("lista_productos")
    @classmethod
    def _clean_product_queries(cls, values: list[str]) -> list[str]:
        cleaned = [" ".join(item.split()) for item in values if item and item.strip()]
        if len(cleaned) < 2:
            raise ValueError("La lista debe contener al menos 2 productos válidos.")
        if len(cleaned) > 50:
            raise ValueError("La lista no puede superar los 50 productos.")
        return cleaned


class StoreQueryError(BaseModel):
    """Detalle no bloqueante cuando una tienda falla tras 3 reintentos o timeout."""

    store_id: str
    store_name: str
    query: str
    reason: str


class BasketProductStoreMatch(BaseModel):
    """Ofertas crudas encontradas en una tienda específica para un ítem buscado."""

    store_id: str
    store_name: str
    city: str
    distance_km: float
    from_cache: bool
    items: list[AraProduct]


class BasketProductResult(BaseModel):
    """Resultados consolidados de un producto de la canasta por cada tienda cercana."""

    query: str
    resultados_por_tienda: list[BasketProductStoreMatch]


class BasketEvaluateResponse(BaseModel):
    """Respuesta cruda del Evaluador de Canasta lista para algoritmos del frontend."""

    tiendas_cercanas: list[AraStore]
    resultados: list[BasketProductResult]
    errores: list[StoreQueryError] = Field(default_factory=list)
    cache_hits: int
    cache_misses: int
    elapsed_ms: float


class CategorySearchResponse(BaseModel):
    """Respuesta paginada (Lazy Loading) para Búsqueda Libre por Categoría o Query."""

    tienda_consultada: AraStore | None = None
    tiendas_disponibles: list[AraStore]
    query: str | None = None
    categoria_id: str | None = None
    total_items_pagina: int
    productos: list[AraProduct]
    next_page_token: str | None = None
    from_cache: bool = False
    aviso: str | None = None

    @model_validator(mode="after")
    def _sync_count(self) -> "CategorySearchResponse":
        self.total_items_pagina = len(self.productos)
        return self


class AraGatewayClient:
    """Cliente asíncrono resiliente con semáforo global, caché TTL y backoff exponencial."""

    def __init__(
        self,
        config: AraConfig,
        *,
        session: aiohttp.ClientSession | None = None,
        product_cache: TTLMemoryCache[CachedSearchResult] | None = None,
        stores_cache: TTLMemoryCache[list[dict[str, Any]]] | None = None,
        sleep_fn: Callable[[float], Awaitable[Any]] = asyncio.sleep,
        rng: random.Random | None = None,
    ) -> None:
        self.config = config
        self._external_session = session
        self._owned_session: aiohttp.ClientSession | None = None
        self._semaphore = asyncio.Semaphore(config.semaphore_limit)
        self._stores_lock = asyncio.Lock()
        self.product_cache = product_cache or TTLMemoryCache[CachedSearchResult](
            default_ttl_seconds=config.product_cache_ttl_seconds
        )
        self.stores_cache = stores_cache or TTLMemoryCache[list[dict[str, Any]]](
            default_ttl_seconds=config.stores_cache_ttl_seconds
        )
        self._last_known_stores: list[dict[str, Any]] = []
        self._sleep = sleep_fn
        self._rng = rng or random.Random()

    async def startup(self) -> None:
        """Inicializa sesión IPv4 y precalienta el directorio de tiendas en memoria."""
        await self._ensure_session()
        try:
            await self.get_raw_stores()
            logger.info(
                "Directorio de tiendas Ara precalentado: %d tiendas",
                len(self._last_known_stores),
            )
        except Exception as exc:
            logger.warning("No se pudo precalentar /stores al inicio: %s", exc)

    async def close(self) -> None:
        """Cierra la sesión HTTP propia si fue creada por el cliente."""
        if self._owned_session is not None and not self._owned_session.closed:
            await self._owned_session.close()
            self._owned_session = None

    async def _ensure_session(self) -> aiohttp.ClientSession:
        if self._external_session is not None:
            return self._external_session
        if self._owned_session is None or self._owned_session.closed:
            # En Windows evita bloqueos/stalls intentando IPv6 antes de IPv4
            connector = aiohttp.TCPConnector(family=socket.AF_INET, limit=25)
            headers = {
                "User-Agent": self.config.user_agent,
                "Accept": "application/json",
            }
            self._owned_session = aiohttp.ClientSession(connector=connector, headers=headers)
        return self._owned_session

    async def _fetch_json(
        self,
        path: str,
        params: dict[str, str],
        *,
        timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        """Ejecuta una petición HTTP controlada por semáforo, jitter y 3 reintentos 2**intento."""
        session = await self._ensure_session()
        url = f"{self.config.base_url}{path}"
        effective_timeout = timeout_seconds or self.config.request_timeout_seconds
        query_params = {**params, "key": self.config.api_key}
        headers = {"User-Agent": self.config.user_agent, "Accept": "application/json"}

        last_error = "Error desconocido"
        for attempt in range(self.config.max_retries + 1):
            try:
                async with self._semaphore:
                    jitter = self._rng.uniform(
                        self.config.jitter_min_seconds,
                        self.config.jitter_max_seconds,
                    )
                    if jitter > 0:
                        await self._sleep(jitter)

                    async with session.get(
                        url,
                        params=query_params,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=effective_timeout),
                    ) as response:
                        status = response.status
                        if status == 429 or status >= 500:
                            body_preview = (await response.text())[:200]
                            last_error = f"HTTP {status}: {body_preview}"
                        elif 400 <= status < 500:
                            body_preview = (await response.text())[:200]
                            raise AraBadRequestError(f"HTTP {status}: {body_preview}")
                        else:
                            payload = await response.json(content_type=None)
                            if isinstance(payload, dict):
                                return payload
                            last_error = "Respuesta JSON inesperada (no objeto)"
            except AraBadRequestError:
                raise
            except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
                last_error = f"{type(exc).__name__}: {exc or 'timeout'}"

            if attempt < self.config.max_retries:
                backoff_seconds = float(2**attempt)  # 1s, 2s, 4s
                await self._sleep(backoff_seconds)

        raise AraStoreRequestError(last_error)

    async def get_raw_stores(self) -> list[dict[str, Any]]:
        """Retorna las tiendas de Ara usando caché TTL en RAM y bloqueo single-flight."""
        cached = self.stores_cache.get("all_stores")
        if cached is not None:
            return cached

        async with self._stores_lock:
            cached = self.stores_cache.get("all_stores")
            if cached is not None:
                return cached

            try:
                payload = await self._fetch_json(
                    "/stores",
                    {},
                    timeout_seconds=self.config.stores_timeout_seconds,
                )
            except AraStoreRequestError:
                if self._last_known_stores:
                    logger.warning("Usando copia stale de tiendas tras fallo temporal de /stores")
                    return self._last_known_stores
                raise

            stores = [s for s in (payload.get("data") or []) if isinstance(s, dict)]
            self._last_known_stores = stores
            self.stores_cache.set("all_stores", stores)
            return stores

    async def get_nearby_stores(self, lat: float, lon: float, radio_km: float) -> list[AraStore]:
        """Obtiene hasta las 5 tiendas Ara activas más cercanas dentro del radio."""
        raw_stores = await self.get_raw_stores()
        return select_nearest_stores(
            raw_stores,
            lat,
            lon,
            radio_km,
            limit=MAX_NEARBY_STORES,
        )

    async def search_products_in_store(
        self,
        store_id: str,
        query: str,
        *,
        ara_page_token: str | None = None,
    ) -> tuple[CachedSearchResult, bool]:
        """Consulta `/products-search` usando caché de 15 min para la página inicial."""
        use_base_cache = ara_page_token is None
        cache_key = (
            make_search_cache_key(store_id, query)
            if use_base_cache
            else f"{make_search_cache_key(store_id, query)}__{ara_page_token}"
        )
        cached = self.product_cache.get(cache_key)
        if cached is not None:
            return cached, True

        params: dict[str, str] = {"query": query, "storeId": store_id}
        if ara_page_token:
            params["nextPageToken"] = ara_page_token

        payload = await self._fetch_json("/products-search", params)
        result = _parse_products_payload(payload, fallback_store_id=store_id)
        self.product_cache.set(cache_key, result)
        return result, False

    async def list_store_catalog_page(
        self,
        store_id: str,
        *,
        ara_page_token: str | None = None,
    ) -> tuple[CachedSearchResult, bool]:
        """Consulta `/products?storeId=...` para navegar categorías sin `query`."""
        token_part = ara_page_token or "first"
        cache_key = f"catpage_{store_id}_{token_part}"
        cached = self.product_cache.get(cache_key)
        if cached is not None:
            return cached, True

        params: dict[str, str] = {"storeId": store_id}
        if ara_page_token:
            # /products avanza con query param `startAfter` (nextPageToken solo aplica en /products-search)
            params["startAfter"] = ara_page_token

        payload = await self._fetch_json("/products", params)
        result = _parse_products_payload(payload, fallback_store_id=store_id)
        self.product_cache.set(cache_key, result)
        return result, False


def _parse_products_payload(payload: dict[str, Any], *, fallback_store_id: str) -> CachedSearchResult:
    raw_items = payload.get("data") or []
    products: list[AraProduct] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        parsed = normalize_ara_product(raw_item, fallback_store_id=fallback_store_id)
        if parsed is not None:
            products.append(parsed)

    metadata = payload.get("metadata") or {}
    next_token = metadata.get("nextPageToken") if isinstance(metadata, dict) else None
    clean_next = str(next_token).strip() if next_token else None
    return CachedSearchResult(items=products, ara_next_token=clean_next or None)


def _matches_category(product: AraProduct, categoria_id: str) -> bool:
    needle = categoria_id.strip().lower()
    if product.category_id and product.category_id.strip().lower() == needle:
        return True
    if product.category and needle in product.category.strip().lower():
        return True
    return False


async def evaluate_basket_logic(
    client: AraGatewayClient,
    request: BasketEvaluateRequest,
) -> BasketEvaluateResponse:
    """Orquesta la consulta concurrente controlada para la canasta de 2 a 50 ítems."""
    started = time.perf_counter()
    try:
        nearby_stores = await client.get_nearby_stores(request.lat, request.lon, request.radio_km)
    except AraStoreRequestError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"No fue posible consultar el directorio de tiendas Ara: {exc}",
        ) from exc

    if not nearby_stores:
        elapsed = (time.perf_counter() - started) * 1000.0
        return BasketEvaluateResponse(
            tiendas_cercanas=[],
            resultados=[],
            errores=[],
            cache_hits=0,
            cache_misses=0,
            elapsed_ms=round(elapsed, 2),
        )

    # Deduplica términos idénticos preservando orden de llegada para evitar tráfico redundante
    unique_queries: list[str] = []
    seen_norm: set[str] = set()
    for raw_q in request.lista_productos:
        norm = " ".join(raw_q.lower().split())
        if norm not in seen_norm:
            seen_norm.add(norm)
            unique_queries.append(raw_q)

    cache_hits = 0
    cache_misses = 0
    errors: list[StoreQueryError] = []
    matches_by_pair: dict[tuple[str, str], BasketProductStoreMatch] = {}

    async def _query_pair(store: AraStore, query: str) -> None:
        nonlocal cache_hits, cache_misses
        try:
            search_res, from_cache = await client.search_products_in_store(store.store_id, query)
        except (AraStoreRequestError, AraBadRequestError) as exc:
            cache_misses += 1
            errors.append(
                StoreQueryError(
                    store_id=store.store_id,
                    store_name=store.name,
                    query=query,
                    reason=str(exc),
                )
            )
            return

        if from_cache:
            cache_hits += 1
        else:
            cache_misses += 1

        matches_by_pair[(query, store.store_id)] = BasketProductStoreMatch(
            store_id=store.store_id,
            store_name=store.name,
            city=store.city,
            distance_km=store.distance_km,
            from_cache=from_cache,
            items=search_res.items,
        )

    tasks = [_query_pair(store, query) for query in unique_queries for store in nearby_stores]
    await asyncio.gather(*tasks)

    resultados: list[BasketProductResult] = []
    for query in unique_queries:
        store_matches = [
            matches_by_pair[(query, store.store_id)]
            for store in nearby_stores
            if (query, store.store_id) in matches_by_pair
        ]
        resultados.append(
            BasketProductResult(
                query=query,
                resultados_por_tienda=store_matches,
            )
        )

    elapsed = (time.perf_counter() - started) * 1000.0
    return BasketEvaluateResponse(
        tiendas_cercanas=nearby_stores,
        resultados=resultados,
        errores=errors,
        cache_hits=cache_hits,
        cache_misses=cache_misses,
        elapsed_ms=round(elapsed, 2),
    )


async def lazy_category_search_logic(
    client: AraGatewayClient,
    *,
    lat: float,
    lon: float,
    radio_km: float,
    categoria_id: str | None,
    query: str | None,
    page_token: str | None,
) -> CategorySearchResponse:
    """Ejecuta búsqueda paginada tienda-por-tienda (Lazy Loading) empezando por la más cercana."""
    clean_query = " ".join(query.split()) if query and query.strip() else None
    clean_category = categoria_id.strip() if categoria_id and categoria_id.strip() else None
    if not clean_query and not clean_category:
        raise HTTPException(
            status_code=422,
            detail="Debes enviar al menos `query` o `categoria_id`.",
        )

    try:
        nearby_stores = await client.get_nearby_stores(lat, lon, radio_km)
    except AraStoreRequestError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"No fue posible consultar tiendas Ara cercanas: {exc}",
        ) from exc

    if not nearby_stores:
        return CategorySearchResponse(
            tienda_consultada=None,
            tiendas_disponibles=[],
            query=clean_query,
            categoria_id=clean_category,
            total_items_pagina=0,
            productos=[],
            next_page_token=None,
            aviso="No se encontraron tiendas Ara dentro del radio solicitado.",
        )

    store_idx = 0
    ara_token: str | None = None
    if page_token:
        try:
            store_idx, ara_token = decode_page_token(page_token)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if store_idx >= len(nearby_stores):
            raise HTTPException(
                status_code=400,
                detail="El `page_token` referencia una tienda fuera del listado actual.",
            )

    target_store = nearby_stores[store_idx]
    collected: list[AraProduct] = []
    any_cache_hit = False
    current_ara_token = ara_token
    next_ara_token: str | None = None
    error_notice: str | None = None

    try:
        if clean_query:
            result, from_cache = await client.search_products_in_store(
                target_store.store_id,
                clean_query,
                ara_page_token=current_ara_token,
            )
            any_cache_hit = from_cache
            items = (
                [p for p in result.items if _matches_category(p, clean_category)]
                if clean_category
                else result.items
            )
            collected.extend(items[:PAGE_SIZE])
            next_ara_token = result.ara_next_token
        else:
            # Sonda en vivo mostró que `/products-search?categoryId=...` sin `query` responde HTTP 400;
            # por ello se pagina `/products?storeId=...` y se filtra por `categoryId` sin descartar ítems.
            assert clean_category is not None
            for _ in range(MAX_CATEGORY_SCAN_PAGES):
                result, from_cache = await client.list_store_catalog_page(
                    target_store.store_id,
                    ara_page_token=current_ara_token,
                )
                any_cache_hit = any_cache_hit or from_cache
                matched = [p for p in result.items if _matches_category(p, clean_category)]
                next_ara_token = result.ara_next_token
                if matched:
                    collected.extend(matched[:PAGE_SIZE])
                    break
                if not next_ara_token:
                    break
                current_ara_token = next_ara_token
    except (AraStoreRequestError, AraBadRequestError) as exc:
        error_notice = f"Tienda {target_store.store_id} omitida por error de red/API: {exc}"
        next_ara_token = None

    next_cursor: str | None = None
    if next_ara_token:
        next_cursor = encode_page_token(store_idx, next_ara_token)
    elif store_idx + 1 < len(nearby_stores):
        next_cursor = encode_page_token(store_idx + 1, None)

    return CategorySearchResponse(
        tienda_consultada=target_store,
        tiendas_disponibles=nearby_stores,
        query=clean_query,
        categoria_id=clean_category,
        total_items_pagina=len(collected),
        productos=collected,
        next_page_token=next_cursor,
        from_cache=any_cache_hit,
        aviso=error_notice,
    )


def create_app(
    *,
    config: AraConfig | None = None,
    client: AraGatewayClient | None = None,
) -> FastAPI:
    """Construye la aplicación FastAPI inyectando configuración o cliente para pruebas."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        active_client = client
        if active_client is None:
            resolved_config = config or AraConfig.from_env()
            active_client = AraGatewayClient(resolved_config)
        app.state.ara_client = active_client
        await active_client.startup()
        try:
            yield
        finally:
            await active_client.close()

    application = FastAPI(
        title="Comparador de Precios · Backend On-Demand Ara",
        version="1.0.0",
        description=(
            "API en tiempo real para evaluación concurrente de canastas y búsqueda paginada "
            "por tiendas cercanas de Ara con caché TTL de 15 minutos."
        ),
        lifespan=lifespan,
    )

    @application.get("/health")
    async def healthcheck() -> dict[str, Any]:
        ara_client: AraGatewayClient = application.state.ara_client
        return {
            "status": "ok",
            "stores_cached": len(ara_client._last_known_stores),
            "product_cache_entries": len(ara_client.product_cache),
        }

    @application.post("/evaluar-canasta", response_model=BasketEvaluateResponse)
    async def evaluar_canasta(payload: BasketEvaluateRequest) -> BasketEvaluateResponse:
        ara_client: AraGatewayClient = application.state.ara_client
        return await evaluate_basket_logic(ara_client, payload)

    @application.get("/buscar", response_model=CategorySearchResponse)
    async def buscar_categoria(
        lat: float = Query(..., ge=-90.0, le=90.0),
        lon: float = Query(..., ge=-180.0, le=180.0),
        radio_km: float = Query(5.0, gt=0.0, le=MAX_RADIO_KM),
        categoria_id: str | None = Query(default=None),
        query: str | None = Query(default=None),
        page_token: str | None = Query(default=None),
    ) -> CategorySearchResponse:
        ara_client: AraGatewayClient = application.state.ara_client
        return await lazy_category_search_logic(
            ara_client,
            lat=lat,
            lon=lon,
            radio_km=radio_km,
            categoria_id=categoria_id,
            query=query,
            page_token=page_token,
        )

    return application


app = create_app()
