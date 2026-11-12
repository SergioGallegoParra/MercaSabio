-- 0003_rls_and_security_hardening.sql
-- Endurecimiento de seguridad en Supabase: RLS, security_invoker, search_path y esquema extensions

-- 1. Habilitar RLS en todas las tablas públicas (solo lectura pública; escritura vía service_role/postgres)
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura pública de tiendas" ON public.stores;
CREATE POLICY "Lectura pública de tiendas"
    ON public.stores FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Lectura pública de categorías canónicas" ON public.canonical_categories;
CREATE POLICY "Lectura pública de categorías canónicas"
    ON public.canonical_categories FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Lectura pública de productos maestros" ON public.master_products;
CREATE POLICY "Lectura pública de productos maestros"
    ON public.master_products FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Lectura pública de SKUs por tienda" ON public.store_skus;
CREATE POLICY "Lectura pública de SKUs por tienda"
    ON public.store_skus FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Lectura pública de historial de precios" ON public.price_records;
CREATE POLICY "Lectura pública de historial de precios"
    ON public.price_records FOR SELECT TO anon, authenticated USING (true);

-- 2. Configurar v_latest_prices con security_invoker = true (respeta permisos/RLS del invocador)
ALTER VIEW public.v_latest_prices SET (security_invoker = true);

-- 3. Mover pg_trgm fuera de public hacia extensions y fijar search_path en RPCs
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.match_master_product_trgm(
    p_target_name TEXT,
    p_net_content NUMERIC,
    p_unit_measure VARCHAR,
    p_threshold REAL DEFAULT 0.65
)
RETURNS TABLE (
    id UUID,
    normalized_name VARCHAR,
    similarity_score REAL
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    SELECT
        mp.id,
        mp.normalized_name,
        extensions.similarity(mp.normalized_name, p_target_name) AS similarity_score
    FROM public.master_products mp
    WHERE mp.net_content = p_net_content
      AND mp.unit_measure = p_unit_measure
      AND extensions.similarity(mp.normalized_name, p_target_name) >= p_threshold
    ORDER BY similarity_score DESC, mp.created_at ASC
    LIMIT 1;
$$;

ALTER FUNCTION public.touch_store_skus_verified(UUID[])
    SET search_path = public;
