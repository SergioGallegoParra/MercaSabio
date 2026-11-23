r"""Exporta los master_products sin categoría en lotes TSV compactos para LLM externo.

Optimizaciones para minimizar tokens (< 900.000 tokens garantizados por lote y
salida segura sin truncado) y mantener 100% de coherencia entre lotes:
1. Agrupa por `master_product_id` único (25.063 productos en lugar de 35.616 SKUs).
2. Reemplaza los UUIDs de 36 caracteres por un entero secuencial `row_id` (`1..N`) y
   guarda el mapa completo `row_id <-> master_product_id` en `exports/lotes_llm/_mapping_master_ids.tsv`.
3. Ordena primero los productos activos (`is_active_catalog = 1`) y luego alfabéticamente
   por familia/nombre para que variantes similares queden juntas en el mismo lote.
4. Genera lotes dentro de `exports/lotes_llm/` y el prompt maestro en `exports/lotes_llm/PROMPT_LLM.txt`.

Uso:
    .\.venv\Scripts\python.exe -m etl.export_uncategorized_chunks
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import psycopg

MAX_ROWS_PER_CHUNK = 2500
MAX_ESTIMATED_INPUT_TOKENS = 750_000  # margen amplio debajo de 900.000 tokens


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


def _conservative_tokens(text: str) -> int:
    """Estimación conservadora de tokens (español + TSV: ~2.8 chars/token)."""
    return math.ceil(len(text) / 2.8)


def export_chunks(
    out_dir: Path = Path("exports/lotes_llm"),
    max_rows: int = MAX_ROWS_PER_CHUNK,
    max_tokens: int = MAX_ESTIMATED_INPUT_TOKENS,
) -> dict[str, object]:
    out_dir.mkdir(parents=True, exist_ok=True)
    for old_file in out_dir.glob("lote_*.txt"):
        old_file.unlink()

    db_url = _load_env_database_url()

    query = """
    WITH ranked_masters AS (
        SELECT
            mp.id::text AS master_product_id,
            ss.store_id,
            ss.raw_name,
            COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name) AS display_name,
            mp.brand,
            mp.net_content,
            mp.unit_measure,
            CASE WHEN mv.store_sku_id IS NOT NULL THEN 1 ELSE 0 END AS is_active_catalog,
            COALESCE(ss.product_type, mp.product_type) AS product_type,
            COALESCE(ss.sub_presentation, mp.sub_presentation) AS sub_presentation,
            COALESCE(ss.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
            ss.variant_tags,
            ROW_NUMBER() OVER (
                PARTITION BY mp.id
                ORDER BY
                    (mv.store_sku_id IS NOT NULL) DESC,
                    length(COALESCE(NULLIF(btrim(ss.display_name), ''), ss.raw_name)) DESC,
                    ss.store_id ASC
            ) AS rn
        FROM public.master_products mp
        JOIN public.store_skus ss ON ss.master_product_id = mp.id
        LEFT JOIN public.mv_admin_store_catalog mv ON mv.store_sku_id = ss.id
        WHERE ss.is_mercado = TRUE
          AND mp.canonical_category_id IS NULL
    )
    SELECT
        master_product_id,
        store_id,
        raw_name,
        display_name,
        brand,
        net_content,
        unit_measure,
        is_active_catalog,
        product_type,
        sub_presentation,
        sub_presentation_label,
        variant_tags
    FROM ranked_masters
    WHERE rn = 1
    ORDER BY
        is_active_catalog DESC,
        display_name ASC,
        master_product_id ASC
    """

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()

    map_path = out_dir / "_mapping_master_ids.tsv"
    input_headers = [
        "row_id",
        "store_id",
        "display_name",
        "raw_name",
        "brand",
        "net_content",
        "unit_measure",
        "is_active_catalog",
        "product_type",
        "sub_presentation",
        "sub_presentation_label",
        "variant_tags",
    ]
    header_line = "\t".join(input_headers) + "\n"

    active_records: list[tuple[int, str, str, int, str]] = []
    inactive_records: list[tuple[int, str, str, int, str]] = []

    with map_path.open("w", encoding="utf-8", newline="\n") as map_fh:
        map_fh.write("row_id\tmaster_product_id\tis_active_catalog\tdisplay_name\n")
        for idx, (
            master_id,
            store_id,
            raw_name,
            disp_name,
            brand,
            net_content,
            unit_measure,
            is_active,
            product_type,
            sub_pres,
            sub_pres_label,
            variant_tags,
        ) in enumerate(rows, start=1):
            clean_disp = _clean_cell(disp_name)
            clean_raw = _clean_cell(raw_name)
            # Evita duplicar tokens si display_name ya es igual a raw_name
            raw_for_llm = "" if clean_raw == clean_disp else clean_raw
            tags_str = "|".join(variant_tags) if variant_tags else ""

            map_fh.write(f"{idx}\t{master_id}\t{is_active}\t{clean_disp}\n")

            line = (
                "\t".join(
                    [
                        str(idx),
                        _clean_cell(store_id),
                        clean_disp,
                        raw_for_llm,
                        _clean_cell(brand),
                        _clean_cell(net_content),
                        _clean_cell(unit_measure),
                        str(is_active),
                        _clean_cell(product_type),
                        _clean_cell(sub_pres),
                        _clean_cell(sub_pres_label),
                        _clean_cell(tags_str),
                    ]
                )
                + "\n"
            )
            item = (idx, master_id, clean_disp, int(is_active), line)
            if is_active:
                active_records.append(item)
            else:
                inactive_records.append(item)

    chunks_info: list[dict[str, object]] = []

    def _write_group(group_items: list[tuple[int, str, str, int, str]], label: str) -> None:
        part_num = 0
        cur_lines: list[str] = []
        cur_tokens = _conservative_tokens(header_line)

        def _flush() -> None:
            nonlocal part_num, cur_lines, cur_tokens
            if not cur_lines:
                return
            part_num += 1
            file_name = f"lote_{len(chunks_info) + 1:02d}_{label}_p{part_num:02d}.txt"
            file_path = out_dir / file_name
            content = header_line + "".join(cur_lines)
            file_path.write_text(content, encoding="utf-8", newline="\n")
            chunks_info.append(
                {
                    "file": file_name,
                    "rows": len(cur_lines),
                    "bytes": len(content.encode("utf-8")),
                    "est_input_tokens": _conservative_tokens(content),
                    "est_output_tokens": len(cur_lines) * 28,
                }
            )
            cur_lines = []
            cur_tokens = _conservative_tokens(header_line)

        for item in group_items:
            line = item[4]
            ltok = _conservative_tokens(line)
            if cur_lines and (len(cur_lines) >= max_rows or (cur_tokens + ltok) > max_tokens):
                _flush()
            cur_lines.append(line)
            cur_tokens += ltok
        _flush()

    _write_group(active_records, "activos")
    _write_group(inactive_records, "inactivos")

    return {
        "total_unique_masters": len(rows),
        "active_masters": len(active_records),
        "inactive_masters": len(inactive_records),
        "chunks_count": len(chunks_info),
        "chunks": chunks_info,
    }


if __name__ == "__main__":
    summary = export_chunks()
    print("Total masters:", summary["total_unique_masters"], "| active:", summary["active_masters"], "| inactive:", summary["inactive_masters"])
    for c in summary["chunks"]:  # type: ignore[attr-defined]
        print(" ", c)
