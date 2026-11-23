"""Pruebas del punto de entrada CLI (`etl.main`)."""

from __future__ import annotations

import unittest

from etl.main import SUPPORTED_STORES, build_scraper, main, parse_args


class MainCliTests(unittest.TestCase):
    def test_build_scraper_for_all_supported_stores(self) -> None:
        for store_id in SUPPORTED_STORES:
            with self.subTest(store_id=store_id):
                scraper = build_scraper(store_id)
                self.assertEqual(scraper.config.store_id, store_id)

    def test_unknown_store_returns_exit_code_2(self) -> None:
        self.assertEqual(main(["--store", "tienda_inexistente"]), 2)

    def test_parse_args_accepts_refresh_browser_flag(self) -> None:
        args = parse_args(["--store", "isimo", "--refresh-browser", "--dry-run", "--local"])
        self.assertEqual(args.store, "isimo")
        self.assertTrue(args.refresh_browser)
        self.assertTrue(args.dry_run)
        self.assertTrue(args.local)


if __name__ == "__main__":
    unittest.main()
