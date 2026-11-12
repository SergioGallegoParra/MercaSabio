"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  LocateFixed,
  MapPin,
  RefreshCw,
  Scale,
  Search,
  ShoppingBasket,
  Tag,
  Trash2,
} from "lucide-react";

import ProductCard from "@/components/ProductCard";
import {
  optimizeBasket,
  type BasketItemInput,
  type BasketPlan,
} from "@/lib/basketOptimizer";
import type {
  CompareMode,
  ComparisonGroup,
  DashboardPayload,
  NearbyStoreBranch,
  StoreOffer,
} from "@/lib/types";

const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="route-map-loading">Cargando mapa OpenStreetMap y módulo de rutas...</div>
  ),
});

const copFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const PRESET_LOCATIONS = [
  { id: "bog-chapinero", label: "Bogotá · Chapinero", lat: 4.6462, lng: -74.0628 },
  { id: "bog-norte", label: "Bogotá · Calle 85 / Norte", lat: 4.6695, lng: -74.0548 },
  { id: "med-poblado", label: "Medellín · El Poblado", lat: 6.2088, lng: -75.5718 },
];

interface PriceComparatorProps {
  initialData: DashboardPayload;
}

function collectOffersFromPayload(payload: DashboardPayload): StoreOffer[] {
  const seen = new Map<string, StoreOffer>();
  for (const group of [...payload.eanGroups, ...payload.pumGroups]) {
    for (const offer of group.offers) {
      seen.set(offer.storeSkuId, offer);
    }
  }
  return [...seen.values()];
}

export default function PriceComparator({ initialData }: PriceComparatorProps) {
  const [payload, setPayload] = useState<DashboardPayload>(initialData);
  const [mode, setMode] = useState<CompareMode>("ean");
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estado cliente del optimizador de canasta y geolocalización
  const [knownOffers, setKnownOffers] = useState<Map<string, StoreOffer>>(() => {
    const map = new Map<string, StoreOffer>();
    for (const offer of collectOffersFromPayload(initialData)) {
      map.set(offer.storeSkuId, offer);
    }
    return map;
  });
  const [basketItems, setBasketItems] = useState<BasketItemInput[]>([]);
  const [basketObjective, setBasketObjective] = useState<"nominal" | "real_pum">("nominal");
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
    label: string;
  }>({
    lat: PRESET_LOCATIONS[0].lat,
    lng: PRESET_LOCATIONS[0].lng,
    label: PRESET_LOCATIONS[0].label,
  });
  const [radiusMeters, setRadiusMeters] = useState<number>(2000);
  const [nearbyBranches, setNearbyBranches] = useState<NearbyStoreBranch[]>([]);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<1 | 2 | 3 | null>(null);
  const [currentDay, setCurrentDay] = useState<number | undefined>(undefined);

  useEffect(() => {
    setCurrentDay(new Date().getDay());
  }, []);

  useEffect(() => {
    let active = true;
    async function loadNearby() {
      setLocLoading(true);
      setLocError(null);
      try {
        const res = await fetch(
          `/api/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=${radiusMeters}`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { branches: NearbyStoreBranch[] };
        if (active) {
          setNearbyBranches(data.branches ?? []);
        }
      } catch {
        if (active) {
          setLocError("No se pudieron consultar sucursales cercanas.");
        }
      } finally {
        if (active) {
          setLocLoading(false);
        }
      }
    }
    void loadNearby();
    return () => {
      active = false;
    };
  }, [userLocation.lat, userLocation.lng, radiusMeters]);

  const groups: ComparisonGroup[] = mode === "ean" ? payload.eanGroups : payload.pumGroups;

  const basketOptimization = useMemo(() => {
    return optimizeBasket({
      items: basketItems,
      offers: [...knownOffers.values()],
      nearbyBranches,
      options: {
        objective: basketObjective,
        minExtraSavingsCop: 1500,
        minExtraSavingsPct: 2,
      },
    });
  }, [basketItems, knownOffers, nearbyBranches, basketObjective]);

  const activePlan: BasketPlan | null = useMemo(() => {
    if (selectedTier === 1 && basketOptimization.bestOneStore) {
      return basketOptimization.bestOneStore;
    }
    if (selectedTier === 2 && basketOptimization.bestTwoStores) {
      return basketOptimization.bestTwoStores;
    }
    if (selectedTier === 3 && basketOptimization.bestThreeStores) {
      return basketOptimization.bestThreeStores;
    }
    return basketOptimization.recommendedPlan;
  }, [selectedTier, basketOptimization]);

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
      setKnownOffers((prev) => {
        const merged = new Map(prev);
        for (const offer of collectOffersFromPayload(nextPayload)) {
          merged.set(offer.storeSkuId, offer);
        }
        return merged;
      });
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

  function handleToggleBasket(group: ComparisonGroup) {
    const itemKey = `${mode}:${group.groupId}`;
    setBasketItems((prev) => {
      const exists = prev.some((item) => item.itemKey === itemKey);
      if (exists) {
        return prev.filter((item) => item.itemKey !== itemKey);
      }
      const anchorMasterId = group.offers[0]?.masterProductId ?? null;
      return [
        ...prev,
        {
          itemKey,
          label: group.title,
          masterProductId: mode === "ean" ? anchorMasterId : null,
          canonicalSlug: group.canonicalSlug,
          matchMode: mode,
          quantity: 1,
        },
      ];
    });
  }

  function handleQuantityChange(itemKey: string, nextQty: number) {
    setBasketItems((prev) =>
      prev.map((item) =>
        item.itemKey === itemKey
          ? { ...item, quantity: Math.max(1, Math.min(20, nextQty)) }
          : item
      )
    );
  }

  function handleRequestGeolocation() {
    if (!navigator.geolocation) {
      setLocError("Tu navegador no soporta geolocalización; selecciona una zona manual.");
      return;
    }
    setLocLoading(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: Number(pos.coords.latitude.toFixed(5)),
          lng: Number(pos.coords.longitude.toFixed(5)),
          label: "Tu ubicación GPS",
        });
      },
      () => {
        setLocLoading(false);
        setLocError("No se obtuvo permiso GPS; usando ubicación de referencia.");
      },
      { enableHighAccuracy: false, timeout: 7000 }
    );
  }

  const basketKeys = new Set(basketItems.map((i) => i.itemKey));
  const plansToRender: Array<{ label: string; plan: BasketPlan | null }> = [
    { label: "1 tienda (mínima fricción)", plan: basketOptimization.bestOneStore },
    { label: "2 tiendas (óptimo cercano)", plan: basketOptimization.bestTwoStores },
    { label: "3 tiendas (máximo cruce)", plan: basketOptimization.bestThreeStores },
  ];

  return (
    <main className="container">
      <section className="hero">
        <div className="hero-top">
          <div>
            <span className="hero-badge">
              <RefreshCw size={13} />
              ISR cada 6 horas · Cloudflare Workers + Supabase HTTPS
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
            Mostrando datos de demostración locales. Configura <code>SUPABASE_URL</code> y{" "}
            <code>SUPABASE_ANON_KEY</code> para consultar ofertas en vivo en Supabase.
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

      <section className="basket-panel" aria-label="Optimizador de canasta y ruta cercana">
        <div className="basket-header">
          <div>
            <h2 className="basket-title">
              <ShoppingBasket size={18} />
              Optimizador de Canasta Cercana ({basketItems.length} productos)
            </h2>
            <p className="group-subtitle">
              Cálculo combinatorio en tu navegador usando sucursales PostGIS y rutas gratuitas OSRM.
            </p>
          </div>

          <div className="geo-controls">
            <button
              type="button"
              className="pill active"
              onClick={handleRequestGeolocation}
              disabled={locLoading}
            >
              <LocateFixed size={13} /> {locLoading ? "Ubicando..." : "Usar mi GPS"}
            </button>

            <select
              aria-label="Zona de referencia"
              className="geo-select"
              value={
                PRESET_LOCATIONS.find(
                  (p) => p.lat === userLocation.lat && p.lng === userLocation.lng
                )?.id ?? "custom"
              }
              onChange={(e) => {
                const chosen = PRESET_LOCATIONS.find((p) => p.id === e.target.value);
                if (chosen) {
                  setUserLocation({
                    lat: chosen.lat,
                    lng: chosen.lng,
                    label: chosen.label,
                  });
                }
              }}
            >
              {PRESET_LOCATIONS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value="custom" disabled>
                {userLocation.label}
              </option>
            </select>

            <select
              aria-label="Radio de búsqueda"
              className="geo-select"
              value={radiusMeters}
              onChange={(e) => setRadiusMeters(Number(e.target.value))}
            >
              <option value={1500}>Radio 1.5 km</option>
              <option value={2000}>Radio 2.0 km</option>
              <option value={5000}>Radio 5.0 km</option>
            </select>

            <select
              aria-label="Criterio de optimización"
              className="geo-select"
              value={basketObjective}
              onChange={(e) =>
                setBasketObjective(e.target.value === "real_pum" ? "real_pum" : "nominal")
              }
            >
              <option value="nominal">Optimizar por precio nominal</option>
              <option value="real_pum">Optimizar por PUM Real Ajustado</option>
            </select>
          </div>
        </div>

        <div className="nearby-strip">
          <MapPin size={14} />
          <span>
            <strong>{nearbyBranches.length}</strong> sedes cercanas en{" "}
            {(radiusMeters / 1000).toFixed(1)} km ({userLocation.label})
            {nearbyBranches.length > 0 &&
              `: ${nearbyBranches
                .slice(0, 5)
                .map((b) => `${b.branchName} (${Math.round(b.distanceMeters)} m)`)
                .join(" · ")}`}
          </span>
        </div>

        {locError && (
          <div className="demo-banner" role="status">
            <AlertTriangle size={16} />
            <span>{locError}</span>
          </div>
        )}

        {basketItems.length === 0 ? (
          <p className="group-subtitle">
            Haz clic en <strong>+ Añadir a canasta</strong> en cualquier producto de abajo para
            comparar compras en 1, 2 o 3 tiendas cercanas y trazar tu ruta en el mapa.
          </p>
        ) : (
          <div className="basket-body">
            <div className="basket-items-list">
              {basketItems.map((item) => (
                <div key={item.itemKey} className="basket-chip">
                  <span>{item.label}</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    aria-label={`Cantidad para ${item.label}`}
                    className="basket-qty"
                    value={item.quantity ?? 1}
                    onChange={(e) => handleQuantityChange(item.itemKey, Number(e.target.value))}
                  />
                  <button
                    type="button"
                    aria-label={`Quitar ${item.label}`}
                    className="basket-remove"
                    onClick={() =>
                      setBasketItems((prev) => prev.filter((i) => i.itemKey !== item.itemKey))
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            <div className="plans-grid">
              {plansToRender.map(({ label, plan }) => {
                if (!plan) return null;
                const isSelected = activePlan?.storeCount === plan.storeCount;
                return (
                  <button
                    key={plan.storeCount}
                    type="button"
                    className={`plan-card ${isSelected ? "selected" : ""} ${
                      !plan.worthExtraStop ? "unjustified" : ""
                    }`}
                    onClick={() => setSelectedTier(plan.storeCount)}
                  >
                    <div className="plan-card-top">
                      <strong>{label}</strong>
                      {basketOptimization.recommendedPlan?.storeCount === plan.storeCount && (
                        <span className="tag tag-best">Recomendado</span>
                      )}
                    </div>
                    <div className="plan-price tabular">
                      {copFormatter.format(plan.totalNominalCost)}
                    </div>
                    <div className="plan-meta tabular">
                      Costo real uso: {copFormatter.format(plan.totalYieldAdjustedCost)} ·{" "}
                      {plan.coveredItems}/{plan.requestedItems} ítems
                    </div>
                    {plan.storeCount > 1 && (
                      <div className="plan-savings tabular">
                        Ahorro nominal: {copFormatter.format(plan.nominalSavingsCop)} (
                        {plan.nominalSavingsPct}%) · PUM Real:{" "}
                        {copFormatter.format(plan.realAdjustedSavingsCop)} (
                        {plan.realAdjustedSavingsPct}%)
                      </div>
                    )}
                    {plan.filterReason && (
                      <div className="plan-filter-note">{plan.filterReason}</div>
                    )}
                    <div className="plan-stores-list">
                      {plan.storeStops
                        .map(
                          (s) =>
                            `${s.storeName} (${s.allocations.length} prod · ${Math.round(
                              s.branch.distanceMeters
                            )} m)`
                        )
                        .join(" → ")}
                    </div>
                  </button>
                );
              })}
            </div>

            {activePlan && activePlan.storeStops.length > 0 && (
              <RouteMap
                userLocation={userLocation}
                stops={activePlan.storeStops.map((s) => ({
                  ...s.branch,
                  storeName: s.storeName,
                }))}
              />
            )}
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
            <ProductCard
              key={`${mode}:${group.groupId}`}
              group={group}
              mode={mode}
              bankPromotions={payload.bankPromotions}
              currentDay={currentDay}
              inBasket={basketKeys.has(`${mode}:${group.groupId}`)}
              onToggleBasket={handleToggleBasket}
            />
          ))}
        </section>
      )}
    </main>
  );
}
