-- 0016_fast_search_trgm_and_category_cleanup.sql
-- 1) Acelera búsqueda trigram sobre master_products.normalized_name y lookup de último precio.
-- 2) Limpia asignaciones erróneas de canonical_category_id (antipasto/milo/pastas/galletas).
-- 3) Mejora search_latest_offers para balancear resultados multi-tienda sin timeouts (>3s).

CREATE INDEX IF NOT EXISTS idx_master_products_norm_name_trgm
    ON public.master_products USING gin (normalized_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_price_records_sku_latest
    ON public.price_records (store_sku_id, captured_at DESC, id DESC)
    INCLUDE (calibrated_price, in_stock);

-- Limpieza puntual de categorías canónicas mal asignadas detectadas en auditoría
UPDATE public.master_products mp
SET canonical_category_id = NULL
FROM public.canonical_categories cc
WHERE mp.canonical_category_id = cc.id
  AND (
      (
          cc.slug = 'atun-lata-160g'
          AND public.normalize_mercado_text(mp.normalized_name) ~* '\m(antipasto|aderezo|dip|pate|salsa)\M'
      )
      OR (
          cc.slug IN ('arroz-blanco-1000g', 'lenteja-500g', 'frijol-500g')
          AND public.normalize_mercado_text(mp.normalized_name) ~* '\m(pastas?|tallarin|espagueti|spaghetti|macarron|penne|fusilli|lasagna|lasaña|fideo)\M'
      )
      OR (
          cc.slug = 'azucar-refinada-1000g'
          AND public.normalize_mercado_text(mp.normalized_name) ~* '\m(milo|achocolatada|bebida|gaseosa|aguardiente|wafer|galleta|chocolatina)\M'
      )
  );

CREATE OR REPLACE FUNCTION public.search_latest_offers(
    p_query TEXT DEFAULT '',
    p_category_slug TEXT DEFAULT '',
    p_limit INT DEFAULT 360
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
    v_query TEXT := left(COALESCE(btrim(p_query), ''), 80);
    v_category TEXT := left(COALESCE(btrim(p_category_slug), ''), 60);
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 360), 1), 600);
    v_like TEXT;
BEGIN
    IF v_query = '' AND v_category = '' THEN
        RETURN QUERY
        WITH per_store_canonical AS (
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
                  AND ss.is_mercado = TRUE
                  AND ss.master_product_id IS NOT NULL
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                ORDER BY (mp.canonical_category_id IS NOT NULL) DESC, pr.captured_at DESC
                LIMIT CASE WHEN s.id = 'carulla' THEN LEAST(200, v_limit) ELSE 140 END
            ) picked
            WHERE s.id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
        )
        SELECT ps.*
        FROM per_store_canonical ps
        ORDER BY (ps.canonical_slug IS NULL) ASC, (ps.store_id = 'carulla') ASC, ps.captured_at DESC
        LIMIT v_limit;
        RETURN;
    END IF;

    v_like := '%' || regexp_replace(lower(v_query), '([%_\\])', '\\\1', 'g') || '%';

    RETURN QUERY
    WITH matched_non_carulla AS (
        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            ss.master_product_id,
            ss.raw_name,
            ss.raw_url,
            ss.last_verified_at
        FROM public.store_skus ss
        JOIN public.master_products mp ON mp.id = ss.master_product_id
        LEFT JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
        WHERE ss.is_mercado = TRUE
          AND ss.store_id IN ('d1', 'olimpica', 'exito', 'ara', 'rappi')
          AND ss.master_product_id IS NOT NULL
          AND (v_category = '' OR cc.slug = v_category)
          AND (
              v_query = ''
              OR mp.ean = v_query
              OR mp.normalized_name ILIKE v_like ESCAPE '\'
              OR ss.raw_name ILIKE v_like ESCAPE '\'
          )
        LIMIT 400
    ),
    matched_carulla AS (
        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            ss.master_product_id,
            ss.raw_name,
            ss.raw_url,
            ss.last_verified_at
        FROM public.store_skus ss
        JOIN public.master_products mp ON mp.id = ss.master_product_id
        LEFT JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
        WHERE ss.is_mercado = TRUE
          AND ss.store_id = 'carulla'
          AND ss.master_product_id IS NOT NULL
          AND (v_category = '' OR cc.slug = v_category)
          AND (
              v_query = ''
              OR mp.ean = v_query
              OR mp.normalized_name ILIKE v_like ESCAPE '\'
              OR ss.raw_name ILIKE v_like ESCAPE '\'
          )
        LIMIT 1200
    ),
    matched_skus AS (
        SELECT * FROM matched_non_carulla
        UNION ALL
        SELECT * FROM matched_carulla
    ),
    priced AS (
        SELECT
            ms.store_sku_id,
            ms.store_id,
            s.name AS store_name,
            s.channel_type,
            s.markup_discount_factor,
            mp.id AS master_product_id,
            mp.canonical_category_id,
            ms.raw_name,
            ms.raw_url,
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
            pr.captured_at,
            ROW_NUMBER() OVER (
                PARTITION BY ms.store_id
                ORDER BY pr.in_stock DESC, (mp.canonical_category_id IS NOT NULL) DESC, pr.captured_at DESC
            ) AS store_rank
        FROM matched_skus ms
        JOIN public.stores s ON s.id = ms.store_id
        JOIN public.master_products mp ON mp.id = ms.master_product_id
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
            WHERE pr_inner.store_sku_id = ms.store_sku_id
            ORDER BY pr_inner.captured_at DESC, pr_inner.id DESC
            LIMIT 1
        ) pr ON TRUE
        WHERE pr.calibrated_price > 0
    )
    SELECT
        p.store_sku_id,
        p.store_id,
        p.store_name,
        p.channel_type,
        p.markup_discount_factor,
        p.master_product_id,
        p.canonical_category_id,
        p.raw_name,
        p.raw_url,
        p.normalized_name,
        p.brand,
        p.ean,
        p.net_content,
        p.unit_measure,
        p.calibrated_price,
        p.raw_list_price,
        p.raw_sale_price,
        p.pum_price,
        p.in_stock,
        p.source_origin,
        p.is_private_label,
        p.image_url,
        p.canonical_slug,
        p.canonical_name,
        p.positive_votes,
        p.total_votes,
        p.avg_yield_factor,
        p.invima_registry,
        p.actual_manufacturer,
        p.shrinkflation_alert,
        p.previous_net_content,
        p.captured_at
    FROM priced p
    WHERE (p.store_id <> 'carulla' AND p.store_rank <= 140)
       OR (p.store_id = 'carulla' AND p.store_rank <= GREATEST(v_limit - 120, 220))
    ORDER BY p.in_stock DESC, (p.store_id <> 'carulla') DESC, (p.canonical_category_id IS NOT NULL) DESC, p.captured_at DESC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) TO anon, authenticated, service_role;
