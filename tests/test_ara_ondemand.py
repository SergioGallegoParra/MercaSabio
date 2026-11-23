"""Pruebas unitarias e integración simulada para `etl.ara_ondemand`."""

from __future__ import annotations

import asyncio
import random
import unittest
from dataclasses import dataclass
from typing import Any

from fastapi.testclient import TestClient

from etl.ara_ondemand.main import (
    AraBadRequestError,
    AraConfig,
    AraGatewayClient,
    AraStoreRequestError,
    create_app,
)
from etl.ara_ondemand.utils import (
    CachedSearchResult,
    TTLMemoryCache,
    decode_page_token,
    encode_page_token,
    haversine_km,
    is_wholesale_x25,
    make_search_cache_key,
    normalize_ara_product,
    select_nearest_stores,
)


def _sample_raw_stores() -> list[dict[str, Any]]:
    # Coordenadas alrededor de Manizales (centro ~ 5.06889, -75.51738)
    return [
        {
            "ID": "1",
            "id": "0001",
            "name": "Ara Centro",
            "city": "Manizales",
            "department": "Caldas",
            "address": "Cra 22 # 20-10",
            "latitude": "5.06890",
            "longitude": "-75.51740",
            "status": "1",
            "region": "CAFETERO",
        },
        {
            "ID": "2",
            "id": "0002",
            "name": "Ara Chipre",
            "city": "Manizales",
            "department": "Caldas",
            "address": "Av 12 de Octubre",
            "latitude": "5.07500",
            "longitude": "-75.52400",
            "status": "1",
            "region": "CAFETERO",
        },
        {
            "ID": "3",
            "id": "0003",
            "name": "Ara Cable",
            "city": "Manizales",
            "department": "Caldas",
            "address": "Cra 23 # 65-10",
            "latitude": "5.05600",
            "longitude": "-75.48700",
            "status": "1",
            "region": "CAFETERO",
        },
        {
            "ID": "4",
            "id": "0004",
            "name": "Ara Milán",
            "city": "Manizales",
            "department": "Caldas",
            "address": "Cra 23 # 74-20",
            "latitude": "5.05250",
            "longitude": "-75.47950",
            "status": "1",
            "region": "CAFETERO",
        },
        {
            "ID": "5",
            "id": "0005",
            "name": "Ara Palermo",
            "city": "Manizales",
            "department": "Caldas",
            "address": "Calle 68 # 27-10",
            "latitude": "5.05850",
            "longitude": "-75.49200",
            "status": "1",
            "region": "CAFETERO",
        },
        {
            "ID": "6",
            "id": "0006",
            "name": "Ara La Enea",
            "city": "Manizales",
            "department": "Caldas",
            "address": "Av Kevin Ángel",
            "latitude": "5.04100",
            "longitude": "-75.45800",
            "status": "1",
            "region": "CAFETERO",
        },
        {
            "ID": "7",
            "id": "0007",
            "name": "Ara Inactiva",
            "city": "Manizales",
            "department": "Caldas",
            "address": "Cerrada",
            "latitude": "5.06900",
            "longitude": "-75.51750",
            "status": "0",
            "region": "CAFETERO",
        },
        {
            "ID": "8",
            "id": "0008",
            "name": "Ara Pereira Lejana",
            "city": "Pereira",
            "department": "Risaralda",
            "address": "Centro Pereira",
            "latitude": "4.81333",
            "longitude": "-75.69611",
            "status": "1",
            "region": "CAFETERO",
        },
    ]


@dataclass
class _FakeResponse:
    status: int
    payload: Any = None
    body_text: str = ""

    async def __aenter__(self) -> "_FakeResponse":
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        return None

    async def json(self, content_type: str | None = None) -> Any:
        return self.payload

    async def text(self) -> str:
        return self.body_text


class _FakeSession:
    def __init__(
        self,
        responder: Any,
        *,
        artificial_delay: float = 0.0,
    ) -> None:
        self._responder = responder
        self._artificial_delay = artificial_delay
        self.calls: list[tuple[str, dict[str, str], float | None]] = []
        self.active_requests = 0
        self.max_active_requests = 0

    def get(
        self,
        url: str,
        *,
        params: dict[str, str],
        headers: dict[str, str],
        timeout: Any,
    ) -> Any:
        session = self

        class _Ctx:
            async def __aenter__(self) -> _FakeResponse:
                session.active_requests += 1
                session.max_active_requests = max(
                    session.max_active_requests,
                    session.active_requests,
                )
                try:
                    total_timeout = getattr(timeout, "total", None)
                    session.calls.append((url, dict(params), total_timeout))
                    if session._artificial_delay > 0:
                        await asyncio.sleep(session._artificial_delay)
                    result = session._responder(url, params)
                    if isinstance(result, BaseException):
                        raise result
                    return result
                finally:
                    session.active_requests -= 1

            async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
                return None

        return _Ctx()


class AraUtilsTests(unittest.TestCase):
    def test_haversine_and_top_5_nearby_selection(self) -> None:
        self.assertAlmostEqual(haversine_km(5.06889, -75.51738, 5.06889, -75.51738), 0.0, places=5)
        stores = select_nearest_stores(
            _sample_raw_stores(),
            user_lat=5.06889,
            user_lon=-75.51738,
            radio_km=8.0,
            limit=5,
        )
        self.assertEqual(len(stores), 5)
        self.assertEqual(stores[0].store_id, "0001")
        ids = {s.store_id for s in stores}
        self.assertNotIn("0007", ids)  # Inactiva excluida
        self.assertNotIn("0008", ids)  # Pereira > 8km excluida
        self.assertTrue(all(stores[i].distance_km <= stores[i + 1].distance_km for i in range(4)))

    def test_wholesale_x25_filter_and_cop_price_preservation(self) -> None:
        self.assertTrue(is_wholesale_x25("ARROZ ROA BOLSA DE 500 G. X 25 UN."))
        self.assertTrue(is_wholesale_x25("ARROZ ECONOMICO BOLSA X25 UN."))
        self.assertFalse(is_wholesale_x25("QUESITO ALPINA X 185 G."))
        self.assertFalse(is_wholesale_x25("CHOCOLATE X 250 G."))

        wholesale = normalize_ara_product(
            {
                "id": "1-1",
                "codeStore": "0001",
                "title": "ARROZ ROA BOLSA DE 500 G. X 25 UN.",
                "price": 47990,
                "pum": "Gramo a $3.84",
                "isDisabled": False,
            }
        )
        self.assertIsNone(wholesale)

        disabled = normalize_ara_product(
            {
                "id": "1-2",
                "codeStore": "0001",
                "title": "LECHE COLANTA X 1000 ML",
                "price": 4500,
                "isDisabled": True,
            }
        )
        self.assertIsNone(disabled)

        valid = normalize_ara_product(
            {
                "id": "10050-7702001133611",
                "codeEAN": "7702001133611",
                "codeSAP": "10050",
                "codeStore": "0719",
                "title": "QUESITO  ALPINA   X 185 G.",
                "category": "Lácteos, huevos y refrigerados",
                "categoryId": "002300010007",
                "images": ["https://media.aratiendas.com/10050-7702001133611-1.jpg"],
                "pum": "Gramo a $34.54",
                "isDisabled": False,
                "price": 6390,
            }
        )
        self.assertIsNotNone(valid)
        assert valid is not None
        self.assertEqual(valid.price, 6390)
        self.assertEqual(valid.title, "QUESITO ALPINA X 185 G.")
        self.assertEqual(valid.category_id, "002300010007")

    def test_ttl_cache_15_minute_expiration_and_key_format(self) -> None:
        now = [1000.0]
        cache: TTLMemoryCache[str] = TTLMemoryCache(default_ttl_seconds=900.0, clock=lambda: now[0])
        key = make_search_cache_key("0719", "  Arroz   Diana ")
        self.assertEqual(key, "0719_arroz diana")

        cache.set(key, "ok")
        now[0] = 1899.9
        self.assertEqual(cache.get(key), "ok")
        now[0] = 1900.0
        self.assertIsNone(cache.get(key))

    def test_page_token_roundtrip_and_invalid_rejected(self) -> None:
        token = encode_page_token(2, "10194-7702026020156")
        self.assertEqual(decode_page_token(token), (2, "10194-7702026020156"))
        self.assertEqual(decode_page_token(encode_page_token(0, None)), (0, None))
        with self.assertRaises(ValueError):
            decode_page_token("invalid!!!")


class AraGatewayClientResilienceTests(unittest.IsolatedAsyncioTestCase):
    def _config(self) -> AraConfig:
        return AraConfig(
            base_url="https://api-gw-test.local",
            api_key="test-key",
        )

    async def test_retry_backoff_1_2_4_on_429_then_succeed_or_abort(self) -> None:
        sleep_calls: list[float] = []

        async def _fake_sleep(seconds: float) -> None:
            sleep_calls.append(round(seconds, 4))

        attempt_counter = [0]

        def responder(url: str, params: dict[str, str]) -> _FakeResponse:
            if url.endswith("/stores"):
                return _FakeResponse(200, {"data": _sample_raw_stores()})
            attempt_counter[0] += 1
            if attempt_counter[0] <= 3:
                return _FakeResponse(429, body_text="Too Many Requests")
            return _FakeResponse(
                200,
                {
                    "data": [
                        {
                            "id": "1-1",
                            "codeStore": params["storeId"],
                            "title": "ARROZ DIANA 1000 G",
                            "price": 4500,
                            "pum": "Gramo a $4.50",
                            "categoryId": "cat-1",
                            "isDisabled": False,
                        }
                    ],
                    "metadata": {},
                },
            )

        session = _FakeSession(responder)
        client = AraGatewayClient(
            self._config(),
            session=session,  # type: ignore[arg-type]
            sleep_fn=_fake_sleep,
            rng=random.Random(42),
        )
        res, from_cache = await client.search_products_in_store("0001", "arroz")
        self.assertFalse(from_cache)
        self.assertEqual(len(res.items), 1)
        # Jitter (0.2..0.5) en cada intento + backoffs exactos [1.0, 2.0, 4.0]
        backoffs = [val for val in sleep_calls if val >= 1.0]
        jitters = [val for val in sleep_calls if val < 1.0]
        self.assertEqual(backoffs, [1.0, 2.0, 4.0])
        self.assertEqual(len(jitters), 4)
        self.assertTrue(all(0.2 <= j <= 0.5 for j in jitters))
        # Verifica timeout de 4 segundos en búsquedas
        search_timeouts = [t for u, _, t in session.calls if u.endswith("/products-search")]
        self.assertEqual(search_timeouts, [4.0, 4.0, 4.0, 4.0])

    async def test_exhausted_retries_and_bad_request_semantics(self) -> None:
        sleep_calls: list[float] = []

        async def _fake_sleep(seconds: float) -> None:
            sleep_calls.append(seconds)

        def always_fail(url: str, params: dict[str, str]) -> Any:
            if params.get("query") == "bad400":
                return _FakeResponse(400, body_text="Bad Request")
            raise asyncio.TimeoutError()

        client = AraGatewayClient(
            self._config(),
            session=_FakeSession(always_fail),  # type: ignore[arg-type]
            sleep_fn=_fake_sleep,
            rng=random.Random(1),
        )
        with self.assertRaises(AraStoreRequestError):
            await client.search_products_in_store("0001", "arroz")
        self.assertEqual([s for s in sleep_calls if s >= 1.0], [1.0, 2.0, 4.0])

        sleep_calls.clear()
        with self.assertRaises(AraBadRequestError):
            await client.search_products_in_store("0001", "bad400")
        self.assertEqual([s for s in sleep_calls if s >= 1.0], [])

    async def test_semaphore_caps_concurrency_at_5(self) -> None:
        async def _fast_sleep(seconds: float) -> None:
            await asyncio.sleep(0)

        def responder(url: str, params: dict[str, str]) -> _FakeResponse:
            return _FakeResponse(
                200,
                {
                    "data": [
                        {
                            "id": f"p-{params['storeId']}-{params['query']}",
                            "codeStore": params["storeId"],
                            "title": f"{params['query'].upper()} X 500 G",
                            "price": 3990,
                            "isDisabled": False,
                        }
                    ],
                    "metadata": {},
                },
            )

        session = _FakeSession(responder, artificial_delay=0.015)
        client = AraGatewayClient(
            self._config(),
            session=session,  # type: ignore[arg-type]
            sleep_fn=_fast_sleep,
            rng=random.Random(7),
        )
        # 15 peticiones simultáneas -> Semaphore(5) debe limitar pico a <= 5
        await asyncio.gather(
            *[client.search_products_in_store(f"000{i % 5 + 1}", f"item{i}") for i in range(15)]
        )
        self.assertGreaterEqual(session.max_active_requests, 2)
        self.assertLessEqual(session.max_active_requests, 5)


class FastApiEndpointsTests(unittest.TestCase):
    def _build_client_and_app(
        self,
        *,
        failing_store_id: str | None = None,
    ) -> tuple[_FakeSession, TestClient]:
        async def _no_sleep(_seconds: float) -> None:
            return None

        def responder(url: str, params: dict[str, str]) -> _FakeResponse:
            if url.endswith("/stores"):
                return _FakeResponse(200, {"data": _sample_raw_stores()})

            store_id = params.get("storeId", "")
            if failing_store_id and store_id == failing_store_id:
                return _FakeResponse(429, body_text="Rate limited")

            if url.endswith("/products-search"):
                q = params.get("query", "")
                token = params.get("nextPageToken")
                if store_id == "0001" and token is None:
                    return _FakeResponse(
                        200,
                        {
                            "data": [
                                {
                                    "id": f"1-{store_id}-{q}",
                                    "codeEAN": "7701234567890",
                                    "codeSAP": "1001",
                                    "codeStore": store_id,
                                    "title": f"{q.upper()} ESTANDAR X 500 G",
                                    "price": 5200,
                                    "pum": "Gramo a $10.40",
                                    "categoryId": "002300010007",
                                    "category": "Lácteos",
                                    "isDisabled": False,
                                },
                                {
                                    "id": f"2-{store_id}-{q}",
                                    "codeStore": store_id,
                                    "title": f"{q.upper()} PACAS X25 UN",
                                    "price": 99000,
                                    "isDisabled": False,
                                },
                            ],
                            "metadata": {"nextPageToken": "page-2-token"},
                        },
                    )
                return _FakeResponse(
                    200,
                    {
                        "data": [
                            {
                                "id": f"3-{store_id}-{q}-{token or 'p1'}",
                                "codeStore": store_id,
                                "title": f"{q.upper()} EXTRA X 1000 G",
                                "price": 9800,
                                "categoryId": "002300010007",
                                "isDisabled": False,
                            }
                        ],
                        "metadata": {},
                    },
                )

            if url.endswith("/products"):
                token = params.get("startAfter")
                if store_id == "0001" and token is None:
                    # Página 1 de /products sin coincidencia para probar avance automático
                    return _FakeResponse(
                        200,
                        {
                            "data": [
                                {
                                    "id": "cat-other-1",
                                    "codeStore": store_id,
                                    "title": "DETERGENTE X 1 KG",
                                    "price": 8500,
                                    "categoryId": "aseo-1",
                                    "isDisabled": False,
                                }
                            ],
                            "metadata": {"nextPageToken": "ara-cat-p2"},
                        },
                    )
                return _FakeResponse(
                    200,
                    {
                        "data": [
                            {
                                "id": f"cat-match-{store_id}",
                                "codeStore": store_id,
                                "title": "QUESITO ALPINA X 185 G.",
                                "price": 6390,
                                "pum": "Gramo a $34.54",
                                "categoryId": "002300010007",
                                "isDisabled": False,
                            }
                        ],
                        "metadata": {},
                    },
                )

            return _FakeResponse(404, body_text="Not found")

        session = _FakeSession(responder)
        cfg = AraConfig(base_url="https://api-gw-test.local", api_key="test-key")
        ara_client = AraGatewayClient(
            cfg,
            session=session,  # type: ignore[arg-type]
            sleep_fn=_no_sleep,
            rng=random.Random(3),
        )
        app = create_app(config=cfg, client=ara_client)
        return session, TestClient(app)

    def test_evaluar_canasta_validation_cache_and_store_error_isolation(self) -> None:
        session, client = self._build_client_and_app(failing_store_id="0002")
        with client:
            # Validaciones estrictas
            bad_min = client.post(
                "/evaluar-canasta",
                json={"lat": 5.06889, "lon": -75.51738, "radio_km": 5, "lista_productos": ["Arroz"]},
            )
            self.assertEqual(bad_min.status_code, 422)

            bad_radio = client.post(
                "/evaluar-canasta",
                json={
                    "lat": 5.06889,
                    "lon": -75.51738,
                    "radio_km": 9,
                    "lista_productos": ["Arroz", "Leche"],
                },
            )
            self.assertEqual(bad_radio.status_code, 422)

            # Primera consulta: 5 tiendas x 2 productos = 10 misses (store 0002 falla tras reintentos)
            payload = {
                "lat": 5.06889,
                "lon": -75.51738,
                "radio_km": 8,
                "lista_productos": ["Arroz Diana", "Leche Colanta"],
            }
            resp1 = client.post("/evaluar-canasta", json=payload)
            self.assertEqual(resp1.status_code, 200)
            body1 = resp1.json()
            self.assertEqual(len(body1["tiendas_cercanas"]), 5)
            self.assertEqual(body1["cache_hits"], 0)
            self.assertEqual(body1["cache_misses"], 10)
            self.assertEqual(len(body1["errores"]), 2)  # Tienda 0002 falló en 2 queries
            self.assertEqual({e["store_id"] for e in body1["errores"]}, {"0002"})
            # Asegura que el filtro X25 eliminó las pacas en tienda 0001
            arroz_store1 = body1["resultados"][0]["resultados_por_tienda"][0]["items"]
            self.assertEqual(len(arroz_store1), 1)
            self.assertEqual(arroz_store1[0]["price"], 5200)

            calls_before_cache = len(session.calls)
            # Segunda consulta idéntica -> los 8 éxitos vienen de caché (0002 reintenta porque no se cachea error)
            resp2 = client.post("/evaluar-canasta", json=payload)
            self.assertEqual(resp2.status_code, 200)
            body2 = resp2.json()
            self.assertEqual(body2["cache_hits"], 8)
            self.assertEqual(body2["cache_misses"], 2)
            # Ninguna petición nueva a tiendas sanas
            healthy_new_calls = [
                c for c in session.calls[calls_before_cache:] if c[1].get("storeId") != "0002"
            ]
            self.assertEqual(healthy_new_calls, [])

    def test_buscar_lazy_loading_and_category_fallback(self) -> None:
        session, client = self._build_client_and_app()
        with client:
            # Requiere query o categoria_id
            missing = client.get("/buscar", params={"lat": 5.06889, "lon": -75.51738, "radio_km": 5})
            self.assertEqual(missing.status_code, 422)

            # Página 1 solo consulta la tienda más cercana (0001)
            p1 = client.get(
                "/buscar",
                params={"lat": 5.06889, "lon": -75.51738, "radio_km": 8, "query": "leche"},
            )
            self.assertEqual(p1.status_code, 200)
            d1 = p1.json()
            self.assertEqual(d1["tienda_consultada"]["store_id"], "0001")
            self.assertEqual(len(d1["productos"]), 1)  # Excluyó X25
            self.assertIsNotNone(d1["next_page_token"])
            search_stores_called = [
                c[1]["storeId"] for c in session.calls if c[0].endswith("/products-search")
            ]
            self.assertEqual(search_stores_called, ["0001"])

            # Página 2 continúa dentro de tienda 0001 usando nextPageToken de Ara
            p2 = client.get(
                "/buscar",
                params={
                    "lat": 5.06889,
                    "lon": -75.51738,
                    "radio_km": 8,
                    "query": "leche",
                    "page_token": d1["next_page_token"],
                },
            )
            self.assertEqual(p2.status_code, 200)
            d2 = p2.json()
            self.assertEqual(d2["tienda_consultada"]["store_id"], "0001")
            self.assertIsNotNone(d2["next_page_token"])

            # Página 3 avanza automáticamente a tienda 0002 cuando se agota tienda 0001
            p3 = client.get(
                "/buscar",
                params={
                    "lat": 5.06889,
                    "lon": -75.51738,
                    "radio_km": 8,
                    "query": "leche",
                    "page_token": d2["next_page_token"],
                },
            )
            self.assertEqual(p3.status_code, 200)
            self.assertEqual(p3.json()["tienda_consultada"]["store_id"], "0002")

            # Búsqueda solo por categoria_id usa /products (jamás /products-search sin query)
            cat_calls_before = len(session.calls)
            cat_res = client.get(
                "/buscar",
                params={
                    "lat": 5.06889,
                    "lon": -75.51738,
                    "radio_km": 8,
                    "categoria_id": "002300010007",
                },
            )
            self.assertEqual(cat_res.status_code, 200)
            cat_body = cat_res.json()
            self.assertEqual(cat_body["total_items_pagina"], 1)
            self.assertEqual(cat_body["productos"][0]["price"], 6390)
            new_endpoints = {c[0].rsplit("/", 1)[-1] for c in session.calls[cat_calls_before:]}
            self.assertEqual(new_endpoints, {"products"})

            # Token corrupto retorna 400
            bad_tok = client.get(
                "/buscar",
                params={
                    "lat": 5.06889,
                    "lon": -75.51738,
                    "radio_km": 8,
                    "query": "leche",
                    "page_token": "corrupto!!!",
                },
            )
            self.assertEqual(bad_tok.status_code, 400)


if __name__ == "__main__":
    unittest.main()
