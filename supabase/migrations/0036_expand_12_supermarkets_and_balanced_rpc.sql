-- 0036_expand_12_supermarkets_and_balanced_rpc.sql
-- Expande el sistema a los 12 supermercados objetivo:
--   Ara, Tiendas D1, Olímpica, Éxito, Carulla,
--   Farmatodo, Euro Supermercados, OXXO, Mercaldas, Ísimo, Zapatoca y Makro.
-- Incluye:
--   1) Registro de tiendas y normalización de nombres en public.stores.
--   2) Sucursales georreferenciadas (PostGIS) por ciudad y barrio.
--   3) Días promocionales (store_promo_days) y alianzas bancarias referenciales.
--   4) Actualización de public.is_mercado_product() e índice parcial en store_skus.
--   5) Reescritura equilibrada de search_latest_offers() (intercalado por cadena + plural/singular).
--   6) Actualización de refresh_catalog_stats_snapshot() para contabilizar las 12 cadenas.

-- 1. Cadenas de supermercado y conveniencia en public.stores
INSERT INTO public.stores (id, name, channel_type, markup_discount_factor)
VALUES
    ('exito', 'Éxito', 'vtex_io', 1.0000),
    ('carulla', 'Carulla', 'vtex_io', 1.0000),
    ('olimpica', 'Olímpica', 'vtex_legacy', 1.0000),
    ('d1', 'Tiendas D1', 'vtex_graphql', 1.0000),
    ('ara', 'Tiendas Ara', 'app_pdf', 1.0000),
    ('farmatodo', 'Farmatodo', 'algolia_spa', 1.0000),
    ('euro', 'Euro Supermercados', 'vtex_io', 1.0000),
    ('oxxo', 'OXXO', 'retail_catalog', 1.0000),
    ('mercaldas', 'Mercaldas', 'vtex_io', 1.0000),
    ('isimo', 'Tiendas Ísimo', 'hard_discount', 1.0000),
    ('zapatoca', 'Supermercados Zapatoca', 'retail_catalog', 1.0000),
    ('makro', 'Makro', 'instaleap_ssr', 1.0000)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    channel_type = EXCLUDED.channel_type;

-- 2. Sucursales físicas georreferenciadas para las 12 cadenas en principales ciudades y barrios
INSERT INTO public.store_branches (store_id, branch_name, city, address, location)
VALUES
    -- Farmatodo
    ('farmatodo', 'Farmatodo Chapinero Calle 63', 'Bogotá', 'Cra. 13 #63-20', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0631, 4.6491), 4326)::extensions.geography),
    ('farmatodo', 'Farmatodo Chicó 85', 'Bogotá', 'Cra. 15 #85-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0545, 4.6689), 4326)::extensions.geography),
    ('farmatodo', 'Farmatodo Cedritos 140', 'Bogotá', 'Calle 140 #13-25', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0361, 4.7202), 4326)::extensions.geography),
    ('farmatodo', 'Farmatodo Galerías 53', 'Bogotá', 'Calle 53 #21-40', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0719, 4.6428), 4326)::extensions.geography),
    ('farmatodo', 'Farmatodo El Poblado', 'Medellín', 'Cra. 43A #10-45', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5715, 6.2102), 4326)::extensions.geography),
    ('farmatodo', 'Farmatodo Laureles', 'Medellín', 'Av. Nutibara #74-15', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5931, 6.2441), 4326)::extensions.geography),
    ('farmatodo', 'Farmatodo Granada', 'Cali', 'Av. 8N #16N-30', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5352, 3.4574), 4326)::extensions.geography),
    ('farmatodo', 'Farmatodo Alto Prado', 'Barranquilla', 'Cra. 52 #80-12', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8109, 11.0058), 4326)::extensions.geography),

    -- Euro Supermercados
    ('euro', 'Euro El Poblado Frontera', 'Medellín', 'Cra. 43A #18 Sur-120', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5739, 6.2041), 4326)::extensions.geography),
    ('euro', 'Euro Laureles San Juan', 'Medellín', 'Calle 44 #76-30', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5945, 6.2468), 4326)::extensions.geography),
    ('euro', 'Euro Envigado Mayorca', 'Medellín', 'Calle 51 Sur #48-57', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5902, 6.1731), 4326)::extensions.geography),
    ('euro', 'Euro Chapinero Express', 'Bogotá', 'Cra. 13 #59-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0638, 4.6468), 4326)::extensions.geography),
    ('euro', 'Euro Chicó Norte', 'Bogotá', 'Calle 86 #14-20', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0531, 4.6699), 4326)::extensions.geography),
    ('euro', 'Euro Cedritos', 'Bogotá', 'Av. 19 #138-50', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0372, 4.7186), 4326)::extensions.geography),
    ('euro', 'Euro Cali Norte', 'Cali', 'Av. 6N #28N-14', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5295, 3.4651), 4326)::extensions.geography),
    ('euro', 'Euro Alto Prado', 'Barranquilla', 'Calle 79 #51-35', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8101, 11.0044), 4326)::extensions.geography),

    -- OXXO
    ('oxxo', 'OXXO Chapinero 57', 'Bogotá', 'Cra. 13 #57-10', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0644, 4.6442), 4326)::extensions.geography),
    ('oxxo', 'OXXO Chicó Parque 93', 'Bogotá', 'Cra. 11A #93-15', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0492, 4.6762), 4326)::extensions.geography),
    ('oxxo', 'OXXO Cedritos 142', 'Bogotá', 'Calle 142 #15-30', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0369, 4.7219), 4326)::extensions.geography),
    ('oxxo', 'OXXO Teusaquillo Park Way', 'Bogotá', 'Cra. 24 #40-22', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0732, 4.6339), 4326)::extensions.geography),
    ('oxxo', 'OXXO Modelia', 'Bogotá', 'Cra. 75 #23F-12', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.1221, 4.6686), 4326)::extensions.geography),
    ('oxxo', 'OXXO El Poblado Lleras', 'Medellín', 'Calle 10 #40-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5689, 6.2089), 4326)::extensions.geography),
    ('oxxo', 'OXXO Laureles 70', 'Medellín', 'Cra. 70 #44B-10', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5889, 6.2484), 4326)::extensions.geography),
    ('oxxo', 'OXXO Granada Cali', 'Cali', 'Av. 9N #14N-22', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5359, 3.4578), 4326)::extensions.geography),
    ('oxxo', 'OXXO Alto Prado', 'Barranquilla', 'Cra. 51B #82-15', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8129, 11.0072), 4326)::extensions.geography),

    -- Mercaldas
    ('mercaldas', 'Mercaldas Chapinero Central', 'Bogotá', 'Cra. 7 #58-40', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0609, 4.6455), 4326)::extensions.geography),
    ('mercaldas', 'Mercaldas Chicó', 'Bogotá', 'Cra. 15 #88-20', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0536, 4.6714), 4326)::extensions.geography),
    ('mercaldas', 'Mercaldas Galerías', 'Bogotá', 'Cra. 24 #53-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0739, 4.6433), 4326)::extensions.geography),
    ('mercaldas', 'Mercaldas Cedritos', 'Bogotá', 'Calle 140 #11-45', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0342, 4.7196), 4326)::extensions.geography),
    ('mercaldas', 'Mercaldas Poblado', 'Medellín', 'Cra. 43B #14-32', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5705, 6.2124), 4326)::extensions.geography),
    ('mercaldas', 'Mercaldas Laureles', 'Medellín', 'Calle 37 #79-14', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5951, 6.2435), 4326)::extensions.geography),
    ('mercaldas', 'Mercaldas Granada', 'Cali', 'Calle 15N #8N-40', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5351, 3.4589), 4326)::extensions.geography),
    ('mercaldas', 'Mercaldas Riomar', 'Barranquilla', 'Cra. 53 #82-60', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8112, 11.0067), 4326)::extensions.geography),

    -- Tiendas Ísimo
    ('isimo', 'Ísimo Chapinero 59', 'Bogotá', 'Cra. 13 #59-42', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0634, 4.6471), 4326)::extensions.geography),
    ('isimo', 'Ísimo Chicó 84', 'Bogotá', 'Cra. 14 #84-20', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0549, 4.6681), 4326)::extensions.geography),
    ('isimo', 'Ísimo Cedritos 140', 'Bogotá', 'Calle 140 #14-12', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0364, 4.7204), 4326)::extensions.geography),
    ('isimo', 'Ísimo Teusaquillo 45', 'Bogotá', 'Calle 45 #22-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0729, 4.6369), 4326)::extensions.geography),
    ('isimo', 'Ísimo Suba Imperial', 'Bogotá', 'Calle 145 #94-22', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0885, 4.7468), 4326)::extensions.geography),
    ('isimo', 'Ísimo Modelia', 'Bogotá', 'Cra. 78 #24-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.1241, 4.6691), 4326)::extensions.geography),
    ('isimo', 'Ísimo El Poblado', 'Medellín', 'Cra. 43D #10A-24', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5701, 6.2098), 4326)::extensions.geography),
    ('isimo', 'Ísimo Laureles', 'Medellín', 'Circular 74 #39B-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5924, 6.2449), 4326)::extensions.geography),
    ('isimo', 'Ísimo Envigado', 'Medellín', 'Cra. 43A #35 Sur-12', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5875, 6.1749), 4326)::extensions.geography),
    ('isimo', 'Ísimo Granada Cali', 'Cali', 'Av. 8N #17N-14', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5357, 3.4591), 4326)::extensions.geography),
    ('isimo', 'Ísimo Ciudad Jardín', 'Cali', 'Calle 16 #102-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5338, 3.3679), 4326)::extensions.geography),
    ('isimo', 'Ísimo Alto Prado', 'Barranquilla', 'Cra. 51B #79-30', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8118, 11.0049), 4326)::extensions.geography),

    -- Supermercados Zapatoca
    ('zapatoca', 'Zapatoca Chapinero', 'Bogotá', 'Calle 57 #13-22', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0641, 4.6446), 4326)::extensions.geography),
    ('zapatoca', 'Zapatoca Galerías / Campín', 'Bogotá', 'Calle 53B #25-14', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0746, 4.6429), 4326)::extensions.geography),
    ('zapatoca', 'Zapatoca Modelia / Fontibón', 'Bogotá', 'Calle 22 #84-10', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.1271, 4.6675), 4326)::extensions.geography),
    ('zapatoca', 'Zapatoca Suba', 'Bogotá', 'Calle 145 #98-30', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0902, 4.7475), 4326)::extensions.geography),
    ('zapatoca', 'Zapatoca Chicó Norte', 'Bogotá', 'Cra. 15 #86-24', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0541, 4.6696), 4326)::extensions.geography),
    ('zapatoca', 'Zapatoca Cedritos', 'Bogotá', 'Av. 19 #141-20', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0359, 4.7211), 4326)::extensions.geography),
    ('zapatoca', 'Zapatoca Laureles', 'Medellín', 'Calle 42 #78-16', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5955, 6.2452), 4326)::extensions.geography),
    ('zapatoca', 'Zapatoca Poblado', 'Medellín', 'Cra. 43A #11-40', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5719, 6.2108), 4326)::extensions.geography),
    ('zapatoca', 'Zapatoca Granada', 'Cali', 'Cra. 4N #15N-20', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5344, 3.4579), 4326)::extensions.geography),
    ('zapatoca', 'Zapatoca Alto Prado', 'Barranquilla', 'Calle 80 #52-20', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8114, 11.0056), 4326)::extensions.geography),

    -- Makro
    ('makro', 'Makro Villa del Río / Chapinero Urbano', 'Bogotá', 'Calle 63 #17-12', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0662, 4.6502), 4326)::extensions.geography),
    ('makro', 'Makro Cumará / AutoNorte', 'Bogotá', 'AutoNorte Calle 192', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0395, 4.7255), 4326)::extensions.geography),
    ('makro', 'Makro Boyacá / Modelia', 'Bogotá', 'Av. Boyacá #23-40', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.1195, 4.6645), 4326)::extensions.geography),
    ('makro', 'Makro San Juan Medellín', 'Medellín', 'Calle 44 #65-50', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5842, 6.2465), 4326)::extensions.geography),
    ('makro', 'Makro Poblado Industriales', 'Medellín', 'Cra. 48 #20-120', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5752, 6.2165), 4326)::extensions.geography),
    ('makro', 'Makro Cali Sur / Valle del Lili', 'Cali', 'Cra. 98 #25-10', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5295, 3.3742), 4326)::extensions.geography),
    ('makro', 'Makro Cali Norte', 'Cali', 'Av. 3N #47N-12', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5248, 3.4712), 4326)::extensions.geography),
    ('makro', 'Makro Barranquilla Villa Santos', 'Barranquilla', 'Cra. 51B #110-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8172, 11.0128), 4326)::extensions.geography),

    -- Refuerzo de cobertura de barrio para Carulla en Chapinero/Modelia/Suba
    ('carulla', 'Carulla Galerías / Chapinero', 'Bogotá', 'Calle 53 #16-30', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0672, 4.6425), 4326)::extensions.geography),
    ('carulla', 'Carulla Suba Niza', 'Bogotá', 'Av. Suba #127-20', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0835, 4.7418), 4326)::extensions.geography)
ON CONFLICT (store_id, branch_name, city) DO NOTHING;

-- 3. Días promocionales y alianzas de pago para nuevas cadenas
INSERT INTO public.store_promo_days (store_id, label, discount_pct, valid_days, active)
VALUES
    ('farmatodo', 'Miércoles de Salud y Bienestar Farmatodo', 15.00, ARRAY[3], TRUE),
    ('euro', 'Martes del Campo y Despensa Euro', 15.00, ARRAY[2], TRUE),
    ('makro', 'Viernes Mayorista de Ahorro Makro', 12.00, ARRAY[5], TRUE),
    ('zapatoca', 'Jueves de Plazas y Granos Zapatoca', 12.00, ARRAY[4], TRUE),
    ('isimo', 'Fin de Semana de Precios Bajos Ísimo', 10.00, ARRAY[5,6], TRUE),
    ('mercaldas', 'Sábado Familiar Mercaldas', 10.00, ARRAY[6], TRUE)
ON CONFLICT (store_id, label) DO NOTHING;

INSERT INTO public.payment_promotions (
    partner_id, partner_variant, store_id, discount_type, discount_value,
    max_discount_cop, min_purchase_cop, valid_days, terms_short, source_url, active
)
VALUES
    ('bancolombia', 'crédito / débito', 'euro', 'pct', 10.00, 20000, 70000, ARRAY[4], 'Jueves 10 % pagando con tarjetas Bancolombia en Euro Supermercados', 'https://www.bancolombia.com', TRUE),
    ('nu', 'crédito', 'farmatodo', 'cashback_pct', 5.00, 12000, 50000, ARRAY[0,1,2,3,4,5,6], 'Hasta 5 % referencial con Tarjeta Nu en compras de despensa y aseo Farmatodo', 'https://nu.com.co', TRUE),
    ('nequi', 'billetera digital', 'isimo', 'cashback_pct', 3.00, 8000, 35000, ARRAY[2,5], 'Martes y viernes 3 % cashback referencial con Nequi en Tiendas Ísimo', 'https://www.nequi.com.co', TRUE),
    ('davivienda', 'crédito / débito', 'makro', 'pct', 10.00, 30000, 150000, ARRAY[6], 'Sábado 10 % con tarjetas Davivienda en compras desde $150.000 en Makro', 'https://www.davivienda.com', TRUE)
ON CONFLICT (partner_id, store_id, discount_type, discount_value) DO NOTHING;

-- 4. Actualizar is_mercado_product() con las 12 cadenas (+ rappi)
CREATE OR REPLACE FUNCTION public.is_mercado_product(
    p_store_id TEXT,
    p_name TEXT,
    p_brand TEXT DEFAULT NULL,
    p_url TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_store TEXT := lower(btrim(COALESCE(p_store_id, '')));
    v_name TEXT := public.normalize_mercado_text(p_name);
    v_brand TEXT := btrim(public.normalize_mercado_text(p_brand));
    v_url TEXT := lower(COALESCE(p_url, ''));
BEGIN
    IF v_store NOT IN (
        'carulla', 'd1', 'olimpica', 'exito', 'ara',
        'farmatodo', 'euro', 'oxxo', 'mercaldas', 'isimo', 'zapatoca', 'makro',
        'rappi'
    ) THEN
        RETURN FALSE;
    END IF;

    IF v_name = '' THEN
        RETURN FALSE;
    END IF;

    IF v_brand IN (
        'samsung', 'lg', 'haceb', 'mabe', 'challenger', 'whirlpool', 'electrolux',
        'hisense', 'caixun', 'hyundai', 'epson', 'acer', 'lenovo', 'hp', 'asus',
        'xiaomi', 'motorola', 'nokia', 'infinix', 'esenses', 'maxell', 'cubitt',
        'mykronoz', 'vta', 'sylvania', 'topluz', 'ilumax', 'sonya', 'olimpo',
        'imusa', 't-fal', 'tefal', 'black+decker', 'oster', 'hamilton beach',
        'ninja', 'nutribullet', 'mr. coffee', 'midea', 'conair', 'remington',
        'revlon', 'universal', 'h&h', 'np', 'polimes', 'incametal', 'la suite',
        'ambiente gourmet', 'maranelo', 'miro', 'mattel', 'hasbro', 'hasbro gaming',
        'hasbro games', 'barbie', 'hot wheels', 'nerf', 'play doh', 'play-doh',
        'playdoh', 'fisher price', 'fisher-price', 'lego', 'mega bloks',
        'paw patrol', 'spidey and his amazing friends', 'marvel', 'disney princess',
        'disney pixar', 'batman', 'dc superheroes', 'monopoly', 'pictionary',
        'rubiks', 'bestway', 'golty', 'simoniz', 'cristar', 'estra', 'rimax',
        'marinex', 'corelle', 'comodisimos', 'spring', 'espumados',
        'espumados del litoral', 'romance relax', 'colchones y muebles relax',
        'cannon', 'fatelares', 'distrihogar', 'samsonite', 'totto', 'jsn',
        'new balance', 'rali', 'rta', 'rta design', 'rta desing',
        'christmas home', 'chritsmas home', 'santini', 'acenda', 'austone', 'leao',
        'x-shot', 'monster jam', 'dino state', 'cookeez makery', 'little live pets',
        'baby alive', 'cry babies', 'furby', 'ronda', 'k6', 'ecoflow', 'covergirl',
        'maybelline', 'vogue', 'ushiko', 'freestyle', 'ox toys', 'ox blocks',
        'teamsterz', 'debbie', 'baby paws', 'orilat', 'in grill', 'sueh',
        'ultrax', 'byoung', 'dakota', 'red flag', 'toy logic', 'metal machines',
        'monster flex', 'jurassic world', 'gabby`s doll house', 'gabbys dollhouse',
        'damecos', 'gold gym', 'stretchapalz'
    ) THEN
        RETURN FALSE;
    END IF;

    IF v_url ~* '/(tecnologia|electrodomesticos|celulares|computadores|televisores|jugueteria|moda|ropa|calzado|deportes|colchones|muebles|ferreteria|automotores|llantas|motos|decoracion|marroquineria|hogar-cocina|hogar-y-lenceria)/' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '(vamos\s+pa\s+lante|mug\s+(?:navideno|corona)|soporte.*(?:tv|celular|aire\s+acondicionado|pulgadas)|protec\w*\s+colch\w*|cepillo\s+secador|secador\s+para\s+cabello|ganch\w*\s+ropa|tabla\s+de\s+cortar|caja\s+organizadora|juego\s+de\s+cubiertos|jarro\s+lechero|bota\s+santa|individuales\s+(?:nav|pompones)|bot\s+polimes|recip\s+polimes|botella\s+tinta|cartucho\s+tinta|tabla\s+de\s+natacion|tubo\s+de\s+resistencia|porta\s+cepillos|organizador\s+damecos|camion\s+a\s+friccion|carro\s+a\s+friccion|set\s+bloques|set\s+de\s+autos|papelera\s+vanyplas\s+pedal|ambientador\s+super\s+organic.*asiento)' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '\mmunec[oa]s?\M' AND v_name !~* 'la\s+muneca' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '\m(lavadora|secadora)\M' AND v_name !~* 'goma\s+secadora' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '\m(televisor|smart\s*tv|qled|oled|miniled|mini\s*led|celular|smartphone|iphone|tablet|ipad|portatil|computador|laptop|desktop|monitor\s+gamer|proyector|videoproyector|impresora|cartucho\s+(?:de\s+)?tinta|botella\s+(?:de\s+)?tinta|toner|audifonos?|diadema\s+gamer|parlante|subwoofer|barra\s+de\s+sonido|soundbar|altavoz|reloj\s+inteligente|smartwatch|mouse|teclado|pad\s+mouse|memoria\s+usb|disco\s+duro|consola|playstation|xbox|nintendo|nevera|nevecon|minibar|congelador|estufa|cubierta\s+de\s+empotrar|campana\s+(?:extractora|de\s+pared)|microondas|horno\s+(?:electrico|tostador|microondas|de\s+empotrar)|freidora\s+de\s+aire|sandwichera|sanduchera|licuadora|batidora|picatodo|procesador\s+de\s+alimentos|cafetera|chocotera|tostadora|waflera|calentador\s+de\s+agua|dispensador\s+de\s+agua|aire\s+acondicionado|mini\s*split|ventilador|plancha\s+a\s+vapor|plancha\s+(?:de|para)\s+cabello|cortadora\s+de\s+cabello|recortadora\s+inalambrica|secador\s+de\s+cabello|aspiradora|hidrolavadora|olla\s+(?:arrocera|multifuncional|a?\s*presion)|colchon|colchoneta|base\s+cama|closet|escritorio|sofa|silla\s+(?:gamer|oficina)|juego\s+(?:de\s+)?sabanas?|sabana\s+(?:cannon|fatelares|distrihogar|sencilla|doble|semidoble|extradoble|king|queen)|sobrecama|edredon|cobija|manta\s+con\s+figura|almohada|cojin\s+multiusos|toalla\s+de\s+(?:mano|cuerpo|bano)|caldero|cacerola|perol|sarten\s+(?:imusa|universal|tefal|antiadherente|talent|molde|arteeza)|wok\s+(?:universal|imusa|tefal|[0-9]+cm)|vajilla|copa\s+(?:cristar|agua|vino|champana|san\s+remo|nadir)|vaso\s+(?:cristar|h&h|navideno)|jarra\s+(?:sempre|plastica|vanyplas)|recipiente(?:s)?\s+(?:toscana|plastico|estra)|colador|espumadera|pelador\s+ilko|pelapapa|sacacorchos|cucharon|termo\s+cubitt|bombillo|lampara\s+led|taladro|llanta|casco\s+moto|guante\s+moto|bota\s+moto|chaqueta\s+moto|motocicleta|asador\s+y\s+barril|flotador|camisa|camiseta|pantalon|chaqueta|vestido|blusa|falda|zapato(?:s)?\s+(?:hombre|mujer|nino|nina|deportivo)|juguete|juego\s+(?:de\s+)?mesa|rompecabezas|lego|hot\s+wheels|barbie|paw\s+patrol|spidey|batman|monopoly|nerf|play\s*doh|fisher\s*price|triciclo|bicicleta|patineta|canasta\s+de\s+baloncesto|cuerda\s+para\s+saltar|pelota\s+playera|andadera|backgammon|guirnalda|adorno\s+navideno|farol\s+navideno|bota\s+decorativa|figura\s+(?:santa|decorativa)|cabeza\s+(?:d|de)\s+santa|ornamento|poinsettia|poinsetia|ponsetia|arbol\s+(?:de\s+navidad|deco)|malla\s+(?:nav|26cm|[0-9]+)|ramaa?\s+[0-9]+cm|pick\s+rojo|corona\s+45cm|esferas?\s+(?:rojas|doradas|[0-9]+cm)|lazo\s+colgante|porta\s*vela|portavaso|maceta|papel\s+regalo|bolsa\s+regalo|tarjetas?\s+3d|sombrilla|paraguas|morral|maleta|bolso\s+termico|base\s+liquida|sombras\s+surtidas\s+para\s+ojos|esponja\s+de\s+maquillaje)\M' THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

-- Reemplazar índice parcial antiguo limitado a 6 cadenas por índice de las 12+ cadenas
DROP INDEX IF EXISTS public.idx_store_skus_mercado_active;
DROP INDEX IF EXISTS public.idx_store_skus_grocery_store_master;
CREATE INDEX IF NOT EXISTS idx_store_skus_mercado_12_stores
    ON public.store_skus (store_id, master_product_id)
    WHERE is_mercado = TRUE
      AND master_product_id IS NOT NULL;

-- Recalcular is_mercado para tiendas activas de mercado
UPDATE public.store_skus ss
SET is_mercado = public.is_mercado_product(
    ss.store_id,
    COALESCE(ss.raw_name, mp.normalized_name),
    mp.brand,
    ss.raw_url
)
FROM public.master_products mp
WHERE ss.master_product_id = mp.id
  AND ss.store_id IN (
      'farmatodo', 'euro', 'oxxo', 'mercaldas', 'isimo', 'zapatoca', 'makro',
      'ara', 'exito', 'd1'
  );

-- 5. Reescribir search_latest_offers con balance round-robin entre los 12 supermercados y soporte singular/plural
CREATE OR REPLACE FUNCTION public.search_latest_offers(
    p_query TEXT DEFAULT '',
    p_category_slug TEXT DEFAULT '',
    p_limit INT DEFAULT 600
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
    v_query TEXT := left(COALESCE(btrim(p_query), ''), 80);
    v_category TEXT := left(COALESCE(btrim(p_category_slug), ''), 60);
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 600), 1), 1200);
    v_per_store_seed INT := GREATEST(LEAST(CEIL(v_limit::NUMERIC / 12.0)::INT + 15, 80), 40);
    v_cat_id INT := NULL;
    v_norm TEXT;
    v_stem TEXT;
    v_like_norm TEXT;
    v_like_stem TEXT;
    v_like_raw TEXT;
    v_is_ean BOOLEAN := FALSE;
BEGIN
    -- RAMA 1: Carga inicial sin filtro (muestra balanceada e intercalada de los 12 supermercados)
    IF v_query = '' AND v_category = '' THEN
        RETURN QUERY
        WITH target_stores AS (
            SELECT s.id, s.name, s.channel_type, s.markup_discount_factor
            FROM public.stores s
            WHERE s.id IN (
                'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
                'isimo', 'makro', 'mercaldas', 'olimpica', 'oxxo', 'zapatoca'
            )
        ),
        per_store_canonical AS (
            SELECT picked.*
            FROM target_stores ts
            CROSS JOIN LATERAL (
                SELECT
                    ss.id AS store_sku_id,
                    ss.store_id,
                    ts.name AS store_name,
                    ts.channel_type,
                    ts.markup_discount_factor,
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
                JOIN public.master_products mp ON mp.id = ss.master_product_id
                JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
                JOIN LATERAL (
                    SELECT
                        pr_in.calibrated_price,
                        pr_in.raw_list_price,
                        pr_in.raw_sale_price,
                        pr_in.pum_price,
                        pr_in.in_stock,
                        pr_in.source_origin,
                        pr_in.captured_at
                    FROM public.price_records pr_in
                    WHERE pr_in.store_sku_id = ss.id
                    ORDER BY pr_in.captured_at DESC, pr_in.id DESC
                    LIMIT 1
                ) pr ON TRUE
                WHERE ss.store_id = ts.id
                  AND ss.is_mercado = TRUE
                  AND ss.master_product_id IS NOT NULL
                  AND mp.canonical_category_id IS NOT NULL
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                LIMIT v_per_store_seed
            ) picked
        ),
        per_store_extra AS (
            SELECT picked.*
            FROM target_stores ts
            CROSS JOIN LATERAL (
                SELECT
                    ss.id AS store_sku_id,
                    ss.store_id,
                    ts.name AS store_name,
                    ts.channel_type,
                    ts.markup_discount_factor,
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
                JOIN public.master_products mp ON mp.id = ss.master_product_id
                LEFT JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
                JOIN LATERAL (
                    SELECT
                        pr_in.calibrated_price,
                        pr_in.raw_list_price,
                        pr_in.raw_sale_price,
                        pr_in.pum_price,
                        pr_in.in_stock,
                        pr_in.source_origin,
                        pr_in.captured_at
                    FROM public.price_records pr_in
                    WHERE pr_in.store_sku_id = ss.id
                    ORDER BY pr_in.captured_at DESC, pr_in.id DESC
                    LIMIT 1
                ) pr ON TRUE
                WHERE ss.store_id = ts.id
                  AND ss.is_mercado = TRUE
                  AND ss.master_product_id IS NOT NULL
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                LIMIT 35
            ) picked
        ),
        combined AS (
            SELECT * FROM per_store_canonical
            UNION ALL
            SELECT e.*
            FROM per_store_extra e
            WHERE NOT EXISTS (
                SELECT 1 FROM per_store_canonical c WHERE c.store_sku_id = e.store_sku_id
            )
        ),
        ranked AS (
            SELECT
                cb.*,
                ROW_NUMBER() OVER (
                    PARTITION BY cb.store_id
                    ORDER BY (cb.canonical_slug IS NULL) ASC, cb.captured_at DESC, cb.store_sku_id
                ) AS store_rank
            FROM combined cb
        )
        SELECT
            r.store_sku_id,
            r.store_id,
            r.store_name,
            r.channel_type,
            r.markup_discount_factor,
            r.master_product_id,
            r.canonical_category_id,
            r.raw_name,
            r.raw_url,
            r.normalized_name,
            r.brand,
            r.ean,
            r.net_content,
            r.unit_measure,
            r.calibrated_price,
            r.raw_list_price,
            r.raw_sale_price,
            r.pum_price,
            r.in_stock,
            r.source_origin,
            r.is_private_label,
            r.image_url,
            r.canonical_slug,
            r.canonical_name,
            r.positive_votes,
            r.total_votes,
            r.avg_yield_factor,
            r.invima_registry,
            r.actual_manufacturer,
            r.shrinkflation_alert,
            r.previous_net_content,
            r.captured_at
        FROM ranked r
        ORDER BY r.store_rank ASC, (r.canonical_slug IS NULL) ASC, r.store_id ASC
        LIMIT v_limit;
        RETURN;
    END IF;

    IF v_category <> '' THEN
        SELECT cc.id INTO v_cat_id
        FROM public.canonical_categories cc
        WHERE cc.slug = v_category
        LIMIT 1;
        IF v_cat_id IS NULL THEN
            RETURN;
        END IF;
    END IF;

    -- RAMA 2: Filtro exclusivo por categoría canónica
    IF v_query = '' AND v_cat_id IS NOT NULL THEN
        RETURN QUERY
        WITH target_stores AS (
            SELECT s.id, s.name, s.channel_type, s.markup_discount_factor
            FROM public.stores s
            WHERE s.id IN (
                'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
                'isimo', 'makro', 'mercaldas', 'olimpica', 'oxxo', 'zapatoca'
            )
        ),
        per_store_cat AS (
            SELECT picked.*
            FROM target_stores ts
            CROSS JOIN LATERAL (
                SELECT
                    ss.id AS store_sku_id,
                    ss.store_id,
                    ts.name AS store_name,
                    ts.channel_type,
                    ts.markup_discount_factor,
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
                FROM public.master_products mp
                JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
                JOIN public.store_skus ss ON ss.master_product_id = mp.id
                JOIN LATERAL (
                    SELECT
                        pr_in.calibrated_price,
                        pr_in.raw_list_price,
                        pr_in.raw_sale_price,
                        pr_in.pum_price,
                        pr_in.in_stock,
                        pr_in.source_origin,
                        pr_in.captured_at
                    FROM public.price_records pr_in
                    WHERE pr_in.store_sku_id = ss.id
                    ORDER BY pr_in.captured_at DESC, pr_in.id DESC
                    LIMIT 1
                ) pr ON TRUE
                WHERE mp.canonical_category_id = v_cat_id
                  AND ss.store_id = ts.id
                  AND ss.is_mercado = TRUE
                  AND pr.calibrated_price > 0
                LIMIT 60
            ) picked
        ),
        ranked AS (
            SELECT
                p.*,
                ROW_NUMBER() OVER (
                    PARTITION BY p.store_id
                    ORDER BY p.in_stock DESC, p.pum_price ASC, p.store_sku_id
                ) AS store_rank
            FROM per_store_cat p
        )
        SELECT
            r.store_sku_id,
            r.store_id,
            r.store_name,
            r.channel_type,
            r.markup_discount_factor,
            r.master_product_id,
            r.canonical_category_id,
            r.raw_name,
            r.raw_url,
            r.normalized_name,
            r.brand,
            r.ean,
            r.net_content,
            r.unit_measure,
            r.calibrated_price,
            r.raw_list_price,
            r.raw_sale_price,
            r.pum_price,
            r.in_stock,
            r.source_origin,
            r.is_private_label,
            r.image_url,
            r.canonical_slug,
            r.canonical_name,
            r.positive_votes,
            r.total_votes,
            r.avg_yield_factor,
            r.invima_registry,
            r.actual_manufacturer,
            r.shrinkflation_alert,
            r.previous_net_content,
            r.captured_at
        FROM ranked r
        ORDER BY r.in_stock DESC, r.store_rank ASC, r.pum_price ASC
        LIMIT v_limit;
        RETURN;
    END IF;

    -- RAMA 3: Búsqueda textual / EAN con tolerancia singular-plural en español e intercalado equitativo
    v_norm := regexp_replace(
        btrim(translate(lower(v_query), 'áéíóúüñàèìòù', 'aeiouunaeiou')),
        '\s+',
        ' ',
        'g'
    );
    v_stem := array_to_string(
        ARRAY(
            SELECT CASE
                WHEN length(w) >= 5 AND w ~ '(l|n|r|d|j|z)es$' THEN regexp_replace(w, 'es$', '')
                WHEN length(w) >= 5 AND w ~ '[aeiou]s$' THEN regexp_replace(w, 's$', '')
                ELSE w
            END
            FROM unnest(string_to_array(v_norm, ' ')) AS w
        ),
        ' '
    );
    v_like_norm := '%' || replace(replace(replace(COALESCE(NULLIF(v_norm, ''), lower(v_query)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_like_stem := '%' || replace(replace(replace(COALESCE(NULLIF(v_stem, ''), COALESCE(NULLIF(v_norm, ''), lower(v_query))), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_like_raw := '%' || replace(replace(replace(lower(v_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_is_ean := v_query ~ '^[0-9]{6,20}$';

    RETURN QUERY
    WITH mp_hits AS (
        SELECT mp.id
        FROM public.master_products mp
        WHERE mp.normalized_name ILIKE v_like_norm
          AND (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
        UNION
        SELECT mp.id
        FROM public.master_products mp
        WHERE v_stem <> v_norm
          AND mp.normalized_name ILIKE v_like_stem
          AND (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
        UNION
        SELECT mp.id
        FROM public.master_products mp
        WHERE v_is_ean
          AND mp.ean = v_query
          AND (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
    ),
    skus_via_mp AS (
        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            ss.master_product_id,
            ss.raw_name,
            ss.raw_url
        FROM public.store_skus ss
        JOIN mp_hits mh ON mh.id = ss.master_product_id
        WHERE ss.is_mercado = TRUE
          AND ss.store_id IN (
              'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
              'isimo', 'makro', 'mercaldas', 'olimpica', 'oxxo', 'zapatoca', 'rappi'
          )
    ),
    skus_via_raw AS (
        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            ss.master_product_id,
            ss.raw_name,
            ss.raw_url
        FROM public.store_skus ss
        JOIN public.master_products mp ON mp.id = ss.master_product_id
        WHERE ss.is_mercado = TRUE
          AND ss.master_product_id IS NOT NULL
          AND ss.store_id IN (
              'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
              'isimo', 'makro', 'mercaldas', 'olimpica', 'oxxo', 'zapatoca', 'rappi'
          )
          AND (
              ss.raw_name ILIKE v_like_raw
              OR (v_stem <> v_norm AND ss.raw_name ILIKE v_like_stem)
          )
          AND (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
    ),
    all_candidates AS (
        SELECT * FROM skus_via_mp
        UNION
        SELECT * FROM skus_via_raw
    ),
    target_stores AS (
        SELECT s.id, s.name, s.channel_type, s.markup_discount_factor
        FROM public.stores s
        WHERE s.id IN (
            'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
            'isimo', 'makro', 'mercaldas', 'olimpica', 'oxxo', 'zapatoca', 'rappi'
        )
    ),
    per_store_candidates AS (
        SELECT picked.*, ts.name AS store_name, ts.channel_type, ts.markup_discount_factor
        FROM target_stores ts
        CROSS JOIN LATERAL (
            SELECT
                ac.store_sku_id,
                ac.store_id,
                ac.master_product_id,
                ac.raw_name,
                ac.raw_url
            FROM all_candidates ac
            WHERE ac.store_id = ts.id
              AND EXISTS (
                  SELECT 1
                  FROM public.price_records pr_pos
                  WHERE pr_pos.store_sku_id = ac.store_sku_id
                    AND pr_pos.calibrated_price > 0
              )
            LIMIT 60
        ) picked
    ),
    priced AS (
        SELECT
            pc.store_sku_id,
            pc.store_id,
            pc.store_name,
            pc.channel_type,
            pc.markup_discount_factor,
            mp.id AS master_product_id,
            mp.canonical_category_id,
            pc.raw_name,
            pc.raw_url,
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
            pr.captured_at,
            ROW_NUMBER() OVER (
                PARTITION BY pc.store_id
                ORDER BY pr.in_stock DESC, (mp.canonical_category_id IS NOT NULL) DESC, pr.pum_price ASC, pc.store_sku_id
            ) AS store_rank
        FROM per_store_candidates pc
        JOIN public.master_products mp ON mp.id = pc.master_product_id
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
            WHERE pr_inner.store_sku_id = pc.store_sku_id
            ORDER BY pr_inner.captured_at DESC, pr_inner.id DESC
            LIMIT 1
        ) pr ON TRUE
        WHERE pr.calibrated_price > 0
    )
    SELECT
        p.store_sku_id,
        p.store_id,
        p.store_name,
        p.channel_type,
        p.markup_discount_factor,
        p.master_product_id,
        p.canonical_category_id,
        p.raw_name,
        p.raw_url,
        p.normalized_name,
        p.brand,
        p.ean,
        p.net_content,
        p.unit_measure,
        p.calibrated_price,
        p.raw_list_price,
        p.raw_sale_price,
        p.pum_price,
        p.in_stock,
        p.source_origin,
        p.is_private_label,
        p.image_url,
        p.canonical_slug,
        p.canonical_name,
        p.positive_votes,
        p.total_votes,
        p.avg_yield_factor,
        p.invima_registry,
        p.actual_manufacturer,
        p.shrinkflation_alert,
        p.previous_net_content,
        p.captured_at
    FROM priced p
    ORDER BY p.in_stock DESC, p.store_rank ASC, (p.canonical_category_id IS NOT NULL) DESC, p.pum_price ASC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) TO anon, authenticated, service_role;

-- 6. Actualizar refresh_catalog_stats_snapshot para contar los 12 supermercados + rappi
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
      AND ss.store_id IN (
          'carulla', 'd1', 'olimpica', 'exito', 'ara',
          'farmatodo', 'euro', 'oxxo', 'mercaldas', 'isimo', 'zapatoca', 'makro',
          'rappi'
      )
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

SELECT public.refresh_catalog_stats_snapshot(0);
