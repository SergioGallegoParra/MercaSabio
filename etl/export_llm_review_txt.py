"""Exporta en texto plano limpio las tareas semánticas que requieren un LLM dedicado.

Genera archivos `.txt` autocontenidos desde `etl/data/local_staging.db` (100% local)
para clasificar categorías faltantes, desambiguar licor vs uso culinario y revisar
posibles colisiones o duplicados sutiles que no conviene resolver solo con regex.

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.export_llm_review_txt
"""

from __future__ import annotations

import argparse
import sqlite3
from collections import defaultdict
from pathlib import Path

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.match_safety import meaningful_tokens, normalize_brand, token_jaccard

_DEFAULT_OUT_DIR = Path("exports")


def _clean_cell(val: object) -> str:
    if val is None:
        return ""
    return " ".join(str(val).replace("\t", " ").replace("\r", " ").replace("\n", " ").split())


def _is_supermarket_slug(slug: str) -> bool:
    excluded_prefixes = (
        "cigarrillos-",
        "juguetes-",
        "electrodomesticos-",
        "organizacion-",
        "decoracion-",
        "bienestar-sexual-",
        "accesorios-moda-",
        "accesorios-y-otras-mascotas",
        "bonos-boletas-",
        "papeleria-prensa-",
    )
    return not slug.startswith(excluded_prefixes)


def export_llm_review_files(
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    out_dir: Path = _DEFAULT_OUT_DIR,
    uncategorized_ambiguous_limit: int = 1000,
    uncat_batch_size: int = 2100,
) -> dict[str, int]:
    if not db_path.exists():
        raise FileNotFoundError(f"No existe la base local: {db_path}")

    out_dir.mkdir(parents=True, exist_ok=True)
    ambiguous_path = out_dir / "llm_revision_semantica.txt"
    uncat_all_path = out_dir / "llm_sin_categoria_completo.txt"

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cat_rows = conn.execute(
            "SELECT id, slug, COALESCE(name, slug) AS name FROM canonical_categories ORDER BY slug ASC"
        ).fetchall()
        valid_cats = [(str(r["slug"]), _clean_cell(r["name"])) for r in cat_rows if _is_supermarket_slug(str(r["slug"]))]

        # 1) Casos de alcohol vs uso culinario (vinos/cervezas/licores aún presentes)
        liquor_culinary_rows = conn.execute(
            """
            SELECT
                mp.id AS master_product_id,
                mp.normalized_name,
                mp.brand,
                mp.net_content,
                mp.unit_measure,
                GROUP_CONCAT(DISTINCT ss.store_id) AS stores,
                MIN(ss.raw_name) AS sample_name,
                COUNT(ss.id) AS sku_count
            FROM master_products mp
            JOIN store_skus ss ON ss.master_product_id = mp.id
            JOIN canonical_categories cc ON cc.id = mp.canonical_category_id
            WHERE cc.slug = 'vinos-cervezas-y-licores'
            GROUP BY mp.id
            ORDER BY sku_count DESC, mp.normalized_name ASC
            """
        ).fetchall()

        # 2) Posibles colisiones / variantes sutiles pendientes (multi-SKU con baja similitud léxica)
        multi_sku_rows = conn.execute(
            """
            SELECT
                mp.id AS master_product_id,
                mp.ean,
                mp.brand,
                mp.normalized_name,
                mp.net_content,
                mp.unit_measure,
                ss.store_id,
                ss.raw_name,
                ss.id AS store_sku_id
            FROM master_products mp
            JOIN store_skus ss ON ss.master_product_id = mp.id
            WHERE mp.id IN (
                SELECT master_product_id
                FROM store_skus
                GROUP BY master_product_id
                HAVING COUNT(DISTINCT LOWER(TRIM(raw_name))) >= 2
            )
            ORDER BY mp.id, ss.store_id
            """
        ).fetchall()

        grouped_multi: dict[str, list[sqlite3.Row]] = defaultdict(list)
        for r in multi_sku_rows:
            grouped_multi[str(r["master_product_id"])].append(r)

        ambiguous_collisions: list[tuple[float, str, str, str, str, str]] = []
        for mid, items in grouped_multi.items():
            head = items[0]
            brand_norm = normalize_brand(head["brand"])
            tok_sets = [meaningful_tokens(str(it["raw_name"])) for it in items]
            min_jacc = 1.0
            for idx in range(len(tok_sets)):
                for jdx in range(idx + 1, len(tok_sets)):
                    j = token_jaccard(tok_sets[idx], tok_sets[jdx])
                    if j < min_jacc:
                        min_jacc = j
            if min_jacc >= 0.25:
                continue
            # Si todos los SKUs mencionan explícitamente la misma marca declarada, suelen ser sinónimos legítimos de EAN
            if brand_norm and all(brand_norm.split()[0] in str(it["raw_name"]).lower() for it in items):
                continue
            distinct_names = list(dict.fromkeys(_clean_cell(f"[{it['store_id']}] {it['raw_name']}") for it in items))
            ambiguous_collisions.append(
                (
                    min_jacc,
                    mid,
                    _clean_cell(head["ean"] or "SIN_EAN"),
                    _clean_cell(head["brand"]),
                    f"{head['net_content']} {head['unit_measure']}",
                    " || ".join(distinct_names[:6]),
                )
            )
        ambiguous_collisions.sort(key=lambda x: x[0])
        top_collisions = ambiguous_collisions[:1000]

        # 3) Maestros aún sin categoría canónica (priorizados por cobertura entre tiendas)
        uncat_rows = conn.execute(
            """
            SELECT
                mp.id AS master_product_id,
                mp.brand,
                mp.ean,
                mp.net_content,
                mp.unit_measure,
                COALESCE(NULLIF(TRIM(MIN(ss.display_name)), ''), MIN(ss.raw_name)) AS sample_name,
                COUNT(DISTINCT ss.store_id) AS store_count,
                COUNT(ss.id) AS sku_count,
                GROUP_CONCAT(DISTINCT ss.store_id) AS stores
            FROM master_products mp
            JOIN store_skus ss ON ss.master_product_id = mp.id
            WHERE mp.canonical_category_id IS NULL
            GROUP BY mp.id
            ORDER BY store_count DESC, sku_count DESC, sample_name ASC
            """
        ).fetchall()
    finally:
        conn.close()

    # Archivo 1 (Bloque 1 - Ambiguos): licor/culinario + posibles colisiones
    with ambiguous_path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(
            "=== INSTRUCCIONES PARA EL MODELO LLM DEDICADO ===\n"
            "Eres un clasificador experto de catálogo de supermercados en Colombia.\n"
            "NO inventes datos ni categorías fuera de la lista oficial. Responde ÚNICAMENTE en bloques TSV.\n"
            "Para productos no aptos para canasta familiar/mercado (ej. licores puros, cigarrillos, electrónica,\n"
            "ropa, juguetes o droguería controlada), marca decision = EXCLUIR_NO_MERCADO.\n\n"
            "--- CATEGORÍAS OFICIALES VÁLIDAS (slug | nombre) ---\n"
        )
        for slug, cname in valid_cats:
            fh.write(f"{slug}\t{cname}\n")

        fh.write(
            "\n--- SECCIÓN A: DESAMBIGUACIÓN LICOR VS USO CULINARIO / SIN ALCOHOL ---\n"
            "Formato de respuesta esperado (TSV):\n"
            "master_product_id\tdecision (MANTENER_MERCADO | EXCLUIR_NO_MERCADO)\tcanonical_slug_si_mantiene\tmotivo_breve\n\n"
            "master_product_id\tsample_name\tbrand\tcontent\tstores\tsku_count\n"
        )
        for r in liquor_culinary_rows:
            fh.write(
                "\t".join(
                    [
                        _clean_cell(r["master_product_id"]),
                        _clean_cell(r["sample_name"]),
                        _clean_cell(r["brand"]),
                        f"{r['net_content']} {r['unit_measure']}",
                        _clean_cell(r["stores"]),
                        str(r["sku_count"]),
                    ]
                )
                + "\n"
            )

        fh.write(
            "\n--- SECCIÓN B: POSIBLES COLISIONES DE VARIANTES/MARCAS PARA VERIFICACIÓN SEMÁNTICA ---\n"
            "Formato de respuesta esperado (TSV):\n"
            "master_product_id\taccion (MISMO_PRODUCTO | SEPARAR_VARIANTES)\tnotas_separacion\n\n"
            "master_product_id\tean\tbrand\tcontent\tskus_agrupados\n"
        )
        for _jacc, mid, ean, brand, content, grouped in top_collisions:
            fh.write("\t".join([mid, ean, brand, content, grouped]) + "\n")

    # Archivo 2 (Bloque 2 - Sin categoría): catálogo completo de maestros sin categoría en TSV compacto
    with uncat_all_path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(
            "# PROMPT PARA LLM: Clasifica cada fila asignando `canonical_slug` de la lista oficial o `NO_MERCADO` en `action`.\n"
            "# CATEGORÍAS VÁLIDAS: " + ", ".join(slug for slug, _ in valid_cats) + "\n"
            "row_id\tmaster_product_id\tsample_name\tbrand\tnet_content\tunit_measure\tstore_count\tstores\tcanonical_slug\taction\n"
        )
        for idx, r in enumerate(uncat_rows, start=1):
            fh.write(
                "\t".join(
                    [
                        str(idx),
                        _clean_cell(r["master_product_id"]),
                        _clean_cell(r["sample_name"]),
                        _clean_cell(r["brand"]),
                        _clean_cell(r["net_content"]),
                        _clean_cell(r["unit_measure"]),
                        str(r["store_count"]),
                        _clean_cell(r["stores"]),
                        "",
                        "",
                    ]
                )
                + "\n"
            )

    # Archivo 2b: Lotes compactos listos para LLM (sin UUIDs ni listas de tiendas para minimizar tokens)
    batches_dir = out_dir / "lotes_sin_categoria"
    batches_dir.mkdir(parents=True, exist_ok=True)
    for old_file in batches_dir.glob("lote_*.txt"):
        old_file.unlink()
    for legacy in (out_dir / "llm_sin_categoria_lote_01.txt", out_dir / "llm_sin_categoria_lote_02.txt"):
        if legacy.exists():
            legacy.unlink()

    valid_slugs_line = ", ".join(slug for slug, _ in valid_cats)
    batch_count = 0
    max_batch_bytes = 0
    for start in range(0, len(uncat_rows), uncat_batch_size):
        batch_count += 1
        chunk = uncat_rows[start : start + uncat_batch_size]
        batch_path = batches_dir / f"lote_{batch_count:02d}.txt"
        with batch_path.open("w", encoding="utf-8", newline="\n") as bfh:
            bfh.write(
                f"# LOTE {batch_count} (row_id {start + 1}..{start + len(chunk)} de {len(uncat_rows)})\n"
                "# PROMPT: Clasifica cada fila devolviendo SOLO TSV con 3 columnas exactas: row_id\\tcanonical_slug\\taction (OK | NO_MERCADO).\n"
                f"# CATEGORÍAS VÁLIDAS: {valid_slugs_line}\n"
                "row_id\tsample_name\tbrand\tcontent\n"
            )
            for offset, r in enumerate(chunk):
                row_id = start + offset + 1
                bfh.write(
                    "\t".join(
                        [
                            str(row_id),
                            _clean_cell(r["sample_name"]),
                            _clean_cell(r["brand"]),
                            f"{_clean_cell(r['net_content'])} {_clean_cell(r['unit_measure'])}",
                        ]
                    )
                    + "\n"
                )
        max_batch_bytes = max(max_batch_bytes, batch_path.stat().st_size)

    return {
        "valid_categories": len(valid_cats),
        "liquor_culinary_cases": len(liquor_culinary_rows),
        "ambiguous_collisions": len(top_collisions),
        "ambiguous_collisions_total": len(ambiguous_collisions),
        "total_uncategorized_masters": len(uncat_rows),
        "uncat_batches": batch_count,
        "uncat_batch_max_bytes": max_batch_bytes,
        "ambiguous_file_bytes": ambiguous_path.stat().st_size,
        "uncat_file_bytes": uncat_all_path.stat().st_size,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Exporta revisiones semánticas en texto plano para LLM.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--out-dir", default=str(_DEFAULT_OUT_DIR))
    parser.add_argument("--top-uncategorized", type=int, default=1000)
    parser.add_argument("--batch-size", type=int, default=2100)
    args = parser.parse_args(argv)
    stats = export_llm_review_files(
        db_path=Path(args.db),
        out_dir=Path(args.out_dir),
        uncategorized_ambiguous_limit=args.top_uncategorized,
        uncat_batch_size=args.batch_size,
    )
    print("LLM export stats:", stats)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
