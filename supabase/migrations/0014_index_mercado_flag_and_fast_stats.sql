-- 0014_index_mercado_flag_and_fast_stats.sql
-- Precalcula e indexa store_skus.is_mercado y precios positivos para que get_catalog_stats()
-- y search_latest_offers() respondan en milisegundos sin exceder el statement_timeout de Supabase (3s).

CREATE INDEX IF NOT EXISTS idx_price_records_positive_sku
    ON public.price_records (store_sku_id)
    WHERE calibrated_price > 0;

ALTER TABLE public.store_skus
    ADD COLUMN IF NOT EXISTS is_mercado BOOLEAN NOT NULL DEFAULT TRUE;

-- Tiendas que no son de mercado quedan marcadas en FALSE inmediatamente.
UPDATE public.store_skus
SET is_mercado = FALSE
WHERE store_id NOT IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
  AND is_mercado = TRUE;

-- Productos no-mercado dentro de supermercados mixtos (Olímpica, Carulla, D1, etc.).
UPDATE public.store_skus ss
SET is_mercado = public.is_mercado_product(
    ss.store_id,
    COALESCE(ss.raw_name, mp.normalized_name),
    mp.brand,
    ss.raw_url
)
FROM public.master_products mp
WHERE ss.master_product_id = mp.id
  AND ss.store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi');

UPDATE public.store_skus ss
SET is_mercado = public.is_mercado_product(
    ss.store_id,
    ss.raw_name,
    NULL,
    ss.raw_url
)
WHERE ss.master_product_id IS NULL
  AND ss.store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi');

CREATE INDEX IF NOT EXISTS idx_store_skus_mercado_active
    ON public.store_skus (store_id, master_product_id)
    WHERE is_mercado = TRUE
      AND store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
      AND master_product_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_store_sku_is_mercado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_brand TEXT;
    v_norm_name TEXT;
BEGIN
    IF NEW.master_product_id IS NOT NULL THEN
        SELECT mp.brand, mp.normalized_name
        INTO v_brand, v_norm_name
        FROM public.master_products mp
        WHERE mp.id = NEW.master_product_id;
    END IF;

    NEW.is_mercado := public.is_mercado_product(
        NEW.store_id,
        COALESCE(NEW.raw_name, v_norm_name),
        v_brand,
        NEW.raw_url
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_skus_sync_is_mercado ON public.store_skus;
CREATE TRIGGER trg_store_skus_sync_is_mercado
    BEFORE INSERT OR UPDATE OF store_id, raw_name, raw_url, master_product_id
    ON public.store_skus
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_store_sku_is_mercado();

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
    v_query TEXT := left(COALESCE(btrim(p_query), ''), 80);
    v_category TEXT := left(COALESCE(btrim(p_category_slug), ''), 60);
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
              AND ss.is_mercado = TRUE
              AND ss.store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
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
                  AND ss.is_mercado = TRUE
                  AND ss.master_product_id IS NOT NULL
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                LIMIT 40
            ) picked
            WHERE s.id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
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
        SELECT cb.*
        FROM combined cb
        ORDER BY (cb.canonical_slug IS NULL) ASC, cb.captured_at DESC
        LIMIT v_limit;
        RETURN;
    END IF;

    v_like := '%' || regexp_replace(lower(v_query), '([%_\\])', '\\\1', 'g') || '%';

    RETURN QUERY
    WITH candidate_skus AS (
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
            mp.previous_net_content
        FROM public.store_skus ss
        JOIN public.stores s ON s.id = ss.store_id
        JOIN public.master_products mp ON mp.id = ss.master_product_id
        LEFT JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
        WHERE ss.is_mercado = TRUE
          AND ss.store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
          AND ss.master_product_id IS NOT NULL
          AND (v_category = '' OR cc.slug = v_category)
          AND (
              v_query = ''
              OR mp.ean = v_query
              OR mp.normalized_name ILIKE v_like ESCAPE '\'
              OR ss.raw_name ILIKE v_like ESCAPE '\'
          )
          AND EXISTS (
              SELECT 1
              FROM public.price_records pr_pos
              WHERE pr_pos.store_sku_id = ss.id
                AND pr_pos.calibrated_price > 0
          )
        ORDER BY (ss.store_id <> 'carulla') DESC, (mp.canonical_category_id IS NOT NULL) DESC, ss.last_verified_at DESC
        LIMIT LEAST(v_limit * 5, 1200)
    )
    SELECT
        cs.store_sku_id,
        cs.store_id,
        cs.store_name,
        cs.channel_type,
        cs.markup_discount_factor,
        cs.master_product_id,
        cs.canonical_category_id,
        cs.raw_name,
        cs.raw_url,
        cs.normalized_name,
        cs.brand,
        cs.ean,
        cs.net_content,
        cs.unit_measure,
        pr.calibrated_price,
        pr.raw_list_price,
        pr.raw_sale_price,
        pr.pum_price,
        pr.in_stock,
        pr.source_origin,
        cs.is_private_label,
        cs.image_url,
        cs.canonical_slug,
        cs.canonical_name,
        cs.positive_votes,
        cs.total_votes,
        cs.avg_yield_factor,
        cs.invima_registry,
        cs.actual_manufacturer,
        cs.shrinkflation_alert,
        cs.previous_net_content,
        pr.captured_at
    FROM candidate_skus cs
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
    ORDER BY pr.in_stock DESC, (cs.canonical_category_id IS NOT NULL) DESC, pr.captured_at DESC
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
    WHERE ss.is_mercado = TRUE
      AND ss.store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
      AND ss.master_product_id IS NOT NULL
      AND EXISTS (
          SELECT 1
          FROM public.price_records pr
          WHERE pr.store_sku_id = ss.id
            AND pr.calibrated_price > 0
      );
$$;

REVOKE ALL ON FUNCTION public.sync_store_sku_is_mercado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_store_sku_is_mercado() TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_catalog_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_stats() TO anon, authenticated, service_role;
