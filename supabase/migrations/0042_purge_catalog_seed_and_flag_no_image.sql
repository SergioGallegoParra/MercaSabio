-- 0042_purge_catalog_seed_and_flag_no_image.sql
-- 1) Elimina por completo todos los datos sintéticos cargados con source_origin = 'catalog_seed'
--    (store_skus, price_records y master_products huérfanos sin SKUs reales).
-- 2) Agrega bandera `is_deprecated_candidate` + `deprecated_reason` en `store_skus` para conservar
--    como referencia los productos reales sin imagen de respaldo, ocultándolos al cliente.
-- 3) Actualiza `mv_admin_store_catalog`, `admin_browse_store_catalog` y `search_latest_offers`.

-- Paso 1: Purga segura de catalog_seed
DELETE FROM public.store_skus ss
WHERE EXISTS (
    SELECT 1
    FROM public.price_records pr
    WHERE pr.store_sku_id = ss.id
      AND pr.source_origin = 'catalog_seed'
)
  AND NOT EXISTS (
    SELECT 1
    FROM public.price_records pr2
    WHERE pr2.store_sku_id = ss.id
      AND pr2.source_origin <> 'catalog_seed'
);

DELETE FROM public.price_records
WHERE source_origin = 'catalog_seed';

DELETE FROM public.master_products mp
WHERE NOT EXISTS (
    SELECT 1
    FROM public.store_skus ss
    WHERE ss.master_product_id = mp.id
);

-- Paso 2: Marcado de candidatos a depuración (productos reales sin imagen de referencia)
ALTER TABLE public.store_skus
    ADD COLUMN IF NOT EXISTS is_deprecated_candidate BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS deprecated_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_store_skus_active_client
    ON public.store_skus (store_id, last_verified_at DESC)
    WHERE is_mercado = TRUE AND master_product_id IS NOT NULL AND is_deprecated_candidate = FALSE;

UPDATE public.store_skus ss
SET
    is_deprecated_candidate = TRUE,
    deprecated_reason = 'missing_reference_image'
FROM public.master_products mp
WHERE mp.id = ss.master_product_id
  AND (mp.image_url IS NULL OR btrim(mp.image_url) = '');

-- Paso 3: Recrear vista materializada admin con bandera is_deprecated_candidate
DROP MATERIALIZED VIEW IF EXISTS public.mv_admin_store_catalog;

CREATE MATERIALIZED VIEW public.mv_admin_store_catalog AS
SELECT
    ss.id AS store_sku_id,
    ss.store_id,
    s.name AS store_name,
    ss.external_sku,
    ss.raw_name,
    COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name)::VARCHAR(255) AS display_name,
    ss.raw_url,
    mp.brand,
    mp.ean,
    mp.net_content,
    mp.unit_measure,
    mp.is_private_label,
    mp.image_url,
    cc.slug AS canonical_slug,
    cc.name AS canonical_name,
    COALESCE(ss.product_type, mp.product_type) AS product_type,
    COALESCE(ss.sub_presentation, mp.sub_presentation) AS sub_presentation,
    COALESCE(ss.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
    ss.variant_tags,
    ss.is_deprecated_candidate,
    ss.deprecated_reason,
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
CREATE INDEX idx_mv_admin_cat_store_disp ON public.mv_admin_store_catalog (store_id, display_name);
CREATE INDEX idx_mv_admin_cat_price ON public.mv_admin_store_catalog (calibrated_price);
CREATE INDEX idx_mv_admin_cat_pum ON public.mv_admin_store_catalog (pum_price);
CREATE INDEX idx_mv_admin_cat_slug ON public.mv_admin_store_catalog (canonical_slug);
CREATE INDEX idx_mv_admin_cat_subpres ON public.mv_admin_store_catalog (sub_presentation);
CREATE INDEX idx_mv_admin_cat_name_trgm ON public.mv_admin_store_catalog USING gin (raw_name gin_trgm_ops);
CREATE INDEX idx_mv_admin_cat_disp_trgm ON public.mv_admin_store_catalog USING gin (display_name gin_trgm_ops);

REVOKE ALL ON public.mv_admin_store_catalog FROM PUBLIC, anon, authenticated;

-- Paso 4: Actualizar admin_browse_store_catalog para mostrar candidatos a eliminar
DROP FUNCTION IF EXISTS public.admin_browse_store_catalog(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_browse_store_catalog(
    p_store_id TEXT DEFAULT '',
    p_query TEXT DEFAULT '',
    p_category_slug TEXT DEFAULT '',
    p_stock_filter TEXT DEFAULT 'all',
    p_label_filter TEXT DEFAULT 'all',
    p_sort TEXT DEFAULT 'name_asc',
    p_page INT DEFAULT 1,
    p_page_size INT DEFAULT 40,
    p_sub_presentation TEXT DEFAULT ''
)
RETURNS TABLE (
    store_sku_id UUID,
    store_id VARCHAR(30),
    store_name VARCHAR(100),
    external_sku VARCHAR(100),
    raw_name VARCHAR(255),
    display_name VARCHAR(255),
    raw_url TEXT,
    brand VARCHAR(100),
    ean VARCHAR(20),
    net_content NUMERIC(10,2),
    unit_measure VARCHAR(10),
    is_private_label BOOLEAN,
    image_url TEXT,
    canonical_slug VARCHAR(100),
    canonical_name VARCHAR(150),
    product_type VARCHAR(80),
    sub_presentation VARCHAR(80),
    sub_presentation_label VARCHAR(100),
    variant_tags TEXT[],
    is_deprecated_candidate BOOLEAN,
    deprecated_reason TEXT,
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
    v_subpres TEXT := LOWER(TRIM(COALESCE(p_sub_presentation, '')));
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
            m.display_name::VARCHAR(255) AS display_name,
            m.raw_url,
            m.brand,
            m.ean,
            m.net_content,
            m.unit_measure,
            m.is_private_label,
            m.image_url,
            m.canonical_slug,
            m.canonical_name,
            m.product_type,
            m.sub_presentation,
            m.sub_presentation_label,
            m.variant_tags,
            m.is_deprecated_candidate,
            m.deprecated_reason,
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
              v_subpres = ''
              OR (v_subpres = '__none__' AND m.sub_presentation IS NULL)
              OR LOWER(COALESCE(m.sub_presentation, '')) = v_subpres
          )
          AND (
              v_stock = 'all'
              OR (v_stock = 'in_stock' AND m.in_stock = TRUE)
              OR (v_stock = 'out_of_stock' AND m.in_stock = FALSE)
          )
          AND (
              v_label = 'all'
              OR (v_label IN ('private', 'private_label') AND m.is_private_label = TRUE)
              OR (v_label IN ('commercial', 'national') AND m.is_private_label = FALSE)
              OR (v_label = 'with_ean' AND m.ean IS NOT NULL AND m.ean <> '')
              OR (v_label = 'no_ean' AND (m.ean IS NULL OR m.ean = ''))
              OR (v_label = 'deprecated_candidate' AND m.is_deprecated_candidate = TRUE)
          )
          AND (
              v_query = ''
              OR m.display_name ILIKE '%' || v_query || '%'
              OR m.raw_name ILIKE '%' || v_query || '%'
              OR COALESCE(m.sub_presentation_label, '') ILIKE '%' || v_query || '%'
              OR COALESCE(m.brand, '') ILIKE '%' || v_query || '%'
              OR COALESCE(m.ean, '') ILIKE '%' || v_query || '%'
              OR m.external_sku ILIKE '%' || v_query || '%'
          )
    ),
    counted AS (
        SELECT
            f.*,
            COUNT(*) OVER () AS total_count
        FROM filtered f
    )
    SELECT
        c.store_sku_id,
        c.store_id,
        c.store_name,
        c.external_sku,
        c.raw_name,
        c.display_name,
        c.raw_url,
        c.brand,
        c.ean,
        c.net_content,
        c.unit_measure,
        c.is_private_label,
        c.image_url,
        c.canonical_slug,
        c.canonical_name,
        c.product_type,
        c.sub_presentation,
        c.sub_presentation_label,
        c.variant_tags,
        c.is_deprecated_candidate,
        c.deprecated_reason,
        c.calibrated_price,
        c.raw_list_price,
        c.pum_price,
        c.in_stock,
        c.source_origin,
        c.captured_at,
        c.total_count
    FROM counted c
    ORDER BY
        CASE WHEN v_sort = 'price_asc' THEN c.calibrated_price END ASC NULLS LAST,
        CASE WHEN v_sort = 'price_desc' THEN c.calibrated_price END DESC NULLS LAST,
        CASE WHEN v_sort = 'pum_asc' THEN c.pum_price END ASC NULLS LAST,
        CASE WHEN v_sort = 'name_desc' THEN c.display_name END DESC NULLS LAST,
        CASE WHEN v_sort = 'recent' THEN c.captured_at END DESC NULLS LAST,
        c.display_name ASC,
        c.store_id ASC
    LIMIT v_size
    OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_browse_store_catalog(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_browse_store_catalog(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT) TO anon, authenticated, service_role;

-- Paso 5: Ocultar al cliente productos sin imagen y candidatos a depuración
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
    display_name VARCHAR(255),
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
    product_type VARCHAR(80),
    sub_presentation VARCHAR(80),
    sub_presentation_label VARCHAR(100),
    variant_tags TEXT[],
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
    -- RAMA 1: Carga inicial (solo SKUs reales con imagen, stock y precio > 0)
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
            r.available_cities
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
            'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
            'isimo', 'makro', 'mercaldas', 'olimpica', 'oxxo', 'zapatoca'
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
            ss.available_cities
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
            ss.available_cities
        FROM public.store_skus ss
        WHERE ss.is_mercado = TRUE
          AND ss.master_product_id IS NOT NULL
          AND ss.is_deprecated_candidate = FALSE
          AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
          AND (
              ss.raw_name ILIKE v_like_raw
              OR ss.raw_name ILIKE v_like_stem
              OR (ss.display_name IS NOT NULL AND ss.display_name ILIKE v_like_raw)
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
                ac.available_cities
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
        p.available_cities
    FROM priced p
    ORDER BY p.store_rank ASC, (p.canonical_category_id IS NOT NULL) DESC, p.pum_price ASC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT, TEXT) TO anon, authenticated, service_role;

SELECT public.refresh_catalog_stats_snapshot(0);
ANALYZE public.store_skus;
ANALYZE public.master_products;
ANALYZE public.price_records;
ANALYZE public.mv_admin_store_catalog;
