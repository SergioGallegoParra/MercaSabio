"""Corrige colisiones de gramaje/paca por EAN y recalcula `pum_price` en SQLite local.

Resuelve dos fuentes principales de valores atípicos de PUM en `etl/data/local_staging.db`:
  1. Colisiones de contenido (ej. `Arroz ZULIA x500 g` enlazado por EAN a
     `paca arroz zulia 500gx25u` de `12500 g`, o maestros con `1.00 und` cuando
     `raw_name` especifica `30uni` / `500g`): actualiza el maestro si todos sus
     SKUs coinciden, o separa los SKUs incompatibles a un maestro propio.
  2. Desfases de `pum_price` (ej. multipacks `3 unds x 80 g` o `unitMultiplier=1`
     en VTEX): recalcula `pum_price = calibrated_price / master_products.net_content`
     cuando la diferencia supera el 5%.

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.fix_content_and_pum_local --dry-run
    .\\.venv\\Scripts\\python.exe -m etl.fix_content_and_pum_local
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from uuid import NAMESPACE_URL, uuid4, uuid5

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.normalizer import extract_content_from_text, normalize_product_name

logger = logging.getLogger("etl.fix_content_and_pum_local")

_Q4 = Decimal("0.0001")


@dataclass(slots=True)
class PumFixStats:
    masters_content_updated: int = 0
    masters_split_content: int = 0
    skus_reassigned: int = 0
    pum_records_updated: int = 0
    final_master_products: int = 0
    final_store_skus: int = 0


def _is_content_mismatch(
    parsed_net: Decimal,
    parsed_unit: str,
    master_net: Decimal,
    master_unit: str,
) -> bool:
    if parsed_net <= 0 or master_net <= 0:
        return False
    if parsed_unit == master_unit:
        ratio = parsed_net / master_net
        return ratio >= Decimal("2.0") or ratio <= Decimal("0.5")
    if master_unit == "und" and master_net == Decimal("1"):
        return parsed_unit in {"g", "ml"} or parsed_net >= Decimal("2")
    return False


def fix_content_and_pum_local(
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    create_backup: bool = True,
    dry_run: bool = False,
) -> PumFixStats:
    if not db_path.exists():
        raise FileNotFoundError(f"No existe la base SQLite local: {db_path}")

    if create_backup and not dry_run:
        backup_path = db_path.with_name("local_staging_pre_pum_fix.db.bak")
        if not backup_path.exists():
            shutil.copy2(db_path, backup_path)
            logger.info("Respaldo previo a fix PUM creado en %s", backup_path)

    stats = PumFixStats()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        masters_by_id = {
            str(r["id"]): dict(r)
            for r in conn.execute("SELECT * FROM master_products").fetchall()
        }
        skus_by_master: dict[str, list[dict[str, object]]] = defaultdict(list)
        for r in conn.execute("SELECT id, store_id, master_product_id, raw_name FROM store_skus").fetchall():
            skus_by_master[str(r["master_product_id"])].append(dict(r))

        master_updates: list[tuple[str, str, str]] = []
        new_masters: list[tuple[object, ...]] = []
        sku_reassignments: list[tuple[str, str]] = []
        existing_ids = set(masters_by_id)

        for mid, skus in skus_by_master.items():
            mp = masters_by_id.get(mid)
            if mp is None:
                continue
            try:
                mp_net = Decimal(str(mp["net_content"]))
            except Exception:
                continue
            mp_unit = str(mp["unit_measure"])

            mismatched_groups: dict[tuple[Decimal, str], list[dict[str, object]]] = defaultdict(list)
            matched_count = 0

            for sku in skus:
                parsed = extract_content_from_text(str(sku["raw_name"]))
                if parsed is None:
                    matched_count += 1
                    continue
                if _is_content_mismatch(parsed.net_content, parsed.unit_measure.value, mp_net, mp_unit):
                    mismatched_groups[(parsed.net_content, parsed.unit_measure.value)].append(sku)
                else:
                    matched_count += 1

            if not mismatched_groups:
                continue

            # Si TODOS los SKUs del maestro coinciden en el mismo contenido nuevo, actualizar el maestro directo
            if matched_count == 0 and len(mismatched_groups) == 1:
                (new_net, new_unit), _ = next(iter(mismatched_groups.items()))
                master_updates.append((str(new_net), new_unit, mid))
                mp["net_content"] = str(new_net)
                mp["unit_measure"] = new_unit
                stats.masters_content_updated += 1
                continue

            # Mezcla unidad vs paca (u otro contenido): separar cada grupo incompatible a su propio maestro
            for (new_net, new_unit), group_skus in mismatched_groups.items():
                rep = max(group_skus, key=lambda s: len(str(s["raw_name"])))
                rep_norm = normalize_product_name(str(rep["raw_name"])) or str(mp["normalized_name"])
                cand_id = str(uuid5(NAMESPACE_URL, f"pum_split:{mid}:{new_net}:{new_unit}:{rep_norm}"))
                new_mid = str(uuid4()) if cand_id in existing_ids else cand_id
                existing_ids.add(new_mid)

                new_masters.append(
                    (
                        new_mid,
                        mp["canonical_category_id"],
                        rep_norm,
                        mp["brand"],
                        str(new_net),
                        new_unit,
                        mp["is_private_label"],
                        mp["image_url"],
                        mp["created_at"],
                        mp["product_type"],
                        mp["sub_presentation"],
                        mp["sub_presentation_label"],
                    )
                )
                masters_by_id[new_mid] = {
                    **mp,
                    "id": new_mid,
                    "ean": None,
                    "normalized_name": rep_norm,
                    "net_content": str(new_net),
                    "unit_measure": new_unit,
                }
                for s in group_skus:
                    sku_reassignments.append((new_mid, str(s["id"])))
                stats.masters_split_content += 1
                stats.skus_reassigned += len(group_skus)

        if not dry_run:
            if master_updates:
                conn.executemany(
                    "UPDATE master_products SET net_content = ?, unit_measure = ? WHERE id = ?",
                    master_updates,
                )
            if new_masters:
                conn.executemany(
                    """
                    INSERT INTO master_products (
                        id, ean, canonical_category_id, normalized_name, brand, net_content,
                        unit_measure, is_private_label, image_url, created_at,
                        shrinkflation_alert, product_type, sub_presentation, sub_presentation_label
                    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
                    """,
                    new_masters,
                )
            if sku_reassignments:
                conn.executemany(
                    "UPDATE store_skus SET master_product_id = ? WHERE id = ?",
                    sku_reassignments,
                )
            conn.commit()

        # Paso 2: Recalcular pum_price consistente contra calibrated_price / master_products.net_content
        sku_to_mid: dict[str, str] = {
            str(r["id"]): str(r["master_product_id"])
            for r in conn.execute("SELECT id, master_product_id FROM store_skus").fetchall()
        }
        if dry_run:
            for new_mid, sid in sku_reassignments:
                sku_to_mid[sid] = new_mid

        pum_updates: list[tuple[str, int]] = []
        for r in conn.execute(
            "SELECT id, store_sku_id, calibrated_price, pum_price FROM price_records"
        ).fetchall():
            mid = sku_to_mid.get(str(r["store_sku_id"]))
            mp = masters_by_id.get(mid) if mid else None
            if not mp:
                continue
            try:
                price = Decimal(str(r["calibrated_price"]))
                net = Decimal(str(mp["net_content"]))
                cur_pum = Decimal(str(r["pum_price"])) if r["pum_price"] is not None else Decimal("0")
            except Exception:
                continue
            if price <= 0 or net <= 0:
                continue
            expected = (price / net).quantize(_Q4, rounding=ROUND_HALF_UP)
            if expected <= 0:
                continue
            if cur_pum <= 0 or abs(cur_pum - expected) / expected > Decimal("0.05"):
                pum_updates.append((str(expected), int(r["id"])))

        stats.pum_records_updated = len(pum_updates)

        if not dry_run:
            if pum_updates:
                conn.executemany(
                    "UPDATE price_records SET pum_price = ? WHERE id = ?",
                    pum_updates,
                )
            conn.commit()
            conn.execute("VACUUM;")
            conn.execute("ANALYZE;")

        stats.final_master_products = int(conn.execute("SELECT COUNT(*) FROM master_products").fetchone()[0])
        stats.final_store_skus = int(conn.execute("SELECT COUNT(*) FROM store_skus").fetchone()[0])
    finally:
        conn.close()

    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser(description="Corrige colisiones de contenido y recalcula PUM en SQLite local.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--no-backup", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    st = fix_content_and_pum_local(
        db_path=Path(args.db),
        create_backup=not args.no_backup,
        dry_run=args.dry_run,
    )
    print(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
