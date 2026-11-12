"""Pruebas unitarias del modelo de calibración cross-store spread."""

from __future__ import annotations

import unittest
from decimal import Decimal

from etl.core.calibrator import apply_calibration, calculate_calibration_factor


class CalibratorTests(unittest.TestCase):
    def test_calculate_calibration_factor_uses_median(self) -> None:
        anchor = [
            (Decimal("4500"), Decimal("5000")),  # 0.90
            (Decimal("9000"), Decimal("10000")),  # 0.90
            (Decimal("16000"), Decimal("20000")),  # 0.80 outlier
            (Decimal("9200"), Decimal("10000")),  # 0.92
            (Decimal("9500"), Decimal("10000")),  # 0.95
        ]
        # Ratios ordenados: [0.80, 0.90, 0.90, 0.92, 0.95] -> mediana = 0.9000
        alpha = calculate_calibration_factor(anchor)
        self.assertEqual(alpha, Decimal("0.9000"))

    def test_apply_calibration_rounds_to_nearest_ten_when_alpha_present(self) -> None:
        # 12340 * 0.90 = 11106 -> ROUND(..., -1) = 11110
        calibrated = apply_calibration(Decimal("12340"), Decimal("0.9000"))
        self.assertEqual(calibrated, Decimal("11110.00"))

    def test_apply_calibration_preserves_direct_store_price_when_alpha_is_one(self) -> None:
        direct = apply_calibration(Decimal("4595.00"), Decimal("1.0000"))
        self.assertEqual(direct, Decimal("4595.00"))


if __name__ == "__main__":
    unittest.main()
