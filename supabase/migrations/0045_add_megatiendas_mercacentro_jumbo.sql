-- 0045_add_megatiendas_mercacentro_jumbo.sql
-- Registra las cadenas VTEX Megatiendas, Mercacentro y Jumbo Colombia (jumbocolombia.com / redirección tiendasmetro.co)
-- y las habilita en los filtros SQL, vista materializada administrativa, estadísticas y búsqueda de ofertas.

INSERT INTO public.stores (id, name, channel_type, markup_discount_factor)
VALUES
    ('megatiendas', 'Megatiendas', 'vtex_io', 1.0000),
    ('mercacentro', 'Mercacentro', 'vtex_io', 1.0000),
    ('jumbo', 'Jumbo', 'vtex_io', 1.0000)
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    channel_type = EXCLUDED.channel_type,
    markup_discount_factor = EXCLUDED.markup_discount_factor;

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
        'megatiendas', 'mercacentro', 'jumbo', 'rappi'
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

-- Paso 3: Recrear vista materializada admin con bandera is_deprecated_candidate
DROP MATERIALIZED VIEW IF EXISTS public.mv_admin_store_catalog;

CREATE MATERIALIZED VIEW public.mv_admin_store_catalog AS
SELECT
    ss.id AS store_sku_id,
    ss.store_id,
    s.name AS store_name,
    ss.external_sku,
    ss.raw_name,
    COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name)::VARCHAR(255) AS display_name,
    ss.raw_url,
    mp.brand,
    mp.ean,
    mp.net_content,
    mp.unit_measure,
    mp.is_private_label,
    mp.image_url,
    cc.slug AS canonical_slug,
    cc.name AS canonical_name,
    COALESCE(ss.product_type, mp.product_type) AS product_type,
    COALESCE(ss.sub_presentation, mp.sub_presentation) AS sub_presentation,
    COALESCE(ss.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
    ss.variant_tags,
    ss.is_deprecated_candidate,
    ss.deprecated_reason,
    pr.calibrated_price,
    pr.raw_list_price,
    pr.pum_price,
    pr.in_stock,
    pr.source_origin,
    pr.captured_at,
    ss.last_verified_at
FROM public.store_skus ss
JOIN public.stores s ON s.id = ss.store_id
JOIN public.master_products mp ON mp.id = ss.master_product_id
LEFT JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
JOIN LATERAL (
    SELECT
        pr_inner.calibrated_price,
        pr_inner.raw_list_price,
        pr_inner.pum_price,
        pr_inner.in_stock,
        pr_inner.source_origin,
        pr_inner.captured_at
    FROM public.price_records pr_inner
    WHERE pr_inner.store_sku_id = ss.id
    ORDER BY pr_inner.captured_at DESC, pr_inner.id DESC
    LIMIT 1
) pr ON TRUE
WHERE ss.is_mercado = TRUE
  AND pr.calibrated_price > 0
  AND ss.store_id IN (
      'ara', 'd1', 'olimpica', 'exito', 'carulla',
      'farmatodo', 'euro', 'oxxo', 'mercaldas', 'isimo', 'zapatoca', 'makro',
      'megatiendas', 'mercacentro', 'jumbo'
  );

CREATE UNIQUE INDEX idx_mv_admin_cat_sku ON public.mv_admin_store_catalog (store_sku_id);
CREATE INDEX idx_mv_admin_cat_store_name ON public.mv_admin_store_catalog (store_id, raw_name);
CREATE INDEX idx_mv_admin_cat_store_disp ON public.mv_admin_store_catalog (store_id, display_name);
CREATE INDEX idx_mv_admin_cat_price ON public.mv_admin_store_catalog (calibrated_price);
CREATE INDEX idx_mv_admin_cat_pum ON public.mv_admin_store_catalog (pum_price);
CREATE INDEX idx_mv_admin_cat_slug ON public.mv_admin_store_catalog (canonical_slug);
CREATE INDEX idx_mv_admin_cat_subpres ON public.mv_admin_store_catalog (sub_presentation);
CREATE INDEX idx_mv_admin_cat_name_trgm ON public.mv_admin_store_catalog USING gin (raw_name gin_trgm_ops);
CREATE INDEX idx_mv_admin_cat_disp_trgm ON public.mv_admin_store_catalog USING gin (display_name gin_trgm_ops);

REVOKE ALL ON public.mv_admin_store_catalog FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_store_inventory_summary()
RETURNS TABLE (
    store_id VARCHAR(30),
    store_name VARCHAR(100),
    total_skus BIGINT,
    categorized_skus BIGINT,
    uncategorized_skus BIGINT,
    with_ean_skus BIGINT,
    with_image_skus BIGINT,
    private_label_skus BIGINT,
    last_verified_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        s.id AS store_id,
        s.name AS store_name,
        COUNT(m.store_sku_id)::BIGINT AS total_skus,
        COUNT(m.store_sku_id) FILTER (WHERE m.canonical_slug IS NOT NULL)::BIGINT AS categorized_skus,
        COUNT(m.store_sku_id) FILTER (WHERE m.canonical_slug IS NULL)::BIGINT AS uncategorized_skus,
        COUNT(m.store_sku_id) FILTER (WHERE m.ean IS NOT NULL AND m.ean <> '')::BIGINT AS with_ean_skus,
        COUNT(m.store_sku_id) FILTER (WHERE m.image_url IS NOT NULL AND m.image_url <> '')::BIGINT AS with_image_skus,
        COUNT(m.store_sku_id) FILTER (WHERE m.is_private_label = TRUE)::BIGINT AS private_label_skus,
        MAX(m.last_verified_at) AS last_verified_at
    FROM public.stores s
    LEFT JOIN public.mv_admin_store_catalog m ON m.store_id = s.id
    WHERE s.id IN (
        'ara', 'd1', 'olimpica', 'exito', 'carulla',
        'farmatodo', 'euro', 'oxxo', 'mercaldas', 'isimo', 'zapatoca', 'makro',
        'megatiendas', 'mercacentro', 'jumbo'
    )
    GROUP BY s.id, s.name
    ORDER BY COUNT(m.store_sku_id) DESC, s.name ASC;
$$;

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
          'megatiendas', 'mercacentro', 'jumbo', 'rappi'
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

DROP FUNCTION IF EXISTS public.search_latest_offers(TEXT, TEXT, INT, TEXT);

CREATE OR REPLACE FUNCTION public.search_latest_offers(
    p_query TEXT DEFAULT '',
    p_category_slug TEXT DEFAULT '',
    p_limit INT DEFAULT 600,
    p_city TEXT DEFAULT ''
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
    display_name VARCHAR(255),
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
    product_type VARCHAR(80),
    sub_presentation VARCHAR(80),
    sub_presentation_label VARCHAR(100),
    variant_tags TEXT[],
    positive_votes INT,
    total_votes INT,
    avg_yield_factor NUMERIC(3,2),
    invima_registry VARCHAR(50),
    actual_manufacturer VARCHAR(150),
    shrinkflation_alert BOOLEAN,
    previous_net_content NUMERIC(10,2),
    captured_at TIMESTAMPTZ,
    available_cities TEXT[],
    rappi_promo_price NUMERIC(14,2),
    rappi_savings_cop NUMERIC(14,2),
    rappi_savings_pct NUMERIC(5,2),
    rappi_promo_url TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
    v_query TEXT := left(COALESCE(btrim(p_query), ''), 80);
    v_category TEXT := left(COALESCE(btrim(p_category_slug), ''), 60);
    v_city TEXT := regexp_replace(
        btrim(translate(lower(left(COALESCE(p_city, ''), 80)), 'áéíóúüñàèìòù', 'aeiouunaeiou')),
        '\s+',
        ' ',
        'g'
    );
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 600), 1), 1200);
    v_per_store_seed INT := GREATEST(LEAST(CEIL(v_limit::NUMERIC / 15.0)::INT + 15, 80), 40);
    v_cat_id INT := NULL;
    v_norm TEXT;
    v_stem TEXT;
    v_like_norm TEXT;
    v_like_stem TEXT;
    v_like_raw TEXT;
    v_is_ean BOOLEAN := FALSE;
BEGIN
    -- RAMA 1: Carga inicial (solo SKUs reales con imagen, stock y precio > 0)
    IF v_query = '' AND v_category = '' THEN
        RETURN QUERY
        WITH target_stores AS (
            SELECT s.id, s.name, s.channel_type, s.markup_discount_factor
            FROM public.stores s
            WHERE s.id IN (
                'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
                'isimo', 'jumbo', 'makro', 'megatiendas', 'mercacentro',
                'mercaldas', 'olimpica', 'oxxo', 'zapatoca'
            )
        ),
        per_store_seed AS (
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
                    COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name)::VARCHAR(255) AS display_name,
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
                    COALESCE(ss.product_type, mp.product_type) AS product_type,
                    COALESCE(ss.sub_presentation, mp.sub_presentation) AS sub_presentation,
                    COALESCE(ss.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
                    ss.variant_tags,
                    mp.positive_votes,
                    mp.total_votes,
                    mp.avg_yield_factor,
                    mp.invima_registry,
                    mp.actual_manufacturer,
                    mp.shrinkflation_alert,
                    mp.previous_net_content,
                    pr.captured_at,
                    ss.available_cities,
                    ss.rappi_promo_price,
                    ss.rappi_savings_cop,
                    ss.rappi_savings_pct,
                    ss.rappi_promo_url
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
                  AND ss.is_deprecated_candidate = FALSE
                  AND mp.image_url IS NOT NULL
                  AND btrim(mp.image_url) <> ''
                  AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                  AND pr.source_origin <> 'catalog_seed'
                ORDER BY ss.last_verified_at DESC
                LIMIT v_per_store_seed
            ) picked
        ),
        ranked AS (
            SELECT
                cb.*,
                ROW_NUMBER() OVER (
                    PARTITION BY cb.store_id
                    ORDER BY (cb.canonical_slug IS NULL) ASC, cb.captured_at DESC, cb.store_sku_id
                ) AS store_rank
            FROM per_store_seed cb
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
            r.display_name,
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
            r.product_type,
            r.sub_presentation,
            r.sub_presentation_label,
            r.variant_tags,
            r.positive_votes,
            r.total_votes,
            r.avg_yield_factor,
            r.invima_registry,
            r.actual_manufacturer,
            r.shrinkflation_alert,
            r.previous_net_content,
            r.captured_at,
            r.available_cities,
            r.rappi_promo_price,
            r.rappi_savings_cop,
            r.rappi_savings_pct,
            r.rappi_promo_url
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
                'isimo', 'jumbo', 'makro', 'megatiendas', 'mercacentro',
                'mercaldas', 'olimpica', 'oxxo', 'zapatoca'
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
                    COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name)::VARCHAR(255) AS display_name,
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
                    COALESCE(ss.product_type, mp.product_type) AS product_type,
                    COALESCE(ss.sub_presentation, mp.sub_presentation) AS sub_presentation,
                    COALESCE(ss.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
                    ss.variant_tags,
                    mp.positive_votes,
                    mp.total_votes,
                    mp.avg_yield_factor,
                    mp.invima_registry,
                    mp.actual_manufacturer,
                    mp.shrinkflation_alert,
                    mp.previous_net_content,
                    pr.captured_at,
                    ss.available_cities,
                    ss.rappi_promo_price,
                    ss.rappi_savings_cop,
                    ss.rappi_savings_pct,
                    ss.rappi_promo_url
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
                  AND ss.is_deprecated_candidate = FALSE
                  AND mp.image_url IS NOT NULL
                  AND btrim(mp.image_url) <> ''
                  AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                  AND pr.source_origin <> 'catalog_seed'
                LIMIT 60
            ) picked
        ),
        ranked AS (
            SELECT
                c.*,
                ROW_NUMBER() OVER (
                    PARTITION BY c.store_id
                    ORDER BY c.pum_price ASC, c.store_sku_id
                ) AS store_rank
            FROM per_store_cat c
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
            r.display_name,
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
            r.product_type,
            r.sub_presentation,
            r.sub_presentation_label,
            r.variant_tags,
            r.positive_votes,
            r.total_votes,
            r.avg_yield_factor,
            r.invima_registry,
            r.actual_manufacturer,
            r.shrinkflation_alert,
            r.previous_net_content,
            r.captured_at,
            r.available_cities,
            r.rappi_promo_price,
            r.rappi_savings_cop,
            r.rappi_savings_pct,
            r.rappi_promo_url
        FROM ranked r
        ORDER BY r.store_rank ASC, r.pum_price ASC
        LIMIT v_limit;
        RETURN;
    END IF;

    -- RAMA 3: Búsqueda por texto
    v_norm := regexp_replace(
        btrim(translate(lower(v_query), 'áéíóúüñàèìòù', 'aeiouunaeiou')),
        '\s+',
        ' ',
        'g'
    );
    v_stem := regexp_replace(v_norm, '(es|s)$', '');
    IF length(v_stem) < 3 THEN
        v_stem := v_norm;
    END IF;
    v_like_norm := '%' || v_norm || '%';
    v_like_stem := '%' || v_stem || '%';
    v_like_raw := '%' || v_query || '%';
    v_is_ean := (v_query ~ '^[0-9]{6,20}$');

    RETURN QUERY
    WITH target_stores AS (
        SELECT s.id, s.name, s.channel_type, s.markup_discount_factor
        FROM public.stores s
        WHERE s.id IN (
            'ara', 'carulla', 'd1', 'euro', 'exito', 'farmatodo',
            'isimo', 'jumbo', 'makro', 'megatiendas', 'mercacentro',
            'mercaldas', 'olimpica', 'oxxo', 'zapatoca'
        )
    ),
    matched_masters AS MATERIALIZED (
        SELECT mp.id
        FROM public.master_products mp
        WHERE (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
          AND mp.image_url IS NOT NULL
          AND btrim(mp.image_url) <> ''
          AND (
              (v_is_ean AND mp.ean = v_query)
              OR mp.normalized_name ILIKE v_like_norm
              OR mp.normalized_name ILIKE v_like_stem
          )
        LIMIT 1500
    ),
    all_candidates AS MATERIALIZED (
        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            ss.master_product_id,
            ss.raw_name,
            COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name)::VARCHAR(255) AS display_name,
            ss.raw_url,
            ss.product_type,
            ss.sub_presentation,
            ss.sub_presentation_label,
            ss.variant_tags,
            ss.available_cities,
            ss.rappi_promo_price,
            ss.rappi_savings_cop,
            ss.rappi_savings_pct,
            ss.rappi_promo_url
        FROM matched_masters mm
        JOIN public.store_skus ss ON ss.master_product_id = mm.id
        WHERE ss.is_mercado = TRUE
          AND ss.is_deprecated_candidate = FALSE
          AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])

        UNION

        SELECT
            ss.id AS store_sku_id,
            ss.store_id,
            ss.master_product_id,
            ss.raw_name,
            COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name)::VARCHAR(255) AS display_name,
            ss.raw_url,
            ss.product_type,
            ss.sub_presentation,
            ss.sub_presentation_label,
            ss.variant_tags,
            ss.available_cities,
            ss.rappi_promo_price,
            ss.rappi_savings_cop,
            ss.rappi_savings_pct,
            ss.rappi_promo_url
        FROM public.store_skus ss
        WHERE ss.is_mercado = TRUE
          AND ss.master_product_id IS NOT NULL
          AND ss.is_deprecated_candidate = FALSE
          AND (v_city = '' OR ss.available_cities IS NULL OR ss.available_cities @> ARRAY[v_city])
          AND (
              ss.raw_name ILIKE v_like_raw
              OR ss.raw_name ILIKE v_like_stem
              OR (ss.display_name IS NOT NULL AND ss.display_name ILIKE v_like_raw)
          )
        LIMIT 1500
    ),
    per_store_candidates AS (
        SELECT picked.*
        FROM target_stores ts
        CROSS JOIN LATERAL (
            SELECT
                ts.name AS store_name,
                ts.channel_type,
                ts.markup_discount_factor,
                ac.store_sku_id,
                ac.store_id,
                ac.master_product_id,
                ac.raw_name,
                ac.display_name,
                ac.raw_url,
                ac.product_type,
                ac.sub_presentation,
                ac.sub_presentation_label,
                ac.variant_tags,
                ac.available_cities,
                ac.rappi_promo_price,
                ac.rappi_savings_cop,
                ac.rappi_savings_pct,
                ac.rappi_promo_url
            FROM all_candidates ac
            WHERE ac.store_id = ts.id
              AND EXISTS (
                  SELECT 1
                  FROM public.price_records pr_pos
                  WHERE pr_pos.store_sku_id = ac.store_sku_id
                    AND pr_pos.calibrated_price > 0
                    AND pr_pos.in_stock = TRUE
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
            pc.display_name,
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
            COALESCE(pc.product_type, mp.product_type) AS product_type,
            COALESCE(pc.sub_presentation, mp.sub_presentation) AS sub_presentation,
            COALESCE(pc.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
            pc.variant_tags,
            mp.positive_votes,
            mp.total_votes,
            mp.avg_yield_factor,
            mp.invima_registry,
            mp.actual_manufacturer,
            mp.shrinkflation_alert,
            mp.previous_net_content,
            pr.captured_at,
            pc.available_cities,
            pc.rappi_promo_price,
            pc.rappi_savings_cop,
            pc.rappi_savings_pct,
            pc.rappi_promo_url,
            ROW_NUMBER() OVER (
                PARTITION BY pc.store_id
                ORDER BY (mp.canonical_category_id IS NOT NULL) DESC, pr.pum_price ASC, pc.store_sku_id
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
          AND pr.in_stock = TRUE
          AND pr.source_origin <> 'catalog_seed'
          AND mp.image_url IS NOT NULL
          AND btrim(mp.image_url) <> ''
          AND (v_cat_id IS NULL OR mp.canonical_category_id = v_cat_id)
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
        p.display_name,
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
        p.product_type,
        p.sub_presentation,
        p.sub_presentation_label,
        p.variant_tags,
        p.positive_votes,
        p.total_votes,
        p.avg_yield_factor,
        p.invima_registry,
        p.actual_manufacturer,
        p.shrinkflation_alert,
        p.previous_net_content,
        p.captured_at,
        p.available_cities,
        p.rappi_promo_price,
        p.rappi_savings_cop,
        p.rappi_savings_pct,
        p.rappi_promo_url
    FROM priced p
    ORDER BY p.store_rank ASC, (p.canonical_category_id IS NOT NULL) DESC, p.pum_price ASC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT, TEXT) TO anon, authenticated, service_role;
