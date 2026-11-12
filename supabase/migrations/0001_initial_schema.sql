-- 0001_initial_schema.sql
-- Esquema relacional base para Comparador de Precios Retail Colombia (Supabase Free Tier)

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS stores (
    id VARCHAR(30) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    channel_type VARCHAR(30) NOT NULL,
    markup_discount_factor NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS canonical_categories (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    base_unit VARCHAR(10) NOT NULL CHECK (base_unit IN ('g', 'ml', 'und'))
);

CREATE TABLE IF NOT EXISTS master_products (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    ean VARCHAR(20) UNIQUE,
    canonical_category_id INT REFERENCES canonical_categories(id),
    normalized_name VARCHAR(255) NOT NULL,
    brand VARCHAR(100),
    net_content NUMERIC(10,2) NOT NULL CHECK (net_content > 0),
    unit_measure VARCHAR(10) NOT NULL CHECK (unit_measure IN ('g', 'ml', 'und')),
    is_private_label BOOLEAN NOT NULL DEFAULT FALSE,
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_skus (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    store_id VARCHAR(30) NOT NULL REFERENCES stores(id),
    master_product_id UUID REFERENCES master_products(id),
    external_sku VARCHAR(100) NOT NULL,
    raw_name VARCHAR(255) NOT NULL,
    raw_url TEXT,
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, external_sku)
);

CREATE TABLE IF NOT EXISTS price_records (
    id BIGSERIAL PRIMARY KEY,
    store_sku_id UUID NOT NULL REFERENCES store_skus(id) ON DELETE CASCADE,
    raw_list_price NUMERIC(10,2) NOT NULL CHECK (raw_list_price >= 0),
    raw_sale_price NUMERIC(10,2) NOT NULL CHECK (raw_sale_price >= 0),
    calibrated_price NUMERIC(10,2) NOT NULL CHECK (calibrated_price >= 0),
    pum_price NUMERIC(10,4) NOT NULL CHECK (pum_price >= 0),
    in_stock BOOLEAN NOT NULL DEFAULT TRUE,
    source_origin VARCHAR(30) NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para consultas temporales, CDC y homologación difusa (Nivel 2)
CREATE INDEX IF NOT EXISTS idx_price_records_sku_date
    ON price_records (store_sku_id, captured_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_master_products_name_trgm
    ON master_products USING gin (normalized_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_master_products_content_unit
    ON master_products (net_content, unit_measure);

CREATE INDEX IF NOT EXISTS idx_master_products_canonical_cat
    ON master_products (canonical_category_id)
    WHERE canonical_category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_store_skus_master_product
    ON store_skus (master_product_id);

CREATE INDEX IF NOT EXISTS idx_store_skus_store_id
    ON store_skus (store_id);

-- Vista optimizada del último estado conocido por SKU para frontend ISR y CDC
CREATE OR REPLACE VIEW v_latest_prices AS
SELECT DISTINCT ON (pr.store_sku_id)
    pr.id AS price_record_id,
    pr.store_sku_id,
    ss.store_id,
    ss.master_product_id,
    mp.normalized_name,
    mp.brand,
    mp.net_content,
    mp.unit_measure,
    pr.calibrated_price,
    pr.raw_sale_price,
    pr.pum_price,
    pr.in_stock,
    pr.captured_at,
    pr.raw_list_price,
    pr.source_origin,
    mp.canonical_category_id,
    mp.is_private_label,
    ss.external_sku
FROM price_records pr
JOIN store_skus ss ON pr.store_sku_id = ss.id
LEFT JOIN master_products mp ON ss.master_product_id = mp.id
ORDER BY pr.store_sku_id, pr.captured_at DESC, pr.id DESC;

-- RPC Nivel 2: Homologación difusa por trigramas acotada a idéntico gramaje y unidad
CREATE OR REPLACE FUNCTION match_master_product_trgm(
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
AS $$
    SELECT
        mp.id,
        mp.normalized_name,
        similarity(mp.normalized_name, p_target_name) AS similarity_score
    FROM master_products mp
    WHERE mp.net_content = p_net_content
      AND mp.unit_measure = p_unit_measure
      AND similarity(mp.normalized_name, p_target_name) >= p_threshold
    ORDER BY similarity_score DESC, mp.created_at ASC
    LIMIT 1;
$$;

-- RPC CDC: Actualización en lote de last_verified_at sin insertar snapshots duplicados
CREATE OR REPLACE FUNCTION touch_store_skus_verified(p_sku_ids UUID[])
RETURNS BIGINT
LANGUAGE sql
AS $$
    WITH updated AS (
        UPDATE store_skus
        SET last_verified_at = NOW()
        WHERE id = ANY(p_sku_ids)
        RETURNING 1
    )
    SELECT COUNT(*)::BIGINT FROM updated;
$$;
