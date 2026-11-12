"""Detector automático de shrinkflation ('reduflación') en productos maestros."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Protocol

from etl.core.models import ScrapedProduct, UnitMeasure
from etl.core.normalizer import compute_pum

logger = logging.getLogger(__name__)


class ShrinkflationGateway(Protocol):
    """Puerto de persistencia para marcar alertas de shrinkflation en `master_products`."""

    async def flag_shrinkflation(
        self,
        master_product_id: str,
        *,
        previous_net_content: Decimal,
        current_net_content: Decimal,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class ShrinkflationFinding:
    """Resultado de detección de encogimiento oculto sobre un producto maestro."""

    master_product_id: str
    normalized_name: str
    unit_measure: str
    previous_net_content: Decimal
    current_net_content: Decimal
    previous_pum: Decimal
    current_pum: Decimal
    content_drop_pct: Decimal
    hidden_inflation_pct: Decimal


def detect_shrinkflation(
    *,
    master_product_id: str,
    normalized_name: str,
    previous_net_content: Decimal,
    current_net_content: Decimal,
    previous_unit_measure: UnitMeasure | str,
    current_unit_measure: UnitMeasure | str,
    previous_price: Decimal,
    current_price: Decimal,
    previous_pum: Decimal | None = None,
    current_pum: Decimal | None = None,
    min_drop_ratio: Decimal = Decimal("0.01"),
) -> ShrinkflationFinding | None:
    """Evalúa si disminuyó el contenido neto manteniendo o aumentando el PUM/precio.

    Retorna un :class:`ShrinkflationFinding` cuando:
    1. Ambas lecturas comparten la misma unidad base (``g``, ``ml`` o ``und``).
    2. El ``net_content`` actual cayó al menos ``min_drop_ratio`` respecto al registrado.
    3. El precio unitario (PUM) se mantuvo igual o subió (o el precio de venta no bajó).
    """
    prev_unit = (
        previous_unit_measure.value
        if isinstance(previous_unit_measure, UnitMeasure)
        else str(previous_unit_measure)
    ).lower()
    curr_unit = (
        current_unit_measure.value
        if isinstance(current_unit_measure, UnitMeasure)
        else str(current_unit_measure)
    ).lower()

    if prev_unit != curr_unit:
        return None
    if previous_net_content <= 0 or current_net_content <= 0:
        return None
    if current_net_content >= previous_net_content:
        return None

    drop_ratio = (previous_net_content - current_net_content) / previous_net_content
    if drop_ratio < min_drop_ratio:
        return None

    prev_pum = previous_pum if previous_pum is not None else compute_pum(previous_price, previous_net_content)
    curr_pum = current_pum if current_pum is not None else compute_pum(current_price, current_net_content)

    # Condición de reduflación: mantiene o sube el precio por unidad o el precio total de góndola
    if curr_pum < prev_pum and current_price < previous_price:
        return None

    content_drop_pct = (drop_ratio * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if prev_pum > 0:
        hidden_inflation_pct = (((curr_pum - prev_pum) / prev_pum) * Decimal("100")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
    else:
        hidden_inflation_pct = Decimal("0.00")

    return ShrinkflationFinding(
        master_product_id=master_product_id,
        normalized_name=normalized_name,
        unit_measure=curr_unit,
        previous_net_content=previous_net_content,
        current_net_content=current_net_content,
        previous_pum=prev_pum,
        current_pum=curr_pum,
        content_drop_pct=content_drop_pct,
        hidden_inflation_pct=hidden_inflation_pct,
    )


class ShrinkflationDetector:
    """Compara lecturas entrantes del ETL contra `master_products` y persiste alertas."""

    def __init__(self, gateway: ShrinkflationGateway) -> None:
        self._gateway = gateway

    def evaluate_candidates(
        self,
        candidates: list[tuple[ScrapedProduct, dict[str, Any], Decimal]],
    ) -> list[ShrinkflationFinding]:
        """Evalúa pares `(producto_entrante, fila_master_product, precio_anterior)`."""
        findings_by_master: dict[str, ShrinkflationFinding] = {}

        for product, master_row, previous_price in candidates:
            master_id = str(master_row["id"])
            prev_net = Decimal(str(master_row["net_content"]))
            finding = detect_shrinkflation(
                master_product_id=master_id,
                normalized_name=str(master_row.get("normalized_name") or product.normalized_name),
                previous_net_content=prev_net,
                current_net_content=product.net_content,
                previous_unit_measure=str(master_row["unit_measure"]),
                current_unit_measure=product.unit_measure,
                previous_price=previous_price,
                current_price=product.calibrated_price,
                current_pum=product.pum_price,
            )
            if finding is not None and master_id not in findings_by_master:
                findings_by_master[master_id] = finding

        return list(findings_by_master.values())

    async def persist_findings(self, findings: list[ShrinkflationFinding]) -> int:
        """Actualiza `shrinkflation_alert = True` y guarda `previous_net_content` en `master_products`."""
        updated = 0
        for finding in findings:
            await self._gateway.flag_shrinkflation(
                finding.master_product_id,
                previous_net_content=finding.previous_net_content,
                current_net_content=finding.current_net_content,
            )
            updated += 1
            logger.warning(
                "Shrinkflation detectado en %s (%s): %s -> %s %s (+%s%% encarecimiento real)",
                finding.normalized_name,
                finding.master_product_id,
                finding.previous_net_content,
                finding.current_net_content,
                finding.unit_measure,
                finding.hidden_inflation_pct,
            )
        return updated
