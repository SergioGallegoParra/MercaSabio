"""Pruebas del cliente base HTTP asíncrono (reintentos, 429, 206, rate limiting)."""

from __future__ import annotations

import asyncio
import time
import unittest
from collections.abc import AsyncIterator

import httpx

from etl.core.base_scraper import BaseScraper, ScraperHTTPError
from etl.core.models import ScrapedProduct, ScraperConfig


class _DummyScraper(BaseScraper):
    async def iter_batches(self) -> AsyncIterator[list[ScrapedProduct]]:
        if False:
            yield []


class BaseScraperTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_on_429_and_503_then_succeeds(self) -> None:
        attempts = 0
        seen_user_agents: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            seen_user_agents.append(request.headers.get("User-Agent", ""))
            if attempts == 1:
                return httpx.Response(429, headers={"Retry-After": "0"})
            if attempts == 2:
                return httpx.Response(503)
            return httpx.Response(206, json=[{"ok": True}])

        transport = httpx.MockTransport(handler)
        config = ScraperConfig(
            store_id="exito",
            base_url="https://www.exito.com",
            channel_type="vtex_io",
            source_origin="vtex_api",
            requests_per_second=50.0,
            max_retries=3,
            backoff_base_seconds=0.01,
            backoff_max_seconds=0.05,
        )
        async with httpx.AsyncClient(base_url=config.base_url, transport=transport) as client:
            scraper = _DummyScraper(config, client=client)
            data = await scraper.get_json("/api/test")

        self.assertEqual(attempts, 3)
        self.assertEqual(data, [{"ok": True}])
        self.assertTrue(all(ua.startswith("Mozilla/5.0") for ua in seen_user_agents))

    async def test_non_retryable_404_raises_immediately(self) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            return httpx.Response(404, text="Not Found")

        config = ScraperConfig(
            store_id="exito",
            base_url="https://www.exito.com",
            channel_type="vtex_io",
            source_origin="vtex_api",
            requests_per_second=50.0,
            max_retries=3,
            backoff_base_seconds=0.01,
        )
        async with httpx.AsyncClient(
            base_url=config.base_url,
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = _DummyScraper(config, client=client)
            with self.assertRaises(ScraperHTTPError) as ctx:
                await scraper.get_json("/api/missing")

        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(attempts, 1)

    async def test_rate_limiter_spaces_concurrent_requests(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"ok": True})

        config = ScraperConfig(
            store_id="alkosto",
            base_url="https://www.alkosto.com",
            channel_type="sap_hybris",
            source_origin="hybris_api",
            requests_per_second=20.0,  # 50ms entre peticiones
            max_concurrency=3,
            max_retries=0,
        )
        async with httpx.AsyncClient(
            base_url=config.base_url,
            transport=httpx.MockTransport(handler),
        ) as client:
            scraper = _DummyScraper(config, client=client)
            start = time.monotonic()
            await asyncio.gather(*(scraper.get_json("/item") for _ in range(4)))
            elapsed = time.monotonic() - start

        # 4 peticiones a 20 req/s => ranuras en 0, 50ms, 100ms, 150ms (~>= 0.12s considerando reloj)
        self.assertGreaterEqual(elapsed, 0.12)

    async def test_resets_internal_client_on_remote_protocol_error(self) -> None:
        attempts = 0
        built_clients = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise httpx.RemoteProtocolError("GOAWAY stream terminated", request=request)
            return httpx.Response(200, json={"recovered": True})

        class _ResettableDummyScraper(_DummyScraper):
            def _build_client(self) -> httpx.AsyncClient:
                nonlocal built_clients
                built_clients += 1
                return httpx.AsyncClient(
                    base_url=self.config.base_url,
                    transport=httpx.MockTransport(handler),
                )

        config = ScraperConfig(
            store_id="carulla",
            base_url="https://www.carulla.com",
            channel_type="vtex_io",
            source_origin="vtex_api",
            requests_per_second=50.0,
            max_retries=2,
            backoff_base_seconds=0.01,
        )
        async with _ResettableDummyScraper(config) as scraper:
            data = await scraper.get_json("/api/test")

        self.assertEqual(data, {"recovered": True})
        self.assertEqual(attempts, 2)
        self.assertEqual(built_clients, 2)


if __name__ == "__main__":
    unittest.main()
