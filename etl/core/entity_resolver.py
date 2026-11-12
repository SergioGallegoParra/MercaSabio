"""Motor de homologación en cascada (Entity Resolution de 3 niveles)."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol

from etl.core.models import CDCStats, ScrapedProduct


class ResolutionGateway(Protocol):
    """Puerto mínimo de lectura/escritura en `master_products` y `canonical_categories`."""

    async def fetch_canonical_categories(self) -> dict[str, int]: ...

    async def fetch_master_products_by_eans(self, eans: list[str]) -> dict[str, str]: ...

    async def match_master_product_trgm(
        self,
        normalized_name: str,
        net_content: Decimal,
        unit_measure: str,
        threshold: float = 0.65,
    ) -> str | None: ...

    async def create_master_product(self, payload: dict[str, Any]) -> str: ...


@dataclass(frozen=True, slots=True)
class ResolutionResult:
    """Resultado de homologación hacia `master_products.id`."""

    master_product_id: str
    method: str  # 'ean' | 'trgm' | 'canonical_new' | 'new'


class EntityResolver:
    """Resuelve productos hacia `master_products` mediante cascada EAN -> Trigram -> Canónica."""

    def __init__(
        self,
        gateway: ResolutionGateway,
        *,
        trgm_threshold: float = 0.65,
    ) -> None:
        self._gateway = gateway
        self._trgm_threshold = trgm_threshold
        self._ean_cache: dict[str, str] = {}
        self._trgm_cache: dict[tuple[str, Decimal, str], str] = {}
        self._canonical_categories: dict[str, int] | None = None

    async def warm_up(self) -> None:
        """Carga el catálogo de categorías canónicas para homologación Nivel 3."""
        if self._canonical_categories is None:
            self._canonical_categories = await self._gateway.fetch_canonical_categories()

    async def resolve_batch(
        self,
        products: list[ScrapedProduct],
        stats: CDCStats | None = None,
    ) -> dict[str, ResolutionResult]:
        """Homologa un lote de productos nuevos devolviendo `{external_sku: ResolutionResult}`."""
        if not products:
            return {}

        await self.warm_up()

        # Nivel 1: precarga en lote por EAN-13 para evitar consultas N+1
        pending_eans = sorted(
            {p.ean for p in products if p.ean and p.ean not in self._ean_cache}
        )
        if pending_eans:
            found = await self._gateway.fetch_master_products_by_eans(pending_eans)
            self._ean_cache.update(found)

        results: dict[str, ResolutionResult] = {}
        for product in products:
            res = await self._resolve_single(product)
            results[product.external_sku] = res
            if stats is not None:
                if res.method == "ean":
                    stats.master_matches_ean += 1
                elif res.method == "trgm":
                    stats.master_matches_trgm += 1
                elif res.method == "canonical_new":
                    stats.master_matches_canonical += 1
                    stats.master_created += 1
                else:
                    stats.master_created += 1

        return results

    async def _resolve_single(self, product: ScrapedProduct) -> ResolutionResult:
        # Nivel 1: Coincidencia exacta por EAN
        if product.ean and product.ean in self._ean_cache:
            return ResolutionResult(
                master_product_id=self._ean_cache[product.ean],
                method="ean",
            )

        trgm_key = (
            product.normalized_name,
            product.net_content,
            product.unit_measure.value,
        )

        # Nivel 2: Similitud léxica por trigramas acotada a idéntico contenido y unidad
        # Marcas propias exclusivas (Nivel 3) no se fusionan por trigrama entre cadenas.
        if not product.is_private_label:
            if trgm_key in self._trgm_cache:
                return ResolutionResult(
                    master_product_id=self._trgm_cache[trgm_key],
                    method="trgm",
                )

            matched_id = await self._gateway.match_master_product_trgm(
                product.normalized_name,
                product.net_content,
                product.unit_measure.value,
                threshold=self._trgm_threshold,
            )
            if matched_id is not None:
                self._trgm_cache[trgm_key] = matched_id
                if product.ean:
                    self._ean_cache[product.ean] = matched_id
                return ResolutionResult(master_product_id=matched_id, method="trgm")

        # Nivel 3 / Creación de nuevo master_product
        canonical_id = None
        if product.canonical_category_slug and self._canonical_categories:
            canonical_id = self._canonical_categories.get(product.canonical_category_slug)

        payload: dict[str, Any] = {
            "ean": product.ean,
            "canonical_category_id": canonical_id,
            "normalized_name": product.normalized_name,
            "brand": product.brand,
            "net_content": str(product.net_content),
            "unit_measure": product.unit_measure.value,
            "is_private_label": product.is_private_label,
            "image_url": product.image_url,
        }
        created_id = await self._gateway.create_master_product(payload)

        if product.ean:
            self._ean_cache[product.ean] = created_id
        if not product.is_private_label:
            self._trgm_cache[trgm_key] = created_id

        method = "canonical_new" if canonical_id is not None else "new"
        return ResolutionResult(master_product_id=created_id, method=method)
