"""Genera inventario completo de categorías por supermercado en Excel (.xlsx), CSV y Markdown.

Usa exclusivamente fuentes locales/APIs públicas de las tiendas (0 lecturas ni Disk IO
sobre Supabase) e incluye todas las cadenas registradas en `public.stores`.
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from etl.core.grocery_filter import (
    GROCERY_STORE_IDS,
    evaluate_category_path_whitelist,
    strip_accents_lower,
)
from etl.core.unified_taxonomy import UNIFIED_TAXONOMY_TREE, load_unified_classifier
from etl.scrapers.farmatodo_scraper import FARMATODO_GROCERY_DEPARTMENTS
from etl.scrapers.makro_scraper import MAKRO_CATEGORY_PATHS

DEFAULT_TREES_PATH = Path("etl/scrapers/data/vtex_category_trees_snapshot.json")
DEFAULT_OTHER_PATH = Path("etl/scrapers/data/other_stores_categories_snapshot.json")
DEFAULT_ISIMO_SSR_PATH = Path("etl/scrapers/data/isimo_rappi_ssr.json")
DEFAULT_ISIMO_BROWSER_PATH = Path("etl/scrapers/data/isimo_rappi_browser.json")
DEFAULT_XLSX_OUT = Path("docs/categorias_por_supermercado.xlsx")
DEFAULT_CSV_OUT = Path("docs/categorias_por_supermercado.csv")
DEFAULT_MD_OUT = Path("docs/categorias_por_supermercado.md")
DEFAULT_TXT_OUT = Path("docs/categorias_para_ai_studio.txt")

# Subcategorías aún ambiguas tras las confirmaciones en `docs/Categorias a incluir.xlsx`
# (desechables, aluminio, bolsas, velas, carbón, pilas, repelentes, protección solar,
#  anchetas, aspirador nasal, otros/importados/vive vital y cuidado/higiene de mascotas
#  ya quedaron INCLUIDAS; quedan aquí solo artículos/accesorios limítrofes de bebé/hogar).
_BORDERLINE_HINTS: tuple[str, ...] = (
    "esterilizador",
    "extractor",
    "tetero",
    "platos, vasos y utensilios",
    "silla de comedor",
    "termos",
    "chupo",
    "bacinilla",
    "banera",
    "panalera",
    "rascaencia",
    "yia life",
)


def classify_category_segments(store_id: str, segments: list[str]) -> tuple[str, str]:
    """Clasifica una ruta de categoría en `INCLUIDA`, `EXCLUIDA` o `REVISAR`."""
    if store_id not in GROCERY_STORE_IDS:
        return "EXCLUIDA", "Tienda fuera de alcance de mercado (tecnología/electrodomésticos/sin catálogo)"

    joined = strip_accents_lower(" > ".join(segments))
    non_wrapper_segs = [
        strip_accents_lower(seg)
        for seg in segments
        if strip_accents_lower(seg) not in {"hogar, mascotas y otros.", "hogar, mascotas y otros"}
    ]
    joined_non_wrapper = " > ".join(non_wrapper_segs) or joined
    if store_id in {"oxxo", "zapatoca", "rappi"}:
        return "REVISAR", "Sin catálogo público de precios utilizable hoy en tienda"

    wl_decision, wl_reason = evaluate_category_path_whitelist(segments)
    if wl_decision == "DENY":
        return "EXCLUIDA", "Regla automática (alcohol/cigarrillos/medicinas/juguetes/variedades/ropa/electro/hardware)"
    if wl_decision == "UNKNOWN":
        return "REVISAR", wl_reason

    for hint in _BORDERLINE_HINTS:
        if hint in joined:
            return "REVISAR", f"Subcategoría mixta o limítrofe ('{hint}')"

    # Para mascotas, diferenciamos alimento/higiene/aves/peces/roedores (incluidos) frente a accesorios explícitos
    if "mascota" in joined_non_wrapper and "accesorio" in joined_non_wrapper:
        return "REVISAR", "Subcategoría genérica de mascotas (revisar si trae accesorios además de comida)"

    return "INCLUIDA", "Alimentos, carnes/quesos/cafés, snacks, energizantes, aseo hogar/personal o bebé/mascotas válidos"


def _flatten_vtex_paths(nodes: list[dict[str, Any]], max_depth: int = 3) -> list[list[str]]:
    paths: list[list[str]] = []

    def walk(node: dict[str, Any], prefix: list[str]) -> None:
        name = str(node.get("name") or "").strip()
        if not name or name == "0":
            return
        cur = [*prefix, name]
        children = node.get("children") or []
        if children and len(cur) < max_depth:
            for ch in children:
                walk(ch, cur)
        else:
            paths.append(cur)

    for root in nodes:
        walk(root, [])
    return paths


def _format_makro_path(raw: str | list[str]) -> list[str]:
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    clean = str(raw).strip("/").removeprefix("ca/")
    parts = [p.replace("-", " ").strip().title() for p in clean.split("/") if p and not p.startswith(("CP_", "CT_"))]
    return parts or [clean]


def collect_store_categories() -> dict[str, list[list[str]]]:
    """Recopila rutas reales de categorías para todas las cadenas del proyecto."""
    by_store: dict[str, list[list[str]]] = {}

    if DEFAULT_TREES_PATH.is_file():
        trees = json.loads(DEFAULT_TREES_PATH.read_text(encoding="utf-8"))
        for sid, roots in trees.items():
            if isinstance(roots, list):
                by_store[sid] = _flatten_vtex_paths(roots, max_depth=3)

    other = (
        json.loads(DEFAULT_OTHER_PATH.read_text(encoding="utf-8"))
        if DEFAULT_OTHER_PATH.is_file()
        else {}
    )

    # Farmatodo (Algolia 590 rutas reales o fallback departamentos)
    ft_paths = other.get("farmatodo") or []
    if ft_paths:
        by_store["farmatodo"] = [[str(seg) for seg in row] for row in ft_paths if row]
    else:
        by_store["farmatodo"] = [[dept] for dept in FARMATODO_GROCERY_DEPARTMENTS]

    # Ara (categorías reales API GW)
    ara_cats = other.get("ara") or []
    if ara_cats:
        by_store["ara"] = [[str(c)] for c in ara_cats]
    else:
        by_store["ara"] = [["Catálogo directo API /stores + /products"]]

    # Makro (rutas del scraper + slugs RSC)
    makro_seen: set[tuple[str, ...]] = set()
    makro_paths: list[list[str]] = []
    for raw_p in [*MAKRO_CATEGORY_PATHS, *(other.get("makro") or [])]:
        segs = _format_makro_path(raw_p)
        key = tuple(segs)
        if key not in makro_seen:
            makro_seen.add(key)
            makro_paths.append(segs)
    by_store["makro"] = makro_paths

    # Ísimo (93 SSR + secciones dinámicas Rappi)
    isimo_paths: list[list[str]] = []
    if DEFAULT_ISIMO_SSR_PATH.is_file():
        ssr_items = json.loads(DEFAULT_ISIMO_SSR_PATH.read_text(encoding="utf-8"))
        cats = sorted({str(x.get("category_name") or "").strip() for x in ssr_items if x.get("category_name")})
        for cat in cats:
            isimo_paths.append([cat])
    if DEFAULT_ISIMO_BROWSER_PATH.is_file():
        b_items = json.loads(DEFAULT_ISIMO_BROWSER_PATH.read_text(encoding="utf-8"))
        secs = sorted({str(x.get("section") or "").strip() for x in b_items if x.get("section")})
        for sec in secs:
            isimo_paths.append([s.replace("-", " ").title() for s in sec.split("/") if s])
    if isimo_paths:
        by_store["isimo"] = isimo_paths

    # Otras tiendas registradas en `public.stores` para inventario 100% completo
    by_store["oxxo"] = [["Sin e-commerce con precios públicos (pendiente fuente alternativa)"]]
    by_store["zapatoca"] = [["Web sin precios públicos visibles y con bloqueo WAF (mercadozapatoca.com)"]]
    by_store["rappi"] = [["Agregador general (solo usado como fuente de Tiendas Ísimo)"]]
    by_store["alkosto"] = [["Tecnología / Electrodomésticos (SAP Hybris — excluida de mercado)"]]
    by_store["ktronix"] = [["Tecnología / Electrodomésticos (SAP Hybris — excluida de mercado)"]]

    return by_store


def _write_excel_workbook(
    xlsx_out: Path,
    *,
    summary: dict[str, dict[str, int]],
    all_rows: list[list[str]],
) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    status_fills = {
        "INCLUIDA": PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid"),
        "REVISAR": PatternFill(start_color="FEF9C3", end_color="FEF9C3", fill_type="solid"),
        "EXCLUIDA": PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid"),
    }

    def style_sheet(ws: Any, headers: list[str], rows: list[list[Any]], *, status_col: int | None = None) -> None:
        ws.append(headers)
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.fill = header_fill
            cell.font = header_font
        for row_idx, r in enumerate(rows, start=2):
            ws.append(r)
            if status_col is not None and len(r) >= status_col:
                st = str(r[status_col - 1])
                if st in status_fills:
                    ws.cell(row=row_idx, column=status_col).fill = status_fills[st]
        ws.freeze_panes = "A2"
        last_col = get_column_letter(len(headers))
        ws.auto_filter.ref = f"A1:{last_col}{max(len(rows) + 1, 1)}"
        for col_idx in range(1, len(headers) + 1):
            max_len = max(
                [len(str(ws.cell(row=row_i, column=col_idx).value or "")) for row_i in range(1, min(len(rows) + 2, 400))],
                default=12,
            )
            ws.column_dimensions[get_column_letter(col_idx)].width = min(max(max_len + 4, 14), 58)

    # Hoja 1: Resumen por tienda
    ws_sum = wb.active
    ws_sum.title = "Resumen por tienda"
    sum_rows = [
        [sid, c["total"], c["incluida"], c["revisar"], c["excluida"]]
        for sid, c in sorted(summary.items())
    ]
    style_sheet(
        ws_sum,
        ["Tienda", "Total categorías/rutas", "Incluidas", "Para revisar", "Excluidas"],
        sum_rows,
    )

    cat_headers = [
        "Tienda",
        "Nivel 1",
        "Nivel 2",
        "Nivel 3",
        "Ruta completa",
        "Estado",
        "Motivo / Criterio",
        "Macro categoría",
        "Subcategoría unificada",
        "Origen taxonomía",
    ]

    # Hoja 2: Para revisar (prioridad de revisión)
    ws_rev = wb.create_sheet("Para revisar")
    style_sheet(ws_rev, cat_headers, [r for r in all_rows if r[5] == "REVISAR"], status_col=6)

    # Hoja 3: Todas (con filtro Excel)
    ws_all = wb.create_sheet("Todas las categorias")
    style_sheet(ws_all, cat_headers, all_rows, status_col=6)

    # Hoja 4: Incluidas
    ws_inc = wb.create_sheet("Incluidas")
    style_sheet(ws_inc, cat_headers, [r for r in all_rows if r[5] == "INCLUIDA"], status_col=6)

    # Hoja 5: Excluidas
    ws_exc = wb.create_sheet("Excluidas")
    style_sheet(ws_exc, cat_headers, [r for r in all_rows if r[5] == "EXCLUIDA"], status_col=6)

    # Hoja 6: Taxonomia unificada (10 Macro x 59 Sub)
    tax_counts: dict[tuple[str, str], int] = defaultdict(int)
    for r in all_rows:
        if r[5] == "INCLUIDA" and r[7] and r[8]:
            tax_counts[(r[7], r[8])] += 1
    tax_rows = [
        [macro, sub, tax_counts.get((macro, sub), 0)]
        for macro, subs in UNIFIED_TAXONOMY_TREE.items()
        for sub in subs
    ]
    ws_tax = wb.create_sheet("Taxonomia (10x59)")
    style_sheet(ws_tax, ["Macro categoría", "Subcategoría unificada", "Rutas incluidas"], tax_rows)

    xlsx_out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(xlsx_out)


def generate_report_files(
    *,
    md_out: Path = DEFAULT_MD_OUT,
    csv_out: Path = DEFAULT_CSV_OUT,
    xlsx_out: Path | None = DEFAULT_XLSX_OUT,
    txt_out: Path | None = DEFAULT_TXT_OUT,
) -> dict[str, dict[str, int]]:
    """Escribe el reporte en Excel (`.xlsx`), CSV y Markdown con todas las tiendas y categorías."""
    by_store = collect_store_categories()
    classifier = load_unified_classifier()
    summary: dict[str, dict[str, int]] = {}
    all_rows: list[list[str]] = []

    md_lines: list[str] = [
        "# Categorías por Supermercado (Revisión y Depuración)",
        "",
        "Incluye todas las tiendas del proyecto (**18 registros en `public.stores`**) con las nuevas inclusiones confirmadas: *aseo/higiene personal, cuidado oral y corporal, bebidas energizantes, snacks, carnes especiales/maduradas, aseo y limpieza del hogar (no accesorios/electrodomésticos), quesos especiales, alimentación/cuidado/aseo de bebé (sin ropa/coches/muebles/juguetes), natillas/buñuelos y cafés especiales*.",
        "",
        "> **Archivo principal en Excel:** `docs/categorias_por_supermercado.xlsx` (hojas: `Resumen por tienda`, `Para revisar`, `Todas las categorias`, `Incluidas`, `Excluidas`, `Taxonomia (10x59)`).",
        "",
        "## Resumen general",
        "",
        "| Tienda | Total rutas | Incluidas ✅ | Para revisar ❓ | Excluidas automáticamente ⛔ |",
        "|---|---:|---:|---:|---:|",
    ]

    store_sections: list[str] = []

    for store_id in sorted(by_store):
        paths = by_store[store_id]
        grouped: dict[str, list[tuple[str, str]]] = defaultdict(list)
        seen_label: set[str] = set()

        for segs in paths:
            path_label = " > ".join(segs)
            if path_label in seen_label:
                continue
            seen_label.add(path_label)
            status, reason = classify_category_segments(store_id, segs)
            grouped[status].append((path_label, reason))
            if status == "INCLUIDA":
                match = classifier.classify(store_id=store_id, category_path=segs)
                macro_cat, sub_cat, tax_src = match.macro_categoria, match.subcategoria, match.source
            else:
                macro_cat, sub_cat, tax_src = "", "", ""
            all_rows.append([
                store_id,
                segs[0] if segs else "",
                segs[1] if len(segs) > 1 else "",
                segs[2] if len(segs) > 2 else "",
                path_label,
                status,
                reason,
                macro_cat,
                sub_cat,
                tax_src,
            ])

        inc_n = len(grouped["INCLUIDA"])
        rev_n = len(grouped["REVISAR"])
        exc_n = len(grouped["EXCLUIDA"])
        total_n = inc_n + rev_n + exc_n
        summary[store_id] = {"total": total_n, "incluida": inc_n, "revisar": rev_n, "excluida": exc_n}
        md_lines.append(f"| `{store_id}` | {total_n} | {inc_n} | {rev_n} | {exc_n} |")

        store_sections.append(f"\n---\n\n## `{store_id}` ({total_n} categorías/rutas)\n")

        if grouped["REVISAR"]:
            store_sections.append("### ❓ Para revisar contigo\n")
            for label, reason in sorted(grouped["REVISAR"]):
                store_sections.append(f"- [ ] `{label}` — _{reason}_")
            store_sections.append("")

        if grouped["INCLUIDA"]:
            store_sections.append("### ✅ Incluidas actualmente\n")
            by_root: dict[str, list[str]] = defaultdict(list)
            for label, _ in sorted(grouped["INCLUIDA"]):
                root = label.split(" > ", 1)[0]
                by_root[root].append(label)
            for root, items in sorted(by_root.items()):
                if len(items) == 1 and items[0] == root:
                    store_sections.append(f"- `{root}`")
                else:
                    children_str = ", ".join(
                        i.split(" > ", 1)[1] if " > " in i else i
                        for i in items[:40]
                    )
                    suffix = f" ... (+{len(items) - 40} más en el Excel)" if len(items) > 40 else ""
                    store_sections.append(f"- **`{root}`** ({len(items)}): {children_str}{suffix}")
            store_sections.append("")

        if grouped["EXCLUIDA"]:
            store_sections.append("### ⛔ Excluidas automáticamente\n")
            roots_exc = sorted({label.split(" > ", 1)[0] for label, _ in grouped["EXCLUIDA"]})
            store_sections.append(f"- Raíces / grupos bloqueados: {', '.join(f'`{r}`' for r in roots_exc)}")
            sub_exc = [label for label, _ in sorted(grouped["EXCLUIDA"]) if " > " in label]
            if sub_exc:
                sample = ", ".join(f"`{s}`" for s in sub_exc[:25])
                extra = f" ... (+{len(sub_exc) - 25} más en el Excel)" if len(sub_exc) > 25 else ""
                store_sections.append(f"- Subcategorías bloqueadas: {sample}{extra}")
            store_sections.append("")

    md_out.parent.mkdir(parents=True, exist_ok=True)
    md_out.write_text("\n".join(md_lines + store_sections), encoding="utf-8")

    csv_out.parent.mkdir(parents=True, exist_ok=True)
    with csv_out.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow([
            "store_id",
            "nivel_1",
            "nivel_2",
            "nivel_3",
            "ruta_completa",
            "estado",
            "motivo",
            "macro_categoria",
            "subcategoria",
            "origen_taxonomia",
        ])
        writer.writerows(all_rows)

    if xlsx_out is not None:
        _write_excel_workbook(xlsx_out, summary=summary, all_rows=all_rows)

    if txt_out is not None:
        txt_out.parent.mkdir(parents=True, exist_ok=True)
        included_lines = [
            f"{row[0]} | {row[4]}"
            for row in sorted(all_rows, key=lambda item: (item[0], item[4]))
            if row[5] == "INCLUIDA"
        ]
        txt_out.write_text("\n".join(included_lines) + "\n", encoding="utf-8")

    return summary


if __name__ == "__main__":
    res = generate_report_files()
    for sid, counts in res.items():
        print(sid, counts)
