-- 0026_product_attributes_diet.sql
-- Atributos nutricionales y restricciones alimentarias (Res. 810/2021 Colombia)
-- más RPC de enriquecimiento por lote para no penalizar search_latest_offers.

CREATE TABLE IF NOT EXISTS public.product_attributes (
    master_product_id UUID PRIMARY KEY REFERENCES public.master_products(id) ON DELETE CASCADE,
    lactose_free BOOLEAN,
    gluten_free BOOLEAN,
    vegan BOOLEAN,
    vegetarian BOOLEAN,
    sugar_g_100 NUMERIC(6,2) CHECK (sugar_g_100 IS NULL OR sugar_g_100 >= 0),
    protein_g_100 NUMERIC(6,2) CHECK (protein_g_100 IS NULL OR protein_g_100 >= 0),
    sodium_mg_100 NUMERIC(8,2) CHECK (sodium_mg_100 IS NULL OR sodium_mg_100 >= 0),
    fat_g_100 NUMERIC(6,2) CHECK (fat_g_100 IS NULL OR fat_g_100 >= 0),
    kcal_100 NUMERIC(7,2) CHECK (kcal_100 IS NULL OR kcal_100 >= 0),
    front_warning_seals TEXT[] NOT NULL DEFAULT '{}',
    source VARCHAR(30) NOT NULL CHECK (source IN ('label_scrape', 'open_food_facts', 'manual', 'inferred_name')),
    confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence BETWEEN 0 AND 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura pública de atributos nutricionales" ON public.product_attributes;
CREATE POLICY "Lectura pública de atributos nutricionales"
    ON public.product_attributes FOR SELECT TO anon, authenticated USING (true);

-- RPC por lote que combina Sabiómetro + atributos de dieta + manufactura/INVIMA (si existe)
CREATE OR REPLACE FUNCTION public.get_product_enrichment(p_master_ids UUID[])
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
    SELECT jsonb_build_object(
        'sabiometro', COALESCE((
            SELECT jsonb_agg(to_jsonb(s.*))
            FROM public.sabiometro_scores s
            WHERE s.master_product_id = ANY(COALESCE(p_master_ids, '{}'))
        ), '[]'::jsonb),
        'attributes', COALESCE((
            SELECT jsonb_agg(to_jsonb(pa.*))
            FROM public.product_attributes pa
            WHERE pa.master_product_id = ANY(COALESCE(p_master_ids, '{}'))
        ), '[]'::jsonb),
        'manufacturing', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'masterProductId', pm.master_product_id,
                'manufacturerId', pm.manufacturer_id,
                'manufacturerName', m.legal_name,
                'plantId', pm.plant_id,
                'plantName', mp.plant_name,
                'plantCity', mp.city,
                'invimaRegistry', pm.invima_registry,
                'evidenceType', pm.evidence_type,
                'evidenceUrl', pm.evidence_url,
                'confidence', pm.confidence,
                'verifiedByAdmin', pm.verified_by_admin
            ))
            FROM public.product_manufacturing pm
            LEFT JOIN public.manufacturers m ON m.id = pm.manufacturer_id
            LEFT JOIN public.manufacturing_plants mp ON mp.id = pm.plant_id
            WHERE pm.master_product_id = ANY(COALESCE(p_master_ids, '{}'))
        ), '[]'::jsonb)
    );
$$;

REVOKE ALL ON FUNCTION public.get_product_enrichment(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_enrichment(UUID[]) TO anon, authenticated, service_role;
