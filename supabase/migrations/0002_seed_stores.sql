-- 0002_seed_stores.sql
-- Catálogo inicial de cadenas retail y categorías canónicas base

INSERT INTO stores (id, name, channel_type, markup_discount_factor)
VALUES
    ('exito', 'Éxito', 'vtex_io', 1.0000),
    ('carulla', 'Carulla', 'vtex_io', 1.0000),
    ('olimpica', 'Olímpica', 'vtex_legacy', 1.0000),
    ('d1', 'Tiendas D1', 'vtex_graphql', 1.0000),
    ('ara', 'Tiendas Ara', 'app_pdf', 1.0000),
    ('alkosto', 'Alkosto', 'sap_hybris', 1.0000),
    ('ktronix', 'Ktronix', 'sap_hybris', 1.0000),
    ('rappi', 'Rappi Agregador', 'aggregator', 0.9000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO canonical_categories (slug, name, base_unit)
VALUES
    ('arroz-blanco-1000g', 'Arroz Blanco 1000 g', 'g'),
    ('leche-entera-1000ml', 'Leche Entera 1000 ml', 'ml'),
    ('aceite-vegetal-900ml', 'Aceite Vegetal 900 ml', 'ml'),
    ('huevos-aa-30und', 'Huevos AA 30 Unidades', 'und'),
    ('azucar-refinada-1000g', 'Azúcar Refinada 1000 g', 'g'),
    ('cafe-molido-500g', 'Café Molido 500 g', 'g'),
    ('pasta-espagueti-500g', 'Pasta Espagueti 500 g', 'g'),
    ('lenteja-500g', 'Lenteja 500 g', 'g'),
    ('frijol-500g', 'Frijol 500 g', 'g'),
    ('atun-lata-160g', 'Atún en Lata 160 g', 'g')
ON CONFLICT (slug) DO NOTHING;
