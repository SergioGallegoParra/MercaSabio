-- 0039_sku_city_availability.sql
-- Agrega disponibilidad regional por ciudad en store_skus (`available_cities TEXT[]`)
-- con índice GIN y actualiza search_latest_offers() para filtrar SKUs por ciudad.

ALTER TABLE public.store_skus
    ADD COLUMN IF NOT EXISTS available_cities TEXT[] DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_store_skus_available_cities
    ON public.store_skus USING gin (available_cities);

DROP FUNCTION IF EXISTS public.search_latest_offers(TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.search_latest_offers(TEXT, TEXT, INT, TEXT);

CREATE OR REPLACE FUNCTION public.search_latest_offers(
    p_query TEXT DEFAULT '',
    p_category_slug TEXT DEFAULT '',
    p_limit INT DEFAULT 600,
    p_city TEXT DEFAULT ''
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
    captured_at TIMESTAMPTZ,
    available_cities TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
    v_query TEXT := left(COALESCE(btrim(p_query), ''), 80);
    v_category TEXT := left(COALESCE(btrim(p_category_slug), ''), 60);
    v_city TEXT := regexp_replace(
        btrim(translate(lower(left(COALESCE(p_city, ''), 80)), 'áéíóúüñàèìòù', 'aeiouunaeiou')),
        '\s+',
        ' ',
        'g'
    );
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 600), 1), 1200);
    v_per_store_seed INT := GREATEST(LEAST(CEIL(v_limit::NUMERIC / 12.0)::INT + 15, 80), 40);
    v_cat_id INT := NULL;
    v_norm TEXT;
    v_stem TEXT;
    v_like_norm TEXT;
    v_like_stem TEXT;
    v_like_raw TEXT;
    v_is_ean BOOLEAN := FALSE;
BEGIN
    -- RAMA 1: Carga inicial sin filtro (muestra balanceada e intercalada de los 12 supermercados)
    IF v_query = '' AND v_category = '' THEN
        RETURN QUERY
        WITH target_stores AS (
            SELECT s.id, s.name, s.channel_type, s.markup_discount_factor
            FROM public.stores s
            WHERE s.id IN (
                'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
                'isimo', 'makro', 'mercaldas', 'olimpica', 'oxxo', 'zapatoca'
            )
        ),
        per_store_canonical AS (
            SELECT picked.*
            FROM target_stores ts
            CROSS JOIN LATERAL (
                SELECT
                    ss.id AS store_sku_id,
                    ss.store_id,
                    ts.name AS store_name,
                    ts.channel_type,
                    ts.markup_discount_factor,
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
                    pr.captured_at,
                    ss.available_cities
                FROM public.store_skus ss
                JOIN public.master_products mp ON mp.id = ss.master_product_id
                JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
                JOIN LATERAL (
                    SELECT
                        pr_in.calibrated_price,
                        pr_in.raw_list_price,
                        pr_in.raw_sale_price,
                        pr_in.pum_price,
                        pr_in.in_stock,
                        pr_in.source_origin,
                        pr_in.captured_at
                    FROM public.price_records pr_in
                    WHERE pr_in.store_sku_id = ss.id
                    ORDER BY pr_in.captured_at DESC, pr_in.id DESC
                    LIMIT 1
                ) pr ON TRUE
                WHERE ss.store_id = ts.id
                  AND ss.is_mercado = TRUE
                  AND ss.master_product_id IS NOT NULL
                  AND mp.canonical_category_id IS NOT NULL
                  AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                LIMIT v_per_store_seed
            ) picked
        ),
        per_store_extra AS (
            SELECT picked.*
            FROM target_stores ts
            CROSS JOIN LATERAL (
                SELECT
                    ss.id AS store_sku_id,
                    ss.store_id,
                    ts.name AS store_name,
                    ts.channel_type,
                    ts.markup_discount_factor,
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
                    pr.captured_at,
                    ss.available_cities
                FROM public.store_skus ss
                JOIN public.master_products mp ON mp.id = ss.master_product_id
                LEFT JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
                JOIN LATERAL (
                    SELECT
                        pr_in.calibrated_price,
                        pr_in.raw_list_price,
                        pr_in.raw_sale_price,
                        pr_in.pum_price,
                        pr_in.in_stock,
                        pr_in.source_origin,
                        pr_in.captured_at
                    FROM public.price_records pr_in
                    WHERE pr_in.store_sku_id = ss.id
                    ORDER BY pr_in.captured_at DESC, pr_in.id DESC
                    LIMIT 1
                ) pr ON TRUE
                WHERE ss.store_id = ts.id
                  AND ss.is_mercado = TRUE
                  AND ss.master_product_id IS NOT NULL
                  AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                LIMIT 35
            ) picked
        ),
        combined AS (
            SELECT * FROM per_store_canonical
            UNION ALL
            SELECT e.*
            FROM per_store_extra e
            WHERE NOT EXISTS (
                SELECT 1 FROM per_store_canonical c WHERE c.store_sku_id = e.store_sku_id
            )
        ),
        ranked AS (
            SELECT
                cb.*,
                ROW_NUMBER() OVER (
                    PARTITION BY cb.store_id
                    ORDER BY (cb.canonical_slug IS NULL) ASC, cb.captured_at DESC, cb.store_sku_id
                ) AS store_rank
            FROM combined cb
        )
        SELECT
            r.store_sku_id,
            r.store_id,
            r.store_name,
            r.channel_type,
            r.markup_discount_factor,
            r.master_product_id,
            r.canonical_category_id,
            r.raw_name,
            r.raw_url,
            r.normalized_name,
            r.brand,
            r.ean,
            r.net_content,
            r.unit_measure,
            r.calibrated_price,
            r.raw_list_price,
            r.raw_sale_price,
            r.pum_price,
            r.in_stock,
            r.source_origin,
            r.is_private_label,
            r.image_url,
            r.canonical_slug,
            r.canonical_name,
            r.positive_votes,
            r.total_votes,
            r.avg_yield_factor,
            r.invima_registry,
            r.actual_manufacturer,
            r.shrinkflation_alert,
            r.previous_net_content,
            r.captured_at,
            r.available_cities
        FROM ranked r
        ORDER BY r.store_rank ASC, (r.canonical_slug IS NULL) ASC, r.store_id ASC
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

    -- RAMA 2: Filtro exclusivo por categoría canónica
    IF v_query = '' AND v_cat_id IS NOT NULL THEN
        RETURN QUERY
        WITH target_stores AS (
            SELECT s.id, s.name, s.channel_type, s.markup_discount_factor
            FROM public.stores s
            WHERE s.id IN (
                'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
                'isimo', 'makro', 'mercaldas', 'olimpica', 'oxxo', 'zapatoca'
            )
        ),
        per_store_cat AS (
            SELECT picked.*
            FROM target_stores ts
            CROSS JOIN LATERAL (
                SELECT
                    ss.id AS store_sku_id,
                    ss.store_id,
                    ts.name AS store_name,
                    ts.channel_type,
                    ts.markup_discount_factor,
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
                    pr.captured_at,
                    ss.available_cities
                FROM public.master_products mp
                JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
                JOIN public.store_skus ss ON ss.master_product_id = mp.id
                JOIN LATERAL (
                    SELECT
                        pr_in.calibrated_price,
                        pr_in.raw_list_price,
                        pr_in.raw_sale_price,
                        pr_in.pum_price,
                        pr_in.in_stock,
                        pr_in.source_origin,
                        pr_in.captured_at
                    FROM public.price_records pr_in
                    WHERE pr_in.store_sku_id = ss.id
                    ORDER BY pr_in.captured_at DESC, pr_in.id DESC
                    LIMIT 1
                ) pr ON TRUE
                WHERE mp.canonical_category_id = v_cat_id
                  AND ss.store_id = ts.id
                  AND ss.is_mercado = TRUE
                  AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
                  AND pr.calibrated_price > 0
                LIMIT 60
            ) picked
        ),
        ranked AS (
            SELECT
                p.*,
                ROW_NUMBER() OVER (
                    PARTITION BY p.store_id
                    ORDER BY p.in_stock DESC, p.pum_price ASC, p.store_sku_id
                ) AS store_rank
            FROM per_store_cat p
        )
        SELECT
            r.store_sku_id,
            r.store_id,
            r.store_name,
            r.channel_type,
            r.markup_discount_factor,
            r.master_product_id,
            r.canonical_category_id,
            r.raw_name,
            r.raw_url,
            r.normalized_name,
            r.brand,
            r.ean,
            r.net_content,
            r.unit_measure,
            r.calibrated_price,
            r.raw_list_price,
            r.raw_sale_price,
            r.pum_price,
            r.in_stock,
            r.source_origin,
            r.is_private_label,
            r.image_url,
            r.canonical_slug,
            r.canonical_name,
            r.positive_votes,
            r.total_votes,
            r.avg_yield_factor,
            r.invima_registry,
            r.actual_manufacturer,
            r.shrinkflation_alert,
            r.previous_net_content,
            r.captured_at,
            r.available_cities
        FROM ranked r
        ORDER BY r.in_stock DESC, r.store_rank ASC, r.pum_price ASC
        LIMIT v_limit;
        RETURN;
    END IF;

    -- RAMA 3: Búsqueda textual / EAN con filtro de ciudad opcional e intercalado equitativo
    v_norm := regexp_replace(
        btrim(translate(lower(v_query), 'áéíóúüñàèìòù', 'aeiouunaeiou')),
        '\s+',
        ' ',
        'g'
    );
    v_stem := array_to_string(
        ARRAY(
            SELECT CASE
                WHEN length(w) >= 5 AND w ~ '(l|n|r|d|j|z)es$' THEN regexp_replace(w, 'es$', '')
                WHEN length(w) >= 5 AND w ~ '[aeiou]s$' THEN regexp_replace(w, 's$', '')
                ELSE w
            END
            FROM unnest(string_to_array(v_norm, ' ')) AS w
        ),
        ' '
    );
    v_like_norm := '%' || replace(replace(replace(COALESCE(NULLIF(v_norm, ''), lower(v_query)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_like_stem := '%' || replace(replace(replace(COALESCE(NULLIF(v_stem, ''), COALESCE(NULLIF(v_norm, ''), lower(v_query))), '\', '\\'), '%', '\%'), '_', '\_') || '%';
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
        WHERE v_stem <> v_norm
          AND mp.normalized_name ILIKE v_like_stem
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
            ss.raw_url,
            ss.available_cities
        FROM public.store_skus ss
        JOIN mp_hits mh ON mh.id = ss.master_product_id
        WHERE ss.is_mercado = TRUE
          AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
          AND ss.store_id IN (
              'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
              'isimo', 'makro', 'mercaldas', 'olimpica', 'oxxo', 'zapatoca', 'rappi'
          )
    ),
    skus_via_raw AS (
        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            ss.master_product_id,
            ss.raw_name,
            ss.raw_url,
            ss.available_cities
        FROM public.store_skus ss
        JOIN public.master_products mp ON mp.id = ss.master_product_id
        WHERE ss.is_mercado = TRUE
          AND ss.master_product_id IS NOT NULL
          AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
          AND ss.store_id IN (
              'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
              'isimo', 'makro', 'mercaldas', 'olimpica', 'oxxo', 'zapatoca', 'rappi'
          )
          AND (
              ss.raw_name ILIKE v_like_raw
              OR (v_stem <> v_norm AND ss.raw_name ILIKE v_like_stem)
          )
          AND (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
    ),
    all_candidates AS (
        SELECT * FROM skus_via_mp
        UNION
        SELECT * FROM skus_via_raw
    ),
    target_stores AS (
        SELECT s.id, s.name, s.channel_type, s.markup_discount_factor
        FROM public.stores s
        WHERE s.id IN (
            'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
            'isimo', 'makro', 'mercaldas', 'olimpica', 'oxxo', 'zapatoca', 'rappi'
        )
    ),
    per_store_candidates AS (
        SELECT picked.*, ts.name AS store_name, ts.channel_type, ts.markup_discount_factor
        FROM target_stores ts
        CROSS JOIN LATERAL (
            SELECT
                ac.store_sku_id,
                ac.store_id,
                ac.master_product_id,
                ac.raw_name,
                ac.raw_url,
                ac.available_cities
            FROM all_candidates ac
            WHERE ac.store_id = ts.id
              AND EXISTS (
                  SELECT 1
                  FROM public.price_records pr_pos
                  WHERE pr_pos.store_sku_id = ac.store_sku_id
                    AND pr_pos.calibrated_price > 0
              )
            LIMIT 60
        ) picked
    ),
    priced AS (
        SELECT
            pc.store_sku_id,
            pc.store_id,
            pc.store_name,
            pc.channel_type,
            pc.markup_discount_factor,
            mp.id AS master_product_id,
            mp.canonical_category_id,
            pc.raw_name,
            pc.raw_url,
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
            pc.available_cities,
            ROW_NUMBER() OVER (
                PARTITION BY pc.store_id
                ORDER BY pr.in_stock DESC, (mp.canonical_category_id IS NOT NULL) DESC, pr.pum_price ASC, pc.store_sku_id
            ) AS store_rank
        FROM per_store_candidates pc
        JOIN public.master_products mp ON mp.id = pc.master_product_id
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
            WHERE pr_inner.store_sku_id = pc.store_sku_id
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
        p.captured_at,
        p.available_cities
    FROM priced p
    ORDER BY p.in_stock DESC, p.store_rank ASC, (p.canonical_category_id IS NOT NULL) DESC, p.pum_price ASC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT, TEXT) TO anon, authenticated, service_role;
