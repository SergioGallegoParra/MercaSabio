"use client";

import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Scale,
  Search,
  Tag,
} from "lucide-react";

import type { CompareMode, ComparisonGroup, DashboardPayload } from "@/lib/types";

const copFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const pumFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface PriceComparatorProps {
  initialData: DashboardPayload;
}

export default function PriceComparator({ initialData }: PriceComparatorProps) {
  const [payload, setPayload] = useState<DashboardPayload>(initialData);
  const [mode, setMode] = useState<CompareMode>("ean");
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const groups: ComparisonGroup[] = mode === "ean" ? payload.eanGroups : payload.pumGroups;

  async function fetchFiltered(nextQuery: string, nextCategory: string) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      if (nextQuery.trim()) {
        params.set("q", nextQuery.trim());
      }
      if (nextCategory) {
        params.set("category", nextCategory);
      }
      const res = await fetch(`/api/search?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Error HTTP ${res.status}`);
      }
      const nextPayload = (await res.json()) as DashboardPayload;
      setPayload(nextPayload);
    } catch {
      setErrorMsg("No fue posible actualizar la búsqueda. Intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void fetchFiltered(query, selectedCategory);
  }

  function handleCategoryClick(slug: string) {
    const next = selectedCategory === slug ? "" : slug;
    setSelectedCategory(next);
    void fetchFiltered(query, next);
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="hero-top">
          <div>
            <span className="hero-badge">
              <RefreshCw size={13} />
              ISR cada 6 horas · Supavisor puerto 6543
            </span>
            <h1>Comparador de Precios Retail Colombia</h1>
            <p>
              Homologación por código EAN-13 y comparación por Precio por Unidad de Medida (PUM)
              entre supermercados tradicionales, hard discount y agregadores calibrados.
            </p>
          </div>

          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label">Cadenas</div>
              <div className="kpi-value tabular">{payload.storesCount}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">SKUs Activos</div>
              <div className="kpi-value tabular">{payload.totalSkus}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Comparativas</div>
              <div className="kpi-value tabular">{groups.length}</div>
            </div>
          </div>
        </div>
      </section>

      {payload.isDemoData && (
        <div className="demo-banner" role="status">
          <AlertTriangle size={18} />
          <span>
            Mostrando datos de demostración locales. Configura <code>DATABASE_URL</code> (puerto
            6543 de Supavisor) para consultar <code>v_latest_prices</code> en Supabase.
          </span>
        </div>
      )}

      <section className="controls-panel" aria-label="Controles de búsqueda y comparación">
        <form className="search-row" onSubmit={handleSearchSubmit}>
          <div className="search-input-wrap">
            <Search size={17} className="search-icon" />
            <input
              type="search"
              className="search-input"
              placeholder="Buscar por producto, marca o código EAN (ej. arroz, leche, 7702001001234)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </form>

        <div className="mode-switch" role="tablist" aria-label="Modo de comparación">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "ean"}
            className={`mode-btn ${mode === "ean" ? "active" : ""}`}
            onClick={() => setMode("ean")}
          >
            <Tag size={16} />
            Comparar misma marca (EAN)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "pum"}
            className={`mode-btn ${mode === "pum" ? "active" : ""}`}
            onClick={() => setMode("pum")}
          >
            <Scale size={16} />
            Comparar equivalente más barato por gramo/ml (Marca Propia)
          </button>
        </div>

        {payload.categories.length > 0 && (
          <div className="category-pills" aria-label="Categorías canónicas">
            <button
              type="button"
              className={`pill ${selectedCategory === "" ? "active" : ""}`}
              onClick={() => handleCategoryClick("")}
            >
              Todas las categorías
            </button>
            {payload.categories.map((cat) => (
              <button
                key={cat.slug}
                type="button"
                className={`pill ${selectedCategory === cat.slug ? "active" : ""}`}
                onClick={() => handleCategoryClick(cat.slug)}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </section>

      {errorMsg && (
        <div className="demo-banner" role="alert">
          <AlertTriangle size={18} />
          <span>{errorMsg}</span>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty-state">
          No se encontraron productos para esta búsqueda. Intenta limpiar los filtros o cambiar el
          modo de comparación.
        </div>
      ) : (
        <section className="groups-grid" aria-label="Resultados de comparación">
          {groups.map((group) => (
            <article key={group.groupId} className="group-card">
              <header className="group-header">
                <div>
                  <h2 className="group-title">{group.title}</h2>
                  <div className="group-subtitle">
                    {group.subtitle}
                    {group.ean ? ` · EAN ${group.ean}` : ""}
                  </div>
                </div>

                <div className="group-summary">
                  {group.savingsPct > 0 && (
                    <span className="savings-badge tabular">
                      Ahorra hasta {group.savingsPct}%
                    </span>
                  )}
                  <div className="best-price-box">
                    <div className="best-price-label">
                      {mode === "pum" ? "Mejor PUM" : "Mejor precio"}
                    </div>
                    <div className="best-price-val tabular">
                      {mode === "pum"
                        ? `${pumFormatter.format(group.bestPum)} / ${group.unitMeasure}`
                        : copFormatter.format(group.bestPrice)}
                    </div>
                  </div>
                </div>
              </header>

              <div className="offers-table-wrap">
                <table className="offers-table">
                  <thead>
                    <tr>
                      <th>Cadena / Producto</th>
                      <th>Precio</th>
                      <th>PUM ({group.unitMeasure})</th>
                      <th>Estado</th>
                      <th>Enlace</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.offers.map((offer, index) => {
                      const isBest = index === 0 && offer.inStock;
                      const hasDiscount = offer.rawListPrice > offer.calibratedPrice;

                      return (
                        <tr key={offer.storeSkuId} className={isBest ? "best-row" : undefined}>
                          <td>
                            <div className="store-cell">
                              <span>{offer.storeName}</span>
                              {isBest && <span className="tag tag-best">Más barato</span>}
                              {offer.isPrivateLabel && (
                                <span className="tag tag-private">Marca Propia</span>
                              )}
                              {offer.isEstimatedPhysicalPrice && (
                                <span className="tag tag-estimated">
                                  Precio estimado en tienda física
                                </span>
                              )}
                            </div>
                            {mode === "pum" && (
                              <div className="group-subtitle">
                                {offer.rawName} ({offer.netContent} {offer.unitMeasure})
                              </div>
                            )}
                          </td>

                          <td className="price-cell tabular">
                            {copFormatter.format(offer.calibratedPrice)}
                            {hasDiscount && (
                              <span className="list-price">
                                {copFormatter.format(offer.rawListPrice)}
                              </span>
                            )}
                          </td>

                          <td className="tabular">
                            {pumFormatter.format(offer.pumPrice)} / {offer.unitMeasure}
                          </td>

                          <td>
                            {offer.inStock ? (
                              <span className="tag tag-best">Disponible</span>
                            ) : (
                              <span className="tag tag-out">Agotado</span>
                            )}
                          </td>

                          <td>
                            {offer.rawUrl ? (
                              <a
                                href={offer.rawUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="store-link"
                              >
                                Ver <ExternalLink size={13} />
                              </a>
                            ) : (
                              <span className="group-subtitle">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
