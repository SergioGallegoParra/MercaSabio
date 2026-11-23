"""Backend on-demand con FastAPI para comparación y búsqueda en Tiendas Ara."""

from etl.ara_ondemand.utils import (
    AraProduct,
    AraStore,
    CachedSearchResult,
    TTLMemoryCache,
    decode_page_token,
    encode_page_token,
    haversine_km,
    is_wholesale_x25,
    load_env_file_if_missing,
    make_search_cache_key,
    normalize_ara_product,
    parse_price_cop,
    parse_store_record,
    select_nearest_stores,
)

__all__ = [
    "AraProduct",
    "AraStore",
    "CachedSearchResult",
    "TTLMemoryCache",
    "decode_page_token",
    "encode_page_token",
    "haversine_km",
    "is_wholesale_x25",
    "load_env_file_if_missing",
    "make_search_cache_key",
    "normalize_ara_product",
    "parse_price_cop",
    "parse_store_record",
    "select_nearest_stores",
]
