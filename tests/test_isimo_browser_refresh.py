"""Pruebas determinísticas para el refresco Playwright de Ísimo (`isimo_browser_refresh`)."""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from etl.scrapers.isimo_browser_refresh import (
    _is_waf_or_auth_wall,
    discover_paginated_sections_from_next_payload,
    extract_products_from_next_payload,
    normalize_browser_cards,
    refresh_isimo_snapshots,
)


def _make_mock_rappi_handler(*, block_403: bool = False):
    next_data = {
        "buildId": "mock-build",
        "props": {
            "pageProps": {
                "fallback": {
                    "storefront/900468086-isimo-mt-nc/despensa": {
                        "sub_aisles_response": {
                            "data": {
                                "headers": [
                                    {
                                        "resource": {
                                            "categories": [
                                                {"name": "Condimentos y salsas", "product_count": 30},
                                            ]
                                        }
                                    }
                                ],
                                "components": [
                                    {
                                        "resource": {
                                            "products": [
                                                {
                                                    "id": "900468086_101",
                                                    "product_id": "101",
                                                    "master_product_id": 5001,
                                                    "name": "Salsa Savoria SSR",
                                                    "description": "Salsa Savoria 200 g",
                                                    "real_price": 4500,
                                                    "price": 3900,
                                                    "unit_type": "g",
                                                    "quantity": 200,
                                                    "image": "savoria.png",
                                                }
                                            ]
                                        }
                                    }
                                ],
                            }
                        }
                    }
                }
            }
        },
    }

    catalog_html = f"""<!doctype html>
<html>
<head><title>Ísimo - Rappi</title></head>
<body>
  <script id="__NEXT_DATA__" type="application/json">{json.dumps(next_data)}</script>
  <a href="/tiendas/900468086-isimo-mt-nc/despensa/condimentos-y-salsas">Condimentos y salsas</a>
  <a href="/tiendas/900468086-isimo-mt-nc/combos">Combos</a>
</body>
</html>"""

    condimentos_html = """<!doctype html>
<html>
<head><title>Condimentos y salsas - Rappi</title></head>
<body>
  <div id="grid">
    <div data-item-id="6843590">
      <img src="https://images.rappi.com/products/salsa1.png" />
      <a href="/producto/salsa-6843590">$ 4.990 $ 5.550 10% ($9.98/g) Savoria Salsa de Tomate 1 x 500 g</a>
    </div>
  </div>
  <button id="btn-more" type="button">+ Ver más</button>
  <script>
    const btn = document.getElementById('btn-more');
    btn.addEventListener('click', () => {
      const grid = document.getElementById('grid');
      const card = document.createElement('div');
      card.setAttribute('data-item-id', '6843999');
      card.innerHTML = '<img src="https://images.rappi.com/products/salsa2.png" />'
        + '<a href="/producto/mayo-6843999">$ 3.990 ($7.98/g) Savoria Mayonesa Paginada 1 x 500 g</a>';
      grid.appendChild(card);
      btn.remove();
    });
  </script>
</body>
</html>"""

    class _Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            return None

        def do_GET(self) -> None:  # noqa: N802
            if block_403:
                self.send_response(403)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"<html><head><title>ERROR: The request could not be satisfied</title></head></html>")
                return

            body = condimentos_html if "condimentos-y-salsas" in self.path else catalog_html
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body.encode("utf-8"))

    return _Handler


class IsimoBrowserRefreshTests(unittest.IsolatedAsyncioTestCase):
    def test_extracts_ssr_discovers_sections_and_normalizes_cards(self) -> None:
        payload = {
            "props": {
                "pageProps": {
                    "fallback": {
                        "storefront/900468086-isimo-mt-nc/despensa": {
                            "sub_aisles_response": {
                                "data": {
                                    "headers": [
                                        {
                                            "resource": {
                                                "categories": [
                                                    {"name": "Aceites", "product_count": 2},
                                                    {"name": "Condimentos y salsas", "product_count": 40},
                                                ]
                                            }
                                        }
                                    ],
                                    "components": [
                                        {"resource": {"products": [{"product_id": "1"}, {"product_id": "2"}]}},
                                        {"resource": {"products": [{"product_id": "3"}]}},
                                    ],
                                }
                            }
                        }
                    }
                }
            }
        }
        products = extract_products_from_next_payload(payload)
        self.assertEqual(set(products.keys()), {"1", "2", "3"})
        discovered = discover_paginated_sections_from_next_payload(payload)
        self.assertEqual(discovered, ["despensa/condimentos-y-salsas"])

        cards = normalize_browser_cards(
            [
                {
                    "id": "6843590",
                    "img": "https://images.rappi.com/products/salsa.png",
                    "href": "/producto/salsa-6843590",
                    "raw": "$ 4.990 $ 5.550 ($9.98/g) Savoria Salsa de Tomate 1 x 500 g",
                },
                {
                    "id": "noise",
                    "img": "https://images.rappi.com/products/noise.png",
                    "raw": "Texto sin precio válido",
                },
            ],
            section="despensa/condimentos-y-salsas",
        )
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["id"], "6843590")
        self.assertIsNotNone(_is_waf_or_auth_wall("ERROR: The request could not be satisfied", ""))
        self.assertIsNotNone(_is_waf_or_auth_wall("Ok", "", status_code=403))

    async def test_playwright_clicks_ver_mas_and_preserves_snapshots_on_waf(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), _make_mock_rappi_handler(block_403=False))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base_url = f"http://127.0.0.1:{server.server_port}"
            with tempfile.TemporaryDirectory() as tmpdir:
                tmp = Path(tmpdir)
                ssr_path = tmp / "ssr.json"
                browser_path = tmp / "browser.json"
                res = await refresh_isimo_snapshots(
                    sections=("despensa/condimentos-y-salsas",),
                    ssr_snapshot_path=ssr_path,
                    browser_snapshot_path=browser_path,
                    base_url=base_url,
                    delay_ms=200,
                    min_browser_items=2,
                    min_ssr_items=1,
                )
                self.assertEqual(res.status, "updated")
                self.assertEqual(res.ssr_items_count, 1)
                self.assertEqual(res.browser_items_count, 2)
                saved_browser = json.loads(browser_path.read_text(encoding="utf-8"))
                self.assertEqual(len(saved_browser), 2)
                self.assertTrue(any("Paginada" in row["raw"] for row in saved_browser))
        finally:
            server.shutdown()
            server.server_close()

        # En bloqueo 403 / CloudFront debe abortar sin destruir snapshots previos
        blocked_server = ThreadingHTTPServer(("127.0.0.1", 0), _make_mock_rappi_handler(block_403=True))
        blocked_thread = threading.Thread(target=blocked_server.serve_forever, daemon=True)
        blocked_thread.start()
        try:
            blocked_url = f"http://127.0.0.1:{blocked_server.server_port}"
            with tempfile.TemporaryDirectory() as tmpdir:
                tmp = Path(tmpdir)
                ssr_path = tmp / "ssr.json"
                browser_path = tmp / "browser.json"
                browser_path.write_text('[{"keep": true}]', encoding="utf-8")
                res = await refresh_isimo_snapshots(
                    sections=("despensa/condimentos-y-salsas",),
                    ssr_snapshot_path=ssr_path,
                    browser_snapshot_path=browser_path,
                    base_url=blocked_url,
                    delay_ms=100,
                    min_browser_items=1,
                    min_ssr_items=1,
                )
                self.assertEqual(res.status, "blocked")
                self.assertEqual(json.loads(browser_path.read_text(encoding="utf-8")), [{"keep": True}])
        finally:
            blocked_server.shutdown()
            blocked_server.server_close()


if __name__ == "__main__":
    unittest.main()
