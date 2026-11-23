-- 0033_fast_search_timeout_fix.sql
-- Elimina statement timeouts (SQLSTATE 57014) en search_latest_offers cuando hay busqueda o categoria:
--   1) Indice trigram parcial exclusivo para SKUs de mercado activos (acelera raw_name ILIKE).
--   2) Separa las rutas de busqueda en mp.normalized_name / mp.ean y ss.raw_name con UNION
--      sin predicados OR entre tablas distintas ni ESCAPE '\', permitiendo uso real de GIN trigram.
--   3) Agrega rama dedicada por canonical_category_id usando idx_master_products_canonical_cat.

CREATE INDEX IF NOT EXISTS idx_store_skus_mercado_raw_trgm
    ON public.store_skus USING gin (raw_name gin_trgm_ops)
    WHERE (is_mercado = TRUE AND master_product_id IS NOT NULL);

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
    v_cat_id INT := NULL;
    v_norm TEXT;
    v_like_norm TEXT;
    v_like_raw TEXT;
    v_is_ean BOOLEAN := FALSE;
BEGIN
    IF v_query = '' AND v_category = '' THEN
        RETURN QUERY
        WITH d1_seed AS (
            SELECT ss.id AS store_sku_id, ss.store_id, ss.master_product_id, ss.raw_name, ss.raw_url
            FROM public.store_skus ss
            WHERE ss.store_id IN ('d1', 'olimpica', 'exito', 'ara', 'rappi')
              AND ss.is_mercado = TRUE
              AND ss.master_product_id IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM public.price_records pr_pos
                  WHERE pr_pos.store_sku_id = ss.id AND pr_pos.calibrated_price > 0
              )
            LIMIT 160
        ),
        canonical_carulla_seed AS (
            SELECT ss.id AS store_sku_id, ss.store_id, ss.master_product_id, ss.raw_name, ss.raw_url
            FROM public.master_products mp
            JOIN public.store_skus ss ON ss.master_product_id = mp.id
            WHERE mp.canonical_category_id IS NOT NULL
              AND ss.store_id = 'carulla'
              AND ss.is_mercado = TRUE
              AND EXISTS (
                  SELECT 1 FROM public.price_records pr_pos
                  WHERE pr_pos.store_sku_id = ss.id AND pr_pos.calibrated_price > 0
              )
            LIMIT 220
        ),
        extra_carulla_seed AS (
            SELECT ss.id AS store_sku_id, ss.store_id, ss.master_product_id, ss.raw_name, ss.raw_url
            FROM public.store_skus ss
            WHERE ss.store_id = 'carulla'
              AND ss.is_mercado = TRUE
              AND ss.master_product_id IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM public.price_records pr_pos
                  WHERE pr_pos.store_sku_id = ss.id AND pr_pos.calibrated_price > 0
              )
            LIMIT 60
        ),
        combined_seed AS (
            SELECT * FROM d1_seed
            UNION
            SELECT * FROM canonical_carulla_seed
            UNION
            SELECT * FROM extra_carulla_seed
        )
        SELECT
            cs.store_sku_id,
            cs.store_id,
            s.name AS store_name,
            s.channel_type,
            s.markup_discount_factor,
            mp.id AS master_product_id,
            mp.canonical_category_id,
            cs.raw_name,
            cs.raw_url,
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
        FROM combined_seed cs
        JOIN public.stores s ON s.id = cs.store_id
        JOIN public.master_products mp ON mp.id = cs.master_product_id
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
            WHERE pr_inner.store_sku_id = cs.store_sku_id
            ORDER BY pr_inner.captured_at DESC, pr_inner.id DESC
            LIMIT 1
        ) pr ON TRUE
        WHERE pr.calibrated_price > 0
          AND pr.in_stock = TRUE
        ORDER BY (cc.slug IS NULL) ASC, (cs.store_id = 'carulla') ASC, pr.captured_at DESC
        LIMIT v_limit;
        RETURN;
    END IF;

    IF v_category <> '' THEN
        SELECT cc.id INTO v_cat_id
        FROM public.canonical_categories cc
        WHERE cc.slug = v_category
        LIMIT 1;
        IF v_cat_id IS NULL THEN
            RETURN;
        END IF;
    END IF;

    IF v_query = '' AND v_cat_id IS NOT NULL THEN
        RETURN QUERY
        WITH cat_non_carulla AS (
            SELECT
                ss.id AS store_sku_id,
                ss.store_id,
                ss.master_product_id,
                ss.raw_name,
                ss.raw_url
            FROM public.master_products mp
            JOIN public.store_skus ss ON ss.master_product_id = mp.id
            WHERE mp.canonical_category_id = v_cat_id
              AND ss.is_mercado = TRUE
              AND ss.store_id IN ('d1', 'olimpica', 'exito', 'ara', 'rappi')
              AND EXISTS (
                  SELECT 1 FROM public.price_records pr_pos
                  WHERE pr_pos.store_sku_id = ss.id AND pr_pos.calibrated_price > 0
              )
            LIMIT 250
        ),
        cat_carulla AS (
            SELECT
                ss.id AS store_sku_id,
                ss.store_id,
                ss.master_product_id,
                ss.raw_name,
                ss.raw_url
            FROM public.master_products mp
            JOIN public.store_skus ss ON ss.master_product_id = mp.id
            WHERE mp.canonical_category_id = v_cat_id
              AND ss.is_mercado = TRUE
              AND ss.store_id = 'carulla'
              AND EXISTS (
                  SELECT 1 FROM public.price_records pr_pos
                  WHERE pr_pos.store_sku_id = ss.id AND pr_pos.calibrated_price > 0
              )
            LIMIT 450
        ),
        matched_skus AS (
            SELECT * FROM cat_non_carulla
            UNION ALL
            SELECT * FROM cat_carulla
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
        WHERE (p.store_id <> 'carulla' AND p.store_rank <= 160)
           OR (p.store_id = 'carulla' AND p.store_rank <= GREATEST(v_limit - 140, 240))
        ORDER BY p.in_stock DESC, (p.store_id <> 'carulla') DESC, (p.canonical_category_id IS NOT NULL) DESC, p.captured_at DESC
        LIMIT v_limit;
        RETURN;
    END IF;

    v_norm := regexp_replace(
        btrim(translate(lower(v_query), 'áéíóúüñàèìòù', 'aeiouunaeiou')),
        '\s+',
        ' ',
        'g'
    );
    v_like_norm := '%' || replace(replace(replace(COALESCE(NULLIF(v_norm, ''), lower(v_query)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_like_raw := '%' || replace(replace(replace(lower(v_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_is_ean := v_query ~ '^[0-9]{6,20}$';

    RETURN QUERY
    WITH mp_hits AS (
        SELECT mp.id
        FROM public.master_products mp
        WHERE mp.normalized_name ILIKE v_like_norm
          AND (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
        UNION
        SELECT mp.id
        FROM public.master_products mp
        WHERE v_is_ean
          AND mp.ean = v_query
          AND (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
    ),
    skus_via_mp AS (
        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            ss.master_product_id,
            ss.raw_name,
            ss.raw_url
        FROM public.store_skus ss
        JOIN mp_hits mh ON mh.id = ss.master_product_id
        WHERE ss.is_mercado = TRUE
          AND ss.store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
    ),
    skus_via_raw AS (
        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            ss.master_product_id,
            ss.raw_name,
            ss.raw_url
        FROM public.store_skus ss
        JOIN public.master_products mp ON mp.id = ss.master_product_id
        WHERE ss.is_mercado = TRUE
          AND ss.master_product_id IS NOT NULL
          AND ss.store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
          AND ss.raw_name ILIKE v_like_raw
          AND (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
    ),
    all_candidates AS (
        SELECT * FROM skus_via_mp
        UNION
        SELECT * FROM skus_via_raw
    ),
    matched_non_carulla AS (
        SELECT ac.*
        FROM all_candidates ac
        WHERE ac.store_id <> 'carulla'
          AND EXISTS (
              SELECT 1
              FROM public.price_records pr_pos
              WHERE pr_pos.store_sku_id = ac.store_sku_id
                AND pr_pos.calibrated_price > 0
          )
        LIMIT 250
    ),
    matched_carulla AS (
        SELECT ac.*
        FROM all_candidates ac
        WHERE ac.store_id = 'carulla'
          AND EXISTS (
              SELECT 1
              FROM public.price_records pr_pos
              WHERE pr_pos.store_sku_id = ac.store_sku_id
                AND pr_pos.calibrated_price > 0
          )
        LIMIT 450
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
    WHERE (p.store_id <> 'carulla' AND p.store_rank <= 160)
       OR (p.store_id = 'carulla' AND p.store_rank <= GREATEST(v_limit - 140, 240))
    ORDER BY p.in_stock DESC, (p.store_id <> 'carulla') DESC, (p.canonical_category_id IS NOT NULL) DESC, p.captured_at DESC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) TO anon, authenticated, service_role;
