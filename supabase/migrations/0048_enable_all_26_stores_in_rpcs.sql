-- Habilita las 8 cadenas nuevas en search_latest_offers y refresh_catalog_stats_snapshot

CREATE OR REPLACE FUNCTION public.search_latest_offers(p_query text DEFAULT ''::text, p_category_slug text DEFAULT ''::text, p_limit integer DEFAULT 600, p_city text DEFAULT ''::text)
 RETURNS TABLE(store_sku_id uuid, store_id character varying, store_name character varying, channel_type character varying, markup_discount_factor numeric, master_product_id uuid, canonical_category_id integer, raw_name character varying, display_name character varying, raw_url text, normalized_name character varying, brand character varying, ean character varying, net_content numeric, unit_measure character varying, calibrated_price numeric, raw_list_price numeric, raw_sale_price numeric, pum_price numeric, in_stock boolean, source_origin character varying, is_private_label boolean, image_url text, canonical_slug character varying, canonical_name character varying, product_type character varying, sub_presentation character varying, sub_presentation_label character varying, variant_tags text[], positive_votes integer, total_votes integer, avg_yield_factor numeric, invima_registry character varying, actual_manufacturer character varying, shrinkflation_alert boolean, previous_net_content numeric, captured_at timestamp with time zone, available_cities text[], rappi_promo_price numeric, rappi_savings_cop numeric, rappi_savings_pct numeric, rappi_promo_url text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
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
    v_per_store_seed INT := GREATEST(LEAST(CEIL(v_limit::NUMERIC / 23.0)::INT + 15, 80), 40);
    v_cat_id INT := NULL;
    v_norm TEXT;
    v_stem TEXT;
    v_like_norm TEXT;
    v_like_stem TEXT;
    v_like_raw TEXT;
    v_is_ean BOOLEAN := FALSE;
BEGIN
    -- RAMA 1: Carga inicial (solo SKUs reales con imagen, stock y precio > 0)
    IF v_query = '' AND v_category = '' THEN
        RETURN QUERY
        WITH target_stores AS (
            SELECT s.id, s.name, s.channel_type, s.markup_discount_factor
            FROM public.stores s
            WHERE s.id IN (
                'amy', 'ara', 'belalcazar', 'canaveral', 'carulla', 'd1', 'euro', 'exito',
                'farmatodo', 'isimo', 'jumbo', 'makro', 'megatiendas', 'mercacentro', 'mercaldas',
                'mercamio', 'metro', 'mxm', 'olimpica', 'oxxo', 'superboom', 'supermu', 'zapatoca'
            )
        ),
        per_store_seed AS (
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
                    COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name)::VARCHAR(255) AS display_name,
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
                    COALESCE(ss.product_type, mp.product_type) AS product_type,
                    COALESCE(ss.sub_presentation, mp.sub_presentation) AS sub_presentation,
                    COALESCE(ss.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
                    ss.variant_tags,
                    mp.positive_votes,
                    mp.total_votes,
                    mp.avg_yield_factor,
                    mp.invima_registry,
                    mp.actual_manufacturer,
                    mp.shrinkflation_alert,
                    mp.previous_net_content,
                    pr.captured_at,
                    ss.available_cities,
                    ss.rappi_promo_price,
                    ss.rappi_savings_cop,
                    ss.rappi_savings_pct,
                    ss.rappi_promo_url
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
                  AND ss.is_deprecated_candidate = FALSE
                  AND mp.image_url IS NOT NULL
                  AND btrim(mp.image_url) <> ''
                  AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                  AND pr.source_origin <> 'catalog_seed'
                ORDER BY ss.last_verified_at DESC
                LIMIT v_per_store_seed
            ) picked
        ),
        ranked AS (
            SELECT
                cb.*,
                ROW_NUMBER() OVER (
                    PARTITION BY cb.store_id
                    ORDER BY (cb.canonical_slug IS NULL) ASC, cb.captured_at DESC, cb.store_sku_id
                ) AS store_rank
            FROM per_store_seed cb
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
            r.display_name,
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
            r.product_type,
            r.sub_presentation,
            r.sub_presentation_label,
            r.variant_tags,
            r.positive_votes,
            r.total_votes,
            r.avg_yield_factor,
            r.invima_registry,
            r.actual_manufacturer,
            r.shrinkflation_alert,
            r.previous_net_content,
            r.captured_at,
            r.available_cities,
            r.rappi_promo_price,
            r.rappi_savings_cop,
            r.rappi_savings_pct,
            r.rappi_promo_url
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
                'amy', 'ara', 'belalcazar', 'canaveral', 'carulla', 'd1', 'euro', 'exito',
                'farmatodo', 'isimo', 'jumbo', 'makro', 'megatiendas', 'mercacentro', 'mercaldas',
                'mercamio', 'metro', 'mxm', 'olimpica', 'oxxo', 'superboom', 'supermu', 'zapatoca'
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
                    COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name)::VARCHAR(255) AS display_name,
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
                    COALESCE(ss.product_type, mp.product_type) AS product_type,
                    COALESCE(ss.sub_presentation, mp.sub_presentation) AS sub_presentation,
                    COALESCE(ss.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
                    ss.variant_tags,
                    mp.positive_votes,
                    mp.total_votes,
                    mp.avg_yield_factor,
                    mp.invima_registry,
                    mp.actual_manufacturer,
                    mp.shrinkflation_alert,
                    mp.previous_net_content,
                    pr.captured_at,
                    ss.available_cities,
                    ss.rappi_promo_price,
                    ss.rappi_savings_cop,
                    ss.rappi_savings_pct,
                    ss.rappi_promo_url
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
                  AND ss.is_deprecated_candidate = FALSE
                  AND mp.image_url IS NOT NULL
                  AND btrim(mp.image_url) <> ''
                  AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                  AND pr.source_origin <> 'catalog_seed'
                LIMIT 60
            ) picked
        ),
        ranked AS (
            SELECT
                c.*,
                ROW_NUMBER() OVER (
                    PARTITION BY c.store_id
                    ORDER BY c.pum_price ASC, c.store_sku_id
                ) AS store_rank
            FROM per_store_cat c
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
            r.display_name,
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
            r.product_type,
            r.sub_presentation,
            r.sub_presentation_label,
            r.variant_tags,
            r.positive_votes,
            r.total_votes,
            r.avg_yield_factor,
            r.invima_registry,
            r.actual_manufacturer,
            r.shrinkflation_alert,
            r.previous_net_content,
            r.captured_at,
            r.available_cities,
            r.rappi_promo_price,
            r.rappi_savings_cop,
            r.rappi_savings_pct,
            r.rappi_promo_url
        FROM ranked r
        ORDER BY r.store_rank ASC, r.pum_price ASC
        LIMIT v_limit;
        RETURN;
    END IF;

    -- RAMA 3: Búsqueda por texto
    v_norm := regexp_replace(
        btrim(translate(lower(v_query), 'áéíóúüñàèìòù', 'aeiouunaeiou')),
        '\s+',
        ' ',
        'g'
    );
    v_stem := regexp_replace(v_norm, '(es|s)$', '');
    IF length(v_stem) < 3 THEN
        v_stem := v_norm;
    END IF;
    v_like_norm := '%' || v_norm || '%';
    v_like_stem := '%' || v_stem || '%';
    v_like_raw := '%' || v_query || '%';
    v_is_ean := (v_query ~ '^[0-9]{6,20}$');

    RETURN QUERY
    WITH target_stores AS (
        SELECT s.id, s.name, s.channel_type, s.markup_discount_factor
        FROM public.stores s
        WHERE s.id IN (
                'amy', 'ara', 'belalcazar', 'canaveral', 'carulla', 'd1', 'euro', 'exito',
                'farmatodo', 'isimo', 'jumbo', 'makro', 'megatiendas', 'mercacentro', 'mercaldas',
                'mercamio', 'metro', 'mxm', 'olimpica', 'oxxo', 'superboom', 'supermu', 'zapatoca'
        )
    ),
    matched_masters AS MATERIALIZED (
        SELECT mp.id
        FROM public.master_products mp
        WHERE (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
          AND mp.image_url IS NOT NULL
          AND btrim(mp.image_url) <> ''
          AND (
              (v_is_ean AND mp.ean = v_query)
              OR mp.normalized_name ILIKE v_like_norm
              OR mp.normalized_name ILIKE v_like_stem
          )
        LIMIT 1500
    ),
    all_candidates AS MATERIALIZED (
        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            ss.master_product_id,
            ss.raw_name,
            COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name)::VARCHAR(255) AS display_name,
            ss.raw_url,
            ss.product_type,
            ss.sub_presentation,
            ss.sub_presentation_label,
            ss.variant_tags,
            ss.available_cities,
            ss.rappi_promo_price,
            ss.rappi_savings_cop,
            ss.rappi_savings_pct,
            ss.rappi_promo_url
        FROM matched_masters mm
        JOIN public.store_skus ss ON ss.master_product_id = mm.id
        WHERE ss.is_mercado = TRUE
          AND ss.is_deprecated_candidate = FALSE
          AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])

        UNION

        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            ss.master_product_id,
            ss.raw_name,
            COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name)::VARCHAR(255) AS display_name,
            ss.raw_url,
            ss.product_type,
            ss.sub_presentation,
            ss.sub_presentation_label,
            ss.variant_tags,
            ss.available_cities,
            ss.rappi_promo_price,
            ss.rappi_savings_cop,
            ss.rappi_savings_pct,
            ss.rappi_promo_url
        FROM public.store_skus ss
        WHERE ss.is_mercado = TRUE
          AND ss.master_product_id IS NOT NULL
          AND ss.is_deprecated_candidate = FALSE
          AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
          AND (
              ss.raw_name ILIKE v_like_raw
              OR ss.raw_name ILIKE v_like_stem
          )
        LIMIT 1500
    ),
    per_store_candidates AS (
        SELECT picked.*
        FROM target_stores ts
        CROSS JOIN LATERAL (
            SELECT
                ts.name AS store_name,
                ts.channel_type,
                ts.markup_discount_factor,
                ac.store_sku_id,
                ac.store_id,
                ac.master_product_id,
                ac.raw_name,
                ac.display_name,
                ac.raw_url,
                ac.product_type,
                ac.sub_presentation,
                ac.sub_presentation_label,
                ac.variant_tags,
                ac.available_cities,
                ac.rappi_promo_price,
                ac.rappi_savings_cop,
                ac.rappi_savings_pct,
                ac.rappi_promo_url
            FROM all_candidates ac
            WHERE ac.store_id = ts.id
              AND EXISTS (
                  SELECT 1
                  FROM public.price_records pr_pos
                  WHERE pr_pos.store_sku_id = ac.store_sku_id
                    AND pr_pos.calibrated_price > 0
                    AND pr_pos.in_stock = TRUE
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
            pc.display_name,
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
            COALESCE(pc.product_type, mp.product_type) AS product_type,
            COALESCE(pc.sub_presentation, mp.sub_presentation) AS sub_presentation,
            COALESCE(pc.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
            pc.variant_tags,
            mp.positive_votes,
            mp.total_votes,
            mp.avg_yield_factor,
            mp.invima_registry,
            mp.actual_manufacturer,
            mp.shrinkflation_alert,
            mp.previous_net_content,
            pr.captured_at,
            pc.available_cities,
            pc.rappi_promo_price,
            pc.rappi_savings_cop,
            pc.rappi_savings_pct,
            pc.rappi_promo_url,
            ROW_NUMBER() OVER (
                PARTITION BY pc.store_id
                ORDER BY (mp.canonical_category_id IS NOT NULL) DESC, pr.pum_price ASC, pc.store_sku_id
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
          AND pr.in_stock = TRUE
          AND pr.source_origin <> 'catalog_seed'
          AND mp.image_url IS NOT NULL
          AND btrim(mp.image_url) <> ''
          AND (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
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
        p.display_name,
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
        p.product_type,
        p.sub_presentation,
        p.sub_presentation_label,
        p.variant_tags,
        p.positive_votes,
        p.total_votes,
        p.avg_yield_factor,
        p.invima_registry,
        p.actual_manufacturer,
        p.shrinkflation_alert,
        p.previous_net_content,
        p.captured_at,
        p.available_cities,
        p.rappi_promo_price,
        p.rappi_savings_cop,
        p.rappi_savings_pct,
        p.rappi_promo_url
    FROM priced p
    ORDER BY p.store_rank ASC, (p.canonical_category_id IS NOT NULL) DESC, p.pum_price ASC
    LIMIT v_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_catalog_stats_snapshot(p_min_age_seconds integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_last_refresh TIMESTAMPTZ;
    v_stores INT;
    v_skus INT;
BEGIN
    IF p_min_age_seconds > 0 THEN
        SELECT refreshed_at INTO v_last_refresh
        FROM public.catalog_stats_snapshot
        WHERE id = 1;
        IF v_last_refresh IS NOT NULL
           AND v_last_refresh > NOW() - make_interval(secs => p_min_age_seconds) THEN
            RETURN;
        END IF;
    END IF;

    SELECT
        COALESCE(COUNT(DISTINCT ss.store_id), 0)::INT,
        COALESCE(COUNT(*), 0)::INT
    INTO v_stores, v_skus
    FROM public.store_skus ss
    WHERE ss.is_mercado = TRUE
      AND ss.store_id IN (
          'amy', 'ara', 'belalcazar', 'canaveral', 'carulla', 'd1', 'euro', 'exito',
          'farmatodo', 'isimo', 'jumbo', 'makro', 'megatiendas', 'mercacentro', 'mercaldas',
          'mercamio', 'metro', 'mxm', 'olimpica', 'oxxo', 'rappi', 'superboom', 'supermu', 'zapatoca'
      )
      AND ss.master_product_id IS NOT NULL
      AND EXISTS (
          SELECT 1
          FROM public.price_records pr
          WHERE pr.store_sku_id = ss.id
            AND pr.calibrated_price > 0
      );

    INSERT INTO public.catalog_stats_snapshot (id, stores_count, total_skus, refreshed_at)
    VALUES (1, v_stores, v_skus, NOW())
    ON CONFLICT (id) DO UPDATE
    SET stores_count = EXCLUDED.stores_count,
        total_skus = EXCLUDED.total_skus,
        refreshed_at = EXCLUDED.refreshed_at;
END;
$function$
;

SELECT public.refresh_catalog_stats_snapshot(0);
