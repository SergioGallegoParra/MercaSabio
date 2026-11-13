"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Copy,
  Download,
  LocateFixed,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  ShoppingBasket,
  ShoppingCart,
  SlidersHorizontal,
  Snowflake,
  Sparkles,
  Store,
  Trash2,
  Utensils,
} from "lucide-react";

import type {
  BasketItemInput,
  BasketOptimizationResult,
  BasketPlan,
} from "@/lib/basketOptimizer";
import { extractProductSignature, QUALITY_TIER_LABELS } from "@/lib/comparisonEngine";
import {
  ALL_BARRIOS,
  COLOMBIAN_CITIES,
  formatBasketAsPlainText,
  GUIDED_SECTIONS,
  inferBasketProfileSummary,
  inferHabitualItemProfile,
  offerMatchesSubsection,
  sizeBucketLabel,
  type GenericFoodOption,
  type PricePriorityMode,
  type ShoppingExperienceMode,
  type SizePreference,
} from "@/lib/guidedCatalog";
import { cleanProductTitle } from "@/lib/productInsights";
import type { NearbyStoreBranch, QualityTier, StoreOffer } from "@/lib/types";

const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="route-map-loading">Cargando mapa OpenStreetMap y ruta por sedes...</div>
  ),
});

export type WizardStep = "location" | "sections" | "confirm" | "results";

interface GuidedMarketWizardProps {
  experienceMode: ShoppingExperienceMode;
  onChangeExperienceMode: (mode: ShoppingExperienceMode) => void;
  wizardStep: WizardStep;
  onChangeWizardStep: (step: WizardStep) => void;
  basketItems: BasketItemInput[];
  setBasketItems: React.Dispatch<React.SetStateAction<BasketItemInput[]>>;
  knownOffers: StoreOffer[];
  nearbyBranches: NearbyStoreBranch[];
  allNearbyWithinMax: NearbyStoreBranch[];
  userLocation: { lat: number; lng: number; label: string };
  onSelectBarrio: (lat: number, lng: number, label: string) => void;
  onRequestGeolocation: () => void;
  locLoading: boolean;
  locError: string | null;
  maxDistanceMeters: number;
  onChangeMaxDistanceMeters: (meters: number) => void;
  maxStores: 1 | 2 | 3;
  onChangeMaxStores: (count: 1 | 2 | 3) => void;
  optimization: BasketOptimizationResult;
  onPrefetchTerms?: (terms: string[]) => void;
}

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

const QUALITY_TIERS: Array<{ id: QualityTier; label: string }> = [
  { id: "economico", label: "Económica" },
  { id: "estandar", label: "Estándar" },
  { id: "premium", label: "Premium" },
  { id: "especial", label: "Especial" },
];

export default function GuidedMarketWizard({
  experienceMode,
  onChangeExperienceMode,
  wizardStep,
  onChangeWizardStep,
  basketItems,
  setBasketItems,
  knownOffers,
  nearbyBranches,
  allNearbyWithinMax,
  userLocation,
  onSelectBarrio,
  onRequestGeolocation,
  locLoading,
  locError,
  maxDistanceMeters,
  onChangeMaxDistanceMeters,
  maxStores,
  onChangeMaxStores,
  optimization,
  onPrefetchTerms,
}: GuidedMarketWizardProps) {
  const [activeSectionId, setActiveSectionId] = useState<"alacena" | "nevera" | "aseo">("alacena");
  const [activeSubsectionId, setActiveSubsectionId] = useState<string>("granos");
  const [subsectionSearch, setSubsectionSearch] = useState("");
  const [editingResultItemKey, setEditingResultItemKey] = useState<string | null>(null);
  const [selectedCartView, setSelectedCartView] = useState<string>("recommended");
  const [copiedPlainText, setCopiedPlainText] = useState(false);

  // Ciudad y barrio seleccionados a partir de userLocation
  const selectedBarrio = useMemo(() => {
    return (
      ALL_BARRIOS.find(
        (b) => Math.abs(b.lat - userLocation.lat) < 0.01 && Math.abs(b.lng - userLocation.lng) < 0.01
      ) ?? ALL_BARRIOS[0]
    );
  }, [userLocation.lat, userLocation.lng]);

  const [selectedCity, setSelectedCity] = useState<string>(selectedBarrio.city);

  const currentSection = useMemo(
    () => GUIDED_SECTIONS.find((s) => s.id === activeSectionId) ?? GUIDED_SECTIONS[0],
    [activeSectionId]
  );

  const currentSubsection = useMemo(
    () =>
      currentSection.subsections.find((sub) => sub.id === activeSubsectionId) ??
      currentSection.subsections[0],
    [currentSection, activeSubsectionId]
  );

  const allSubsectionsFlat = useMemo(
    () =>
      GUIDED_SECTIONS.flatMap((sec) =>
        sec.subsections.map((sub) => ({ sectionId: sec.id, subsection: sub }))
      ),
    []
  );

  const currentFlatIndex = allSubsectionsFlat.findIndex(
    (entry) => entry.subsection.id === currentSubsection.id
  );

  // Productos con marca filtrados para Opción 2 (Mercado Habitual) en la subsección actual
  const habitualOffersInSubsection = useMemo(() => {
    if (experienceMode !== "habitual_guided") return [];
    const q = subsectionSearch.trim().toLowerCase();
    const matched = knownOffers.filter((offer) => {
      if (!offer.inStock || offer.calibratedPrice <= 0) return false;
      if (!offerMatchesSubsection(offer, currentSubsection)) return false;
      if (q) {
        return `${offer.rawName} ${offer.brand ?? ""} ${offer.storeName}`.toLowerCase().includes(q);
      }
      return true;
    });
    return matched.sort((a, b) => a.calibratedPrice - b.calibratedPrice).slice(0, 36);
  }, [experienceMode, knownOffers, currentSubsection, subsectionSearch]);

  const basketProfile = useMemo(() => inferBasketProfileSummary(basketItems), [basketItems]);

  const minNearestMeters = useMemo(() => {
    const rawMin = optimization.minNearestDistanceMeters;
    if (rawMin !== null && rawMin > 0) return Math.max(300, rawMin);
    if (allNearbyWithinMax.length > 0) {
      return Math.max(
        300,
        Math.round(Math.min(...allNearbyWithinMax.map((b) => b.distanceMeters)))
      );
    }
    return 500;
  }, [optimization.minNearestDistanceMeters, allNearbyWithinMax]);

  const effectiveDistance = Math.max(minNearestMeters, maxDistanceMeters);

  // Cuál plan está viéndose en Pantalla 4 (Plan recomendado vs Carrito por supermercado individual)
  const displayedPlan: BasketPlan | null = useMemo(() => {
    if (selectedCartView === "recommended") {
      return optimization.recommendedPlan;
    }
    return (
      optimization.singleStoreCarts.find((p) => p.storeStops[0]?.storeId === selectedCartView) ??
      optimization.recommendedPlan
    );
  }, [selectedCartView, optimization]);

  const plainTextExport = useMemo(() => {
    if (!displayedPlan) return "";
    return formatBasketAsPlainText({
      mode: experienceMode,
      locationLabel: userLocation.label,
      maxDistanceMeters: effectiveDistance,
      maxStores,
      plan: displayedPlan,
      habitualBaselineCost:
        selectedCartView === "recommended"
          ? optimization.habitualBaselineCost
          : displayedPlan.baselineReferenceTotalCost,
      savingsVsHabitualCop:
        selectedCartView === "recommended"
          ? optimization.savingsVsHabitualCop
          : displayedPlan.savingsVsBaselineCop,
      savingsVsHabitualPct:
        selectedCartView === "recommended"
          ? optimization.savingsVsHabitualPct
          : displayedPlan.savingsVsBaselinePct,
      uncoveredItems: optimization.uncoveredItems,
    });
  }, [
    displayedPlan,
    experienceMode,
    userLocation.label,
    effectiveDistance,
    maxStores,
    selectedCartView,
    optimization.habitualBaselineCost,
    optimization.savingsVsHabitualCop,
    optimization.savingsVsHabitualPct,
    optimization.uncoveredItems,
  ]);

  function selectSectionAndSubsection(secId: "alacena" | "nevera" | "aseo", subId?: string) {
    setActiveSectionId(secId);
    const sec = GUIDED_SECTIONS.find((s) => s.id === secId) ?? GUIDED_SECTIONS[0];
    const targetSub = (subId && sec.subsections.find((sub) => sub.id === subId)) || sec.subsections[0];
    setActiveSubsectionId(targetSub.id);
    setSubsectionSearch("");
    if (onPrefetchTerms) {
      const terms = targetSub.foods.flatMap((f) => f.searchTerms);
      onPrefetchTerms(terms);
    }
  }

  function handleToggleGenericFood(food: GenericFoodOption) {
    const itemKey = `gen:${food.id}`;
    setBasketItems((prev) => {
      const exists = prev.some((i) => i.itemKey === itemKey);
      if (exists) {
        return prev.filter((i) => i.itemKey !== itemKey);
      }
      const firstVariant = food.variants[0];
      return [
        ...prev,
        {
          itemKey,
          label: `${food.name} · ${firstVariant.label}`,
          familyLabel: firstVariant.label,
          matchMode: "pum",
          quantity: 1,
          allowSubstitutes: true,
          subtypeFamily: firstVariant.subtypeFamily,
          broadFamily: food.broadFamily,
          targetNetContent: food.defaultTargetContent,
          targetUnitMeasure: food.defaultUnitMeasure,
          requiredCriticalAttribute: firstVariant.criticalAttribute ?? null,
          allowedQualityTiers: ["economico", "estandar"],
          pricePriority: "lowest_total",
          sizePreference: "any",
          originMode: "generic_guided",
        },
      ];
    });
  }

  function handleToggleHabitualOffer(offer: StoreOffer) {
    const itemKey = `hab:${offer.storeSkuId}`;
    setBasketItems((prev) => {
      const exists = prev.some((i) => i.itemKey === itemKey);
      if (exists) {
        return prev.filter((i) => i.itemKey !== itemKey);
      }
      const profile = inferHabitualItemProfile(offer);
      return [
        ...prev,
        {
          itemKey,
          label: cleanProductTitle(offer.rawName),
          familyLabel: profile.familyLabel,
          masterProductId: offer.masterProductId,
          canonicalSlug: offer.canonicalSlug,
          matchMode: "pum",
          quantity: 1,
          allowSubstitutes: true,
          subtypeFamily: profile.subtypeFamily,
          broadFamily: profile.broadFamily,
          targetNetContent: profile.effectiveNetContent,
          targetUnitMeasure: profile.effectiveUnitMeasure,
          anchorStoreSkuId: offer.storeSkuId,
          anchorBrand: offer.brand,
          ean: offer.ean,
          allowedQualityTiers: [profile.qualityTier],
          pricePriority: "lowest_total",
          requiredCriticalAttribute: profile.criticalAttribute,
          sizePreference: profile.sizeBucket,
          habitualReferencePriceCop: offer.calibratedPrice,
          habitualProductTitle: cleanProductTitle(offer.rawName),
          originMode: "habitual_guided",
        },
      ];
    });
  }

  function updateBasketItem(
    itemKey: string,
    updater: (prev: BasketItemInput) => BasketItemInput
  ) {
    setBasketItems((prev) =>
      prev.map((item) => (item.itemKey === itemKey ? updater(item) : item))
    );
  }

  function countMatchingOffersForGeneric(item: BasketItemInput): number {
    return knownOffers.filter((offer) => {
      if (!offer.inStock) return false;
      const sig = extractProductSignature(offer);
      if (item.targetUnitMeasure && sig.effectiveUnitMeasure !== item.targetUnitMeasure) {
        return false;
      }
      if (item.subtypeFamily && sig.subtypeFamily !== item.subtypeFamily) {
        return false;
      }
      if (item.requiredCriticalAttribute) {
        const attr = sig.criticalAttribute;
        if (!attr || !attr.includes(item.requiredCriticalAttribute)) return false;
      }
      return true;
    }).length;
  }

  async function handleCopyPlainText() {
    if (!plainTextExport) return;
    try {
      await navigator.clipboard.writeText(plainTextExport);
      setCopiedPlainText(true);
      window.setTimeout(() => setCopiedPlainText(false), 2200);
    } catch {
      // Fallback silencioso
    }
  }

  function handleDownloadPlainText() {
    if (!plainTextExport) return;
    const blob = new Blob([plainTextExport], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lista-mercado-mercasabio.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const cityObj =
    COLOMBIAN_CITIES.find((c) => c.city === selectedCity) ?? COLOMBIAN_CITIES[0];

  const nearestBranch = useMemo(() => {
    if (allNearbyWithinMax.length === 0) return nearbyBranches[0] ?? null;
    return [...allNearbyWithinMax].sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
  }, [allNearbyWithinMax, nearbyBranches]);

  return (
    <section className="wizard-shell" aria-label="Selector de modalidad de compra">
      {/* Selector superior de las 3 Opciones */}
      <div className="mode-cards-grid" role="tablist" aria-label="Elige cómo quieres hacer tu mercado">
        <button
          type="button"
          role="tab"
          aria-selected={experienceMode === "generic_guided"}
          className={`experience-mode-card ${experienceMode === "generic_guided" ? "is-active" : ""}`}
          onClick={() => {
            onChangeExperienceMode("generic_guided");
            if (wizardStep === "results" && basketItems.length === 0) {
              onChangeWizardStep("location");
            } else if (experienceMode === "free_shop") {
              onChangeWizardStep("location");
            }
          }}
        >
          <div className="exp-card-badge">Opción 1 · Sin marcas</div>
          <div className="exp-card-title">
            <SlidersHorizontal size={17} />
            Mercado Genérico por Características
          </div>
          <p className="exp-card-desc">
            Recorre Alacena y Nevera sin listas interminables; elige qué alimento buscas y sus
            características (ej. leche deslactosada, gama económica, menor PUM).
          </p>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={experienceMode === "habitual_guided"}
          className={`experience-mode-card ${experienceMode === "habitual_guided" ? "is-active" : ""}`}
          onClick={() => {
            onChangeExperienceMode("habitual_guided");
            if (experienceMode === "free_shop") {
              onChangeWizardStep("location");
            }
          }}
        >
          <div className="exp-card-badge">Opción 2 · Con tus marcas</div>
          <div className="exp-card-title">
            <Sparkles size={17} />
            Mi Mercado Habitual Optimizado
          </div>
          <p className="exp-card-desc">
            Elige por secciones los productos específicos que compras siempre; detectamos tu perfil
            y calculamos cuánto ahorras frente a tu precio normal.
          </p>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={experienceMode === "free_shop"}
          className={`experience-mode-card ${experienceMode === "free_shop" ? "is-active" : ""}`}
          onClick={() => {
            onChangeExperienceMode("free_shop");
            onChangeWizardStep("sections");
          }}
        >
          <div className="exp-card-badge">Opción 3 · Tienda completa</div>
          <div className="exp-card-title">
            <ShoppingCart size={17} />
            Compra Libre en Catálogo
          </div>
          <p className="exp-card-desc">
            Explora toda la tienda con buscador y filtros como cualquier supermercado web y confirma
            tu carrito para optimizarlo al final.
          </p>
        </button>
      </div>

      {/* Si el usuario está en Opción 3 explorando el catálogo completo, mostramos solo el banner de carrito libre arriba */}
      {experienceMode === "free_shop" && wizardStep === "sections" ? (
        <div className="free-shop-banner">
          <div className="free-shop-info">
            <ShoppingBasket size={18} className="accent-icon" />
            <div>
              <strong>Modo Compra Libre activo:</strong> explora las tarjetas abajo con buscador y
              filtros, agrega productos con <strong>+ Canasta</strong> y cuando estés listo confirma
              tu carrito.
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={basketItems.length === 0}
            onClick={() => onChangeWizardStep("confirm")}
          >
            Confirmar carrito y optimizar ({basketItems.length}) <ArrowRight size={15} />
          </button>
        </div>
      ) : (
        <div className="wizard-card">
          {/* Indicador de pasos */}
          <div className="wizard-stepper">
            {experienceMode !== "free_shop" && (
              <>
                <button
                  type="button"
                  className={`wizard-step-pill ${wizardStep === "location" ? "is-active" : ""}`}
                  onClick={() => onChangeWizardStep("location")}
                >
                  <span className="step-num">1</span> Ciudad y Barrio
                </button>
                <button
                  type="button"
                  className={`wizard-step-pill ${wizardStep === "sections" ? "is-active" : ""}`}
                  onClick={() => onChangeWizardStep("sections")}
                >
                  <span className="step-num">2</span> Armar Mercado
                </button>
              </>
            )}
            <button
              type="button"
              className={`wizard-step-pill ${wizardStep === "confirm" ? "is-active" : ""}`}
              disabled={basketItems.length === 0}
              onClick={() => onChangeWizardStep("confirm")}
            >
              <span className="step-num">{experienceMode === "free_shop" ? "1" : "3"}</span>{" "}
              Confirmar Distancia y Tiendas
            </button>
            <button
              type="button"
              className={`wizard-step-pill ${wizardStep === "results" ? "is-active" : ""}`}
              disabled={basketItems.length === 0}
              onClick={() => onChangeWizardStep("results")}
            >
              <span className="step-num">{experienceMode === "free_shop" ? "2" : "4"}</span>{" "}
              Carritos Optimizados y Lista
            </button>
          </div>

          {/* PASO 1: CIUDAD Y BARRIO */}
          {wizardStep === "location" && (
            <div className="wizard-panel">
              <div className="wizard-panel-head">
                <div>
                  <h2>¿En qué ciudad y barrio vas a hacer tu mercado?</h2>
                  <p className="group-subtitle">
                    Con tu zona calculamos el supermercado más cercano en nuestra base de datos, que
                    será la distancia mínima disponible al finalizar tu carrito.
                  </p>
                </div>
                <button
                  type="button"
                  className="pill active"
                  onClick={onRequestGeolocation}
                  disabled={locLoading}
                >
                  <LocateFixed size={14} /> {locLoading ? "Ubicando..." : "Usar mi ubicación GPS"}
                </button>
              </div>

              <div className="location-selectors-grid">
                <div className="field-block">
                  <label htmlFor="wizard-city-select">Ciudad</label>
                  <select
                    id="wizard-city-select"
                    className="wizard-select"
                    value={cityObj.city}
                    onChange={(e) => {
                      const nextCity = e.target.value;
                      setSelectedCity(nextCity);
                      const firstBarrio =
                        COLOMBIAN_CITIES.find((c) => c.city === nextCity)?.barrios[0] ??
                        ALL_BARRIOS[0];
                      onSelectBarrio(firstBarrio.lat, firstBarrio.lng, firstBarrio.label);
                    }}
                  >
                    {COLOMBIAN_CITIES.map((c) => (
                      <option key={c.city} value={c.city}>
                        {c.city}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-block">
                  <label htmlFor="wizard-barrio-select">Barrio / Sector</label>
                  <select
                    id="wizard-barrio-select"
                    className="wizard-select"
                    value={selectedBarrio.id}
                    onChange={(e) => {
                      const chosen = ALL_BARRIOS.find((b) => b.id === e.target.value);
                      if (chosen) {
                        onSelectBarrio(chosen.lat, chosen.lng, chosen.label);
                      }
                    }}
                  >
                    {cityObj.barrios.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.barrio}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {locError && <div className="wizard-warning">{locError}</div>}

              <div className="nearest-store-callout">
                <MapPin size={16} className="accent-icon" />
                <span>
                  Zona seleccionada: <strong>{userLocation.label}</strong>
                  {nearestBranch ? (
                    <>
                      {" "}
                      · Supermercado más cercano registrado: <strong>{nearestBranch.branchName}</strong>{" "}
                      a <strong className="tabular">{Math.round(nearestBranch.distanceMeters)} m</strong>
                    </>
                  ) : (
                    " · Consultando supermercados cercanos..."
                  )}
                </span>
              </div>

              <div className="wizard-footer-nav">
                <span className="muted">
                  Paso 1 de 4 · Puedes cambiar tu ubicación en cualquier momento
                </span>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    if (onPrefetchTerms) {
                      onPrefetchTerms(currentSubsection.foods.flatMap((f) => f.searchTerms));
                    }
                    onChangeWizardStep("sections");
                  }}
                >
                  Continuar a secciones de mercado <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* PASO 2: SECCIONES (ALACENA / NEVERA / ASEO) */}
          {wizardStep === "sections" && experienceMode !== "free_shop" && (
            <div className="wizard-panel">
              <div className="wizard-panel-head">
                <div>
                  <h2>
                    {experienceMode === "generic_guided"
                      ? "Arma tu mercado genérico sin marcas"
                      : "Selecciona los productos específicos de tu mercado habitual"}
                  </h2>
                  <p className="group-subtitle">
                    {experienceMode === "generic_guided"
                      ? "Avanza por cada sección eligiendo únicamente el alimento y las características que deseas."
                      : "Marca los productos que compras normalmente; nosotros detectamos tu perfil de gama, tipo y tamaño."}
                  </p>
                </div>
                <div className="wizard-cart-counter tabular">
                  <ShoppingBasket size={15} />
                  {basketItems.length} en carrito
                </div>
              </div>

              {/* Tabs de Secciones Principales */}
              <div className="guided-sections-bar" role="tablist">
                {GUIDED_SECTIONS.map((sec) => {
                  const secCount = basketItems.filter((item) =>
                    sec.subsections.some((sub) =>
                      sub.foods.some(
                        (f) =>
                          item.broadFamily === f.broadFamily || item.itemKey === `gen:${f.id}`
                      )
                    )
                  ).length;
                  const IconComp =
                    sec.iconName === "snowflake"
                      ? Snowflake
                      : sec.iconName === "sparkles"
                        ? Sparkles
                        : Utensils;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      role="tab"
                      aria-selected={activeSectionId === sec.id}
                      className={`guided-section-btn ${activeSectionId === sec.id ? "is-active" : ""}`}
                      onClick={() => selectSectionAndSubsection(sec.id)}
                    >
                      <IconComp size={15} />
                      <span>{sec.label}</span>
                      {secCount > 0 && <span className="tab-count tabular">{secCount}</span>}
                    </button>
                  );
                })}
              </div>

              {/* Tabs de Subsecciones */}
              <div className="guided-subsections-row">
                {currentSection.subsections.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    className={`pill ${currentSubsection.id === sub.id ? "active" : ""}`}
                    onClick={() => selectSectionAndSubsection(activeSectionId, sub.id)}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {/* Panel de características detectadas en Opción 2 */}
              {experienceMode === "habitual_guided" && basketItems.length > 0 && (
                <div className="profile-inferred-banner">
                  <div className="profile-inferred-title">
                    <Sparkles size={14} />
                    <strong>
                      Características detectadas de tu mercado ({basketProfile.totalItems} productos):
                    </strong>
                    {basketProfile.dominantTierLabel && (
                      <span className={`tag tag-tier tag-tier-${basketProfile.dominantTier}`}>
                        Perfil predominante: {basketProfile.dominantTierLabel}
                      </span>
                    )}
                  </div>
                  <div className="profile-traits-row">
                    {basketProfile.inferredTraits.map((tr) => (
                      <span key={tr.label} className="meta-pill">
                        {tr.label} ({tr.count})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* CONTENIDO OPCIÓN 1: Alimentos Genéricos + Características */}
              {experienceMode === "generic_guided" ? (
                <div className="generic-foods-grid">
                  {currentSubsection.foods.map((food) => {
                    const itemKey = `gen:${food.id}`;
                    const basketEntry = basketItems.find((i) => i.itemKey === itemKey);
                    const isAdded = Boolean(basketEntry);
                    const matchingCount = basketEntry
                      ? countMatchingOffersForGeneric(basketEntry)
                      : 0;

                    return (
                      <article
                        key={food.id}
                        className={`generic-food-card ${isAdded ? "is-selected" : ""}`}
                      >
                        <div className="generic-food-head">
                          <div>
                            <h3>{food.name}</h3>
                            <p className="group-subtitle">{food.description}</p>
                          </div>
                          <button
                            type="button"
                            className={`basket-toggle-btn ${isAdded ? "in-basket" : ""}`}
                            onClick={() => handleToggleGenericFood(food)}
                          >
                            {isAdded ? (
                              <>
                                <Check size={14} /> En carrito
                              </>
                            ) : (
                              <>
                                <Plus size={14} /> Agregar
                              </>
                            )}
                          </button>
                        </div>

                        {basketEntry && (
                          <div className="generic-traits-editor">
                            {/* Variedad / Tipo */}
                            <div className="trait-group">
                              <span className="trait-label">Tipo / Variedad:</span>
                              <div className="trait-chips">
                                {food.variants.map((variant) => {
                                  const isSelected =
                                    basketEntry.subtypeFamily === variant.subtypeFamily &&
                                    (variant.criticalAttribute ?? null) ===
                                      (basketEntry.requiredCriticalAttribute ?? null);
                                  return (
                                    <button
                                      key={variant.id}
                                      type="button"
                                      className={`trait-chip ${isSelected ? "is-active" : ""}`}
                                      onClick={() =>
                                        updateBasketItem(itemKey, (prev) => ({
                                          ...prev,
                                          label: `${food.name} · ${variant.label}`,
                                          familyLabel: variant.label,
                                          subtypeFamily: variant.subtypeFamily,
                                          requiredCriticalAttribute:
                                            variant.criticalAttribute ?? null,
                                        }))
                                      }
                                    >
                                      {variant.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Gama / Calidad */}
                            <div className="trait-group">
                              <span className="trait-label">Gama permitida (puedes marcar varias):</span>
                              <div className="trait-chips">
                                {QUALITY_TIERS.map((tier) => {
                                  const currentTiers = basketEntry.allowedQualityTiers ?? [];
                                  const active = currentTiers.includes(tier.id);
                                  return (
                                    <button
                                      key={tier.id}
                                      type="button"
                                      className={`trait-chip ${active ? "is-active" : ""}`}
                                      onClick={() =>
                                        updateBasketItem(itemKey, (prev) => {
                                          const cur = prev.allowedQualityTiers ?? [];
                                          const next = cur.includes(tier.id)
                                            ? cur.filter((t) => t !== tier.id)
                                            : [...cur, tier.id];
                                          return {
                                            ...prev,
                                            allowedQualityTiers:
                                              next.length > 0 ? next : [tier.id],
                                          };
                                        })
                                      }
                                    >
                                      {tier.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Criterio de precio + Tamaño + Cantidad */}
                            <div className="trait-row-split">
                              <div className="trait-group">
                                <span className="trait-label">Priorizar:</span>
                                <div className="trait-chips">
                                  <button
                                    type="button"
                                    className={`trait-chip ${
                                      basketEntry.pricePriority !== "lowest_pum" ? "is-active" : ""
                                    }`}
                                    onClick={() =>
                                      updateBasketItem(itemKey, (prev) => ({
                                        ...prev,
                                        pricePriority: "lowest_total",
                                      }))
                                    }
                                  >
                                    Menor valor total ($)
                                  </button>
                                  <button
                                    type="button"
                                    className={`trait-chip ${
                                      basketEntry.pricePriority === "lowest_pum" ? "is-active" : ""
                                    }`}
                                    onClick={() =>
                                      updateBasketItem(itemKey, (prev) => ({
                                        ...prev,
                                        pricePriority: "lowest_pum",
                                      }))
                                    }
                                  >
                                    Menor PUM ($/g o ml)
                                  </button>
                                </div>
                              </div>

                              <div className="trait-group">
                                <span className="trait-label">Tamaño y cantidad:</span>
                                <div className="trait-inline-controls">
                                  <select
                                    aria-label={`Tamaño para ${food.name}`}
                                    className="admin-subtype-select"
                                    value={basketEntry.sizePreference ?? "any"}
                                    onChange={(e) =>
                                      updateBasketItem(itemKey, (prev) => ({
                                        ...prev,
                                        sizePreference: e.target.value as SizePreference,
                                      }))
                                    }
                                  >
                                    <option value="any">Cualquier tamaño</option>
                                    <option value="small">Pequeño (&lt; 400 g/ml)</option>
                                    <option value="medium">Mediano (400–1200 g/ml)</option>
                                    <option value="large">Grande (&gt; 1.2 kg/L)</option>
                                  </select>
                                  <input
                                    type="number"
                                    min={1}
                                    max={20}
                                    className="basket-qty"
                                    aria-label={`Cantidad para ${food.name}`}
                                    value={basketEntry.quantity ?? 1}
                                    onChange={(e) =>
                                      updateBasketItem(itemKey, (prev) => ({
                                        ...prev,
                                        quantity: Math.max(1, Math.min(20, Number(e.target.value))),
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="trait-stock-hint tabular">
                              {matchingCount > 0
                                ? `${matchingCount} referencias disponibles en catálogo que coinciden con esta variedad.`
                                : "Cargando o ampliando catálogo de opciones compatibles..."}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                /* CONTENIDO OPCIÓN 2: Selección de productos específicos con marca en la subsección */
                <div>
                  <div className="subsection-filter-bar">
                    <input
                      type="search"
                      className="search-input"
                      placeholder={`Buscar producto específico dentro de ${currentSubsection.label}...`}
                      value={subsectionSearch}
                      onChange={(e) => setSubsectionSearch(e.target.value)}
                    />
                  </div>

                  {habitualOffersInSubsection.length === 0 ? (
                    <div className="empty-box">
                      <RefreshCw size={22} />
                      <p>
                        Aún cargando más productos de <strong>{currentSubsection.label}</strong> o
                        prueba otro término. También puedes usar la <strong>Opción 3</strong> para
                        buscar libremente en todo el catálogo.
                      </p>
                    </div>
                  ) : (
                    <div className="habitual-offers-grid">
                      {habitualOffersInSubsection.map((offer) => {
                        const itemKey = `hab:${offer.storeSkuId}`;
                        const existing = basketItems.find((i) => i.itemKey === itemKey);
                        const profile = inferHabitualItemProfile(offer);

                        return (
                          <article
                            key={offer.storeSkuId}
                            className={`habitual-sku-card ${existing ? "is-selected" : ""}`}
                          >
                            <div className="habitual-sku-top">
                              {offer.imageUrl ? (
                                <img
                                  src={offer.imageUrl}
                                  alt={cleanProductTitle(offer.rawName)}
                                  className="habitual-thumb"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="habitual-thumb-empty">
                                  <Package size={18} />
                                </div>
                              )}
                              <div className="habitual-sku-meta">
                                <div className="habitual-chips">
                                  <span className="admin-store-chip">{offer.storeName}</span>
                                  <span className={`tag tag-tier tag-tier-${profile.qualityTier}`}>
                                    {profile.qualityLabel}
                                  </span>
                                </div>
                                <h4>{cleanProductTitle(offer.rawName)}</h4>
                                <div className="admin-meta-line tabular">
                                  <strong>{copFormatter.format(offer.calibratedPrice)}</strong>
                                  <span>·</span>
                                  <span>
                                    {offer.netContent} {offer.unitMeasure}
                                  </span>
                                  <span>·</span>
                                  <span>
                                    {pumFormatter.format(offer.pumPrice)}/{offer.unitMeasure}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {existing && (
                              <div className="habitual-detected-note">
                                Detectado: {profile.summaryText}
                              </div>
                            )}

                            <div className="habitual-sku-actions">
                              <button
                                type="button"
                                className={`basket-toggle-btn ${existing ? "in-basket" : ""}`}
                                onClick={() => handleToggleHabitualOffer(offer)}
                              >
                                {existing ? (
                                  <>
                                    <Check size={14} /> En mi habitual
                                  </>
                                ) : (
                                  <>
                                    <Plus size={14} /> Lo compro siempre
                                  </>
                                )}
                              </button>
                              {existing && (
                                <input
                                  type="number"
                                  min={1}
                                  max={20}
                                  className="basket-qty"
                                  value={existing.quantity ?? 1}
                                  onChange={(e) =>
                                    updateBasketItem(itemKey, (prev) => ({
                                      ...prev,
                                      quantity: Math.max(1, Math.min(20, Number(e.target.value))),
                                    }))
                                  }
                                />
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Navegación entre subsecciones y confirmación */}
              <div className="wizard-footer-nav">
                <div className="wizard-nav-pair">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={currentFlatIndex <= 0}
                    onClick={() => {
                      const prevEntry = allSubsectionsFlat[currentFlatIndex - 1];
                      if (prevEntry) {
                        selectSectionAndSubsection(prevEntry.sectionId, prevEntry.subsection.id);
                      }
                    }}
                  >
                    <ArrowLeft size={14} /> Subsección anterior
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={currentFlatIndex >= allSubsectionsFlat.length - 1}
                    onClick={() => {
                      const nextEntry = allSubsectionsFlat[currentFlatIndex + 1];
                      if (nextEntry) {
                        selectSectionAndSubsection(nextEntry.sectionId, nextEntry.subsection.id);
                      }
                    }}
                  >
                    Siguiente subsección <ArrowRight size={14} />
                  </button>
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  disabled={basketItems.length === 0}
                  onClick={() => onChangeWizardStep("confirm")}
                >
                  Confirmar carrito ({basketItems.length}) <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* PASO 3: CONFIRMACIÓN DE CARRITO, DISTANCIA MÍNIMA Y MÁXIMO DE SUPERMERCADOS */}
          {wizardStep === "confirm" && (
            <div className="wizard-panel">
              <div className="wizard-panel-head">
                <div>
                  <h2>Confirma tu carrito y define hasta dónde quieres desplazarte</h2>
                  <p className="group-subtitle">
                    La distancia mínima siempre corresponde al supermercado más cercano registrado desde{" "}
                    <strong>{userLocation.label}</strong> ({minNearestMeters} m).
                  </p>
                </div>
                {experienceMode !== "free_shop" && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => onChangeWizardStep("sections")}
                  >
                    <ArrowLeft size={14} /> Seguir editando secciones
                  </button>
                )}
              </div>

              <div className="confirm-constraints-grid">
                {/* Distancia máxima */}
                <div className="confirm-box">
                  <div className="confirm-box-title">
                    <Compass size={16} />
                    ¿Qué tan lejos puedes ir por tu mercado?
                  </div>
                  <div className="distance-readout tabular">
                    Hasta <strong>{(effectiveDistance / 1000).toFixed(2)} km</strong> ({effectiveDistance} m)
                    <span className="muted"> · Mínimo disponible hoy: {minNearestMeters} m</span>
                  </div>
                  <input
                    type="range"
                    min={minNearestMeters}
                    max={Math.max(10000, minNearestMeters + 2000)}
                    step={100}
                    value={effectiveDistance}
                    onChange={(e) => onChangeMaxDistanceMeters(Number(e.target.value))}
                    className="distance-slider"
                    aria-label="Distancia máxima en metros"
                  />
                  <div className="trait-chips">
                    {[
                      { label: `Solo más cercano (${minNearestMeters} m)`, val: minNearestMeters },
                      { label: "1.5 km", val: Math.max(minNearestMeters, 1500) },
                      { label: "3.0 km", val: Math.max(minNearestMeters, 3000) },
                      { label: "5.0 km", val: Math.max(minNearestMeters, 5000) },
                      { label: "10.0 km", val: Math.max(minNearestMeters, 10000) },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        className={`trait-chip ${
                          Math.abs(effectiveDistance - preset.val) < 60 ? "is-active" : ""
                        }`}
                        onClick={() => onChangeMaxDistanceMeters(preset.val)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="nearby-strip">
                    <MapPin size={14} />
                    <span>
                      <strong>{nearbyBranches.length}</strong> sedes dentro de{" "}
                      {(effectiveDistance / 1000).toFixed(2)} km en {userLocation.label}.
                    </span>
                  </div>
                </div>

                {/* Máximo de supermercados */}
                <div className="confirm-box">
                  <div className="confirm-box-title">
                    <Store size={16} />
                    ¿Cuántos supermercados máximo piensas visitar?
                  </div>
                  <div className="max-stores-grid">
                    {([1, 2, 3] as const).map((num) => (
                      <button
                        key={num}
                        type="button"
                        className={`max-store-btn ${maxStores === num ? "is-active" : ""}`}
                        onClick={() => onChangeMaxStores(num)}
                      >
                        <strong>{num === 1 ? "1 supermercado" : `Hasta ${num} supermercados`}</strong>
                        <span>
                          {num === 1
                            ? "Todo en una sola parada"
                            : num === 2
                              ? "Equilibrio ideal ahorro/tiempo"
                              : "Máximo ahorro cruzado"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Resumen del carrito antes de calcular */}
              <div className="confirm-items-box">
                <h3>Productos confirmados ({basketItems.length})</h3>
                <div className="confirm-items-list">
                  {basketItems.map((item) => (
                    <div key={item.itemKey} className="confirm-item-row">
                      <div>
                        <strong>
                          {item.quantity ?? 1}x {item.label}
                        </strong>
                        <div className="muted">
                          {item.familyLabel ? `${item.familyLabel} · ` : ""}
                          {item.allowedQualityTiers && item.allowedQualityTiers.length > 0
                            ? `Gama: ${item.allowedQualityTiers
                                .map((t) => QUALITY_TIER_LABELS[t])
                                .join(", ")} · `
                            : ""}
                          {item.pricePriority === "lowest_pum" ? "Menor PUM" : "Menor total"}
                          {item.habitualReferencePriceCop
                            ? ` · Precio habitual: ${copFormatter.format(item.habitualReferencePriceCop * (item.quantity ?? 1))}`
                            : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="basket-remove"
                        aria-label={`Quitar ${item.label}`}
                        onClick={() =>
                          setBasketItems((prev) => prev.filter((i) => i.itemKey !== item.itemKey))
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="wizard-footer-nav">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() =>
                    onChangeWizardStep(experienceMode === "free_shop" ? "sections" : "sections")
                  }
                >
                  <ArrowLeft size={14} /> Volver al catálogo
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={basketItems.length === 0}
                  onClick={() => {
                    setSelectedCartView("recommended");
                    onChangeWizardStep("results");
                  }}
                >
                  Calcular precio más bajo y carritos <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* PASO 4: RESULTADOS OPTIMIZADOS, EDICIÓN POR PRODUCTO Y EXPORTACIÓN */}
          {wizardStep === "results" && (
            <div className="wizard-panel">
              {!displayedPlan ? (
                <div className="empty-box">
                  <Store size={26} />
                  <h3>Sin sedes o stock suficiente en {(effectiveDistance / 1000).toFixed(1)} km</h3>
                  <p>
                    Prueba ampliar un poco la distancia máxima o permitir más gamas de calidad para
                    encontrar opciones disponibles.
                  </p>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => onChangeWizardStep("confirm")}
                  >
                    Ajustar distancia o restricciones
                  </button>
                </div>
              ) : (
                <>
                  {/* HERO VISUAL PRECIO NORMAL VS PRECIO OPTIMIZADO */}
                  <div className="savings-hero-card">
                    <div className="savings-hero-col">
                      <span className="savings-hero-label">
                        {experienceMode === "generic_guided"
                          ? "Precio sin optimizar (referencia)"
                          : "Precio normal de tu mercado"}
                      </span>
                      <div className="savings-hero-baseline tabular">
                        {copFormatter.format(displayedPlan.baselineReferenceTotalCost)}
                      </div>
                      <span className="savings-hero-note">
                        {displayedPlan.coveredItems}/{displayedPlan.requestedItems} ítems cubiertos
                      </span>
                    </div>

                    <div className="savings-hero-arrow" aria-hidden="true">
                      <ArrowRight size={22} />
                    </div>

                    <div className="savings-hero-col">
                      <span className="savings-hero-label">Precio optimizado MercaSabio</span>
                      <div className="savings-hero-optimized tabular">
                        {copFormatter.format(displayedPlan.totalNominalCost)}
                      </div>
                      <span className="savings-hero-note">
                        En {displayedPlan.storeStops.length} supermercado(s) · máx.{" "}
                        {(effectiveDistance / 1000).toFixed(1)} km
                      </span>
                    </div>

                    <div className="savings-hero-highlight">
                      <div className="savings-pill-big tabular">
                        {displayedPlan.savingsVsBaselineCop > 0 ? (
                          <>
                            ¡Ahorras {copFormatter.format(displayedPlan.savingsVsBaselineCop)} (
                            {displayedPlan.savingsVsBaselinePct}%)!
                          </>
                        ) : (
                          "Ya estás en el mínimo disponible"
                        )}
                      </div>
                      {displayedPlan.savingsVsBaselineCop > 0 && (
                        <div className="savings-projection tabular">
                          Equivale a ~{copFormatter.format(displayedPlan.savingsVsBaselineCop * 4)}
                          /mes en 4 mercados
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Selector de vista: Plan Óptimo vs Carrito por cada Supermercado */}
                  <div className="cart-compare-tabs" role="tablist">
                    <button
                      type="button"
                      className={`admin-tab-btn ${selectedCartView === "recommended" ? "is-active" : ""}`}
                      onClick={() => setSelectedCartView("recommended")}
                    >
                      Plan Óptimo ({optimization.recommendedPlan?.storeStops.length ?? 1} tienda/s ·{" "}
                      {copFormatter.format(optimization.recommendedPlan?.totalNominalCost ?? 0)})
                    </button>
                    {optimization.singleStoreCarts.map((cart) => {
                      const sId = cart.storeStops[0]?.storeId ?? "";
                      const sName = cart.storeStops[0]?.storeName ?? sId;
                      return (
                        <button
                          key={sId}
                          type="button"
                          className={`admin-tab-btn ${selectedCartView === sId ? "is-active" : ""}`}
                          onClick={() => setSelectedCartView(sId)}
                        >
                          Solo {sName} ({cart.coveredItems}/{cart.requestedItems} ·{" "}
                          {copFormatter.format(cart.totalNominalCost)})
                        </button>
                      );
                    })}
                  </div>

                  {/* Carrito por Supermercado con intercambio de producto y ajuste de características */}
                  <div className="store-carts-stack">
                    {displayedPlan.storeStops.map((stop) => (
                      <article key={stop.storeId} className="store-cart-card">
                        <header className="store-cart-header">
                          <div>
                            <h3>
                              {stop.storeName} ·{" "}
                              <span className="muted">{stop.branch.branchName}</span>
                            </h3>
                            <div className="muted">
                              {stop.branch.address ? `${stop.branch.address} · ` : ""}a{" "}
                              {Math.round(stop.branch.distanceMeters)} m de {userLocation.label}
                            </div>
                          </div>
                          <div className="store-cart-subtotal tabular">
                            <span>Subtotal esperado</span>
                            <strong>{copFormatter.format(stop.subtotalNominal)}</strong>
                          </div>
                        </header>

                        <div className="store-cart-items">
                          {stop.allocations.map((alloc) => {
                            const itemObj = basketItems.find((i) => i.itemKey === alloc.itemKey);
                            const isEditing = editingResultItemKey === alloc.itemKey;

                            return (
                              <div key={alloc.itemKey} className="cart-alloc-block">
                                <div className="cart-alloc-main">
                                  <div>
                                    <div className="cart-alloc-title">
                                      <span className="tabular">{alloc.quantity}x</span>{" "}
                                      <strong>{cleanProductTitle(alloc.offer.rawName)}</strong>{" "}
                                      <span className="meta-pill tabular">
                                        {alloc.offer.netContent} {alloc.offer.unitMeasure}
                                      </span>
                                    </div>
                                    <div className="cart-alloc-constraints">
                                      {alloc.activeConstraintsLabel} ·{" "}
                                      {pumFormatter.format(alloc.nominalPum)}/
                                      {alloc.offer.unitMeasure}
                                    </div>
                                  </div>

                                  <div className="cart-alloc-right">
                                    <strong className="cart-alloc-price tabular">
                                      {copFormatter.format(alloc.nominalCost)}
                                    </strong>
                                    <button
                                      type="button"
                                      className="btn-ghost"
                                      onClick={() =>
                                        setEditingResultItemKey(isEditing ? null : alloc.itemKey)
                                      }
                                    >
                                      <SlidersHorizontal size={13} /> Modificar características
                                    </button>
                                  </div>
                                </div>

                                {/* Selector de cambio de producto dentro del mismo supermercado */}
                                {alloc.alternativesInStore.length > 1 && (
                                  <div className="cart-swap-row">
                                    <label htmlFor={`swap-${stop.storeId}-${alloc.itemKey}`}>
                                      Cambiar producto en {stop.storeName} (mismas características):
                                    </label>
                                    <select
                                      id={`swap-${stop.storeId}-${alloc.itemKey}`}
                                      className="admin-subtype-select"
                                      value={alloc.offer.storeSkuId}
                                      onChange={(e) => {
                                        const nextSkuId = e.target.value;
                                        updateBasketItem(alloc.itemKey, (prev) => ({
                                          ...prev,
                                          preferredSkuByStore: {
                                            ...(prev.preferredSkuByStore ?? {}),
                                            [stop.storeId]: nextSkuId,
                                          },
                                        }));
                                      }}
                                    >
                                      {alloc.alternativesInStore.map((alt) => (
                                        <option key={alt.storeSkuId} value={alt.storeSkuId}>
                                          {cleanProductTitle(alt.rawName)} ({alt.netContent}{" "}
                                          {alt.unitMeasure}) —{" "}
                                          {copFormatter.format(alt.calibratedPrice)} (
                                          {pumFormatter.format(alt.pumPrice)}/{alt.unitMeasure})
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}

                                {/* Panel en vivo para modificar características y ampliar posibilidades */}
                                {isEditing && itemObj && (
                                  <div className="inline-traits-drawer">
                                    <div className="trait-group">
                                      <span className="trait-label">Gamas permitidas (amplía para ver más opciones):</span>
                                      <div className="trait-chips">
                                        {QUALITY_TIERS.map((tier) => {
                                          const active = (itemObj.allowedQualityTiers ?? []).includes(
                                            tier.id
                                          );
                                          return (
                                            <button
                                              key={tier.id}
                                              type="button"
                                              className={`trait-chip ${active ? "is-active" : ""}`}
                                              onClick={() =>
                                                updateBasketItem(itemObj.itemKey, (prev) => {
                                                  const cur = prev.allowedQualityTiers ?? [];
                                                  const next = cur.includes(tier.id)
                                                    ? cur.filter((t) => t !== tier.id)
                                                    : [...cur, tier.id];
                                                  return {
                                                    ...prev,
                                                    allowedQualityTiers: next,
                                                    preferredSkuByStore: undefined,
                                                  };
                                                })
                                              }
                                            >
                                              {tier.label}
                                            </button>
                                          );
                                        })}
                                        <button
                                          type="button"
                                          className={`trait-chip ${
                                            !itemObj.allowedQualityTiers ||
                                            itemObj.allowedQualityTiers.length === 0 ||
                                            itemObj.allowedQualityTiers.length === 4
                                              ? "is-active"
                                              : ""
                                          }`}
                                          onClick={() =>
                                            updateBasketItem(itemObj.itemKey, (prev) => ({
                                              ...prev,
                                              allowedQualityTiers: [
                                                "economico",
                                                "estandar",
                                                "premium",
                                                "especial",
                                              ],
                                              preferredSkuByStore: undefined,
                                            }))
                                          }
                                        >
                                          Todas las gamas
                                        </button>
                                      </div>
                                    </div>

                                    <div className="trait-row-split">
                                      <div className="trait-group">
                                        <span className="trait-label">Criterio de precio:</span>
                                        <div className="trait-chips">
                                          <button
                                            type="button"
                                            className={`trait-chip ${
                                              itemObj.pricePriority !== "lowest_pum"
                                                ? "is-active"
                                                : ""
                                            }`}
                                            onClick={() =>
                                              updateBasketItem(itemObj.itemKey, (prev) => ({
                                                ...prev,
                                                pricePriority: "lowest_total" as PricePriorityMode,
                                                preferredSkuByStore: undefined,
                                              }))
                                            }
                                          >
                                            Menor valor total
                                          </button>
                                          <button
                                            type="button"
                                            className={`trait-chip ${
                                              itemObj.pricePriority === "lowest_pum"
                                                ? "is-active"
                                                : ""
                                            }`}
                                            onClick={() =>
                                              updateBasketItem(itemObj.itemKey, (prev) => ({
                                                ...prev,
                                                pricePriority: "lowest_pum" as PricePriorityMode,
                                                preferredSkuByStore: undefined,
                                              }))
                                            }
                                          >
                                            Menor PUM
                                          </button>
                                        </div>
                                      </div>

                                      <div className="trait-group">
                                        <span className="trait-label">Tamaño y sustitutos:</span>
                                        <div className="trait-inline-controls">
                                          <select
                                            className="admin-subtype-select"
                                            value={itemObj.sizePreference ?? "any"}
                                            onChange={(e) =>
                                              updateBasketItem(itemObj.itemKey, (prev) => ({
                                                ...prev,
                                                sizePreference: e.target.value as SizePreference,
                                                preferredSkuByStore: undefined,
                                              }))
                                            }
                                          >
                                            <option value="any">{sizeBucketLabel("any")}</option>
                                            <option value="small">{sizeBucketLabel("small")}</option>
                                            <option value="medium">{sizeBucketLabel("medium")}</option>
                                            <option value="large">{sizeBucketLabel("large")}</option>
                                          </select>
                                          <button
                                            type="button"
                                            className={`trait-chip ${
                                              itemObj.allowSubstitutes ? "is-active" : ""
                                            }`}
                                            onClick={() =>
                                              updateBasketItem(itemObj.itemKey, (prev) => ({
                                                ...prev,
                                                allowSubstitutes: !prev.allowSubstitutes,
                                                preferredSkuByStore: undefined,
                                              }))
                                            }
                                          >
                                            {itemObj.allowSubstitutes
                                              ? "Sustitutos: Sí"
                                              : "Solo marca exacta"}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    ))}
                  </div>

                  {/* Mapa OpenStreetMap de las sedes del carrito */}
                  {displayedPlan.storeStops.length > 0 && (
                    <RouteMap
                      userLocation={userLocation}
                      stops={displayedPlan.storeStops.map((s) => ({
                        ...s.branch,
                        storeName: s.storeName,
                      }))}
                    />
                  )}

                  {/* Exportación en Texto Plano */}
                  <section className="plain-export-box" aria-label="Exportar lista en texto plano">
                    <div className="plain-export-head">
                      <div>
                        <h3>Exportar lista de compra en texto plano</h3>
                        <p className="group-subtitle">
                          Incluye cada supermercado recomendado, sus productos, precios esperados y el
                          total estimado para llevar en el celular.
                        </p>
                      </div>
                      <div className="plain-export-actions">
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => void handleCopyPlainText()}
                        >
                          <Copy size={14} />{" "}
                          {copiedPlainText ? "¡Lista copiada!" : "Copiar texto plano"}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handleDownloadPlainText}
                        >
                          <Download size={14} /> Descargar .txt
                        </button>
                      </div>
                    </div>
                    <pre className="plain-export-pre">{plainTextExport}</pre>
                  </section>

                  <div className="wizard-footer-nav">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onChangeWizardStep("confirm")}
                    >
                      <ArrowLeft size={14} /> Cambiar distancia o máx. tiendas
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => onChangeWizardStep("sections")}
                    >
                      Agregar o quitar productos
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
