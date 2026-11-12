"""Clase base abstracta para extractores asíncronos con control de tasa y reintentos."""

from __future__ import annotations

import asyncio
import logging
import random
import time
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from email.utils import parsedate_to_datetime
from typing import Any

import httpx
from pydantic import ValidationError

from etl.core.models import ScrapedProduct, ScraperConfig

logger = logging.getLogger(__name__)

DEFAULT_USER_AGENTS: tuple[str, ...] = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:133.0) Gecko/20100101 Firefox/133.0",
)

RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({429, 500, 502, 503, 504})
SUCCESS_STATUS_CODES: frozenset[int] = frozenset({200, 206})


class ScraperError(RuntimeError):
    """Error base del subsistema de extracción."""


class ScraperHTTPError(ScraperError):
    """Error HTTP tras agotar reintentos o recibir código 4xx no recuperable."""

    def __init__(self, status_code: int, url: str, message: str = "") -> None:
        self.status_code = status_code
        self.url = url
        detail = f"HTTP {status_code} en {url}" + (f": {message}" if message else "")
        super().__init__(detail)


class AsyncRateLimiter:
    """Limitador de tasa asíncrono por ranuras temporales para múltiples corrutinas."""

    def __init__(self, requests_per_second: float) -> None:
        if requests_per_second <= 0:
            raise ValueError("requests_per_second debe ser mayor a 0")
        self._min_interval = 1.0 / requests_per_second
        self._lock = asyncio.Lock()
        self._next_slot = 0.0

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            scheduled = max(now, self._next_slot)
            self._next_slot = scheduled + self._min_interval
            wait_seconds = scheduled - now
        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)


class BaseScraper(ABC):
    """Conector abstracto basado en `httpx.AsyncClient` con validación Pydantic v2."""

    def __init__(
        self,
        config: ScraperConfig,
        *,
        client: httpx.AsyncClient | None = None,
        user_agents: tuple[str, ...] = DEFAULT_USER_AGENTS,
    ) -> None:
        self.config = config
        self._external_client = client is not None
        self._client = client
        self._user_agents = user_agents or DEFAULT_USER_AGENTS
        self._rate_limiter = AsyncRateLimiter(config.requests_per_second)
        self._semaphore = asyncio.Semaphore(config.max_concurrency)

    async def __aenter__(self) -> BaseScraper:
        if self._client is None:
            self._client = self._build_client()
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.aclose()

    def _build_client(self) -> httpx.AsyncClient:
        timeout = httpx.Timeout(self.config.timeout_seconds, connect=10.0)
        limits = httpx.Limits(
            max_connections=max(self.config.max_concurrency * 2, 5),
            max_keepalive_connections=self.config.max_concurrency,
        )
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
            **self.config.default_headers,
        }
        return httpx.AsyncClient(
            base_url=self.config.base_url.rstrip("/"),
            timeout=timeout,
            limits=limits,
            headers=headers,
            follow_redirects=True,
        )

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = self._build_client()
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and not self._external_client:
            await self._client.aclose()
            self._client = None

    def _pick_user_agent(self) -> str:
        if self.config.rotate_user_agent:
            return random.choice(self._user_agents)
        return self._user_agents[0]

    def _compute_retry_delay(self, attempt: int, response: httpx.Response | None = None) -> float:
        if response is not None:
            retry_after = response.headers.get("Retry-After")
            if retry_after:
                delay = self._parse_retry_after(retry_after)
                if delay is not None:
                    return min(delay, self.config.backoff_max_seconds)
        exponential = self.config.backoff_base_seconds * (2**attempt)
        jitter = random.uniform(0.0, min(0.5, self.config.backoff_base_seconds * 0.5))
        return min(exponential + jitter, self.config.backoff_max_seconds)

    @staticmethod
    def _parse_retry_after(value: str) -> float | None:
        value = value.strip()
        if value.isdigit():
            return max(0.0, float(value))
        try:
            dt = parsedate_to_datetime(value)
            return max(0.0, dt.timestamp() - time.time())
        except (TypeError, ValueError):
            return None

    async def request(
        self,
        method: str,
        path_or_url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        json_body: Any = None,
        accepted_statuses: frozenset[int] = SUCCESS_STATUS_CODES,
    ) -> httpx.Response:
        """Ejecuta una petición HTTP controlada por rate limit, semáforo y backoff exponencial."""
        last_exc: Exception | None = None
        last_response: httpx.Response | None = None

        for attempt in range(self.config.max_retries + 1):
            req_headers = {
                **self.config.default_headers,
                "User-Agent": self._pick_user_agent(),
            }
            if headers:
                req_headers.update(headers)

            async with self._semaphore:
                await self._rate_limiter.acquire()
                try:
                    response = await self.client.request(
                        method=method.upper(),
                        url=path_or_url,
                        params=params,
                        headers=req_headers,
                        json=json_body,
                    )
                except (httpx.TimeoutException, httpx.TransportError) as exc:
                    last_exc = exc
                    if attempt >= self.config.max_retries:
                        break
                    delay = self._compute_retry_delay(attempt)
                    logger.warning(
                        "[%s] Error de red (%s) en %s; reintento %d/%d en %.2fs",
                        self.config.store_id,
                        type(exc).__name__,
                        path_or_url,
                        attempt + 1,
                        self.config.max_retries,
                        delay,
                    )
                    await asyncio.sleep(delay)
                    continue

            if response.status_code in accepted_statuses:
                return response

            last_response = response
            if response.status_code in RETRYABLE_STATUS_CODES and attempt < self.config.max_retries:
                delay = self._compute_retry_delay(attempt, response)
                logger.warning(
                    "[%s] HTTP %d en %s; reintento %d/%d en %.2fs",
                    self.config.store_id,
                    response.status_code,
                    response.url,
                    attempt + 1,
                    self.config.max_retries,
                    delay,
                )
                await asyncio.sleep(delay)
                continue

            raise ScraperHTTPError(
                response.status_code,
                str(response.url),
                response.text[:200],
            )

        if last_response is not None:
            raise ScraperHTTPError(
                last_response.status_code,
                str(last_response.url),
                "Se agotaron los reintentos",
            )
        raise ScraperError(
            f"[{self.config.store_id}] Falló {method} {path_or_url} tras "
            f"{self.config.max_retries + 1} intentos: {last_exc}"
        ) from last_exc

    async def get_json(
        self,
        path_or_url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        """Realiza GET y decodifica JSON validando respuesta aceptable."""
        response = await self.request("GET", path_or_url, params=params, headers=headers)
        return response.json()

    @staticmethod
    def validate_product(payload: dict[str, Any]) -> ScrapedProduct | None:
        """Valida un diccionario de producto contra Pydantic v2 sin abortar el lote completo."""
        try:
            return ScrapedProduct.model_validate(payload)
        except ValidationError as exc:
            logger.debug("Producto descartado por validación Pydantic: %s", exc)
            return None

    @abstractmethod
    def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        """Genera lotes asíncronos de productos extraídos y validados."""

    async def scrape_all(self) -> list[ScrapedProduct]:
        """Materializa todos los lotes emitidos por `iter_batches()` en una sola lista."""
        items: list[ScrapedProduct] = []
        async for batch in self.iter_batches():
            items.extend(batch)
        return items
