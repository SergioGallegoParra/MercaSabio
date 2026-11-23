r"""Exporta todos los productos de mercado sin categoría (`canonical_category_id IS NULL`)
a un archivo de texto plano TSV (`.txt`) con todas sus columnas listas para
clasificación externa con LLM y posterior importación a Postgres.

Uso:
    .\.venv\Scripts\python.exe -m etl.export_uncategorized_txt
"""

from __future__ import annotations

import os
from pathlib import Path

import psycopg


def _load_env_database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    if os.path.exists(".env"):
        with open(".env", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL no configurado")
    return db_url


def _clean_cell(val: object) -> str:
    if val is None:
        return ""
    return " ".join(str(val).replace("\t", " ").replace("\r", " ").replace("\n", " ").split())


def export_uncategorized_txt(out_path: Path = Path("exports/productos_sin_categoria.txt")) -> dict[str, int]:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    db_url = _load_env_database_url()

    headers = [
        "store_sku_id",
        "master_product_id",
        "store_id",
        "external_sku",
        "raw_name",
        "display_name",
        "brand",
        "ean",
        "net_content",
        "unit_measure",
        "is_active_catalog",
        "canonical_slug",
        "canonical_name",
        "product_type",
        "sub_presentation",
        "sub_presentation_label",
        "variant_tags",
        "suggested_display_name",
    ]

    query = """
    SELECT
        ss.id::text AS store_sku_id,
        ss.master_product_id::text AS master_product_id,
        ss.store_id,
        ss.external_sku,
        ss.raw_name,
        COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name) AS display_name,
        mp.brand,
        mp.ean,
        mp.net_content,
        mp.unit_measure,
        CASE WHEN mv.store_sku_id IS NOT NULL THEN 1 ELSE 0 END AS is_active_catalog,
        COALESCE(ss.product_type, mp.product_type) AS product_type,
        COALESCE(ss.sub_presentation, mp.sub_presentation) AS sub_presentation,
        COALESCE(ss.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
        ss.variant_tags
    FROM public.store_skus ss
    JOIN public.master_products mp ON mp.id = ss.master_product_id
    LEFT JOIN public.mv_admin_store_catalog mv ON mv.store_sku_id = ss.id
    WHERE ss.is_mercado = TRUE
      AND mp.canonical_category_id IS NULL
    ORDER BY
        is_active_catalog DESC,
        ss.store_id ASC,
        COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name) ASC
    """

    total_rows = 0
    active_rows = 0
    distinct_masters: set[str] = set()

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()

    with out_path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write("\t".join(headers) + "\n")
        for (
            sku_id,
            master_id,
            store_id,
            ext_sku,
            raw_name,
            disp_name,
            brand,
            ean,
            net_content,
            unit_measure,
            is_active,
            product_type,
            sub_pres,
            sub_pres_label,
            variant_tags,
        ) in rows:
            total_rows += 1
            if is_active:
                active_rows += 1
            distinct_masters.add(master_id)
            tags_str = "|".join(variant_tags) if variant_tags else ""
            record = [
                _clean_cell(sku_id),
                _clean_cell(master_id),
                _clean_cell(store_id),
                _clean_cell(ext_sku),
                _clean_cell(raw_name),
                _clean_cell(disp_name),
                _clean_cell(brand),
                _clean_cell(ean),
                _clean_cell(net_content),
                _clean_cell(unit_measure),
                str(is_active),
                "",  # canonical_slug (a llenar por el LLM)
                "",  # canonical_name (a llenar por el LLM si crea nueva categoría)
                _clean_cell(product_type),
                _clean_cell(sub_pres),
                _clean_cell(sub_pres_label),
                _clean_cell(tags_str),
                "",  # suggested_display_name (opcional)
            ]
            fh.write("\t".join(record) + "\n")

    size_bytes = out_path.stat().st_size
    return {
        "total_rows": total_rows,
        "active_rows": active_rows,
        "distinct_masters": len(distinct_masters),
        "size_bytes": size_bytes,
    }


if __name__ == "__main__":
    stats = export_uncategorized_txt()
    print("Export stats:", stats)
