"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  LocateFixed,
  MapPin,
  RefreshCw,
  Scale,
  Search,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import GuidedMarketWizard, { type WizardStep } from "@/components/GuidedMarketWizard";
import ProductCard from "@/components/ProductCard";
import {
  optimizeBasket,
  type BasketItemInput,
  type BasketPlan,
} from "@/lib/basketOptimizer";
import {
  inferHabitualItemProfile,
  type ShoppingExperienceMode,
} from "@/lib/guidedCatalog";
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

const PAGE_SIZE = 24;
const BASKET_STORAGE_KEY = "mercasabio_basket_v1";
const SUBSTITUTES_STORAGE_KEY = "mercasabio_sub_rules_v1";
const LOCATION_STORAGE_KEY = "mercasabio_loc_v1";
const QUICK_SEARCH_TERMS = ["Arroz", "Leche", "Aceite", "Huevos", "Café", "Azúcar", "Atún"];
const MONITORED_CHAINS = ["Carulla", "Tiendas D1", "Olímpica", "Éxito", "Ara"];

const PRESET_LOCATIONS = [
  { id: "bog-chapinero", label: "Bogotá · Chapinero", lat: 4.646, lng: -74.063 },
  { id: "bog-norte", label: "Bogotá · Calle 85 / Norte", lat: 4.67, lng: -74.055 },
  { id: "med-poblado", label: "Medellín · El Poblado", lat: 6.209, lng: -75.572 },
];

type SortOption = "stores" | "savings" | "price" | "pum";

interface PriceComparatorProps {
  initialData: DashboardPayload;
}

function collectOffersFromPayload(payload: DashboardPayload): StoreOffer[] {
  const seen = new Map<string, StoreOffer>();
  for (const group of [...payload.eanGroups, ...payload.pumGroups]) {
    for (const offer of group.offers) {
      seen.set(offer.storeSkuId, offer);
    }
    for (const m of [...(group.directCompetitors ?? []), ...(group.similarCompetitors ?? [])]) {
      seen.set(m.offer.storeSkuId, m.offer);
    }
    for (const b of group.bulkOptions ?? []) {
      seen.set(b.offer.storeSkuId, b.offer);
    }
  }
  return [...seen.values()];
}

export default function PriceComparator({ initialData }: PriceComparatorProps) {
  const [payload, setPayload] = useState<DashboardPayload>(initialData);
  const [mode, setMode] = useState<CompareMode>("ean");
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("stores");
  const [onlyComparable, setOnlyComparable] = useState(false);
  const [globalSubstitutes, setGlobalSubstitutes] = useState(true);
  const [substituteOverrides, setSubstituteOverrides] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isBasketExpanded, setIsBasketExpanded] = useState(false);

  // Controla debounce de búsqueda sin disparar fetch redundante en el montaje inicial
  const lastFetchedRef = useRef<{ query: string; category: string }>({
    query: "",
    category: "",
  });

  // Estado cliente del optimizador de canasta y geolocalización
  const [knownOffers, setKnownOffers] = useState<Map<string, StoreOffer>>(() => {
    const map = new Map<string, StoreOffer>();
    for (const offer of collectOffersFromPayload(initialData)) {
      map.set(offer.storeSkuId, offer);
    }
    return map;
  });
  const [basketItems, setBasketItems] = useState<BasketItemInput[]>([]);
  const [basketHydrated, setBasketHydrated] = useState(false);
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
  const [locationHydrated, setLocationHydrated] = useState(false);
  const [radiusMeters, setRadiusMeters] = useState<number>(3000);
  const [allNearbyBranches, setAllNearbyBranches] = useState<NearbyStoreBranch[]>([]);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<1 | 2 | 3 | null>(null);
  const [currentDay, setCurrentDay] = useState<number | undefined>(undefined);
  const [experienceMode, setExperienceMode] =
    useState<ShoppingExperienceMode>("generic_guided");
  const [wizardStep, setWizardStep] = useState<WizardStep>("location");
  const [maxStores, setMaxStores] = useState<1 | 2 | 3>(2);
  const prefetchedTermsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setCurrentDay(new Date().getDay());

    try {
      const savedBasket = window.localStorage.getItem(BASKET_STORAGE_KEY);
      if (savedBasket) {
        const parsed = JSON.parse(savedBasket);
        if (Array.isArray(parsed)) {
          setBasketItems(
            parsed.filter(
              (item): item is BasketItemInput =>
                Boolean(item) &&
                typeof item.itemKey === "string" &&
                typeof item.label === "string"
            )
          );
        }
      }
    } catch {
      // Ignora almacenamiento local corrupto o bloqueado
    } finally {
      setBasketHydrated(true);
    }

    try {
      const savedSubRules = window.localStorage.getItem(SUBSTITUTES_STORAGE_KEY);
      if (savedSubRules) {
        const parsed = JSON.parse(savedSubRules) as {
          globalSubstitutes?: unknown;
          overrides?: Record<string, unknown>;
        };
        if (typeof parsed.globalSubstitutes === "boolean") {
          setGlobalSubstitutes(parsed.globalSubstitutes);
        }
        if (parsed.overrides && typeof parsed.overrides === "object") {
          const cleanOverrides: Record<string, boolean> = {};
          for (const [k, v] of Object.entries(parsed.overrides)) {
            if (typeof v === "boolean") {
              cleanOverrides[k] = v;
            }
          }
          setSubstituteOverrides(cleanOverrides);
        }
      }
    } catch {
      // Ignora almacenamiento local corrupto
    }

    try {
      const savedLocation = window.localStorage.getItem(LOCATION_STORAGE_KEY);
      if (savedLocation) {
        const parsed = JSON.parse(savedLocation) as {
          lat?: unknown;
          lng?: unknown;
          label?: unknown;
        };
        if (
          typeof parsed.lat === "number" &&
          typeof parsed.lng === "number" &&
          Number.isFinite(parsed.lat) &&
          Number.isFinite(parsed.lng) &&
          typeof parsed.label === "string"
        ) {
          setUserLocation({
            lat: Number(parsed.lat.toFixed(3)),
            lng: Number(parsed.lng.toFixed(3)),
            label: parsed.label.slice(0, 60),
          });
        }
      }
    } catch {
      // Ignora almacenamiento local corrupto o bloqueado
    } finally {
      setLocationHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!basketHydrated) return;
    try {
      window.localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(basketItems));
    } catch {
      // Silencioso si almacenamiento bloqueado
    }
  }, [basketItems, basketHydrated]);

  useEffect(() => {
    if (!basketHydrated) return;
    try {
      window.localStorage.setItem(
        SUBSTITUTES_STORAGE_KEY,
        JSON.stringify({ globalSubstitutes, overrides: substituteOverrides })
      );
    } catch {
      // Silencioso si almacenamiento bloqueado
    }
  }, [globalSubstitutes, substituteOverrides, basketHydrated]);

  useEffect(() => {
    if (!locationHydrated) return;
    try {
      window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(userLocation));
    } catch {
      // Silencioso si almacenamiento bloqueado
    }
  }, [userLocation, locationHydrated]);

  useEffect(() => {
    let active = true;
    async function loadNearby() {
      setLocLoading(true);
      setLocError(null);
      try {
        const res = await fetch(
          `/api/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=15000`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { branches: NearbyStoreBranch[] };
        if (active) {
          setAllNearbyBranches(data.branches ?? []);
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
  }, [userLocation.lat, userLocation.lng]);

  const nearbyBranches = useMemo(() => {
    if (allNearbyBranches.length === 0) return [];
    const minNearest = Math.min(...allNearbyBranches.map((b) => b.distanceMeters));
    const effectiveRadius = Math.max(radiusMeters, minNearest);
    return allNearbyBranches.filter((b) => b.distanceMeters <= effectiveRadius);
  }, [allNearbyBranches, radiusMeters]);

  const handlePrefetchTerms = useCallback(async (terms: string[]) => {
    const pending = terms
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 2 && !prefetchedTermsRef.current.has(t))
      .slice(0, 2);
    if (pending.length === 0) return;

    for (const term of pending) {
      prefetchedTermsRef.current.add(term);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        if (!res.ok) continue;
        const nextPayload = (await res.json()) as DashboardPayload;
        const collected = collectOffersFromPayload(nextPayload);
        if (collected.length === 0) continue;
        setKnownOffers((prev) => {
          const merged = new Map(prev);
          for (const offer of collected) {
            merged.set(offer.storeSkuId, offer);
          }
          return merged;
        });
      } catch {
        // Silencioso en precarga en segundo plano
      }
    }
  }, []);

  const fetchFiltered = useCallback(async (nextQuery: string, nextCategory: string) => {
    const cleanQuery = nextQuery.trim().slice(0, 80);
    lastFetchedRef.current = { query: cleanQuery, category: nextCategory };
    setLoading(true);
    setErrorMsg(null);
    setVisibleCount(PAGE_SIZE);
    try {
      const params = new URLSearchParams();
      if (cleanQuery) {
        params.set("q", cleanQuery);
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
  }, []);

  // Debounce automático de 300 ms al escribir en el buscador
  useEffect(() => {
    const clean = query.trim().slice(0, 80);
    if (
      clean === lastFetchedRef.current.query &&
      selectedCategory === lastFetchedRef.current.category
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void fetchFiltered(clean, selectedCategory);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [query, selectedCategory, fetchFiltered]);

  const rawGroups: ComparisonGroup[] = mode === "ean" ? payload.eanGroups : payload.pumGroups;

  const basketItemSubstitutesMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const item of basketItems) {
      map.set(item.itemKey, item.allowSubstitutes ?? globalSubstitutes);
    }
    return map;
  }, [basketItems, globalSubstitutes]);

  const getGroupAllowsSubstitutes = useCallback(
    (itemKey: string) => {
      if (basketItemSubstitutesMap.has(itemKey)) {
        return Boolean(basketItemSubstitutesMap.get(itemKey));
      }
      if (itemKey in substituteOverrides) {
        return Boolean(substituteOverrides[itemKey]);
      }
      return globalSubstitutes;
    },
    [basketItemSubstitutesMap, substituteOverrides, globalSubstitutes]
  );

  const groups: ComparisonGroup[] = useMemo(() => {
    const storeCount = (g: ComparisonGroup) => {
      const key = `${mode}:${g.groupId}`;
      const allowSub = getGroupAllowsSubstitutes(key);
      const stores = new Set(g.offers.map((o) => o.storeId));
      if (allowSub) {
        for (const m of g.directCompetitors ?? []) stores.add(m.offer.storeId);
        for (const m of g.similarCompetitors ?? []) stores.add(m.offer.storeId);
      }
      return stores.size;
    };
    const base = onlyComparable ? rawGroups.filter((g) => storeCount(g) >= 2) : rawGroups;

    return [...base].sort((a, b) => {
      if (sortBy === "savings") {
        return b.savingsPct - a.savingsPct || storeCount(b) - storeCount(a);
      }
      if (sortBy === "price") {
        return a.bestPrice - b.bestPrice;
      }
      if (sortBy === "pum") {
        return a.bestRealPum - b.bestRealPum;
      }
      return (
        storeCount(b) - storeCount(a) ||
        b.offers.length - a.offers.length ||
        b.savingsPct - a.savingsPct
      );
    });
  }, [rawGroups, mode, onlyComparable, sortBy, getGroupAllowsSubstitutes]);

  const visibleGroups = useMemo(
    () => groups.slice(0, visibleCount),
    [groups, visibleCount]
  );

  const knownOffersList = useMemo(() => [...knownOffers.values()], [knownOffers]);

  const basketOptimization = useMemo(() => {
    return optimizeBasket({
      items: basketItems,
      offers: knownOffersList,
      nearbyBranches: allNearbyBranches,
      options: {
        objective: basketObjective,
        minExtraSavingsCop: 1500,
        minExtraSavingsPct: 2,
        maxStores,
        maxDistanceMeters: radiusMeters,
      },
    });
  }, [basketItems, knownOffers, allNearbyBranches, basketObjective, maxStores, radiusMeters]);

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

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void fetchFiltered(query, selectedCategory);
  }

  function handleCategoryClick(slug: string) {
    const next = selectedCategory === slug ? "" : slug;
    setSelectedCategory(next);
    void fetchFiltered(query, next);
  }

  function handleQuickSearch(term: string) {
    const next = query.trim().toLowerCase() === term.toLowerCase() ? "" : term;
    setQuery(next);
    void fetchFiltered(next, selectedCategory);
  }

  function handleClearFilters() {
    setQuery("");
    setSelectedCategory("");
    setOnlyComparable(false);
    setVisibleCount(PAGE_SIZE);
    void fetchFiltered("", "");
  }

  function handleToggleBasket(group: ComparisonGroup) {
    const itemKey = `${mode}:${group.groupId}`;
    const allowSub = getGroupAllowsSubstitutes(itemKey);
    setBasketItems((prev) => {
      const exists = prev.some((item) => item.itemKey === itemKey);
      if (exists) {
        return prev.filter((item) => item.itemKey !== itemKey);
      }
      const anchorOffer = group.offers[0] ?? null;
      const inferred = anchorOffer ? inferHabitualItemProfile(anchorOffer) : null;
      const anchorPrice = anchorOffer
        ? anchorOffer.calibratedPrice > 0
          ? anchorOffer.calibratedPrice
          : anchorOffer.rawSalePrice > 0
            ? anchorOffer.rawSalePrice
            : anchorOffer.rawListPrice
        : 0;
      const habitualPrice =
        anchorPrice > 0
          ? anchorPrice
          : group.highestPrice > 0
            ? group.highestPrice
            : group.bestPrice;
      const resolvedTier = inferred?.qualityTier ?? group.qualityTier;
      return [
        ...prev,
        {
          itemKey,
          label: group.title,
          masterProductId: mode === "ean" ? (anchorOffer?.masterProductId ?? null) : null,
          canonicalSlug: group.canonicalSlug,
          matchMode: mode,
          quantity: 1,
          allowSubstitutes: allowSub,
          subtypeFamily: group.signature?.subtypeFamily ?? inferred?.subtypeFamily ?? null,
          broadFamily: group.signature?.broadFamily ?? inferred?.broadFamily ?? null,
          familyLabel: inferred?.familyLabel ?? group.canonicalName ?? null,
          targetNetContent: group.signature?.effectiveNetContent ?? group.netContent,
          targetUnitMeasure: group.signature?.effectiveUnitMeasure ?? group.unitMeasure,
          anchorStoreSkuId: anchorOffer?.storeSkuId ?? null,
          anchorBrand: group.brand ?? anchorOffer?.brand ?? null,
          ean: group.ean,
          allowedQualityTiers: resolvedTier ? [resolvedTier] : undefined,
          pricePriority: "lowest_total",
          requiredCriticalAttribute:
            inferred?.criticalAttribute ?? group.criticalAttribute ?? null,
          sizePreference: inferred?.sizeBucket ?? "any",
          habitualReferencePriceCop: habitualPrice > 0 ? habitualPrice : null,
          habitualProductTitle: anchorOffer?.rawName ?? group.title,
          originMode: "free_shop",
        },
      ];
    });
  }

  function handleToggleGroupSubstitutes(group: ComparisonGroup) {
    const itemKey = `${mode}:${group.groupId}`;
    const next = !getGroupAllowsSubstitutes(itemKey);
    setSubstituteOverrides((prev) => ({ ...prev, [itemKey]: next }));
    setBasketItems((prev) =>
      prev.map((item) => (item.itemKey === itemKey ? { ...item, allowSubstitutes: next } : item))
    );
  }

  function handleToggleBasketItemSubstitutes(itemKey: string) {
    setBasketItems((prev) =>
      prev.map((item) => {
        if (item.itemKey !== itemKey) return item;
        const next = !(item.allowSubstitutes ?? globalSubstitutes);
        setSubstituteOverrides((o) => ({ ...o, [itemKey]: next }));
        return { ...item, allowSubstitutes: next };
      })
    );
  }

  function handleToggleGlobalSubstitutes() {
    const next = !globalSubstitutes;
    setGlobalSubstitutes(next);
    setSubstituteOverrides({});
    setBasketItems((prev) => prev.map((item) => ({ ...item, allowSubstitutes: next })));
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
          lat: Number(pos.coords.latitude.toFixed(3)),
          lng: Number(pos.coords.longitude.toFixed(3)),
          label: "Tu zona GPS",
        });
      },
      () => {
        setLocLoading(false);
        setLocError("No se obtuvo permiso GPS; usando ubicación de referencia.");
      },
      { enableHighAccuracy: false, timeout: 7000 }
    );
  }

  function scrollToBasketOptimizer() {
    if (experienceMode === "free_shop" && wizardStep === "sections") {
      setIsBasketExpanded(true);
      window.requestAnimationFrame(() => {
        document.getElementById("basket-optimizer")?.scrollIntoView({ behavior: "smooth" });
      });
      return;
    }
    if (basketItems.length > 0 && wizardStep !== "results") {
      setWizardStep("confirm");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const basketKeys = new Set(basketItems.map((i) => i.itemKey));
  const plansToRender: Array<{ label: string; plan: BasketPlan | null }> = [
    { label: "1 tienda (mínima fricción)", plan: basketOptimization.bestOneStore },
    { label: "2 tiendas (óptimo cercano)", plan: basketOptimization.bestTwoStores },
    { label: "3 tiendas (máximo cruce)", plan: basketOptimization.bestThreeStores },
  ];
  const hasActiveFilters = query.trim() !== "" || selectedCategory !== "" || onlyComparable;
  const showFullBasket = basketItems.length > 0 || isBasketExpanded;
  const locationPresetValue =
    PRESET_LOCATIONS.find(
      (p) =>
        Math.abs(p.lat - userLocation.lat) < 0.002 &&
        Math.abs(p.lng - userLocation.lng) < 0.002
    )?.id ?? "custom";

  return (
    <div className="app-shell">
      <header className="site-navbar">
        <div className="navbar-inner">
          <a
            href="#top"
            className="brand-link"
            onClick={(e) => {
              e.preventDefault();
              handleClearFilters();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <span className="brand-logo" aria-hidden="true">
              MS
            </span>
            <span className="brand-wordmark">MercaSabio</span>
            <span className="brand-country">COL</span>
          </a>

          <form className="navbar-search-form" onSubmit={handleSearchSubmit}>
            <div className="search-input-wrap">
              <Search size={16} className="search-icon" />
              <input
                type="search"
                className="search-input navbar-search-input"
                maxLength={80}
                aria-label="Buscar producto, marca o EAN"
                placeholder="Buscar arroz, leche, aceite o código EAN-13..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {loading && (
                <RefreshCw
                  size={15}
                  className="search-spinner spin"
                  aria-label="Actualizando resultados"
                />
              )}
              {query !== "" && !loading && (
                <button
                  type="button"
                  className="search-clear-inline"
                  aria-label="Limpiar búsqueda"
                  onClick={() => {
                    setQuery("");
                    void fetchFiltered("", selectedCategory);
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button type="submit" className="btn-primary navbar-search-submit" disabled={loading}>
              Buscar
            </button>
          </form>

          <div className="navbar-actions">
            <div className="nav-location-wrap">
              <MapPin size={14} className="nav-loc-icon" aria-hidden="true" />
              <select
                aria-label="Zona de referencia en barra superior"
                className="nav-location-select"
                value={locationPresetValue}
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
            </div>

            <button
              type="button"
              className={`nav-basket-btn ${basketItems.length > 0 ? "has-items" : ""}`}
              onClick={scrollToBasketOptimizer}
            >
              <ShoppingBasket size={16} />
              <span>Mi Canasta</span>
              <span className="nav-basket-badge tabular">{basketItems.length}</span>
              {activePlan && basketItems.length > 0 && (
                <span className="nav-basket-total tabular">
                  · {copFormatter.format(activePlan.totalNominalCost)}
                </span>
              )}
            </button>

            <Link
              href="/admin"
              className="nav-admin-link"
              title="Abrir panel visual de curación y productos reportados"
            >
              <SlidersHorizontal size={15} />
              <span>Curación</span>
            </Link>
          </div>
        </div>
        {loading && <div className="loading-progress-bar" aria-hidden="true" />}
      </header>

      <main id="top" className="container">
        <section className="hero-compact">
          <div className="hero-top">
            <div>
              <span className="hero-badge">
                <Sparkles size={12} />
                Precios verificados hoy · PUM por gramo y ruta cercana
              </span>
              <h1>Compara tu mercado y paga lo justo en Colombia</h1>
              <p>
                Homologación exacta por código EAN-13 y comparación por Precio por Unidad de Medida
                (PUM) entre supermercados y formato hard discount.
              </p>

              <div className="quick-terms-row" aria-label="Búsquedas rápidas">
                <span className="quick-terms-label">Populares:</span>
                {QUICK_SEARCH_TERMS.map((term) => {
                  const isActive = query.trim().toLowerCase() === term.toLowerCase();
                  return (
                    <button
                      key={term}
                      type="button"
                      className={`quick-term-chip ${isActive ? "active" : ""}`}
                      onClick={() => handleQuickSearch(term)}
                    >
                      {term}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="kpi-row">
              <div className="kpi-card">
                <div className="kpi-label">Cadenas</div>
                <div className="kpi-value tabular">{payload.storesCount}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">SKUs Activos</div>
                <div className="kpi-value tabular">{payload.totalSkus.toLocaleString("es-CO")}</div>
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
              <code>SUPABASE_ANON_KEY</code> para consultar ofertas en vivo.
            </span>
          </div>
        )}

        <GuidedMarketWizard
          experienceMode={experienceMode}
          onChangeExperienceMode={setExperienceMode}
          wizardStep={wizardStep}
          onChangeWizardStep={setWizardStep}
          basketItems={basketItems}
          setBasketItems={setBasketItems}
          knownOffers={knownOffersList}
          nearbyBranches={nearbyBranches}
          allNearbyWithinMax={allNearbyBranches}
          userLocation={userLocation}
          onSelectBarrio={(lat, lng, label) => setUserLocation({ lat, lng, label })}
          onRequestGeolocation={handleRequestGeolocation}
          locLoading={locLoading}
          locError={locError}
          maxDistanceMeters={radiusMeters}
          onChangeMaxDistanceMeters={setRadiusMeters}
          maxStores={maxStores}
          onChangeMaxStores={setMaxStores}
          optimization={basketOptimization}
          onPrefetchTerms={handlePrefetchTerms}
        />

        {experienceMode === "free_shop" && wizardStep === "sections" && (
          <>
            <section className="toolbar-panel" aria-label="Modo de comparación y filtros">
          <div className="mode-switch" role="tablist" aria-label="Modo de comparación">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "ean"}
              className={`mode-btn ${mode === "ean" ? "active" : ""}`}
              onClick={() => {
                setMode("ean");
                setVisibleCount(PAGE_SIZE);
              }}
            >
              <Tag size={15} />
              Misma marca (EAN)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "pum"}
              className={`mode-btn ${mode === "pum" ? "active" : ""}`}
              onClick={() => {
                setMode("pum");
                setVisibleCount(PAGE_SIZE);
              }}
            >
              <Scale size={15} />
              Equivalente más barato por gramo/ml (PUM)
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

          <div className="sort-filter-bar">
            <div className="sort-left-controls">
              <button
                type="button"
                className={`pill ${onlyComparable ? "active" : ""}`}
                onClick={() => {
                  setOnlyComparable((prev) => !prev);
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                Solo comparables en 2+ tiendas
              </button>

              <button
                type="button"
                aria-pressed={globalSubstitutes}
                className={`pill ${globalSubstitutes ? "active" : ""}`}
                onClick={handleToggleGlobalSubstitutes}
                title="Activa o desactiva la comparación automática con sustitutos equivalentes y selecciona producto por producto"
              >
                <ArrowRightLeft size={13} />
                {globalSubstitutes ? "Sustitutos: Activos (todos)" : "Sustitutos: Desactivados"}
              </button>

              {hasActiveFilters && (
                <button
                  type="button"
                  className="btn-clear-inline"
                  onClick={handleClearFilters}
                  disabled={loading}
                >
                  <X size={13} /> Limpiar filtros
                </button>
              )}
            </div>

            <div className="sort-right-controls">
              <span className="results-counter tabular">
                {groups.length} {groups.length === 1 ? "producto" : "productos"}
              </span>

              <div className="sort-group">
                <label htmlFor="sort-select" className="sort-label">
                  Ordenar:
                </label>
                <select
                  id="sort-select"
                  className="geo-select"
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as SortOption);
                    setVisibleCount(PAGE_SIZE);
                  }}
                >
                  <option value="stores">Más cadenas comparadas</option>
                  <option value="savings">Mayor % de ahorro</option>
                  <option value="price">Menor precio nominal</option>
                  <option value="pum">Menor PUM Real (gramo/ml)</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        <section
          id="basket-optimizer"
          className={showFullBasket ? "basket-panel" : "basket-empty-banner"}
          aria-label="Optimizador de canasta y ruta cercana"
        >
          {!showFullBasket ? (
            <div className="basket-compact-row">
              <div className="basket-compact-info">
                <MapPin size={15} className="accent-icon" />
                <span>
                  <strong>Ruta de ahorro ({nearbyBranches.length} sedes</strong> a{" "}
                  {(radiusMeters / 1000).toFixed(1)} km en {userLocation.label}): agrega
                  productos con <strong>+ Canasta</strong> para calcular si te conviene comprar en
                  1, 2 o 3 tiendas.
                </span>
              </div>

              <div className="basket-compact-actions">
                <button
                  type="button"
                  className="pill active"
                  onClick={handleRequestGeolocation}
                  disabled={locLoading}
                >
                  <LocateFixed size={13} /> {locLoading ? "Ubicando..." : "Usar mi GPS"}
                </button>
                <select
                  aria-label="Radio de búsqueda"
                  className="geo-select"
                  value={radiusMeters}
                  onChange={(e) => setRadiusMeters(Number(e.target.value))}
                >
                  <option value={1500}>1.5 km</option>
                  <option value={2000}>2.0 km</option>
                  <option value={3000}>3.0 km</option>
                  <option value={5000}>5.0 km</option>
                  <option value={10000}>10.0 km</option>
                  <option value={15000}>15.0 km</option>
                </select>
                <button
                  type="button"
                  className="pill"
                  onClick={() => setIsBasketExpanded(true)}
                >
                  Configurar ruta <ChevronDown size={13} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="basket-header">
                <div>
                  <h2 className="basket-title">
                    <ShoppingBasket size={18} />
                    Optimizador de Canasta Cercana ({basketItems.length} productos)
                  </h2>
                  <p className="group-subtitle">
                    Compara cuánto cuesta tu mercado completo en 1, 2 o 3 tiendas cercanas a tu
                    ubicación.
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
                    aria-label="Radio de búsqueda"
                    className="geo-select"
                    value={radiusMeters}
                    onChange={(e) => setRadiusMeters(Number(e.target.value))}
                  >
                    <option value={1500}>Radio 1.5 km</option>
                    <option value={2000}>Radio 2.0 km</option>
                    <option value={3000}>Radio 3.0 km</option>
                    <option value={5000}>Radio 5.0 km</option>
                    <option value={10000}>Radio 10.0 km</option>
                    <option value={15000}>Radio 15.0 km</option>
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

                  {basketItems.length > 0 ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => {
                        setWizardStep("confirm");
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Confirmar carrito y exportar
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="pill"
                      onClick={() => setIsBasketExpanded(false)}
                    >
                      Minimizar <ChevronUp size={13} />
                    </button>
                  )}
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
                  Haz clic en <strong>+ Canasta</strong> en cualquier producto de abajo para comparar
                  compras en 1, 2 o 3 tiendas cercanas y trazar tu ruta en el mapa.
                </p>
              ) : (
                <div className="basket-body">
                  <div className="basket-items-list">
                    {basketItems.map((item) => {
                      const allowSub = item.allowSubstitutes ?? globalSubstitutes;
                      return (
                        <div key={item.itemKey} className="basket-chip">
                          <span>{item.label}</span>
                          <button
                            type="button"
                            aria-pressed={allowSub}
                            className={`basket-sub-pill ${allowSub ? "is-sub" : ""}`}
                            onClick={() => handleToggleBasketItemSubstitutes(item.itemKey)}
                            title={
                              allowSub
                                ? "Este producto permite sustitutos equivalentes en otras tiendas; clic para exigir exacto"
                                : "Este producto exige coincidencia exacta; clic para permitir sustitutos"
                            }
                          >
                            <ArrowRightLeft size={11} />
                            {allowSub ? "Con sustitutos" : "Solo exacto"}
                          </button>
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
                              setBasketItems((prev) =>
                                prev.filter((i) => i.itemKey !== item.itemKey)
                              )
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="basket-workspace">
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
                              {basketOptimization.recommendedPlan?.storeCount ===
                                plan.storeCount && (
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
                            {isSelected && (
                              <div className="plan-allocations-detail">
                                {plan.storeStops.map((stop) => (
                                  <div key={stop.storeId} className="plan-stop-detail">
                                    <strong>{stop.storeName}:</strong>{" "}
                                    {stop.allocations.map((alloc, i) => (
                                      <span key={alloc.itemKey} className="plan-alloc-item">
                                        {i > 0 ? " · " : ""}
                                        {alloc.isSubstitute ? (
                                          <span className="tag tag-estimated">Sustituto</span>
                                        ) : (
                                          <span className="tag tag-best">Exacto</span>
                                        )}{" "}
                                        {alloc.offer.rawName} ({copFormatter.format(alloc.nominalCost)})
                                      </span>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
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
                </div>
              )}
            </>
          )}
        </section>

        {errorMsg && (
          <div className="demo-banner" role="alert">
            <AlertTriangle size={18} />
            <span>{errorMsg}</span>
          </div>
        )}

        {loading ? (
          <section className="groups-grid" aria-label="Cargando comparativas">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="skeleton-card" aria-hidden="true">
                <div className="skeleton-top">
                  <div className="skeleton-thumb shimmer" />
                  <div className="skeleton-lines">
                    <div className="skeleton-line w-35 shimmer" />
                    <div className="skeleton-line w-85 shimmer" />
                    <div className="skeleton-line w-55 shimmer" />
                  </div>
                </div>
                <div className="skeleton-row shimmer" />
                <div className="skeleton-row shimmer" />
              </div>
            ))}
          </section>
        ) : groups.length === 0 ? (
          <div className="empty-state">
            No se encontraron productos de mercado para esta búsqueda. Excluimos tecnología, ropa y
            artículos ajenos a la canasta familiar; intenta otro término o limpia los filtros.
          </div>
        ) : (
          <>
            <section className="groups-grid" aria-label="Resultados de comparación">
              {visibleGroups.map((group) => {
                const itemKey = `${mode}:${group.groupId}`;
                return (
                  <ProductCard
                    key={itemKey}
                    group={group}
                    mode={mode}
                    bankPromotions={payload.bankPromotions}
                    currentDay={currentDay}
                    inBasket={basketKeys.has(itemKey)}
                    allowSubstitutes={getGroupAllowsSubstitutes(itemKey)}
                    onToggleBasket={handleToggleBasket}
                    onToggleSubstitutes={handleToggleGroupSubstitutes}
                  />
                );
              })}
            </section>

            {visibleCount < groups.length && (
              <div className="pagination-wrap">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                >
                  Mostrar {Math.min(PAGE_SIZE, groups.length - visibleCount)} productos más (
                  {groups.length - visibleCount} restantes)
                </button>
              </div>
            )}
          </>
        )}

        {basketItems.length > 0 && (
          <aside className="floating-basket-bar" aria-label="Resumen flotante de canasta">
            <div className="floating-basket-summary">
              <ShoppingBasket size={16} />
              <span>
                <strong>{basketItems.length}</strong>{" "}
                {basketItems.length === 1 ? "producto" : "productos"}
              </span>
              {activePlan && (
                <>
                  <span className="muted-inline">·</span>
                  <strong className="tabular">
                    {copFormatter.format(activePlan.totalNominalCost)}
                  </strong>
                  {activePlan.nominalSavingsCop > 0 && (
                    <span className="tag tag-best tabular">
                      Ahorras {copFormatter.format(activePlan.nominalSavingsCop)}
                    </span>
                  )}
                </>
              )}
            </div>

            <button
              type="button"
              className="btn-primary floating-basket-cta"
              onClick={() => {
                setWizardStep("confirm");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Confirmar carrito y optimizar <ArrowUp size={14} />
            </button>
          </aside>
        )}
          </>
        )}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-col">
            <h3>Sobre MercaSabio</h3>
            <p>
              Homologamos productos idénticos por código de barras EAN-13 y comparamos equivalentes
              por Precio por Unidad de Medida (PUM nominal y PUM ajustado por rendimiento real) para
              detectar el verdadero ahorro en tu mercado.
            </p>
          </div>

          <div className="footer-col">
            <h3>Cadenas monitoreadas</h3>
            <div className="footer-chains">
              {MONITORED_CHAINS.map((chain) => (
                <span key={chain} className="meta-pill">
                  {chain}
                </span>
              ))}
            </div>
          </div>

          <div className="footer-col">
            <h3>Transparencia y aviso legal</h3>
            <p>
              Los precios se actualizan periódicamente a partir de catálogos públicos y pueden variar
              en tienda física según ciudad o disponibilidad. Los botones marcados como{" "}
              <code>rel=&quot;sponsored&quot;</code> corresponden a enlaces de afiliado y alianzas
              bancarias que ayudan a financiar la plataforma sin costo adicional para ti.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
