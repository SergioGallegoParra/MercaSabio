"""Taxonomía unificada de mercado (10 Macro-categorías y 59 Subcategorías).

Base oficial homologada desde `docs/Categorias clasificadas por AI Studio.txt` (1,589 rutas
clasificadas por Google AI Studio) y completada de forma determinista para las rutas restantes
de `mercaldas` y `olimpica` hasta cubrir el 100 % del catálogo activo.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from etl.core.grocery_filter import strip_accents_lower

DEFAULT_AI_STUDIO_TXT = Path("docs/Categorias clasificadas por AI Studio.txt")
DEFAULT_ACTIVE_CATEGORIES_TXT = Path("docs/categorias_para_ai_studio.txt")
DEFAULT_TAXONOMY_JSON = Path(__file__).resolve().parent.parent / "data" / "unified_taxonomy.json"

UNIFIED_TAXONOMY_TREE: dict[str, tuple[str, ...]] = {
    "Frutas y Verduras": (
        "Frutas frescas",
        "Verduras, hortalizas y tubérculos",
        "Hierbas, aromáticas y plantas",
        "Pulpas y fruver congelado",
    ),
    "Carnes, Pescados y Charcutería": (
        "Carne de res",
        "Carne de cerdo",
        "Pollo y aves",
        "Pescados y mariscos",
        "Otras carnes",
        "Carnes frías y charcutería",
    ),
    "Lácteos, Huevos y Refrigerados": (
        "Leches",
        "Bebidas vegetales",
        "Yogures, kumis y avenas",
        "Quesos y cuajadas",
        "Mantequillas, margarinas y cremas",
        "Huevos",
        "Arepas y tortillas",
    ),
    "Despensa": (
        "Arroz, granos y semillas",
        "Pastas y fideos",
        "Aceites y vinagres",
        "Harinas y premezclas",
        "Azúcar, panela y endulzantes",
        "Café, chocolate e infusiones",
        "Cereales, granolas y avenas",
        "Salsas, condimentos y sopas",
        "Enlatados y conservas",
        "Mermeladas, arequipes y untables",
        "Repostería y gelatinas",
        "Saludable y especiales",
    ),
    "Panadería y Pastelería": (
        "Panadería fresca",
        "Panadería empacada",
        "Tortas y pastelería dulce",
    ),
    "Bebidas": (
        "Aguas",
        "Gaseosas y maltas",
        "Jugos, néctares y refrescos",
        "Hidratantes y energizantes",
        "Té líquido y bebidas listas",
    ),
    "Snacks, Galletas y Dulces": (
        "Pasabocas salados",
        "Galletas",
        "Frutos secos y semillas",
        "Chocolates, dulces y confitería",
    ),
    "Congelados y Comidas Listas": (
        "Helados y postres",
        "Comidas preparadas",
        "Congelados y hielo",
    ),
    "Cuidado Personal y Bebés": (
        "Cuidado capilar",
        "Cuidado corporal, facial y solar",
        "Cuidado oral",
        "Higiene íntima y protección",
        "Afeitado, depilación y repelentes",
        "Pañales y pañitos húmedos",
        "Alimentación infantil",
        "Aseo y accesorios del bebé",
    ),
    "Hogar, Aseo y Mascotas": (
        "Detergentes y cuidado de ropa",
        "Limpiadores y lavalozas",
        "Ambientadores e insecticidas",
        "Implementos de limpieza",
        "Papeles, desechables y empaques",
        "Mascotas",
        "Hogar general y promociones",
    ),
}

VALID_CATEGORY_PAIRS: frozenset[tuple[str, str]] = frozenset(
    (macro, sub)
    for macro, subs in UNIFIED_TAXONOMY_TREE.items()
    for sub in subs
)

_TOKEN_STOPWORDS: frozenset[str] = frozenset(
    {
        "de",
        "del",
        "la",
        "las",
        "el",
        "los",
        "en",
        "con",
        "sin",
        "para",
        "por",
        "y",
        "o",
        "otros",
        "otras",
        "otro",
        "otra",
        "mas",
        "productos",
        "especiales",
        "especial",
        "supermercado",
        "mercado",
        "despensa",
        "mundo",
        "cuidado",
        "aseo",
        "hogar",
        "personal",
        "marcas",
        "propias",
    }
)


def _slugify(label: str) -> str:
    norm = strip_accents_lower(label)
    return re.sub(r"[^a-z0-9]+", "-", norm).strip("-")


def _tokenize(text: str) -> list[str]:
    norm = strip_accents_lower(text)
    return [
        tok
        for tok in re.findall(r"[a-z0-9]+", norm)
        if len(tok) >= 3 and tok not in _TOKEN_STOPWORDS
    ]


@dataclass(frozen=True, slots=True)
class UnifiedCategoryMatch:
    macro_categoria: str
    subcategoria: str
    macro_slug: str
    sub_slug: str
    source: str  # "ai_studio" | "homologated" | "inferred"


def parse_ai_studio_classifications(
    ai_studio_txt: Path = DEFAULT_AI_STUDIO_TXT,
) -> dict[tuple[str, str], tuple[str, str]]:
    """Lee las filas válidas clasificadas por Google AI Studio (`store_id;ruta;macro;sub`)."""
    if not ai_studio_txt.is_file():
        return {}

    parsed: dict[tuple[str, str], tuple[str, str]] = {}
    for raw_line in ai_studio_txt.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("store_id;") or line.count(";") != 3:
            continue
        store_id, route, macro, sub = (part.strip() for part in line.split(";", 3))
        if not store_id or not route:
            continue
        if (macro, sub) not in VALID_CATEGORY_PAIRS:
            continue
        parsed[(store_id, route)] = (macro, sub)
    return parsed


class UnifiedTaxonomyClassifier:
    """Homologa cualquier ruta de tienda o nombre de producto a las 10x59 categorías unificadas."""

    def __init__(
        self,
        exact_by_store_route: dict[tuple[str, str], tuple[str, str, str]],
    ) -> None:
        self.exact_by_store_route = dict(exact_by_store_route)
        self._path_votes: dict[str, Counter[tuple[str, str]]] = defaultdict(Counter)
        self._leaf_votes: dict[str, Counter[tuple[str, str]]] = defaultdict(Counter)
        self._token_weights: dict[str, Counter[tuple[str, str]]] = defaultdict(Counter)
        self._train_from_exact()

    def _train_from_exact(self) -> None:
        for (_store_id, route), (macro, sub, _source) in self.exact_by_store_route.items():
            pair = (macro, sub)
            segs = [strip_accents_lower(part) for part in route.split(" > ") if strip_accents_lower(part)]
            if not segs:
                continue
            self._path_votes[" > ".join(segs)][pair] += 1
            self._leaf_votes[segs[-1]][pair] += 1
            for idx, seg in enumerate(segs):
                weight = 5.0 if idx == len(segs) - 1 else (2.5 if idx == len(segs) - 2 else 1.0)
                for tok in _tokenize(seg):
                    self._token_weights[tok][pair] += weight

    @staticmethod
    def _contextual_override(segs: list[str], fallback: tuple[str, str] | None = None) -> tuple[str, str] | None:
        joined = " > ".join(segs)
        leaf = segs[-1] if segs else ""
        parent = segs[-2] if len(segs) >= 2 else ""

        # Cuando la hoja es genérica ('Otros', 'Alimentos'), evaluar usando la subrama padre
        effective_leaf = parent if leaf in {"otros", "otras", "alimentos"} and parent else leaf

        # Mascotas siempre va a Hogar, Aseo y Mascotas > Mascotas
        if any(tok in joined for tok in ("mascota", "perros", "gatos", "aves para mascota", "peces", "roedores")) and (
            "pollo" not in joined and "pescado" not in joined
        ):
            return ("Hogar, Aseo y Mascotas", "Mascotas")

        # Desambiguar "Marcas Propias" según su categoría padre o nombre de marca propia conocido
        if leaf in {"baby ross", "supprah care", "suppra care", "ultra limp", "medalla de oro", "la giralda", "olimpica"}:
            if leaf == "baby ross":
                return ("Cuidado Personal y Bebés", "Aseo y accesorios del bebé")
            if leaf == "suppra care":
                return ("Cuidado Personal y Bebés", "Cuidado corporal, facial y solar")
            if leaf == "ultra limp":
                return ("Hogar, Aseo y Mascotas", "Limpiadores y lavalozas")
            return ("Hogar, Aseo y Mascotas", "Hogar general y promociones")

        if leaf == "marcas propias" and parent:
            if "bebidas" in parent:
                return ("Bebidas", "Gaseosas y maltas")
            if "congelados" in parent:
                return ("Congelados y Comidas Listas", "Congelados y hielo")
            if "desayuno" in parent:
                return ("Lácteos, Huevos y Refrigerados", "Leches")
            if "despensa" in parent:
                return ("Despensa", "Arroz, granos y semillas")
            if "lacteos" in parent or "refrigerados" in parent:
                return ("Lácteos, Huevos y Refrigerados", "Leches")
            if "aseo" in parent:
                return ("Hogar, Aseo y Mascotas", "Limpiadores y lavalozas")
            if "cuidado personal" in parent:
                return ("Cuidado Personal y Bebés", "Cuidado corporal, facial y solar")
            if "panaderia" in parent:
                return ("Panadería y Pastelería", "Panadería empacada")
            if "reposteria" in parent:
                return ("Despensa", "Repostería y gelatinas")
            if "saludable" in parent:
                return ("Despensa", "Saludable y especiales")
            if "helados" in parent or "pasabocas" in parent:
                return ("Congelados y Comidas Listas", "Helados y postres")
            if "frutas" in parent or "verduras" in parent:
                return ("Frutas y Verduras", "Frutas frescas")
            if "mascota" in parent:
                return ("Hogar, Aseo y Mascotas", "Mascotas")

        # Productos saludables antes que alimentos genéricos
        if "saludable" in joined and "bebidas" not in leaf:
            return ("Despensa", "Saludable y especiales")

        # Contexto bebé explícito antes de confundirse con despensa/aceites
        if any(tok in joined for tok in ("bebe", "bebes", "infantil")):
            if any(k in joined for k in ("panal", "panales", "toallita", "panito")):
                return ("Cuidado Personal y Bebés", "Pañales y pañitos húmedos")
            if any(k in joined for k in ("aliment", "compota", "papilla", "cereal", "colada", "formula", "leche", "yogur", "galleta")):
                return ("Cuidado Personal y Bebés", "Alimentación infantil")
            return ("Cuidado Personal y Bebés", "Aseo y accesorios del bebé")

        # Cuidado personal / belleza / facial / solar antes que bebidas "hidratantes"
        if any(k in joined for k in ("cuidado personal", "belleza", "cuidado de la piel", "cuidado corporal", "cuidado facial", "dermo")) and "limpieza" not in joined:
            if any(k in effective_leaf for k in ("crema dental", "cepillo dental", "cepillos dentales", "enjuague bucal", "enjuagues bucales", "seda dental", "sedas dentales", "ortodoncia", "cuidado oral", "cuidado bucal")):
                return ("Cuidado Personal y Bebés", "Cuidado oral")
            if any(k in effective_leaf for k in ("shampoo", "acondicionador", "peinar", "fijador", "cabello", "capilar")):
                return ("Cuidado Personal y Bebés", "Cuidado capilar")
            if any(k in effective_leaf for k in ("toalla higienica", "toallas higienicas", "tampon", "protector diario", "protectores", "jabon intimo", "jabones intimos", "proteccion femenina", "proteccion sanitaria", "higiene femenina")):
                return ("Cuidado Personal y Bebés", "Higiene íntima y protección")
            if any(k in effective_leaf for k in ("afeitado", "afeitar", "afeitador", "cortador", "depilacion", "repelente")):
                return ("Cuidado Personal y Bebés", "Afeitado, depilación y repelentes")
            return ("Cuidado Personal y Bebés", "Cuidado corporal, facial y solar")

        # Lavandería y aseo del hogar antes que café/bebidas ("en polvo - líquido")
        if "cuidado de la ropa" in joined or re.search(r"\b(?:detergente|suavizante|quitamancha|pre-?lavado|pre-?planchado|blanqueador(?:es)?|jabones de lavar ropa)\b", effective_leaf):
            return ("Hogar, Aseo y Mascotas", "Detergentes y cuidado de ropa")
        if "utensilios" in joined and "limpieza" in joined:
            return ("Hogar, Aseo y Mascotas", "Implementos de limpieza")
        if any(k in effective_leaf for k in ("ambientador", "insecticida")):
            return ("Hogar, Aseo y Mascotas", "Ambientadores e insecticidas")
        if any(k in effective_leaf for k in ("papel higienico", "servilleta", "toalla de cocina", "toallas de cocina", "aluminio", "bolsas recerrables", "desechable", "desechables", "vasos desechables", "cubiertos", "platos", "plasticos")):
            return ("Hogar, Aseo y Mascotas", "Papeles, desechables y empaques")
        if any(k in effective_leaf for k in ("trapero", "escoba", "esponja", "guante", "pano", "cepillo", "bolsas de basura", "utensilios de limpieza", "utensilios limpieza", "betun", "betunes")):
            return ("Hogar, Aseo y Mascotas", "Implementos de limpieza")
        if any(k in effective_leaf for k in ("lavaloza", "lavaplatos", "desengrasante", "desinfectante", "limpiavidrio", "limpiador", "cera", "destapa canerias", "superficies")):
            return ("Hogar, Aseo y Mascotas", "Limpiadores y lavalozas")
        if any(k in effective_leaf for k in ("bombillo", "pila", "vela", "velon", "carbon", "fosforo", "encendedor", "jardineria")):
            return ("Hogar, Aseo y Mascotas", "Hogar general y promociones")

        # Frutas y Verduras explícitas (antes de cualquier colisión con "repollo" vs "pollo")
        if "frutas" in joined or "verduras" in joined or "hortalizas" in joined:
            if "congelad" in joined or "pulpa" in joined or "concentrados" in joined or "papas - yucas - patacones" in effective_leaf:
                return ("Frutas y Verduras", "Pulpas y fruver congelado")
            if any(k in effective_leaf for k in ("hierba", "aromatica", "cilantro", "sabila", "aloe", "champinon", "raices")):
                return ("Frutas y Verduras", "Hierbas, aromáticas y plantas")
            if "verduras" in joined or "hortalizas" in joined:
                return ("Frutas y Verduras", "Verduras, hortalizas y tubérculos")
            return ("Frutas y Verduras", "Frutas frescas")

        # Café, té, chocolate e infusiones
        if any(k in effective_leaf for k in ("cafe", "cafes", "cocoa", "aromatica", "bebidas calientes", "bebidas achocolatadas")) or effective_leaf in {"te", "tes"}:
            return ("Despensa", "Café, chocolate e infusiones")
        if "te frio" in effective_leaf or "te liquido" in effective_leaf:
            return ("Bebidas", "Té líquido y bebidas listas")

        # Snacks, pasabocas, galletas, confitería (antes de helados o panadería)
        if any(k in effective_leaf for k in ("pasabocas", "snacks")):
            if "congelad" in joined:
                return ("Congelados y Comidas Listas", "Congelados y hielo")
            return ("Snacks, Galletas y Dulces", "Pasabocas salados")
        if "galletas" in effective_leaf:
            return ("Snacks, Galletas y Dulces", "Galletas")
        if any(k in effective_leaf for k in ("mani", "frutos secos", "nueces", "semillas")):
            return ("Snacks, Galletas y Dulces", "Frutos secos y semillas")
        if any(k in effective_leaf for k in ("chocolates", "caramelos", "gomas", "gomitas", "bocadillos", "confiteria", "dulces")):
            if "untables" in joined or "conservas" in effective_leaf:
                return ("Despensa", "Mermeladas, arequipes y untables")
            return ("Snacks, Galletas y Dulces", "Chocolates, dulces y confitería")

        # Despensa clave
        if any(k in effective_leaf for k in ("arroz", "arroces", "granos", "frijol", "lenteja", "garbanzo")):
            return ("Despensa", "Arroz, granos y semillas")
        if any(k in effective_leaf for k in ("pasta", "pastas", "spaguetti", "espagueti", "fideo")):
            return ("Despensa", "Pastas y fideos")
        if "harina" in effective_leaf or "premezcla" in effective_leaf or "pancakes" in effective_leaf:
            return ("Despensa", "Harinas y premezclas")
        if "aceite" in effective_leaf or "vinagre" in effective_leaf:
            return ("Despensa", "Aceites y vinagres")

        # Bebidas
        if any(k in effective_leaf for k in ("energizante", "isotonica", "isotonico", "hidratante")):
            return ("Bebidas", "Hidratantes y energizantes")
        if any(k in effective_leaf for k in ("gaseosa", "malta", "soda")):
            return ("Bebidas", "Gaseosas y maltas")
        if effective_leaf in {"jugos", "jugos y refrescos"} or any(k in effective_leaf for k in ("nectar", "refrescos en polvo", "concentrados")):
            return ("Bebidas", "Jugos, néctares y refrescos")
        if re.search(r"\baguas?\b", effective_leaf) and "bebidas" in joined:
            return ("Bebidas", "Aguas")
        if "vegetal" in effective_leaf and ("leche" in effective_leaf or "bebidas" in joined):
            return ("Lácteos, Huevos y Refrigerados", "Bebidas vegetales")

        # Lácteos, huevos y charcutería
        if any(k in effective_leaf for k in ("huevos", "huevo")):
            return ("Lácteos, Huevos y Refrigerados", "Huevos")
        if any(k in effective_leaf for k in ("arepa", "tortilla")):
            return ("Lácteos, Huevos y Refrigerados", "Arepas y tortillas")
        if any(k in effective_leaf for k in ("queso", "quesos", "quesillo", "cuajada", "suero")):
            return ("Lácteos, Huevos y Refrigerados", "Quesos y cuajadas")
        if "mantequillas" in joined or "margarina" in effective_leaf or "crema de leche" in effective_leaf:
            return ("Lácteos, Huevos y Refrigerados", "Mantequillas, margarinas y cremas")
        if any(k in effective_leaf for k in ("yogur", "kumis", "avena")):
            if "despensa" in joined or "cereales" in joined:
                return ("Despensa", "Cereales, granolas y avenas")
            return ("Lácteos, Huevos y Refrigerados", "Yogures, kumis y avenas")
        if "leche" in effective_leaf and "crema de leche" not in effective_leaf and "condensada" not in effective_leaf and "modificador" not in joined:
            return ("Lácteos, Huevos y Refrigerados", "Leches")
        if effective_leaf in {"alimentos refrigerados"}:
            return ("Congelados y Comidas Listas", "Comidas preparadas")

        # Congelados y postres
        if effective_leaf == "hielo":
            return ("Congelados y Comidas Listas", "Congelados y hielo")
        if "helado" in effective_leaf or "paleta" in effective_leaf or ("helados" in parent and effective_leaf == "postres"):
            return ("Congelados y Comidas Listas", "Helados y postres")
        if any(k in effective_leaf for k in ("lasana", "pizza", "empanada", "tamal", "precocid", "alimentos preparados", "comidas preparadas", "apanado", "comidas especiales")):
            return ("Congelados y Comidas Listas", "Comidas preparadas")
        if "congelados" in joined:
            return ("Congelados y Comidas Listas", "Congelados y hielo")

        # Panadería
        if "pan" in effective_leaf or "panaderia" in joined:
            if "dulce" in effective_leaf or "torta" in effective_leaf or "ponque" in effective_leaf or "antojos" in effective_leaf or "pastel" in effective_leaf or "reposteria" in effective_leaf:
                return ("Panadería y Pastelería", "Tortas y pastelería dulce")
            if "fresca" in effective_leaf or "artesanal" in effective_leaf or "de la casa" in effective_leaf:
                return ("Panadería y Pastelería", "Panadería fresca")
            return ("Panadería y Pastelería", "Panadería empacada")

        # Carnes, pollo, pescado (usando límites de palabra en la hoja!)
        if re.search(r"\b(?:pescad\w*|mariscos?|atun|camaron|salmon)\b", effective_leaf):
            if "conserva" in joined or "enlatado" in joined:
                return ("Despensa", "Enlatados y conservas")
            return ("Carnes, Pescados y Charcutería", "Pescados y mariscos")
        if "cerdo" in effective_leaf or effective_leaf in {"costilla", "costilla con tocino especial", "espinazo", "pernil", "tocino especial", "ossobuco", "cordon de cerdo", "cordon gourmet"}:
            return ("Carnes, Pescados y Charcutería", "Carne de cerdo")
        if re.search(r"\b(?:pollo|pavo|aves)\b", effective_leaf):
            return ("Carnes, Pescados y Charcutería", "Pollo y aves")
        if "carne de res" in joined or "carnes de res" in effective_leaf or effective_leaf in {"lomo", "lomo gourmet", "solomo", "solomito", "cadera", "sobrebarriga especial", "falda especial", "carne molida", "anca", "capon", "huevo de pierna", "centro de pierna"}:
            return ("Carnes, Pescados y Charcutería", "Carne de res")
        if "carnes frias" in joined or "charcuteria" in joined or "delicatessen" in effective_leaf or re.search(r"\b(?:chorizos?|salchichas?|salchichon\w*|jamon\w*|mortadela\w*|cabanos?|tocineta|carnes especiales)\b", effective_leaf):
            return ("Carnes, Pescados y Charcutería", "Carnes frías y charcutería")

        return fallback

    def classify(
        self,
        *,
        store_id: str | None = None,
        category_path: Sequence[str] | str | None = None,
        product_name: str | None = None,
    ) -> UnifiedCategoryMatch:
        if isinstance(category_path, str):
            raw_segs = [part.strip() for part in category_path.split(" > ") if part.strip()]
        elif category_path:
            raw_segs = [str(part).strip() for part in category_path if str(part).strip()]
        else:
            raw_segs = []

        route_str = " > ".join(raw_segs)
        store_norm = (store_id or "").strip().lower()

        if store_norm and route_str and (store_norm, route_str) in self.exact_by_store_route:
            macro, sub, source = self.exact_by_store_route[(store_norm, route_str)]
            return UnifiedCategoryMatch(
                macro_categoria=macro,
                subcategoria=sub,
                macro_slug=_slugify(macro),
                sub_slug=_slugify(sub),
                source=source,
            )

        segs = [strip_accents_lower(s) for s in raw_segs if strip_accents_lower(s)]
        if not segs and product_name:
            segs = [strip_accents_lower(product_name)]

        norm_path = " > ".join(segs)
        if norm_path and norm_path in self._path_votes:
            macro, sub = self._path_votes[norm_path].most_common(1)[0][0]
            return UnifiedCategoryMatch(
                macro_categoria=macro,
                subcategoria=sub,
                macro_slug=_slugify(macro),
                sub_slug=_slugify(sub),
                source="homologated",
            )

        contextual = self._contextual_override(segs)
        if contextual is not None:
            macro, sub = contextual
            return UnifiedCategoryMatch(
                macro_categoria=macro,
                subcategoria=sub,
                macro_slug=_slugify(macro),
                sub_slug=_slugify(sub),
                source="homologated" if route_str else "inferred",
            )

        if segs and segs[-1] in self._leaf_votes:
            top_pair, top_count = self._leaf_votes[segs[-1]].most_common(1)[0]
            if top_count * 2 >= self._leaf_votes[segs[-1]].total():
                macro, sub = top_pair
                return UnifiedCategoryMatch(
                    macro_categoria=macro,
                    subcategoria=sub,
                    macro_slug=_slugify(macro),
                    sub_slug=_slugify(sub),
                    source="homologated" if route_str else "inferred",
                )

        scores: Counter[tuple[str, str]] = Counter()
        for idx, seg in enumerate(segs):
            weight = 5.0 if idx == len(segs) - 1 else (2.5 if idx == len(segs) - 2 else 1.0)
            for tok in _tokenize(seg):
                total = self._token_weights[tok].total()
                if total <= 0:
                    continue
                for pair, cnt in self._token_weights[tok].items():
                    scores[pair] += weight * (cnt / total)

        if scores:
            macro, sub = scores.most_common(1)[0][0]
        else:
            macro, sub = ("Despensa", "Saludable y especiales")

        return UnifiedCategoryMatch(
            macro_categoria=macro,
            subcategoria=sub,
            macro_slug=_slugify(macro),
            sub_slug=_slugify(sub),
            source="homologated" if route_str else "inferred",
        )


def build_and_save_unified_taxonomy(
    *,
    ai_studio_txt: Path = DEFAULT_AI_STUDIO_TXT,
    active_txt: Path = DEFAULT_ACTIVE_CATEGORIES_TXT,
    out_json: Path = DEFAULT_TAXONOMY_JSON,
    pending_out_txt: Path | None = Path("docs/categorias_restantes_ai_studio.txt"),
) -> dict[str, int]:
    """Combina las 1,589 filas de Google AI Studio con homologación determinista al 100 %."""
    ai_map = parse_ai_studio_classifications(ai_studio_txt)
    exact_entries: dict[tuple[str, str], tuple[str, str, str]] = {
        key: (macro, sub, "ai_studio") for key, (macro, sub) in ai_map.items()
    }
    classifier = UnifiedTaxonomyClassifier(exact_entries)

    active_rows: list[tuple[str, str]] = []
    if active_txt.is_file():
        for raw_line in active_txt.read_text(encoding="utf-8").splitlines():
            if " | " not in raw_line:
                continue
            store_id, route = (part.strip() for part in raw_line.split(" | ", 1))
            if store_id and route:
                active_rows.append((store_id, route))

    pending_lines: list[str] = []
    homologated_count = 0
    for store_id, route in active_rows:
        if (store_id, route) in exact_entries:
            continue
        match = classifier.classify(store_id=store_id, category_path=route)
        exact_entries[(store_id, route)] = (match.macro_categoria, match.subcategoria, "homologated")
        pending_lines.append(f"{store_id} | {route}")
        homologated_count += 1

    payload = {
        "macro_categories": [
            {
                "macro_categoria": macro,
                "macro_slug": _slugify(macro),
                "subcategories": [
                    {"subcategoria": sub, "sub_slug": _slugify(sub)}
                    for sub in subs
                ],
            }
            for macro, subs in UNIFIED_TAXONOMY_TREE.items()
        ],
        "mappings": [
            {
                "store_id": store_id,
                "ruta_completa": route,
                "macro_categoria": macro,
                "subcategoria": sub,
                "macro_slug": _slugify(macro),
                "sub_slug": _slugify(sub),
                "source": source,
            }
            for (store_id, route), (macro, sub, source) in sorted(exact_entries.items())
        ],
    }

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if pending_out_txt is not None:
        pending_out_txt.parent.mkdir(parents=True, exist_ok=True)
        pending_out_txt.write_text(
            "\n".join(pending_lines) + ("\n" if pending_lines else ""),
            encoding="utf-8",
        )

    return {
        "ai_studio": len(ai_map),
        "homologated": homologated_count,
        "total": len(exact_entries),
    }


def load_unified_classifier(json_path: Path = DEFAULT_TAXONOMY_JSON) -> UnifiedTaxonomyClassifier:
    """Carga el mapa homologado `etl/data/unified_taxonomy.json` en memoria."""
    exact: dict[tuple[str, str], tuple[str, str, str]] = {}
    if json_path.is_file():
        data = json.loads(json_path.read_text(encoding="utf-8"))
        for row in data.get("mappings") or []:
            sid = str(row.get("store_id") or "").strip().lower()
            route = str(row.get("ruta_completa") or "").strip()
            macro = str(row.get("macro_categoria") or "").strip()
            sub = str(row.get("subcategoria") or "").strip()
            src = str(row.get("source") or "homologated").strip()
            if sid and route and (macro, sub) in VALID_CATEGORY_PAIRS:
                exact[(sid, route)] = (macro, sub, src)
    return UnifiedTaxonomyClassifier(exact)


if __name__ == "__main__":
    stats = build_and_save_unified_taxonomy()
    print("TAXONOMIA UNIFICADA:", stats)
