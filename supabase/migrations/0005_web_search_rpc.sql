-- 0005_web_search_rpc.sql
-- Índices y funciones RPC de solo lectura (SECURITY INVOKER) para consultar
-- ofertas vigentes y estadísticas desde Cloudflare Workers vía Supabase HTTPS.

CREATE INDEX IF NOT EXISTS idx_price_records_captured_at
    ON public.price_records (captured_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_store_skus_raw_name_trgm
    ON public.store_skus USING gin (raw_name extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_latest_offers(
    p_query TEXT DEFAULT '',
    p_category_slug TEXT DEFAULT '',
    p_limit INT DEFAULT 240
)
RETURNS TABLE (
    store_sku_id UUID,
    store_id VARCHAR(30),
    store_name VARCHAR(100),
    channel_type VARCHAR(30),
    markup_discount_factor NUMERIC(5,4),
    master_product_id UUID,
    raw_name VARCHAR(255),
    raw_url TEXT,
    normalized_name VARCHAR(255),
    brand VARCHAR(100),
    ean VARCHAR(20),
    net_content NUMERIC(10,2),
    unit_measure VARCHAR(10),
    calibrated_price NUMERIC(14,2),
    raw_list_price NUMERIC(14,2),
    raw_sale_price NUMERIC(14,2),
    pum_price NUMERIC(14,4),
    in_stock BOOLEAN,
    source_origin VARCHAR(30),
    is_private_label BOOLEAN,
    image_url TEXT,
    canonical_slug VARCHAR(100),
    canonical_name VARCHAR(150),
    captured_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
    v_query TEXT := COALESCE(btrim(p_query), '');
    v_category TEXT := COALESCE(btrim(p_category_slug), '');
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 240), 1), 500);
    v_like TEXT;
BEGIN
    IF v_query = '' AND v_category = '' THEN
        RETURN QUERY
        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            s.name AS store_name,
            s.channel_type,
            s.markup_discount_factor,
            mp.id AS master_product_id,
            ss.raw_name,
            ss.raw_url,
            mp.normalized_name,
            mp.brand,
            mp.ean,
            mp.net_content,
            mp.unit_measure,
            pr.calibrated_price,
            pr.raw_list_price,
            pr.raw_sale_price,
            pr.pum_price,
            pr.in_stock,
            pr.source_origin,
            mp.is_private_label,
            mp.image_url,
            cc.slug AS canonical_slug,
            cc.name AS canonical_name,
            pr.captured_at
        FROM public.price_records pr
        JOIN public.store_skus ss ON ss.id = pr.store_sku_id
        JOIN public.stores s ON s.id = ss.store_id
        JOIN public.master_products mp ON mp.id = ss.master_product_id
        LEFT JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
        WHERE ss.master_product_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM public.price_records pr_newer
              WHERE pr_newer.store_sku_id = pr.store_sku_id
                AND (
                    pr_newer.captured_at > pr.captured_at
                    OR (pr_newer.captured_at = pr.captured_at AND pr_newer.id > pr.id)
                )
          )
        ORDER BY pr.captured_at DESC, pr.id DESC
        LIMIT v_limit;
        RETURN;
    END IF;

    v_like := '%' || lower(v_query) || '%';

    RETURN QUERY
    SELECT
        ss.id AS store_sku_id,
        ss.store_id,
        s.name AS store_name,
        s.channel_type,
        s.markup_discount_factor,
        mp.id AS master_product_id,
        ss.raw_name,
        ss.raw_url,
        mp.normalized_name,
        mp.brand,
        mp.ean,
        mp.net_content,
        mp.unit_measure,
        pr.calibrated_price,
        pr.raw_list_price,
        pr.raw_sale_price,
        pr.pum_price,
        pr.in_stock,
        pr.source_origin,
        mp.is_private_label,
        mp.image_url,
        cc.slug AS canonical_slug,
        cc.name AS canonical_name,
        pr.captured_at
    FROM public.store_skus ss
    JOIN public.stores s ON s.id = ss.store_id
    JOIN public.master_products mp ON mp.id = ss.master_product_id
    LEFT JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
    JOIN LATERAL (
        SELECT
            pr_inner.calibrated_price,
            pr_inner.raw_list_price,
            pr_inner.raw_sale_price,
            pr_inner.pum_price,
            pr_inner.in_stock,
            pr_inner.source_origin,
            pr_inner.captured_at
        FROM public.price_records pr_inner
        WHERE pr_inner.store_sku_id = ss.id
        ORDER BY pr_inner.captured_at DESC, pr_inner.id DESC
        LIMIT 1
    ) pr ON TRUE
    WHERE ss.master_product_id IS NOT NULL
      AND (v_category = '' OR cc.slug = v_category)
      AND (
          v_query = ''
          OR mp.ean = v_query
          OR mp.normalized_name ILIKE v_like
          OR ss.raw_name ILIKE v_like
          OR extensions.similarity(mp.normalized_name, lower(v_query)) >= 0.25
      )
    ORDER BY pr.captured_at DESC
    LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_catalog_stats()
RETURNS TABLE (
    stores_count INT,
    total_skus INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        COUNT(DISTINCT ss.store_id)::INT AS stores_count,
        COUNT(*)::INT AS total_skus
    FROM public.store_skus ss
    WHERE EXISTS (
        SELECT 1
        FROM public.price_records pr
        WHERE pr.store_sku_id = ss.id
    );
$$;

REVOKE ALL ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_catalog_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_stats() TO anon, authenticated, service_role;
