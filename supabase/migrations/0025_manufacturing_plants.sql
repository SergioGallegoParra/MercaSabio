-- 0025_manufacturing_plants.sql
-- Esquema para plantas de fabricación y registros INVIMA ("Misma planta").
-- Estado: CREADO pero PENDIENTE DE POBLAR en producción (hoy 0 registros INVIMA cargados).

CREATE TABLE IF NOT EXISTS public.manufacturers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name VARCHAR(200) NOT NULL,
    nit VARCHAR(20) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.manufacturing_plants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_id UUID REFERENCES public.manufacturers(id) ON DELETE CASCADE,
    plant_name VARCHAR(200) NOT NULL,
    city VARCHAR(80),
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_manufacturing (
    master_product_id UUID PRIMARY KEY REFERENCES public.master_products(id) ON DELETE CASCADE,
    manufacturer_id UUID REFERENCES public.manufacturers(id) ON DELETE SET NULL,
    plant_id UUID REFERENCES public.manufacturing_plants(id) ON DELETE SET NULL,
    invima_registry VARCHAR(60),
    evidence_type VARCHAR(30) NOT NULL CHECK (evidence_type IN ('invima_registry', 'label_photo', 'official_statement', 'community')),
    evidence_url TEXT,
    confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence BETWEEN 0 AND 1),
    verified_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_manufacturing_plant
    ON public.product_manufacturing (plant_id)
    WHERE plant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_manufacturing_invima
    ON public.product_manufacturing (invima_registry)
    WHERE invima_registry IS NOT NULL;

CREATE OR REPLACE VIEW public.v_same_plant_pairs
WITH (security_invoker = true) AS
SELECT
    a.master_product_id AS product_a,
    b.master_product_id AS product_b,
    CASE
        WHEN a.invima_registry IS NOT NULL AND a.invima_registry = b.invima_registry THEN 'same_registry'
        WHEN a.plant_id IS NOT NULL AND a.plant_id = b.plant_id THEN 'same_plant'
        ELSE 'same_manufacturer'
    END AS match_level,
    LEAST(a.confidence, b.confidence) AS confidence,
    (a.verified_by_admin AND b.verified_by_admin) AS verified_by_admin,
    COALESCE(a.invima_registry, b.invima_registry) AS shared_invima_registry,
    m.legal_name AS manufacturer_name,
    mp.plant_name,
    mp.city AS plant_city,
    COALESCE(a.evidence_url, b.evidence_url) AS evidence_url
FROM public.product_manufacturing a
JOIN public.product_manufacturing b
    ON a.master_product_id < b.master_product_id
   AND (
       (a.invima_registry IS NOT NULL AND a.invima_registry = b.invima_registry)
       OR (a.plant_id IS NOT NULL AND a.plant_id = b.plant_id)
       OR (a.manufacturer_id IS NOT NULL AND a.manufacturer_id = b.manufacturer_id)
   )
LEFT JOIN public.manufacturers m ON m.id = COALESCE(a.manufacturer_id, b.manufacturer_id)
LEFT JOIN public.manufacturing_plants mp ON mp.id = COALESCE(a.plant_id, b.plant_id);

ALTER TABLE public.manufacturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_manufacturing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura pública de fabricantes" ON public.manufacturers;
CREATE POLICY "Lectura pública de fabricantes"
    ON public.manufacturers FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Lectura pública de plantas" ON public.manufacturing_plants;
CREATE POLICY "Lectura pública de plantas"
    ON public.manufacturing_plants FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Lectura pública de manufactura por producto" ON public.product_manufacturing;
CREATE POLICY "Lectura pública de manufactura por producto"
    ON public.product_manufacturing FOR SELECT TO anon, authenticated USING (true);
