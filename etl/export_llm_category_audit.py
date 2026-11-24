"""Exporta a `.txt` los maestros sospechosos de estar mal categorizados en cualquiera de las 27 categorías.

Siguiendo `AGENTS.md` (Regla #1), reclasificar productos ambiguos o con palabras cruzadas
(p.ej. `Pan perro Bimbo` en `mascotas`, `Bebida Clight` en `frutas-y-verduras`,
`Jabón Palmolive Yogurt` en `yogures-y-kumis`, `Alimento gato atún` en `enlatados-y-conservas`)
requiere comprensión semántica de un LLM dedicado y no solo regex en Python.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import unicodedata
from pathlib import Path

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH

DEFAULT_OUTPUT_PATH = Path("etl/data/llm_category_audit.txt")

# Sondas de contradicción semántica por categoría para detectar fugas de palabras clave.
CATEGORY_LEAK_PROBES: dict[str, str] = {
    "frutas-y-verduras": r"\b(bebida|refresco|gaseosa|jugo|nectar|soda|hidratante|energizante|cerveza|vino|te\s+verde|te\s+negro|te\s+helado|frutto|soka|clight|boka|flashlyte|mascarilla|shampoo|jabon|aceite\s+corporal|llamadientes|tortilla|tostones|galleta|dulce|caramelo|gomita|yogurt|lacte[oa]|helado|mermelada|compota|snack)\b",
    "arroces-y-granos": r"\b(bebida|leche\s+de\s+arroz|torta|galleta|harina|vinagre|inflado|sopa|crema\s+de\s+arroz|colada|perro|gato)\b",
    "lacteos-y-leches": r"\b(galleta|chocolatina|jabon|crema\s+(?:facial|corporal|manos|peinar|dental)|shampoo|perro|gato|mascota|arequipe|helado|yogurt|queso)\b",
    "yogures-y-kumis": r"\b(jabon|shampoo|crema\s+(?:facial|corporal|manos)|galleta|cereal)\b",
    "quesos-y-mantequillas": r"\b(papa|papas|doritos|cheetos|tostacos|galleta|salsa|pasta|ravioli|lasagna|pizza|empanada|perro|gato|crema\s+(?:facial|corporal))\b",
    "huevos-y-derivados": r"\b(chocolate|kinder|pascua|sorpresa|shampoo|jabon|fideo|pasta|galleta|ponque)\b",
    "cafe-te-y-chocolate": r"\b(caramelo|gomita|galleta|torta|jabon|shampoo|exfoliante|velon|vela|esencia|licor|crema\s+corporal|yogurt|helado)\b",
    "aceites-y-vinagres": r"\b(corporal|bebe|masaje|cabello|esencial|motor|carro|moto|bronceador|solar|desmaquillante|barba|unas|shampoo|crema)\b",
    "azucar-panela-miel": r"\b(sin\s+azucar|cero\s+azucar|galleta|bebida|gaseosa|jugo|yogurt|cereal|compota|exfoliante|jabon|shampoo|crema)\b",
    "carnes-pollo-pescado": r"\b(perro|gato|mascota|alimento\s+humedo|sobre\s+(?:perro|gato)|sabor\s+(?:carne|pollo)|caldo|sazonador|sopa|pasta|ramen|noodles)\b",
    "jamones-y-embutidos": r"\b(perro|gato|mascota|pizza|salsa|queso\s+crema|pan\s+perro)\b",
    "harinas-y-reposteria": r"\b(dental|dientes|colgate|oral|tortilla|galleta|ponque|torta\s+lista|pan\s+tajado)\b",
    "pastas-y-fideos": r"\b(dental|dientes|colgate|oral|cepillo|salsa\s+para\s+pasta)\b",
    "panaderia-y-arepas": r"\b(harina|premezcla|perro|gato|mascota|molde)\b",
    "aguas-jugos-y-gaseosas": r"\b(shampoo|jabon|crema|desodorante|suavizante|detergente|limpiador|cloro|ambientador|gelatina|hidratante\s+(?:corporal|facial|labial|piel|manos))\b",
    "aseo-hogar-y-lavanderia": r"\b(shampoo|acondicionador|crema\s+dental|cepillo\s+de\s+dientes|desodorante|toalla\s+higienica|protector\s+diario|panal)\b",
    "cuidado-personal-e-higiene": r"\b(detergente|lavaloza|suavizante|blanqueador|limpiapisos|trapero|escoba|esponja\s+cocina|ambientador)\b",
    "bebes-y-maternidad": r"\b(aceite\s+(?:de\s+oliva|vegetal|girasol|cocina)|arroz|frijol|lenteja|perro|gato|mascota|cerveza)\b",
    "mascotas": r"\b(pan\s+(?:perro|perros)|salchicha|perro\s+caliente|gato\s+negro|vino|cerveza|galleta\s+soda|atun\s+van\s+camps)\b",
    "salsas-y-condimentos": r"\b(jabon|shampoo|crema\s+(?:facial|corporal|manos|dental)|galleta|papa\s+frita|doritos)\b",
    "galletas-y-snacks": r"\b(jabon|shampoo|aceite|salsa|perro|gato|mascota)\b",
    "dulces-y-chocolateria": r"\b(torta|ponque|helado|yogurt|cereal|jabon|shampoo|crema\s+corporal)\b",
    "enlatados-y-conservas": r"\b(gato|perro|mascota|alimento\s+(?:humedo|para\s+gato))\b",
    "congelados-y-helados": r"\b(bebida\s+fria|gaseosa|agua|shampoo|jabon)\b",
    "hogar-y-desechables": r"\b(galleta|chocolate|arroz|leche|yogurt)\b",
    "carbon-lena-y-asados": r"\b(jabon|shampoo|mascarilla|crema\s+dental|cepillo)\b",
    "cuidado-del-calzado": r"\b(jabon\s+corporal|shampoo|crema\s+facial)\b",
}


def _norm(s: str | None) -> str:
    ascii_s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"\s+", " ", ascii_s).strip()


def export_llm_category_audit(
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    output_path: Path = DEFAULT_OUTPUT_PATH,
) -> tuple[int, Path]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        cats = conn.execute("SELECT id, slug, name FROM canonical_categories ORDER BY slug ASC").fetchall()
        cat_by_slug = {str(c["slug"]): (int(c["id"]), str(c["name"])) for c in cats}
        valid_slugs_text = "\n".join(f"  - {c['slug']} ({c['name']})" for c in cats)

        flagged: list[tuple[str, str, str, str]] = []
        for slug, pattern in CATEGORY_LEAK_PROBES.items():
            if slug not in cat_by_slug:
                continue
            cid, _cname = cat_by_slug[slug]
            rx = re.compile(pattern)
            rows = conn.execute(
                """
                SELECT m.id, m.normalized_name, m.brand,
                       COALESCE(MIN(s.raw_name), m.normalized_name) AS sample_name
                FROM master_products m
                JOIN store_skus s ON s.master_product_id = m.id
                WHERE m.canonical_category_id = ?
                GROUP BY m.id
                """,
                (cid,),
            ).fetchall()
            for r in rows:
                nname = _norm(r["normalized_name"])
                sname = " ".join(str(r["sample_name"] or "").replace("|", " ").split())
                if rx.search(nname) or rx.search(_norm(sname)):
                    brand = str(r["brand"] or "").replace("|", " ").strip()
                    flagged.append((str(r["id"]), slug, brand, sname))
    finally:
        conn.close()

    flagged.sort(key=lambda x: (x[1], x[3].lower()))
    output_path.parent.mkdir(parents=True, exist_ok=True)

    header = f"""INSTRUCCIONES PARA EL LLM (AUDITORIA DE CATEGORIAS EN SUPERMERCADOS DE COLOMBIA)
===========================================================================
Contexto:
Cada fila es un producto maestro cuya `categoria_actual` fue asignada por palabras clave
y presenta una posible contradiccion semantica (ej. una bebida dentro de `frutas-y-verduras`,
un pan perro dentro de `mascotas`, un jabon dentro de `yogures-y-kumis`, etc.).

CATEGORIAS OFICIALES VALIDAS (USA EXACTAMENTE EL SLUG):
{valid_slugs_text}
  - PURGE (solo si NO es un producto de supermercado, ej. accesorios de auto, juguetes, ropa, etc.)

FORMATO EXACTO DE RESPUESTA (UNA LINEA POR REGISTRO, SIN EXPLICACIONES):
- Si la `categoria_actual` YA ES CORRECTA (falso positivo de la auditoria, ej. "Maiz dulce fyv" en `frutas-y-verduras`, "Salchicha perro caliente" en `jamones-y-embutidos`, "Cafe Colcafe Caramelo" en `cafe-te-y-chocolate`), OMITELO.
- Solo devuelve los que requieran cambio:
  <master_id> | MOVE | <slug_categoria_correcta>
  <master_id> | PURGE |
- NO cambies el `<master_id>`. NO agregues numeracion ni texto extra.

COLUMNAS DE ENTRADA:
master_id | categoria_actual | marca | nombre_producto
---------------------------------------------------------------------------
"""
    lines = [header]
    for mid, slug, brand, sname in flagged:
        lines.append(f"{mid} | {slug} | {brand} | {sname}\n")

    output_path.write_text("".join(lines), encoding="utf-8")
    return len(flagged), output_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Exporta auditoría transversal de categorías a .txt para LLM.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--out", default=str(DEFAULT_OUTPUT_PATH))
    args = parser.parse_args(argv)
    count, path = export_llm_category_audit(Path(args.db), Path(args.out))
    print(f"Exported {count} candidate masters to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
