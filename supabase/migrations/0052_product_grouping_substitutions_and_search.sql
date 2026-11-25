-- Infraestructura backend para:
-- 1) Producto Agregador (product_group_key, variant_core, clean_canonical_name)
-- 2) Sustitutos inteligentes por product_type (public.substitution_groups)
-- 3) Búsqueda fonética independiente del orden con índice GIN tsvector liviano

ALTER TABLE public.master_products
    ADD COLUMN IF NOT EXISTS product_group_key VARCHAR(160),
    ADD COLUMN IF NOT EXISTS variant_core VARCHAR(80),
    ADD COLUMN IF NOT EXISTS clean_canonical_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS canonical_search_text TEXT,
    ADD COLUMN IF NOT EXISTS search_tsv tsvector
        GENERATED ALWAYS AS (
            to_tsvector(
                'simple',
                COALESCE(canonical_search_text, '') || ' ' ||
                COALESCE(normalized_name, '') || ' ' ||
                COALESCE(brand, '')
            )
        ) STORED;

CREATE INDEX IF NOT EXISTS idx_master_products_group_key
    ON public.master_products (product_group_key)
    WHERE product_group_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_master_products_search_tsv
    ON public.master_products USING GIN (search_tsv);

CREATE TABLE IF NOT EXISTS public.substitution_groups (
    product_type VARCHAR(80) PRIMARY KEY,
    substitution_group VARCHAR(80) NOT NULL,
    impact_tier VARCHAR(20) NOT NULL DEFAULT 'medium',
    yield_factor NUMERIC(6, 3) NOT NULL DEFAULT 1.000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_substitution_groups_group
    ON public.substitution_groups (substitution_group);

ALTER TABLE public.substitution_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read substitution_groups" ON public.substitution_groups;
CREATE POLICY "Public read substitution_groups"
    ON public.substitution_groups
    FOR SELECT
    TO anon, authenticated
    USING (true);
