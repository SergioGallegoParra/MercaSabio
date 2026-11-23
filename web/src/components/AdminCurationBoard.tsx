"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
  EyeOff,
  Flag,
  LayoutGrid,
  Columns4,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Store,
  Unlink,
} from "lucide-react";

import type {
  AdminCatalogBrowseRow,
  AdminCatalogItem,
  AdminCurationPayload,
  AdminStoreCatalogPayload,
  AdminStoreSummaryItem,
  CanonicalCategoryOption,
  ComparisonReportItem,
  CurationReportReason,
  QualityTier,
} from "@/lib/types";

interface AdminCurationBoardProps {
  initialData: AdminCurationPayload;
}

type AdminTab = "inventory" | "reported" | "doubts" | "explorer";
type ExplorerView = "kanban" | "grid";
type StatusFilter = "all" | "needs_review" | "verified" | "provisional_auto" | "excluded";

const TIERS: Array<{ id: QualityTier; label: string; tone: string }> = [
  { id: "economico", label: "Económico", tone: "tier-economico" },
  { id: "estandar", label: "Estándar", tone: "tier-estandar" },
  { id: "premium", label: "Premium", tone: "tier-premium" },
  { id: "especial", label: "Especial", tone: "tier-especial" },
];

const REASON_LABELS: Record<CurationReportReason, string> = {
  distinta_calidad: "Distinta calidad / gama",
  distinto_producto: "No es el mismo producto",
  tamano_incomparable: "Tamaño incomparable",
  otro: "Otro motivo",
};

const copFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const pumFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

function ProductThumb({
  url,
  alt,
  sizeLabel,
}: {
  url: string | null;
  alt: string;
  sizeLabel: string;
}) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={url}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="admin-thumb-img"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="admin-thumb-placeholder" aria-hidden="true">
      <Package size={20} />
      <span>{sizeLabel}</span>
    </div>
  );
}

export default function AdminCurationBoard({ initialData }: AdminCurationBoardProps) {
  const [data, setData] = useState<AdminCurationPayload>(initialData);
  const [activeTab, setActiveTab] = useState<AdminTab>(
    initialData.stats.pendingReports > 0 ? "reported" : "inventory"
  );
  const [explorerView, setExplorerView] = useState<ExplorerView>("kanban");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterBroad, setFilterBroad] = useState("");
  const [filterSubtype, setFilterSubtype] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [showResolvedReports, setShowResolvedReports] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loadingRefresh, setLoadingRefresh] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [draggedSkuId, setDraggedSkuId] = useState<string | null>(null);
  const [dragOverTier, setDragOverTier] = useState<QualityTier | null>(null);

  // Estado del explorador completo de BD por tienda (paginado en servidor)
  const [invSummary, setInvSummary] = useState<AdminStoreSummaryItem[]>([]);
  const [invCategories, setInvCategories] = useState<CanonicalCategoryOption[]>([]);
  const [invItems, setInvItems] = useState<AdminCatalogBrowseRow[]>([]);
  const [invTotalCount, setInvTotalCount] = useState(0);
  const [invLoading, setInvLoading] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);
  const [invStoreId, setInvStoreId] = useState("");
  const [invQueryInput, setInvQueryInput] = useState("");
  const [invQuery, setInvQuery] = useState("");
  const [invCategory, setInvCategory] = useState("");
  const [invStock, setInvStock] = useState<"all" | "in_stock" | "out_of_stock">("all");
  const [invLabel, setInvLabel] = useState<
    "all" | "private_label" | "national" | "with_ean" | "no_ean" | "deprecated_candidate"
  >("all");
  const [invSort, setInvSort] = useState<
    "name_asc" | "price_asc" | "price_desc" | "pum_asc" | "recent"
  >("name_asc");
  const [invPage, setInvPage] = useState(1);
  const [invPageSize, setInvPageSize] = useState(40);
  const invSummaryLoadedRef = useRef(false);

  const loadInventoryPage = useCallback(
    async (opts?: { forceSummary?: boolean; pageOverride?: number; queryOverride?: string }) => {
      setInvLoading(true);
      setInvError(null);
      try {
        const needSummary = Boolean(opts?.forceSummary) || !invSummaryLoadedRef.current;
        const page = opts?.pageOverride ?? invPage;
        const q = (opts?.queryOverride ?? invQuery).trim();
        const params = new URLSearchParams({
          storeId: invStoreId,
          q,
          category: invCategory,
          stock: invStock,
          label: invLabel,
          sort: invSort,
          page: String(page),
          pageSize: String(invPageSize),
          summary: needSummary ? "1" : "0",
        });
        const res = await fetch(`/api/admin/catalog?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as AdminStoreCatalogPayload;
        if (needSummary && Array.isArray(payload.summary) && payload.summary.length > 0) {
          setInvSummary(payload.summary);
          invSummaryLoadedRef.current = true;
        }
        if (Array.isArray(payload.categories) && payload.categories.length > 0) {
          setInvCategories(payload.categories);
        }
        setInvItems(payload.items ?? []);
        setInvTotalCount(payload.totalCount ?? 0);
      } catch {
        setInvError("No se pudo consultar el inventario completo de la base de datos.");
      } finally {
        setInvLoading(false);
      }
    },
    [invStoreId, invQuery, invCategory, invStock, invLabel, invSort, invPage, invPageSize]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setInvQuery(invQueryInput);
      setInvPage(1);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [invQueryInput]);

  useEffect(() => {
    if (activeTab === "inventory" || !invSummaryLoadedRef.current) {
      void loadInventoryPage();
    }
  }, [activeTab, loadInventoryPage]);

  const totalDbSkus = useMemo(
    () => invSummary.reduce((acc, row) => acc + row.totalSkus, 0),
    [invSummary]
  );
  const invTotalPages = Math.max(1, Math.ceil(invTotalCount / invPageSize));

  const itemsBySkuId = useMemo(() => {
    const map = new Map<string, AdminCatalogItem>();
    for (const item of data.items) {
      map.set(item.offer.storeSkuId, item);
    }
    return map;
  }, [data.items]);

  async function refreshBoard(queryOverride?: string) {
    setLoadingRefresh(true);
    try {
      const q = (queryOverride ?? searchQuery).trim();
      const url = q ? `/api/curation?q=${encodeURIComponent(q)}` : "/api/curation";
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const nextPayload = (await res.json()) as AdminCurationPayload;
        setData(nextPayload);
      } else {
        setToast({ kind: "err", text: "No se pudo actualizar el tablero de curación." });
      }
    } catch {
      setToast({ kind: "err", text: "Error de conexión al recargar curación." });
    } finally {
      setLoadingRefresh(false);
    }
  }

  async function runCurationAction(
    key: string,
    body: Record<string, unknown>,
    successMsg: string
  ) {
    setBusyKey(key);
    try {
      const res = await fetch("/api/curation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errPayload = (await res.json().catch(() => ({}))) as { error?: string };
        setToast({
          kind: "err",
          text: errPayload.error ?? "No se pudo guardar el cambio en Supabase.",
        });
        return;
      }
      setToast({ kind: "ok", text: successMsg });
      await refreshBoard();
    } catch {
      setToast({ kind: "err", text: "Error de red aplicando curación." });
    } finally {
      setBusyKey(null);
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeTab === "inventory") {
      setInvQueryInput(searchQuery);
      setInvQuery(searchQuery);
      setInvPage(1);
      void loadInventoryPage({ pageOverride: 1, queryOverride: searchQuery });
      return;
    }
    void refreshBoard(searchQuery);
  }

  const subtypeOptionsForBroad = useMemo(() => {
    if (!filterBroad) return data.subtypeOptions;
    return data.subtypeOptions.filter((s) => s.broadFamily === filterBroad);
  }, [data.subtypeOptions, filterBroad]);

  const filteredReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.reports.filter((rep) => {
      if (!showResolvedReports && rep.status !== "pending") return false;
      if (!q) return true;
      const a = itemsBySkuId.get(rep.anchorSkuId);
      const b = itemsBySkuId.get(rep.comparedSkuId);
      const text = `${a?.offer.rawName ?? ""} ${a?.offer.storeName ?? ""} ${b?.offer.rawName ?? ""} ${b?.offer.storeName ?? ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [data.reports, showResolvedReports, searchQuery, itemsBySkuId]);

  const doubtQueue = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.items
      .filter((item) => item.reviewStatus !== "excluded")
      .filter(
        (item) =>
          item.needsReview ||
          item.reviewStatus === "reported" ||
          item.reviewStatus === "needs_review"
      )
      .filter((item) => {
        if (!q) return true;
        return `${item.offer.rawName} ${item.offer.brand ?? ""} ${item.signature.familyLabel}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => {
        const aRep = a.reviewStatus === "reported" ? 0 : 1;
        const bRep = b.reviewStatus === "reported" ? 0 : 1;
        if (aRep !== bRep) return aRep - bRep;
        return (b.pumRatioVsMedian ?? 0) - (a.pumRatioVsMedian ?? 0);
      });
  }, [data.items, searchQuery]);

  const filteredExplorerItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.items.filter((item) => {
      if (filterStatus === "all") {
        if (item.reviewStatus === "excluded") return false;
      } else if (filterStatus === "needs_review") {
        if (!item.needsReview && item.reviewStatus !== "reported" && item.reviewStatus !== "needs_review") {
          return false;
        }
      } else if (item.reviewStatus !== filterStatus) {
        return false;
      }

      if (filterBroad && item.signature.broadFamily !== filterBroad) return false;
      if (filterSubtype && item.signature.subtypeFamily !== filterSubtype) return false;
      if (filterStore && item.offer.storeId !== filterStore) return false;

      if (q) {
        const hay = `${item.offer.rawName} ${item.offer.brand ?? ""} ${item.signature.familyLabel} ${item.offer.storeName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.items, filterStatus, filterBroad, filterSubtype, filterStore, searchQuery]);

  function renderTierSelector(item: AdminCatalogItem, reportId?: string) {
    return (
      <div className="admin-tier-pills" role="group" aria-label="Elegir gama de calidad">
        {TIERS.map((tier) => {
          const isCurrent = item.qualityTier === tier.id;
          const actionKey = `tier-${item.offer.storeSkuId}-${tier.id}`;
          return (
            <button
              key={tier.id}
              type="button"
              disabled={busyKey === actionKey}
              className={`admin-tier-btn ${tier.tone} ${isCurrent ? "is-active" : ""}`}
              onClick={() =>
                void runCurationAction(
                  actionKey,
                  {
                    action: "set_product_curation",
                    storeSkuId: item.offer.storeSkuId,
                    qualityTier: tier.id,
                    subtype: item.signature.subtypeFamily,
                    broadFamily: item.signature.broadFamily,
                    reportId: reportId ?? null,
                  },
                  `${item.offer.rawName} marcado como gama ${tier.label}.`
                )
              }
            >
              {isCurrent && <Check size={12} />}
              {tier.label}
            </button>
          );
        })}
      </div>
    );
  }

  function renderSubtypeSelect(item: AdminCatalogItem) {
    const actionKey = `sub-${item.offer.storeSkuId}`;
    return (
      <select
        aria-label={`Subtipo de ${item.offer.rawName}`}
        className="admin-subtype-select"
        value={item.signature.subtypeFamily}
        disabled={busyKey === actionKey}
        onChange={(e) => {
          const nextSubtype = e.target.value;
          const meta = data.subtypeOptions.find((s) => s.subtype === nextSubtype);
          void runCurationAction(
            actionKey,
            {
              action: "set_product_curation",
              storeSkuId: item.offer.storeSkuId,
              qualityTier: item.qualityTier,
              subtype: nextSubtype,
              broadFamily: meta?.broadFamily ?? item.signature.broadFamily,
            },
            `Subtipo actualizado a ${meta?.label ?? nextSubtype}.`
          );
        }}
      >
        {!data.subtypeOptions.some((s) => s.subtype === item.signature.subtypeFamily) && (
          <option value={item.signature.subtypeFamily}>
            {item.signature.familyLabel} (auto)
          </option>
        )}
        {data.subtypeOptions.map((opt) => (
          <option key={opt.subtype} value={opt.subtype}>
            {opt.label} ({opt.count})
          </option>
        ))}
      </select>
    );
  }

  function renderDuelSide(
    skuId: string,
    roleLabel: string,
    reportId: string
  ) {
    const item = itemsBySkuId.get(skuId);
    if (!item) {
      return (
        <div className="duel-side duel-side-missing">
          <span className="duel-role-pill">{roleLabel}</span>
          <p className="muted">SKU fuera del lote actual ({skuId.slice(0, 8)}...)</p>
        </div>
      );
    }

    return (
      <div className="duel-side">
        <div className="duel-side-head">
          <span className="duel-role-pill">{roleLabel}</span>
          <span className="admin-store-chip">{item.offer.storeName}</span>
          <span className={`tag tag-tier tag-tier-${item.qualityTier}`}>
            Gama {item.qualityLabel}
          </span>
        </div>

        <div className="duel-product-row">
          <ProductThumb
            url={item.offer.imageUrl}
            alt={item.offer.rawName}
            sizeLabel={`${item.offer.netContent} ${item.offer.unitMeasure}`}
          />
          <div className="duel-product-info">
            <h3 className="admin-card-title">{item.offer.rawName}</h3>
            <div className="admin-meta-line tabular">
              <strong>{copFormatter.format(item.offer.calibratedPrice)}</strong>
              <span>·</span>
              <span>
                {pumFormatter.format(item.signature.effectivePum)} /{" "}
                {item.signature.effectiveUnitMeasure}
              </span>
              <span>·</span>
              <span>
                {item.offer.netContent} {item.offer.unitMeasure}
              </span>
            </div>
            <div className="admin-submeta-line">
              <span>{item.signature.familyLabel}</span>
              {item.criticalAttribute && (
                <span className="admin-attr-chip">{item.criticalAttribute}</span>
              )}
            </div>
          </div>
        </div>

        <div className="duel-quick-controls">
          {renderTierSelector(item, reportId)}
          {renderSubtypeSelect(item)}
        </div>
      </div>
    );
  }

  function renderReportCard(rep: ComparisonReportItem) {
    const anchorItem = itemsBySkuId.get(rep.anchorSkuId);
    const comparedItem = itemsBySkuId.get(rep.comparedSkuId);
    const anchorPum = anchorItem?.signature.effectivePum ?? 0;
    const compPum = comparedItem?.signature.effectivePum ?? 0;
    const spreadRatio =
      anchorPum > 0 && compPum > 0
        ? Math.max(anchorPum / compPum, compPum / anchorPum).toFixed(2)
        : null;

    return (
      <article
        key={rep.id}
        className={`duel-card ${rep.status !== "pending" ? "is-resolved" : ""}`}
      >
        <header className="duel-card-header">
          <div className="duel-badges">
            <span className="tag tag-shrinkflation">
              <Flag size={12} /> {REASON_LABELS[rep.reportReason]}
            </span>
            <span className="meta-pill tabular">
              {rep.reportCount} {rep.reportCount === 1 ? "reporte" : "reportes"}
            </span>
            {spreadRatio && (
              <span className="meta-pill tabular">
                Diferencia PUM: {spreadRatio}x
              </span>
            )}
            {rep.status !== "pending" && (
              <span className="tag tag-best">Estado: {rep.status}</span>
            )}
          </div>

          <div className="duel-actions-top">
            <button
              type="button"
              className="admin-btn-danger"
              disabled={busyKey === `block-${rep.id}`}
              onClick={() =>
                void runCurationAction(
                  `block-${rep.id}`,
                  {
                    action: "set_pair_rule",
                    storeSkuId: rep.anchorSkuId,
                    secondSkuId: rep.comparedSkuId,
                    ruleType: "blocked_pair",
                    reportId: rep.id,
                    notes: `Bloqueado desde reporte (${rep.reportReason})`,
                  },
                  "Cruce bloqueado permanentemente; nunca volverán a compararse."
                )
              }
            >
              <Ban size={14} /> Bloquear cruce
            </button>
            <button
              type="button"
              className="admin-btn-success"
              disabled={busyKey === `approve-${rep.id}`}
              onClick={() =>
                void runCurationAction(
                  `approve-${rep.id}`,
                  {
                    action: "set_pair_rule",
                    storeSkuId: rep.anchorSkuId,
                    secondSkuId: rep.comparedSkuId,
                    ruleType: "approved_same_tier",
                    reportId: rep.id,
                    notes: "Cruce aprobado manualmente como comparable",
                  },
                  "Cruce validado como comparable justo."
                )
              }
            >
              <CheckCircle2 size={14} /> Aprobar cruce
            </button>
            <button
              type="button"
              className="admin-btn-ghost"
              disabled={busyKey === `dismiss-${rep.id}`}
              onClick={() =>
                void runCurationAction(
                  `dismiss-${rep.id}`,
                  { action: "dismiss_report", reportId: rep.id },
                  "Reporte descartado."
                )
              }
            >
              Descartar
            </button>
          </div>
        </header>

        <div className="duel-grid">
          {renderDuelSide(rep.anchorSkuId, "Producto base", rep.id)}
          <div className="duel-vs-divider" aria-hidden="true">
            VS
          </div>
          {renderDuelSide(rep.comparedSkuId, "Comparado", rep.id)}
        </div>
      </article>
    );
  }

  return (
    <div className="admin-shell">
      <header className="site-navbar">
        <div className="navbar-inner">
          <Link href="/" className="admin-back-link">
            <ArrowLeft size={16} />
            <span>Volver al comparador</span>
          </Link>

          <form className="navbar-search-form" onSubmit={handleSearchSubmit}>
            <div className="search-input-wrap">
              <Search size={16} className="search-icon" />
              <input
                type="search"
                className="search-input navbar-search-input"
                maxLength={80}
                placeholder="Filtrar productos por nombre, marca o familia..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn-primary navbar-search-submit"
              disabled={loadingRefresh}
            >
              Buscar
            </button>
          </form>

          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              void refreshBoard();
              void loadInventoryPage({ forceSummary: true });
            }}
            disabled={loadingRefresh || invLoading}
          >
            <RefreshCw size={15} className={loadingRefresh || invLoading ? "spin" : ""} />
            Recargar
          </button>
        </div>
      </header>

      <main className="admin-container">
        <section className="admin-hero">
          <div>
            <span className="hero-badge">
              <Sparkles size={12} /> Curación visual de calidad y equivalencias
            </span>
            <h1 className="admin-h1">Centro de Curación y Gamas de Calidad</h1>
            <p className="hero-sub">
              Corrige cruces injustos con tarjetas visuales de duelo, resuelve dudas automáticas
              cercanas a 2x en PUM o explora categorías de forma proactiva arrastrando productos entre gamas.
            </p>
          </div>

          <div className="admin-kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Reportes pendientes</span>
              <strong className="kpi-value tabular">{data.stats.pendingReports}</strong>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Dudas algoritmo</span>
              <strong className="kpi-value tabular">{data.stats.doubtCount}</strong>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Verificados</span>
              <strong className="kpi-value tabular">{data.stats.verifiedCount}</strong>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Catálogo en BD</span>
              <strong className="kpi-value tabular">
                {totalDbSkus > 0 ? totalDbSkus.toLocaleString("es-CO") : data.stats.totalActive}
              </strong>
            </div>
          </div>
        </section>

        {toast && (
          <div
            className={`admin-toast ${toast.kind === "err" ? "is-error" : "is-ok"}`}
            role="status"
          >
            <span>{toast.text}</span>
            <button type="button" onClick={() => setToast(null)}>
              Cerrar
            </button>
          </div>
        )}

        <nav className="admin-tabs" aria-label="Vistas de curación">
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === "inventory" ? "is-active" : ""}`}
            onClick={() => setActiveTab("inventory")}
          >
            <Database size={15} />
            Inventario por Tienda (BD)
            <span className="tab-count tabular">
              {totalDbSkus > 0 ? totalDbSkus.toLocaleString("es-CO") : "—"}
            </span>
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === "reported" ? "is-active" : ""}`}
            onClick={() => setActiveTab("reported")}
          >
            <Flag size={15} />
            Reportados por usuarios
            <span className="tab-count tabular">{data.stats.pendingReports}</span>
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === "doubts" ? "is-active" : ""}`}
            onClick={() => setActiveTab("doubts")}
          >
            <AlertTriangle size={15} />
            Dudas del algoritmo
            <span className="tab-count tabular">{doubtQueue.length}</span>
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === "explorer" ? "is-active" : ""}`}
            onClick={() => setActiveTab("explorer")}
          >
            <Columns4 size={15} />
            Explorador Proactivo y Tablero 4 Gamas
            <span className="tab-count tabular">{filteredExplorerItems.length}</span>
          </button>
        </nav>

        {activeTab === "inventory" && (
          <section className="admin-section" aria-label="Inventario completo por supermercado">
            <div className="admin-section-toolbar">
              <p className="muted">
                Vista completa y paginada de todos los SKUs registrados en Supabase por cada una
                de las 12 cadenas. Haz clic en una tienda para auditar sus productos, categorías y
                códigos EAN.
              </p>
            </div>

            {/* Tarjetas de resumen de cobertura por tienda */}
            <div className="admin-store-summary-grid">
              <button
                type="button"
                className={`admin-store-sum-card ${invStoreId === "" ? "is-selected" : ""}`}
                onClick={() => {
                  setInvStoreId("");
                  setInvPage(1);
                }}
              >
                <div className="admin-store-sum-head">
                  <span className="admin-store-chip">
                    <Store size={12} /> Todas las tiendas
                  </span>
                  <span className="admin-cov-badge is-ok">12 cadenas</span>
                </div>
                <strong className="admin-store-sum-count tabular">
                  {totalDbSkus.toLocaleString("es-CO")} productos
                </strong>
                <span className="muted" style={{ fontSize: "0.75rem" }}>
                  Vista combinada de toda la base de datos
                </span>
              </button>

              {invSummary.map((st) => {
                const catPct =
                  st.totalSkus > 0 ? Math.round((st.categorizedSkus / st.totalSkus) * 100) : 0;
                const eanPct =
                  st.totalSkus > 0 ? Math.round((st.withEanSkus / st.totalSkus) * 100) : 0;
                const covClass =
                  st.totalSkus >= 500 ? "is-ok" : st.totalSkus >= 150 ? "is-mid" : "is-low";
                const covLabel =
                  st.totalSkus >= 500 ? "Catálogo amplio" : st.totalSkus >= 150 ? "Parcial" : "Base inicial";
                return (
                  <button
                    key={st.storeId}
                    type="button"
                    className={`admin-store-sum-card ${invStoreId === st.storeId ? "is-selected" : ""}`}
                    onClick={() => {
                      setInvStoreId(st.storeId);
                      setInvPage(1);
                    }}
                  >
                    <div className="admin-store-sum-head">
                      <span className="admin-store-chip">{st.storeName}</span>
                      <span className={`admin-cov-badge ${covClass}`}>{covLabel}</span>
                    </div>
                    <strong className="admin-store-sum-count tabular">
                      {st.totalSkus.toLocaleString("es-CO")} SKUs
                    </strong>
                    <span className="muted tabular" style={{ fontSize: "0.74rem" }}>
                      Cat. {catPct}% · EAN {eanPct}% · Propias {st.privateLabelSkus.toLocaleString("es-CO")}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Barra de filtros paginados en servidor */}
            <div className="admin-inv-filters">
              <div className="admin-inv-search-wrap">
                <Search size={15} className="search-icon" />
                <input
                  type="search"
                  className="search-input"
                  aria-label="Buscar producto, marca, EAN o SKU en inventario"
                  placeholder="Nombre, marca, código EAN o SKU..."
                  value={invQueryInput}
                  onChange={(e) => {
                    setInvQueryInput(e.target.value);
                  }}
                />
              </div>

              <select
                aria-label="Filtrar inventario por tienda"
                value={invStoreId}
                onChange={(e) => {
                  setInvStoreId(e.target.value);
                  setInvPage(1);
                }}
              >
                <option value="">Todas las tiendas (12)</option>
                {invSummary.map((st) => (
                  <option key={st.storeId} value={st.storeId}>
                    {st.storeName} ({st.totalSkus.toLocaleString("es-CO")})
                  </option>
                ))}
              </select>

              <select
                aria-label="Filtrar inventario por categoría"
                value={invCategory}
                onChange={(e) => {
                  setInvCategory(e.target.value);
                  setInvPage(1);
                }}
              >
                <option value="">Todas las categorías</option>
                <option value="__uncategorized__">⚠ Sin categoría asignada</option>
                {invCategories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filtrar inventario por stock"
                value={invStock}
                onChange={(e) => {
                  setInvStock(e.target.value as "all" | "in_stock" | "out_of_stock");
                  setInvPage(1);
                }}
              >
                <option value="all">Stock: Todos</option>
                <option value="in_stock">Solo en stock</option>
                <option value="out_of_stock">Solo agotados</option>
              </select>

              <select
                aria-label="Filtrar por tipo de marca o EAN"
                value={invLabel}
                onChange={(e) => {
                  setInvLabel(
                    e.target.value as
                      | "all"
                      | "private_label"
                      | "national"
                      | "with_ean"
                      | "no_ean"
                      | "deprecated_candidate"
                  );
                  setInvPage(1);
                }}
              >
                <option value="all">Marca / EAN: Todos</option>
                <option value="private_label">Solo marca propia</option>
                <option value="national">Solo marca nacional</option>
                <option value="with_ean">Con código EAN</option>
                <option value="no_ean">Sin código EAN</option>
                <option value="deprecated_candidate">Posible baja · Sin foto</option>
              </select>

              <select
                aria-label="Ordenar inventario"
                value={invSort}
                onChange={(e) => {
                  setInvSort(
                    e.target.value as
                      | "name_asc"
                      | "price_asc"
                      | "price_desc"
                      | "pum_asc"
                      | "recent"
                  );
                  setInvPage(1);
                }}
              >
                <option value="name_asc">Nombre A–Z</option>
                <option value="price_asc">Menor precio</option>
                <option value="price_desc">Mayor precio</option>
                <option value="pum_asc">Menor PUM</option>
                <option value="recent">Más reciente</option>
              </select>

              <select
                aria-label="Resultados por página"
                value={invPageSize}
                onChange={(e) => {
                  setInvPageSize(Number(e.target.value));
                  setInvPage(1);
                }}
              >
                <option value={25}>25 / pág</option>
                <option value={40}>40 / pág</option>
                <option value={60}>60 / pág</option>
                <option value={100}>100 / pág</option>
              </select>

              {(invStoreId ||
                invQueryInput ||
                invCategory ||
                invStock !== "all" ||
                invLabel !== "all" ||
                invSort !== "name_asc") && (
                <button
                  type="button"
                  className="admin-btn-ghost"
                  onClick={() => {
                    setInvStoreId("");
                    setInvQueryInput("");
                    setInvQuery("");
                    setInvCategory("");
                    setInvStock("all");
                    setInvLabel("all");
                    setInvSort("name_asc");
                    setInvPage(1);
                  }}
                >
                  Limpiar filtros
                </button>
              )}
            </div>

            {/* Paginación superior */}
            <div className="admin-pagination-bar">
              <span className="muted tabular">
                {invLoading
                  ? "Consultando base de datos..."
                  : invTotalCount === 0
                    ? "0 productos coinciden con los filtros"
                    : `Mostrando ${((invPage - 1) * invPageSize + 1).toLocaleString("es-CO")}–${Math.min(invPage * invPageSize, invTotalCount).toLocaleString("es-CO")} de ${invTotalCount.toLocaleString("es-CO")} productos`}
              </span>
              <div className="admin-pagination-controls">
                <button
                  type="button"
                  className="admin-btn-ghost"
                  disabled={invLoading || invPage <= 1}
                  onClick={() => setInvPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={14} /> Anterior
                </button>
                <span className="tabular" style={{ fontSize: "0.82rem", fontWeight: 700 }}>
                  Página {invPage} de {invTotalPages.toLocaleString("es-CO")}
                </span>
                <button
                  type="button"
                  className="admin-btn-ghost"
                  disabled={invLoading || invPage >= invTotalPages}
                  onClick={() => setInvPage((p) => Math.min(invTotalPages, p + 1))}
                >
                  Siguiente <ChevronRight size={14} />
                </button>
              </div>
            </div>

            {invError ? (
              <div className="empty-box">
                <AlertTriangle size={26} />
                <h3>Error cargando inventario</h3>
                <p>{invError}</p>
              </div>
            ) : !invLoading && invItems.length === 0 ? (
              <div className="empty-box">
                <Package size={26} />
                <h3>Sin resultados</h3>
                <p>Prueba cambiando el filtro de tienda, categoría o término de búsqueda.</p>
              </div>
            ) : (
              <div className="admin-inv-table-wrap">
                <table className="admin-inv-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Tienda</th>
                      <th>Categoría</th>
                      <th>Contenido</th>
                      <th>Precio / PUM</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invItems.map((row) => {
                      const safeHref =
                        row.rawUrl && /^https?:\/\//i.test(row.rawUrl) ? row.rawUrl : null;
                      return (
                        <tr key={row.storeSkuId}>
                          <td>
                            <div className="admin-inv-prod-cell">
                              <ProductThumb
                                url={row.imageUrl}
                                alt={row.rawName}
                                sizeLabel={`${row.netContent} ${row.unitMeasure}`}
                              />
                              <div className="admin-inv-prod-meta">
                                <div className="admin-inv-prod-title">
                                  <strong title={row.rawName}>
                                    {row.displayName || row.rawName}
                                  </strong>
                                  {safeHref && (
                                    <a
                                      href={safeHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      aria-label={`Abrir ${row.displayName || row.rawName} en ${row.storeName}`}
                                      className="admin-ext-link"
                                    >
                                      <ExternalLink size={12} />
                                    </a>
                                  )}
                                </div>
                                <div className="admin-inv-prod-sub tabular">
                                  <span>{row.brand || "Sin marca"}</span>
                                  {row.isPrivateLabel && (
                                    <span className="admin-cov-badge is-mid">Marca propia</span>
                                  )}
                                  {row.subPresentationLabel && (
                                    <span className="admin-cov-badge is-ok">
                                      {row.subPresentationLabel}
                                    </span>
                                  )}
                                  <span>EAN: {row.ean || "—"}</span>
                                  <span>SKU: {row.externalSku}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="admin-store-chip">{row.storeName}</span>
                          </td>
                          <td>
                            {row.canonicalName ? (
                              <span className="admin-cov-badge is-ok">{row.canonicalName}</span>
                            ) : (
                              <span className="admin-cov-badge is-low">Sin categoría</span>
                            )}
                          </td>
                          <td className="tabular">
                            {row.netContent} {row.unitMeasure}
                          </td>
                          <td className="tabular">
                            <strong>{copFormatter.format(row.calibratedPrice)}</strong>
                            <div className="muted" style={{ fontSize: "0.75rem" }}>
                              {pumFormatter.format(row.pumPrice)} / {row.unitMeasure}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`admin-cov-badge ${row.inStock ? "is-ok" : "is-low"}`}
                            >
                              {row.inStock ? "En stock" : "Agotado"}
                            </span>
                            {row.isDeprecatedCandidate && (
                              <div style={{ marginTop: 4 }}>
                                <span
                                  className="admin-cov-badge is-mid"
                                  title="Oculto al cliente por falta de imagen de referencia (posible versión desactualizada)"
                                >
                                  Posible baja · Sin foto
                                </span>
                              </div>
                            )}
                            <div className="muted" style={{ fontSize: "0.72rem", marginTop: 2 }}>
                              {row.sourceOrigin}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Paginación inferior */}
            {invTotalCount > invPageSize && (
              <div className="admin-pagination-bar" style={{ marginTop: 12 }}>
                <span className="muted tabular">
                  Página {invPage} de {invTotalPages.toLocaleString("es-CO")}
                </span>
                <div className="admin-pagination-controls">
                  <button
                    type="button"
                    className="admin-btn-ghost"
                    disabled={invLoading || invPage <= 1}
                    onClick={() => setInvPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={14} /> Anterior
                  </button>
                  <button
                    type="button"
                    className="admin-btn-ghost"
                    disabled={invLoading || invPage >= invTotalPages}
                    onClick={() => setInvPage((p) => Math.min(invTotalPages, p + 1))}
                  >
                    Siguiente <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "reported" && (
          <section className="admin-section">
            <div className="admin-section-toolbar">
              <p className="muted">
                Cada tarjeta compara visualmente los dos productos reportados lado a lado.
                Puedes reasignar su gama con un clic o bloquear el cruce definitivamente.
              </p>
              <label className="admin-checkbox-label">
                <input
                  type="checkbox"
                  checked={showResolvedReports}
                  onChange={(e) => setShowResolvedReports(e.target.checked)}
                />
                Mostrar resueltos o descartados
              </label>
            </div>

            {filteredReports.length === 0 ? (
              <div className="empty-box">
                <CheckCircle2 size={28} />
                <h3>Sin reportes pendientes</h3>
                <p>
                  Cuando un usuario pulse &ldquo;¿Comparación injusta?&rdquo; en una tarjeta del
                  comparador, el duelo visual aparecerá aquí automáticamente.
                </p>
              </div>
            ) : (
              <div className="duel-list">{filteredReports.map(renderReportCard)}</div>
            )}
          </section>
        )}

        {activeTab === "doubts" && (
          <section className="admin-section">
            <div className="admin-section-toolbar">
              <p className="muted">
                Productos puestos en categoría/gama provisional porque su nombre y su PUM se
                contradicen o rondan el límite 1.65x–2.0x de la mediana.
              </p>
            </div>

            {doubtQueue.length === 0 ? (
              <div className="empty-box">
                <ShieldAlert size={28} />
                <h3>Cola de dudas limpia</h3>
                <p>No hay conflictos automáticos pendientes para la búsqueda actual.</p>
              </div>
            ) : (
              <div className="doubt-grid">
                {doubtQueue.map((item) => {
                  const ratio = item.pumRatioVsMedian ?? 1;
                  const barPct = Math.min(100, Math.max(12, Math.round((ratio / 2.5) * 100)));
                  const confirmKey = `confirm-${item.offer.storeSkuId}`;
                  const excludeKey = `exclude-${item.offer.storeSkuId}`;
                  return (
                    <article key={item.offer.storeSkuId} className="admin-doubt-card">
                      <div className="admin-doubt-top">
                        <ProductThumb
                          url={item.offer.imageUrl}
                          alt={item.offer.rawName}
                          sizeLabel={`${item.offer.netContent} ${item.offer.unitMeasure}`}
                        />
                        <div className="admin-doubt-info">
                          <div className="admin-doubt-badges">
                            <span className="admin-store-chip">{item.offer.storeName}</span>
                            <span className={`tag tag-tier tag-tier-${item.qualityTier}`}>
                              Provisional: {item.qualityLabel}
                            </span>
                          </div>
                          <h3 className="admin-card-title">{item.offer.rawName}</h3>
                          <div className="admin-meta-line tabular">
                            <strong>{copFormatter.format(item.offer.calibratedPrice)}</strong>
                            <span>·</span>
                            <span>
                              {pumFormatter.format(item.signature.effectivePum)} /{" "}
                              {item.signature.effectiveUnitMeasure}
                            </span>
                            {item.subtypeMedianPum && (
                              <span>
                                · Mediana {pumFormatter.format(item.subtypeMedianPum)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {item.doubtReason && (
                        <div className="admin-doubt-reason">
                          <AlertTriangle size={13} />
                          <span>{item.doubtReason}</span>
                        </div>
                      )}

                      {item.pumRatioVsMedian !== null && (
                        <div className="admin-median-meter">
                          <div className="admin-median-labels tabular">
                            <span>Posición PUM vs. mediana de subtipo</span>
                            <strong>{item.pumRatioVsMedian}x</strong>
                          </div>
                          <div className="admin-median-track">
                            <div
                              className={`admin-median-fill ${ratio >= 1.65 ? "is-high" : ratio <= 0.75 ? "is-low" : ""}`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="admin-card-controls">
                        {renderTierSelector(item)}
                        <div className="admin-bottom-row">
                          {renderSubtypeSelect(item)}
                          <div className="admin-card-action-pair">
                            <button
                              type="button"
                              className="admin-btn-success"
                              disabled={busyKey === confirmKey}
                              onClick={() =>
                                void runCurationAction(
                                  confirmKey,
                                  {
                                    action: "set_product_curation",
                                    storeSkuId: item.offer.storeSkuId,
                                    qualityTier: item.qualityTier,
                                    subtype: item.signature.subtypeFamily,
                                    broadFamily: item.signature.broadFamily,
                                  },
                                  `${item.offer.rawName} verificado en gama ${item.qualityLabel}.`
                                )
                              }
                            >
                              <Check size={13} /> Confirmar
                            </button>
                            <button
                              type="button"
                              className="admin-btn-ghost"
                              disabled={busyKey === excludeKey}
                              onClick={() =>
                                void runCurationAction(
                                  excludeKey,
                                  {
                                    action: "exclude_sku",
                                    storeSkuId: item.offer.storeSkuId,
                                    notes: "Excluido desde cola de dudas",
                                  },
                                  `${item.offer.rawName} excluido del comparador.`
                                )
                              }
                            >
                              <EyeOff size={13} /> Excluir
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === "explorer" && (
          <section className="admin-section">
            <div className="admin-explorer-filters">
              <select
                aria-label="Filtrar por familia"
                value={filterBroad}
                onChange={(e) => {
                  setFilterBroad(e.target.value);
                  setFilterSubtype("");
                }}
              >
                <option value="">Todas las familias ({data.broadFamilies.length})</option>
                {data.broadFamilies.map((f) => (
                  <option key={f.broadFamily} value={f.broadFamily}>
                    {f.label} ({f.count})
                  </option>
                ))}
              </select>

              <select
                aria-label="Filtrar por subtipo"
                value={filterSubtype}
                onChange={(e) => setFilterSubtype(e.target.value)}
              >
                <option value="">Todos los subtipos ({subtypeOptionsForBroad.length})</option>
                {subtypeOptionsForBroad.map((s) => (
                  <option key={s.subtype} value={s.subtype}>
                    {s.label} ({s.count})
                  </option>
                ))}
              </select>

              <select
                aria-label="Filtrar por cadena"
                value={filterStore}
                onChange={(e) => setFilterStore(e.target.value)}
              >
                <option value="">Todas las cadenas</option>
                {data.stores.map((st) => (
                  <option key={st.slug} value={st.slug}>
                    {st.name} ({st.count})
                  </option>
                ))}
              </select>

              <select
                aria-label="Filtrar por estado de revisión"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as StatusFilter)}
              >
                <option value="all">Activos (todos)</option>
                <option value="needs_review">Con dudas o reportados</option>
                <option value="verified">Solo verificados</option>
                <option value="provisional_auto">Automáticos provisionales</option>
                <option value="excluded">Excluidos ({data.stats.excludedCount})</option>
              </select>

              <div className="admin-view-switch" role="group" aria-label="Vista del explorador">
                <button
                  type="button"
                  className={explorerView === "kanban" ? "is-active" : ""}
                  onClick={() => setExplorerView("kanban")}
                >
                  <Columns4 size={14} /> Tablero 4 Gamas
                </button>
                <button
                  type="button"
                  className={explorerView === "grid" ? "is-active" : ""}
                  onClick={() => setExplorerView("grid")}
                >
                  <LayoutGrid size={14} /> Cuadrícula y Cruces
                </button>
              </div>
            </div>

            {explorerView === "kanban" ? (
              <div className="kanban-board">
                {TIERS.map((col) => {
                  const colItems = filteredExplorerItems
                    .filter((i) => i.qualityTier === col.id)
                    .slice(0, 60);
                  return (
                    <div
                      key={col.id}
                      className={`kanban-column ${dragOverTier === col.id ? "is-drag-over" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragOverTier !== col.id) setDragOverTier(col.id);
                      }}
                      onDragLeave={() => setDragOverTier(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverTier(null);
                        const droppedSkuId =
                          e.dataTransfer.getData("text/plain") || draggedSkuId;
                        setDraggedSkuId(null);
                        if (!droppedSkuId) return;
                        const droppedItem = itemsBySkuId.get(droppedSkuId);
                        if (!droppedItem || droppedItem.qualityTier === col.id) return;
                        void runCurationAction(
                          `drop-${droppedSkuId}-${col.id}`,
                          {
                            action: "set_product_curation",
                            storeSkuId: droppedSkuId,
                            qualityTier: col.id,
                            subtype: droppedItem.signature.subtypeFamily,
                            broadFamily: droppedItem.signature.broadFamily,
                          },
                          `${droppedItem.offer.rawName} movido a gama ${col.label}.`
                        );
                      }}
                    >
                      <header className={`kanban-col-header ${col.tone}`}>
                        <span>{col.label}</span>
                        <span className="kanban-count tabular">
                          {filteredExplorerItems.filter((i) => i.qualityTier === col.id).length}
                        </span>
                      </header>

                      <div className="kanban-col-list">
                        {colItems.length === 0 ? (
                          <p className="kanban-empty">
                            Arrastra aquí un producto o usa los botones rápidos de gama.
                          </p>
                        ) : (
                          colItems.map((item) => (
                            <article
                              key={item.offer.storeSkuId}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", item.offer.storeSkuId);
                                setDraggedSkuId(item.offer.storeSkuId);
                              }}
                              onDragEnd={() => {
                                setDraggedSkuId(null);
                                setDragOverTier(null);
                              }}
                              className={`kanban-card ${item.needsReview ? "has-doubt" : ""}`}
                            >
                              <div className="kanban-card-top">
                                <ProductThumb
                                  url={item.offer.imageUrl}
                                  alt={item.offer.rawName}
                                  sizeLabel={`${item.offer.netContent} ${item.offer.unitMeasure}`}
                                />
                                <div className="kanban-card-info">
                                  <div className="kanban-card-chips">
                                    <span className="admin-store-chip">
                                      {item.offer.storeName}
                                    </span>
                                    {item.reviewStatus === "verified" && (
                                      <span className="tag tag-best">Verificado</span>
                                    )}
                                    {item.needsReview && item.reviewStatus !== "verified" && (
                                      <span className="tag tag-doubt">Duda</span>
                                    )}
                                  </div>
                                  <h4 className="kanban-card-title">{item.offer.rawName}</h4>
                                  <div className="admin-meta-line tabular">
                                    <strong>{copFormatter.format(item.offer.calibratedPrice)}</strong>
                                    <span>·</span>
                                    <span>
                                      {pumFormatter.format(item.signature.effectivePum)} /{" "}
                                      {item.signature.effectiveUnitMeasure}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="kanban-card-controls">
                                {renderTierSelector(item)}
                                {renderSubtypeSelect(item)}
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="admin-explorer-grid">
                {filteredExplorerItems.slice(0, 80).map((item) => (
                  <article key={item.offer.storeSkuId} className="admin-grid-card">
                    <div className="admin-doubt-top">
                      <ProductThumb
                        url={item.offer.imageUrl}
                        alt={item.offer.rawName}
                        sizeLabel={`${item.offer.netContent} ${item.offer.unitMeasure}`}
                      />
                      <div className="admin-doubt-info">
                        <div className="admin-doubt-badges">
                          <span className="admin-store-chip">{item.offer.storeName}</span>
                          <span className={`tag tag-tier tag-tier-${item.qualityTier}`}>
                            {item.qualityLabel}
                          </span>
                          {item.reviewStatus === "verified" && (
                            <span className="tag tag-best">Verificado</span>
                          )}
                        </div>
                        <h3 className="admin-card-title">{item.offer.rawName}</h3>
                        <div className="admin-meta-line tabular">
                          <strong>{copFormatter.format(item.offer.calibratedPrice)}</strong>
                          <span>·</span>
                          <span>
                            {pumFormatter.format(item.signature.effectivePum)} /{" "}
                            {item.signature.effectiveUnitMeasure}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="admin-card-controls">
                      {renderTierSelector(item)}
                      {renderSubtypeSelect(item)}
                    </div>

                    {(item.directMatches.length > 0 || item.similarMatches.length > 0) && (
                      <div className="admin-matches-box">
                        <div className="admin-matches-title">Cruces activos en el comparador:</div>
                        {[...item.directMatches, ...item.similarMatches].map((m) => (
                          <div key={m.storeSkuId} className="admin-match-row">
                            <div className="admin-match-text">
                              <span className="admin-store-chip">{m.storeName}</span>
                              <span>{m.productTitle}</span>
                              <span className="muted tabular">
                                ({pumFormatter.format(m.pum)}/{m.unitMeasure})
                              </span>
                            </div>
                            <button
                              type="button"
                              className="admin-unlink-btn"
                              disabled={busyKey === `unlink-${item.offer.storeSkuId}-${m.storeSkuId}`}
                              onClick={() =>
                                void runCurationAction(
                                  `unlink-${item.offer.storeSkuId}-${m.storeSkuId}`,
                                  {
                                    action: "set_pair_rule",
                                    storeSkuId: item.offer.storeSkuId,
                                    secondSkuId: m.storeSkuId,
                                    ruleType: "blocked_pair",
                                    notes: "Desvinculado proactivamente desde /admin",
                                  },
                                  `Cruce desvinculado entre ${item.offer.storeName} y ${m.storeName}.`
                                )
                              }
                            >
                              <Unlink size={12} /> Desvincular
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}

            {data.pairRules.length > 0 && (
              <details className="admin-rules-details">
                <summary>
                  Reglas de pares guardadas ({data.pairRules.length}) — clic para gestionar
                </summary>
                <div className="admin-rules-list">
                  {data.pairRules.map((rule) => {
                    const a = itemsBySkuId.get(rule.skuAId);
                    const b = itemsBySkuId.get(rule.skuBId);
                    return (
                      <div key={rule.id} className="admin-rule-item">
                        <span>
                          <strong>{rule.ruleType}</strong>:{" "}
                          {a?.offer.rawName ?? rule.skuAId.slice(0, 8)} ({a?.offer.storeName ?? "—"}){" "}
                          ↔ {b?.offer.rawName ?? rule.skuBId.slice(0, 8)} ({b?.offer.storeName ?? "—"})
                        </span>
                        <button
                          type="button"
                          className="admin-btn-ghost"
                          onClick={() =>
                            void runCurationAction(
                              `rm-rule-${rule.id}`,
                              {
                                action: "remove_pair_rule",
                                storeSkuId: rule.skuAId,
                                secondSkuId: rule.skuBId,
                              },
                              "Regla de cruce eliminada."
                            )
                          }
                        >
                          Restaurar cruce
                        </button>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
