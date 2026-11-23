-- Reemplaza el índice parcial limitado a las 12 tiendas antiguas por un índice
-- general `(store_id, last_verified_at DESC)` para todas las 26 cadenas activas.

CREATE INDEX IF NOT EXISTS idx_store_skus_store_verified
ON public.store_skus (store_id, last_verified_at DESC)
WHERE is_mercado = TRUE AND is_deprecated_candidate = FALSE AND master_product_id IS NOT NULL;

DROP INDEX IF EXISTS public.idx_store_skus_mercado_12_stores;
