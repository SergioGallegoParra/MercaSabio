-- 0006_ecosystem_features.sql
-- Funcionalidades del ecosistema inteligente:
-- PostGIS (store_branches + get_nearby_stores), reseñas tipo Steam + rendimiento,
-- guías de ahorro, promociones bancarias CPA y detección de shrinkflation.
-- Nota de numeración: sustituye al borrador 0002_ecosystem_features.sql porque
-- 0002..0005 ya existen en el historial remoto de Supabase.

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- 1. Sucursales físicas por cadena
CREATE TABLE IF NOT EXISTS public.store_branches (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    store_id VARCHAR(30) NOT NULL REFERENCES public.stores(id),
    branch_name VARCHAR(150) NOT NULL,
    city VARCHAR(80) NOT NULL,
    address TEXT,
    location extensions.GEOGRAPHY(Point, 4326) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, branch_name, city)
);

CREATE INDEX IF NOT EXISTS idx_store_branches_geo
    ON public.store_branches USING GIST (location);

-- 2. Ampliación de Productos Maestros (Reseñas tipo Steam, Rendimiento, INVIMA y Shrinkflation)
ALTER TABLE public.master_products
    ADD COLUMN IF NOT EXISTS invima_registry VARCHAR(50),
    ADD COLUMN IF NOT EXISTS actual_manufacturer VARCHAR(150),
    ADD COLUMN IF NOT EXISTS positive_votes INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_votes INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS avg_yield_factor NUMERIC(3,2) NOT NULL DEFAULT 1.00,
    ADD COLUMN IF NOT EXISTS shrinkflation_alert BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS previous_net_content NUMERIC(10,2);

-- 3. Reseñas de Usuarios
CREATE TABLE IF NOT EXISTS public.product_reviews (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    master_product_id UUID NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    is_recommended BOOLEAN NOT NULL,
    yield_factor NUMERIC(3,2) NOT NULL DEFAULT 1.00 CHECK (yield_factor > 0),
    comment TEXT NOT NULL,
    is_verified_purchase BOOLEAN NOT NULL DEFAULT FALSE,
    dian_cufe VARCHAR(120) UNIQUE,
    helpful_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (master_product_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_master
    ON public.product_reviews (master_product_id, created_at DESC);

-- 4. Guías Comunitarias de Ahorro
CREATE TABLE IF NOT EXISTS public.savings_guides (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    slug VARCHAR(220) UNIQUE NOT NULL,
    content_markdown TEXT NOT NULL,
    linked_product_ids UUID[] NOT NULL DEFAULT '{}',
    upvotes INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Promociones Bancarias para Monetización CPA
CREATE TABLE IF NOT EXISTS public.bank_promotions (
    id SERIAL PRIMARY KEY,
    bank_name VARCHAR(80) NOT NULL,
    store_id VARCHAR(30) REFERENCES public.stores(id),
    canonical_category_id INT REFERENCES public.canonical_categories(id),
    discount_pct NUMERIC(4,2) NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 100),
    valid_days INT[] NOT NULL, -- 0=Domingo, 1=Lunes ... 6=Sábado
    affiliate_url TEXT NOT NULL,
    terms_short VARCHAR(255),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (bank_name, store_id, affiliate_url)
);

-- 6. Endurecimiento RLS (consistente con 0003_rls_and_security_hardening.sql)
ALTER TABLE public.store_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura pública de sucursales físicas" ON public.store_branches;
CREATE POLICY "Lectura pública de sucursales físicas"
    ON public.store_branches FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Lectura pública de reseñas de productos" ON public.product_reviews;
CREATE POLICY "Lectura pública de reseñas de productos"
    ON public.product_reviews FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Usuarios crean sus propias reseñas" ON public.product_reviews;
CREATE POLICY "Usuarios crean sus propias reseñas"
    ON public.product_reviews FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuarios editan sus propias reseñas" ON public.product_reviews;
CREATE POLICY "Usuarios editan sus propias reseñas"
    ON public.product_reviews FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuarios eliminan sus propias reseñas" ON public.product_reviews;
CREATE POLICY "Usuarios eliminan sus propias reseñas"
    ON public.product_reviews FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Lectura pública de guías de ahorro" ON public.savings_guides;
CREATE POLICY "Lectura pública de guías de ahorro"
    ON public.savings_guides FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Autores gestionan sus guías de ahorro" ON public.savings_guides;
CREATE POLICY "Autores gestionan sus guías de ahorro"
    ON public.savings_guides FOR ALL TO authenticated
    USING (auth.uid() = author_id)
    WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "Lectura pública de promociones bancarias" ON public.bank_promotions;
CREATE POLICY "Lectura pública de promociones bancarias"
    ON public.bank_promotions FOR SELECT TO anon, authenticated USING (true);

-- 7. Función RPC para encontrar sedes cercanas en un radio dado (metros)
DROP FUNCTION IF EXISTS public.get_nearby_stores(DOUBLE PRECISION, DOUBLE PRECISION, INT);

CREATE OR REPLACE FUNCTION public.get_nearby_stores(
    user_lat DOUBLE PRECISION,
    user_lng DOUBLE PRECISION,
    radius_meters INT DEFAULT 2000
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
    v_user_point extensions.GEOGRAPHY := extensions.ST_SetSRID(extensions.ST_MakePoint(user_lng, user_lat), 4326)::extensions.geography;
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

-- 8. Trigger para actualizar métricas tipo Steam y factor de rendimiento
CREATE OR REPLACE FUNCTION public.update_product_review_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_master_id UUID := COALESCE(NEW.master_product_id, OLD.master_product_id);
BEGIN
    UPDATE public.master_products
    SET
        positive_votes = (
            SELECT COUNT(*)::INT
            FROM public.product_reviews
            WHERE master_product_id = v_master_id AND is_recommended = TRUE
        ),
        total_votes = (
            SELECT COUNT(*)::INT
            FROM public.product_reviews
            WHERE master_product_id = v_master_id
        ),
        avg_yield_factor = (
            SELECT COALESCE(ROUND(AVG(yield_factor)::NUMERIC, 2), 1.00)
            FROM public.product_reviews
            WHERE master_product_id = v_master_id
        )
    WHERE id = v_master_id;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_update_product_stats ON public.product_reviews;
CREATE TRIGGER trg_update_product_stats
AFTER INSERT OR UPDATE OR DELETE ON public.product_reviews
FOR EACH ROW EXECUTE FUNCTION public.update_product_review_stats();

-- 9. Extensión de search_latest_offers para entregar métricas Steam, rendimiento, INVIMA y shrinkflation
DROP FUNCTION IF EXISTS public.search_latest_offers(TEXT, TEXT, INT);

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
    v_query TEXT := COALESCE(btrim(p_query), '');
    v_category TEXT := COALESCE(btrim(p_category_slug), '');
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 240), 1), 500);
    v_like TEXT;
BEGIN
    IF v_query = '' AND v_category = '' THEN
        RETURN QUERY
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
        FROM public.price_records pr
        JOIN public.store_skus ss ON ss.id = pr.store_sku_id
        JOIN public.stores s ON s.id = ss.store_id
        JOIN public.master_products mp ON mp.id = ss.master_product_id
        LEFT JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
        WHERE ss.master_product_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM public.price_records pr_newer
              WHERE pr_newer.store_sku_id = pr.store_sku_id
                AND (
                    pr_newer.captured_at > pr.captured_at
                    OR (pr_newer.captured_at = pr.captured_at AND pr_newer.id > pr.id)
                )
          )
        ORDER BY pr.captured_at DESC, pr.id DESC
        LIMIT v_limit;
        RETURN;
    END IF;

    v_like := '%' || lower(v_query) || '%';

    RETURN QUERY
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
    JOIN public.stores s ON s.id = ss.store_id
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
    WHERE ss.master_product_id IS NOT NULL
      AND (v_category = '' OR cc.slug = v_category)
      AND (
          v_query = ''
          OR mp.ean = v_query
          OR mp.normalized_name ILIKE v_like
          OR ss.raw_name ILIKE v_like
          OR extensions.similarity(mp.normalized_name, lower(v_query)) >= 0.25
      )
    ORDER BY pr.captured_at DESC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) TO anon, authenticated, service_role;

-- 10. Datos iniciales de sucursales y alianzas bancarias para operación inmediata
INSERT INTO public.store_branches (store_id, branch_name, city, address, location)
VALUES
    ('carulla', 'Carulla Calle 85', 'Bogotá', 'Cra. 15 #85-24', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0548, 4.6695), 4326)::extensions.geography),
    ('exito', 'Éxito Chapinero', 'Bogotá', 'Calle 52 #13-70', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0642, 4.6401), 4326)::extensions.geography),
    ('olimpica', 'Olímpica Chapinero', 'Bogotá', 'Cra. 13 #63-45', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0628, 4.6498), 4326)::extensions.geography),
    ('d1', 'D1 Chapinero Alto', 'Bogotá', 'Calle 60 #9-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0615, 4.6462), 4326)::extensions.geography),
    ('ara', 'Ara Calle 57', 'Bogotá', 'Cra. 13 #57-32', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0648, 4.6438), 4326)::extensions.geography),
    ('alkosto', 'Alkosto Carrera 68', 'Bogotá', 'Av. Cra. 68 #72-43', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0846, 4.6774), 4326)::extensions.geography),
    ('ktronix', 'Ktronix Calle 170', 'Bogotá', 'AutoNorte #170-20', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0453, 4.7542), 4326)::extensions.geography),
    ('carulla', 'Carulla Oviedo', 'Medellín', 'Cra. 43A #6S-15', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5735, 6.2006), 4326)::extensions.geography),
    ('exito', 'Éxito El Poblado', 'Medellín', 'Calle 10 #43E-135', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5718, 6.2094), 4326)::extensions.geography),
    ('d1', 'D1 Manila Poblado', 'Medellín', 'Calle 12 #43D-24', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5702, 6.2121), 4326)::extensions.geography),
    ('olimpica', 'Olímpica Envigado', 'Medellín', 'Cra. 43A #30S-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5882, 6.1745), 4326)::extensions.geography)
ON CONFLICT (store_id, branch_name, city) DO NOTHING;

INSERT INTO public.bank_promotions (bank_name, store_id, canonical_category_id, discount_pct, valid_days, affiliate_url, terms_short, active)
VALUES
    ('Tarjeta Éxito', 'exito', NULL, 15.00, ARRAY[1,2,3,4,5,6,0], 'https://www.tarjetaexito.com/?utm_source=mercasabio&utm_medium=affiliate', '15% de descuento pagando con Tarjeta Éxito en referencias seleccionadas', TRUE),
    ('Tarjeta Éxito', 'carulla', NULL, 12.00, ARRAY[1,2,3,4,5,6,0], 'https://www.tarjetaexito.com/carulla?utm_source=mercasabio&utm_medium=affiliate', '12% de descuento diario con Tarjeta Éxito en Carulla', TRUE),
    ('Banco de Bogotá / Aval', 'olimpica', NULL, 10.00, ARRAY[2,4,6,0], 'https://www.bancodebogota.com/tarjetas?utm_source=mercasabio&utm_medium=affiliate', '10% con Tarjeta Silver Olímpica / Aval en días promocionales', TRUE),
    ('Nu Colombia', 'd1', NULL, 5.00, ARRAY[0,1,2,3,4,5,6], 'https://nu.com.co/?utm_source=mercasabio&utm_medium=affiliate', 'Cashback / beneficio digital sugerido con Cajitas y Tarjeta Nu', TRUE),
    ('Lulo Bank', 'alkosto', NULL, 6.00, ARRAY[1,3,5,6], 'https://www.lulobank.com/?utm_source=mercasabio&utm_medium=affiliate', 'Hasta 6% en cashback con Cuenta Lulo Pro', TRUE),
    ('Davivienda', 'ktronix', NULL, 10.00, ARRAY[0,1,2,3,4,5,6], 'https://www.davivienda.com/?utm_source=mercasabio&utm_medium=affiliate', '10% con Tarjetas Davivienda en tecnología seleccionada', TRUE)
ON CONFLICT (bank_name, store_id, affiliate_url) DO NOTHING;
