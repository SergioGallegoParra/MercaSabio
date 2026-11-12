-- 0004_widen_price_precision.sql
-- Amplía la precisión decimal de price_records para soportar precios y PUM elevados
-- (electrónica, electrodomésticos y referencias de alto valor en COP) sin overflow NUMERIC(10,4).

DROP VIEW IF EXISTS public.v_latest_prices;

ALTER TABLE public.price_records
    ALTER COLUMN raw_list_price TYPE NUMERIC(14,2),
    ALTER COLUMN raw_sale_price TYPE NUMERIC(14,2),
    ALTER COLUMN calibrated_price TYPE NUMERIC(14,2),
    ALTER COLUMN pum_price TYPE NUMERIC(14,4);

CREATE VIEW public.v_latest_prices
WITH (security_invoker = true) AS
SELECT DISTINCT ON (pr.store_sku_id)
    pr.id AS price_record_id,
    pr.store_sku_id,
    ss.store_id,
    ss.master_product_id,
    mp.normalized_name,
    mp.brand,
    mp.net_content,
    mp.unit_measure,
    pr.calibrated_price,
    pr.raw_sale_price,
    pr.pum_price,
    pr.in_stock,
    pr.captured_at,
    pr.raw_list_price,
    pr.source_origin,
    mp.canonical_category_id,
    mp.is_private_label,
    ss.external_sku
FROM public.price_records pr
JOIN public.store_skus ss ON pr.store_sku_id = ss.id
LEFT JOIN public.master_products mp ON ss.master_product_id = mp.id
ORDER BY pr.store_sku_id, pr.captured_at DESC, pr.id DESC;
