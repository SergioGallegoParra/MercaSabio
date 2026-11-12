-- 0008_filter_positive_prices_rpc.sql
-- Filtra registros sin precio activo (calibrated_price = 0 / agotados VTEX) en search_latest_offers
-- y balancea la portada inicial entre productos de canasta canónica y cadenas activas con stock.

DROP FUNCTION IF EXISTS public.search_latest_offers(TEXT, TEXT, INT);

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
    canonical_category_id INT,
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
    positive_votes INT,
    total_votes INT,
    avg_yield_factor NUMERIC(3,2),
    invima_registry VARCHAR(50),
    actual_manufacturer VARCHAR(150),
    shrinkflation_alert BOOLEAN,
    previous_net_content NUMERIC(10,2),
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
        WITH canonical_sample AS (
            SELECT
                ss.id AS store_sku_id,
                ss.store_id,
                s.name AS store_name,
                s.channel_type,
                s.markup_discount_factor,
                mp.id AS master_product_id,
                mp.canonical_category_id,
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
                mp.positive_votes,
                mp.total_votes,
                mp.avg_yield_factor,
                mp.invima_registry,
                mp.actual_manufacturer,
                mp.shrinkflation_alert,
                mp.previous_net_content,
                pr.captured_at
            FROM public.master_products mp
            JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
            JOIN public.store_skus ss ON ss.master_product_id = mp.id
            JOIN public.stores s ON s.id = ss.store_id
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
            WHERE mp.canonical_category_id IS NOT NULL
              AND pr.calibrated_price > 0
              AND pr.in_stock = TRUE
            ORDER BY (ss.store_id = 'carulla') ASC, pr.captured_at DESC
            LIMIT LEAST(140, v_limit)
        ),
        per_store_sample AS (
            SELECT picked.*
            FROM public.stores s
            CROSS JOIN LATERAL (
                SELECT
                    ss.id AS store_sku_id,
                    ss.store_id,
                    s.name AS store_name,
                    s.channel_type,
                    s.markup_discount_factor,
                    mp.id AS master_product_id,
                    mp.canonical_category_id,
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
                    mp.positive_votes,
                    mp.total_votes,
                    mp.avg_yield_factor,
                    mp.invima_registry,
                    mp.actual_manufacturer,
                    mp.shrinkflation_alert,
                    mp.previous_net_content,
                    pr.captured_at
                FROM public.store_skus ss
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
                WHERE ss.store_id = s.id
                  AND ss.master_product_id IS NOT NULL
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                LIMIT 30
            ) picked
        ),
        combined AS (
            SELECT * FROM canonical_sample
            UNION ALL
            SELECT p.*
            FROM per_store_sample p
            WHERE NOT EXISTS (
                SELECT 1
                FROM canonical_sample c
                WHERE c.store_sku_id = p.store_sku_id
            )
        )
        SELECT *
        FROM combined
        ORDER BY (canonical_slug IS NULL) ASC, captured_at DESC
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
        mp.canonical_category_id,
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
        mp.positive_votes,
        mp.total_votes,
        mp.avg_yield_factor,
        mp.invima_registry,
        mp.actual_manufacturer,
        mp.shrinkflation_alert,
        mp.previous_net_content,
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
      AND pr.calibrated_price > 0
      AND (v_category = '' OR cc.slug = v_category)
      AND (
          v_query = ''
          OR mp.ean = v_query
          OR mp.normalized_name ILIKE v_like
          OR ss.raw_name ILIKE v_like
          OR extensions.similarity(mp.normalized_name, lower(v_query)) >= 0.25
      )
    ORDER BY pr.in_stock DESC, (mp.canonical_category_id IS NOT NULL) DESC, pr.captured_at DESC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) TO anon, authenticated, service_role;
