-- 0034_fast_catalog_stats_snapshot.sql
-- Elimina timeout 57014 en get_catalog_stats() (que tomaba ~6s en Postgres frio)
-- mediante tabla snapshot de 1 fila con RLS de solo lectura y refresco por trigger tras ETL.

CREATE TABLE IF NOT EXISTS public.catalog_stats_snapshot (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    stores_count INT NOT NULL DEFAULT 0,
    total_skus INT NOT NULL DEFAULT 0,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.catalog_stats_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_stats_public_read ON public.catalog_stats_snapshot;
CREATE POLICY catalog_stats_public_read
    ON public.catalog_stats_snapshot
    FOR SELECT
    TO anon, authenticated
    USING (true);

REVOKE ALL ON public.catalog_stats_snapshot FROM PUBLIC;
GRANT SELECT ON public.catalog_stats_snapshot TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_catalog_stats_snapshot(p_min_age_seconds INT DEFAULT 0)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      AND ss.store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
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
$$;

REVOKE ALL ON FUNCTION public.refresh_catalog_stats_snapshot(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_catalog_stats_snapshot(INT) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_refresh_catalog_stats_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.refresh_catalog_stats_snapshot(60);
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_refresh_catalog_stats_snapshot() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_price_records_stats_snapshot ON public.price_records;
CREATE TRIGGER trg_price_records_stats_snapshot
    AFTER INSERT OR UPDATE OR DELETE
    ON public.price_records
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trg_refresh_catalog_stats_snapshot();

-- Poblar snapshot inicial
SELECT public.refresh_catalog_stats_snapshot(0);

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
    SELECT s.stores_count, s.total_skus
    FROM public.catalog_stats_snapshot s
    WHERE s.id = 1;
$$;

REVOKE ALL ON FUNCTION public.get_catalog_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_stats() TO anon, authenticated, service_role;
