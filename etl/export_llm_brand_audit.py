"""Exporta a texto plano (`.txt`) los maestros con posible marca heredada/corrupta para auditoría con un LLM dedicado.

Siguiendo `AGENTS.md` (Regla #1), distinguir relaciones legítimas fabricante↔submarca
(p.ej. Alpina↔Finesse, Unilever↔Fruco, Gillette↔Mach3) de marcas corruptas heredadas
(p.ej. Kleenex↔Familia, Lavante↔Intibón, P.A.N.↔Diana) es una tarea semántica que debe
resolverse con un LLM dedicado y no con heurísticas frágiles en Python.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import unicodedata
from pathlib import Path

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.match_safety import (
    brands_compatible,
    build_known_brands_vocab,
    extract_product_signature,
)

DEFAULT_SNAPSHOT_PATH = Path("etl/data/supabase_snapshot.db")
DEFAULT_PRE_MERGE_PATH = Path("etl/data/local_staging_pre_merge.db.bak")
DEFAULT_OUTPUT_PATH = Path("etl/data/llm_brand_audit.txt")


def _norm_t(s: str | None) -> str:
    ascii_s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", " ", ascii_s).strip()


def _brand_in_text(brand: str | None, normalized_name: str | None, raw_name: str | None) -> bool:
    bn = _norm_t(brand)
    if not bn or bn in ("generico", "generica", "sin marca", "varios", "na", "n a", "sm"):
        return True
    comb = f"{_norm_t(normalized_name)} {_norm_t(raw_name)}"
    bcomp = bn.replace(" ", "")
    toks = set(comb.split())
    btoks = [t for t in bn.split() if len(t) >= 2]
    return (
        bn in comb
        or (len(bcomp) >= 3 and bcomp in toks)
        or (bool(btoks) and all(t in toks for t in btoks))
    )


def export_llm_brand_audit(
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    output_path: Path = DEFAULT_OUTPUT_PATH,
) -> tuple[int, Path]:
    old_mids: set[str] = set()
    for ref_path in (DEFAULT_SNAPSHOT_PATH, DEFAULT_PRE_MERGE_PATH):
        if ref_path.exists():
            c_ref = sqlite3.connect(str(ref_path))
            old_mids.update(r[0] for r in c_ref.execute("SELECT id FROM master_products").fetchall())
            c_ref.close()

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        all_brands = [
            r[0] for r in conn.execute("SELECT DISTINCT brand FROM master_products WHERE brand IS NOT NULL").fetchall()
        ]
        single_brands, multi_brands = build_known_brands_vocab(all_brands)

        rows = conn.execute(
            """
            SELECT m.id, m.ean, m.normalized_name, m.brand, m.is_private_label,
                   MIN(s.raw_name) AS sample_raw_name,
                   GROUP_CONCAT(DISTINCT s.store_id) AS stores
            FROM master_products m
            JOIN store_skus s ON s.master_product_id = m.id
            WHERE m.brand IS NOT NULL AND TRIM(m.brand) != ''
            GROUP BY m.id
            """
        ).fetchall()

        flagged: list[tuple[str, str, str, str, str]] = []
        for r in rows:
            mid = str(r["id"])
            brand = str(r["brand"]).strip()
            raw_name = str(r["sample_raw_name"] or r["normalized_name"] or "").replace("|", " ").replace("\n", " ").replace("\r", " ").strip()
            raw_name = " ".join(raw_name.split())
            if _brand_in_text(brand, r["normalized_name"], raw_name):
                continue

            is_split_no_ean = (r["ean"] is None) and (not old_mids or mid not in old_mids)
            sig = extract_product_signature(
                raw_name,
                normalized_name=r["normalized_name"],
                brand=None,
                is_private_label=bool(r["is_private_label"]),
                single_brands=single_brands,
                multi_brands=multi_brands,
            )
            has_other_detected_brand = bool(
                sig.detected_brands and not any(brands_compatible(brand, db) for db in sig.detected_brands)
            )

            # Incluir solo candidatos de alta probabilidad de marca corrupta:
            # 1) Splits sin EAN que no se pudieron re-hidratar por VTEX y cuya marca no aparece en el nombre, O
            # 2) Maestros sin EAN donde además se detecta otra marca conocida en el texto.
            if is_split_no_ean or (r["ean"] is None and has_other_detected_brand):
                stores = str(r["stores"] or "").replace("|", ",")
                reason = "split_no_ean" if is_split_no_ean else "no_ean_brand_conflict"
                flagged.append((mid, brand.replace("|", " "), raw_name, stores, reason))
    finally:
        conn.close()

    flagged.sort(key=lambda x: (x[1].lower(), x[2].lower()))
    output_path.parent.mkdir(parents=True, exist_ok=True)

    header = """INSTRUCCIONES PARA EL LLM (AUDITORIA DE MARCAS EN SUPERMERCADOS DE COLOMBIA)
===========================================================================
Contexto:
Cada fila representa un producto maestro cuya `marca_actual` NO aparece literalmente en el `nombre_producto`.
Esto ocurre por dos motivos:
  A) ES VALIDA (fabricante/casa matriz/submarca legitima o typo menor).
     Ejemplos VALIDOS:
       - ALPINA | Yogurt Finesse Fresa 1000g  -> OK (Finesse es linea de Alpina)
       - UNILEVER | Vinagre Fruco Blanco      -> OK (Fruco es de Unilever)
       - GILLETTE | Repuesto Mach 3           -> OK (Mach 3 es de Gillette)
       - RECAMIER | Jabon Liquido Bacterion   -> OK (Bacterion es de Recamier)
       - EL REY | Sazonador Sazonarey         -> OK (Sazonarey es de El Rey)
       - NESCAFE DOLCE GUSTO | Capsulas Dolcegusto -> OK
       - SCHICK | Maquina Afeitar Shick       -> OK (typo menor)
  B) ES CORRUPTA (heredada por error de otro producto distinto).
     Ejemplos CORRUPTOS:
       - P.A.N. | Harina de maiz DIANA amarilla -> FIX | Diana
       - Kleenex | Panuelos Familia Triple Hoja -> FIX | Familia
       - Lavante | Jabon intimo INTIBON         -> FIX | Intibon
       - HACIENDA GUZMAN | Aceite CARBONELL     -> FIX | Carbonell
       - FRIKO | Filete de Pechuga porcion (sin marca clara en nombre) -> CLEAR

FORMATO EXACTO DE RESPUESTA (UNA LINEA POR REGISTRO, SIN EXPLICACIONES):
- Solo devuelve los registros que requieran cambio (OMITE los que sean OK para ahorrar tokens):
  <master_id> | FIX | <marca_correcta>
  <master_id> | CLEAR |
- Usa `FIX` cuando la marca real aparece claramente en `nombre_producto`.
- Usa `CLEAR` cuando `marca_actual` claramente contradice el producto o es heredada dudosa y el nombre no indica otra marca real.
- NO cambies el `<master_id>`. NO agregues numeracion ni texto extra.

COLUMNAS DE ENTRADA:
master_id | marca_actual | nombre_producto | tiendas | motivo
---------------------------------------------------------------------------
"""
    lines = [header]
    for mid, brand, raw_name, stores, reason in flagged:
        lines.append(f"{mid} | {brand} | {raw_name} | {stores} | {reason}\n")

    output_path.write_text("".join(lines), encoding="utf-8")
    return len(flagged), output_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Exporta auditoría de marcas sospechosas a .txt para LLM.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--out", default=str(DEFAULT_OUTPUT_PATH))
    args = parser.parse_args(argv)
    count, path = export_llm_brand_audit(Path(args.db), Path(args.out))
    print(f"Exported {count} candidate masters to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
