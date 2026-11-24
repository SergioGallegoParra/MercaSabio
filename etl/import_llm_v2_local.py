"""Importa 100% en local los resultados revisados por LLM en `Categories by LLM/v2`.

Maneja archivos con o sin encabezado, saltos de línea suaves (soft wraps) al copiar
desde navegador y aplica sobre `etl/data/local_staging.db`:
  1. Bloque 2 (`Resultado/Lote *.txt`): asigna `canonical_category_id` a ítems `OK`
     y purga ítems marcados `NO_MERCADO`.
  2. Bloque 1 Sección A (`llm_revision_semantica_resultado.txt`): reasigna categoría
     a casos `MANTENER_MERCADO` y purga `EXCLUIR_NO_MERCADO`.
  3. Bloque 1 Sección B (`SEPARAR_VARIANTES`): separa colisiones usando las ramas
     semánticas (`A vs B`) identificadas por el LLM.

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.import_llm_v2_local
"""

from __future__ import annotations

import argparse
import logging
import re
import shutil
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from etl.core.canonical_mapper import is_store_private_label
from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.match_safety import meaningful_tokens, normalize_brand, strip_accents_lower
from etl.core.models import UnitMeasure
from etl.core.normalizer import extract_content_from_text, normalize_product_name
from etl.core.product_enrichment import extract_product_metadata, infer_broad_category_slug

logger = logging.getLogger("etl.import_llm_v2_local")

DEFAULT_LLM_V2_DIR = Path("Categories by LLM/v2")
DEFAULT_UNCAT_INDEX_PATH = Path("exports/llm_sin_categoria_completo.txt")

_UUID_RX = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_LOTE_ROW_RE = re.compile(r"(?:^|\s)(\d+)\t([a-z0-9-]*)\t(OK|NO_MERCADO)(?=\s|$)")
_SEC_A_ROW_RE = re.compile(rf"({_UUID_RX})\t(MANTENER_MERCADO|EXCLUIR_NO_MERCADO)\t([a-z0-9-]*)\t")
_SEC_B_SPLIT_RE = re.compile(rf"({_UUID_RX})\t(MISMO_PRODUCTO|SEPARAR_VARIANTES)")
_NUM_UNIT_RE = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*(g|gr|grs|kg|ml|cc|l|lt|und|unds|un|u)\b", re.IGNORECASE)


@dataclass(slots=True)
class LlmImportStats:
    lote_rows_parsed: int = 0
    sec_a_rows_parsed: int = 0
    sec_b_rows_parsed: int = 0
    masters_categorized_ok: int = 0
    masters_kept_sec_a: int = 0
    skus_purged_no_mercado: int = 0
    masters_purged_no_mercado: int = 0
    masters_split_sec_b: int = 0
    skus_reassigned_sec_b: int = 0
    final_master_products: int = 0
    final_store_skus: int = 0
    final_categorized_masters: int = 0
    final_categorized_skus: int = 0


def load_row_id_to_master_index(index_path: Path = DEFAULT_UNCAT_INDEX_PATH) -> dict[int, str]:
    mapping: dict[int, str] = {}
    with index_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("#") or line.startswith("row_id\t"):
                continue
            parts = line.rstrip("\r\n").split("\t")
            if len(parts) >= 2 and parts[0].isdigit():
                mapping[int(parts[0])] = parts[1].strip()
    return mapping


def parse_lote_results(
    resultado_dir: Path,
    valid_slugs: set[str],
) -> dict[int, tuple[str | None, str]]:
    """Lee todos los `Lote *.txt` tolerando ausencia de encabezados y soft wraps."""
    parsed: dict[int, tuple[str | None, str]] = {}
    files = sorted(
        resultado_dir.glob("Lote *.txt"),
        key=lambda p: int(re.search(r"\d+", p.stem).group()) if re.search(r"\d+", p.stem) else 0,
    )
    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace").strip()
        text = re.sub(r"^row_id\tcanonical_slug\taction\b", "", text)
        for row_id_str, raw_slug, action in _LOTE_ROW_RE.findall(text):
            row_id = int(row_id_str)
            slug = raw_slug.strip() if action == "OK" and raw_slug.strip() in valid_slugs else None
            parsed[row_id] = (slug, action)
    return parsed


def parse_semantic_review(
    semantic_path: Path,
    valid_slugs: set[str],
) -> tuple[dict[str, tuple[str, str | None]], dict[str, tuple[str, str]]]:
    """Retorna `(sec_a_by_master, sec_b_by_master)` desde `llm_revision_semantica_resultado.txt`."""
    text = semantic_path.read_text(encoding="utf-8", errors="replace")
    sec_b_idx = text.find("--- SECCIÓN B:")
    sec_a_txt = text[:sec_b_idx] if sec_b_idx != -1 else text
    sec_b_txt = text[sec_b_idx:] if sec_b_idx != -1 else ""

    sec_a: dict[str, tuple[str, str | None]] = {}
    for mid, decision, raw_slug in _SEC_A_ROW_RE.findall(sec_a_txt):
        slug = raw_slug.strip() if decision == "MANTENER_MERCADO" and raw_slug.strip() in valid_slugs else None
        sec_a[mid] = (decision, slug)

    sec_b: dict[str, tuple[str, str]] = {}
    parts = _SEC_B_SPLIT_RE.split(sec_b_txt)
    for idx in range(1, len(parts), 3):
        mid = parts[idx]
        action = parts[idx + 1]
        note = " ".join(parts[idx + 2].strip().splitlines()).strip()
        sec_b[mid] = (action, note)

    return sec_a, sec_b


def _extract_num_tokens(text: str) -> set[str]:
    norm = strip_accents_lower(text)
    out: set[str] = set()
    for num, unit in _NUM_UNIT_RE.findall(norm):
        u = "g" if unit in {"gr", "grs", "gramo", "gramos"} else ("und" if unit in {"u", "un", "unds"} else unit)
        out.add(f"{num.replace(',', '.')}{u}")
    return out


def _assign_sku_to_branches(
    skus: list[sqlite3.Row],
    branches: list[str],
) -> dict[int, list[sqlite3.Row]]:
    """Asigna cada SKU a la rama `vs` del LLM más afín sin inventar divisiones vacías."""
    branch_sigs = [
        (meaningful_tokens(b), _extract_num_tokens(b))
        for b in branches
    ]
    buckets: dict[int, list[sqlite3.Row]] = defaultdict(list)
    for sku in skus:
        raw_name = str(sku["raw_name"])
        sku_toks = meaningful_tokens(raw_name)
        sku_nums = _extract_num_tokens(raw_name)
        best_idx = 0
        best_score = -1.0
        for idx, (btoks, bnums) in enumerate(branch_sigs):
            tok_overlap = len(sku_toks & btoks)
            num_overlap = len(sku_nums & bnums) * 2
            score = tok_overlap + num_overlap
            # Premiar coincidencia exacta de tokens únicos de la rama
            if btoks and sku_toks >= btoks:
                score += 1.5
            if score > best_score:
                best_score = score
                best_idx = idx
        buckets[best_idx].append(sku)
    return buckets


def load_protected_curation_ids(conn: sqlite3.Connection) -> tuple[set[str], set[str]]:
    """Retorna `(protected_sku_ids, protected_master_ids)` desde `product_curation_overrides`."""
    protected_sku_ids = {
        str(r[0]) for r in conn.execute("SELECT store_sku_id FROM product_curation_overrides").fetchall()
    }
    protected_master_ids = {
        str(r[0])
        for r in conn.execute(
            "SELECT master_product_id FROM product_curation_overrides WHERE master_product_id IS NOT NULL"
        ).fetchall()
    }
    return protected_sku_ids, protected_master_ids


def purge_masters_respecting_overrides(
    conn: sqlite3.Connection,
    purge_master_ids: set[str],
    protected_sku_ids: set[str],
    protected_master_ids: set[str],
) -> tuple[int, int]:
    """Purga `price_records`, `store_skus`, `master_products` y `product_price_daily` sin tocar overrides."""
    effective_masters = purge_master_ids - protected_master_ids
    if not effective_masters:
        return 0, 0

    purge_list = [(mid,) for mid in effective_masters]
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS _tmp_purge_masters (id TEXT PRIMARY KEY)")
    conn.execute("DELETE FROM _tmp_purge_masters")
    conn.executemany("INSERT OR IGNORE INTO _tmp_purge_masters (id) VALUES (?)", purge_list)

    sku_rows_to_del = conn.execute(
        "SELECT id FROM store_skus WHERE master_product_id IN (SELECT id FROM _tmp_purge_masters)"
    ).fetchall()
    sku_ids_to_del = [(str(r[0]),) for r in sku_rows_to_del if str(r[0]) not in protected_sku_ids]
    skus_purged = len(sku_ids_to_del)

    if sku_ids_to_del:
        conn.execute("CREATE TEMP TABLE IF NOT EXISTS _tmp_purge_skus (id TEXT PRIMARY KEY)")
        conn.execute("DELETE FROM _tmp_purge_skus")
        conn.executemany("INSERT OR IGNORE INTO _tmp_purge_skus (id) VALUES (?)", sku_ids_to_del)
        conn.execute("DELETE FROM price_records WHERE store_sku_id IN (SELECT id FROM _tmp_purge_skus)")
        conn.execute("DELETE FROM store_skus WHERE id IN (SELECT id FROM _tmp_purge_skus)")

    orphaned_masters = int(
        conn.execute(
            """
            SELECT COUNT(*) FROM master_products
            WHERE id IN (SELECT id FROM _tmp_purge_masters)
              AND id NOT IN (SELECT master_product_id FROM store_skus)
            """
        ).fetchone()[0]
    )
    conn.execute(
        """
        DELETE FROM master_products
        WHERE id IN (SELECT id FROM _tmp_purge_masters)
          AND id NOT IN (SELECT master_product_id FROM store_skus)
        """
    )
    conn.execute(
        "DELETE FROM product_price_daily WHERE master_product_id NOT IN (SELECT id FROM master_products)"
    )
    return skus_purged, orphaned_masters


def apply_llm_v2_to_local_db(
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    llm_v2_dir: Path = DEFAULT_LLM_V2_DIR,
    index_path: Path = DEFAULT_UNCAT_INDEX_PATH,
    create_backup: bool = True,
    dry_run: bool = False,
) -> LlmImportStats:
    if not db_path.exists():
        raise FileNotFoundError(f"No existe la base SQLite local: {db_path}")

    if create_backup and not dry_run:
        backup_path = db_path.with_name("local_staging_pre_llm_v2.db.bak")
        if not backup_path.exists():
            shutil.copy2(db_path, backup_path)
            logger.info("Respaldo creado en %s", backup_path)

    stats = LlmImportStats()
    row_to_master = load_row_id_to_master_index(index_path)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cat_rows = conn.execute("SELECT id, slug FROM canonical_categories").fetchall()
        slug_to_cat_id: dict[str, int] = {str(r["slug"]): int(r["id"]) for r in cat_rows}
        valid_slugs = set(slug_to_cat_id)

        lote_results = parse_lote_results(llm_v2_dir / "Resultado", valid_slugs)
        sec_a_results, sec_b_results = parse_semantic_review(
            llm_v2_dir / "llm_revision_semantica_resultado.txt", valid_slugs
        )
        stats.lote_rows_parsed = len(lote_results)
        stats.sec_a_rows_parsed = len(sec_a_results)
        stats.sec_b_rows_parsed = len(sec_b_results)

        protected_sku_ids, protected_master_ids = load_protected_curation_ids(conn)

        cat_updates: list[tuple[int, str]] = []
        purge_master_ids: set[str] = set()

        for row_id, (slug, action) in lote_results.items():
            mid = row_to_master.get(row_id)
            if not mid:
                continue
            if action == "OK" and slug and slug in slug_to_cat_id:
                cat_updates.append((slug_to_cat_id[slug], mid))
                stats.masters_categorized_ok += 1
            elif action == "NO_MERCADO":
                purge_master_ids.add(mid)

        for mid, (decision, slug) in sec_a_results.items():
            if decision == "MANTENER_MERCADO" and slug and slug in slug_to_cat_id:
                cat_updates.append((slug_to_cat_id[slug], mid))
                purge_master_ids.discard(mid)
                stats.masters_kept_sec_a += 1
            elif decision == "EXCLUIR_NO_MERCADO":
                purge_master_ids.add(mid)

        purge_master_ids -= protected_master_ids

        # Separar variantes indicadas por el LLM en Sección B
        split_candidates = {
            mid: note
            for mid, (action, note) in sec_b_results.items()
            if action == "SEPARAR_VARIANTES" and mid not in purge_master_ids
        }

        if not dry_run:
            # 1) Actualizar categorías canónicas de Bloque 2 + Sección A
            conn.executemany(
                "UPDATE master_products SET canonical_category_id = ? WHERE id = ?",
                cat_updates,
            )

            # 2) Purgar NO_MERCADO y EXCLUIR_NO_MERCADO (respetando overrides)
            stats.skus_purged_no_mercado, stats.masters_purged_no_mercado = purge_masters_respecting_overrides(
                conn, purge_master_ids, protected_sku_ids, protected_master_ids
            )

            # 3) Ejecutar separación semántica de Sección B (SEPARAR_VARIANTES)
            for old_mid, note in split_candidates.items():
                old_m = conn.execute("SELECT * FROM master_products WHERE id = ?", (old_mid,)).fetchone()
                if old_m is None:
                    continue
                skus = conn.execute(
                    "SELECT * FROM store_skus WHERE master_product_id = ? ORDER BY store_id, id",
                    (old_mid,),
                ).fetchall()
                if len(skus) <= 1:
                    continue
                branches = [b.strip() for b in re.split(r"\s+vs\.?\s+", note, flags=re.IGNORECASE) if b.strip()]
                if len(branches) <= 1:
                    continue
                buckets = _assign_sku_to_branches(skus, branches)
                non_empty_buckets = [b_skus for b_skus in buckets.values() if b_skus]
                if len(non_empty_buckets) <= 1:
                    continue

                # Mantener old_mid para el grupo más grande
                primary_b_idx = max(range(len(non_empty_buckets)), key=lambda i: len(non_empty_buckets[i]))
                stats.masters_split_sec_b += 1

                for idx, cluster_skus in enumerate(non_empty_buckets):
                    if idx == primary_b_idx:
                        continue
                    rep = max(cluster_skus, key=lambda s: len(str(s["raw_name"])))
                    rep_name = str(rep["raw_name"])
                    new_norm = normalize_product_name(rep_name) or str(old_m["normalized_name"])
                    parsed_content = extract_content_from_text(rep_name)
                    if parsed_content is not None:
                        net_dec = parsed_content.net_content
                        unit_enum = parsed_content.unit_measure
                    else:
                        net_dec = Decimal(str(old_m["net_content"]))
                        unit_enum = UnitMeasure(str(old_m["unit_measure"]))
                    net_content = str(net_dec)
                    unit_measure = unit_enum.value

                    cand_id = str(uuid5(NAMESPACE_URL, f"llm_split:{old_mid}:{idx}:{new_norm}"))
                    exists = conn.execute("SELECT 1 FROM master_products WHERE id = ?", (cand_id,)).fetchone()
                    new_mid = str(uuid4()) if exists is not None else cand_id

                    old_brand_norm = normalize_brand(old_m["brand"])
                    rep_lower = strip_accents_lower(rep_name)
                    new_brand = (
                        old_m["brand"]
                        if old_brand_norm and old_brand_norm.split()[0] in rep_lower
                        else None
                    )
                    new_pl = 1 if is_store_private_label(str(rep["store_id"]), new_brand, None) else 0
                    meta = extract_product_metadata(rep_name, new_norm, is_private_label=bool(new_pl))
                    cat_slug = infer_broad_category_slug(new_norm, net_dec, unit_enum)
                    new_cat_id = slug_to_cat_id.get(cat_slug) if cat_slug else old_m["canonical_category_id"]

                    conn.execute(
                        """
                        INSERT INTO master_products (
                            id, ean, canonical_category_id, normalized_name, brand, net_content, unit_measure,
                            image_url, is_private_label, product_type, sub_presentation, sub_presentation_label,
                            shrinkflation_alert, previous_net_content, created_at
                        ) VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, NULL, ?)
                        """,
                        (
                            new_mid,
                            new_cat_id,
                            new_norm,
                            new_brand,
                            net_content,
                            unit_measure,
                            new_pl,
                            meta.product_type,
                            meta.sub_presentation,
                            meta.sub_presentation_label,
                            old_m["created_at"],
                        ),
                    )
                    sku_ids_move = [(new_mid, str(s["id"])) for s in cluster_skus]
                    conn.executemany(
                        "UPDATE store_skus SET master_product_id = ? WHERE id = ?",
                        sku_ids_move,
                    )
                    stats.skus_reassigned_sec_b += len(sku_ids_move)

            conn.commit()
            conn.execute("VACUUM;")
            conn.execute("ANALYZE;")

        stats.final_master_products = int(conn.execute("SELECT COUNT(*) FROM master_products").fetchone()[0])
        stats.final_store_skus = int(conn.execute("SELECT COUNT(*) FROM store_skus").fetchone()[0])
        stats.final_categorized_masters = int(
            conn.execute("SELECT COUNT(*) FROM master_products WHERE canonical_category_id IS NOT NULL").fetchone()[0]
        )
        stats.final_categorized_skus = int(
            conn.execute(
                """
                SELECT COUNT(*)
                FROM store_skus ss
                JOIN master_products mp ON mp.id = ss.master_product_id
                WHERE mp.canonical_category_id IS NOT NULL
                """
            ).fetchone()[0]
        )
    finally:
        conn.close()

    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser(description="Ingesta resultados del LLM v2 sobre SQLite local.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--v2-dir", default=str(DEFAULT_LLM_V2_DIR))
    parser.add_argument("--index", default=str(DEFAULT_UNCAT_INDEX_PATH))
    parser.add_argument("--no-backup", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    st = apply_llm_v2_to_local_db(
        db_path=Path(args.db),
        llm_v2_dir=Path(args.v2_dir),
        index_path=Path(args.index),
        create_backup=not args.no_backup,
        dry_run=args.dry_run,
    )
    print(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
