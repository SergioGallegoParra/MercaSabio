"""Enriquecimiento determinista de catálogo:

1. Simplificación y homogeneización tipográfica de nombres (`simplify_display_name`):
   - Colapsa duplicados de VTEX/Olímpica (exactos o con sufijo en MAYÚSCULAS).
   - Elimina ruido redundante de gramaje/unidad cuando ya está en `net_content`/`unit_measure`.
   - Aplica Title Case inteligente en español (conectores en minúscula salvo al inicio,
     siglas válidas en mayúsculas y tildes seguras en sustantivos comunes).

2. Clasificación ampliada de categorías de supermercado (`infer_broad_category_slug`):
   - Conserva las 10 canastas estrictas de `canonical_mapper.py`.
   - Asigna el pasillo/categoría real de supermercado (~27 categorías adicionales) sin LLM.

3. Metadatos estructurados de subpresentación (`extract_product_metadata`):
   - `product_type`, `sub_presentation`, `sub_presentation_label`, `variant_tags`.
   - Evita mezclar subpresentaciones incompatibles (ej. leche deslactosada vs entera,
     café liofilizado vs instantáneo vs molido, atún en agua vs aceite de oliva).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Sequence

from etl.core.canonical_mapper import infer_canonical_category_slug
from etl.core.models import UnitMeasure

_SPANISH_CONNECTORS: frozenset[str] = frozenset(
    {
        "a",
        "al",
        "con",
        "de",
        "del",
        "e",
        "el",
        "en",
        "la",
        "las",
        "los",
        "o",
        "para",
        "por",
        "sin",
        "u",
        "y",
    }
)

_PRESERVED_UPPERCASE: frozenset[str] = frozenset(
    {
        "D1",
        "ARA",
        "OXXO",
        "UHT",
        "AA",
        "AAA",
        "BBQ",
        "UV",
        "SPF",
        "HD",
        "XL",
        "XXL",
        "PH",
        "LED",
        "USA",
        "VIP",
        "TV",
        "PC",
        "DHA",
        "B12",
        "C12",
        "PH7",
        "SPF50",
    }
)

_SAFE_SPANISH_ACCENTS: dict[str, str] = {
    "azucar": "Azúcar",
    "cafe": "Café",
    "jabon": "Jabón",
    "atun": "Atún",
    "jamon": "Jamón",
    "limon": "Limón",
    "maiz": "Maíz",
    "bano": "Baño",
    "unas": "Uñas",
    "higienico": "Higiénico",
    "higienica": "Higiénica",
    "organico": "Orgánico",
    "organica": "Orgánica",
    "liquido": "Líquido",
    "liquida": "Líquida",
    "clasico": "Clásico",
    "clasica": "Clásica",
    "instantaneo": "Instantáneo",
    "instantanea": "Instantánea",
    "pequeno": "Pequeño",
    "pequena": "Pequeña",
    "navideno": "Navideño",
    "navidena": "Navideña",
    "pina": "Piña",
    "sandia": "Sandía",
    "maracuya": "Maracuyá",
    "frances": "Francés",
    "arabe": "Árabe",
    "lacteo": "Lácteo",
    "lactea": "Láctea",
    "lacteos": "Lácteos",
    "bebes": "Bebés",
    "bebe": "Bebé",
    "champu": "Champú",
    "mani": "Maní",
    "alqueria": "Alquería",
    "olimpica": "Olímpica",
    "exito": "Éxito",
    "isimo": "Ísimo",
    "acuatico": "Acuático",
    "balsamico": "Balsámico",
    "citrico": "Cítrico",
    "desague": "Desagüe",
    "humedo": "Húmedo",
    "humeda": "Húmeda",
    "capsula": "Cápsula",
    "capsulas": "Cápsulas",
    "proteina": "Proteína",
    "vitamina": "Vitamina",
    "acido": "Ácido",
    "hialuronico": "Hialurónico",
    "colageno": "Colágeno",
    "ceramica": "Cerámica",
    "elastica": "Elástica",
    "rapido": "Rápido",
    "rapida": "Rápida",
    "antiedad": "Antiedad",
    "unica": "Única",
    "unico": "Único",
    "camaron": "Camarón",
    "salmon": "Salmón",
    "champinon": "Champiñón",
    "champinones": "Champiñones",
    "esparrago": "Espárrago",
    "esparragos": "Espárragos",
    "melocoton": "Melocotón",
    "platano": "Plátano",
    "brocoli": "Brócoli",
    "pimenton": "Pimentón",
    "oregano": "Orégano",
    "curcuma": "Cúrcuma",
    "paprika": "Páprika",
    "vainilla": "Vainilla",
}

_PAREN_WEIGHT_RE = re.compile(
    r"\(\s*(?:aprox\.?\s*)?(?:x\s*)?\d+(?:[.,]\d+)?\s*(?:g|gr|grs|gramos?|kg|kilos?|ml|cc|l|lt|lts|litros?|und|unds|un|unidad|unidades)\s*\)",
    re.IGNORECASE,
)
_MULTIPACK_WITH_WEIGHT_RE = re.compile(
    r"\b(?:x\s*)?\d+(?:[.,]\d+)?\s*(?:g|gr|grs|gramos?|kg|kilos?|ml|cc|l|lt|lts|litros?)\s*[xX×]\s*(\d+)\s*(?:und|unds|un|unidades?)?\b",
    re.IGNORECASE,
)
_WEIGHT_MULTIPACK_PREFIX_RE = re.compile(
    r"\b(\d+)\s*[xX×]\s*\d+(?:[.,]\d+)?\s*(?:g|gr|grs|gramos?|kg|kilos?|ml|cc|l|lt|lts|litros?)\b",
    re.IGNORECASE,
)
_INLINE_WEIGHT_RE = re.compile(
    r"(?:^|\s)(?:x\s*)?\d+(?:[.,]\d+)?\s*(?:g|gr|grs|gramos?|kg|kilos?|ml|cc|l|lt|lts|litros?)(?=\s|$|[,.;/\)])",
    re.IGNORECASE,
)
_UNIT_ONLY_RE = re.compile(
    r"(?:^|\s)(?:[xX×]\s*)?(\d+)\s*(?:und|unds|un|unidad|unidades)\b",
    re.IGNORECASE,
)
_PACKAGING_NOISE_RE = re.compile(
    r"\b(?:caj\s*1\s*fra|caj\b|fra\b|bsa\b|pte\b|unds?\b|unidad(?:es)?\b|peso\s+aprox\.?)\b",
    re.IGNORECASE,
)
_LEADING_NOISE_RE = re.compile(r"^(?:oferta|super\s+oferta|promo(?:cion)?)\s+", re.IGNORECASE)
_MULTIPACK_TOKEN_RE = re.compile(r"^[xX×](\d+)$")


def _strip_accents_lower(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text or "")
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", stripped.lower()).strip()


def _collapse_repeated_title_halves(text: str) -> str:
    """Colapsa títulos duplicados típicos de VTEX/Olímpica (exactos o con cola en MAYÚSCULAS)."""
    clean = re.sub(r"\s+", " ", text).strip()
    exact = re.sub(r"^(.{6,}?)\s+\1$", r"\1", clean, flags=re.IGNORECASE)
    if exact != clean:
        return exact.strip()

    words = clean.split()
    n = len(words)
    if n < 6:
        return clean

    # Detecta transiciones a un bloque en MAYÚSCULAS o reinicio repetido a partir del 35% del título
    start_idx = max(3, n // 3)
    for idx in range(start_idx, n - 1):
        prefix_words = words[:idx]
        suffix_words = words[idx:]
        if len(suffix_words) < 2:
            continue

        pref_norm = {
            tok
            for tok in (_strip_accents_lower(w).strip(".,;:-()") for w in prefix_words)
            if len(tok) >= 3 and not tok[0].isdigit()
        }
        suff_norm = [
            tok
            for tok in (_strip_accents_lower(w).strip(".,;:-()") for w in suffix_words)
            if len(tok) >= 3 and not tok[0].isdigit()
        ]
        if not pref_norm or not suff_norm:
            continue

        matches = sum(1 for tok in suff_norm if tok in pref_norm)
        overlap = matches / len(suff_norm)
        first_suff_tok = _strip_accents_lower(words[idx]).strip(".,;:-()")
        first_pref_tok = _strip_accents_lower(words[0]).strip(".,;:-()")
        starts_with_repeated_tok = len(first_suff_tok) >= 2 and (
            first_suff_tok in pref_norm or first_suff_tok == first_pref_tok
        )
        suffix_all_upper = sum(1 for w in suffix_words if w.isalpha() and w.isupper()) >= max(
            2, len(suffix_words) // 2
        )

        # Solo corta justo donde empieza la repetición real (evita recortar palabras clave como el sabor antes de la cola MAYÚS)
        if starts_with_repeated_tok and (
            overlap >= 0.65 or (suffix_all_upper and overlap >= 0.50 and matches >= 2)
        ):
            return " ".join(prefix_words).strip()

    return clean


def _smart_spanish_word(word: str, is_first: bool, had_mixed_case_acronym: bool = False) -> str:
    if not word:
        return ""
    m_pack = _MULTIPACK_TOKEN_RE.match(word)
    if m_pack:
        return f"x{m_pack.group(1)}"

    # Conserva marcas/códigos alfanuméricos tipo "Gc975", "L.A." o siglas puras conocidas
    stripped_punct = word.strip(".,;:-()/")
    upper_key = stripped_punct.upper()
    if upper_key in _PRESERVED_UPPERCASE:
        return word.replace(stripped_punct, upper_key) if stripped_punct else word

    # Siglas con puntos (ej. L.A., S.A.S.)
    if re.fullmatch(r"(?:[A-Za-z]\.){2,}", stripped_punct):
        return upper_key

    norm_low = _strip_accents_lower(stripped_punct)
    if not is_first and norm_low in _SPANISH_CONNECTORS:
        return norm_low

    # Restaura tilde segura si venía todo en mayúsculas sin tildes (o todo minúsculas sin tilde)
    if (word.isupper() or word.islower()) and norm_low in _SAFE_SPANISH_ACCENTS:
        accented = _SAFE_SPANISH_ACCENTS[norm_low]
        return word.replace(stripped_punct, accented)

    # Si contiene dígito + letra (ej. "50+", "x12", "Gc975")
    if any(ch.isdigit() for ch in word):
        if word.isupper():
            return word.lower() if word.lower().startswith("x") else word.capitalize()
        return word

    if not stripped_punct:
        return word

    # Capitaliza respetando guiones internos (ej. "sin-azucar")
    if had_mixed_case_acronym and word.isupper() and len(stripped_punct) <= 3 and norm_low not in _SPANISH_CONNECTORS:
        return upper_key

    lowered = stripped_punct.lower()
    if "-" in lowered:
        titled = "-".join(part.capitalize() for part in lowered.split("-"))
    else:
        titled = lowered[0].upper() + lowered[1:]
    return word.replace(stripped_punct, titled)


def simplify_display_name(
    raw_name: str,
    *,
    brand: str | None = None,
    net_content: Decimal | float | int | None = None,
    unit_measure: UnitMeasure | str | None = None,
) -> str:
    """Simplifica el título para lectura rápida y aplica Title Case en español."""
    if not raw_name or not raw_name.strip():
        return ""

    collapsed = _collapse_repeated_title_halves(raw_name)
    cleaned = _LEADING_NOISE_RE.sub("", collapsed).strip()
    cleaned = re.sub(r"\s*\(\s*\)\s*", " ", cleaned)

    unit_val = unit_measure.value if isinstance(unit_measure, UnitMeasure) else str(unit_measure or "").lower()

    # Preserva el multiplicador en multipacks cuyo net_content está en g/ml (ej. 580 g x12 -> x12)
    candidate = _PAREN_WEIGHT_RE.sub(" ", cleaned)
    if unit_val in ("g", "ml", ""):
        candidate = _MULTIPACK_WITH_WEIGHT_RE.sub(r" x\1 ", candidate)
        candidate = _WEIGHT_MULTIPACK_PREFIX_RE.sub(r" x\1 ", candidate)
    else:
        candidate = _MULTIPACK_WITH_WEIGHT_RE.sub(" ", candidate)
        candidate = _WEIGHT_MULTIPACK_PREFIX_RE.sub(" ", candidate)

    candidate = _INLINE_WEIGHT_RE.sub(" ", candidate)

    if unit_val == "und":
        candidate = _UNIT_ONLY_RE.sub(" ", candidate)
    else:
        # Si ya tiene peso separado, convierte "x 12 unds" -> "x12" (o elimina "x1 und")
        def _repl_unit(m: re.Match[str]) -> str:
            qty = int(m.group(1))
            return "" if qty <= 1 else f" x{qty}"

        candidate = _UNIT_ONLY_RE.sub(_repl_unit, candidate)

    candidate = _PACKAGING_NOISE_RE.sub(" ", candidate)
    candidate = re.sub(r"[,/|·-]+$", "", candidate).strip()
    candidate = re.sub(r"^[,/|·-]+", "", candidate).strip()
    candidate = re.sub(r"\s{2,}", " ", candidate).strip()
    # Elimina conectores colgantes al final tras quitar el gramaje (ej. "... en Bolsa de 1100 ml" -> "... en Bolsa")
    candidate = re.sub(r"(?:\s+(?:de|del|en|por|con|para|a|al|x))+$", "", candidate, flags=re.IGNORECASE).strip()

    # Respaldo de seguridad: nunca dejar un nombre vacío o de una sola sílaba sin contexto
    non_pack_words = [w for w in candidate.split() if not _MULTIPACK_TOKEN_RE.match(w) and len(w.strip(".,-")) >= 2]
    chosen = candidate if len(non_pack_words) >= 2 else collapsed

    words = chosen.split()
    has_mixed_case = any(w.islower() for w in words if w.isalpha())
    formatted_words: list[str] = []
    for idx, w in enumerate(words):
        formatted_words.append(_smart_spanish_word(w, is_first=(idx == 0), had_mixed_case_acronym=has_mixed_case))

    result = " ".join(formatted_words)
    result = re.sub(r"\s+", " ", result).strip()

    # Evita duplicar exactamente la marca al final si ya aparece al inicio (ej. "Alquería Leche ... Alquería")
    if brand and len(brand.strip()) >= 3:
        b_words = brand.strip().split()
        if len(b_words) == 1:
            b_norm = _strip_accents_lower(b_words[0])
            r_tokens = result.split()
            if len(r_tokens) >= 4 and _strip_accents_lower(r_tokens[-1]) == b_norm and any(
                _strip_accents_lower(t) == b_norm for t in r_tokens[:-1]
            ):
                result = " ".join(r_tokens[:-1])

    return result[:255] if result else collapsed[:255]


@dataclass(frozen=True, slots=True)
class BroadCategoryRule:
    slug: str
    pattern: re.Pattern[str]
    exclude: re.Pattern[str] | None = None


def _rx(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


BROAD_CATEGORY_RULES: tuple[BroadCategoryRule, ...] = (
    # 1. Bebés y Mascotas (alta prioridad para que "shampoo bebé" o "alimento perro" no caigan mal)
    BroadCategoryRule(
        "mascotas",
        _rx(
            r"\b(mascotas?|perros?|gatos?|cachorros?|dog\s*chow|cat\s*chow|chunky|whiskas|pedigree|"
            r"ringo|mirringo|pro\s*plan|nutra\s*nuggets|felix\s+gato|arena\s+(?:para\s+)?gato|"
            r"hueso\s+(?:para\s+)?perro|collar\s+(?:perro|gato))\b"
        ),
    ),
    BroadCategoryRule(
        "bebes-y-maternidad",
        _rx(
            r"\b(panal(?:es)?|panitos\s+humedos\s+bebe|bebe|baby|infantil|etapa\s*[1234]|nan\s*(?:optipro|confort)?|"
            r"similac|enfamil|enfagrow|pediasure|nestogeno|alpina\s+baby|compota|tetero|chupo|maternidad|lactancia)\b"
        ),
        exclude=_rx(r"\b(aceite\s+de\s+bebe|jabon\s+liquido\s+corporal\s+adulto)\b"),
    ),
    # 2. Vinos, cervezas y licores
    BroadCategoryRule(
        "vinos-cervezas-y-licores",
        _rx(
            r"\b(vinos?|cabernet|merlot|malbec|sauvignon|chardonnay|carmenere|rosado\s+vino|cervezas?|"
            r"aguila|poker|club\s+colombia|heineken|stella\s+artois|corona\s+extra|budweiser|costena|"
            r"whisky|whiskey|buchanan|old\s+parr|johnnie\s+walker|ron\s+(?:medellin|caldas|viejo|santa\s+fe)|"
            r"aguardiente|nectar\s+(?:verde|rojo|azul)|antioqueno|vodka|smirnoff|tequila|jose\s+cuervo|"
            r"ginebra|gin|champagne|prosecco|espumoso|licor(?:es)?|sangria|sixpack\s+cerveza)\b"
        ),
        exclude=_rx(r"\b(vinagre|copas?\s+cristal|salchicha|jamon|chorizo)\b"),
    ),
    # 3. Cuidado personal y belleza
    BroadCategoryRule(
        "cuidado-personal-e-higiene",
        _rx(
            r"\b(shampoo|champu|acondicionador|tratamiento\s+capilar|mascarilla\s+capilar|crema\s+para\s+peinar|"
            r"gel\s+(?:para\s+)?cabello|tinte\s+(?:de\s+|para\s+)?(?:pelo|cabello)|rizadores?\s+de\s+pelo|"
            r"varillas.*onduladoras|esmalte|labial|delineador|corrector\s+.*(?:conceal|ojeras|facial)|"
            r"maquillaje|pestanina|rimel|rubor|polvo\s+compacto|agua\s+micelar|serum\s+facial|protector\s+solar|"
            r"bloqueador\s+solar|crema\s+(?:dental|facial|corporal|hidratante|manos|piel|noche|dia|antiedad)|"
            r"pasta\s+dental|dentrifico|cepillo\s+(?:de\s+)?dientes|enjuague\s+bucal|seda\s+dental|colgate|oral\s*b|"
            r"sensodyne|desodorante|antitranspirante|jabon\s+(?:de\s+bano|tocador|corporal|liquido\s+manos|en\s+barra)|"
            r"papel\s+higienic\w*|toallas?\s+higienicas?|protector\s+diario|tampon(?:es)?|panuelos\s+faciales|"
            r"cuchilla\s+afeitar|rasuradora|espuma\s+afeitar|talco|locion|perfume|colonia|un[ae]s\s+postizas|"
            r"lampara\s+de\s+unas|toallitas\s+desmaquillantes|algodon|copitos)\b"
        ),
        exclude=_rx(r"\b(perro|gato|mascota|bano\s+limpiador\s+pisos)\b"),
    ),
    # 4. Aseo hogar y lavandería
    BroadCategoryRule(
        "aseo-hogar-y-lavanderia",
        _rx(
            r"\b(detergente|jabon\s+(?:en\s+polvo|liquido\s+ropa|barra\s+ropa|rey)|suavizante|suavitel|downy|"
            r"aromatel|unstopables|blanqueador|cloro|hipoclorito|limpido|limpiador|desinfectante|fabuloso|ajax|"
            r"lavaloza|lavaplatos|axion|quitamanchas|desengrasante|ambientador|aromatizante|glade|air\s*wick|"
            r"insecticida|raid|baygon|bolsas?\s+(?:de\s+|para\s+)?basura|esponja\s+(?:loza|cocina|acero)|"
            r"trapero|escoba|recogedor|guantes\s+aseo|toallas?\s+de\s+cocina|servilletas?|limpia\s+vidrios|"
            r"cera\s+(?:para\s+)?pisos|varsol|lustramuebles|betun)\b"
        ),
    ),
    # 5. Salud y farmacia
    BroadCategoryRule(
        "salud-y-farmacia",
        _rx(
            r"\b(acetaminofen|ibuprofeno|naproxeno|aspirina|dolex|advil|pirantel|lyrica|omeprazol|esomeprazol|"
            r"loratadina|cetirizina|desloratadina|amoxicilina|azitromicina|metformina|losartan|atorvastatina|"
            r"vitamina\s*[abcdek]|multivitamin|colageno|magnesio|zinc|melatonina|probiotico|suero\s+oral|"
            r"electrolit|pedialyte|jarabe|tabletas?\b|comprimidos?\b|capsulas?\s+(?:blandas|duras|caja|x\s*\d+)|"
            r"gotas?\s+(?:oftalmic|otic|oral)|unguento|pomada|curita|vendaje|gasa\b|alcohol\s+antiseptico|"
            r"agua\s+oxigenada|preservativo|condon|prueba\s+embarazo|antihistaminic|analgesic|antigripal|"
            r"genfar|mk\b|tecnoquimicas|bayer|pfizer|la\s+sante|procaps)\b"
        ),
        exclude=_rx(r"\b(cafe|dolce\s+gusto|nespresso|capsulas\s+de\s+cafe)\b"),
    ),
    # 6. Café, té y chocolate de mesa
    BroadCategoryRule(
        "cafe-te-y-chocolate",
        _rx(
            r"\b(cafe|nescafe|juan\s+valdez|sello\s+rojo|colcafe|buendia|oma|tostao|quindio\s+cafe|"
            r"capuchino|cappuccino|expreso|espresso|latte|moccaccino|te\s+(?:verde|negro|chai|rojo|blanco|matcha|bitaco|hindu)|"
            r"aromatica|infusion|manzanilla|hierbabuena|milo|chocolisto|cocoa|cacao\s+en\s+polvo|"
            r"chocolate\s+(?:de\s+mesa|en\s+pastilla|sol|luker|corona|quesada|tradicional\s+mesa))\b"
        ),
        exclude=_rx(r"\b(helado|torta|galleta|chocolatina|caramelo|gomita|jabon|shampoo|diadema|tono\s+cafe|tinte)\b"),
    ),
    # 7. Yogures y kumis
    BroadCategoryRule(
        "yogures-y-kumis",
        _rx(r"\b(yogur(?:t)?|kumis|kefir|yox|bon\s*yurt|regene?ris|finesse\s+yogur|avena\s+alpina|bebida\s+lactea\s+fermentada)\b"),
        exclude=_rx(r"\b(galleta|cereal|helado\s+de\s+yogurt)\b"),
    ),
    # 8. Quesos y mantequillas
    BroadCategoryRule(
        "quesos-y-mantequillas",
        _rx(
            r"\b(quesos?|quesito|mozzarella|campesino|cuajada|doble\s+crema|parmesan\w*|cheddar|peraque|"
            r"holandes|sabana|provolone|ricotta|mascarpone|philadelphia|queso\s+crema|mantequilla|margarina|"
            r"rama|la\s+fina|esparcible|ghee|suero\s+costeno)\b"
        ),
        exclude=_rx(r"\b(papa|doritos|cheetos|snack|pasabocas|sabor\s+a\s+queso|galleta|empanada|dedito|mani|cacao)\b"),
    ),
    # 9. Lácteos y leches
    BroadCategoryRule(
        "lacteos-y-leches",
        _rx(
            r"\b(leche\s+(?:deslactosada|descremada|semidescremada|entera|en\s+polvo|condensada|evaporada|klim|"
            r"alqueria|colanta|alpina|parmalat|latti|pomona)|leche\b|bebida\s+(?:de\s+)?(?:almendras?|soya|soja|avena|coco|arroz)|"
            r"crema\s+de\s+leche|arequipe\s+.*leche)\b"
        ),
        exclude=_rx(r"\b(galleta|chocolate|chocolatina|helado|pan|dulce\s+de\s+leche\s+caramelo|jabon|crema\s+corporal)\b"),
    ),
    # 10. Huevos
    BroadCategoryRule(
        "huevos-y-derivados",
        _rx(r"\b(huevos?\s+(?:de\s+gallina|codorniz|rojos?|blancos?|aa+|jumbo|tipo\s*a|campo\s+libre|organico)|claras?\s+de\s+huevo)\b"),
        exclude=_rx(r"\b(chocolate|kinder|pascua|sorpresa|pasta|fideo|shampoo)\b"),
    ),
    # 11. Enlatados y conservas
    BroadCategoryRule(
        "enlatados-y-conservas",
        _rx(
            r"\b(atun|sardina|salmon\s+en\s+lata|maicitos|maiz\s+tierno\s+lata|aceituna|alcaparra|pepinillo|"
            r"champinon(?:es)?\s+enlatad|antipasto|esparragos|melocoton(?:es)?\s+en\s+almibar|pina\s+en\s+almibar|"
            r"frijol(?:es)?\s+(?:enlatad|lata|refrit|antioquen|ranchero)|ensalada\s+en\s+lata)\b"
        ),
    ),
    # 12. Jamones y embutidos
    BroadCategoryRule(
        "jamones-y-embutidos",
        _rx(
            r"\b(jamon|salchich(?:a|on)|chorizo|mortadela|salami|tocineta|cabano|butifarra|pepperoni|"
            r"jamoneta|pernil\s+ahumado|pavo\s+tajado)\b"
        ),
        exclude=_rx(r"\b(galleta|snack|papa|perro\s+mascota)\b"),
    ),
    # 13. Carnes, pollo y pescado
    BroadCategoryRule(
        "carnes-pollo-pescado",
        _rx(
            r"\b(pollo|pechuga|muslo|contramuslo|pernil\s+de\s+pollo|alas?\s+de\s+pollo|carne\s+(?:de\s+res|molida|cerdo)|"
            r"lomo\s+de\s+(?:res|cerdo)|sobrebarriga|chatas|punta\s+de\s+anca|costilla|chuleta|higado|pescado|"
            r"salmon\b|tilapia|trucha|mojarra|bagre|basa|camaron(?:es)?|langostino|calamar|mariscos|hamburguesa\s+carne)\b"
        ),
        exclude=_rx(r"\b(caldo|sopa|crema\s+de|sazonador|perro|gato|mascota|empanada|nugget)\b"),
    ),
    # 14. Pastas y fideos
    BroadCategoryRule(
        "pastas-y-fideos",
        _rx(
            r"\b(pasta\s+(?:seca|espagueti|larga|corta|integral|sin\s+gluten|de\s+arroz)|espagueti|spaghetti|"
            r"tallarin(?:es)?|fusilli|penne|macarron(?:es)?|tornillo|conchitas|fideo|lasagna|lasana|"
            r"ravioli|tortellini|fetuccini|fettuccine|ramen|maruchan|sopa\s+instantanea)\b"
        ),
        exclude=_rx(r"\b(pasta\s+dental|pasta\s+de\s+tomate|dientes)\b"),
    ),
    # 15. Arroces, granos y cereales
    BroadCategoryRule(
        "arroces-y-granos",
        _rx(
            r"\b(arroz|lenteja|frijol|garbanzo|arveja\s+seca|blanquillo|caraota|quinua|quinoa|chia|"
            r"maiz\s+pira|avena|granola|cereal|corn\s+flakes|zucaritas|choco\s*krispis|froot\s+loops|muesli|linaza)\b"
        ),
        exclude=_rx(r"\b(galleta|pan\b|tortilla|bebida\s+de\s+arroz|crema\s+corporal|jabon)\b"),
    ),
    # 16. Harinas y repostería
    BroadCategoryRule(
        "harinas-y-reposteria",
        _rx(
            r"\b(harina|premezcla|mezcla\s+(?:para\s+)?(?:pancake|torta|brownie|waffle|bunuelo|pandebono|natilla)|"
            r"maicena|fecula|polvo\s+(?:para\s+)?hornear|levadura|bicarbonato\s+cocina|gelatina|pudin|flan|"
            r"esencia\s+(?:de\s+)?vainilla|crema\s+chantilly|leche\s+condensada)\b"
        ),
    ),
    # 17. Panadería y arepas
    BroadCategoryRule(
        "panaderia-y-arepas",
        _rx(
            r"\b(pan\s+(?:tajado|blanco|integral|artesan|molde|hamburguesa|perro|coco|queso|suave|bimbo|comapan)|"
            r"arepa(?:s)?|tortilla(?:s)?\s+(?:de\s+)?(?:harina|maiz|trigo|tacos)|tostada(?:s)?|calado|crouton|"
            r"ponque|ramo|chocoramo|gansito|bimbolete|croissant|mogolla|panque|brioche|baguette|wrap)\b"
        ),
        exclude=_rx(r"\b(pan\s+rallado\s+condimento|sarten|tostadora)\b"),
    ),
    # 18. Aceites y vinagres
    BroadCategoryRule(
        "aceites-y-vinagres",
        _rx(
            r"\b(aceite\s+(?:de\s+)?(?:oliva|girasol|canola|soya|maiz|vegetal|aguacate|coco\s+virgen|ajonjoli)|"
            r"oleo|vinagre|aceto\s+balsamico|manteca\s+vegetal)\b"
        ),
        exclude=_rx(r"\b(cabello|corporal|masaje|bebe|motor|atun|sardina|esencial)\b"),
    ),
    # 19. Azúcar, panela y endulzantes
    BroadCategoryRule(
        "azucar-panela-miel",
        _rx(
            r"\b(azucar|panela|miel\s+(?:de\s+abejas|pura|natural)|stevia|estevia|sucralosa|splenda|"
            r"endulzante|edulcorante|sirope|jarabe\s+(?:de\s+)?(?:maple|pancake|agave))\b"
        ),
        exclude=_rx(r"\b(sin\s+azucar|cero\s+azucar|galleta|gaseosa|jugo|yogurt|cereal|chocolat)\b"),
    ),
    # 20. Salsas, caldos y condimentos
    BroadCategoryRule(
        "salsas-y-condimentos",
        _rx(
            r"\b(salsa|ketchup|mayonesa|mostaza|pasta\s+de\s+tomate|napolitana|bbq|teriyaki|guacamole|"
            r"aderezo|vinagreta|caldo\s+(?:de\s+)?(?:gallina|costilla|verduras)|maggie|ricostilla|knorr|"
            r"sal\s+(?:refinada|marina|himalaya|yodada)|pimienta|comino|oregano|canela|clavos|laurel|"
            r"curcuma|paprika|ajo\s+en\s+polvo|adobo|sazonador|especias|condimento|ajinomoto|achiote)\b"
        ),
    ),
    # 21. Congelados y helados
    BroadCategoryRule(
        "congelados-y-helados",
        _rx(
            r"\b(helado|paleta\s+(?:helada|crema|agua)|cono\s+helado|popsy|crem\s+helado|mimo|empanada|"
            r"dedito\s+de\s+queso|tequeno|pastelito\s+congelado|nugget|papa\s+(?:a\s+la\s+francesa|congelada)|"
            r"pizza\s+congelada|yuca\s+congelada|pulpa\s+(?:de\s+)?fruta|patacon\s+congelado)\b"
        ),
    ),
    # 22. Galletas y snacks
    BroadCategoryRule(
        "galletas-y-snacks",
        _rx(
            r"\b(galleta(?:s)?|wafer|saltin|ducales|festival|oreo|milo\s+galleta|papas?\s+(?:fritas?|margarita|super\s+ricas|pringles)|"
            r"pasabocas|doritos|cheetos|detodito|tostacos|platanitos|tajaditas|rosquillas|achiras|chicharron\s+snack|"
            r"mani|almendras|pistachos|maranon|nueces|mix\s+frutos\s+secos|crispetas|maiz\s+tostado|nachos|totopos|barra\s+cereal)\b"
        ),
    ),
    # 23. Dulces, mermeladas y chocolatería
    BroadCategoryRule(
        "dulces-y-chocolateria",
        _rx(
            r"\b(gomitas|caramelos|bombon(?:es)?|chocolatina|jet\b|jumbo\s+mani|ferrer\w*|hershey|kit\s*kat|snickers|m&m|"
            r"chocolate\s+(?:blanco|amargo|oscuro|relleno|barra)|chicle|trident|masmelo|turron|bocadillo|"
            r"arequipe|dulce\s+de\s+leche|mermelada|compota\s+fruta\s+frasco|nutella|crema\s+de\s+avellanas|lecherita)\b"
        ),
    ),
    # 24. Aguas, jugos y gaseosas
    BroadCategoryRule(
        "aguas-jugos-y-gaseosas",
        _rx(
            r"\b(agua\s+(?:mineral|con\s+gas|sin\s+gas|purificada|saborizada|cristal|brisa|manantial|hatsan)|"
            r"gaseosa|coca\s*cola|pepsi|sprite|fanta|quatro|colombiana|manzana\s+postobon|uva\s+postobon|"
            r"soda|tonica|ginger|jugo|nectar|hit\b|del\s+valle|cifrut|tampico|mr\s+tea|fuze\s+tea|"
            r"te\s+helado|gatorade|powerade|squash|hidratante|vive\s*100|red\s+bull|monster|energizante|pony\s+malta)\b"
        ),
    ),
    # 25. Frutas y verduras frescas
    BroadCategoryRule(
        "frutas-y-verduras",
        _rx(
            r"\b(manzana\s+(?:roja|verde|gala|royal)|banano|pera|uvas?\b|fresas?\b|mango|papaya|pina\b|"
            r"aguacate|limon\s+(?:tahiti|comun)|naranja|mandarina|lulo|maracuya|mora|guayaba|tomate\s+(?:chonto|milano|cherry)|"
            r"cebolla\s+(?:cabezona|larga|roja)|papa\s+(?:criolla|pastusa|sabanera|capira)|zanahoria|lechuga|"
            r"cilantro|perejil|espinaca|brocoli|coliflor|pimenton|pepino\s+cohombro|ajo\s+fresco|platano|yuca|ahuyama)\b"
        ),
        exclude=_rx(r"\b(shampoo|jabon|crema|salsa|galleta|jugo|yogurt|sabor|te\s+bitaco|aromatizante|gomita)\b"),
    ),
    # 26. Cocina y desechables
    BroadCategoryRule(
        "hogar-y-desechables",
        _rx(
            r"\b(papel\s+aluminio|vinipel|pelicula\s+adherente|papel\s+parafinado|bolsa\s+(?:hermetica|ziploc|lonchera)|"
            r"vasos?\s+desechables?|platos?\s+desechables?|cubiertos?\s+desechables?|pitillos|fosforos|encendedor|"
            r"velas?\b|velon|pilas?|bateria\s+(?:aa|aaa|9v)|bombillo|panos?\s+humedos?\s+superficies)\b"
        ),
    ),
)


def infer_broad_category_slug(
    normalized_name: str,
    net_content: Decimal | float | int,
    unit_measure: UnitMeasure | str,
    *,
    category_path: Sequence[str] | None = None,
) -> str | None:
    """Clasifica el SKU en una de las categorías de supermercado (estrictas o ampliadas)."""
    unit_enum = (
        unit_measure
        if isinstance(unit_measure, UnitMeasure)
        else UnitMeasure(str(unit_measure).lower())
        if str(unit_measure).lower() in {"g", "ml", "und"}
        else UnitMeasure.UND
    )
    dec_content = Decimal(str(net_content)) if net_content else Decimal("1")

    strict = infer_canonical_category_slug(normalized_name, dec_content, unit_enum)
    if strict is not None:
        return strict

    joined_path = " ".join(_strip_accents_lower(seg) for seg in (category_path or ()) if seg)
    text = f"{_strip_accents_lower(normalized_name)} {joined_path}".strip()
    if not text:
        return None

    for rule in BROAD_CATEGORY_RULES:
        if rule.exclude and rule.exclude.search(text):
            continue
        if rule.pattern.search(text):
            return rule.slug

    return None


@dataclass(frozen=True, slots=True)
class SubPresentationRule:
    product_type: str
    sub_presentation: str
    label: str
    pattern: re.Pattern[str]
    exclude: re.Pattern[str] | None = None


SUB_PRESENTATION_RULES: tuple[SubPresentationRule, ...] = (
    # --- Leche y bebidas vegetales ---
    SubPresentationRule(
        "leche",
        "leche_en_polvo",
        "Leche en polvo",
        _rx(r"\bleche\b.*\b(?:en\s+polvo|polvo|klim)\b"),
        exclude=_rx(r"\b(milo|chocolisto|cocoa|formula|infantil)\b"),
    ),
    SubPresentationRule(
        "leche",
        "leche_condensada",
        "Leche condensada",
        _rx(r"\bleche\s+condensada\b|\blecherita\b"),
    ),
    SubPresentationRule(
        "leche",
        "crema_de_leche",
        "Crema de leche",
        _rx(r"\bcrema\s+de\s+leche\b"),
    ),
    SubPresentationRule(
        "leche",
        "leche_vegetal",
        "Bebida vegetal",
        _rx(r"\b(?:bebida|leche)\b.*\b(?:almendra\w*|soya|soja|avena|coco|arroz)\b"),
        exclude=_rx(r"\b(yogur|helado|galleta|chocolat|crema\s+corporal|shampoo|jabon)\b"),
    ),
    SubPresentationRule(
        "leche",
        "leche_deslactosada",
        "Leche deslactosada",
        _rx(r"\bleche\b.*\bdeslactosad\w*\b"),
        exclude=_rx(r"\b(condensada|crema\s+de\s+leche|arequipe|yogurt|queso|helado|polvo)\b"),
    ),
    SubPresentationRule(
        "leche",
        "leche_semidescremada",
        "Leche semidescremada",
        _rx(r"\bleche\b.*\bsemidescremad\w*\b"),
        exclude=_rx(r"\b(condensada|crema\s+de\s+leche|yogurt|queso|polvo)\b"),
    ),
    SubPresentationRule(
        "leche",
        "leche_descremada",
        "Leche descremada / Light",
        _rx(r"\bleche\b.*\b(?:descremad\w*|light|baja\s+en\s+grasa|0%\s*grasa)\b"),
        exclude=_rx(r"\b(condensada|crema\s+de\s+leche|yogurt|queso|polvo)\b"),
    ),
    SubPresentationRule(
        "leche",
        "leche_entera",
        "Leche entera",
        _rx(r"\bleche\b"),
        exclude=_rx(r"\b(condensada|crema\s+de\s+leche|arequipe|polvo|yogurt|queso|postre|natilla|achocolatad\w*|almendra|soya|coco|avena|deslactosad\w*|descremad\w*|semidescremad\w*|jabon|corporal)\b"),
    ),
    # --- Café ---
    SubPresentationRule(
        "cafe",
        "cafe_capsulas",
        "Café en cápsulas",
        _rx(r"\bcafe\b.*\b(?:capsul\w*|dolce\s+gusto|nespresso|pods?)\b|\b(?:capsul\w*|dolce\s+gusto|nespresso)\b.*\bcafe\b"),
    ),
    SubPresentationRule(
        "cafe",
        "cafe_liofilizado",
        "Café liofilizado",
        _rx(r"\bcafe\b.*\bliofiliz\w*\b"),
    ),
    SubPresentationRule(
        "cafe",
        "cafe_instantaneo",
        "Café instantáneo / soluble",
        _rx(r"\bcafe\b.*\b(?:instant\w*|soluble|colcafe\s+clasico|nescafe\s+tradicion)\b"),
    ),
    SubPresentationRule(
        "cafe",
        "cafe_en_grano",
        "Café en grano",
        _rx(r"\bcafe\b.*\b(?:en\s+grano|grano)\b"),
        exclude=_rx(r"\b(dulce|licor|bebida|granola|pan|arroz|capsul\w*)\b"),
    ),
    SubPresentationRule(
        "cafe",
        "cafe_molido",
        "Café tostado y molido",
        _rx(r"\bcafe\b"),
        exclude=_rx(r"\b(bebida\s+cafe|helado|licor|galleta|tort[ae]|arequipe|pan|chocolat\w*|capsul\w*|dolce\s+gusto|instant\w*|liofiliz\w*|soluble|tono|tinte|pelo|cabello|diadema|jabon|shampoo)\b"),
    ),
    # --- Aceite ---
    SubPresentationRule(
        "aceite",
        "aceite_oliva_extra_virgen",
        "Aceite de oliva extra virgen",
        _rx(r"\baceite\b.*\boliva\b.*\bextra\s*virgen\b|\baceite\b.*\bextra\s*virgen\b"),
        exclude=_rx(r"\b(atun|sardina|cabello|corporal|mascarilla)\b"),
    ),
    SubPresentationRule(
        "aceite",
        "aceite_oliva",
        "Aceite de oliva",
        _rx(r"\baceite\b.*\boliva\b"),
        exclude=_rx(r"\b(atun|sardina|cabello|corporal)\b"),
    ),
    SubPresentationRule(
        "aceite",
        "aceite_aguacate",
        "Aceite de aguacate",
        _rx(r"\baceite\b.*\baguacate\b"),
        exclude=_rx(r"\b(cabello|corporal)\b"),
    ),
    SubPresentationRule(
        "aceite",
        "aceite_girasol",
        "Aceite de girasol",
        _rx(r"\baceite\b.*\bgirasol\b"),
    ),
    SubPresentationRule(
        "aceite",
        "aceite_canola",
        "Aceite de canola",
        _rx(r"\baceite\b.*\bcanola\b"),
    ),
    SubPresentationRule(
        "aceite",
        "aceite_coco",
        "Aceite de coco comestible",
        _rx(r"\baceite\b.*\bcoco\b"),
        exclude=_rx(r"\b(cabello|corporal|masaje|bebe|capilar|bronceador)\b"),
    ),
    SubPresentationRule(
        "aceite",
        "aceite_vegetal",
        "Aceite vegetal / mezcla",
        _rx(r"\baceite\b"),
        exclude=_rx(r"\b(atun|sardina|cabello|corporal|masaje|bebe|motor|moto|esencial|bronceador|desmaquillante)\b"),
    ),
    # --- Atún ---
    SubPresentationRule(
        "atun",
        "atun_aceite_oliva",
        "Atún en aceite de oliva",
        _rx(r"\batun\b.*\b(?:aceite\s+de\s+)?oliva\b"),
    ),
    SubPresentationRule(
        "atun",
        "atun_en_agua",
        "Atún en agua",
        _rx(r"\batun\b.*\bagua\b"),
    ),
    SubPresentationRule(
        "atun",
        "atun_preparado",
        "Atún preparado / ensalada",
        _rx(r"\batun\b.*\b(?:ensalada|veget|maiz|antipasto|chipotle|limon)\b"),
    ),
    SubPresentationRule(
        "atun",
        "atun_en_aceite",
        "Atún en aceite",
        _rx(r"\batun\b"),
        exclude=_rx(r"\b(ensalada|antipasto|agua|oliva|gato|perro)\b"),
    ),
    # --- Arroz ---
    SubPresentationRule(
        "arroz",
        "arroz_integral",
        "Arroz integral",
        _rx(r"\barroz\b.*\bintegral\b"),
        exclude=_rx(r"\b(galleta|pasta|bebida|leche|snack)\b"),
    ),
    SubPresentationRule(
        "arroz",
        "arroz_parbolizado",
        "Arroz parbolizado",
        _rx(r"\barroz\b.*\bparbol\w*\b"),
    ),
    SubPresentationRule(
        "arroz",
        "arroz_especial",
        "Arroz especial (Basmati / Jazmín / Arborio)",
        _rx(r"\barroz\b.*\b(?:basmati|jasmin|jazmin|jasmine|arborio|risotto|sushi|salvaje)\b"),
    ),
    SubPresentationRule(
        "arroz",
        "arroz_blanco",
        "Arroz blanco",
        _rx(r"\barroz\b"),
        exclude=_rx(
            r"\b(pasta|tallarin|leche|bebida|galleta|torta|harina|vinagre|inflado|crisp|snack|"
            r"achocolatad\w*|chocolat\w*|cereal|infantil|papilla|compota|tortilla|tostada)\b"
        ),
    ),
    # --- Azúcar ---
    SubPresentationRule(
        "azucar",
        "azucar_morena",
        "Azúcar morena / orgánica",
        _rx(r"\bazucar\b.*\b(?:morena|organica|rubia)\b"),
    ),
    SubPresentationRule(
        "azucar",
        "azucar_pulverizada",
        "Azúcar pulverizada / impalpable",
        _rx(r"\bazucar\b.*\b(?:pulverizada|impalpable)\b"),
    ),
    SubPresentationRule(
        "azucar",
        "azucar_blanca",
        "Azúcar blanca refinada",
        _rx(r"\bazucar\b"),
        exclude=_rx(r"\b(sin\s+azucar|menos\s+azucar|zero|yogurt|galleta|gaseosa|jugo|cereal|chocolat)\b"),
    ),
    # --- Huevos ---
    SubPresentationRule("huevos", "huevos_codorniz", "Huevos de codorniz", _rx(r"\bhuevos?\b.*\bcodorniz\b")),
    SubPresentationRule(
        "huevos",
        "huevos_jumbo",
        "Huevos Jumbo",
        _rx(r"\bhuevos?\b.*\bjumbo\b"),
        exclude=_rx(r"\b(chocolate|kinder|pascua)\b"),
    ),
    SubPresentationRule(
        "huevos",
        "huevos_aaa",
        "Huevos AAA",
        _rx(r"\bhuevos?\b.*\baaa\b"),
        exclude=_rx(r"\b(chocolate|kinder|pascua)\b"),
    ),
    SubPresentationRule(
        "huevos",
        "huevos_aa",
        "Huevos AA",
        _rx(r"\bhuevos?\b.*\baa\b"),
        exclude=_rx(r"\b(chocolate|kinder|pascua)\b"),
    ),
    SubPresentationRule(
        "huevos",
        "huevos_a",
        "Huevos tipo A",
        _rx(r"\bhuevos?\b.*\b(?:tipo\s*a|rojos?\s+a\b|blancos?\s+a\b)\b"),
        exclude=_rx(r"\b(chocolate|kinder|pascua)\b"),
    ),
    SubPresentationRule(
        "huevos",
        "huevos_gallina",
        "Huevos de gallina",
        _rx(r"\bhuevos?\b"),
        exclude=_rx(r"\b(chocolate|kinder|pascua|sorpresa|pasta|fideo)\b"),
    ),
    # --- Yogurt ---
    SubPresentationRule(
        "yogurt",
        "yogurt_griego",
        "Yogurt griego",
        _rx(r"\b(?:yogur\w*|griego)\b.*\bgriego\b|\byogur\w*\s+greek\b"),
    ),
    SubPresentationRule("yogurt", "kumis_kefir", "Kumis / Kéfir", _rx(r"\b(?:kumis|kefir)\b")),
    SubPresentationRule("yogurt", "yogurt_regular", "Yogurt / Bebida láctea", _rx(r"\byogur\w*\b")),
    # --- Queso ---
    SubPresentationRule("queso", "queso_mozzarella", "Queso mozzarella", _rx(r"\bqueso\b.*\bmozzarella\b")),
    SubPresentationRule("queso", "queso_campesino", "Queso campesino / cuajada", _rx(r"\b(?:queso\s+campesino|cuajada|quesito)\b")),
    SubPresentationRule("queso", "queso_doble_crema", "Queso doble crema", _rx(r"\bqueso\b.*\bdoble\s+crema\b")),
    SubPresentationRule("queso", "queso_crema", "Queso crema", _rx(r"\bqueso\s+crema\b|\bphiladelphia\b")),
    SubPresentationRule("queso", "queso_parmesano", "Queso parmesano", _rx(r"\bparmesan\w*\b")),
    # --- Pasta ---
    SubPresentationRule(
        "pasta",
        "pasta_sin_gluten",
        "Pasta sin gluten",
        _rx(r"\b(?:pasta|espagueti|fusilli|penne)\b.*\b(?:sin\s+gluten|de\s+arroz|quinoa)\b"),
    ),
    SubPresentationRule("pasta", "pasta_espagueti", "Pasta espagueti / tallarín", _rx(r"\b(?:espagueti|spaghetti|tallarin|fetuccini)\b")),
    SubPresentationRule("pasta", "pasta_lasagna", "Pasta lasaña", _rx(r"\b(?:lasagna|lasana)\b")),
    SubPresentationRule(
        "pasta",
        "pasta_corta",
        "Pasta corta / fideos",
        _rx(r"\b(?:fusilli|penne|macarron|tornillo|conchitas|fideo|corbatin|pasta\s+corta)\b"),
    ),
    # --- Detergente ---
    SubPresentationRule("detergente", "detergente_capsulas", "Detergente en cápsulas / pods", _rx(r"\b(?:detergente|jabon\s+ropa)\b.*\b(?:capsul|pods?)\b")),
    SubPresentationRule("detergente", "detergente_liquido", "Detergente líquido", _rx(r"\b(?:detergente|jabon\s+ropa)\b.*\bliquid\w*\b|\bjabon\s+liquido\s+ropa\b")),
    SubPresentationRule("detergente", "detergente_polvo", "Detergente en polvo", _rx(r"\b(?:detergente|jabon\s+(?:en\s+)?polvo)\b")),
)


@dataclass(frozen=True, slots=True)
class ProductMetadataResult:
    product_type: str | None
    sub_presentation: str | None
    sub_presentation_label: str | None
    variant_tags: tuple[str, ...]


_VARIANT_TAG_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("sin_azucar", _rx(r"\b(?:sin\s+azucar|cero\s+azucar|zero\s+azucar|sugar\s+free)\b")),
    ("light", _rx(r"\b(?:light|bajo\s+en\s+(?:grasa|calorias)|finesse)\b")),
    ("organico", _rx(r"\borganic[oa]\b")),
    ("sin_gluten", _rx(r"\b(?:sin\s+gluten|gluten\s*free)\b")),
    ("descafeinado", _rx(r"\bdescafeinad\w*\b")),
    ("alto_en_proteina", _rx(r"\b(?:alto\s+en\s+proteina|high\s+protein|proteina)\b")),
    ("campo_libre", _rx(r"\b(?:campo\s+libre|gallina\s+feliz|pastoreo)\b")),
    ("extra_virgen", _rx(r"\bextra\s*virgen\b")),
    ("multipack", _rx(r"\b(?:[xX×]\s*[2-9]|[xX×]\s*\d{2,}|sixpack|multipack)\b")),
)


def extract_product_metadata(
    raw_name: str,
    normalized_name: str | None = None,
    *,
    is_private_label: bool = False,
) -> ProductMetadataResult:
    """Extrae metadatos estructurados (`product_type`, `sub_presentation`, `variant_tags`)."""
    norm = _strip_accents_lower(normalized_name or raw_name)
    raw_norm = _strip_accents_lower(raw_name)
    text = norm if norm else raw_norm

    matched_rule: SubPresentationRule | None = None
    for rule in SUB_PRESENTATION_RULES:
        if rule.exclude and rule.exclude.search(text):
            continue
        if rule.pattern.search(text):
            matched_rule = rule
            break

    tags: list[str] = []
    for tag, rx in _VARIANT_TAG_PATTERNS:
        if rx.search(raw_norm) or rx.search(text):
            tags.append(tag)
    if is_private_label and "marca_propia" not in tags:
        tags.append("marca_propia")

    return ProductMetadataResult(
        product_type=matched_rule.product_type if matched_rule else None,
        sub_presentation=matched_rule.sub_presentation if matched_rule else None,
        sub_presentation_label=matched_rule.label if matched_rule else None,
        variant_tags=tuple(tags),
    )


def build_category_lookup_sql_ready(
    rows: Iterable[tuple[str, str, Decimal, UnitMeasure]],
) -> dict[str, str | None]:
    """Helper utilitario de lote para resolver `canonical_slug` sobre pares `(id, norm_name, content, unit)`."""
    return {
        row_id: infer_broad_category_slug(norm_name, content, unit)
        for row_id, norm_name, content, unit in rows
    }
