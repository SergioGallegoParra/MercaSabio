"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import type {
  BasketAllocation,
  BasketItemInput,
  BasketOptimizationResult,
  BasketPlan,
} from "@/lib/basketOptimizer";
import { extractProductSignature, QUALITY_TIER_LABELS } from "@/lib/comparisonEngine";
import {
  ALL_BARRIOS,
  buildDefaultGenericBasketItems,
  COLOMBIAN_CITIES,
  formatBasketAsPlainText,
  getAvailableBrandsForItem,
  getSectionIdForItem,
  getSubsectionForItem,
  GUIDED_SECTIONS,
  inferBasketProfileSummary,
  inferHabitualItemProfile,
  offerMatchesSubsection,
  sizeBucketLabel,
  type GenericFoodOption,
  type GuidedSubsection,
  type PricePriorityMode,
  type ShoppingExperienceMode,
  type SizePreference,
} from "@/lib/guidedCatalog";
import { cleanProductTitle } from "@/lib/productInsights";
import type { NearbyStoreBranch, QualityTier, StoreOffer } from "@/lib/types";
import type { RouteSummary } from "@/components/RouteMap";

const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="hearth-card" style={{ textAlign: "center", padding: "28px 14px" }}>
      Cargando mapa OpenStreetMap...
    </div>
  ),
});

export type WizardStep =
  | "mode"
  | "location"
  | "section_1"
  | "section_2"
  | "section_3"
  | "confirm"
  | "exclude_brands"
  | "results"
  | "route";

type StoreCountLimit = 1 | 2 | 3 | 4 | 5;

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
  maxStores: StoreCountLimit;
  onChangeMaxStores: (count: StoreCountLimit) => void;
  optimization: BasketOptimizationResult;
  onPrefetchTerms?: (terms: string[]) => void;
  onSearchFreeShop?: (query: string) => Promise<void> | void;
  isDemoData?: boolean;
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

const SIZE_OPTIONS: Array<{ id: SizePreference; label: string }> = [
  { id: "any", label: "Cualquiera" },
  { id: "small", label: "Pequeña" },
  { id: "medium", label: "Mediana" },
  { id: "large", label: "Grande" },
];

function getStepMeta(
  step: WizardStep,
  mode: ShoppingExperienceMode
): { stepNumber: number | null; badge: string; progressPct: number } {
  switch (step) {
    case "mode":
      return { stepNumber: 1, badge: "Ahorro consciente", progressPct: 14 };
    case "location":
      return { stepNumber: 2, badge: "Cobertura local", progressPct: 28 };
    case "section_1":
      return {
        stepNumber: 3,
        badge:
          mode === "free_shop"
            ? "Catálogo abierto"
            : mode === "habitual_guided"
              ? "Mi Historial"
              : "Alacena básica",
        progressPct: 42,
      };
    case "section_2":
      return {
        stepNumber: 4,
        badge: mode === "habitual_guided" ? "Mi Historial" : "Refrigerados",
        progressPct: 57,
      };
    case "section_3":
      return {
        stepNumber: 5,
        badge: mode === "habitual_guided" ? "Mi Historial" : "Hogar & Cuidado",
        progressPct: 71,
      };
    case "confirm":
      return {
        stepNumber: 6,
        badge: mode === "habitual_guided" ? "Revisión habitual" : "Revisión previa",
        progressPct: 86,
      };
    case "exclude_brands":
      return { stepNumber: 7, badge: "Filtro de exclusión", progressPct: 100 };
    case "results":
      return { stepNumber: null, badge: "Cálculo completado", progressPct: 100 };
    case "route":
      return { stepNumber: null, badge: "Modo compra", progressPct: 100 };
  }
}

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
  onSearchFreeShop,
  isDemoData = false,
}: GuidedMarketWizardProps) {
  // Paso 3/4/5 Genérico: tarjeta en edición de preferencias o selector "+ Agregar"
  const [editingPrefKey, setEditingPrefKey] = useState<string | null>(null);
  const [addingGenericSubId, setAddingGenericSubId] = useState<string | null>(null);

  // Paso 3/4/5 Habitual: Pop-up / Bottom sheet "Agregar a [Subsección]"
  const [habitualModalSub, setHabitualModalSub] = useState<GuidedSubsection | null>(null);
  const [habitualModalQuery, setHabitualModalQuery] = useState("");
  const [habitualModalTier, setHabitualModalTier] = useState<QualityTier | "all">("all");
  const [habitualModalSelectedSku, setHabitualModalSelectedSku] = useState<StoreOffer | null>(null);

  // Paso 3 Exploración Libre
  const [freeQuery, setFreeQuery] = useState("");
  const [freeSectionFilter, setFreeSectionFilter] = useState<"all" | "alacena" | "nevera" | "aseo">("all");
  const [freeSubsectionFilter, setFreeSubsectionFilter] = useState<string>("all");
  const [freeSort, setFreeSort] = useState<"pum" | "price" | "name">("pum");
  const [freeSearching, setFreeSearching] = useState(false);

  // Paso 7 Exclusión de marcas
  const [customExcludedBrand, setCustomExcludedBrand] = useState<Record<string, string>>({});

  // Pantalla 8 Resultados: alternativa inline abierta + ajuste de paradas
  const [swapItemKey, setSwapItemKey] = useState<string | null>(null);

  // Pantalla 9 Ruta y Checklist
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportAllocKey, setReportAllocKey] = useState<string>("");
  const [reportReason, setReportReason] = useState<
    "distinta_calidad" | "distinto_producto" | "tamano_incomparable" | "otro"
  >("otro");
  const [reportComment, setReportComment] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);

  const selectedCityObj = useMemo(() => {
    const match = ALL_BARRIOS.find(
      (b) =>
        Math.abs(b.lat - userLocation.lat) < 0.004 &&
        Math.abs(b.lng - userLocation.lng) < 0.004
    );
    return (
      COLOMBIAN_CITIES.find((c) => c.city === (match?.city ?? "Bogotá")) ??
      COLOMBIAN_CITIES[0]
    );
  }, [userLocation.lat, userLocation.lng]);

  const selectedBarrioId = useMemo(() => {
    const match = ALL_BARRIOS.find(
      (b) =>
        Math.abs(b.lat - userLocation.lat) < 0.004 &&
        Math.abs(b.lng - userLocation.lng) < 0.004
    );
    return match?.id ?? "custom";
  }, [userLocation.lat, userLocation.lng]);

  const minNearestMeters = useMemo(() => {
    if (allNearbyWithinMax.length === 0) return 500;
    return Math.max(
      400,
      Math.round(Math.min(...allNearbyWithinMax.map((b) => b.distanceMeters)))
    );
  }, [allNearbyWithinMax]);

  const clampedDistanceMeters = Math.max(maxDistanceMeters, minNearestMeters);

  // Plan exacto al límite maxStores elegido por el usuario (para el stepper -/+ en Pantalla 8)
  const activePlan = useMemo<BasketPlan | null>(() => {
    const byCount: Partial<Record<StoreCountLimit, BasketPlan | null | undefined>> = {
      1: optimization.bestOneStore,
      2: optimization.bestTwoStores,
      3: optimization.bestThreeStores,
      4: optimization.bestFourStores,
      5: optimization.bestFiveStores,
    };
    const exactMatch = byCount[maxStores];
    if (exactMatch) return exactMatch;
    return optimization.recommendedPlan;
  }, [optimization, maxStores]);

  const habitualProfileSummary = useMemo(
    () => inferBasketProfileSummary(basketItems),
    [basketItems]
  );

  const nearbyStoreIds = useMemo(
    () => new Set(nearbyBranches.map((b) => b.storeId)),
    [nearbyBranches]
  );

  // Mapea itemKey -> BasketItemInput para lookup rápido en Resultados/Exclusiones
  const basketByKey = useMemo(() => {
    const map = new Map<string, BasketItemInput>();
    for (const item of basketItems) map.set(item.itemKey, item);
    return map;
  }, [basketItems]);

  // Agrupación de basketItems por sección y subsección
  const groupedBasketSections = useMemo(() => {
    return GUIDED_SECTIONS.map((sec) => {
      const secItems = basketItems.filter((item) => getSectionIdForItem(item) === sec.id);
      const subGroups = sec.subsections
        .map((sub) => ({
          sub,
          items: secItems.filter(
            (item) => getSubsectionForItem(item).subsectionId === sub.id
          ),
        }))
        .filter((g) => g.items.length > 0);
      return { section: sec, items: secItems, subGroups };
    }).filter((g) => g.items.length > 0);
  }, [basketItems]);

  // Filtrado de SKUs para el pop-up de Mi Mercado Habitual
  const habitualModalOffers = useMemo(() => {
    if (!habitualModalSub) return [];
    const q = habitualModalQuery.trim().toLowerCase();
    const filtered = knownOffers.filter((offer) => {
      if (!offer.inStock) return false;
      if (q) {
        const hay = `${offer.rawName} ${offer.brand} ${offer.storeName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      } else if (!offerMatchesSubsection(offer, habitualModalSub)) {
        return false;
      }
      if (habitualModalTier !== "all") {
        const sig = extractProductSignature(offer);
        const tier = sig.lexicalTierHint ?? "estandar";
        if (tier !== habitualModalTier) return false;
      }
      return true;
    });

    return filtered
      .sort((a, b) => {
        const aNear = nearbyStoreIds.has(a.storeId) ? 0 : 1;
        const bNear = nearbyStoreIds.has(b.storeId) ? 0 : 1;
        if (aNear !== bNear) return aNear - bNear;
        return a.pumPrice - b.pumPrice;
      })
      .slice(0, 30);
  }, [habitualModalSub, habitualModalQuery, habitualModalTier, knownOffers, nearbyStoreIds]);

  // Ofertas para Exploración Libre agrupadas por sección
  const freeShopSections = useMemo(() => {
    if (experienceMode !== "free_shop" || wizardStep !== "section_1") return [];
    const q = freeQuery.trim().toLowerCase();

    return GUIDED_SECTIONS.filter(
      (sec) => freeSectionFilter === "all" || sec.id === freeSectionFilter
    )
      .map((sec, idx) => {
        const activeSub =
          freeSubsectionFilter !== "all"
            ? sec.subsections.find((s) => s.id === freeSubsectionFilter) ?? null
            : null;

        if (freeSubsectionFilter !== "all" && !activeSub) {
          return { section: sec, number: idx + 1, offers: [] as StoreOffer[] };
        }

        const matched = knownOffers.filter((offer) => {
          if (!offer.inStock) return false;
          if (q) {
            const hay = `${offer.rawName} ${offer.brand} ${offer.storeName}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          if (activeSub) {
            return offerMatchesSubsection(offer, activeSub);
          }
          return sec.subsections.some((sub) => offerMatchesSubsection(offer, sub));
        });

        const sorted = [...matched].sort((a, b) => {
          if (freeSort === "price") return a.calibratedPrice - b.calibratedPrice;
          if (freeSort === "name") return a.rawName.localeCompare(b.rawName, "es");
          return a.pumPrice - b.pumPrice;
        });

        return {
          section: sec,
          number: idx + 1,
          offers: sorted.slice(0, q ? 36 : 16),
        };
      })
      .filter((entry) => entry.offers.length > 0 || freeQuery.trim() === "");
  }, [
    experienceMode,
    wizardStep,
    freeQuery,
    freeSectionFilter,
    freeSubsectionFilter,
    freeSort,
    knownOffers,
  ]);

  const freeEstimatedTotal = useMemo(() => {
    if (activePlan && activePlan.totalNominalCost > 0) {
      return activePlan.totalNominalCost;
    }
    return basketItems.reduce(
      (sum, item) => sum + (item.habitualReferencePriceCop ?? 0) * (item.quantity ?? 1),
      0
    );
  }, [activePlan, basketItems]);

  // Agrupación de recomendaciones por sección en Pantalla 8
  const groupedResultAllocations = useMemo(() => {
    if (!activePlan) return [];
    const flatAllocs = activePlan.storeStops.flatMap((stop) => stop.allocations);
    return GUIDED_SECTIONS.map((sec) => {
      const allocs = flatAllocs.filter((alloc) => {
        const srcItem = basketByKey.get(alloc.itemKey);
        return getSectionIdForItem(srcItem ?? { label: alloc.label }) === sec.id;
      });
      const sectionBaseline = allocs.reduce((acc, a) => acc + a.baselineReferenceCost, 0);
      const sectionNominal = allocs.reduce((acc, a) => acc + a.nominalCost, 0);
      return {
        section: sec,
        allocations: allocs,
        savingsCop: Math.max(0, sectionBaseline - sectionNominal),
      };
    }).filter((group) => group.allocations.length > 0);
  }, [activePlan, basketByKey]);

  const checklistProgress = useMemo(() => {
    if (!activePlan) return { done: 0, total: 0 };
    const allocs = activePlan.storeStops.flatMap((s) => s.allocations);
    const done = allocs.filter((a) => checkedItems[a.itemKey]).length;
    return { done, total: allocs.length };
  }, [activePlan, checkedItems]);

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleContinueFromMode() {
    if (experienceMode === "generic_guided") {
      const hasGeneric = basketItems.some((i) => i.originMode === "generic_guided");
      if (basketItems.length === 0 || !hasGeneric) {
        setBasketItems(buildDefaultGenericBasketItems());
      }
    }
    onChangeWizardStep("location");
    scrollTop();
  }

  function handleConfirmLocation() {
    if (experienceMode === "generic_guided") {
      onPrefetchTerms?.(["arroz", "frijol", "pasta", "aceite", "cafe"]);
    }
    onChangeWizardStep("section_1");
    scrollTop();
  }

  function addGenericFoodItem(food: GenericFoodOption, sub: GuidedSubsection) {
    const defaultVariant = food.variants[0];
    const baseKey = `generic-${food.id}`;
    const alreadyExists = basketItems.some((i) => i.itemKey === baseKey);
    const itemKey = alreadyExists ? `${baseKey}-${Date.now()}` : baseKey;
    const nextItem: BasketItemInput = {
      itemKey,
      label: food.name,
      masterProductId: null,
      canonicalSlug: null,
      matchMode: "pum",
      quantity: 1,
      allowSubstitutes: true,
      subtypeFamily: defaultVariant?.subtypeFamily ?? food.defaultSubtype,
      broadFamily: food.broadFamily,
      familyLabel: food.name,
      targetNetContent: food.defaultTargetContent,
      targetUnitMeasure: food.defaultUnitMeasure,
      allowedQualityTiers: food.defaultQualityTiers ?? ["economico", "estandar"],
      pricePriority: food.defaultPriority ?? "lowest_pum",
      requiredCriticalAttribute: defaultVariant?.criticalAttribute ?? null,
      sizePreference: food.defaultSize ?? "medium",
      excludedBrands: [],
      sectionId: food.sectionId,
      subsectionId: sub.id,
      originMode: "generic_guided",
    };
    setBasketItems((prev) => [...prev, nextItem]);
    setEditingPrefKey(itemKey);
    setAddingGenericSubId(null);
    onPrefetchTerms?.(food.searchTerms);
  }

  function updateBasketItem(
    itemKey: string,
    updater: (prev: BasketItemInput) => BasketItemInput
  ) {
    setBasketItems((prev) =>
      prev.map((item) => (item.itemKey === itemKey ? updater(item) : item))
    );
  }

  function removeBasketItem(itemKey: string) {
    setBasketItems((prev) => prev.filter((item) => item.itemKey !== itemKey));
  }

  function toggleItemQualityTier(itemKey: string, tier: QualityTier) {
    updateBasketItem(itemKey, (prev) => {
      const current = new Set(prev.allowedQualityTiers ?? []);
      if (current.has(tier)) {
        if (current.size > 1) current.delete(tier);
      } else {
        current.add(tier);
      }
      return { ...prev, allowedQualityTiers: [...current] };
    });
  }

  function addOfferToBasket(
    offer: StoreOffer,
    origin: "habitual_guided" | "free_shop",
    forcedSub?: GuidedSubsection
  ) {
    const sig = extractProductSignature(offer);
    const inferred = inferHabitualItemProfile(offer);
    const itemKey = `${origin}:${offer.storeSkuId}`;
    const refPrice =
      offer.calibratedPrice > 0
        ? offer.calibratedPrice
        : offer.rawSalePrice > 0
          ? offer.rawSalePrice
          : offer.rawListPrice;

    const subLoc = forcedSub
      ? {
          sectionId: forcedSub.foods[0]?.sectionId ?? getSectionIdForItem({ label: offer.rawName, subtypeFamily: sig.subtypeFamily, broadFamily: sig.broadFamily }),
          subsectionId: forcedSub.id,
        }
      : getSubsectionForItem({
          label: offer.rawName,
          subtypeFamily: sig.subtypeFamily,
          broadFamily: sig.broadFamily,
        });

    setBasketItems((prev) => {
      if (prev.some((i) => i.itemKey === itemKey)) {
        return origin === "free_shop"
          ? prev.filter((i) => i.itemKey !== itemKey)
          : prev;
      }
      const next: BasketItemInput = {
        itemKey,
        label: cleanProductTitle(offer.rawName),
        masterProductId: null,
        canonicalSlug: offer.canonicalSlug,
        matchMode: "pum",
        quantity: 1,
        allowSubstitutes: true,
        subtypeFamily: sig.subtypeFamily,
        broadFamily: sig.broadFamily,
        familyLabel: inferred.familyLabel,
        targetNetContent: sig.effectiveNetContent,
        targetUnitMeasure: sig.effectiveUnitMeasure,
        anchorStoreSkuId: offer.storeSkuId,
        anchorBrand: offer.brand || sig.brandKey,
        ean: offer.ean,
        allowedQualityTiers: [inferred.qualityTier],
        pricePriority: "lowest_total",
        requiredCriticalAttribute: inferred.criticalAttribute,
        sizePreference: inferred.sizeBucket,
        habitualReferencePriceCop: refPrice,
        habitualProductTitle: cleanProductTitle(offer.rawName),
        excludedBrands: [],
        sectionId: subLoc.sectionId,
        subsectionId: subLoc.subsectionId,
        originMode: origin,
      };
      return [...prev, next];
    });
  }

  function openHabitualModal(sub: GuidedSubsection) {
    setHabitualModalSub(sub);
    setHabitualModalQuery("");
    setHabitualModalTier("all");
    setHabitualModalSelectedSku(null);
    onPrefetchTerms?.(sub.foods.flatMap((f) => f.searchTerms).slice(0, 2));
  }

  function addExcludedBrand(itemKey: string, brand: string) {
    const clean = brand.trim();
    if (!clean) return;
    updateBasketItem(itemKey, (prev) => {
      const list = prev.excludedBrands ?? [];
      if (list.some((b) => b.toLowerCase() === clean.toLowerCase())) return prev;
      return { ...prev, excludedBrands: [...list, clean] };
    });
  }

  function removeExcludedBrand(itemKey: string, brand: string) {
    updateBasketItem(itemKey, (prev) => ({
      ...prev,
      excludedBrands: (prev.excludedBrands ?? []).filter((b) => b !== brand),
    }));
  }

  function handleSelectSwapOffer(itemKey: string, offer: StoreOffer) {
    updateBasketItem(itemKey, (prev) => ({
      ...prev,
      preferredSkuByStore: {
        ...(prev.preferredSkuByStore ?? {}),
        [offer.storeId]: offer.storeSkuId,
      },
    }));
    setSwapItemKey(null);
  }

  async function handleCopyPlainText() {
    if (!activePlan) return;
    const text = formatBasketAsPlainText({
      mode: experienceMode,
      locationLabel: userLocation.label,
      maxDistanceMeters: clampedDistanceMeters,
      maxStores,
      plan: activePlan,
      habitualBaselineCost: optimization.habitualBaselineCost,
      savingsVsHabitualCop: optimization.savingsVsHabitualCop,
      savingsVsHabitualPct: optimization.savingsVsHabitualPct,
      uncoveredItems: optimization.uncoveredItems,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopiedNotice(true);
      window.setTimeout(() => setCopiedNotice(false), 2600);
    } catch {
      // Fallback en navegadores sin Clipboard API
    }
  }

  function handleDownloadPlainText() {
    if (!activePlan) return;
    const text = formatBasketAsPlainText({
      mode: experienceMode,
      locationLabel: userLocation.label,
      maxDistanceMeters: clampedDistanceMeters,
      maxStores,
      plan: activePlan,
      habitualBaselineCost: optimization.habitualBaselineCost,
      savingsVsHabitualCop: optimization.savingsVsHabitualCop,
      savingsVsHabitualPct: optimization.savingsVsHabitualPct,
      uncoveredItems: optimization.uncoveredItems,
    });
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lista-mercado-mercasabio.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmitReport() {
    if (!activePlan) return;
    const flatAllocs = activePlan.storeStops.flatMap((s) => s.allocations);
    const selectedAlloc: BasketAllocation | undefined =
      flatAllocs.find((a) => a.itemKey === reportAllocKey) ?? flatAllocs[0];
    if (!selectedAlloc) return;

    setReportSubmitting(true);
    setReportFeedback(null);

    const candidateCompare =
      selectedAlloc.runnerUpOffer?.storeSkuId &&
      selectedAlloc.runnerUpOffer.storeSkuId !== selectedAlloc.offer.storeSkuId
        ? selectedAlloc.runnerUpOffer.storeSkuId
        : selectedAlloc.alternativesInStore.find(
            (o) => o.storeSkuId !== selectedAlloc.offer.storeSkuId
          )?.storeSkuId;

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      candidateCompare &&
      uuidRe.test(selectedAlloc.offer.storeSkuId) &&
      uuidRe.test(candidateCompare)
    ) {
      try {
        const res = await fetch("/api/curation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "report_unfair",
            anchorSkuId: selectedAlloc.offer.storeSkuId,
            comparedSkuId: candidateCompare,
            reason: reportReason,
            matchTier: "direct",
            comment: reportComment || `Reportado en ruta (${selectedAlloc.offer.storeName})`,
          }),
        });
        if (res.ok) {
          setReportFeedback("¡Gracias! Enviamos tu reporte al panel de curación.");
          setReportSubmitting(false);
          setReportComment("");
          return;
        }
      } catch {
        // continúa a confirmación local de respaldo
      }
    }

    setReportFeedback("¡Reporte registrado! Lo revisaremos en nuestro monitoreo de precios.");
    setReportSubmitting(false);
    setReportComment("");
  }

  function renderPrefSummary(item: BasketItemInput): string {
    const tierText =
      item.allowedQualityTiers && item.allowedQualityTiers.length > 0
        ? item.allowedQualityTiers.map((t) => QUALITY_TIER_LABELS[t]).join("/")
        : "Estándar";
    const prioText = item.pricePriority === "lowest_total" ? "Menor precio total" : "Menor PUM";
    const sizeText = sizeBucketLabel(item.sizePreference ?? "any");
    return `${tierText} · ${prioText} · ${sizeText}`;
  }

  function renderSectionStep(sectionIndex: 0 | 1 | 2) {
    const section = GUIDED_SECTIONS[sectionIndex];
    const nextStep: WizardStep =
      sectionIndex === 0 ? "section_2" : sectionIndex === 1 ? "section_3" : "confirm";
    const prevStep: WizardStep =
      sectionIndex === 0 ? "location" : sectionIndex === 1 ? "section_1" : "section_2";
    const nextLabel =
      sectionIndex === 0
        ? "Continuar (Paso 4)"
        : sectionIndex === 1
          ? "Continuar (Paso 5)"
          : "Continuar (Paso 6)";

    const isHabitual = experienceMode === "habitual_guided";
    const sectionItems = basketItems.filter((i) => getSectionIdForItem(i) === section.id);

    // Sugerencias rápidas para Habitual
    const quickHabitualOffers = isHabitual
      ? knownOffers
          .filter((offer) =>
            section.subsections.some((sub) => offerMatchesSubsection(offer, sub))
          )
          .sort((a, b) => a.pumPrice - b.pumPrice)
          .slice(0, 5)
      : [];

    return (
      <>
        <div className="hearth-main">
          <div>
            <h1 className="hearth-step-title">
              Paso {section.stepNumber}: {section.label}
            </h1>
            <p className="hearth-step-subtitle">
              {isHabitual
                ? "Agrega los productos con tu marca y presentación habitual en cada subsección."
                : "Ajusta gama, prioridad de ahorro o presentación para cada básico que necesites."}
            </p>
          </div>

          {section.subsections.map((sub) => {
            const subItems = sectionItems.filter(
              (item) => getSubsectionForItem(item).subsectionId === sub.id
            );

            return (
              <section key={sub.id} className="hearth-subsection-block">
                <div className="hearth-subsection-header">
                  <div className="hearth-subsection-title">
                    <span className="material-symbols-outlined">{sub.materialIcon}</span>
                    <span>{sub.label}</span>
                  </div>
                  <span className="hearth-count-chip">
                    {subItems.length} {subItems.length === 1 ? "ítem" : "ítems"}
                  </span>
                </div>

                {subItems.length === 0 ? (
                  <div className="hearth-empty-subcard">
                    <strong>Sin productos</strong> — No has añadido {sub.label.toLowerCase()} aún.
                  </div>
                ) : (
                  subItems.map((item) => {
                    const isEditing = editingPrefKey === item.itemKey;
                    const catalogFood = sub.foods.find(
                      (f) =>
                        item.itemKey.includes(f.id) ||
                        f.broadFamily === item.broadFamily ||
                        f.variants.some((v) => v.subtypeFamily === item.subtypeFamily)
                    );

                    return (
                      <div key={item.itemKey} className="hearth-item-card">
                        <div className="hearth-item-top">
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="hearth-item-name">{item.label}</div>
                            <div className="hearth-pref-line">
                              {isHabitual
                                ? `${item.anchorBrand ?? "Marca"} · ${item.targetNetContent ?? ""} ${item.targetUnitMeasure ?? ""} · ${copFormatter.format(item.habitualReferencePriceCop ?? 0)}`
                                : renderPrefSummary(item)}
                            </div>
                          </div>

                          <div className="hearth-item-actions">
                            {!isHabitual && (
                              <button
                                type="button"
                                className={`hearth-edit-pref-btn ${isEditing ? "active" : ""}`}
                                onClick={() =>
                                  setEditingPrefKey(isEditing ? null : item.itemKey)
                                }
                              >
                                <span
                                  className="material-symbols-outlined"
                                  style={{ fontSize: 15 }}
                                >
                                  tune
                                </span>
                                <span>Editar Pref.</span>
                              </button>
                            )}
                            <div className="hearth-qty-stepper">
                              <button
                                type="button"
                                className="hearth-qty-btn"
                                aria-label="Disminuir cantidad"
                                onClick={() =>
                                  updateBasketItem(item.itemKey, (prev) => ({
                                    ...prev,
                                    quantity: Math.max(1, (prev.quantity ?? 1) - 1),
                                  }))
                                }
                              >
                                -
                              </button>
                              <span className="tabular" style={{ fontSize: "0.78rem", fontWeight: 700 }}>
                                {item.quantity ?? 1}
                              </span>
                              <button
                                type="button"
                                className="hearth-qty-btn"
                                aria-label="Aumentar cantidad"
                                onClick={() =>
                                  updateBasketItem(item.itemKey, (prev) => ({
                                    ...prev,
                                    quantity: Math.min(20, (prev.quantity ?? 1) + 1),
                                  }))
                                }
                              >
                                +
                              </button>
                            </div>
                            <button
                              type="button"
                              className="hearth-icon-btn danger"
                              aria-label="Eliminar producto"
                              onClick={() => removeBasketItem(item.itemKey)}
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: 16 }}
                              >
                                delete
                              </span>
                            </button>
                          </div>
                        </div>

                        {!isHabitual && isEditing && (
                          <div className="hearth-pref-drawer">
                            {catalogFood && catalogFood.variants.length > 1 && (
                              <div>
                                <div className="hearth-label" style={{ marginBottom: 4 }}>
                                  Tipo o variante
                                </div>
                                <div className="hearth-chip-group">
                                  {catalogFood.variants.map((variant) => {
                                    const active =
                                      item.subtypeFamily === variant.subtypeFamily &&
                                      (variant.criticalAttribute ?? null) ===
                                        (item.requiredCriticalAttribute ?? null);
                                    return (
                                      <button
                                        key={variant.id}
                                        type="button"
                                        className={`hearth-chip ${active ? "active" : ""}`}
                                        onClick={() =>
                                          updateBasketItem(item.itemKey, (prev) => ({
                                            ...prev,
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
                            )}

                            <div>
                              <div className="hearth-label" style={{ marginBottom: 4 }}>
                                Gama permitida
                              </div>
                              <div className="hearth-chip-group">
                                {QUALITY_TIERS.map((tier) => {
                                  const active = (item.allowedQualityTiers ?? []).includes(
                                    tier.id
                                  );
                                  return (
                                    <button
                                      key={tier.id}
                                      type="button"
                                      className={`hearth-chip ${active ? "active" : ""}`}
                                      onClick={() =>
                                        toggleItemQualityTier(item.itemKey, tier.id)
                                      }
                                    >
                                      {tier.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div>
                              <div className="hearth-label" style={{ marginBottom: 4 }}>
                                Prioridad de ahorro
                              </div>
                              <div className="hearth-chip-group">
                                {(
                                  [
                                    { id: "lowest_pum", label: "Menor PUM" },
                                    { id: "lowest_total", label: "Menor valor total" },
                                  ] as Array<{ id: PricePriorityMode; label: string }>
                                ).map((opt) => (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    className={`hearth-chip ${
                                      item.pricePriority === opt.id ? "active" : ""
                                    }`}
                                    onClick={() =>
                                      updateBasketItem(item.itemKey, (prev) => ({
                                        ...prev,
                                        pricePriority: opt.id,
                                      }))
                                    }
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <div className="hearth-label" style={{ marginBottom: 4 }}>
                                Tamaño de presentación
                              </div>
                              <div className="hearth-chip-group">
                                {SIZE_OPTIONS.map((sz) => (
                                  <button
                                    key={sz.id}
                                    type="button"
                                    className={`hearth-chip ${
                                      (item.sizePreference ?? "any") === sz.id ? "active" : ""
                                    }`}
                                    onClick={() =>
                                      updateBasketItem(item.itemKey, (prev) => ({
                                        ...prev,
                                        sizePreference: sz.id,
                                      }))
                                    }
                                  >
                                    {sz.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                {isHabitual ? (
                  <button
                    type="button"
                    className="hearth-add-dashed-btn"
                    onClick={() => openHabitualModal(sub)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      add_circle
                    </span>
                    <span>Agregar producto en {sub.label}</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="hearth-add-dashed-btn"
                      onClick={() =>
                        setAddingGenericSubId(
                          addingGenericSubId === sub.id ? null : sub.id
                        )
                      }
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        add
                      </span>
                      <span>Agregar más productos en {sub.label}</span>
                    </button>

                    {addingGenericSubId === sub.id && (
                      <div className="hearth-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className="hearth-label">Elige un alimento para añadir:</div>
                        <div className="hearth-chip-group">
                          {sub.foods.map((food) => (
                            <button
                              key={food.id}
                              type="button"
                              className="hearth-chip"
                              onClick={() => addGenericFoodItem(food, sub)}
                            >
                              + {food.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            );
          })}

          {isHabitual && quickHabitualOffers.length > 0 && (
            <div className="hearth-card">
              <div className="hearth-label" style={{ marginBottom: 8 }}>
                Sugerencias frecuentes de tu historial:
              </div>
              <div className="hearth-chip-group">
                {quickHabitualOffers.map((offer) => {
                  const added = basketItems.some(
                    (i) => i.itemKey === `habitual_guided:${offer.storeSkuId}`
                  );
                  return (
                    <button
                      key={offer.storeSkuId}
                      type="button"
                      className={`hearth-chip ${added ? "active" : ""}`}
                      onClick={() => addOfferToBasket(offer, "habitual_guided")}
                    >
                      {added ? "✓ " : "+ "}
                      {cleanProductTitle(offer.rawName).slice(0, 28)} ·{" "}
                      {copFormatter.format(offer.calibratedPrice)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="hearth-sticky-footer">
          <div className="hearth-footer-pair">
            <button
              type="button"
              className="hearth-btn-secondary"
              onClick={() => {
                onChangeWizardStep(prevStep);
                scrollTop();
              }}
            >
              ← Volver
            </button>
            <button
              type="button"
              className="hearth-btn-primary"
              disabled={sectionIndex === 2 && basketItems.length === 0}
              onClick={() => {
                onChangeWizardStep(nextStep);
                scrollTop();
              }}
            >
              <span>{nextLabel}</span>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                arrow_forward
              </span>
            </button>
          </div>
        </footer>
      </>
    );
  }

  const meta = getStepMeta(wizardStep, experienceMode);
  const modeButtonLabel =
    experienceMode === "generic_guided"
      ? "Mercado Genérico"
      : experienceMode === "habitual_guided"
        ? "Mi Mercado Habitual"
        : "Exploración Libre";

  const previewStops = useMemo(
    () =>
      nearbyBranches.slice(0, 12).map((b) => ({
        ...b,
        storeName: b.branchName.split(" ")[0] ?? b.storeId,
      })),
    [nearbyBranches]
  );

  const routeMapStops = useMemo(
    () =>
      (activePlan?.storeStops ?? []).map((stop) => ({
        ...stop.branch,
        storeName: stop.storeName,
      })),
    [activePlan]
  );

  return (
    <div className="hearth-outer">
      <div className="hearth-mobile-frame">
        {/* Sticky Hearth Header */}
        <header className="hearth-header">
          <div className="hearth-header-top">
            <button
              type="button"
              className="hearth-brand"
              onClick={() => {
                onChangeWizardStep("mode");
                scrollTop();
              }}
              title="Volver al inicio"
            >
              <span className="hearth-brand-badge">
                <span className="material-symbols-outlined">eco</span>
              </span>
              <span className="hearth-brand-name">MercaSabio</span>
            </button>

            <div className="hearth-header-actions">
              <span
                className={`hearth-pill-badge ${
                  wizardStep === "results" || wizardStep === "route" ? "amber" : ""
                }`}
              >
                {meta.badge}
              </span>
              <Link
                href="/admin"
                className="hearth-admin-link"
                title="Panel visual de curación"
                aria-label="Panel visual de curación"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  tune
                </span>
              </Link>
            </div>
          </div>

          {meta.stepNumber !== null && (
            <div className="hearth-progress-row">
              <div className="hearth-progress-meta">
                <span>Paso {meta.stepNumber} de 7</span>
                <span>{userLocation.label}</span>
              </div>
              <div className="hearth-progress-track">
                <div
                  className="hearth-progress-fill"
                  style={{ width: `${meta.progressPct}%` }}
                />
              </div>
            </div>
          )}
        </header>

        {isDemoData && (
          <div
            style={{
              margin: "10px 16px 0",
              padding: "8px 11px",
              borderRadius: 12,
              background: "var(--h-secondary-soft)",
              color: "var(--h-secondary-dark)",
              fontSize: "0.75rem",
              fontWeight: 600,
            }}
          >
            Mostrando catálogo de demostración local.
          </div>
        )}

        {/* PANTALLA 1: ELIGE CÓMO VAS A MERCAR */}
        {wizardStep === "mode" && (
          <>
            <div className="hearth-main">
              <div>
                <h1 className="hearth-step-title">Paso 1: Elige cómo vas a mercar</h1>
                <p className="hearth-step-subtitle">
                  Selecciona la experiencia que mejor se ajusta a cómo planeas tu compra hoy.
                </p>
              </div>

              <div className="hearth-mode-stack">
                <button
                  type="button"
                  className={`hearth-mode-card ${
                    experienceMode === "generic_guided" ? "active" : ""
                  }`}
                  onClick={() => onChangeExperienceMode("generic_guided")}
                >
                  <span className="hearth-mode-icon generic">
                    <span className="material-symbols-outlined">tune</span>
                  </span>
                  <div className="hearth-mode-body">
                    <div className="hearth-mode-kicker">Sin marcas · Por características</div>
                    <div className="hearth-mode-name">Mercado Genérico</div>
                    <p className="hearth-mode-desc">
                      Arma tu despensa por secciones definiendo gama, tamaño y menor PUM sin amarrarte a una marca.
                    </p>
                  </div>
                  <span className="hearth-mode-check">
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                      check
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className={`hearth-mode-card ${
                    experienceMode === "habitual_guided" ? "active" : ""
                  }`}
                  onClick={() => onChangeExperienceMode("habitual_guided")}
                >
                  <span className="hearth-mode-icon habitual">
                    <span className="material-symbols-outlined">receipt_long</span>
                  </span>
                  <div className="hearth-mode-body">
                    <div className="hearth-mode-kicker">Marcas habituales</div>
                    <div className="hearth-mode-name">Mi Mercado Habitual</div>
                    <p className="hearth-mode-desc">
                      Elige los productos exactos que siempre compras y descubre cuánto ahorras al optimizar tiendas o sustitutos.
                    </p>
                  </div>
                  <span className="hearth-mode-check">
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                      check
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className={`hearth-mode-card ${
                    experienceMode === "free_shop" ? "active" : ""
                  }`}
                  onClick={() => onChangeExperienceMode("free_shop")}
                >
                  <span className="hearth-mode-icon free">
                    <span className="material-symbols-outlined">explore</span>
                  </span>
                  <div className="hearth-mode-body">
                    <div className="hearth-mode-kicker">Catálogo abierto</div>
                    <div className="hearth-mode-name">Exploración Libre</div>
                    <p className="hearth-mode-desc">
                      Navega toda la tienda por categorías, palabras clave o menor PUM y arma tu canasta a tu ritmo.
                    </p>
                  </div>
                  <span className="hearth-mode-check">
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                      check
                    </span>
                  </span>
                </button>
              </div>
            </div>

            <footer className="hearth-sticky-footer">
              <button
                type="button"
                className="hearth-btn-primary"
                onClick={handleContinueFromMode}
              >
                <span>Continuar con {modeButtonLabel}</span>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  arrow_forward
                </span>
              </button>
            </footer>
          </>
        )}

        {/* PANTALLA 2: UBICACIÓN Y PREFERENCIAS DE RUTA */}
        {wizardStep === "location" && (
          <>
            <div className="hearth-main">
              <div>
                <h1 className="hearth-step-title">Paso 2: Selecciona tu ubicación</h1>
                <p className="hearth-step-subtitle">
                  Calcularemos distancias reales y el supermercado más cercano como punto de partida.
                </p>
              </div>

              <div className="hearth-card">
                <div className="hearth-field-row">
                  <div className="hearth-field">
                    <label className="hearth-label" htmlFor="city-select">
                      Ciudad
                    </label>
                    <select
                      id="city-select"
                      className="hearth-select"
                      value={selectedCityObj.city}
                      onChange={(e) => {
                        const nextCity =
                          COLOMBIAN_CITIES.find((c) => c.city === e.target.value) ??
                          COLOMBIAN_CITIES[0];
                        const first = nextCity.barrios[0];
                        if (first) onSelectBarrio(first.lat, first.lng, first.label);
                      }}
                    >
                      {COLOMBIAN_CITIES.map((c) => (
                        <option key={c.city} value={c.city}>
                          {c.city}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="hearth-field">
                    <label className="hearth-label" htmlFor="barrio-select">
                      Barrio / Zona
                    </label>
                    <select
                      id="barrio-select"
                      className="hearth-select"
                      value={selectedBarrioId}
                      onChange={(e) => {
                        const found = ALL_BARRIOS.find((b) => b.id === e.target.value);
                        if (found) onSelectBarrio(found.lat, found.lng, found.label);
                      }}
                    >
                      {selectedCityObj.barrios.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.barrio}
                        </option>
                      ))}
                      {selectedBarrioId === "custom" && (
                        <option value="custom">{userLocation.label}</option>
                      )}
                    </select>
                  </div>
                </div>
                {locError && (
                  <p style={{ marginTop: 8, fontSize: "0.75rem", color: "var(--h-warning)" }}>
                    {locError}
                  </p>
                )}
              </div>

              <RouteMap
                variant="location_preview"
                userLocation={userLocation}
                stops={previewStops}
                radiusMeters={clampedDistanceMeters}
                onRequestGeolocation={onRequestGeolocation}
                geoLoading={locLoading}
              />

              <div className="hearth-card hearth-slider-wrap">
                <div className="hearth-slider-header">
                  <span className="hearth-label">
                    Distancia máxima que recorres para mercar
                  </span>
                  <span className="hearth-slider-value">
                    {(clampedDistanceMeters / 1000).toFixed(1)} km
                  </span>
                </div>

                <input
                  type="range"
                  className="hearth-range"
                  min={minNearestMeters}
                  max={15000}
                  step={100}
                  value={clampedDistanceMeters}
                  onChange={(e) => onChangeMaxDistanceMeters(Number(e.target.value))}
                />

                <div className="hearth-slider-scale">
                  <span>Mín: {(minNearestMeters / 1000).toFixed(1)} km</span>
                  <span>{nearbyBranches.length} tiendas cerca</span>
                  <span>Máx: 15.0 km</span>
                </div>
              </div>

              <div className="hearth-card hearth-field">
                <label className="hearth-label" htmlFor="max-stores-select">
                  ¿Máximo a cuántos supermercados irías?
                </label>
                <select
                  id="max-stores-select"
                  className="hearth-select"
                  value={maxStores}
                  onChange={(e) =>
                    onChangeMaxStores(Number(e.target.value) as StoreCountLimit)
                  }
                >
                  <option value={1}>1 tienda (una sola parada)</option>
                  <option value={2}>2 tiendas (máximo ahorro cercano)</option>
                  <option value={3}>3 tiendas (combinación óptima)</option>
                  <option value={4}>4 tiendas (amplia cobertura)</option>
                  <option value={5}>5 tiendas (todas las cadenas)</option>
                </select>
              </div>
            </div>

            <footer className="hearth-sticky-footer">
              <div className="hearth-footer-pair">
                <button
                  type="button"
                  className="hearth-btn-secondary"
                  onClick={() => {
                    onChangeWizardStep("mode");
                    scrollTop();
                  }}
                >
                  ← Volver
                </button>
                <button
                  type="button"
                  className="hearth-btn-primary"
                  onClick={handleConfirmLocation}
                >
                  <span>Confirmar ubicación y preferencias</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    arrow_forward
                  </span>
                </button>
              </div>
            </footer>
          </>
        )}

        {/* PANTALLAS 3-5: EXPLORACIÓN LIBRE */}
        {wizardStep === "section_1" && experienceMode === "free_shop" && (
          <div className="hearth-main">
            <div>
              <h1 className="hearth-step-title">Paso 3: Explora el catálogo libre</h1>
              <p className="hearth-step-subtitle">
                Busca productos, filtra por sección o menor PUM y agrega directo a tu canasta.
              </p>
            </div>

            <div className="hearth-free-sticky">
              <form
                style={{ display: "flex", gap: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  setFreeSearching(true);
                  Promise.resolve(onSearchFreeShop?.(freeQuery)).finally(() =>
                    setFreeSearching(false)
                  );
                }}
              >
                <input
                  type="search"
                  className="hearth-input"
                  placeholder="Buscar arroz, leche, detergente, marca..."
                  value={freeQuery}
                  onChange={(e) => setFreeQuery(e.target.value)}
                />
                <button
                  type="submit"
                  className="hearth-btn-secondary"
                  style={{ minHeight: 42 }}
                  disabled={freeSearching}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    search
                  </span>
                </button>
              </form>

              <div className="hearth-scroll-pills">
                <button
                  type="button"
                  className={`hearth-pill-filter ${
                    freeSectionFilter === "all" ? "active" : ""
                  }`}
                  onClick={() => {
                    setFreeSectionFilter("all");
                    setFreeSubsectionFilter("all");
                  }}
                >
                  Ver todas (3)
                </button>
                {GUIDED_SECTIONS.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    className={`hearth-pill-filter ${
                      freeSectionFilter === sec.id ? "active" : ""
                    }`}
                    onClick={() => {
                      setFreeSectionFilter(sec.id);
                      setFreeSubsectionFilter("all");
                    }}
                  >
                    {sec.shortLabel}
                  </button>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div className="hearth-scroll-pills" style={{ flex: 1 }}>
                  <button
                    type="button"
                    className={`hearth-pill-filter ${
                      freeSubsectionFilter === "all" ? "active" : ""
                    }`}
                    onClick={() => setFreeSubsectionFilter("all")}
                  >
                    Todas subsecciones
                  </button>
                  {GUIDED_SECTIONS.filter(
                    (s) => freeSectionFilter === "all" || s.id === freeSectionFilter
                  )
                    .flatMap((s) => s.subsections)
                    .map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        className={`hearth-pill-filter ${
                          freeSubsectionFilter === sub.id ? "active" : ""
                        }`}
                        onClick={() => setFreeSubsectionFilter(sub.id)}
                      >
                        {sub.label}
                      </button>
                    ))}
                </div>

                <select
                  className="hearth-select"
                  style={{ width: "auto", minHeight: 34, padding: "4px 8px", fontSize: "0.75rem" }}
                  value={freeSort}
                  onChange={(e) =>
                    setFreeSort(e.target.value as "pum" | "price" | "name")
                  }
                >
                  <option value="pum">Menor PUM</option>
                  <option value="price">Menor precio</option>
                  <option value="name">Nombre A–Z</option>
                </select>
              </div>
            </div>

            {freeShopSections.map(({ section, number, offers }) => (
              <section key={section.id} className="hearth-subsection-block">
                <div className="hearth-subsection-header">
                  <div className="hearth-subsection-title">
                    <span className="hearth-count-chip">Sección 0{number}</span>
                    <span>{section.shortLabel}</span>
                  </div>
                  <span className="hearth-count-chip">{offers.length} SKUs</span>
                </div>

                {offers.map((offer) => {
                  const key = `free_shop:${offer.storeSkuId}`;
                  const added = basketItems.some((i) => i.itemKey === key);
                  return (
                    <div key={offer.storeSkuId} className="hearth-sku-card">
                      {offer.imageUrl && (
                        <img
                          src={offer.imageUrl}
                          alt={cleanProductTitle(offer.rawName)}
                          className="hearth-sku-thumb"
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="hearth-item-name" style={{ fontSize: "0.86rem" }}>
                          {cleanProductTitle(offer.rawName)}
                        </div>
                        <div className="hearth-pref-line">
                          {offer.brand} · {offer.netContent} {offer.unitMeasure} ·{" "}
                          {offer.storeName}
                        </div>
                        <div
                          className="tabular"
                          style={{
                            marginTop: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: "0.8rem",
                          }}
                        >
                          <strong style={{ color: "var(--h-primary)" }}>
                            {copFormatter.format(offer.calibratedPrice)}
                          </strong>
                          <span style={{ color: "var(--h-ink-3)", fontSize: "0.73rem" }}>
                            PUM {pumFormatter.format(offer.pumPrice)}/{offer.unitMeasure}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className={`hearth-sku-add-btn ${added ? "added" : ""}`}
                        aria-label={added ? "Quitar de canasta" : "Agregar a canasta"}
                        onClick={() => addOfferToBasket(offer, "free_shop")}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          {added ? "check" : "add"}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </section>
            ))}

            <div className="hearth-dark-cart-bar">
              <div>
                <div style={{ fontSize: "0.78rem", opacity: 0.88 }}>
                  {basketItems.length}{" "}
                  {basketItems.length === 1 ? "producto" : "productos"} en canasta
                </div>
                <div
                  className="hearth-headline tabular"
                  style={{ fontSize: "1.02rem", fontWeight: 800 }}
                >
                  Est. {copFormatter.format(freeEstimatedTotal)}
                </div>
              </div>
              <button
                type="button"
                className="hearth-dark-cart-cta"
                disabled={basketItems.length === 0}
                onClick={() => {
                  onChangeWizardStep("confirm");
                  scrollTop();
                }}
              >
                Ver canasta →
              </button>
            </div>
          </div>
        )}

        {/* PANTALLAS 3-5: GENÉRICO O HABITUAL */}
        {wizardStep === "section_1" &&
          experienceMode !== "free_shop" &&
          renderSectionStep(0)}
        {wizardStep === "section_2" && renderSectionStep(1)}
        {wizardStep === "section_3" && renderSectionStep(2)}

        {/* PANTALLA 6: CONFIRMAR SELECCIÓN DE PRODUCTOS */}
        {wizardStep === "confirm" && (
          <>
            <div className="hearth-main">
              <div>
                <h1 className="hearth-step-title">
                  Paso 6: Confirmar selección de productos
                </h1>
                <p className="hearth-step-subtitle">
                  Revisa tu lista por sección antes de pasar al filtro opcional de marcas.
                </p>
              </div>

              <div className="hearth-summary-trio">
                <div className="hearth-stat-box">
                  <div className="hearth-stat-value tabular">{basketItems.length}</div>
                  <div className="hearth-stat-label">Productos</div>
                </div>
                <div className="hearth-stat-box">
                  <div className="hearth-stat-value tabular">
                    {groupedBasketSections.length}
                  </div>
                  <div className="hearth-stat-label">Secciones</div>
                </div>
                <div className="hearth-stat-box">
                  {experienceMode === "generic_guided" ? (
                    <>
                      <div className="hearth-stat-value tabular">
                        {nearbyBranches.length}
                      </div>
                      <div className="hearth-stat-label">Tiendas cerca</div>
                    </>
                  ) : (
                    <>
                      <div className="hearth-stat-value tabular" style={{ fontSize: "0.95rem" }}>
                        {copFormatter.format(freeEstimatedTotal)}
                      </div>
                      <div className="hearth-stat-label">Estimado base</div>
                    </>
                  )}
                </div>
              </div>

              {groupedBasketSections.map(({ section, subGroups }) => (
                <section key={section.id} className="hearth-subsection-block">
                  <div className="hearth-subsection-header">
                    <div className="hearth-subsection-title">
                      <span className="material-symbols-outlined">{section.materialIcon}</span>
                      <span>{section.label}</span>
                    </div>
                  </div>

                  {subGroups.map(({ sub, items }) => (
                    <div key={sub.id} className="hearth-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div className="hearth-label">{sub.label}</div>
                      {items.map((item) => (
                        <div
                          key={item.itemKey}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            paddingTop: 6,
                            borderTop: "1px solid var(--h-surface-2)",
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="hearth-item-name" style={{ fontSize: "0.88rem" }}>
                              {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ""}
                              {item.label}
                            </div>
                            <div className="hearth-pref-line">{renderPrefSummary(item)}</div>
                          </div>
                          <div className="hearth-item-actions">
                            <button
                              type="button"
                              className="hearth-icon-btn"
                              title="Editar en su sección"
                              onClick={() => {
                                const target =
                                  section.stepNumber === 3
                                    ? "section_1"
                                    : section.stepNumber === 4
                                      ? "section_2"
                                      : "section_3";
                                setEditingPrefKey(item.itemKey);
                                onChangeWizardStep(
                                  experienceMode === "free_shop" ? "section_1" : target
                                );
                                scrollTop();
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                                edit
                              </span>
                            </button>
                            <button
                              type="button"
                              className="hearth-icon-btn danger"
                              title="Quitar"
                              onClick={() => removeBasketItem(item.itemKey)}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                                delete
                              </span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
              ))}
            </div>

            <footer className="hearth-sticky-footer">
              <div className="hearth-footer-pair">
                <button
                  type="button"
                  className="hearth-btn-secondary"
                  onClick={() => {
                    onChangeWizardStep(
                      experienceMode === "free_shop" ? "section_1" : "section_3"
                    );
                    scrollTop();
                  }}
                >
                  ← Volver
                </button>
                <button
                  type="button"
                  className="hearth-btn-primary"
                  disabled={basketItems.length === 0}
                  onClick={() => {
                    onChangeWizardStep("exclude_brands");
                    scrollTop();
                  }}
                >
                  <span>Continuar (Paso 7)</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    arrow_forward
                  </span>
                </button>
              </div>
            </footer>
          </>
        )}

        {/* PANTALLA 7: MARCAS QUE NO QUIERES VER */}
        {wizardStep === "exclude_brands" && (
          <>
            <div className="hearth-main">
              <div>
                <h1 className="hearth-step-title">
                  Paso 7: Marcas que no quieres ver
                </h1>
                <p className="hearth-step-subtitle">
                  Excluye marcas puntuales por producto si prefieres evitarlas al optimizar tu compra.
                </p>
              </div>

              <div className="hearth-info-banner">
                <span className="material-symbols-outlined" style={{ fontSize: 19 }}>
                  info
                </span>
                <span>
                  Este paso es opcional. Cualquier marca que bloquees aquí será descartada del comparador en tiempo real.
                </span>
              </div>

              {groupedBasketSections.map(({ section, items }) => (
                <section key={section.id} className="hearth-subsection-block">
                  <div className="hearth-subsection-header">
                    <div className="hearth-subsection-title">
                      <span className="material-symbols-outlined">{section.materialIcon}</span>
                      <span>{section.label}</span>
                    </div>
                  </div>

                  {items.map((item) => {
                    const availableBrands = getAvailableBrandsForItem(item, knownOffers);
                    const excluded = item.excludedBrands ?? [];
                    const remainingBrands = availableBrands.filter(
                      (b) => !excluded.some((ex) => ex.toLowerCase() === b.toLowerCase())
                    );
                    const draft = customExcludedBrand[item.itemKey] ?? "";

                    return (
                      <div key={item.itemKey} className="hearth-item-card">
                        <div>
                          <div className="hearth-item-name">{item.label}</div>
                          <div className="hearth-pref-line">
                            {item.anchorBrand
                              ? `Tu elección: ${item.anchorBrand} · `
                              : ""}
                            {availableBrands.length > 0
                              ? `Marcas disponibles (${availableBrands.length})`
                              : "Escribe o elige una marca para bloquear"}
                          </div>
                        </div>

                        {remainingBrands.length > 0 ? (
                          <select
                            className="hearth-select"
                            value=""
                            onChange={(e) => {
                              if (e.target.value) addExcludedBrand(item.itemKey, e.target.value);
                            }}
                          >
                            <option value="">Excluir una marca...</option>
                            {remainingBrands.map((brand) => (
                              <option key={brand} value={brand}>
                                {brand}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <input
                              type="text"
                              className="hearth-input"
                              placeholder="Escribir marca a excluir..."
                              value={draft}
                              onChange={(e) =>
                                setCustomExcludedBrand((prev) => ({
                                  ...prev,
                                  [item.itemKey]: e.target.value,
                                }))
                              }
                            />
                            <button
                              type="button"
                              className="hearth-btn-secondary"
                              onClick={() => {
                                addExcludedBrand(item.itemKey, draft);
                                setCustomExcludedBrand((prev) => ({
                                  ...prev,
                                  [item.itemKey]: "",
                                }));
                              }}
                            >
                              Bloquear
                            </button>
                          </div>
                        )}

                        {excluded.length > 0 && (
                          <div className="hearth-chip-group">
                            {excluded.map((brand) => (
                              <button
                                key={brand}
                                type="button"
                                className="hearth-exclude-chip"
                                onClick={() => removeExcludedBrand(item.itemKey, brand)}
                              >
                                <span
                                  className="material-symbols-outlined"
                                  style={{ fontSize: 14 }}
                                >
                                  block
                                </span>
                                <span>{brand}</span>
                                <span>×</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>

            <footer className="hearth-sticky-footer">
              <div className="hearth-footer-pair">
                <button
                  type="button"
                  className="hearth-btn-secondary"
                  onClick={() => {
                    onChangeWizardStep("confirm");
                    scrollTop();
                  }}
                >
                  ← Volver
                </button>
                <button
                  type="button"
                  className="hearth-btn-primary"
                  onClick={() => {
                    onChangeWizardStep("results");
                    scrollTop();
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    analytics
                  </span>
                  <span>Ver tu compra ideal</span>
                </button>
              </div>
            </footer>
          </>
        )}

        {/* PANTALLA 8: ¡TU COMPRA IDEAL ESTÁ LISTA! */}
        {wizardStep === "results" && (
          <>
            <div className="hearth-main">
              <div>
                <h1 className="hearth-step-title">¡Tu compra ideal está lista!</h1>
                <p className="hearth-step-subtitle">
                  Optimizamos tu lista respetando preferencias, radio máximo y marcas excluidas.
                </p>
              </div>

              {activePlan ? (
                <>
                  <div className="hearth-kpi-grid">
                    <div className="hearth-kpi-card">
                      <span className="hearth-kpi-label">Referencia</span>
                      <span className="hearth-kpi-val strike tabular">
                        {copFormatter.format(activePlan.baselineReferenceTotalCost)}
                      </span>
                    </div>
                    <div className="hearth-kpi-card hero">
                      <span className="hearth-kpi-label">MercaSabio</span>
                      <span className="hearth-kpi-val tabular">
                        {copFormatter.format(activePlan.totalNominalCost)}
                      </span>
                    </div>
                    <div className="hearth-kpi-card">
                      <span className="hearth-kpi-label">Tu ahorro</span>
                      <span className="hearth-kpi-val success tabular">
                        {copFormatter.format(activePlan.savingsVsBaselineCop)}
                      </span>
                      <span
                        style={{
                          fontSize: "0.66rem",
                          fontWeight: 800,
                          color: "var(--h-success)",
                        }}
                      >
                        {activePlan.savingsVsBaselinePct}% MENOS
                      </span>
                    </div>
                  </div>

                  {/* Stepper de paradas en vivo (- / +) */}
                  <div className="hearth-route-stepper-card">
                    <div>
                      <div
                        className="hearth-headline"
                        style={{ fontSize: "0.88rem", fontWeight: 700 }}
                      >
                        Ruta optimizada (Activa)
                      </div>
                      <div className="hearth-pref-line">
                        {activePlan.storeStops.length}{" "}
                        {activePlan.storeStops.length === 1 ? "parada" : "paradas"} ·{" "}
                        {(activePlan.totalDistanceMeters / 1000).toFixed(1)} km ·{" "}
                        {activePlan.coveredItems}/{activePlan.requestedItems} cubiertos
                      </div>
                    </div>

                    <div className="hearth-qty-stepper">
                      <button
                        type="button"
                        className="hearth-qty-btn"
                        disabled={maxStores <= 1}
                        onClick={() =>
                          onChangeMaxStores(Math.max(1, maxStores - 1) as StoreCountLimit)
                        }
                      >
                        -
                      </button>
                      <span
                        className="tabular"
                        style={{ fontSize: "0.78rem", fontWeight: 700, padding: "0 4px" }}
                      >
                        Máx {maxStores}
                      </span>
                      <button
                        type="button"
                        className="hearth-qty-btn"
                        disabled={maxStores >= 5}
                        onClick={() =>
                          onChangeMaxStores(Math.min(5, maxStores + 1) as StoreCountLimit)
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {experienceMode === "habitual_guided" &&
                    habitualProfileSummary.inferredTraits.length > 0 && (
                      <div className="hearth-info-banner">
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          auto_awesome
                        </span>
                        <div>
                          <strong>Perfil detectado:</strong>{" "}
                          {habitualProfileSummary.dominantTierLabel ?? "Estándar"} ·{" "}
                          {habitualProfileSummary.inferredTraits
                            .slice(0, 3)
                            .map((t) => t.label)
                            .join(", ")}
                        </div>
                      </div>
                    )}

                  {groupedResultAllocations.map(({ section, allocations, savingsCop }) => (
                    <section key={section.id} className="hearth-subsection-block">
                      <div className="hearth-subsection-header">
                        <div className="hearth-subsection-title">
                          <span className="material-symbols-outlined">
                            {section.materialIcon}
                          </span>
                          <span>{section.label}</span>
                        </div>
                        {savingsCop > 0 && (
                          <span className="hearth-badge-primary tabular">
                            Ahorras {copFormatter.format(savingsCop)}
                          </span>
                        )}
                      </div>

                      {allocations.map((alloc) => {
                        const isSwapping = swapItemKey === alloc.itemKey;
                        const runnerUp = alloc.runnerUpOffer;
                        const runnerDiff =
                          runnerUp && runnerUp.calibratedPrice > alloc.offer.calibratedPrice
                            ? runnerUp.calibratedPrice - alloc.offer.calibratedPrice
                            : 0;

                        return (
                          <div key={alloc.itemKey} className="hearth-item-card">
                            <div className="hearth-item-top">
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div className="hearth-badge-soft" style={{ marginBottom: 4, display: "inline-block" }}>
                                  {alloc.offer.storeName} · {alloc.branch.branchName}
                                </div>
                                <div className="hearth-item-name">
                                  {alloc.quantity > 1 ? `${alloc.quantity}x ` : ""}
                                  {cleanProductTitle(alloc.offer.rawName)}
                                </div>
                                <div className="hearth-pref-line">
                                  {alloc.offer.brand} · {alloc.offer.netContent}{" "}
                                  {alloc.offer.unitMeasure} · PUM{" "}
                                  {pumFormatter.format(alloc.nominalPum)}/
                                  {alloc.offer.unitMeasure}
                                </div>
                              </div>

                              <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <div
                                  className="hearth-headline tabular"
                                  style={{
                                    fontSize: "1rem",
                                    fontWeight: 800,
                                    color: "var(--h-primary)",
                                  }}
                                >
                                  {copFormatter.format(alloc.nominalCost)}
                                </div>
                                {alloc.baselineReferenceCost > alloc.nominalCost && (
                                  <div
                                    className="tabular"
                                    style={{
                                      fontSize: "0.72rem",
                                      color: "var(--h-ink-3)",
                                      textDecoration: "line-through",
                                    }}
                                  >
                                    {copFormatter.format(alloc.baselineReferenceCost)}
                                  </div>
                                )}
                              </div>
                            </div>

                            {runnerUp && (
                              <div className="hearth-alt-footnote">
                                Alternativa evaluada: {cleanProductTitle(runnerUp.rawName)} (
                                {runnerUp.storeName}) ·{" "}
                                {runnerDiff > 0
                                  ? `+${copFormatter.format(runnerDiff)}`
                                  : copFormatter.format(runnerUp.calibratedPrice)}
                              </div>
                            )}

                            {alloc.alternativesInStore.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  className={`hearth-edit-pref-btn ${isSwapping ? "active" : ""}`}
                                  style={{ alignSelf: "flex-start" }}
                                  onClick={() =>
                                    setSwapItemKey(isSwapping ? null : alloc.itemKey)
                                  }
                                >
                                  <span
                                    className="material-symbols-outlined"
                                    style={{ fontSize: 15 }}
                                  >
                                    tune
                                  </span>
                                  <span>Ver otros recomendados ({alloc.alternativesInStore.length})</span>
                                </button>

                                {isSwapping && (
                                  <div className="hearth-pref-drawer">
                                    {alloc.alternativesInStore.map((alt) => {
                                      const selected =
                                        alt.storeSkuId === alloc.offer.storeSkuId;
                                      return (
                                        <button
                                          key={alt.storeSkuId}
                                          type="button"
                                          className={`hearth-sku-pick-card ${
                                            selected ? "selected" : ""
                                          }`}
                                          onClick={() =>
                                            handleSelectSwapOffer(alloc.itemKey, alt)
                                          }
                                        >
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div
                                              className="hearth-item-name"
                                              style={{ fontSize: "0.82rem" }}
                                            >
                                              {cleanProductTitle(alt.rawName)}
                                            </div>
                                            <div className="hearth-pref-line">
                                              {alt.brand} · {alt.netContent} {alt.unitMeasure} · PUM{" "}
                                              {pumFormatter.format(alt.pumPrice)}/{alt.unitMeasure}
                                            </div>
                                          </div>
                                          <strong
                                            className="tabular"
                                            style={{ fontSize: "0.84rem", color: "var(--h-primary)" }}
                                          >
                                            {copFormatter.format(alt.calibratedPrice)}
                                          </strong>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </section>
                  ))}

                  {optimization.uncoveredItems.length > 0 && (
                    <div className="hearth-card" style={{ borderColor: "#E8C995" }}>
                      <div className="hearth-label" style={{ color: "var(--h-warning)" }}>
                        Sin stock en el radio o con tus filtros ({optimization.uncoveredItems.length}):
                      </div>
                      <p className="hearth-pref-line" style={{ marginTop: 4 }}>
                        {optimization.uncoveredItems.join(", ")}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="hearth-card" style={{ textAlign: "center", padding: 20 }}>
                  <p className="hearth-step-subtitle">
                    No encontramos combinaciones en el radio actual con todas las restricciones activas. Amplía el radio o quita alguna exclusión.
                  </p>
                </div>
              )}
            </div>

            <footer className="hearth-sticky-footer">
              <div className="hearth-footer-pair">
                <button
                  type="button"
                  className="hearth-btn-secondary"
                  onClick={() => {
                    onChangeWizardStep("exclude_brands");
                    scrollTop();
                  }}
                >
                  ← Ajustar
                </button>
                <button
                  type="button"
                  className="hearth-btn-primary"
                  disabled={!activePlan}
                  onClick={() => {
                    onChangeWizardStep("route");
                    scrollTop();
                  }}
                >
                  <span>Ver ruta de mercado</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    arrow_forward
                  </span>
                </button>
              </div>
            </footer>
          </>
        )}

        {/* PANTALLA 9: RUTA IDEAL — MAPA Y LISTA DE COMPRAS */}
        {wizardStep === "route" && (
          <>
            <div className="hearth-main">
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div>
                  <h1 className="hearth-step-title">
                    Ruta Ideal — Mapa y Lista de Compras
                  </h1>
                  <p className="hearth-step-subtitle">
                    Toca cada producto en tienda para tacharlo mientras mercas.
                  </p>
                </div>
                {routeSummary && (
                  <span className="hearth-pill-badge tabular">
                    {(routeSummary.distanceMeters / 1000).toFixed(1)} km · ~
                    {Math.max(1, Math.round(routeSummary.durationSeconds / 60))} min
                  </span>
                )}
              </div>

              {activePlan && (
                <>
                  <RouteMap
                    variant="route"
                    userLocation={userLocation}
                    stops={routeMapStops}
                    onSummaryChange={setRouteSummary}
                    savingsLabel={`${activePlan.storeStops.length} ${
                      activePlan.storeStops.length === 1 ? "tienda" : "tiendas"
                    } · Ahorras ${copFormatter.format(activePlan.savingsVsBaselineCop)}`}
                  />

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "2px 2px",
                    }}
                  >
                    <div
                      className="hearth-headline"
                      style={{ fontSize: "0.96rem", fontWeight: 800 }}
                    >
                      Checklist por supermercado
                    </div>
                    <span className="hearth-badge-primary tabular">
                      {checklistProgress.done} / {checklistProgress.total} listos
                    </span>
                  </div>

                  {activePlan.storeStops.map((stop, idx) => (
                    <section key={stop.storeId} className="hearth-subsection-block">
                      <div className="hearth-card" style={{ background: "var(--h-surface-2)" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 999,
                                background: "var(--h-primary)",
                                color: "var(--h-on-primary)",
                                fontSize: "0.75rem",
                                fontWeight: 800,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {idx + 1}
                            </span>
                            <div>
                              <div className="hearth-item-name">
                                {stop.storeName} · Parada {idx + 1}
                              </div>
                              <div className="hearth-pref-line">
                                {stop.branch.branchName} ·{" "}
                                {Math.round(stop.branch.distanceMeters)} m
                              </div>
                            </div>
                          </div>

                          <strong
                            className="hearth-headline tabular"
                            style={{ color: "var(--h-primary)" }}
                          >
                            {copFormatter.format(stop.subtotalNominal)}
                          </strong>
                        </div>
                      </div>

                      {stop.allocations.map((alloc) => {
                        const checked = Boolean(checkedItems[alloc.itemKey]);
                        return (
                          <button
                            key={alloc.itemKey}
                            type="button"
                            className={`hearth-check-row ${checked ? "checked" : ""}`}
                            onClick={() =>
                              setCheckedItems((prev) => ({
                                ...prev,
                                [alloc.itemKey]: !prev[alloc.itemKey],
                              }))
                            }
                          >
                            <span className="hearth-check-circle">
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: 15 }}
                              >
                                check
                              </span>
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="hearth-item-name hearth-check-title">
                                {alloc.quantity > 1 ? `${alloc.quantity}x ` : ""}
                                {cleanProductTitle(alloc.offer.rawName)}
                              </div>
                              <div className="hearth-pref-line">
                                {alloc.offer.brand} · {alloc.offer.netContent}{" "}
                                {alloc.offer.unitMeasure}
                              </div>
                            </div>
                            <strong
                              className="tabular"
                              style={{
                                fontSize: "0.86rem",
                                color: checked ? "var(--h-ink-3)" : "var(--h-primary)",
                              }}
                            >
                              {copFormatter.format(alloc.nominalCost)}
                            </strong>
                          </button>
                        );
                      })}
                    </section>
                  ))}

                  <div className="hearth-export-grid">
                    <button
                      type="button"
                      className="hearth-btn-secondary"
                      onClick={handleCopyPlainText}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
                        content_copy
                      </span>
                      <span>{copiedNotice ? "¡Copiada!" : "Copiar lista"}</span>
                    </button>
                    <button
                      type="button"
                      className="hearth-btn-secondary"
                      onClick={handleDownloadPlainText}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
                        download
                      </span>
                      <span>Descargar .txt</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    className="hearth-btn-secondary"
                    style={{
                      width: "100%",
                      borderColor: "#E8B7B6",
                      color: "var(--h-danger)",
                    }}
                    onClick={() => {
                      const first = activePlan.storeStops[0]?.allocations[0]?.itemKey ?? "";
                      setReportAllocKey(first);
                      setReportFeedback(null);
                      setReportModalOpen(true);
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      flag
                    </span>
                    <span>Reportar precios diferentes</span>
                  </button>
                </>
              )}
            </div>

            <footer className="hearth-sticky-footer">
              <div className="hearth-footer-pair">
                <button
                  type="button"
                  className="hearth-btn-secondary"
                  onClick={() => {
                    onChangeWizardStep("results");
                    scrollTop();
                  }}
                >
                  ← Volver a compra
                </button>
                <button
                  type="button"
                  className="hearth-btn-primary"
                  onClick={() => {
                    onChangeWizardStep("mode");
                    scrollTop();
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    restart_alt
                  </span>
                  <span>Nuevo mercado</span>
                </button>
              </div>
            </footer>
          </>
        )}

        {/* POP-UP / BOTTOM SHEET: AGREGAR PRODUCTO EN MI MERCADO HABITUAL */}
        {habitualModalSub && (
          <div
            className="hearth-sheet-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={`Agregar a ${habitualModalSub.label}`}
          >
            <div className="hearth-sheet">
              <div className="hearth-sheet-header">
                <div>
                  <div
                    className="hearth-headline"
                    style={{ fontSize: "1.02rem", fontWeight: 800 }}
                  >
                    Agregar a {habitualModalSub.label}
                  </div>
                  <div className="hearth-pref-line">
                    Elige tu marca y presentación habitual
                  </div>
                </div>
                <button
                  type="button"
                  className="hearth-icon-btn"
                  onClick={() => setHabitualModalSub(null)}
                  aria-label="Cerrar"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    close
                  </span>
                </button>
              </div>

              <div className="hearth-sheet-body">
                <input
                  type="search"
                  className="hearth-input"
                  placeholder={`Buscar en ${habitualModalSub.label}...`}
                  value={habitualModalQuery}
                  onChange={(e) => setHabitualModalQuery(e.target.value)}
                />

                <div className="hearth-scroll-pills">
                  {(
                    [
                      { id: "all", label: "Todos" },
                      { id: "economico", label: "Económica" },
                      { id: "estandar", label: "Estándar" },
                      { id: "premium", label: "Premium" },
                    ] as Array<{ id: QualityTier | "all"; label: string }>
                  ).map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      className={`hearth-pill-filter ${
                        habitualModalTier === chip.id ? "active" : ""
                      }`}
                      onClick={() => setHabitualModalTier(chip.id)}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>

                {habitualModalOffers.length === 0 ? (
                  <div className="hearth-empty-subcard">
                    No hay productos disponibles para este filtro. Prueba otra palabra clave.
                  </div>
                ) : (
                  habitualModalOffers.map((offer) => {
                    const selected =
                      habitualModalSelectedSku?.storeSkuId === offer.storeSkuId;
                    return (
                      <button
                        key={offer.storeSkuId}
                        type="button"
                        className={`hearth-sku-pick-card ${selected ? "selected" : ""}`}
                        onClick={() => setHabitualModalSelectedSku(offer)}
                      >
                        {offer.imageUrl && (
                          <img
                            src={offer.imageUrl}
                            alt={cleanProductTitle(offer.rawName)}
                            className="hearth-sku-thumb"
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="hearth-item-name" style={{ fontSize: "0.85rem" }}>
                            {cleanProductTitle(offer.rawName)}
                          </div>
                          <div className="hearth-pref-line">
                            {offer.brand} · {offer.netContent} {offer.unitMeasure} ·{" "}
                            {offer.storeName}
                          </div>
                          <div className="hearth-pref-line tabular">
                            PUM {pumFormatter.format(offer.pumPrice)}/{offer.unitMeasure}
                          </div>
                        </div>
                        <strong
                          className="tabular"
                          style={{ color: "var(--h-primary)", fontSize: "0.88rem" }}
                        >
                          {copFormatter.format(offer.calibratedPrice)}
                        </strong>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="hearth-sheet-footer">
                <button
                  type="button"
                  className="hearth-btn-secondary"
                  onClick={() => setHabitualModalSub(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="hearth-btn-primary"
                  disabled={!habitualModalSelectedSku}
                  onClick={() => {
                    if (!habitualModalSelectedSku || !habitualModalSub) return;
                    addOfferToBasket(
                      habitualModalSelectedSku,
                      "habitual_guided",
                      habitualModalSub
                    );
                    setHabitualModalSub(null);
                  }}
                >
                  <span>
                    {habitualModalSelectedSku
                      ? `Agregar producto (${copFormatter.format(habitualModalSelectedSku.calibratedPrice)}) +`
                      : "Selecciona un producto"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: REPORTAR PRECIOS DIFERENTES */}
        {reportModalOpen && activePlan && (
          <div
            className="hearth-sheet-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Reportar precios diferentes"
          >
            <div className="hearth-sheet">
              <div className="hearth-sheet-header">
                <div
                  className="hearth-headline"
                  style={{ fontSize: "1.02rem", fontWeight: 800 }}
                >
                  Reportar precio o diferencia en tienda
                </div>
                <button
                  type="button"
                  className="hearth-icon-btn"
                  onClick={() => setReportModalOpen(false)}
                  aria-label="Cerrar"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    close
                  </span>
                </button>
              </div>

              <div className="hearth-sheet-body">
                <div className="hearth-field">
                  <label className="hearth-label" htmlFor="report-product-select">
                    Producto de tu ruta
                  </label>
                  <select
                    id="report-product-select"
                    className="hearth-select"
                    value={reportAllocKey}
                    onChange={(e) => setReportAllocKey(e.target.value)}
                  >
                    {activePlan.storeStops.flatMap((stop) =>
                      stop.allocations.map((a) => (
                        <option key={a.itemKey} value={a.itemKey}>
                          {stop.storeName} · {cleanProductTitle(a.offer.rawName)} (
                          {copFormatter.format(a.nominalCost)})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="hearth-field">
                  <label className="hearth-label" htmlFor="report-reason-select">
                    Motivo
                  </label>
                  <select
                    id="report-reason-select"
                    className="hearth-select"
                    value={reportReason}
                    onChange={(e) =>
                      setReportReason(
                        e.target.value as
                          | "distinta_calidad"
                          | "distinto_producto"
                          | "tamano_incomparable"
                          | "otro"
                      )
                    }
                  >
                    <option value="otro">El precio en tienda física era distinto</option>
                    <option value="distinto_producto">Producto no coincide en góndola</option>
                    <option value="tamano_incomparable">Gramaje o presentación distinta</option>
                    <option value="distinta_calidad">Comparación de calidad injusta</option>
                  </select>
                </div>

                <div className="hearth-field">
                  <label className="hearth-label" htmlFor="report-comment">
                    Detalle opcional (precio visto en tienda)
                  </label>
                  <input
                    id="report-comment"
                    type="text"
                    className="hearth-input"
                    placeholder="Ej: En D1 estaba en $4.200 hoy"
                    value={reportComment}
                    onChange={(e) => setReportComment(e.target.value)}
                  />
                </div>

                {reportFeedback && (
                  <div className="hearth-info-banner">
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      check_circle
                    </span>
                    <span>{reportFeedback}</span>
                  </div>
                )}
              </div>

              <div className="hearth-sheet-footer">
                <button
                  type="button"
                  className="hearth-btn-secondary"
                  onClick={() => setReportModalOpen(false)}
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  className="hearth-btn-primary"
                  disabled={reportSubmitting}
                  onClick={handleSubmitReport}
                >
                  <span>{reportSubmitting ? "Enviando..." : "Enviar reporte"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
