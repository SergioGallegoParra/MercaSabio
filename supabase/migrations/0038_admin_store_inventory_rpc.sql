-- 0038_admin_store_inventory_rpc.sql
-- Vista materializada indexada + RPCs paginados de alta velocidad para auditar
-- los ~43k productos de las 12 tiendas en /admin (< 50 ms por consulta).

DROP MATERIALIZED VIEW IF EXISTS public.mv_admin_store_catalog;

CREATE MATERIALIZED VIEW public.mv_admin_store_catalog AS
SELECT
    ss.id AS store_sku_id,
    ss.store_id,
    s.name AS store_name,
    ss.external_sku,
    ss.raw_name,
    ss.raw_url,
    mp.brand,
    mp.ean,
    mp.net_content,
    mp.unit_measure,
    mp.is_private_label,
    mp.image_url,
    cc.slug AS canonical_slug,
    cc.name AS canonical_name,
    pr.calibrated_price,
    pr.raw_list_price,
    pr.pum_price,
    pr.in_stock,
    pr.source_origin,
    pr.captured_at,
    ss.last_verified_at
FROM public.store_skus ss
JOIN public.stores s ON s.id = ss.store_id
JOIN public.master_products mp ON mp.id = ss.master_product_id
LEFT JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
JOIN LATERAL (
    SELECT
        pr_inner.calibrated_price,
        pr_inner.raw_list_price,
        pr_inner.pum_price,
        pr_inner.in_stock,
        pr_inner.source_origin,
        pr_inner.captured_at
    FROM public.price_records pr_inner
    WHERE pr_inner.store_sku_id = ss.id
    ORDER BY pr_inner.captured_at DESC, pr_inner.id DESC
    LIMIT 1
) pr ON TRUE
WHERE ss.is_mercado = TRUE
  AND pr.calibrated_price > 0
  AND ss.store_id IN (
      'ara', 'd1', 'olimpica', 'exito', 'carulla',
      'farmatodo', 'euro', 'oxxo', 'mercaldas', 'isimo', 'zapatoca', 'makro'
  );

CREATE UNIQUE INDEX idx_mv_admin_cat_sku ON public.mv_admin_store_catalog (store_sku_id);
CREATE INDEX idx_mv_admin_cat_store_name ON public.mv_admin_store_catalog (store_id, raw_name);
CREATE INDEX idx_mv_admin_cat_price ON public.mv_admin_store_catalog (calibrated_price);
CREATE INDEX idx_mv_admin_cat_pum ON public.mv_admin_store_catalog (pum_price);
CREATE INDEX idx_mv_admin_cat_slug ON public.mv_admin_store_catalog (canonical_slug);
CREATE INDEX idx_mv_admin_cat_name_trgm ON public.mv_admin_store_catalog USING gin (raw_name gin_trgm_ops);

REVOKE ALL ON public.mv_admin_store_catalog FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.admin_store_inventory_summary();

CREATE OR REPLACE FUNCTION public.admin_store_inventory_summary()
RETURNS TABLE (
    store_id VARCHAR(30),
    store_name VARCHAR(100),
    total_skus BIGINT,
    categorized_skus BIGINT,
    uncategorized_skus BIGINT,
    with_ean_skus BIGINT,
    with_image_skus BIGINT,
    private_label_skus BIGINT,
    last_verified_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        s.id AS store_id,
        s.name AS store_name,
        COUNT(m.store_sku_id)::BIGINT AS total_skus,
        COUNT(m.store_sku_id) FILTER (WHERE m.canonical_slug IS NOT NULL)::BIGINT AS categorized_skus,
        COUNT(m.store_sku_id) FILTER (WHERE m.canonical_slug IS NULL)::BIGINT AS uncategorized_skus,
        COUNT(m.store_sku_id) FILTER (WHERE m.ean IS NOT NULL AND m.ean <> '')::BIGINT AS with_ean_skus,
        COUNT(m.store_sku_id) FILTER (WHERE m.image_url IS NOT NULL AND m.image_url <> '')::BIGINT AS with_image_skus,
        COUNT(m.store_sku_id) FILTER (WHERE m.is_private_label = TRUE)::BIGINT AS private_label_skus,
        MAX(m.last_verified_at) AS last_verified_at
    FROM public.stores s
    LEFT JOIN public.mv_admin_store_catalog m ON m.store_id = s.id
    WHERE s.id IN (
        'ara', 'd1', 'olimpica', 'exito', 'carulla',
        'farmatodo', 'euro', 'oxxo', 'mercaldas', 'isimo', 'zapatoca', 'makro'
    )
    GROUP BY s.id, s.name
    ORDER BY COUNT(m.store_sku_id) DESC, s.name ASC;
$$;

REVOKE ALL ON FUNCTION public.admin_store_inventory_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_store_inventory_summary() TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_browse_store_catalog(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.admin_browse_store_catalog(
    p_store_id TEXT DEFAULT '',
    p_query TEXT DEFAULT '',
    p_category_slug TEXT DEFAULT '',
    p_stock_filter TEXT DEFAULT 'all',
    p_label_filter TEXT DEFAULT 'all',
    p_sort TEXT DEFAULT 'name_asc',
    p_page INT DEFAULT 1,
    p_page_size INT DEFAULT 40
)
RETURNS TABLE (
    store_sku_id UUID,
    store_id VARCHAR(30),
    store_name VARCHAR(100),
    external_sku VARCHAR(100),
    raw_name VARCHAR(255),
    raw_url TEXT,
    brand VARCHAR(100),
    ean VARCHAR(20),
    net_content NUMERIC(10,2),
    unit_measure VARCHAR(10),
    is_private_label BOOLEAN,
    image_url TEXT,
    canonical_slug VARCHAR(100),
    canonical_name VARCHAR(150),
    calibrated_price NUMERIC(12,2),
    raw_list_price NUMERIC(12,2),
    pum_price NUMERIC(14,4),
    in_stock BOOLEAN,
    source_origin VARCHAR(30),
    captured_at TIMESTAMPTZ,
    total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_store TEXT := LOWER(TRIM(COALESCE(p_store_id, '')));
    v_query TEXT := TRIM(COALESCE(p_query, ''));
    v_cat TEXT := LOWER(TRIM(COALESCE(p_category_slug, '')));
    v_stock TEXT := LOWER(TRIM(COALESCE(p_stock_filter, 'all')));
    v_label TEXT := LOWER(TRIM(COALESCE(p_label_filter, 'all')));
    v_sort TEXT := LOWER(TRIM(COALESCE(p_sort, 'name_asc')));
    v_page INT := GREATEST(1, COALESCE(p_page, 1));
    v_size INT := LEAST(100, GREATEST(10, COALESCE(p_page_size, 40)));
    v_offset INT := (v_page - 1) * v_size;
BEGIN
    RETURN QUERY
    WITH filtered AS (
        SELECT
            m.store_sku_id,
            m.store_id,
            m.store_name,
            m.external_sku,
            m.raw_name,
            m.raw_url,
            m.brand,
            m.ean,
            m.net_content,
            m.unit_measure,
            m.is_private_label,
            m.image_url,
            m.canonical_slug,
            m.canonical_name,
            m.calibrated_price,
            m.raw_list_price,
            m.pum_price,
            m.in_stock,
            m.source_origin,
            m.captured_at
        FROM public.mv_admin_store_catalog m
        WHERE (v_store = '' OR m.store_id = v_store)
          AND (
              v_cat = ''
              OR (v_cat = '__uncategorized__' AND m.canonical_slug IS NULL)
              OR m.canonical_slug = v_cat
          )
          AND (
              v_stock = 'all'
              OR (v_stock = 'in_stock' AND m.in_stock = TRUE)
              OR (v_stock = 'out_of_stock' AND m.in_stock = FALSE)
          )
          AND (
              v_label = 'all'
              OR (v_label = 'private_label' AND m.is_private_label = TRUE)
              OR (v_label = 'national' AND m.is_private_label = FALSE)
              OR (v_label = 'with_ean' AND m.ean IS NOT NULL AND m.ean <> '')
              OR (v_label = 'no_ean' AND (m.ean IS NULL OR m.ean = ''))
          )
          AND (
              v_query = ''
              OR m.raw_name ILIKE '%' || v_query || '%'
              OR COALESCE(m.brand, '') ILIKE '%' || v_query || '%'
              OR COALESCE(m.ean, '') ILIKE '%' || v_query || '%'
              OR m.external_sku ILIKE '%' || v_query || '%'
              OR COALESCE(m.canonical_name, '') ILIKE '%' || v_query || '%'
          )
    )
    SELECT
        f.*,
        COUNT(*) OVER()::BIGINT AS total_count
    FROM filtered f
    ORDER BY
        CASE WHEN v_sort = 'price_asc' THEN f.calibrated_price END ASC NULLS LAST,
        CASE WHEN v_sort = 'price_desc' THEN f.calibrated_price END DESC NULLS LAST,
        CASE WHEN v_sort = 'pum_asc' THEN f.pum_price END ASC NULLS LAST,
        CASE WHEN v_sort = 'recent' THEN f.captured_at END DESC NULLS LAST,
        f.raw_name ASC,
        f.store_sku_id
    LIMIT v_size OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_browse_store_catalog(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_browse_store_catalog(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) TO anon, authenticated, service_role;
