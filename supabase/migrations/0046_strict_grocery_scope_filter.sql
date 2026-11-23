-- 0046_strict_grocery_scope_filter.sql
-- 1) Restringe `public.is_mercado_product` estrictamente a alimentos de consumo humano,
--    aseo y comida para mascotas (excluyendo bebidas alcohólicas, cigarrillos, medicinas,
--    juguetes, variedades, belleza/maquillaje y hardware/hogar).
-- 2) Depura filas ya existentes que caigan fuera de ese alcance para liberar espacio
--    (< 500 MB) y aligera índices duplicados que consumen Disk IO en Supabase.
--
-- NOTA: Ejecutar en ventana de bajo tráfico o después de revisar `docs/categorias_por_supermercado.md`.

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
        'damecos', 'gold gym', 'stretchapalz', 'abba', 'shimano', 'giant',
        'specialized', 'tkc', 'ferrenovo', 'farberware'
    ) THEN
        RETURN FALSE;
    END IF;

    IF v_url ~* '/(tecnologia|electrodomesticos|celulares|computadores|televisores|jugueteria|moda|ropa|calzado|deportes|colchones|muebles|ferreteria|automotores|llantas|motos|decoracion|marroquineria|hogar-cocina|hogar-y-lenceria|vinos-y-licores|licores|cervezas|cigarrillos|medicamentos|drogueria|farmacia|variedades|pinturas|pisos-y-paredes|belleza|maquillaje|coches-y-sillas|cuarto-del-bebe|ropa-bebes|incontinencia|bienestar-sexual|salud-sexual|lubricantes|preservativos|entrenadores|alfombras|tapetes)/' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '(vamos\s+pa\s+lante|mug\s+(?:navideno|corona)|soporte.*(?:tv|celular|aire\s+acondicionado|pulgadas|gopro|gafas)|protec\w*\s+colch\w*|cepillo\s+secador|secador\s+para\s+cabello|ganch\w*\s+ropa|tabla\s+de\s+cortar|caja\s+organizadora|juego\s+de\s+cubiertos|jarro\s+lechero|bota\s+santa|individuales\s+(?:nav|pompones)|bot\s+polimes|recip\s+polimes|botella\s+tinta|cartucho\s+tinta|tabla\s+de\s+natacion|tubo\s+de\s+resistencia|porta\s+cepillos|organizador\s+(?:damecos|infantil)|camion\s+a\s+friccion|carro\s+a\s+friccion|set\s+bloques|set\s+de\s+autos|papelera\s+vanyplas\s+pedal|ambientador\s+super\s+organic.*asiento|horno\s+.*empotrable|cubre\s+timon|sacacorcho\s+ilko|cuchara\s+ilko|olla\s+ilko|balon\s+de\s+futsal|medias?\s+ciclismo|linterna\s+tactica|multitoma|freno\s+disco)' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '\mmunec[oa]s?\M' AND v_name !~* 'la\s+muneca' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '\m(lavadora|secadora)\M' AND v_name !~* 'goma\s+secadora' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '\m(televisor|smart\s*tv|qled|oled|miniled|mini\s*led|celular|smartphone|iphone|tablet|ipad|portatil|computador|laptop|desktop|monitor\s+gamer|proyector|videoproyector|impresora|cartucho\s+(?:de\s+)?tinta|botella\s+(?:de\s+)?tinta|toner|audifonos?|diadema\s+gamer|parlante|subwoofer|barra\s+de\s+sonido|soundbar|altavoz|reloj\s+inteligente|smartwatch|mouse|teclado|pad\s+mouse|memoria\s+usb|disco\s+duro|consola|playstation|xbox|nintendo|nevera|nevecon|minibar|congelador|estufa|cubierta\s+de\s+empotrar|campana\s+(?:extractora|de\s+pared)|microondas|horno\s+(?:electrico|tostador|microondas|de\s+empotrar)|freidora\s+de\s+aire|sandwichera|sanduchera|licuadora|batidora|picatodo|procesador\s+de\s+alimentos|cafetera|chocotera|tostadora|waflera|calentador\s+de\s+agua|dispensador\s+de\s+agua|aire\s+acondicionado|mini\s*split|ventilador|plancha\s+a\s+vapor|plancha\s+(?:de|para)\s+cabello|cortadora\s+de\s+cabello|recortadora\s+inalambrica|secador\s+de\s+cabello|aspiradora|hidrolavadora|olla\s+(?:arrocera|multifuncional|a?\s*presion)|colchon|colchoneta|base\s+cama|closet|escritorio|sofa|silla\s+(?:gamer|oficina)|juego\s+(?:de\s+)?sabanas?|sabana\s+(?:cannon|fatelares|distrihogar|sencilla|doble|semidoble|extradoble|king|queen)|sobrecama|edredon|cobija|manta\s+con\s+figura|almohada|cojin\s+multiusos|toalla\s+de\s+(?:mano|cuerpo|bano)|caldero|cacerola|perol|sarten\s+(?:imusa|universal|tefal|antiadherente|talent|molde|arteeza)|wok\s+(?:universal|imusa|tefal|[0-9]+cm)|vajilla|copa\s+(?:cristar|agua|vino|champana|san\s+remo|nadir)|vaso\s+(?:cristar|h&h|navideno)|jarra\s+(?:sempre|plastica|vanyplas)|recipiente(?:s)?\s+(?:toscana|plastico|estra)|colador|espumadera|pelador\s+ilko|pelapapa|sacacorchos|cucharon|termo\s+cubitt|bombillo|lampara\s+led|taladro|llanta|casco\s+moto|guante\s+moto|bota\s+moto|chaqueta\s+moto|motocicleta|asador\s+y\s+barril|flotador|camisa|camiseta|pantalon|chaqueta|vestido|blusa|falda|zapato(?:s)?\s+(?:hombre|mujer|nino|nina|deportivo)|juguete|juego\s+(?:de\s+)?mesa|rompecabezas|lego|hot\s+wheels|barbie|paw\s+patrol|spidey|batman|monopoly|nerf|play\s*doh|fisher\s*price|triciclo|bicicleta|patineta|canasta\s+de\s+baloncesto|cuerda\s+para\s+saltar|pelota\s+playera|andadera|backgammon|guirnalda|adorno\s+navideno|farol\s+navideno|bota\s+decorativa|figura\s+(?:santa|decorativa)|cabeza\s+(?:d|de)\s+santa|ornamento|poinsettia|poinsetia|ponsetia|arbol\s+(?:de\s+navidad|deco)|malla\s+(?:nav|26cm|[0-9]+)|ramaa?\s+[0-9]+cm|pick\s+rojo|corona\s+45cm|esferas?\s+(?:rojas|doradas|[0-9]+cm)|lazo\s+colgante|porta\s*vela|portavaso|maceta|papel\s+regalo|bolsa\s+regalo|tarjetas?\s+3d|sombrilla|paraguas|morral|maleta|bolso\s+(?:termico|de\s+tenis)|delantal\s+(?:behome|jean|cocina|parrillero)|base\s+liquida|sombras\s+surtidas\s+para\s+ojos|esponja\s+de\s+maquillaje|esmalte\s+(?:de\s+)?unas|polvo\s+compacto|rubor\s+(?:compacto|liquido|en\s+crema|mineral)|labial\s+(?:mate|liquido|brillo|cremoso|hydra)|pestanina|mascara\s+de\s+pestanas|eau\s+de\s+(?:parfum|toilette)|perfume\s+(?:hombre|mujer|caballero|dama)|oso\s+de\s+peluche|wd-40|alfombra\s+de\s+bano|whisky|whiskey|vodka|tequila|ginebra|brandy|cognac|aguardiente|champana|champagne|prosecco|cervezas?|licor(?:es)?|crema\s+de\s+whisky|six\s*pack\s+cerveza|ron\s+(?:caldas|medellin|santa\s+fe|viejo|anejo|blanco|dorado|bacardi|havana|zacapa|hechicera|dictador|diplomatico)|cigarrillos?|cajetilla|tabaco|vaper|vapeador(?:es)?|vaporizador(?:es)?\s+(?:de\s+)?nicotina|e-?liquid|medicamentos?|acetaminofen|ibuprofeno|naproxeno|dolex|advil|aspirina|loratadina|cetirizina|desloratadina|omeprazol|esomeprazol|buscapina|sal\s+de\s+frutas|pepto\s+bismol|jarabe\s+(?:para\s+la\s+tos|expectorante)|suero\s+oral|pedialyte|hidraplus|electrolit\s+suero|curitas|vendaje|gasa\s+esteril|isodine|tensiometro|jeringa|preservativo|condon|prueba\s+de\s+embarazo|incontinencia|panal(?:es)?\s+(?:de\s+|para\s+)?adulto|tena\s+(?:pants|slip|discreet|lady|men|protector|toalla|ropa)|plenitud|cotidian|lubricante\s+(?:intimo|sexual|personal)|gel\s+lubricante|calzon(?:cito)?\s+entrenador|pantalon(?:cito)?\s+entrenador|asiento\s+entrenador|tapete\s+entrenador|alfombra\s+(?:sala|decorativa|piso|bano|[0-9]+)|tapete\s+(?:decorativo|bano|entrada|piso)|pintura\s+(?:vinilo|esmalte|exterior|interior)|sanitario\s+y|lavamanos|caminadora\s+para\s+bebe|coche\s+para\s+bebe|silla\s+de\s+carro)\M' THEN
        RETURN FALSE;
    END IF;

    IF v_name ~* '\mvino\s+(?:tinto|blanco|rosado|espumoso|seco|dulce|importado|carmenere|cabernet|merlot|malbec|sauvignon|chardonnay)\M'
       AND v_name !~* 'vinagre\s+de\s+vino' THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

-- Eliminar índices redundantes para reducir tamaño en disco e IOPS de escritura
DROP INDEX IF EXISTS public.idx_store_skus_raw_name_trgm;
DROP INDEX IF EXISTS public.idx_price_records_sku_date;

-- Marcar/excluir SKUs fuera del alcance estricto (alimentos consumo humano, aseo y comida mascota)
UPDATE public.store_skus ss
SET
    is_mercado = FALSE,
    is_deprecated_candidate = TRUE,
    deprecated_reason = COALESCE(NULLIF(ss.deprecated_reason, ''), 'out_of_strict_grocery_scope')
FROM public.master_products mp
WHERE mp.id = ss.master_product_id
  AND ss.is_mercado = TRUE
  AND NOT public.is_mercado_product(ss.store_id, ss.raw_name, mp.brand, ss.raw_url);
