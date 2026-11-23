"""Filtro unificado de catálogo para mantener únicamente productos y cadenas de mercado."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from typing import Literal

GROCERY_STORE_IDS: frozenset[str] = frozenset(
    {
        "carulla",
        "d1",
        "olimpica",
        "exito",
        "ara",
        "farmatodo",
        "euro",
        "oxxo",
        "mercaldas",
        "isimo",
        "zapatoca",
        "makro",
        "megatiendas",
        "mercacentro",
        "jumbo",
        "canaveral",
        "mxm",
        "supermu",
        "superboom",
        "mercamio",
        "belalcazar",
        "amy",
        "metro",
        "rappi",
    }
)

# Categorías raíz / subárboles VTEX claramente ajenos a mercado/supermercado.
_NON_GROCERY_CATEGORY_TOKENS: tuple[str, ...] = (
    "jugueteria",
    "juguete",
    "juguetes",
    "electrodomesticos",
    "tecnologia",
    "celulares",
    "computadores",
    "televisores",
    "automotores",
    "automovil",
    "llantas",
    "motos",
    "deportes",
    "marroquineria",
    "donaciones",
    "hogar y lenceria",
    "hogar cocina",
    "hogar y decoracion",
    "mundo hogar",
    "decohogar",
    "cocina y mesa",
    "mesa y cocina",
    "textil - alcoba",
    "ropa hogar",
    "ropa de cama",
    "ferreteria",
    "moda",
    "ropa",
    "calzado",
    "utiles y papeleria",
    "papeleria",
    "escolar",
    "escuela de cocina",
    "cursos a la carta",
    "decoracion",
    "instrumentos musicales",
    "libros",
    "movilidad electrica",
    "vehiculos",
    "eventos",
    "servicios",
    "fiesta",
    "otras categorias",
    "colchones",
    "muebles",
    "haceb",
    "mastronics",
    "calentadores",
    "climatizacion",
    "lavado y secado",
    "refrigeracion",
    "repuestos y accesorios",
    "audio",
    "audifonos",
    "parlantes",
    "barras de sonido",
    "alisadores",
    "risadores",
    "secadores",
    "plancha de cabello",
    "cortador de cabello",
    "medicamentos",
    "medicina",
    "medicinas",
    "salud y medicamentos",
    "salud y bienestar",
    "cuidado de la salud",
    "suministros medicos",
    "equipos movilidad",
    "equipos ortopedicos",
    "drogueria",
    "farmacia",
    "botiquin",
    "rehabilitacion",
    "equipos medicos",
    "ortopedia",
    "fisioterapia",
    "skincare",
    "maquillaje",
    "cosmeticos",
    "cosmetica",
    "perfumeria",
    "perfumes",
    "fragancias",
    "belleza",
    "optica",
    "cuidado de la vista",
    "lentes de contacto",
    "gafas",
    "formulas medicas",
    "suplementos dietarios",
    "nutricion deportiva",
    "electro belleza",
    "bebidas alcoholicas",
    "vinos y licores",
    "vinos",
    "licores",
    "licor",
    "cervezas",
    "cerveza",
    "whisky",
    "whiskys",
    "whiskey",
    "tequila",
    "vodka",
    "ginebra",
    "cognac",
    "brandy",
    "aguardiente",
    "aguardientes",
    "cocteleria",
    "cocteles",
    "mezcladores - aperitivos",
    "cremas de licor",
    "cremas y aperitivos",
    "otros licores",
    "rones",
    "ron brandy",
    "cigarrillos",
    "cigarrillo",
    "tabaco",
    "tabacos",
    "vaporizadores",
    "vaporizador",
    "vapeadores",
    "vapeador",
    "variedades",
    "miscelanea",
    "bazar",
    "pinateria",
    "pinturas",
    "pisos y paredes",
    "jardin",
    "banos",
    "mundo parrilla",
    "coches y sillas",
    "coches para bebe",
    "coches para bebes",
    "accesorios para coches",
    "sillas de carro",
    "sillas para carros",
    "silla comedor",
    "sillas comedor",
    "sillas para comer",
    "cargadores y fulares",
    "mochilas y porta bebes",
    "almohadas para embarazadas",
    "fajas de maternidad",
    "cuarto del bebe",
    "habitacion del bebe",
    "dormitorio del bebe",
    "mobiliario y movilizacion",
    "paseo y viajes",
    "estimulacion",
    "entretenimiento del bebe",
    "juguete y seguridad del bebe",
    "seguridad bebe",
    "seguridad para bebes",
    "lenceria y decoracion",
    "cunas",
    "moises",
    "caminadores",
    "ropa bebes",
    "campana",
    "campanas",
    "tarjeta regalo",
    "tarjetas regalo",
    "bonos regalo",
    "logistica",
    "adultos",
    "incontinencia",
    "proteccion incontinencia",
    "bienestar sexual",
    "salud sexual",
    "lubricantes",
    "preservativos",
    "entrenadores",
    "entrenador",
    "alfombras",
    "tapetes",
    "accesorios mascotas",
    "accesorios para mascotas",
    "ropa mascotas",
    "juguetes mascotas",
    "coloracion",
)

_NON_GROCERY_CATEGORY_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(tok) for tok in sorted(_NON_GROCERY_CATEGORY_TOKENS, key=len, reverse=True)) + r")\b"
)

_PRIORITY_GROCERY_CATEGORIES: tuple[str, ...] = (
    "supermercado",
    "mercado",
    "despensa",
    "lacteos",
    "huevos",
    "pollo",
    "carnes",
    "pescado",
    "frutas",
    "verduras",
    "bebidas",
    "snacks",
    "pasabocas",
    "cafe",
    "panaderia",
    "congelados",
    "aseo",
    "higiene",
    "cuidado personal",
    "cuidado oral",
    "cuidado corporal",
    "limpieza",
)

_NON_GROCERY_BRANDS: frozenset[str] = frozenset(
    {
        "samsung",
        "lg",
        "haceb",
        "mabe",
        "challenger",
        "whirlpool",
        "electrolux",
        "hisense",
        "caixun",
        "hyundai",
        "epson",
        "acer",
        "lenovo",
        "hp",
        "asus",
        "xiaomi",
        "motorola",
        "nokia",
        "infinix",
        "esenses",
        "maxell",
        "cubitt",
        "mykronoz",
        "vta",
        "sylvania",
        "topluz",
        "ilumax",
        "sonya",
        "olimpo",
        "imusa",
        "t-fal",
        "tefal",
        "black+decker",
        "oster",
        "hamilton beach",
        "ninja",
        "nutribullet",
        "mr. coffee",
        "midea",
        "conair",
        "remington",
        "revlon",
        "universal",
        "h&h",
        "np",
        "polimes",
        "incametal",
        "la suite",
        "ambiente gourmet",
        "maranelo",
        "miro",
        "mattel",
        "hasbro",
        "hasbro gaming",
        "hasbro games",
        "barbie",
        "hot wheels",
        "nerf",
        "play doh",
        "play-doh",
        "playdoh",
        "fisher price",
        "fisher-price",
        "lego",
        "mega bloks",
        "paw patrol",
        "spidey and his amazing friends",
        "marvel",
        "disney princess",
        "disney pixar",
        "batman",
        "dc superheroes",
        "monopoly",
        "pictionary",
        "rubiks",
        "bestway",
        "golty",
        "simoniz",
        "cristar",
        "estra",
        "rimax",
        "marinex",
        "corelle",
        "comodisimos",
        "spring",
        "espumados",
        "espumados del litoral",
        "romance relax",
        "colchones y muebles relax",
        "cannon",
        "fatelares",
        "distrihogar",
        "samsonite",
        "totto",
        "jsn",
        "new balance",
        "rali",
        "rta",
        "rta design",
        "rta desing",
        "christmas home",
        "chritsmas home",
        "santini",
        "acenda",
        "austone",
        "leao",
        "x-shot",
        "monster jam",
        "dino state",
        "cookeez makery",
        "little live pets",
        "baby alive",
        "cry babies",
        "furby",
        "ronda",
        "k6",
        "ecoflow",
        "covergirl",
        "maybelline",
        "vogue",
        "ushiko",
        "freestyle",
        "ox toys",
        "ox blocks",
        "teamsterz",
        "debbie",
        "baby paws",
        "orilat",
        "in grill",
        "sueh",
        "ultrax",
        "byoung",
        "dakota",
        "red flag",
        "toy logic",
        "metal machines",
        "monster flex",
        "jurassic world",
        "gabby`s doll house",
        "gabbys dollhouse",
        "damecos",
        "gold gym",
        "stretchapalz",
        "abba",
        "shimano",
        "giant",
        "specialized",
        "tkc",
        "ferrenovo",
        "farberware",
    }
)

_URL_EXCLUDED_RE = re.compile(
    r"/(tecnologia|electrodomesticos|celulares|computadores|televisores|jugueteria|moda|ropa|calzado|"
    r"deportes|colchones|muebles|ferreteria|automotores|llantas|motos|decoracion|marroquineria|"
    r"hogar-cocina|hogar-y-lenceria|vinos-y-licores|licores|cervezas|cigarrillos|medicamentos|"
    r"drogueria|farmacia|variedades|pinturas|pisos-y-paredes|belleza|maquillaje|"
    r"coches-y-sillas|cuarto-del-bebe|ropa-bebes|"
    r"incontinencia|bienestar-sexual|salud-sexual|lubricantes|preservativos|entrenadores|alfombras|tapetes)/",
    re.IGNORECASE,
)

_PHRASE_EXCLUDED_RE = re.compile(
    r"(vamos\s+pa\s+lante|mug\s+(?:navideno|corona)|soporte.*(?:tv|celular|aire\s+acondicionado|pulgadas|gopro|gafas)|"
    r"protec\w*\s+colch\w*|cepillo\s+secador|secador\s+para\s+cabello|ganch\w*\s+ropa|tabla\s+de\s+cortar|"
    r"caja\s+organizadora|juego\s+de\s+cubiertos|jarro\s+lechero|bota\s+santa|individuales\s+(?:nav|pompones)|"
    r"bot\s+polimes|recip\s+polimes|botella\s+tinta|cartucho\s+tinta|tabla\s+de\s+natacion|"
    r"tubo\s+de\s+resistencia|porta\s+cepillos|organizador\s+(?:damecos|infantil)|camion\s+a\s+friccion|"
    r"carro\s+a\s+friccion|set\s+bloques|set\s+de\s+autos|papelera\s+vanyplas\s+pedal|"
    r"ambientador\s+super\s+organic.*asiento|horno\s+.*empotrable|cubre\s+timon|"
    r"sacacorcho\s+ilko|cuchara\s+ilko|olla\s+ilko|balon\s+de\s+futsal|"
    r"medias?\s+ciclismo|linterna\s+tactica|multitoma|freno\s+disco|"
    r"decoracion\s+de\s+unas|removedor\s+de\s+esmalte|set\s+de\s+manicure|"
    r"(?:top|base)\s*coat\s+semipermanente|"
    r"collar\s+(?:para\s+)?(?:perro|gato|mascota)s?|(?:perro|gato)\s+collar|"
    r"correa\s+(?:.*?\s+)?(?:para\s+)?(?:perro|gato|mascota)s?|"
    r"(?:juguete|cama)\s+para\s+(?:perro|gato)s?)",
    re.IGNORECASE,
)

_MUNECA_RE = re.compile(r"\bmunec[oa]s?\b", re.IGNORECASE)
_LA_MUNECA_RE = re.compile(r"\bla\s+muneca\b", re.IGNORECASE)
_WASHER_RE = re.compile(r"\b(lavadora|secadora)\b", re.IGNORECASE)
_GOMA_SECADORA_RE = re.compile(r"\bgoma\s+secadora\b", re.IGNORECASE)
_WINE_LIQUOR_RE = re.compile(
    r"\bvino\b(?=.*?\b(?:tinto|blanco|rosado|rose|espumoso|espumante|espu|seco|semiseco|semiswee|"
    r"dulce|semidulce|importado|carmenere|cabernet|merlot|malbec|sauvignon|chardonnay|pinot|"
    r"syrah|shiraz|tempranillo|lambrusco|moscatel|riesling|gato\s+negro|jp\.?\s*chenet|"
    r"casillero|concha\s+y\s+toro|santa\s+helena|frontera|undurraga|sangria|oporto)\b)",
    re.IGNORECASE,
)
_WINE_CULINARY_SAFE_RE = re.compile(
    r"\b(?:vinagre|pollo|pechuga|aderezo|esparcible|salchich|jamon|queso|cocina|sazonador)\b",
    re.IGNORECASE,
)

_WORD_EXCLUDED_RE = re.compile(
    r"\b("
    r"televisor|smart\s*tv|qled|oled|miniled|mini\s*led|celular|smartphone|iphone|tablet|ipad|"
    r"portatil|computador|laptop|desktop|monitor\s+gamer|proyector|videoproyector|impresora|"
    r"cartucho\s+(?:de\s+)?tinta|botella\s+(?:de\s+)?tinta|toner|audifonos?|diadema\s+gamer|"
    r"parlante|subwoofer|barra\s+de\s+sonido|soundbar|altavoz|reloj\s+inteligente|smartwatch|"
    r"mouse|teclado|pad\s+mouse|memoria\s+usb|disco\s+duro|consola|playstation|xbox|nintendo|"
    r"nevera|nevecon|minibar|congelador|estufa|cubierta\s+de\s+empotrar|campana\s+(?:extractora|de\s+pared)|"
    r"microondas|horno\s+(?:electrico|tostador|microondas|de\s+empotrar)|freidora\s+de\s+aire|"
    r"sandwichera|sanduchera|licuadora|batidora|picatodo|procesador\s+de\s+alimentos|cafetera|"
    r"chocotera|tostadora|waflera|calentador\s+de\s+agua|dispensador\s+de\s+agua|aire\s+acondicionado|"
    r"mini\s*split|ventilador|plancha\s+a\s+vapor|plancha\s+(?:de|para)\s+cabello|cortadora\s+de\s+cabello|"
    r"recortadora\s+inalambrica|secador\s+de\s+cabello|aspiradora|hidrolavadora|"
    r"olla\s+(?:arrocera|multifuncional|a?\s*presion)|colchon|colchoneta|base\s+cama|closet|escritorio|"
    r"sofa|silla\s+(?:gamer|oficina)|juego\s+(?:de\s+)?sabanas?|"
    r"sabana\s+(?:cannon|fatelares|distrihogar|sencilla|doble|semidoble|extradoble|king|queen)|"
    r"sobrecama|edredon|cobija|manta\s+con\s+figura|almohada|cojin\s+multiusos|"
    r"toalla\s+de\s+(?:mano|cuerpo|bano)|caldero|cacerola|perol|"
    r"sarten\s+(?:imusa|universal|tefal|antiadherente|talent|molde|arteeza)|"
    r"wok\s+(?:universal|imusa|tefal|[0-9]+cm)|vajilla|copa\s+(?:cristar|agua|vino|champana|san\s+remo|nadir)|"
    r"vaso\s+(?:cristar|h&h|navideno)|jarra\s+(?:sempre|plastica|vanyplas)|"
    r"recipiente(?:s)?\s+(?:toscana|plastico|estra)|colador|espumadera|pelador\s+ilko|pelapapa|"
    r"sacacorchos|cucharon|termo\s+cubitt|bombillo|lampara\s+led|taladro|llanta|"
    r"casco\s+moto|guante\s+moto|bota\s+moto|chaqueta\s+moto|motocicleta|asador\s+y\s+barril|flotador|"
    r"camisa|camiseta|pantalon|chaqueta|vestido|blusa|falda|zapato(?:s)?\s+(?:hombre|mujer|nino|nina|deportivo)|"
    r"juguete|juego\s+(?:de\s+)?mesa|rompecabezas|lego|hot\s+wheels|barbie|paw\s+patrol|spidey|batman|"
    r"monopoly|nerf|play\s*doh|fisher\s*price|triciclo|bicicleta|patineta|canasta\s+de\s+baloncesto|"
    r"cuerda\s+para\s+saltar|pelota\s+playera|andadera|backgammon|guirnalda|adorno\s+navideno|"
    r"farol\s+navideno|bota\s+decorativa|figura\s+(?:santa|decorativa)|cabeza\s+(?:d|de)\s+santa|"
    r"ornamento|poinsettia|poinsetia|ponsetia|arbol\s+(?:de\s+navidad|deco)|malla\s+(?:nav|26cm|[0-9]+)|"
    r"ramaa?\s+[0-9]+cm|pick\s+rojo|corona\s+45cm|esferas?\s+(?:rojas|doradas|[0-9]+cm)|lazo\s+colgante|"
    r"porta\s*vela|portavaso|maceta|papel\s+regalo|bolsa\s+regalo|tarjetas?\s+3d|sombrilla|paraguas|"
    r"morral|maleta|bolso\s+(?:termico|de\s+tenis)|delantal\s+(?:behome|jean|cocina|parrillero)|"
    r"base\s+liquida|sombras\s+surtidas\s+para\s+ojos|esponja\s+de\s+maquillaje|esmalte\s+(?:de\s+)?unas|"
    r"polvo\s+compacto|rubor\s+(?:compacto|liquido|en\s+crema|mineral)|labial\s+(?:mate|liquido|brillo|cremoso|hydra)|"
    r"pestanina|mascara\s+de\s+pestanas|eau\s+de\s+(?:parfum|toilette)|perfume\s+(?:hombre|mujer|caballero|dama)|"
    r"oso\s+de\s+peluche|wd-40|alfombra\s+de\s+bano|"
    r"whisky|whiskey|vodka|tequila|ginebra|brandy|cognac|aguardiente|champana|champagne|prosecco|"
    r"cervezas?|licor(?:es)?|crema\s+de\s+whisky|six\s*pack\s+cerveza|"
    r"(?<!vinagre\sde\s)vino\s+(?:tinto|blanco|rosado|espumoso|seco|dulce|importado|carmenere|cabernet|merlot|malbec|sauvignon|chardonnay)|"
    r"ron\s+(?:caldas|medellin|santa\s+fe|viejo|anejo|blanco|dorado|bacardi|havana|zacapa|hechicera|dictador|diplomatico)|"
    r"cigarrillos?|cajetilla|tabaco|vaper|vapeador(?:es)?|vaporizador(?:es)?\s+(?:de\s+)?nicotina|e-?liquid|"
    r"medicamentos?|acetaminofen|ibuprofeno|naproxeno|dolex|advil|aspirina|loratadina|cetirizina|"
    r"desloratadina|omeprazol|esomeprazol|buscapina|sal\s+de\s+frutas|pepto\s+bismol|"
    r"jarabe\s+(?:para\s+la\s+tos|expectorante)|suero\s+oral|pedialyte|hidraplus|electrolit\s+suero|"
    r"curitas|vendaje|gasa\s+esteril|isodine|tensiometro|jeringa|preservativo|condon|prueba\s+de\s+embarazo|"
    r"incontinencia|panal(?:es)?\s+(?:de\s+|para\s+)?adulto|tena\s+(?:pants|slip|discreet|lady|men|protector|toalla|ropa)|"
    r"plenitud|cotidian|lubricante\s+(?:intimo|sexual|personal)|gel\s+lubricante|"
    r"calzon(?:cito)?\s+entrenador|pantalon(?:cito)?\s+entrenador|asiento\s+entrenador|tapete\s+entrenador|"
    r"alfombra\s+(?:sala|decorativa|piso|bano|[0-9]+)|tapete\s+(?:decorativo|bano|entrada|piso)|"
    r"pintura\s+(?:vinilo|esmalte|exterior|interior)|sanitario\s+y|lavamanos|caminadora\s+para\s+bebe|"
    r"coche\s+para\s+bebe|silla\s+de\s+carro|manicure|pedicure|arenero|comedero|bebedero|cortaunas|"
    r"cigarrilo|marlboro|rothmans|lucky\s+strike|terea|iqos|cronografo|"
    r"reloj\s+(?:1a|invicta|casio|analogico|digital|deportivo|pulsera)|peluche|"
    r"preparacion\s+del\s+pedido|donacion(?:es)?|huevos?\s+(?:sorpresa|didacticos)|vara\s+de\s+burbujas|"
    r"disfraz(?:es)?|ron\s+(?:extraviejo|esencial|extra\s+anejo|marques|viejo\s+de\s+caldas)|"
    r"(?:coctel|aperitivo)\s+smirnoff|smirnoff\s+ice|crema\s+de\s+ron|four\s*loko|jagermeister|"
    r"absolut\s+vodka|old\s+parr|johnnie\s+walker|chivas\s+regal|"
    r"vuse|epod|heets|belmont|boston|mustang|chesterfield|"
    r"vick\s+vaporub|noraver|enterogermina|mareol|noxpirin|loperamida|diclofenaco|losartan|"
    r"metformina|atorvastatina|amoxicilina|azitromicina|clotrimazol|betametasona|hidrocortisona|"
    r"desenfriol|pax\s+noche|alikal|sal\s+andrews|alcohol\s+antiseptico|unguento|"
    r"tinte|coloracion\s+(?:capilar|permanente|semipermanente)|retocador\s+de\s+raiz|"
    r"decolorante\s+(?:capilar|en\s+polvo)|"
    r"agua\s+micelar|serum\s+(?:facial|babaria|catrice|antiedad)|contorno\s+de\s+ojos|"
    r"corrector\s+de\s+ojeras|delineador\s+(?:de\s+)?ojos|pestanas\s+postizas|"
    r"iluminador\s+(?:facial|liquido)|primer\s+facial|fijador\s+de\s+maquillaje|"
    r"brocha\s+(?:para\s+)?maquillaje|cortacuticula|pesos\s+de\s+propina|"
    r"bolsa\s+(?:plastica|ecologica\s+reutilizable)"
    r")\b",
    re.IGNORECASE,
)


def strip_accents_lower(text: str | None) -> str:
    """Normaliza tildes/eñes y minúsculas para evaluación consistente."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFD", text.lower())
    without_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return " ".join(without_marks.split())


_CONTAINER_CLEAN_CHILD_HINTS: tuple[str, ...] = (
    "aseo",
    "limpieza",
    "cuidado del hogar",
    "cuidado de la ropa",
    "lavanderia",
    "desechable",
    "natilla",
    "bunuelo",
    "cuidado personal",
    "cuidado oral",
    "cuidado corporal",
    "cuidado capilar",
    "cuidado facial",
    "cuidado solar",
    "cuidado de la piel",
    "cuidado del cabello",
    "cuidado para el cabello",
    "fijadores",
    "cremas de peinar",
    "protector solar",
    "proteccion solar",
    "bloqueadores",
    "repelentes",
    "cremas hidratantes",
    "cremas humectantes",
    "shampoo",
    "acondicionador",
    "tratamientos",
    "banos de crema",
    "depilacion",
    "panales",
    "panitos",
    "cuidado intimo",
    "higiene intima",
    "proteccion sanitaria",
    "marcas propias",
    "utensilios limpieza",
    "plasticos para el hogar",
    "plasticos",
    "bolsas reutilizables",
    "aseo del bebe",
    "cuidado de bebes",
    "salud dental",
    "salud oral",
    "capilar",
    "corporal",
    "facial",
    "detergentes",
    "jabones",
    "suavizantes",
    "prelavado",
    "dermo",
    "jaboneria",
    "papel higienico",
    "desodorante",
    "afeitado",
    "proteccion femenina",
    "higiene",
    "perros",
    "gatos",
    "aves",
)

_MIXED_PARENT_CONTAINER_NORMS: frozenset[str] = frozenset(
    {
        "hogar",
        "hogar, mascotas y otros.",
        "hogar, mascotas y otros",
        "hogar cocina",
        "navidad",
        "especiales",
        "cuidado personal y belleza",
        "belleza y cuidado personal",
        "salud y belleza",
        "belleza",
        "juguetes, cunas y todo para tu bebe",
        "cuidado de ropa y calzado",
        "bolsas",
        "plasticos para el hogar",
        "utensilios para limpieza",
        "drogueria y mascotas",
    }
)

_ALLOWED_CATEGORY_EXEMPTIONS: tuple[str, ...] = (
    "bebidas sin licor",
    "blanqueadores y quitamanchas ropa",
    "cuidado de la ropa",
    "detergentes para ropa",
    "desmanchadores ropa",
    "especiales cuidado de la ropa",
    "jabones de lavar ropa",
    "ropa color",
    "variedades tortillas",
    "restauradores muebles y alfombras",
    "limpieza muebles y otros",
    "limpiadores de alfombra",
    "accesorios de bano",
    "banos de crema",
    "bolsas reutilizables",
)


def is_mercado_category_name(name: str | None) -> bool:
    """Determina si una categoría VTEX pertenece a supermercado / mercado."""
    norm = strip_accents_lower(name)
    if not norm:
        return True
    if any(exempt in norm for exempt in _ALLOWED_CATEGORY_EXEMPTIONS):
        return True
    if norm in {"hogar", "ron", "bolsa", "bolsas", "especiales", "navidad", "halloween", "san valentin", "otros"}:
        return False
    return not _NON_GROCERY_CATEGORY_RE.search(norm)


def is_priority_grocery_category_name(name: str | None) -> bool:
    """Prioriza las categorías de alimentos/aseo al recorrer árboles VTEX."""
    norm = strip_accents_lower(name)
    return any(token in norm for token in _PRIORITY_GROCERY_CATEGORIES)


def is_mercado_category_path(category_path: Sequence[str] | None) -> bool:
    """Valida todos los segmentos de la ruta de categoría de un producto."""
    if not category_path:
        return True
    norms = [strip_accents_lower(seg) for seg in category_path if strip_accents_lower(seg)]
    if not norms:
        return True
    for idx, seg in enumerate(norms):
        is_last = idx == len(norms) - 1
        # Permite contenedores padre mixtos (`Hogar > Aseo y limpieza`, `Salud y belleza > Cuidado capilar`,
        # `Belleza > Cuidado facial`, `Hogar Cocina > Utensilios Limpieza`, etc.) si los hijos son válidos.
        if not is_last and seg in _MIXED_PARENT_CONTAINER_NORMS:
            tail = " ".join(norms[idx + 1 :])
            if any(hint in tail for hint in _CONTAINER_CLEAN_CHILD_HINTS) or "alimento" in tail or "mascota" in tail:
                continue
        # Excepción específica de Euro: `Mercado > Aseo hogar > Botiquin` (mantiene bloqueado `Botiquín OTC`).
        if seg == "botiquin" and idx > 0 and "aseo hogar" in norms[idx - 1]:
            continue
        # Nodo hoja genérico `Otros` dentro de una rama válida (ej. `Limpieza > Desechables - Plásticos > Otros`).
        if is_last and seg == "otros" and idx > 0:
            continue
        if not is_mercado_category_name(seg):
            return False
    return True


_WHITELIST_POSITIVE_TOKENS: tuple[str, ...] = (
    # Contenedores generales y subcategorías de alimentos
    "supermercado",
    "mercado",
    "despensa",
    "canasta familiar",
    "abarrotes",
    "alimentos",
    "alimento",
    "alimentacion",
    "gran consumo",
    "delicatessen",
    "delikatessen",
    "charcuteria",
    "lacteos",
    "leche",
    "leches",
    "huevos",
    "huevo",
    "yogurt",
    "yogur",
    "yogures",
    "kumis",
    "avena",
    "avenas",
    "mantequilla",
    "mantequillas",
    "margarina",
    "margarinas",
    "queso",
    "quesos",
    "quesito",
    "quesitos",
    "cuajada",
    "sueros",
    "crema de leche",
    "pollo",
    "carnes",
    "carne",
    "res",
    "cerdo",
    "cordero",
    "ternera",
    "pavo",
    "conejo",
    "bufalo",
    "pescado",
    "pescados",
    "mariscos",
    "salmon",
    "langostinos",
    "atun",
    "sardinas",
    "embutidos",
    "carnes frias",
    "salchichas",
    "salchichon",
    "jamon",
    "jamones",
    "mortadela",
    "chorizo",
    "chorizos",
    "tocineta",
    "tocino",
    "hamburguesas",
    "nuggets",
    "frutas",
    "fruta",
    "verduras",
    "verdura",
    "hortalizas",
    "tuberculos",
    "hierbas",
    "arroz",
    "granos",
    "frijol",
    "frijoles",
    "lenteja",
    "lentejas",
    "garbanzo",
    "arvejas",
    "quinua",
    "pasta",
    "pastas",
    "lasagnas",
    "lasañas",
    "pizzas",
    "arepas",
    "arepa",
    "tortillas",
    "empanadas",
    "tamales",
    "aceite",
    "aceites",
    "oliva",
    "vinagre",
    "vinagres",
    "azucar",
    "panela",
    "panelas",
    "endulzante",
    "endulzantes",
    "miel",
    "cafe",
    "cafes",
    "chocolate",
    "chocolates",
    "cocoa",
    "infusiones",
    "aromaticas",
    "te",
    "tes",
    "cereales",
    "cereal",
    "granolas",
    "granola",
    "harina",
    "harinas",
    "premezclas",
    "pre-mezclas",
    "feculas",
    "salsas",
    "salsa",
    "aderezos",
    "condimentos",
    "alinos",
    "especias",
    "sal",
    "caldos",
    "sopas",
    "cremas",
    "enlatados",
    "envasados",
    "conservas",
    "encurtidos",
    "antipastos",
    "antipasto",
    "mermeladas",
    "untables",
    "esparcibles",
    "panaderia",
    "reposteria",
    "galletas",
    "galleteria",
    "tostadas",
    "ponques",
    "tortas",
    "postres",
    "flanes",
    "gelatinas",
    "dulces",
    "dulceria",
    "confiteria",
    "chicles",
    "gomitas",
    "caramelos",
    "snacks",
    "pasabocas",
    "frutos secos",
    "mani",
    "nueces",
    "semillas",
    "papas fritas",
    "platanitos",
    "crispetas",
    "maiz",
    "bebidas",
    "bebida",
    "aguas",
    "agua",
    "gaseosas",
    "sodas",
    "jugos",
    "refrescos",
    "nectares",
    "maltas",
    "hidratantes",
    "energizantes",
    "isotonicos",
    "isotonica",
    "congelados",
    "congelado",
    "congelada",
    "helados",
    "hielo",
    "pulpa",
    "pulpas",
    "comidas preparadas",
    "comida preparada",
    "comida lista",
    "comidas listas",
    "precocida",
    "precocidos",
    "compotas",
    "papillas",
    "coladas",
    "formula infantil",
    "formulas infantiles",
    "complementos infantiles",
    "nutricion infantil",
    "natillas",
    "bunuelos",
    "anchetas",
    "saludable",
    "organico",
    "organica",
    "sin azucar",
    "sin gluten",
    "sin lactosa",
    "bajo en sodio",
    "veganos",
    "marcas propias",
    "marca propia",
    "campeones del ahorro",
    "mega ofertas",
    "navidad makro",
    "semana friko",
    "importados",
    "desayuno",
    "yia life",
    "vive vital",
    # Aseo del hogar / limpieza / lavandería
    "aseo",
    "limpieza",
    "limpiador",
    "limpiadores",
    "limpiavidrios",
    "higiene del hogar",
    "cuidado del hogar",
    "cuidado hogar",
    "cuidado de la ropa",
    "cuidado de ropa y calzado",
    "lavanderia",
    "detergente",
    "detergentes",
    "blanqueador",
    "blanqueadores",
    "suavizante",
    "suavizantes",
    "lavaloza",
    "lavalozas",
    "lavaplatos",
    "desengrasante",
    "desengrasantes",
    "desinfectante",
    "desinfectantes",
    "desmanchador",
    "desmanchadores",
    "prelavado",
    "ambientador",
    "ambientadores",
    "insecticida",
    "insecticidas",
    "desechables",
    "desechable",
    "papel higienico",
    "servilletas",
    "toallas de cocina",
    "papel aluminio",
    "bolsas de basura",
    "bolsas multiusos",
    "bolsas recerrables",
    "bolsas reutilizables",
    "bolsas sanitarias",
    "plasticos para el hogar",
    "utensilios limpieza",
    "utensilios para limpieza",
    "velas",
    "velones",
    "carbon",
    "fosforos",
    "pilas",
    "baterias",
    "betun",
    "betunes",
    "escobas",
    "traperos",
    "trapeadores",
    "esponjas",
    "guantes",
    "panos multiusos",
    "restauradores",
    # Aseo e higiene personal / capilar / corporal / facial / oral / solar
    "higiene",
    "cuidado personal",
    "aseo personal",
    "cuidado capilar",
    "cuidado del cabello",
    "cuidado para el cabello",
    "cuidado corporal",
    "cuidado facial",
    "cuidado de la piel",
    "cuidado solar",
    "proteccion solar",
    "protector solar",
    "fotoprotectores",
    "bloqueadores",
    "dermocosmetica",
    "dercosmeticos",
    "dermo",
    "shampoo",
    "shampoos",
    "acondicionador",
    "acondicionadores",
    "banos de crema",
    "cremas para peinar",
    "cremas de peinar",
    "tratamientos capilares",
    "fijadores",
    "desodorante",
    "desodorantes",
    "jabon",
    "jabones",
    "jaboneria",
    "talcos",
    "cuidado oral",
    "salud oral",
    "cuidado bucal",
    "crema dental",
    "cremas dentales",
    "cepillos dentales",
    "cepillos de dientes",
    "enjuague bucal",
    "enjuagues bucales",
    "seda dental",
    "sedas dentales",
    "ortodoncia",
    "afeitado",
    "afeitada",
    "depilacion",
    "higiene intima",
    "cuidado intimo",
    "proteccion femenina",
    "proteccion sanitaria",
    "toallas higienicas",
    "tampones",
    "protectores diarios",
    "panitos",
    "panuelos",
    "repelentes",
    "spa",
    # Bebé (alimentación / higiene / pañales válidos)
    "panales",
    "panal",
    "antipanalitis",
    "toallitas",
    "aspirador nasal",
    "termometro",
    "termometros",
    "cuidado del bebe",
    "cuidado de bebes",
    "salud y aseo del bebe",
    "cuidado, salud e higiene del bebe",
    "mundo bebes",
    "mundo del bebe",
    "alimentacion para bebes",
    "alimentacion del bebe",
    "lactancia",
    "extractor",
    "teteros",
    "chupos",
    "esterilizador",
    "bacinillas",
    "baneras",
    "panalera",
    "baberos",
    "mordedera",
    "llamadientes",
    "rasca encias",
    "cuidado de la colita",
    "bano del bebe",
    "bano bebe",
    # Extras reales verificados de catálogos de mercado
    "bolsas para basura",
    "comidas enlatadas",
    "crema",
    "gelatina",
    "mezclas saladas",
    "pastelitos",
    "pochoclos",
    "quitamancha",
    "reparacion y tratamiento",
    "hilo dental",
    "seda/hilo dental",
    "vegetales enlatadas",
    "combos",
    "para tu hogar",
    "recipientes plasticos",
    # Mascotas (alimentos e higiene aprobados)
    "mascotas",
    "mascota",
    "perros",
    "gatos",
    "aves",
    "peces",
    "roedores",
    "concentrado",
)

_WHITELIST_POSITIVE_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(tok) for tok in sorted(_WHITELIST_POSITIVE_TOKENS, key=len, reverse=True)) + r")\b"
)

_BABY_VALID_CHILD_RE = re.compile(
    r"\b(?:alimentacion|alimentos?|complementos?\s+infantiles?|nutricion\s+infantil|compotas?|papillas?|coladas?|cereales?|leches?|formulas?|"
    r"panales?|panitos?|toallitas?|antipanalitis|aceites?|cremas?|jabon(?:es)?|shampoo|talcos?|"
    r"aseo|higiene|salud\s+dental|aspirador\s+nasal|termometros?|lactancia|extractor|teteros?|chupos?|"
    r"esterilizador|baberos?|mordedera|llamadientes|bacinillas?|baneras?|cuidado\s+(?:de(?:l)?\s+)?bebes?|"
    r"cuidado\s+de\s+la\s+colita|bano\s+(?:del\s+)?bebe)\b"
)

_PET_BLOCKED_CHILD_RE = re.compile(
    r"\b(?:accesorios?|arenero|comederos?|bebederos?|correas?|guacal(?:es)?|camas?|collares?|plaquitas?|pecheras?|"
    r"impermeables?|peluches?|mantas?|cuchillas?|maquinas?\s+peluqueras?|palas?\s+sanitarias?|tapetes?\s+sanitarios?|cortaunas)\b"
)


def evaluate_category_path_whitelist(
    category_path: Sequence[str] | None,
) -> tuple[Literal["ALLOW", "DENY", "UNKNOWN"], str]:
    """Lista blanca contextual por ruta completa para decidir antes de hacer scraping."""
    if not category_path:
        return "ALLOW", "sin ruta de categoría"

    norms = [strip_accents_lower(seg) for seg in category_path if strip_accents_lower(seg)]
    if not norms:
        return "ALLOW", "sin ruta de categoría"

    if not is_mercado_category_path(norms):
        return "DENY", "excluida por regla contextual/lista negra"

    joined = " > ".join(norms)

    # Contexto mascotas: nunca bajar nodos de accesorios/areneros/camas/correas aunque digan 'mascotas'
    if any(tok in joined for tok in ("mascota", "perros", "gatos")):
        if _PET_BLOCKED_CHILD_RE.search(joined):
            return "DENY", "subcategoría de accesorios físicos para mascotas"

    # Contexto bebé: solo ALLOW si la ruta tiene señales reales de alimentación, pañales o aseo/higiene
    if any(tok in joined for tok in ("bebe", "bebes", "infantil")):
        if not _BABY_VALID_CHILD_RE.search(joined):
            return "UNKNOWN", "categoría de bebé sin señal clara de alimento/higiene (omitida pre-scraping)"

    if _WHITELIST_POSITIVE_RE.search(joined):
        return "ALLOW", "coincide con lista blanca contextual de mercado"

    return "UNKNOWN", "categoría nueva/desconocida fuera de lista blanca (omitida pre-scraping)"


def is_whitelisted_category_path(category_path: Sequence[str] | None) -> bool:
    """True únicamente cuando la ruta supera la lista blanca contextual (`ALLOW`)."""
    decision, _ = evaluate_category_path_whitelist(category_path)
    return decision == "ALLOW"


def is_mercado_product(
    store_id: str | None,
    name: str | None,
    brand: str | None = None,
    raw_url: str | None = None,
    category_path: Sequence[str] | None = None,
) -> bool:
    """Retorna True solo si la tienda y el SKU corresponden a productos de mercado."""
    store_norm = (store_id or "").strip().lower()
    if store_norm not in GROCERY_STORE_IDS:
        return False

    name_norm = strip_accents_lower(name)
    if not name_norm:
        return False

    if category_path and not is_mercado_category_path(category_path):
        return False

    brand_norm = strip_accents_lower(brand)
    if brand_norm in _NON_GROCERY_BRANDS:
        return False

    if raw_url and _URL_EXCLUDED_RE.search(raw_url):
        return False

    if _PHRASE_EXCLUDED_RE.search(name_norm):
        return False

    if _MUNECA_RE.search(name_norm) and not _LA_MUNECA_RE.search(name_norm):
        return False

    if _WASHER_RE.search(name_norm) and not _GOMA_SECADORA_RE.search(name_norm):
        return False

    if _WINE_LIQUOR_RE.search(name_norm) and not _WINE_CULINARY_SAFE_RE.search(name_norm):
        return False

    if _WORD_EXCLUDED_RE.search(name_norm):
        return False

    return True
