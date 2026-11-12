"""Gestión de Change Data Capture (CDC) en memoria contra Supabase (`v_latest_prices`)."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Iterable
from decimal import Decimal
from typing import Any, Protocol, TypeVar
from uuid import uuid4

import httpx

from etl.core.entity_resolver import EntityResolver, ResolutionGateway
from etl.core.models import CDCStats, CachedPriceState, ScrapedProduct

logger = logging.getLogger(__name__)

POSTGREST_PAGE_SIZE = 1000
WRITE_CHUNK_SIZE = 500
MAX_REQUESTS_PER_CLIENT = 4000
_MAX_DB_PRICE = Decimal("999999999999.99")
_MAX_DB_PUM = Decimal("9999999999.9999")
_T = TypeVar("_T")


def _chunked(items: list[Any], size: int) -> Iterable[list[Any]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


class DatabaseGateway(ResolutionGateway, Protocol):
    """Abstracción de acceso asíncrono a Supabase/PostgreSQL para CDC y homologación."""

    async def fetch_latest_prices(self, store_id: str) -> list[dict[str, Any]]: ...

    async def fetch_store_skus(self, store_id: str) -> list[dict[str, Any]]: ...

    async def upsert_store_skus(self, rows: list[dict[str, Any]]) -> dict[str, str]: ...

    async def insert_price_records(self, rows: list[dict[str, Any]]) -> int: ...

    async def touch_store_skus_verified(self, store_sku_ids: list[str]) -> int: ...

    async def aclose(self) -> None: ...


class SupabaseGateway:
    """Adaptador oficial basado en `supabase.AsyncClient` con paginación PostgREST y reconexión HTTP/2."""

    def __init__(
        self,
        client: Any,
        *,
        client_factory: Callable[[], Awaitable[Any]] | None = None,
        max_requests_before_recycle: int = MAX_REQUESTS_PER_CLIENT,
        max_retries: int = 4,
    ) -> None:
        self._client = client
        self._client_factory = client_factory
        self._max_requests_before_recycle = max_requests_before_recycle
        self._max_retries = max_retries
        self._request_count = 0

    @classmethod
    async def from_credentials(cls, supabase_url: str, supabase_key: str) -> SupabaseGateway:
        from supabase import acreate_client

        async def factory() -> Any:
            return await acreate_client(supabase_url, supabase_key)

        client = await factory()
        return cls(client, client_factory=factory)

    async def aclose(self) -> None:
        postgrest = getattr(self._client, "postgrest", None)
        session = getattr(postgrest, "session", None)
        if session is not None and hasattr(session, "aclose"):
            await session.aclose()

    async def _reset_client(self) -> None:
        """Cierra la sesión PostgREST actual y abre un cliente nuevo (reinicia streams HTTP/2)."""
        if self._client_factory is None:
            return
        await self.aclose()
        self._client = await self._client_factory()
        self._request_count = 0

    async def _execute(self, operation: Callable[[Any], Awaitable[_T]]) -> _T:
        """Ejecuta una llamada PostgREST con reciclado preventivo de sesión y reintentos de red."""
        for attempt in range(self._max_retries + 1):
            if (
                self._client_factory is not None
                and self._max_requests_before_recycle > 0
                and self._request_count >= self._max_requests_before_recycle
            ):
                logger.info(
                    "Reciclando sesión PostgREST tras %d peticiones para evitar límite HTTP/2.",
                    self._request_count,
                )
                await self._reset_client()

            self._request_count += 1
            try:
                return await operation(self._client)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt >= self._max_retries:
                    raise
                if isinstance(exc, httpx.RemoteProtocolError):
                    await self._reset_client()
                delay = 0.5 * (2**attempt)
                logger.warning(
                    "Error de transporte PostgREST (%s); reintento %d/%d en %.2fs",
                    type(exc).__name__,
                    attempt + 1,
                    self._max_retries,
                    delay,
                )
                await asyncio.sleep(delay)

        raise RuntimeError("Reintentos PostgREST agotados inesperadamente.")

    async def _fetch_all_pages(
        self,
        table_or_view: str,
        columns: str,
        *,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            def _run(client: Any) -> Awaitable[Any]:
                query = client.table(table_or_view).select(columns)
                if filters:
                    for col, val in filters.items():
                        query = query.eq(col, val)
                return query.range(offset, offset + POSTGREST_PAGE_SIZE - 1).execute()

            response = await self._execute(_run)
            batch = response.data or []
            rows.extend(batch)
            if len(batch) < POSTGREST_PAGE_SIZE:
                break
            offset += POSTGREST_PAGE_SIZE
        return rows

    async def fetch_latest_prices(self, store_id: str) -> list[dict[str, Any]]:
        return await self._fetch_all_pages(
            "v_latest_prices",
            "store_sku_id,master_product_id,raw_sale_price,calibrated_price,in_stock",
            filters={"store_id": store_id},
        )

    async def fetch_store_skus(self, store_id: str) -> list[dict[str, Any]]:
        return await self._fetch_all_pages(
            "store_skus",
            "id,external_sku,master_product_id",
            filters={"store_id": store_id},
        )

    async def fetch_canonical_categories(self) -> dict[str, int]:
        rows = await self._fetch_all_pages("canonical_categories", "id,slug")
        return {row["slug"]: int(row["id"]) for row in rows if row.get("slug")}

    async def fetch_master_products_by_eans(self, eans: list[str]) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for chunk in _chunked(eans, 200):
            response = await self._execute(
                lambda client, c=chunk: (
                    client.table("master_products")
                    .select("id,ean")
                    .in_("ean", c)
                    .execute()
                )
            )
            for row in response.data or []:
                if row.get("ean") and row.get("id"):
                    mapping[row["ean"]] = str(row["id"])
        return mapping

    async def match_master_product_trgm(
        self,
        normalized_name: str,
        net_content: Decimal,
        unit_measure: str,
        threshold: float = 0.65,
    ) -> str | None:
        response = await self._execute(
            lambda client: client.rpc(
                "match_master_product_trgm",
                {
                    "p_target_name": normalized_name,
                    "p_net_content": str(net_content),
                    "p_unit_measure": unit_measure,
                    "p_threshold": threshold,
                },
            ).execute()
        )
        data = response.data or []
        if data:
            return str(data[0]["id"])
        return None

    async def create_master_product(self, payload: dict[str, Any]) -> str:
        ean = payload.get("ean")
        if ean:
            # Concurrencia segura cuando dos trabajos de la matriz descubren el mismo EAN a la vez
            response = await self._execute(
                lambda client: (
                    client.table("master_products")
                    .upsert(payload, on_conflict="ean", ignore_duplicates=True)
                    .execute()
                )
            )
            if response.data:
                return str(response.data[0]["id"])
            existing = await self.fetch_master_products_by_eans([ean])
            if ean in existing:
                return existing[ean]

        response = await self._execute(
            lambda client: client.table("master_products").insert(payload).execute()
        )
        return str(response.data[0]["id"])

    async def upsert_store_skus(self, rows: list[dict[str, Any]]) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for chunk in _chunked(rows, WRITE_CHUNK_SIZE):
            response = await self._execute(
                lambda client, c=chunk: (
                    client.table("store_skus")
                    .upsert(c, on_conflict="store_id,external_sku")
                    .execute()
                )
            )
            for row in response.data or []:
                mapping[row["external_sku"]] = str(row["id"])
        return mapping

    async def insert_price_records(self, rows: list[dict[str, Any]]) -> int:
        inserted = 0
        for chunk in _chunked(rows, WRITE_CHUNK_SIZE):
            response = await self._execute(
                lambda client, c=chunk: client.table("price_records").insert(c).execute()
            )
            inserted += len(response.data or chunk)
        return inserted

    async def touch_store_skus_verified(self, store_sku_ids: list[str]) -> int:
        updated = 0
        for chunk in _chunked(store_sku_ids, WRITE_CHUNK_SIZE):
            response = await self._execute(
                lambda client, c=chunk: client.rpc(
                    "touch_store_skus_verified",
                    {"p_sku_ids": c},
                ).execute()
            )
            if isinstance(response.data, int):
                updated += response.data
            else:
                updated += len(chunk)
        return updated


class InMemoryGateway:
    """Gateway en memoria para pruebas unitarias y simulaciones dry-run sin BD externa."""

    def __init__(self) -> None:
        self.canonical_categories: dict[str, int] = {}
        self.master_products: dict[str, dict[str, Any]] = {}
        self.eans_index: dict[str, str] = {}
        self.store_skus: dict[tuple[str, str], dict[str, Any]] = {}
        self.price_records: list[dict[str, Any]] = []
        self.verified_touches: list[str] = []
        self._next_record_id = 1

    async def aclose(self) -> None:
        return None

    async def fetch_latest_prices(self, store_id: str) -> list[dict[str, Any]]:
        latest: dict[str, dict[str, Any]] = {}
        sku_by_id = {
            row["id"]: row
            for (sid, _), row in self.store_skus.items()
            if sid == store_id
        }
        for rec in self.price_records:
            sku_id = rec["store_sku_id"]
            if sku_id in sku_by_id:
                sku_row = sku_by_id[sku_id]
                latest[sku_id] = {
                    "store_sku_id": sku_id,
                    "master_product_id": sku_row["master_product_id"],
                    "raw_sale_price": rec["raw_sale_price"],
                    "calibrated_price": rec["calibrated_price"],
                    "in_stock": rec["in_stock"],
                }
        return list(latest.values())

    async def fetch_store_skus(self, store_id: str) -> list[dict[str, Any]]:
        return [
            {
                "id": row["id"],
                "external_sku": row["external_sku"],
                "master_product_id": row["master_product_id"],
            }
            for (sid, _), row in self.store_skus.items()
            if sid == store_id
        ]

    async def fetch_canonical_categories(self) -> dict[str, int]:
        return dict(self.canonical_categories)

    async def fetch_master_products_by_eans(self, eans: list[str]) -> dict[str, str]:
        return {ean: self.eans_index[ean] for ean in eans if ean in self.eans_index}

    @staticmethod
    def _trigram_similarity(a: str, b: str) -> float:
        def trigrams(text: str) -> set[str]:
            padded = f"  {text.lower()} "
            return {padded[i : i + 3] for i in range(max(len(padded) - 2, 0))}

        ta, tb = trigrams(a), trigrams(b)
        if not ta and not tb:
            return 1.0
        if not ta or not tb:
            return 0.0
        return len(ta & tb) / len(ta | tb)

    async def match_master_product_trgm(
        self,
        normalized_name: str,
        net_content: Decimal,
        unit_measure: str,
        threshold: float = 0.65,
    ) -> str | None:
        best_id: str | None = None
        best_score = 0.0
        for mp_id, mp in self.master_products.items():
            if Decimal(str(mp["net_content"])) != net_content:
                continue
            if mp["unit_measure"] != unit_measure:
                continue
            score = self._trigram_similarity(mp["normalized_name"], normalized_name)
            if score >= threshold and score > best_score:
                best_score = score
                best_id = mp_id
        return best_id

    async def create_master_product(self, payload: dict[str, Any]) -> str:
        ean = payload.get("ean")
        if ean and ean in self.eans_index:
            return self.eans_index[ean]
        mp_id = str(uuid4())
        self.master_products[mp_id] = {"id": mp_id, **payload}
        if ean:
            self.eans_index[ean] = mp_id
        return mp_id

    async def upsert_store_skus(self, rows: list[dict[str, Any]]) -> dict[str, str]:
        result: dict[str, str] = {}
        for row in rows:
            key = (row["store_id"], row["external_sku"])
            if key in self.store_skus:
                existing = self.store_skus[key]
                existing.update(row)
                result[row["external_sku"]] = existing["id"]
            else:
                sku_id = str(uuid4())
                self.store_skus[key] = {"id": sku_id, **row}
                result[row["external_sku"]] = sku_id
        return result

    async def insert_price_records(self, rows: list[dict[str, Any]]) -> int:
        for row in rows:
            self.price_records.append({"id": self._next_record_id, **row})
            self._next_record_id += 1
        return len(rows)

    async def touch_store_skus_verified(self, store_sku_ids: list[str]) -> int:
        self.verified_touches.extend(store_sku_ids)
        return len(store_sku_ids)


class CDCManager:
    """Ejecuta Change Data Capture en memoria para evitar snapshots duplicados."""

    def __init__(
        self,
        gateway: DatabaseGateway,
        store_id: str,
        *,
        resolver: EntityResolver | None = None,
    ) -> None:
        self._gateway = gateway
        self.store_id = store_id
        self._resolver = resolver or EntityResolver(gateway)
        self._price_cache: dict[str, CachedPriceState] = {}
        self._sku_id_by_external: dict[str, str] = {}
        self.stats = CDCStats(store_id=store_id)
        self._initialized = False

    @property
    def price_cache(self) -> dict[str, CachedPriceState]:
        """Diccionario `{store_sku_id: CachedPriceState}` cargado desde `v_latest_prices`."""
        return self._price_cache

    async def initialize(self) -> None:
        """Precarga en memoria `v_latest_prices` y el índice de `store_skus` de la cadena."""
        await self._resolver.warm_up()

        sku_rows = await self._gateway.fetch_store_skus(self.store_id)
        self._sku_id_by_external = {
            row["external_sku"]: str(row["id"]) for row in sku_rows
        }

        latest_rows = await self._gateway.fetch_latest_prices(self.store_id)
        self._price_cache = {}
        for row in latest_rows:
            sku_id = str(row["store_sku_id"])
            self._price_cache[sku_id] = CachedPriceState(
                store_sku_id=sku_id,
                master_product_id=(
                    str(row["master_product_id"]) if row.get("master_product_id") else None
                ),
                raw_sale_price=Decimal(str(row["raw_sale_price"])).quantize(Decimal("0.01")),
                calibrated_price=Decimal(str(row["calibrated_price"])).quantize(Decimal("0.01")),
                in_stock=bool(row["in_stock"]),
            )

        self._initialized = True
        logger.info(
            "[%s] CDC inicializado: %d SKUs conocidos, %d precios en caché (v_latest_prices)",
            self.store_id,
            len(self._sku_id_by_external),
            len(self._price_cache),
        )

    async def process_batch(self, products: list[ScrapedProduct]) -> CDCStats:
        """Procesa un lote: homologa SKUs nuevos, inserta sólo cambios y actualiza `last_verified_at`."""
        if not self._initialized:
            await self.initialize()

        if not products:
            return self.stats

        # Deduplicación intralote por external_sku conservando la lectura más reciente
        deduped: dict[str, ScrapedProduct] = {p.external_sku: p for p in products}
        batch_items = list(deduped.values())

        new_products = [
            p for p in batch_items if p.external_sku not in self._sku_id_by_external
        ]
        resolutions = {}
        if new_products:
            resolutions = await self._resolver.resolve_batch(new_products, stats=self.stats)
            sku_payloads = [
                {
                    "store_id": self.store_id,
                    "master_product_id": resolutions[p.external_sku].master_product_id,
                    "external_sku": p.external_sku,
                    "raw_name": p.raw_name,
                    "raw_url": p.raw_url,
                }
                for p in new_products
            ]
            created_map = await self._gateway.upsert_store_skus(sku_payloads)
            self._sku_id_by_external.update(created_map)

        price_inserts: list[dict[str, Any]] = []
        unchanged_sku_ids: list[str] = []
        changed_sku_ids: list[str] = []

        for product in batch_items:
            self.stats.total_processed += 1
            store_sku_id = self._sku_id_by_external[product.external_sku]
            cached = self._price_cache.get(store_sku_id)

            if (
                cached is not None
                and cached.raw_sale_price == product.raw_sale_price
                and cached.in_stock == product.in_stock
            ):
                self.stats.unchanged_skipped += 1
                unchanged_sku_ids.append(store_sku_id)
                continue

            if (
                product.raw_list_price > _MAX_DB_PRICE
                or product.raw_sale_price > _MAX_DB_PRICE
                or product.calibrated_price > _MAX_DB_PRICE
                or product.pum_price > _MAX_DB_PUM
            ):
                logger.warning(
                    "[%s] SKU %s omitido por valor fuera de rango NUMERIC(14,4): precio=%s, pum=%s",
                    self.store_id,
                    product.external_sku,
                    product.raw_sale_price,
                    product.pum_price,
                )
                continue

            if cached is None:
                self.stats.new_skus += 1
            else:
                self.stats.price_or_stock_changes += 1

            price_inserts.append(
                {
                    "store_sku_id": store_sku_id,
                    "raw_list_price": str(product.raw_list_price),
                    "raw_sale_price": str(product.raw_sale_price),
                    "calibrated_price": str(product.calibrated_price),
                    "pum_price": str(product.pum_price),
                    "in_stock": product.in_stock,
                    "source_origin": product.source_origin,
                }
            )
            changed_sku_ids.append(store_sku_id)
            resolved_master_id = (
                resolutions[product.external_sku].master_product_id
                if product.external_sku in resolutions
                else (cached.master_product_id if cached else None)
            )
            self._price_cache[store_sku_id] = CachedPriceState(
                store_sku_id=store_sku_id,
                master_product_id=resolved_master_id,
                raw_sale_price=product.raw_sale_price,
                calibrated_price=product.calibrated_price,
                in_stock=product.in_stock,
            )

        if price_inserts:
            await self._gateway.insert_price_records(price_inserts)

        skus_to_touch = unchanged_sku_ids + changed_sku_ids
        if skus_to_touch:
            self.stats.verified_touched += await self._gateway.touch_store_skus_verified(
                skus_to_touch
            )

        return self.stats
