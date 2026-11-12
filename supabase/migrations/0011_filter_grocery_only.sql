-- 0011_filter_grocery_only.sql
-- Filtra el comparador exclusivamente a productos y cadenas de mercado / supermercado.
-- Excluye tiendas no-mercado (alkosto, ktronix) y categorías ajenas (tecnología, electrodomésticos,
-- ropa/calzado, juguetería, decoración navideña, colchones, muebles, ferretería, automotores y menaje).
-- Optimiza search_latest_offers evitando timeouts cuando la búsqueda no arroja resultados.

CREATE OR REPLACE FUNCTION public.normalize_mercado_text(p_input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT translate(lower(COALESCE(p_input, '')), 'áéíóúüñ', 'aeiouun');
$$;

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
    IF v_store NOT IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi') THEN
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
        'mattel', 'hasbro', 'hasbro gaming', 'hasbro games', 'barbie', 'hot wheels',
        'nerf', 'play doh', 'play-doh', 'playdoh', 'fisher price', 'fisher-price',
        'lego', 'mega bloks', 'paw patrol', 'spidey and his amazing friends',
        'marvel', 'disney princess', 'disney pixar', 'batman', 'dc superheroes',
        'monopoly', 'pictionary', 'rubiks', 'bestway', 'golty', 'simoniz',
        'cristar', 'estra', 'rimax', 'marinex', 'corelle', 'comodisimos',
        'spring', 'espumados', 'espumados del litoral', 'romance relax',
        'colchones y muebles relax', 'cannon', 'fatelares', 'distrihogar',
        'samsonite', 'totto', 'jsn', 'new balance', 'rali', 'rta',
        'rta design', 'rta desing', 'christmas home', 'chritsmas home', 'santini',
        'acenda', 'austone', 'leao', 'x-shot', 'monster jam', 'dino state',
        'cookeez makery', 'little live pets', 'baby alive', 'cry babies',
        'furby', 'ronda', 'k6', 'ecoflow', 'covergirl', 'maybelline', 'vogue',
        'ushiko', 'freestyle', 'ox toys', 'teamsterz', 'debbie', 'baby paws',
        'orilat', 'in grill', 'sueh', 'ultrax', 'byoung', 'dakota', 'red flag'
    ) THEN
        RETURN FALSE;
    END IF;

    IF v_url ~* '/(tecnologia|electrodomesticos|celulares|computadores|televisores|jugueteria|moda|ropa|calzado|deportes|colchones|muebles|ferreteria|automotores|llantas|motos|decoracion|marroquineria|hogar-cocina|hogar-y-lenceria)/' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '(vamos\s+pa\s+lante|mug\s+(?:navideno|corona)|soporte.*(?:tv|celular|aire\s+acondicionado|pulgadas))' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '\mmunec[oa]s?\M' AND v_name !~* 'la\s+muneca' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '\m(lavadora|secadora)\M' AND v_name !~* 'goma\s+secadora' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '\m(televisor|smart\s*tv|qled|oled|miniled|mini\s*led|celular|smartphone|iphone|tablet|ipad|portatil|computador|laptop|desktop|monitor\s+gamer|proyector|videoproyector|impresora|cartucho\s+(?:de\s+)?tinta|botella\s+(?:de\s+)?tinta|toner|audifonos?|diadema\s+gamer|parlante|subwoofer|barra\s+de\s+sonido|soundbar|altavoz|reloj\s+inteligente|smartwatch|mouse|teclado|pad\s+mouse|memoria\s+usb|disco\s+duro|consola|playstation|xbox|nintendo|nevera|nevecon|minibar|congelador|estufa|cubierta\s+de\s+empotrar|campana\s+(?:extractora|de\s+pared)|microondas|horno\s+(?:electrico|tostador|microondas|de\s+empotrar)|freidora\s+de\s+aire|sandwichera|sanduchera|licuadora|batidora|picatodo|procesador\s+de\s+alimentos|cafetera|chocotera|tostadora|waflera|calentador\s+de\s+agua|dispensador\s+de\s+agua|aire\s+acondicionado|mini\s*split|ventilador|plancha\s+a\s+vapor|plancha\s+(?:de|para)\s+cabello|cortadora\s+de\s+cabello|recortadora\s+inalambrica|secador\s+de\s+cabello|aspiradora|hidrolavadora|olla\s+(?:arrocera|multifuncional|a?\s*presion)|colchon|colchoneta|base\s+cama|closet|escritorio|sofa|silla\s+(?:gamer|oficina)|juego\s+(?:de\s+)?sabanas?|sabana\s+(?:cannon|fatelares|distrihogar|sencilla|doble|semidoble|extradoble|king|queen)|sobrecama|edredon|cobija|manta\s+con\s+figura|almohada|cojin\s+multiusos|toalla\s+de\s+(?:mano|cuerpo|bano)|caldero|cacerola|perol|sarten\s+(?:imusa|universal|tefal|antiadherente|talent|molde|arteeza)|vajilla|copa\s+(?:cristar|agua|vino|champana|san\s+remo|nadir)|vaso\s+cristar|jarra\s+(?:sempre|plastica)|pelapapa|sacacorchos|cucharon|termo\s+cubitt|bombillo|lampara\s+led|taladro|llanta|casco\s+moto|guante\s+moto|bota\s+moto|chaqueta\s+moto|asador\s+y\s+barril|camisa|camiseta|pantalon|chaqueta|vestido|blusa|falda|zapato(?:s)?\s+(?:hombre|mujer|nino|nina|deportivo)|juguete|juego\s+(?:de\s+)?mesa|rompecabezas|lego|hot\s+wheels|barbie|paw\s+patrol|spidey|batman|monopoly|nerf|play\s*doh|fisher\s*price|triciclo|bicicleta|patineta|canasta\s+de\s+baloncesto|cuerda\s+para\s+saltar|pelota\s+playera|andadera|backgammon|guirnalda|adorno\s+navideno|farol\s+navideno|bota\s+decorativa|figura\s+(?:santa|decorativa)|cabeza\s+(?:d|de)\s+santa|ornamento|poinsettia|poinsetia|ponsetia|arbol\s+(?:de\s+navidad|deco)|malla\s+(?:nav|26cm|[0-9]+)|ramaa?\s+[0-9]+cm|pick\s+rojo|corona\s+45cm|esferas?\s+(?:rojas|doradas|[0-9]+cm)|lazo\s+colgante|porta\s*vela|papel\s+regalo|bolsa\s+regalo|tarjetas?\s+3d|sombrilla|paraguas|morral|maleta|bolso\s+termico|base\s+liquida|sombras\s+surtidas\s+para\s+ojos|esponja\s+de\s+maquillaje)\M' THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

-- Limpieza retroactiva de asignaciones canónicas erróneas detectadas (jabones/shampoos como aceite/café o galletas/yogurt sin azúcar)
UPDATE public.master_products mp
SET canonical_category_id = NULL
FROM public.canonical_categories cc
WHERE mp.canonical_category_id = cc.id
  AND (
      (
          cc.slug IN ('cafe-molido-500g', 'aceite-vegetal-900ml')
          AND public.normalize_mercado_text(mp.normalized_name) ~* '\m(jabon|shampoo|champu|acondicionador|locion|mascarilla|crema\s+corporal|crema\s+de\s+manos|toalla|caramelos?|gomitas?|galletas?)\M'
      )
      OR (
          cc.slug = 'azucar-refinada-1000g'
          AND public.normalize_mercado_text(mp.normalized_name) ~* '\m(yogurt|yox|lacteo|leche|galletas?|sin\s+azucar|alimento)\M'
      )
      OR (
          public.normalize_mercado_text(mp.normalized_name) ~* '\m(toalla|calentador|proyector|muneca|juguete)\M'
          AND public.normalize_mercado_text(mp.normalized_name) !~* 'la\s+muneca'
      )
  );

-- Índices para acelerar búsqueda textual sobre store_skus de supermercados
CREATE INDEX IF NOT EXISTS idx_store_skus_raw_name_trgm
    ON public.store_skus USING gin (raw_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_store_skus_grocery_store_master
    ON public.store_skus (store_id, master_product_id)
    WHERE store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
      AND master_product_id IS NOT NULL;

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
    v_query TEXT := left(COALESCE(btrim(p_query), ''), 80);
    v_category TEXT := left(COALESCE(btrim(p_category_slug), ''), 60);
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 240), 1), 500);
    v_like TEXT;
BEGIN
    IF v_query = '' AND v_category = '' THEN
        RETURN QUERY
        WITH canonical_sample AS (
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
            FROM public.master_products mp
            JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
            JOIN public.store_skus ss ON ss.master_product_id = mp.id
            JOIN public.stores s ON s.id = ss.store_id
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
            WHERE mp.canonical_category_id IS NOT NULL
              AND ss.store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
              AND public.is_mercado_product(ss.store_id, COALESCE(ss.raw_name, mp.normalized_name), mp.brand, ss.raw_url)
              AND pr.calibrated_price > 0
              AND pr.in_stock = TRUE
            ORDER BY (ss.store_id = 'carulla') ASC, pr.captured_at DESC
            LIMIT LEAST(140, v_limit)
        ),
        per_store_sample AS (
            SELECT picked.*
            FROM public.stores s
            CROSS JOIN LATERAL (
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
                WHERE ss.store_id = s.id
                  AND ss.master_product_id IS NOT NULL
                  AND public.is_mercado_product(ss.store_id, COALESCE(ss.raw_name, mp.normalized_name), mp.brand, ss.raw_url)
                  AND pr.calibrated_price > 0
                  AND pr.in_stock = TRUE
                LIMIT 40
            ) picked
            WHERE s.id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
        ),
        combined AS (
            SELECT * FROM canonical_sample
            UNION ALL
            SELECT p.*
            FROM per_store_sample p
            WHERE NOT EXISTS (
                SELECT 1
                FROM canonical_sample c
                WHERE c.store_sku_id = p.store_sku_id
            )
        )
        SELECT cb.*
        FROM combined cb
        ORDER BY (cb.canonical_slug IS NULL) ASC, cb.captured_at DESC
        LIMIT v_limit;
        RETURN;
    END IF;

    v_like := '%' || regexp_replace(lower(v_query), '([%_\\])', '\\\1', 'g') || '%';

    RETURN QUERY
    WITH candidate_skus AS (
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
            mp.previous_net_content
        FROM public.store_skus ss
        JOIN public.stores s ON s.id = ss.store_id
        JOIN public.master_products mp ON mp.id = ss.master_product_id
        LEFT JOIN public.canonical_categories cc ON cc.id = mp.canonical_category_id
        WHERE ss.store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
          AND ss.master_product_id IS NOT NULL
          AND (v_category = '' OR cc.slug = v_category)
          AND (
              v_query = ''
              OR mp.ean = v_query
              OR mp.normalized_name ILIKE v_like ESCAPE '\'
              OR ss.raw_name ILIKE v_like ESCAPE '\'
          )
          AND public.is_mercado_product(ss.store_id, COALESCE(ss.raw_name, mp.normalized_name), mp.brand, ss.raw_url)
          AND EXISTS (
              SELECT 1
              FROM public.price_records pr_pos
              WHERE pr_pos.store_sku_id = ss.id
                AND pr_pos.calibrated_price > 0
          )
        ORDER BY (ss.store_id <> 'carulla') DESC, (mp.canonical_category_id IS NOT NULL) DESC, ss.last_verified_at DESC
        LIMIT LEAST(v_limit * 5, 1200)
    )
    SELECT
        cs.store_sku_id,
        cs.store_id,
        cs.store_name,
        cs.channel_type,
        cs.markup_discount_factor,
        cs.master_product_id,
        cs.canonical_category_id,
        cs.raw_name,
        cs.raw_url,
        cs.normalized_name,
        cs.brand,
        cs.ean,
        cs.net_content,
        cs.unit_measure,
        pr.calibrated_price,
        pr.raw_list_price,
        pr.raw_sale_price,
        pr.pum_price,
        pr.in_stock,
        pr.source_origin,
        cs.is_private_label,
        cs.image_url,
        cs.canonical_slug,
        cs.canonical_name,
        cs.positive_votes,
        cs.total_votes,
        cs.avg_yield_factor,
        cs.invima_registry,
        cs.actual_manufacturer,
        cs.shrinkflation_alert,
        cs.previous_net_content,
        pr.captured_at
    FROM candidate_skus cs
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
        WHERE pr_inner.store_sku_id = cs.store_sku_id
        ORDER BY pr_inner.captured_at DESC, pr_inner.id DESC
        LIMIT 1
    ) pr ON TRUE
    WHERE pr.calibrated_price > 0
    ORDER BY pr.in_stock DESC, (cs.canonical_category_id IS NOT NULL) DESC, pr.captured_at DESC
    LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_catalog_stats()
RETURNS TABLE (
    stores_count INT,
    total_skus INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        COUNT(DISTINCT ss.store_id)::INT AS stores_count,
        COUNT(*)::INT AS total_skus
    FROM public.store_skus ss
    JOIN public.master_products mp ON mp.id = ss.master_product_id
    WHERE ss.store_id IN ('carulla', 'd1', 'olimpica', 'exito', 'ara', 'rappi')
      AND public.is_mercado_product(ss.store_id, COALESCE(ss.raw_name, mp.normalized_name), mp.brand, ss.raw_url)
      AND EXISTS (
          SELECT 1
          FROM public.price_records pr
          WHERE pr.store_sku_id = ss.id
            AND pr.calibrated_price > 0
      );
$$;

REVOKE ALL ON FUNCTION public.normalize_mercado_text(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_mercado_text(TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_mercado_product(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_mercado_product(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_latest_offers(TEXT, TEXT, INT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_catalog_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_stats() TO anon, authenticated, service_role;
