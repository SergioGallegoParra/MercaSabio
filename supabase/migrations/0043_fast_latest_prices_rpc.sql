-- 0043_fast_latest_prices_rpc.sql
-- Optimiza CDCManager.initialize() evitando el escaneo completo de `v_latest_prices`
-- mediante consulta acotada por `store_id` usando `CROSS JOIN LATERAL` indexado.

CREATE OR REPLACE FUNCTION public.get_store_latest_prices(
    p_store_id TEXT,
    p_limit INT DEFAULT 1000,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    store_sku_id UUID,
    master_product_id UUID,
    normalized_name VARCHAR(255),
    raw_sale_price NUMERIC(14,2),
    calibrated_price NUMERIC(14,2),
    net_content NUMERIC(10,2),
    unit_measure VARCHAR(10),
    pum_price NUMERIC(14,4),
    in_stock BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        ss.id AS store_sku_id,
        ss.master_product_id,
        mp.normalized_name,
        pr.raw_sale_price,
        pr.calibrated_price,
        mp.net_content,
        mp.unit_measure,
        pr.pum_price,
        pr.in_stock
    FROM public.store_skus ss
    LEFT JOIN public.master_products mp ON mp.id = ss.master_product_id
    JOIN LATERAL (
        SELECT
            pr_in.raw_sale_price,
            pr_in.calibrated_price,
            pr_in.pum_price,
            pr_in.in_stock
        FROM public.price_records pr_in
        WHERE pr_in.store_sku_id = ss.id
        ORDER BY pr_in.captured_at DESC, pr_in.id DESC
        LIMIT 1
    ) pr ON TRUE
    WHERE ss.store_id = p_store_id
    ORDER BY ss.id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 2000)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.get_store_latest_prices(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_latest_prices(TEXT, INT, INT) TO service_role;
