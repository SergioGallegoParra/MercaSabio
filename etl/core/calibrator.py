"""Modelo de calibración de precios (Cross-Store Spread) para agregadores."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from statistics import median
from typing import Sequence


def calculate_calibration_factor(anchor_pairs: Sequence[tuple[Decimal, Decimal]]) -> Decimal:
    """Calcula `alpha = mediana(Precio_real(i) / Precio_agregador(i))` con 4 decimales."""
    if not anchor_pairs:
        raise ValueError("La muestra ancla no puede estar vacía para calcular alpha.")

    ratios: list[Decimal] = []
    for real_price, aggregator_price in anchor_pairs:
        if real_price <= 0 or aggregator_price <= 0:
            raise ValueError(
                f"Los precios de la muestra ancla deben ser positivos: real={real_price}, agregador={aggregator_price}"
            )
        ratios.append(real_price / aggregator_price)

    alpha = Decimal(str(median(ratios)))
    return alpha.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def apply_calibration(
    raw_price: Decimal,
    alpha: Decimal = Decimal("1.0000"),
    *,
    round_to_tens: bool | None = None,
) -> Decimal:
    """Aplica `ROUND(precio_agregador * alpha, -1)` cuando existe factor de calibración."""
    if raw_price < 0:
        raise ValueError(f"El precio base no puede ser negativo: {raw_price}")
    if alpha <= 0:
        raise ValueError(f"El factor alpha debe ser positivo: {alpha}")

    should_round_tens = (alpha != Decimal("1.0000")) if round_to_tens is None else round_to_tens
    scaled = raw_price * alpha
    if should_round_tens:
        return scaled.quantize(Decimal("1E1"), rounding=ROUND_HALF_UP).quantize(Decimal("0.01"))
    return scaled.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
