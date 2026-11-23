r"""Importa los lotes TSV clasificados por LLM externo hacia PostgreSQL.

Maneja automáticamente saltos de línea suaves (soft wraps) producidos al copiar
texto desde navegadores y valida contra el catálogo oficial de slugs en BD.

Uso:
    .\.venv\Scripts\python.exe -m etl.import_llm_categories
"""

from __future__ import annotations

import logging
import os
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, TypeVar

import psycopg

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("etl.import_llm_categories")

T = TypeVar("T")
BATCH_SIZE = 5_000


@dataclass(frozen=True, slots=True)
class ParsedLlmRow:
    row_id: int
    canonical_slug: str
    canonical_name: str
    product_type: str | None
    sub_presentation: str | None
    sub_presentation_label: str | None
    variant_tags: tuple[str, ...]
    suggested_display_name: str | None


def _chunks(items: list[T], size: int) -> list[list[T]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


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


def _clean_opt(val: str | None, max_len: int) -> str | None:
    if not val:
        return None
    cleaned = " ".join(val.split()).strip()
    return cleaned[:max_len] if cleaned else None


def parse_wrapped_llm_tsv(
    text: str,
    valid_slugs: Iterable[str],
    *,
    expected_range: tuple[int, int] | None = None,
) -> list[ParsedLlmRow]:
    """Reconstruye filas TSV aunque tengan saltos de línea suaves dentro de las celdas."""
    slugs_alt = "|".join(re.escape(s) for s in sorted(set(valid_slugs), key=len, reverse=True))
    if not slugs_alt:
        raise ValueError("valid_slugs no puede estar vacío")

    lines = text.splitlines()
    if lines and lines[0].lower().startswith("row_id\t"):
        body = "\n".join(lines[1:])
    else:
        body = text

    flat = re.sub(r"\s*\r?\n\s*", " ", body)
    record_re = re.compile(rf"(?:^|(?<=[\s\t]))(\d{{1,5}})\t({slugs_alt})\t")
    matches = list(record_re.finditer(flat))

    raw_items: list[tuple[int, str, list[str]]] = []
    for i, m in enumerate(matches):
        start = m.start(1)
        end = matches[i + 1].start(1) if i + 1 < len(matches) else len(flat)
        chunk = flat[start:end].strip()
        parts = chunk.split("\t")
        rid = int(parts[0])
        raw_items.append((rid, m.group(2), parts))

    # Repara errores tipográficos aislados de 1 dígito en row_id secuencial (ej. 145 entre 1544 y 1546)
    repaired_rows: list[ParsedLlmRow] = []
    for idx, (rid, slug, parts) in enumerate(raw_items):
        effective_rid = rid
        if 0 < idx < len(raw_items) - 1:
            prev_rid = repaired_rows[-1].row_id
            next_rid = raw_items[idx + 1][0]
            if prev_rid + 2 == next_rid and rid != prev_rid + 1:
                if expected_range is None or (expected_range[0] <= prev_rid + 1 <= expected_range[1]):
                    logger.info(
                        "Reparando row_id secuencial %d -> %d (entre %d y %d)",
                        rid,
                        prev_rid + 1,
                        prev_rid,
                        next_rid,
                    )
                    effective_rid = prev_rid + 1

        cname = _clean_opt(parts[2] if len(parts) > 2 else None, 150) or slug
        ptype = _clean_opt(parts[3] if len(parts) > 3 else None, 80)
        if ptype:
            ptype = ptype.lower().replace(" ", "_")[:80]
        sub_pres = _clean_opt(parts[4] if len(parts) > 4 else None, 80)
        if sub_pres:
            sub_pres = sub_pres.lower().replace(" ", "_")[:80]
        sub_label = _clean_opt(parts[5] if len(parts) > 5 else None, 100)
        raw_tags = _clean_opt(parts[6] if len(parts) > 6 else None, 200) or ""
        tags = tuple(
            dict.fromkeys(
                t.strip().lower().replace(" ", "_")
                for t in raw_tags.split("|")
                if t.strip()
            )
        )
        sugg_name = _clean_opt(parts[7] if len(parts) > 7 else None, 255)

        repaired_rows.append(
            ParsedLlmRow(
                row_id=effective_rid,
                canonical_slug=slug,
                canonical_name=cname,
                product_type=ptype,
                sub_presentation=sub_pres,
                sub_presentation_label=sub_label,
                variant_tags=tags,
                suggested_display_name=sugg_name,
            )
        )

    return repaired_rows


def load_mapping_tsv(map_path: Path) -> dict[int, str]:
    """Carga `{row_id: master_product_id}` desde `_mapping_master_ids.tsv`."""
    mapping: dict[int, str] = {}
    with map_path.open(encoding="utf-8") as fh:
        header = fh.readline()
        if not header.lower().startswith("row_id\t"):
            fh.seek(0)
        for line in fh:
            line = line.rstrip("\r\n")
            if not line:
                continue
            parts = line.split("\t")
            if parts[0].isdigit() and len(parts) >= 2:
                mapping[int(parts[0])] = parts[1].strip()
    return mapping


def run_import(
    llm_dir: Path = Path("Categories by LLM"),
    map_path: Path = Path("exports/lotes_llm/_mapping_master_ids.tsv"),
    migration_path: Path = Path("supabase/migrations/0041_llm_categories_and_active_only_client.sql"),
) -> dict[str, int]:
    db_url = _load_env_database_url()
    master_by_row_id = load_mapping_tsv(map_path)
    logger.info("Mapeo cargado: %d master_product_ids", len(master_by_row_id))

    with psycopg.connect(db_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = 0")
            if migration_path.exists():
                cur.execute(migration_path.read_text(encoding="utf-8"))
                logger.info("Migración 0041 aplicada.")
            cur.execute("SELECT slug, id FROM public.canonical_categories")
            cat_id_by_slug = {slug: cid for slug, cid in cur.fetchall()}

    parsed_by_id: dict[int, ParsedLlmRow] = {}
    for fp in sorted(llm_dir.glob("*.txt")):
        text = fp.read_text(encoding="utf-8", errors="replace")
        rows = parse_wrapped_llm_tsv(text, cat_id_by_slug.keys())
        logger.info("%s -> %d filas reconstruidas", fp.name, len(rows))
        for r in rows:
            parsed_by_id[r.row_id] = r

    logger.info("Total filas únicas reconstruidas: %d", len(parsed_by_id))

    master_updates: list[tuple[str, int, str | None, str | None, str | None, list[str], str | None]] = []
    slug_counter: Counter[str] = Counter()
    no_mercado_count = 0

    for rid, row in sorted(parsed_by_id.items()):
        mid = master_by_row_id.get(rid)
        cid = cat_id_by_slug.get(row.canonical_slug)
        if not mid or cid is None:
            continue
        slug_counter[row.canonical_slug] += 1
        tags_list = list(row.variant_tags)
        if "no_mercado" in tags_list:
            no_mercado_count += 1
        master_updates.append(
            (
                mid,
                cid,
                row.product_type,
                row.sub_presentation,
                row.sub_presentation_label,
                tags_list,
                row.suggested_display_name,
            )
        )

    logger.info(
        "Listos para actualizar: %d master_products (no_mercado tag en %d)",
        len(master_updates),
        no_mercado_count,
    )

    updated_masters = 0
    updated_skus = 0

    with psycopg.connect(db_url) as conn:
        for batch in _chunks(master_updates, BATCH_SIZE):
            with conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = 0")
                cur.execute(
                    """
                    CREATE TEMP TABLE tmp_llm_import (
                        master_id UUID PRIMARY KEY,
                        canonical_category_id INT NOT NULL,
                        product_type VARCHAR(80),
                        sub_presentation VARCHAR(80),
                        sub_presentation_label VARCHAR(100),
                        variant_tags TEXT[],
                        suggested_display_name VARCHAR(255)
                    ) ON COMMIT DROP
                    """
                )
                with cur.copy(
                    "COPY tmp_llm_import (master_id, canonical_category_id, product_type, sub_presentation, sub_presentation_label, variant_tags, suggested_display_name) FROM STDIN"
                ) as copy:
                    for item in batch:
                        copy.write_row(item)

                cur.execute(
                    """
                    UPDATE public.master_products mp
                    SET
                        canonical_category_id = tmp.canonical_category_id,
                        product_type = COALESCE(tmp.product_type, mp.product_type),
                        sub_presentation = COALESCE(tmp.sub_presentation, mp.sub_presentation),
                        sub_presentation_label = COALESCE(tmp.sub_presentation_label, mp.sub_presentation_label)
                    FROM tmp_llm_import tmp
                    WHERE mp.id = tmp.master_id
                    """
                )
                updated_masters += cur.rowcount

                cur.execute(
                    """
                    UPDATE public.store_skus ss
                    SET
                        product_type = COALESCE(tmp.product_type, ss.product_type),
                        sub_presentation = COALESCE(tmp.sub_presentation, ss.sub_presentation),
                        sub_presentation_label = COALESCE(tmp.sub_presentation_label, ss.sub_presentation_label),
                        variant_tags = (
                            SELECT ARRAY(
                                SELECT DISTINCT tag
                                FROM unnest(COALESCE(ss.variant_tags, '{}') || COALESCE(tmp.variant_tags, '{}')) AS tag
                                WHERE tag IS NOT NULL AND tag <> ''
                            )
                        ),
                        display_name = COALESCE(NULLIF(btrim(tmp.suggested_display_name), ''), ss.display_name)
                    FROM tmp_llm_import tmp
                    WHERE ss.master_product_id = tmp.master_id
                    """
                )
                updated_skus += cur.rowcount
            conn.commit()

        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = 0")
            cur.execute("ANALYZE public.master_products; ANALYZE public.store_skus;")
            cur.execute("NOTIFY pgrst, 'reload schema'")
        conn.commit()

    return {
        "parsed_rows": len(parsed_by_id),
        "updated_masters": updated_masters,
        "updated_skus": updated_skus,
        "no_mercado_tagged": no_mercado_count,
    }


if __name__ == "__main__":
    summary = run_import()
    print("Import summary:", summary)
