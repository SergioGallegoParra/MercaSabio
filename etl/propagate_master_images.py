"""Propaga `image_url` válidas entre maestros equivalentes (mismo producto en otra tienda).

Reglas estrictas para cero falsos positivos:
  - Excluye marcas propias (`is_private_label = 1 / TRUE`) tanto como donantes como receptores.
  - Descarta URLs placeholder (`not-found`, `placeholder`, `no-image`, `sin-imagen`).
  - Exige coincidencia exacta de tokens núcleo (sin ruido de empaque/gramaje) + misma
    `canonical_category_id` + validación `signatures_compatible(..., strict_trigram=True)`
    (misma marca y mismos atributos/sabores).
  - Prioriza coincidencia con el mismo tamaño (`net_content` + `unit_measure`) antes que
    otra presentación del mismo producto exacto.

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.propagate_master_images --local --supabase
"""

from __future__ import annotations

import argparse
import logging
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.match_safety import (
    extract_product_signature,
    meaningful_tokens,
    normalize_brand,
    signatures_compatible,
)
from etl.push_local_to_supabase import _load_database_url

logger = logging.getLogger("etl.propagate_master_images")

_BAD_IMG_RE = re.compile(
    r"(not[-_]?found|placeholder|no[-_]?image|sin[-_]?imagen|default[-_]?img)",
    re.IGNORECASE,
)
_SIZE_TOKEN_RE = re.compile(r"^\d+(?:g|gr|grs|kg|ml|lt|l|oz|und|u|un|cm|mm)$")
_PACK_NOISE: frozenset[str] = frozenset(
    {
        "bolsa",
        "frasco",
        "botella",
        "caja",
        "paquete",
        "lata",
        "pote",
        "tarro",
        "sobre",
        "doypack",
        "doy",
        "pack",
        "empaque",
        "envase",
        "tubo",
        "blister",
        "display",
        "pet",
        "tetra",
        "brik",
        "vidrio",
        "plastico",
        "unidad",
        "unidades",
        "und",
        "unds",
        "uni",
        "gr",
        "grs",
        "grm",
        "gramo",
        "gramos",
        "kg",
        "kilo",
        "ml",
        "mlt",
        "cc",
        "lt",
        "litro",
        "oz",
    }
)


@dataclass(slots=True)
class ImagePropStats:
    total_masters: int = 0
    missing_before: int = 0
    matched_exact_size: int = 0
    matched_diff_size: int = 0
    updated_rows: int = 0
    missing_after: int = 0


def is_valid_product_image(url: str | None) -> bool:
    if not url:
        return False
    clean = url.strip()
    return clean.startswith(("http://", "https://")) and not _BAD_IMG_RE.search(clean)


def _core_tokens(name: str, brand: str | None) -> frozenset[str]:
    toks = set(meaningful_tokens(name))
    bn = normalize_brand(brand)
    if bn:
        toks.update(meaningful_tokens(bn))
    return frozenset(
        t
        for t in toks
        if t not in _PACK_NOISE and not t.isdigit() and not _SIZE_TOKEN_RE.match(t)
    )


def compute_image_propagations(
    rows: list[dict[str, Any]],
) -> tuple[list[tuple[str, str]], ImagePropStats]:
    """Calcula `(image_url, master_id)` a rellenar a partir de maestros con foto válida."""
    with_img: list[dict[str, Any]] = []
    without_img: list[dict[str, Any]] = []

    for r in rows:
        if is_valid_product_image(r.get("image_url")):
            with_img.append(r)
        else:
            without_img.append(r)

    stats = ImagePropStats(total_masters=len(rows), missing_before=len(without_img))

    by_core_size: dict[tuple[frozenset[str], str, str, Any], list[dict[str, Any]]] = defaultdict(list)
    by_core_cat: dict[tuple[frozenset[str], Any], list[dict[str, Any]]] = defaultdict(list)

    for it in with_img:
        if it["is_private_label"]:
            continue
        ct = _core_tokens(it["normalized_name"], it["brand"])
        if len(ct) < 2:
            continue
        by_core_size[(ct, it["net_content"], it["unit_measure"], it["canonical_category_id"])].append(it)
        by_core_cat[(ct, it["canonical_category_id"])].append(it)

    updates: list[tuple[str, str]] = []
    for it in without_img:
        if it["is_private_label"]:
            continue
        ct = _core_tokens(it["normalized_name"], it["brand"])
        if len(ct) < 2:
            continue
        sig_a = extract_product_signature(
            it["normalized_name"], normalized_name=it["normalized_name"], brand=it["brand"]
        )

        donor = None
        for cand in by_core_size.get(
            (ct, it["net_content"], it["unit_measure"], it["canonical_category_id"]), []
        ):
            sig_b = extract_product_signature(
                cand["normalized_name"], normalized_name=cand["normalized_name"], brand=cand["brand"]
            )
            if signatures_compatible(sig_a, sig_b, strict_trigram=True)[0]:
                donor = cand
                stats.matched_exact_size += 1
                break

        if donor is None:
            for cand in by_core_cat.get((ct, it["canonical_category_id"]), []):
                sig_b = extract_product_signature(
                    cand["normalized_name"], normalized_name=cand["normalized_name"], brand=cand["brand"]
                )
                if signatures_compatible(sig_a, sig_b, strict_trigram=True)[0]:
                    donor = cand
                    stats.matched_diff_size += 1
                    break

        if donor is not None:
            updates.append((str(donor["image_url"]).strip(), str(it["id"])))

    stats.updated_rows = len(updates)
    stats.missing_after = stats.missing_before - len(updates)
    return updates, stats


def propagate_images_local(
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    dry_run: bool = False,
) -> ImagePropStats:
    conn = sqlite3.connect(db_path)
    try:
        raw = conn.execute(
            """
            SELECT id, normalized_name, brand, net_content, unit_measure,
                   canonical_category_id, is_private_label, image_url
            FROM master_products
            """
        ).fetchall()
        rows = [
            {
                "id": str(r[0]),
                "normalized_name": str(r[1] or ""),
                "brand": r[2],
                "net_content": str(r[3] or ""),
                "unit_measure": str(r[4] or ""),
                "canonical_category_id": r[5],
                "is_private_label": bool(r[6]),
                "image_url": r[7],
            }
            for r in raw
        ]
        updates, stats = compute_image_propagations(rows)
        if not dry_run and updates:
            conn.executemany("UPDATE master_products SET image_url = ? WHERE id = ?", updates)
            conn.commit()
    finally:
        conn.close()
    return stats


def propagate_images_supabase(*, dry_run: bool = False) -> ImagePropStats:
    db_url = _load_database_url()
    with psycopg.connect(db_url) as pg:
        with pg.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, normalized_name, brand, net_content::text, unit_measure,
                       canonical_category_id, is_private_label, image_url
                FROM public.master_products
                """
            )
            raw = cur.fetchall()
        rows = [
            {
                "id": str(r[0]),
                "normalized_name": str(r[1] or ""),
                "brand": r[2],
                "net_content": str(r[3] or ""),
                "unit_measure": str(r[4] or ""),
                "canonical_category_id": r[5],
                "is_private_label": bool(r[6]),
                "image_url": r[7],
            }
            for r in raw
        ]
        updates, stats = compute_image_propagations(rows)
        if not dry_run and updates:
            with pg.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = '120s'")
                cur.executemany(
                    "UPDATE public.master_products SET image_url = %s WHERE id = %s::uuid",
                    updates,
                )
            pg.commit()
    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser(description="Propaga fotos válidas entre maestros equivalentes.")
    parser.add_argument("--local", action="store_true")
    parser.add_argument("--supabase", action="store_true")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.local:
        print("LOCAL:", propagate_images_local(db_path=Path(args.db), dry_run=args.dry_run))
    if args.supabase:
        print("SUPABASE:", propagate_images_supabase(dry_run=args.dry_run))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
