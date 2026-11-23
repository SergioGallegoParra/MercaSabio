-- 0028_price_history_inflation.sql
-- Agregación diaria de precios para calcular inflación personal mensual y plan de contención.

CREATE TABLE IF NOT EXISTS public.product_price_daily (
    master_product_id UUID NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
    store_id VARCHAR(30) NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    min_price NUMERIC(14,2) NOT NULL CHECK (min_price > 0),
    median_price NUMERIC(14,2) NOT NULL CHECK (median_price > 0),
    samples_count INT NOT NULL DEFAULT 1,
    PRIMARY KEY (master_product_id, store_id, day)
);

CREATE INDEX IF NOT EXISTS idx_product_price_daily_day
    ON public.product_price_daily (day DESC, master_product_id);

ALTER TABLE public.product_price_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura pública de precios diarios agregados" ON public.product_price_daily;
CREATE POLICY "Lectura pública de precios diarios agregados"
    ON public.product_price_daily FOR SELECT TO anon, authenticated USING (true);

-- Backfill inicial seguro desde price_records existentes
INSERT INTO public.product_price_daily (master_product_id, store_id, day, min_price, median_price, samples_count)
SELECT
    ss.master_product_id,
    ss.store_id,
    date_trunc('day', pr.captured_at AT TIME ZONE 'America/Bogota')::DATE AS day,
    MIN(pr.calibrated_price)::NUMERIC(14,2) AS min_price,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.calibrated_price))::NUMERIC(14,2) AS median_price,
    COUNT(*)::INT AS samples_count
FROM public.price_records pr
JOIN public.store_skus ss ON ss.id = pr.store_sku_id
WHERE ss.master_product_id IS NOT NULL AND pr.calibrated_price > 0
GROUP BY ss.master_product_id, ss.store_id, date_trunc('day', pr.captured_at AT TIME ZONE 'America/Bogota')::DATE
ON CONFLICT (master_product_id, store_id, day) DO UPDATE
SET min_price = LEAST(public.product_price_daily.min_price, EXCLUDED.min_price),
    median_price = EXCLUDED.median_price,
    samples_count = EXCLUDED.samples_count;

CREATE OR REPLACE FUNCTION public.refresh_product_price_daily(p_days_back INT DEFAULT 3)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_rows INT := 0;
BEGIN
    INSERT INTO public.product_price_daily (master_product_id, store_id, day, min_price, median_price, samples_count)
    SELECT
        ss.master_product_id,
        ss.store_id,
        date_trunc('day', pr.captured_at AT TIME ZONE 'America/Bogota')::DATE AS day,
        MIN(pr.calibrated_price)::NUMERIC(14,2),
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.calibrated_price))::NUMERIC(14,2),
        COUNT(*)::INT
    FROM public.price_records pr
    JOIN public.store_skus ss ON ss.id = pr.store_sku_id
    WHERE ss.master_product_id IS NOT NULL
      AND pr.calibrated_price > 0
      AND pr.captured_at >= (CURRENT_DATE - GREATEST(1, LEAST(90, p_days_back)))
    GROUP BY ss.master_product_id, ss.store_id, date_trunc('day', pr.captured_at AT TIME ZONE 'America/Bogota')::DATE
    ON CONFLICT (master_product_id, store_id, day) DO UPDATE
    SET min_price = EXCLUDED.min_price,
        median_price = EXCLUDED.median_price,
        samples_count = EXCLUDED.samples_count;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_product_price_daily(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_product_price_daily(INT) TO service_role;

-- Calcula precios históricos comparados entre dos fechas (ventana de 7 días para robustez)
CREATE OR REPLACE FUNCTION public.personal_inflation_lookup(
    p_master_ids UUID[],
    p_date_a DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::DATE,
    p_date_b DATE DEFAULT CURRENT_DATE,
    p_store_ids VARCHAR(30)[] DEFAULT NULL
)
RETURNS TABLE (
    master_product_id UUID,
    price_a NUMERIC(14,2),
    price_b NUMERIC(14,2),
    earliest_day DATE,
    latest_day DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
    WITH targets AS (
        SELECT UNNEST(COALESCE(p_master_ids, '{}')) AS mp_id
    ),
    win_a AS (
        SELECT
            d.master_product_id,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY d.daily_min))::NUMERIC(14,2) AS med_price,
            MIN(d.day) AS first_day
        FROM (
            SELECT master_product_id, day, MIN(min_price) AS daily_min
            FROM public.product_price_daily
            WHERE master_product_id = ANY(COALESCE(p_master_ids, '{}'))
              AND day BETWEEN (p_date_a - INTERVAL '6 days')::DATE AND p_date_a
              AND (p_store_ids IS NULL OR cardinality(p_store_ids) = 0 OR store_id = ANY(p_store_ids))
            GROUP BY master_product_id, day
        ) d
        GROUP BY d.master_product_id
    ),
    win_b AS (
        SELECT
            d.master_product_id,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY d.daily_min))::NUMERIC(14,2) AS med_price,
            MAX(d.day) AS last_day
        FROM (
            SELECT master_product_id, day, MIN(min_price) AS daily_min
            FROM public.product_price_daily
            WHERE master_product_id = ANY(COALESCE(p_master_ids, '{}'))
              AND day BETWEEN (p_date_b - INTERVAL '6 days')::DATE AND p_date_b
              AND (p_store_ids IS NULL OR cardinality(p_store_ids) = 0 OR store_id = ANY(p_store_ids))
            GROUP BY master_product_id, day
        ) d
        GROUP BY d.master_product_id
    )
    SELECT
        t.mp_id AS master_product_id,
        wa.med_price AS price_a,
        wb.med_price AS price_b,
        wa.first_day AS earliest_day,
        wb.last_day AS latest_day
    FROM targets t
    LEFT JOIN win_a wa ON wa.master_product_id = t.mp_id
    LEFT JOIN win_b wb ON wb.master_product_id = t.mp_id;
$$;

REVOKE ALL ON FUNCTION public.personal_inflation_lookup(UUID[], DATE, DATE, VARCHAR[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.personal_inflation_lookup(UUID[], DATE, DATE, VARCHAR[]) TO anon, authenticated, service_role;
