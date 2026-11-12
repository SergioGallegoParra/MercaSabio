"""Modelos Pydantic v2 y estructuras de dominio para ingesta, normalización y CDC."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class UnitMeasure(str, Enum):
    """Unidades base estandarizadas en PostgreSQL (`g`, `ml`, `und`)."""

    G = "g"
    ML = "ml"
    UND = "und"


class NormalizedContent(BaseModel):
    """Resultado estandarizado de contenido neto y unidad de medida."""

    model_config = ConfigDict(frozen=True)

    net_content: Decimal = Field(..., gt=Decimal("0"))
    unit_measure: UnitMeasure
    raw_match: str | None = None


class ScraperConfig(BaseModel):
    """Configuración operativa para conectores HTTP asíncronos."""

    model_config = ConfigDict(frozen=True)

    store_id: str = Field(..., min_length=1, max_length=30)
    base_url: str = Field(..., min_length=1)
    channel_type: str = Field(..., min_length=1, max_length=30)
    source_origin: str = Field(..., min_length=1, max_length=30)
    requests_per_second: float = Field(default=2.0, gt=0.0, le=50.0)
    max_concurrency: int = Field(default=3, ge=1, le=20)
    max_retries: int = Field(default=4, ge=0, le=10)
    backoff_base_seconds: float = Field(default=1.0, gt=0.0)
    backoff_max_seconds: float = Field(default=30.0, gt=0.0)
    timeout_seconds: float = Field(default=20.0, gt=0.0)
    markup_discount_factor: Decimal = Field(
        default=Decimal("1.0000"),
        gt=Decimal("0"),
        le=Decimal("2.0000"),
    )
    default_headers: dict[str, str] = Field(default_factory=dict)
    rotate_user_agent: bool = True
    category_filters: list[str] = Field(default_factory=list)
    max_categories: int | None = Field(default=None, ge=1)


def _clean_ean(value: str | None) -> str | None:
    if value is None:
        return None
    digits = "".join(ch for ch in str(value).strip() if ch.isdigit())
    if len(digits) not in {8, 12, 13, 14}:
        return None
    if set(digits) == {"0"}:
        return None
    return digits


class ScrapedProduct(BaseModel):
    """Registro validado de SKU extraído, normalizado y con PUM calculado."""

    model_config = ConfigDict(str_strip_whitespace=True)

    store_id: Annotated[str, Field(min_length=1, max_length=30)]
    external_sku: Annotated[str, Field(min_length=1, max_length=100)]
    ean: str | None = Field(default=None, max_length=20)
    raw_name: Annotated[str, Field(min_length=1, max_length=255)]
    normalized_name: Annotated[str, Field(min_length=1, max_length=255)]
    brand: str | None = Field(default=None, max_length=100)
    raw_list_price: Decimal = Field(..., ge=Decimal("0"))
    raw_sale_price: Decimal = Field(..., ge=Decimal("0"))
    calibrated_price: Decimal = Field(..., ge=Decimal("0"))
    net_content: Decimal = Field(..., gt=Decimal("0"))
    unit_measure: UnitMeasure
    pum_price: Decimal = Field(..., ge=Decimal("0"))
    in_stock: bool = True
    source_origin: Annotated[str, Field(min_length=1, max_length=30)]
    raw_url: str | None = None
    image_url: str | None = None
    canonical_category_slug: str | None = Field(default=None, max_length=100)
    is_private_label: bool = False
    category_path: list[str] = Field(default_factory=list)

    @field_validator("ean", mode="before")
    @classmethod
    def validate_ean(cls, value: str | None) -> str | None:
        return _clean_ean(value)

    @field_validator("raw_name", "normalized_name", mode="before")
    @classmethod
    def truncate_names(cls, value: str) -> str:
        text = " ".join(str(value).split())
        return text[:255]

    @field_validator("brand", mode="before")
    @classmethod
    def truncate_brand(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = " ".join(str(value).split())
        return cleaned[:100] if cleaned else None

    @field_validator("raw_list_price", "raw_sale_price", "calibrated_price", "net_content", mode="after")
    @classmethod
    def quantize_two_decimals(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))

    @field_validator("pum_price", mode="after")
    @classmethod
    def quantize_four_decimals(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.0001"))

    @model_validator(mode="after")
    def ensure_list_price_consistency(self) -> ScrapedProduct:
        if self.raw_list_price < self.raw_sale_price:
            self.raw_list_price = self.raw_sale_price
        return self


@dataclass(slots=True)
class CachedPriceState:
    """Estado mínimo en memoria por `store_sku_id` cargado desde `v_latest_prices`."""

    store_sku_id: str
    master_product_id: str | None
    raw_sale_price: Decimal
    calibrated_price: Decimal
    in_stock: bool
    net_content: Decimal | None = None
    unit_measure: str | None = None
    pum_price: Decimal | None = None
    normalized_name: str | None = None


class CDCStats(BaseModel):
    """Métricas operativas de reducción de inserciones por CDC."""

    store_id: str
    total_processed: int = 0
    new_skus: int = 0
    price_or_stock_changes: int = 0
    unchanged_skipped: int = 0
    master_matches_ean: int = 0
    master_matches_trgm: int = 0
    master_matches_canonical: int = 0
    master_created: int = 0
    verified_touched: int = 0
    shrinkflation_alerts: int = 0

    @property
    def inserted_price_records(self) -> int:
        return self.new_skus + self.price_or_stock_changes

    @property
    def reduction_percentage(self) -> float:
        if self.total_processed == 0:
            return 0.0
        return round((self.unchanged_skipped / self.total_processed) * 100.0, 2)
