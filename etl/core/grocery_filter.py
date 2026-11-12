"""Filtro unificado de catálogo para mantener únicamente productos y cadenas de mercado."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence

GROCERY_STORE_IDS: frozenset[str] = frozenset(
    {"carulla", "d1", "olimpica", "exito", "ara", "rappi"}
)

# Categorías raíz / subárboles VTEX claramente ajenos a mercado/supermercado.
_NON_GROCERY_CATEGORY_TOKENS: tuple[str, ...] = (
    "jugueteria",
    "electrodomesticos",
    "tecnologia",
    "celulares",
    "computadores",
    "televisores",
    "automotores",
    "llantas",
    "motos",
    "deportes",
    "marroquineria",
    "donaciones",
    "hogar y lenceria",
    "hogar cocina",
    "hogar y decoracion",
    "ferreteria",
    "moda",
    "ropa",
    "calzado",
    "utiles y papeleria",
    "papeleria",
    "decoracion",
    "instrumentos musicales",
    "libros",
    "movilidad electrica",
    "vehiculos",
    "eventos",
    "servicios",
    "fiesta",
    "navidad",
    "otras categorias",
    "colchones",
    "muebles",
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
    "panaderia",
    "congelados",
    "aseo",
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
    r"hogar-cocina|hogar-y-lenceria)/",
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
    r"medias?\s+ciclismo|linterna\s+tactica|multitoma|freno\s+disco)",
    re.IGNORECASE,
)

_MUNECA_RE = re.compile(r"\bmunec[oa]s?\b", re.IGNORECASE)
_LA_MUNECA_RE = re.compile(r"\bla\s+muneca\b", re.IGNORECASE)
_WASHER_RE = re.compile(r"\b(lavadora|secadora)\b", re.IGNORECASE)
_GOMA_SECADORA_RE = re.compile(r"\bgoma\s+secadora\b", re.IGNORECASE)

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
    r"morral|maleta|bolso\s+termico|base\s+liquida|sombras\s+surtidas\s+para\s+ojos|esponja\s+de\s+maquillaje"
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


def is_mercado_category_name(name: str | None) -> bool:
    """Determina si una categoría VTEX pertenece a supermercado / mercado."""
    norm = strip_accents_lower(name)
    if not norm:
        return True
    if norm == "hogar":
        return False
    return not any(token in norm for token in _NON_GROCERY_CATEGORY_TOKENS)


def is_priority_grocery_category_name(name: str | None) -> bool:
    """Prioriza las categorías de alimentos/aseo al recorrer árboles VTEX."""
    norm = strip_accents_lower(name)
    return any(token in norm for token in _PRIORITY_GROCERY_CATEGORIES)


def is_mercado_category_path(category_path: Sequence[str] | None) -> bool:
    """Valida todos los segmentos de la ruta de categoría de un producto."""
    if not category_path:
        return True
    return all(is_mercado_category_name(segment) for segment in category_path)


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

    if _WORD_EXCLUDED_RE.search(name_norm):
        return False

    return True
