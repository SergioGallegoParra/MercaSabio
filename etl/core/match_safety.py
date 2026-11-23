"""Reglas deterministas de compatibilidad de marca, variantes y seguridad en homologación.

Previene colisiones falsas entre marcas distintas, sub-presentaciones incompatibles,
dosis/etapas/sabores excluyentes o divergencia léxica severa tanto en tiempo real
(`EntityResolver`, `LocalSqliteGateway`, `InMemoryGateway`) como en consolidación local.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable

from etl.core.canonical_mapper import PRIVATE_LABEL_BRANDS_BY_STORE
from etl.core.product_enrichment import extract_product_metadata

_NON_BRAND_PLACEHOLDERS: frozenset[str] = frozenset(
    {
        "",
        "sin marca",
        "generico",
        "generic",
        "sin refer",
        "sin referencia",
        "n/a",
        "na",
        "no aplica",
        "otros",
        "varios",
        "marca blanca",
    }
)

_STOP_TOKENS: frozenset[str] = frozenset(
    {
        "de", "del", "la", "el", "los", "las", "con", "sin", "en", "para", "por",
        "y", "o", "a", "al", "un", "una", "unos", "unas", "x", "und", "unds",
        "unidad", "unidades", "gr", "grs", "g", "kg", "ml", "cc", "lt", "lts",
        "l", "litro", "litros", "gramo", "gramos", "bolsa", "paquete", "caja",
        "frasco", "botella", "lata", "sobre", "doypack", "doy", "pack", "tetra",
        "tetrapack", "tetrapak", "pouch", "envase", "tarro", "empaque", "display",
        "peso", "aprox", "pague", "lleve", "oferta", "promo", "promocion", "gratis",
    }
)

_GENERIC_WORDS_NOT_BRANDS: frozenset[str] = _STOP_TOKENS | frozenset(
    {
        "agua", "arroz", "leche", "aceite", "pan", "sal", "azucar", "queso",
        "yogurt", "yogur", "mantequilla", "margarina", "avena", "cafe", "te",
        "chocolate", "chocolatina", "galleta", "galletas", "pasta", "pastas",
        "salsa", "crema", "sopa", "jugo", "gaseosa", "bebida", "refresco",
        "cerveza", "vino", "atun", "sardina", "pollo", "carne", "res", "cerdo",
        "pescado", "jamon", "salchicha", "chorizo", "huevo", "huevos", "papa",
        "papas", "yuca", "platano", "tomate", "cebolla", "ajo", "limon",
        "naranja", "manzana", "fresa", "mora", "mango", "pina", "uva", "pera",
        "durazno", "melocoton", "maracuya", "guanabana", "coco", "vainilla",
        "canela", "miel", "arequipe", "caramelo", "menta", "natural", "original",
        "clasico", "clasica", "tradicional", "especial", "premium", "selecta",
        "selecto", "fresco", "fresca", "blanco", "blanca", "negro", "negra",
        "rojo", "roja", "verde", "azul", "amarillo", "amarilla", "dorado",
        "extra", "super", "gran", "mini", "max", "plus", "ultra", "pro",
        "total", "active", "clinical", "invisible", "zero", "cero", "light",
        "finesse", "integral", "deslactosada", "deslactosado", "entera",
        "entero", "semidescremada", "semidescremado", "descremada", "descremado",
        "molido", "molida", "grano", "polvo", "liquido", "liquida", "barra",
        "cremoso", "cremosa", "suave", "fuerte", "sueltos", "tajado", "tajada",
        "tajadas", "bloque", "rallado", "rallada", "picado", "picada",
        "congelado", "congelada", "enlatado", "cocina", "mesa", "hogar",
        "familia", "familiar", "infantil", "bebe", "adulto", "mascota",
        "perro", "perros", "gato", "gatos", "cachorro", "shampoo", "champu",
        "acondicionador", "jabon", "detergente", "suavizante", "blanqueador",
        "desmanchador", "limpiador", "desinfectante", "lavaloza", "crema dental",
        "enjuague", "cepillo", "desodorante", "protector", "bloqueador", "panal",
        "panales", "toalla", "toallas", "papel", "higienico", "servilleta",
        "servilletas", "colombia", "colombiano", "nacional", "importado",
        "sabor", "sabores", "mix", "surtido", "surtidas", "fruta", "frutas",
        "vegetal", "vegetales", "verdadera", "buena", "saludable", "delicioso",
        "deliciosa", "rica", "rico", "casa", "grande", "pequeno", "pequena",
        "mediano", "mediana", "individual", "economico", "economica", "cuidado",
        "proteccion", "sensible", "sensitive", "kids", "junior", "senior",
        "men", "woman", "hombre", "mujer", "cabello", "cuerpo", "manos", "cara",
        "dental", "bucal", "oral", "piel", "ropa", "pisos", "bano", "vidrio",
    }
)

_FLAVOR_TOKENS: frozenset[str] = frozenset(
    {
        "fresa", "mora", "melocoton", "durazno", "manzana", "uva", "naranja",
        "limon", "mandarina", "maracuya", "pina", "mango", "guanabana", "lulo",
        "guayaba", "cereza", "frambuesa", "arandano", "arandanos", "sandia",
        "coco", "vainilla", "chocolate", "arequipe", "caramelo", "menta",
        "hierbabuena", "canela", "almendra", "almendras", "avellana", "nuez",
        "pistacho", "cafe", "capuchino", "miel", "maracuya", "kiwi", "pera",
        "banano", "platano", "papaya", "tamarindo", "jamaica", "jengibre",
        "tomate", "cebolla", "ajo", "pimienta", "picante", "bbq", "tocineta",
        "queso", "pollo", "carne", "res", "cerdo", "pavo", "salmon", "atun",
        "camaron", "camarones", "trucha",
    }
)

_MIXED_FLAVOR_RX = re.compile(r"\b(?:surtid[oa]s?|mix|variados?|frutos\s+rojos|frutas)\b")
_WORD_RX = re.compile(r"[a-z0-9]+")
_STAGE_RX = re.compile(r"\b(?:etapa|talla|fase|paso)\s*([0-9]+|[ivx]+|[pmsg]|xg|xxg)\b")
_HASH_NUM_RX = re.compile(r"(?:#|no\.?\s*)([0-9]+)\b")
_DOSAGE_RX = re.compile(r"\b([0-9]+(?:[.,][0-9]+)?)\s*(mcg|mg|ui)\b")

_PRESENCE_STRICT_AXES: frozenset[str] = frozenset({"salt", "sugar", "alcohol", "lactose_free"})

_EXCLUSIVE_FLAG_PATTERNS: tuple[tuple[str, tuple[tuple[str, re.Pattern[str]], ...]], ...] = (
    (
        "salt",
        (
            ("sin_sal", re.compile(r"\b(?:sin\s+sal|cero\s+sal|baj[oa]\s+en\s+sal)\b")),
            ("con_sal", re.compile(r"\bcon\s+sal\b")),
        ),
    ),
    (
        "sugar",
        (
            ("sin_azucar", re.compile(r"\b(?:sin\s+azucar|cero\s+azucar|zero\s+azucar|sugar\s*free|\bzero\b)\b")),
            ("con_azucar", re.compile(r"\b(?:con\s+azucar|azucarad[oa])\b")),
        ),
    ),
    (
        "lactose_free",
        (
            ("deslactosada", re.compile(r"\bdeslactosad[oa]\b|\bdesl\b")),
        ),
    ),
    (
        "milk_fat",
        (
            ("semidescremada", re.compile(r"\bsemi\s*descremad[oa]\b|\bsemidesc\b")),
            ("descremada", re.compile(r"\bdescremad[oa]\b")),
            ("entera", re.compile(r"\benter[oa]\b")),
        ),
    ),
    (
        "diet_light",
        (
            ("light", re.compile(r"\b(?:light|finesse|dietetic[oa]|baj[oa]\s+en\s+(?:grasa|calorias))\b")),
        ),
    ),
    (
        "alcohol",
        (
            ("sin_alcohol", re.compile(r"\b(?:sin\s+alcohol|zero\s+alcohol|0\.0%?)\b")),
            ("con_alcohol", re.compile(r"\b(?:con\s+alcohol|hard\s+seltzer)\b")),
        ),
    ),
    (
        "cut_form",
        (
            ("tajado", re.compile(r"\b(?:tajad[oa]s?|en\s+lonchas|rebanad[oa])\b")),
            ("bloque", re.compile(r"\bbloque\b")),
            ("rallado", re.compile(r"\brallad[oa]\b")),
        ),
    ),
    (
        "oil_type",
        (
            ("canola", re.compile(r"\bcanola\b")),
            ("girasol", re.compile(r"\bgirasol\b")),
            ("soya", re.compile(r"\b(?:soya|soja)\b")),
            ("oliva", re.compile(r"\boliva\b")),
            ("maiz", re.compile(r"\bmaiz\b")),
            ("coco", re.compile(r"\bcoco\b")),
        ),
    ),
    (
        "grind",
        (
            ("en_grano", re.compile(r"\ben\s+grano\b")),
            ("molido", re.compile(r"\bmolid[oa]\b")),
            ("instantaneo", re.compile(r"\binstantane[oa]\b")),
            ("en_capsulas", re.compile(r"\b(?:capsulas?|pods?)\b")),
        ),
    ),
    (
        "vet_formula",
        (
            ("renal", re.compile(r"\brenal\b")),
            ("intestinal", re.compile(r"\bintestinal\b")),
            ("urinario", re.compile(r"\burinari[oa]\b|\burinary\b")),
        ),
    ),
)


def strip_accents_lower(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text or "")
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", stripped.lower()).strip()


def normalize_brand(brand: str | None) -> str | None:
    """Normaliza una marca comercial o retorna `None` si es genérica o vacía."""
    if not brand:
        return None
    cleaned = re.sub(r"[^a-z0-9\s]", "", strip_accents_lower(brand))
    cleaned = " ".join(cleaned.split())
    if not cleaned or cleaned in _NON_BRAND_PLACEHOLDERS or cleaned in _GENERIC_WORDS_NOT_BRANDS:
        return None
    return cleaned


def meaningful_tokens(text: str) -> frozenset[str]:
    """Extrae tokens semánticos no vacíos ni numéricos puros de unidad."""
    norm = strip_accents_lower(text)
    tokens: set[str] = set()
    for tok in _WORD_RX.findall(norm):
        if tok in _STOP_TOKENS:
            continue
        if tok.isdigit() and len(tok) >= 2:
            continue
        if len(tok) <= 1:
            continue
        tokens.add(tok)
    return frozenset(tokens)


def token_jaccard(tokens_a: frozenset[str], tokens_b: frozenset[str]) -> float:
    if not tokens_a and not tokens_b:
        return 1.0
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / len(tokens_a | tokens_b)


def brands_compatible(brand_a: str | None, brand_b: str | None) -> bool:
    """True si ambas marcas son compatibles o al menos una es desconocida."""
    ba = normalize_brand(brand_a)
    bb = normalize_brand(brand_b)
    if not ba or not bb:
        return True
    if ba == bb:
        return True
    short, long_ = (ba, bb) if len(ba) <= len(bb) else (bb, ba)
    if len(short) >= 3 and re.search(rf"\b{re.escape(short)}\b", long_):
        return True
    # Permitir marcas compuestas donde el primer token distintivo coincide (>= 4 chars)
    toks_a = {t for t in ba.split() if len(t) >= 4 and t not in _GENERIC_WORDS_NOT_BRANDS}
    toks_b = {t for t in bb.split() if len(t) >= 4 and t not in _GENERIC_WORDS_NOT_BRANDS}
    return bool(toks_a & toks_b)


def build_known_brands_vocab(raw_brands: Iterable[str | None]) -> tuple[frozenset[str], frozenset[str]]:
    """Construye `(single_word_brands, multi_word_brands)` seguras para detección textual."""
    from collections import Counter

    counts: Counter[str] = Counter()
    for raw in raw_brands:
        nb = normalize_brand(raw)
        if nb:
            counts[nb] += 1
    for pl_set in PRIVATE_LABEL_BRANDS_BY_STORE.values():
        for raw in pl_set:
            nb = normalize_brand(raw)
            if nb:
                counts[nb] = max(counts[nb], 5)

    single_words: set[str] = set()
    multi_words: set[str] = set()
    for nb, freq in counts.items():
        if freq < 2 and len(nb) < 5:
            continue
        if " " in nb:
            parts = nb.split()
            if any(p not in _GENERIC_WORDS_NOT_BRANDS and len(p) >= 3 for p in parts):
                multi_words.add(nb)
        elif len(nb) >= 4 and nb not in _GENERIC_WORDS_NOT_BRANDS:
            single_words.add(nb)
    return frozenset(single_words), frozenset(multi_words)


@dataclass(frozen=True, slots=True)
class ProductSignature:
    norm_text: str
    tokens: frozenset[str]
    brand: str | None
    detected_brands: frozenset[str]
    is_private_label: bool
    store_id: str | None
    product_type: str | None
    sub_presentation: str | None
    axes: tuple[tuple[str, str], ...]
    flavors: frozenset[str]
    stage_or_dosage: tuple[str, ...]
    is_light: bool


def extract_product_signature(
    raw_name: str,
    *,
    normalized_name: str | None = None,
    brand: str | None = None,
    is_private_label: bool = False,
    store_id: str | None = None,
    single_brands: frozenset[str] = frozenset(),
    multi_brands: frozenset[str] = frozenset(),
) -> ProductSignature:
    """Extrae la firma semántica/estructural de un SKU o producto maestro."""
    norm_text = strip_accents_lower(normalized_name or raw_name)
    raw_norm = strip_accents_lower(raw_name)
    combined = f"{raw_norm} {norm_text}".strip()
    compact_text = re.sub(r"[^a-z0-9\s]", " ", combined)
    tokens = meaningful_tokens(combined)

    nb = normalize_brand(brand)
    found_brands: set[str] = set()
    if nb:
        found_brands.add(nb)
    for tok in tokens:
        if tok in single_brands:
            found_brands.add(tok)
    if multi_brands:
        padded = f" {' '.join(compact_text.split())} "
        for mb in multi_brands:
            if f" {mb} " in padded:
                found_brands.add(mb)

    meta = extract_product_metadata(raw_name, normalized_name, is_private_label=is_private_label)

    axes: list[tuple[str, str]] = []
    for axis_name, choices in _EXCLUSIVE_FLAG_PATTERNS:
        for val, rx in choices:
            if rx.search(combined):
                axes.append((axis_name, val))
                break

    flavors: frozenset[str] = (
        frozenset()
        if _MIXED_FLAVOR_RX.search(combined)
        else frozenset(tok for tok in tokens if tok in _FLAVOR_TOKENS)
    )

    stages_dosage: list[str] = []
    for m in _STAGE_RX.finditer(combined):
        stages_dosage.append(f"stage:{m.group(1)}")
    for m in _HASH_NUM_RX.finditer(raw_norm):
        stages_dosage.append(f"num:{m.group(1)}")
    for m in _DOSAGE_RX.finditer(combined):
        stages_dosage.append(f"dose:{m.group(1).replace(',', '.')}{m.group(2)}")

    return ProductSignature(
        norm_text=norm_text,
        tokens=tokens,
        brand=nb,
        detected_brands=frozenset(found_brands),
        is_private_label=bool(is_private_label),
        store_id=store_id.strip().lower() if store_id else None,
        product_type=meta.product_type,
        sub_presentation=meta.sub_presentation,
        axes=tuple(axes),
        flavors=flavors,
        stage_or_dosage=tuple(sorted(set(stages_dosage))),
        is_light=("light" in meta.variant_tags),
    )


_NON_SUBSTITUTION_EXTRA_TOKENS: frozenset[str] = _GENERIC_WORDS_NOT_BRANDS | _FLAVOR_TOKENS | frozenset(
    {
        "clasico", "tradicional", "ahorro", "economica", "promocion", "edicion",
        "limitada", "nueva", "nuevo", "formula", "mejorada", "receta", "casera",
        "artesanal", "suave", "fuerte", "intenso", "intensa", "suelto", "caja",
        "lata", "vidrio", "frasco", "botella", "bolsa", "paquete", "tetra",
        "pouch", "doypack", "sobre", "tapa", "rosca", "display", "blister",
    }
)


def signatures_compatible(
    sig_a: ProductSignature,
    sig_b: ProductSignature,
    *,
    strict_trigram: bool = False,
) -> tuple[bool, str | None]:
    """Determina si dos firmas corresponden al mismo producto físico o si colisionan."""
    if sig_a.is_private_label != sig_b.is_private_label:
        return False, "private_label_mismatch"
    if sig_a.is_private_label and sig_a.store_id and sig_b.store_id and sig_a.store_id != sig_b.store_id:
        return False, "cross_store_private_label"

    if not brands_compatible(sig_a.brand, sig_b.brand):
        return False, "explicit_brand_conflict"

    # Detectar conflicto de marcas detectadas en texto (p.ej. Blanquita vs Diana, Frugal vs Aderezos)
    if sig_a.detected_brands and sig_b.detected_brands:
        any_compat = any(
            brands_compatible(ba, bb)
            for ba in sig_a.detected_brands
            for bb in sig_b.detected_brands
        )
        if not any_compat:
            return False, "detected_brand_conflict"

    if strict_trigram:
        # En matching por trigramas (sin EAN), exigir marca explícita presente cuando alguna viene declarada
        if sig_a.brand and not any(brands_compatible(sig_a.brand, bb) for bb in sig_b.detected_brands):
            if sig_a.brand not in sig_b.norm_text.replace("-", ""):
                return False, "trgm_missing_brand"
        if sig_b.brand and not any(brands_compatible(sig_b.brand, ba) for ba in sig_a.detected_brands):
            if sig_b.brand not in sig_a.norm_text.replace("-", ""):
                return False, "trgm_missing_brand"

    if sig_a.product_type and sig_b.product_type and sig_a.product_type != sig_b.product_type:
        return False, "product_type_conflict"
    if sig_a.sub_presentation and sig_b.sub_presentation and sig_a.sub_presentation != sig_b.sub_presentation:
        return False, "sub_presentation_conflict"

    axes_a = dict(sig_a.axes)
    axes_b = dict(sig_b.axes)
    for axis_name in _PRESENCE_STRICT_AXES:
        if axes_a.get(axis_name) != axes_b.get(axis_name):
            return False, f"axis_presence_conflict:{axis_name}"
    for axis_name, val_a in axes_a.items():
        val_b = axes_b.get(axis_name)
        if val_b is not None and val_b != val_a:
            return False, f"axis_conflict:{axis_name}"

    if sig_a.is_light != sig_b.is_light:
        return False, "light_variant_conflict"

    if sig_a.stage_or_dosage and sig_b.stage_or_dosage and sig_a.stage_or_dosage != sig_b.stage_or_dosage:
        return False, "stage_or_dosage_conflict"

    if sig_a.flavors and sig_b.flavors and not (sig_a.flavors & sig_b.flavors):
        return False, "flavor_conflict"

    # Si no comparten marca detectada/explícita, detectar sustitución de marca conocida o no catalogada
    has_shared_brand = bool(
        (sig_a.detected_brands & sig_b.detected_brands)
        or (sig_a.brand and sig_b.brand and brands_compatible(sig_a.brand, sig_b.brand))
    )
    if not has_shared_brand:
        for main_sig, other_sig in ((sig_a, sig_b), (sig_b, sig_a)):
            if main_sig.brand and len(main_sig.brand) >= 4:
                brand_compact = main_sig.brand.replace(" ", "")
                other_compact = re.sub(r"[^a-z0-9]", "", other_sig.norm_text)
                main_first = main_sig.brand.split()[0]
                if main_first not in other_sig.tokens and brand_compact not in other_compact:
                    novel = [
                        t
                        for t in (other_sig.tokens - main_sig.tokens)
                        if len(t) >= 5 and not t.isdigit() and t not in _NON_SUBSTITUTION_EXTRA_TOKENS
                    ]
                    if novel and not main_sig.tokens.issuperset(other_sig.tokens):
                        return False, "unrecognized_brand_substitution"
        novel_a = [
            t
            for t in (sig_a.tokens - sig_b.tokens)
            if len(t) >= 5 and not t.isdigit() and t not in _NON_SUBSTITUTION_EXTRA_TOKENS
        ]
        novel_b = [
            t
            for t in (sig_b.tokens - sig_a.tokens)
            if len(t) >= 5 and not t.isdigit() and t not in _NON_SUBSTITUTION_EXTRA_TOKENS
        ]
        if novel_a and novel_b and not (sig_a.tokens.issuperset(sig_b.tokens) or sig_b.tokens.issuperset(sig_a.tokens)):
            return False, "mutual_unrecognized_brand_substitution"

    jaccard = token_jaccard(sig_a.tokens, sig_b.tokens)
    if strict_trigram:
        if jaccard < 0.45:
            return False, "trgm_low_jaccard"
    elif jaccard < 0.25:
        # Incluso con EAN compartido, si no comparten marca explícita y los tokens difieren severamente, separar
        same_brand = bool(
            sig_a.brand
            and sig_b.brand
            and brands_compatible(sig_a.brand, sig_b.brand)
        )
        if not same_brand:
            return False, "severe_token_mismatch"

    return True, None
