"""Auditoría semántica local con Embeddings + Clustering + Detector de Anomalías.

Usa embeddings multilingües 100% en local (`fastembed`, costo $0) sobre
`etl/data/local_staging.db` para generar:
  1. `exports/llm_clusters_curacion.txt`: ~500 micro-grupos semánticos que resumen
     todo el catálogo para curación en bloque con un LLM en 1 sola consulta.
  2. `exports/llm_anomalias_semantica.txt`: lista corta de contradicciones de
     categoría (out-of-fold) y sospechosos residuales de `NO_MERCADO`.

Guarda los vectores e índice de clusters en `etl/data/semantic_audit_cache.npz`
para poder aplicar decisiones por `cluster_id` o `master_product_id` sin recalcular.

Uso:
    .\\.venv\\Scripts\\python.exe -m etl.semantic_catalog_audit
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding
from sklearn.cluster import MiniBatchKMeans
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict

from etl.core.local_gateway import DEFAULT_LOCAL_DB_PATH
from etl.core.match_safety import meaningful_tokens
from etl.import_llm_v2_local import (
    DEFAULT_LLM_V2_DIR,
    DEFAULT_UNCAT_INDEX_PATH,
)

logger = logging.getLogger("etl.semantic_catalog_audit")

DEFAULT_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
DEFAULT_CACHE_PATH = Path("etl/data/semantic_audit_cache.npz")
DEFAULT_CLUSTERS_MAP_PATH = Path("etl/data/semantic_clusters_map.json")
DEFAULT_CLUSTERS_TXT_PATH = Path("exports/llm_clusters_curacion.txt")
DEFAULT_CAT_CLUSTERS_MAP_PATH = Path("etl/data/semantic_clusters_by_category_map.json")
DEFAULT_CAT_CLUSTERS_TXT_PATH = Path("exports/llm_clusters_por_categoria.txt")
DEFAULT_ANOMALIES_TXT_PATH = Path("exports/llm_anomalias_semantica.txt")

DEFAULT_NOISY_CATEGORY_CLUSTERS: dict[str, int] = {
    "bebes-y-maternidad": 50,
    "mascotas": 40,
    "cuidado-personal-e-higiene": 120,
    "hogar-y-desechables": 25,
}


def _clean_cell(val: object) -> str:
    if val is None:
        return ""
    return " ".join(str(val).replace("\t", " ").replace("\r", " ").replace("\n", " ").split())


def _l2_normalize(mat: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (mat / norms).astype(np.float32)


def _load_master_catalog(db_path: Path) -> tuple[list[dict[str, object]], list[tuple[str, str]]]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cats = [
            (str(r["slug"]), _clean_cell(r["name"] or r["slug"]))
            for r in conn.execute("SELECT slug, name FROM canonical_categories ORDER BY slug ASC").fetchall()
        ]
        rows = conn.execute(
            """
            SELECT
                mp.id AS master_product_id,
                COALESCE(NULLIF(TRIM(MIN(ss.display_name)), ''), MIN(ss.raw_name)) AS title,
                mp.brand,
                cc.slug AS current_slug,
                COUNT(DISTINCT ss.store_id) AS store_count,
                COUNT(ss.id) AS sku_count
            FROM master_products mp
            JOIN canonical_categories cc ON cc.id = mp.canonical_category_id
            JOIN store_skus ss ON ss.master_product_id = mp.id
            GROUP BY mp.id
            ORDER BY mp.id ASC
            """
        ).fetchall()
    finally:
        conn.close()

    items = [
        {
            "id": str(r["master_product_id"]),
            "title": _clean_cell(r["title"]),
            "brand": _clean_cell(r["brand"]),
            "slug": str(r["current_slug"]),
            "store_count": int(r["store_count"]),
            "sku_count": int(r["sku_count"]),
        }
        for r in rows
    ]
    return items, cats


def _compute_or_load_embeddings(
    items: list[dict[str, object]],
    *,
    model_name: str,
    cache_path: Path,
) -> tuple[TextEmbedding, np.ndarray]:
    model = TextEmbedding(model_name=model_name)
    item_ids = [str(it["id"]) for it in items]

    if cache_path.exists():
        data = np.load(cache_path, allow_pickle=False)
        cached_ids = data["ids"].tolist()
        if cached_ids == item_ids and str(data["model"][0]) == model_name:
            logger.info("Embeddings cargados desde caché %s (%d vectores).", cache_path, len(item_ids))
            return model, data["embeddings"].astype(np.float32)

    texts = [
        f"{it['title']} ({it['brand']})" if it["brand"] else str(it["title"])
        for it in items
    ]
    logger.info("Calculando %d embeddings locales con %s...", len(texts), model_name)
    vecs = list(model.embed(texts, batch_size=256))
    mat = _l2_normalize(np.vstack(vecs))

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cache_path,
        ids=np.array(item_ids, dtype="<U36"),
        model=np.array([model_name]),
        embeddings=mat.astype(np.float16),
    )
    logger.info("Caché guardada en %s", cache_path)
    return model, mat


def _build_no_mercado_detector_training(
    model: TextEmbedding,
    items: list[dict[str, object]],
    X_items: np.ndarray,
    *,
    v2_dir: Path,
    index_path: Path,
) -> tuple[np.ndarray, np.ndarray]:
    """Construye dataset OK vs NO_MERCADO reutilizando embeddings en caché para ítems OK."""
    if not index_path.exists() or not v2_dir.exists():
        return np.empty((0, 0), dtype=np.float32), np.empty((0,), dtype=np.int32)

    mid_to_idx = {str(it["id"]): idx for idx, it in enumerate(items)}
    row_to_text: dict[int, tuple[str, str]] = {}
    with index_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("#") or line.startswith("row_id\t"):
                continue
            parts = line.rstrip("\r\n").split("\t")
            if len(parts) >= 4 and parts[0].isdigit():
                rid = int(parts[0])
                mid = parts[1].strip()
                txt = f"{_clean_cell(parts[2])} ({_clean_cell(parts[3])})" if parts[3].strip() else _clean_cell(parts[2])
                row_to_text[rid] = (mid, txt)

    ok_vecs: list[np.ndarray] = []
    nm_texts: list[str] = []
    res_dir = v2_dir / "Resultado"
    if res_dir.exists():
        lote_rx = re.compile(r"(?:^|\s)(\d+)\t([a-z0-9-]*)\t(OK|NO_MERCADO)(?=\s|$)")
        for path in res_dir.glob("Lote *.txt"):
            txt = re.sub(r"^row_id\tcanonical_slug\taction\b", "", path.read_text(encoding="utf-8", errors="replace").strip())
            for rid_s, _slug, act in lote_rx.findall(txt):
                rid = int(rid_s)
                if rid not in row_to_text:
                    continue
                mid, prod_txt = row_to_text[rid]
                if act == "NO_MERCADO":
                    nm_texts.append(prod_txt)
                elif mid in mid_to_idx:
                    ok_vecs.append(X_items[mid_to_idx[mid]])

    if not nm_texts or not ok_vecs:
        return np.empty((0, 0), dtype=np.float32), np.empty((0,), dtype=np.int32)

    logger.info("Codificando %d ejemplos NO_MERCADO + reutilizando %d OK desde caché...", len(nm_texts), len(ok_vecs))
    X_nm = _l2_normalize(np.vstack(list(model.embed(nm_texts, batch_size=256))))
    X_ok = np.vstack(ok_vecs).astype(np.float32)
    X_train = np.vstack([X_ok, X_nm])
    y_train = np.concatenate([np.zeros(len(X_ok), dtype=np.int32), np.ones(len(X_nm), dtype=np.int32)])
    return X_train, y_train


def run_semantic_audit(
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    model_name: str = DEFAULT_MODEL_NAME,
    n_clusters: int = 500,
    cache_path: Path = DEFAULT_CACHE_PATH,
    clusters_map_path: Path = DEFAULT_CLUSTERS_MAP_PATH,
    clusters_txt_path: Path = DEFAULT_CLUSTERS_TXT_PATH,
    anomalies_txt_path: Path = DEFAULT_ANOMALIES_TXT_PATH,
    max_anomalies: int = 2000,
) -> dict[str, int]:
    items, cats = _load_master_catalog(db_path)
    if not items:
        raise RuntimeError("No hay master_products para auditar.")

    model, X = _compute_or_load_embeddings(items, model_name=model_name, cache_path=cache_path)

    # 1) Clustering semántico en micro-grupos
    k = min(n_clusters, max(20, len(items) // 20))
    logger.info("Agrupando %d productos en %d micro-grupos semánticos...", len(items), k)
    kmeans = MiniBatchKMeans(
        n_clusters=k,
        batch_size=2048,
        random_state=42,
        n_init=3,
    )
    labels = kmeans.fit_predict(X)
    centroids = _l2_normalize(kmeans.cluster_centers_)

    clusters_indices: dict[int, list[int]] = defaultdict(list)
    for idx, cid in enumerate(labels):
        clusters_indices[int(cid)].append(idx)

    # Guardar mapa cluster_id -> master_product_ids para poder operar en bloque luego
    clusters_map = {
        str(cid): [str(items[i]["id"]) for i in idxs]
        for cid, idxs in clusters_indices.items()
    }
    clusters_map_path.parent.mkdir(parents=True, exist_ok=True)
    clusters_map_path.write_text(json.dumps(clusters_map), encoding="utf-8")

    cluster_summaries: list[tuple[float, int, str]] = []
    for cid, idxs in clusters_indices.items():
        n_masters = len(idxs)
        n_skus = sum(int(items[i]["sku_count"]) for i in idxs)
        single_store_count = sum(1 for i in idxs if int(items[i]["store_count"]) == 1)
        pct_single = round((single_store_count / max(n_masters, 1)) * 100)

        cat_counts = Counter(str(items[i]["slug"]) for i in idxs)
        top_cats = ", ".join(f"{slug}({cnt})" for slug, cnt in cat_counts.most_common(2))

        word_counts: Counter[str] = Counter()
        for i in idxs:
            word_counts.update(meaningful_tokens(str(items[i]["title"])))
        top_kw = ", ".join(w for w, _ in word_counts.most_common(5))

        # Elegir 5 muestras: 3 más cercanas al centroide + 2 variadas
        sims = X[idxs] @ centroids[cid]
        order = np.argsort(-sims)
        sample_idxs: list[int] = []
        seen_titles: set[str] = set()
        for pos in list(order[:10]) + list(order[max(0, len(order) // 2) : len(order) // 2 + 5]):
            real_i = idxs[int(pos)]
            t = str(items[real_i]["title"])
            if t.lower() not in seen_titles:
                seen_titles.add(t.lower())
                sample_idxs.append(real_i)
            if len(sample_idxs) >= 5:
                break
        samples_str = " | ".join(str(items[i]["title"]) for i in sample_idxs)

        line = "\t".join(
            [
                str(cid),
                str(n_masters),
                str(n_skus),
                f"{pct_single}%",
                top_cats,
                top_kw,
                samples_str,
            ]
        )
        # Priorizar arriba grupos potencialmente de nicho/ruido (alto % en 1 sola tienda)
        priority_score = (pct_single / 100.0) * np.log1p(n_masters)
        cluster_summaries.append((float(priority_score), cid, line))

    cluster_summaries.sort(key=lambda x: x[0], reverse=True)
    clusters_txt_path.parent.mkdir(parents=True, exist_ok=True)
    with clusters_txt_path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(
            "=== CURACIÓN POR MICRO-GRUPOS SEMÁNTICOS (500 CLUSTERS DE TODO EL CATÁLOGO) ===\n"
            "Instrucciones para el LLM:\n"
            "Revisa cada grupo (`cluster_id`) según sus palabras clave y ejemplos.\n"
            "Responde ÚNICAMENTE con los `cluster_id` que requieran acción (omite los que estén bien en `MANTENER`), en formato TSV:\n"
            "cluster_id\taccion (EXCLUIR_NO_MERCADO | REVISAR_MIXTO | RECLASIFICAR)\tnuevo_slug_si_aplica\tmotivo_breve\n\n"
            "CATEGORÍAS OFICIALES VÁLIDAS: " + ", ".join(s for s, _ in cats) + "\n\n"
            "cluster_id\tn_masters\tn_skus\tpct_1_tienda\tcategorias_dominantes\tpalabras_clave\tejemplos_representativos\n"
        )
        for _score, _cid, line in cluster_summaries:
            fh.write(line + "\n")

    # 2) Detector out-of-fold de contradicciones de categoría
    cat_list = sorted({str(it["slug"]) for it in items})
    slug_to_idx = {s: idx for idx, s in enumerate(cat_list)}
    y_cats = np.array([slug_to_idx[str(it["slug"])] for it in items], dtype=np.int32)

    logger.info("Entrenando detector out-of-fold sobre %d categorías...", len(cat_list))
    clf_cats = LogisticRegression(C=3.0, max_iter=300)
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    probs = cross_val_predict(clf_cats, X, y_cats, cv=cv, method="predict_proba")

    # 3) Detector de NO_MERCADO residual usando etiquetas históricas del LLM
    X_nm, y_nm = _build_no_mercado_detector_training(
        model,
        items,
        X,
        v2_dir=DEFAULT_LLM_V2_DIR,
        index_path=DEFAULT_UNCAT_INDEX_PATH,
    )
    nm_probs = np.zeros(len(items), dtype=np.float32)
    if len(X_nm) > 50 and y_nm.sum() > 10:
        nm_clf = LogisticRegression(C=2.0, max_iter=400, class_weight={0: 1.0, 1: 2.5})
        nm_clf.fit(X_nm, y_nm)
        nm_probs = nm_clf.predict_proba(X)[:, 1]

    nm_anomalies: list[tuple[float, str]] = []
    cat_anomalies: list[tuple[float, str]] = []
    for i, it in enumerate(items):
        cur_idx = y_cats[i]
        cur_prob = float(probs[i, cur_idx])
        best_idx = int(np.argmax(probs[i]))
        best_prob = float(probs[i, best_idx])
        best_slug = cat_list[best_idx]
        p_nm = float(nm_probs[i])

        if p_nm >= 0.70:
            nm_anomalies.append(
                (
                    p_nm,
                    "\t".join(
                        [
                            str(it["id"]),
                            str(it["title"]),
                            str(it["brand"]),
                            str(it["slug"]),
                            "EXCLUIR_NO_MERCADO",
                            f"{p_nm:.2f}",
                            "sospechoso_no_mercado",
                        ]
                    ),
                )
            )
        if best_idx != cur_idx and best_prob >= 0.80 and cur_prob <= 0.12:
            cat_anomalies.append(
                (
                    best_prob - cur_prob,
                    "\t".join(
                        [
                            str(it["id"]),
                            str(it["title"]),
                            str(it["brand"]),
                            str(it["slug"]),
                            best_slug,
                            f"{best_prob:.2f} (actual {cur_prob:.2f})",
                            "contradiccion_categoria",
                        ]
                    ),
                )
            )

    nm_anomalies.sort(key=lambda x: x[0], reverse=True)
    cat_anomalies.sort(key=lambda x: x[0], reverse=True)
    top_nm = nm_anomalies[: min(800, max_anomalies // 2)]
    top_cat = cat_anomalies[: max(1200, max_anomalies - len(top_nm))]
    top_anomalies = top_cat + top_nm

    anomalies_txt_path.parent.mkdir(parents=True, exist_ok=True)
    with anomalies_txt_path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(
            f"=== ANOMALÍAS SEMÁNTICAS DETECTADAS ({len(top_cat)} CONTRADICCIONES + {len(top_nm)} NO_MERCADO) ===\n"
            "Instrucciones para el LLM:\n"
            "Revisa cada producto sospechoso y responde ÚNICAMENTE las filas que necesiten cambio en formato TSV:\n"
            "master_product_id\taccion (RECLASIFICAR | EXCLUIR_NO_MERCADO | MANTENER)\tcanonical_slug_final\n\n"
            "CATEGORÍAS OFICIALES VÁLIDAS: " + ", ".join(s for s, _ in cats) + "\n\n"
            "master_product_id\ttitle\tbrand\tcurrent_slug\tsuggested_slug\tconfidence\treason\n"
        )
        for _score, row_txt in top_anomalies:
            fh.write(row_txt + "\n")

    return {
        "total_masters": len(items),
        "clusters_generated": len(cluster_summaries),
        "clusters_file_bytes": clusters_txt_path.stat().st_size,
        "anomalies_cat_contradictions": len(cat_anomalies),
        "anomalies_no_mercado": len(nm_anomalies),
        "anomalies_exported": len(top_anomalies),
        "anomalies_file_bytes": anomalies_txt_path.stat().st_size,
    }


def generate_per_category_clusters(
    *,
    db_path: Path = DEFAULT_LOCAL_DB_PATH,
    cache_path: Path = DEFAULT_CACHE_PATH,
    category_counts: dict[str, int] | None = None,
    clusters_map_path: Path = DEFAULT_CAT_CLUSTERS_MAP_PATH,
    clusters_txt_path: Path = DEFAULT_CAT_CLUSTERS_TXT_PATH,
) -> dict[str, int]:
    """Agrupa en micro-grupos homogéneos *dentro* de cada categoría ruidosa usando caché."""
    if not cache_path.exists():
        raise FileNotFoundError(f"No existe la caché de embeddings: {cache_path}")

    items, cats = _load_master_catalog(db_path)
    data = np.load(cache_path, allow_pickle=False)
    cached_ids = [str(x) for x in data["ids"].tolist()]
    id_to_row = {mid: idx for idx, mid in enumerate(cached_ids)}
    emb_matrix = data["embeddings"].astype(np.float32)

    target_cats = category_counts or DEFAULT_NOISY_CATEGORY_CLUSTERS
    by_slug: dict[str, list[tuple[dict[str, object], np.ndarray]]] = defaultdict(list)
    for it in items:
        slug = str(it["slug"])
        if slug in target_cats and str(it["id"]) in id_to_row:
            by_slug[slug].append((it, emb_matrix[id_to_row[str(it["id"])]]))

    clusters_map: dict[str, list[str]] = {}
    lines_out: list[str] = []
    total_clusters = 0
    total_items = 0

    for slug, desired_k in target_cats.items():
        entries = by_slug.get(slug, [])
        if not entries:
            continue
        k = min(desired_k, max(5, len(entries) // 10))
        sub_X = np.vstack([v for _, v in entries])
        kmeans = MiniBatchKMeans(n_clusters=k, batch_size=1024, random_state=42, n_init=3)
        labels = kmeans.fit_predict(sub_X)
        centroids = _l2_normalize(kmeans.cluster_centers_)

        grouped: dict[int, list[int]] = defaultdict(list)
        for idx, cid in enumerate(labels):
            grouped[int(cid)].append(idx)

        cat_rows: list[tuple[int, str]] = []
        for cid, idxs in grouped.items():
            key = f"{slug}#{cid + 1:02d}"
            clusters_map[key] = [str(entries[i][0]["id"]) for i in idxs]
            n_masters = len(idxs)
            n_skus = sum(int(entries[i][0]["sku_count"]) for i in idxs)
            single_cnt = sum(1 for i in idxs if int(entries[i][0]["store_count"]) == 1)
            pct_single = round((single_cnt / max(n_masters, 1)) * 100)

            kw_counts: Counter[str] = Counter()
            for i in idxs:
                kw_counts.update(meaningful_tokens(str(entries[i][0]["title"])))
            top_kw = ", ".join(w for w, _ in kw_counts.most_common(5))

            sims = sub_X[idxs] @ centroids[cid]
            order = np.argsort(-sims)
            samples: list[str] = []
            seen: set[str] = set()
            for pos in list(order[:10]) + list(order[max(0, len(order) // 2) : len(order) // 2 + 6]):
                t = str(entries[idxs[int(pos)]][0]["title"])
                if t.lower() not in seen:
                    seen.add(t.lower())
                    samples.append(t)
                if len(samples) >= 6:
                    break

            row = "\t".join(
                [
                    key,
                    slug,
                    str(n_masters),
                    str(n_skus),
                    f"{pct_single}%",
                    top_kw,
                    " | ".join(samples),
                ]
            )
            cat_rows.append((n_masters, row))

        cat_rows.sort(key=lambda x: x[0], reverse=True)
        lines_out.extend(r for _, r in cat_rows)
        total_clusters += len(cat_rows)
        total_items += len(entries)

    clusters_map_path.parent.mkdir(parents=True, exist_ok=True)
    clusters_map_path.write_text(json.dumps(clusters_map), encoding="utf-8")

    clusters_txt_path.parent.mkdir(parents=True, exist_ok=True)
    with clusters_txt_path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(
            f"=== MICRO-GRUPOS HOMOGÉNEOS POR CATEGORÍA ({total_clusters} GRUPOS · {total_items} MAESTROS) ===\n"
            "Cada grupo pertenece a UNA sola categoría (no mezcla alimentos con aseo o bebés).\n"
            "Instrucciones para el LLM:\n"
            "Revisa cada `cluster_key` y responde ÚNICAMENTE los grupos que deban depurarse en TSV:\n"
            "cluster_key\taccion (EXCLUIR_NO_MERCADO | REVISAR_MIXTO | RECLASIFICAR)\tnuevo_slug_si_aplica\tmotivo_breve\n\n"
            "CATEGORÍAS OFICIALES VÁLIDAS: " + ", ".join(s for s, _ in cats) + "\n\n"
            "cluster_key\tcategoria\tn_masters\tn_skus\tpct_1_tienda\tpalabras_clave\tejemplos_representativos\n"
        )
        for line in lines_out:
            fh.write(line + "\n")

    return {
        "categories_processed": len(by_slug),
        "total_masters_clustered": total_items,
        "total_clusters": total_clusters,
        "output_bytes": clusters_txt_path.stat().st_size,
    }


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser(description="Auditoría semántica local con embeddings y clustering.")
    parser.add_argument("--db", default=str(DEFAULT_LOCAL_DB_PATH))
    parser.add_argument("--clusters", type=int, default=500)
    parser.add_argument("--max-anomalies", type=int, default=2000)
    parser.add_argument("--per-category-only", action="store_true")
    args = parser.parse_args(argv)
    if args.per_category_only:
        st = generate_per_category_clusters(db_path=Path(args.db))
        print("Per-category cluster stats:", st)
        return 0
    st = run_semantic_audit(
        db_path=Path(args.db),
        n_clusters=args.clusters,
        max_anomalies=args.max_anomalies,
    )
    print("Semantic audit stats:", st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
