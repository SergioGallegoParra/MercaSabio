-- 0037_expand_colombia_cities_and_branches.sql
-- Agrega trazabilidad geoespacial multi-fuente a store_branches y optimiza
-- índices/RPC para cubrir las 32 capitales departamentales de Colombia.

ALTER TABLE public.store_branches
    ADD COLUMN IF NOT EXISTS department VARCHAR(80),
    ADD COLUMN IF NOT EXISTS barrio VARCHAR(100),
    ADD COLUMN IF NOT EXISTS source_provider VARCHAR(40) NOT NULL DEFAULT 'curated',
    ADD COLUMN IF NOT EXISTS external_place_id VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_store_branches_city_store
    ON public.store_branches (city, store_id);

CREATE INDEX IF NOT EXISTS idx_store_branches_source
    ON public.store_branches (source_provider);

DROP FUNCTION IF EXISTS public.get_nearby_stores(DOUBLE PRECISION, DOUBLE PRECISION, INT);

CREATE OR REPLACE FUNCTION public.get_nearby_stores(
    user_lat DOUBLE PRECISION,
    user_lng DOUBLE PRECISION,
    radius_meters INT DEFAULT 5000
)
RETURNS TABLE (
    branch_id UUID,
    store_id VARCHAR,
    branch_name VARCHAR,
    city VARCHAR,
    address TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    distance_meters DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_point extensions.GEOGRAPHY := extensions.ST_SetSRID(
        extensions.ST_MakePoint(user_lng, user_lat),
        4326
    )::extensions.geography;
BEGIN
    RETURN QUERY
    SELECT
        sb.id AS branch_id,
        sb.store_id,
        sb.branch_name,
        sb.city,
        sb.address,
        extensions.ST_Y(sb.location::extensions.geometry) AS lat,
        extensions.ST_X(sb.location::extensions.geometry) AS lng,
        extensions.ST_Distance(sb.location, v_user_point) AS distance_meters
    FROM public.store_branches sb
    WHERE extensions.ST_DWithin(sb.location, v_user_point, radius_meters)
    ORDER BY distance_meters ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_nearby_stores(DOUBLE PRECISION, DOUBLE PRECISION, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nearby_stores(DOUBLE PRECISION, DOUBLE PRECISION, INT) TO anon, authenticated, service_role;
