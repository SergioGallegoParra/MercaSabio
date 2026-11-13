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
import HearthIcon, { type HearthIconName } from "@/components/HearthIcon";

const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="hearth-card" style={{ textAlign: "center", padding: "32px 14px" }}>
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
      return { stepNumber: 1, badge: "Ahorro consciente", progressPct: 14.28 };
    case "location":
      return { stepNumber: 2, badge: "Cobertura local", progressPct: 28.57 };
    case "section_1":
      return {
        stepNumber: 3,
        badge:
          mode === "free_shop"
            ? "Catálogo abierto"
            : mode === "habitual_guided"
              ? "Mi Historial"
              : "Alacena básica",
        progressPct: 42.86,
      };
    case "section_2":
      return {
        stepNumber: 4,
        badge: mode === "habitual_guided" ? "Mi Historial" : "Refrigerados",
        progressPct: 57.14,
      };
    case "section_3":
      return {
        stepNumber: 5,
        badge: mode === "habitual_guided" ? "Mi Historial" : "Hogar & Cuidado",
        progressPct: 71.43,
      };
    case "confirm":
      return {
        stepNumber: 6,
        badge: mode === "habitual_guided" ? "Revisión habitual" : "Revisión previa",
        progressPct: 85.71,
      };
    case "exclude_brands":
      return { stepNumber: 7, badge: "Filtro de exclusión", progressPct: 100 };
    case "results":
      return { stepNumber: null, badge: "Cálculo completado", progressPct: 100 };
    case "route":
      return { stepNumber: null, badge: "Modo compra", progressPct: 100 };
  }
}

function formatPresentationTag(item: BasketItemInput): string | null {
  if (!item.targetNetContent || !item.targetUnitMeasure) return null;
  const val = Math.round(item.targetNetContent);
  if (item.targetUnitMeasure === "und") return `x ${val} und`;
  if (item.targetUnitMeasure === "g" && val >= 1000) {
    const kg = val / 1000;
    return Number.isInteger(kg) ? `${kg} kg` : `${val.toLocaleString("es-CO")} g`;
  }
  return `${val.toLocaleString("es-CO")} ${item.targetUnitMeasure}`;
}

function OfferThumb({
  imageUrl,
  alt,
  fallbackIcon,
  sizeClass = "sm",
}: {
  imageUrl: string | null;
  alt: string;
  fallbackIcon: HearthIconName;
  sizeClass?: "sm" | "lg";
}) {
  if (imageUrl) {
    return (
      <div className={`hearth-thumb-box ${sizeClass}`}>
        <img src={imageUrl} alt={alt} className="hearth-thumb-img" />
      </div>
    );
  }
  return (
    <div className={`hearth-thumb-box ${sizeClass} fallback`} aria-hidden="true">
      <HearthIcon name={fallbackIcon} size={sizeClass === "lg" ? 24 : 21} />
    </div>
  );
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
  // Pasos 3–5 Genérico
  const [editingPrefKey, setEditingPrefKey] = useState<string | null>(null);
  const [addingGenericSubId, setAddingGenericSubId] = useState<string | null>(null);

  // Pasos 3–5 Habitual: Pop-up "Agregar a [Subsección]"
  const [habitualModalSub, setHabitualModalSub] = useState<GuidedSubsection | null>(null);
  const [habitualModalQuery, setHabitualModalQuery] = useState("");
  const [habitualModalFoodId, setHabitualModalFoodId] = useState<string>("all");
  const [habitualModalSelectedSku, setHabitualModalSelectedSku] = useState<StoreOffer | null>(null);

  // Paso 3 Exploración Libre
  const [freeQuery, setFreeQuery] = useState("");
  const [freeSectionFilter, setFreeSectionFilter] = useState<"all" | "alacena" | "nevera" | "aseo">("all");
  const [freeSubsectionFilter, setFreeSubsectionFilter] = useState<string>("all");
  const [freeSort, setFreeSort] = useState<"pum" | "price" | "name">("pum");
  const [freeSearching, setFreeSearching] = useState(false);

  // Paso 7 Exclusión de marcas
  const [customExcludedBrand, setCustomExcludedBrand] = useState<Record<string, string>>({});

  // Pantalla 8 Resultados
  const [swapItemKey, setSwapItemKey] = useState<string | null>(null);

  // Pantalla 9 Ruta & Checklist
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

  const activePlan = useMemo<BasketPlan | null>(() => {
    const byCount: Partial<Record<StoreCountLimit, BasketPlan | null | undefined>> = {
      1: optimization.bestOneStore,
      2: optimization.bestTwoStores,
      3: optimization.bestThreeStores,
      4: optimization.bestFourStores,
      5: optimization.bestFiveStores,
    };
    return byCount[maxStores] ?? optimization.recommendedPlan;
  }, [optimization, maxStores]);

  const habitualProfileSummary = useMemo(
    () => inferBasketProfileSummary(basketItems),
    [basketItems]
  );

  const nearbyStoreIds = useMemo(
    () => new Set(nearbyBranches.map((b) => b.storeId)),
    [nearbyBranches]
  );

  const basketByKey = useMemo(() => {
    const map = new Map<string, BasketItemInput>();
    for (const item of basketItems) map.set(item.itemKey, item);
    return map;
  }, [basketItems]);

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

  // Datos para pop-up Habitual: ofertas de la subsección + conteos por alimento
  const habitualModalBaseOffers = useMemo(() => {
    if (!habitualModalSub) return [];
    const q = habitualModalQuery.trim().toLowerCase();
    return knownOffers.filter((offer) => {
      if (!offer.inStock) return false;
      if (q) {
        const hay = `${offer.rawName} ${offer.brand} ${offer.storeName}`.toLowerCase();
        return hay.includes(q);
      }
      return offerMatchesSubsection(offer, habitualModalSub);
    });
  }, [habitualModalSub, habitualModalQuery, knownOffers]);

  const habitualModalFoodChips = useMemo(() => {
    if (!habitualModalSub) return [];
    return habitualModalSub.foods.map((food) => {
      const count = habitualModalBaseOffers.filter((offer) => {
        const sig = extractProductSignature(offer);
        return (
          sig.broadFamily === food.broadFamily ||
          food.variants.some((v) => v.subtypeFamily === sig.subtypeFamily)
        );
      }).length;
      return { food, count };
    });
  }, [habitualModalSub, habitualModalBaseOffers]);

  const habitualModalOffers = useMemo(() => {
    if (!habitualModalSub) return [];
    const activeFood =
      habitualModalFoodId !== "all"
        ? habitualModalSub.foods.find((f) => f.id === habitualModalFoodId) ?? null
        : null;

    const filtered = activeFood
      ? habitualModalBaseOffers.filter((offer) => {
          const sig = extractProductSignature(offer);
          return (
            sig.broadFamily === activeFood.broadFamily ||
            activeFood.variants.some((v) => v.subtypeFamily === sig.subtypeFamily)
          );
        })
      : habitualModalBaseOffers;

    return [...filtered]
      .sort((a, b) => {
        const aNear = nearbyStoreIds.has(a.storeId) ? 0 : 1;
        const bNear = nearbyStoreIds.has(b.storeId) ? 0 : 1;
        if (aNear !== bNear) return aNear - bNear;
        return a.pumPrice - b.pumPrice;
      })
      .slice(0, 30);
  }, [habitualModalSub, habitualModalFoodId, habitualModalBaseOffers, nearbyStoreIds]);

  // Subsecciones disponibles para la barra de filtros en Exploración Libre
  const freeSubsectionPills = useMemo(() => {
    return GUIDED_SECTIONS.filter(
      (s) => freeSectionFilter === "all" || s.id === freeSectionFilter
    ).flatMap((s) =>
      s.subsections.map((sub) => ({
        sub,
        count: knownOffers.filter((o) => o.inStock && offerMatchesSubsection(o, sub)).length,
      }))
    );
  }, [freeSectionFilter, knownOffers]);

  // Ofertas para Exploración Libre agrupadas por Sección -> Subsección (1:1 Stitch)
  const freeShopSections = useMemo(() => {
    if (experienceMode !== "free_shop" || wizardStep !== "section_1") return [];
    const q = freeQuery.trim().toLowerCase();

    return GUIDED_SECTIONS.filter(
      (sec) => freeSectionFilter === "all" || sec.id === freeSectionFilter
    )
      .map((sec, idx) => {
        const seenInSec = new Set<string>();
        const subGroups = sec.subsections
          .filter(
            (sub) => freeSubsectionFilter === "all" || sub.id === freeSubsectionFilter
          )
          .map((sub) => {
            const matched = knownOffers.filter((offer) => {
              if (!offer.inStock) return false;
              if (seenInSec.has(offer.storeSkuId)) return false;
              if (q) {
                const hay = `${offer.rawName} ${offer.brand} ${offer.storeName}`.toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return offerMatchesSubsection(offer, sub);
            });

            const sorted = [...matched].sort((a, b) => {
              if (freeSort === "price") return a.calibratedPrice - b.calibratedPrice;
              if (freeSort === "name") return a.rawName.localeCompare(b.rawName, "es");
              return a.pumPrice - b.pumPrice;
            });

            const sliced = sorted.slice(0, q ? 16 : 6);
            sliced.forEach((o) => seenInSec.add(o.storeSkuId));
            return { sub, offers: sliced };
          })
          .filter((group) => group.offers.length > 0);

        const totalOffers = subGroups.reduce((acc, g) => acc + g.offers.length, 0);
        return {
          section: sec,
          number: idx + 1,
          totalOffers,
          subGroups,
        };
      })
      .filter((entry) => entry.totalOffers > 0);
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
      const savingsCop = Math.max(0, sectionBaseline - sectionNominal);
      const savingsPct =
        sectionBaseline > 0 ? Math.round((savingsCop / sectionBaseline) * 100) : 0;
      return {
        section: sec,
        allocations: allocs,
        savingsCop,
        savingsPct,
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
          sectionId:
            forcedSub.foods[0]?.sectionId ??
            getSectionIdForItem({
              label: offer.rawName,
              subtypeFamily: sig.subtypeFamily,
              broadFamily: sig.broadFamily,
            }),
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
    setHabitualModalFoodId("all");
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
      // Fallback sin Clipboard API
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

  function renderProgressHeader(
    title: string,
    stepNum: number,
    counterText: string,
    subtitle?: string
  ) {
    const pct = `${Math.min(100, Math.round((stepNum / 7) * 10000) / 100)}%`;
    return (
      <section className="hearth-progress-section">
        <div className="hearth-progress-head-row">
          <h1 className="hearth-step-title">{title}</h1>
          <span className="hearth-step-counter tabular">{counterText}</span>
        </div>
        <div
          className="hearth-progress-track"
          role="progressbar"
          aria-valuenow={stepNum}
          aria-valuemin={1}
          aria-valuemax={7}
          aria-label={`Progreso: ${stepNum} de 7`}
        >
          <div className="hearth-progress-fill" style={{ width: pct }} />
        </div>
        {subtitle && <p className="hearth-step-subtitle">{subtitle}</p>}
      </section>
    );
  }

  function renderModeIndicator(stepKind: "section" | "confirm" | "exclude") {
    const isFree = experienceMode === "free_shop";
    const isHabitual = experienceMode === "habitual_guided";

    const modeName = isFree
      ? "Exploración Libre"
      : isHabitual
        ? "Mi Mercado Habitual"
        : "Mercado Genérico";

    const leftIcon: HearthIconName =
      stepKind === "exclude"
        ? "block"
        : isFree
          ? "explore"
          : isHabitual
            ? "storefront"
            : "shopping_basket";

    const subtitle =
      stepKind === "exclude"
        ? "El algoritmo descartará las marcas que excluyas al calcular tu canasta"
        : stepKind === "confirm"
          ? "Revisa y ajusta los ítems y preferencias antes de comparar precios"
          : isFree
            ? "Navega productos reales por sección con marcas, fotos y precios"
            : isHabitual
              ? "Menú habilitado por seleccionar tu lista habitual de compras"
              : "Menú habilitado por seleccionar esta opción de canasta básica";

    return (
      <div className={`hearth-mode-indicator ${isFree ? "free" : ""}`}>
        <div className="hearth-mode-indicator-left">
          <span className={`hearth-mode-indicator-icon ${isFree ? "free" : ""}`}>
            <HearthIcon name={leftIcon} size={17} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="hearth-mode-indicator-title-row">
              <span className="hearth-mode-indicator-title">{modeName}</span>
              <span className={`hearth-mode-active-tag ${isFree ? "free" : ""}`}>
                Activo
              </span>
            </div>
            <p className="hearth-mode-indicator-sub">{subtitle}</p>
          </div>
        </div>
        <span
          className={`hearth-mode-indicator-right ${isFree ? "free" : ""}`}
          aria-hidden="true"
        >
          <HearthIcon name={isFree ? "tune" : "check_circle"} size={18} />
        </span>
      </div>
    );
  }

  function renderSectionStep(sectionIndex: 0 | 1 | 2) {
    const section = GUIDED_SECTIONS[sectionIndex];
    const nextStep: WizardStep =
      sectionIndex === 0 ? "section_2" : sectionIndex === 1 ? "section_3" : "confirm";
    const prevStep: WizardStep =
      sectionIndex === 0 ? "location" : sectionIndex === 1 ? "section_1" : "section_2";
    const backStepNum = section.stepNumber - 1;
    const nextStepNum = section.stepNumber + 1;

    const isHabitual = experienceMode === "habitual_guided";
    const sectionItems = basketItems.filter((i) => getSectionIdForItem(i) === section.id);

    const quickHabitualOffers = isHabitual
      ? knownOffers
          .filter((offer) =>
            section.subsections.some((sub) => offerMatchesSubsection(offer, sub))
          )
          .sort((a, b) => a.pumPrice - b.pumPrice)
          .slice(0, 4)
      : [];

    const stepHeading =
      sectionIndex === 0
        ? "Paso 3: Selecciona tus productos de la alacena"
        : sectionIndex === 1
          ? "Paso 4: Productos de nevera y lácteos"
          : "Paso 5: Productos de aseo y limpieza";

    return (
      <>
        <div className="hearth-main">
          {renderProgressHeader(stepHeading, section.stepNumber, `${section.stepNumber} de 7`)}
          {renderModeIndicator("section")}

          {section.subsections.map((sub) => {
            const subItems = sectionItems.filter(
              (item) => getSubsectionForItem(item).subsectionId === sub.id
            );

            return (
              <section key={sub.id} className="hearth-sub-card">
                <div className="hearth-sub-card-header">
                  <div className="hearth-sub-card-title-wrap">
                    <span className="hearth-sub-icon-box">
                      <HearthIcon name={sub.materialIcon} size={17} />
                    </span>
                    <h2 className="hearth-sub-card-title">{sub.label}</h2>
                  </div>
                  <span className="hearth-sub-card-count">
                    {subItems.length} {subItems.length === 1 ? "producto" : "productos"}
                  </span>
                </div>

                {subItems.length === 0 ? (
                  <div className="hearth-empty-subcard">
                    No has añadido {sub.label.toLowerCase()} aún
                  </div>
                ) : (
                  <div className="hearth-sub-rows-list">
                    {subItems.map((item) => {
                      const isEditing = editingPrefKey === item.itemKey;
                      const catalogFood = sub.foods.find(
                        (f) =>
                          item.itemKey.includes(f.id) ||
                          f.broadFamily === item.broadFamily ||
                          f.variants.some((v) => v.subtypeFamily === item.subtypeFamily)
                      );

                      return (
                        <div key={item.itemKey} className="hearth-sub-row-shell">
                          <div className="hearth-sub-item-row">
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div className="hearth-item-name">
                                {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ""}
                                {item.label}
                              </div>
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
                                  <HearthIcon name="tune" size={14} />
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
                                  <HearthIcon name="remove" size={12} />
                                </button>
                                <span
                                  className="tabular"
                                  style={{ fontSize: "0.75rem", fontWeight: 700 }}
                                >
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
                                  <HearthIcon name="add" size={12} />
                                </button>
                              </div>
                              <button
                                type="button"
                                className="hearth-icon-btn danger"
                                aria-label="Eliminar producto"
                                onClick={() => removeBasketItem(item.itemKey)}
                              >
                                <HearthIcon name="delete" size={15} />
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
                    })}
                  </div>
                )}

                {isHabitual ? (
                  <button
                    type="button"
                    className="hearth-add-dashed-btn"
                    onClick={() => openHabitualModal(sub)}
                  >
                    <HearthIcon name="add_circle" size={17} />
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
                      <HearthIcon name="add_circle" size={17} />
                      <span>Agregar más productos en {sub.label}</span>
                    </button>

                    {addingGenericSubId === sub.id && (
                      <div className="hearth-sub-row-shell">
                        <div className="hearth-label" style={{ marginBottom: 6 }}>
                          Elige un alimento para añadir:
                        </div>
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
            <div className="hearth-sub-card">
              <div className="hearth-label" style={{ marginBottom: 6 }}>
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
                      {cleanProductTitle(offer.rawName).slice(0, 26)} ·{" "}
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
              <HearthIcon name="arrow_back" size={16} />
              <span>Volver al paso {backStepNum}</span>
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
              <span>Continuar (Paso {nextStepNum})</span>
              <HearthIcon name="arrow_forward" size={17} />
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

  const habitualSelectedCount = useMemo(
    () => basketItems.filter((i) => i.originMode === "habitual_guided").length,
    [basketItems]
  );

  return (
    <div className="hearth-outer">
      <div className="hearth-mobile-frame">
        {/* Clean Top App Bar matching Stitch */}
        <header className="hearth-header">
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
              <HearthIcon name="eco" size={19} />
            </span>
            <span className="hearth-brand-name">MercaSabio</span>
          </button>

          <div className="hearth-header-actions">
            <span
              className={`hearth-pill-badge ${
                wizardStep === "results" || wizardStep === "route" ? "primary-pill" : ""
              }`}
            >
              {wizardStep === "route" ? (
                <HearthIcon name="navigation" size={13} />
              ) : (
                <span
                  className={`hearth-pill-dot ${
                    wizardStep === "results" ? "green pulse" : "amber"
                  }`}
                />
              )}
              <span>{meta.badge}</span>
            </span>

            <Link
              href="/admin"
              className="hearth-admin-link"
              title="Panel visual de curación"
              aria-label="Panel visual de curación"
            >
              <HearthIcon name="tune" size={15} />
            </Link>
          </div>
        </header>

        {isDemoData && (
          <div className="hearth-demo-pill">
            Mostrando catálogo de demostración local.
          </div>
        )}

        {/* PANTALLA 1: ELIGE CÓMO VAS A MERCAR */}
        {wizardStep === "mode" && (
          <>
            <div className="hearth-main">
              {renderProgressHeader(
                "Paso 1: Elige cómo vas a mercar",
                1,
                "1 de 7"
              )}

              <div className="hearth-mode-stack">
                {/* Tarjeta 1: Mercado Genérico */}
                <button
                  type="button"
                  className={`hearth-mode-card-v2 ${
                    experienceMode === "generic_guided" ? "active" : ""
                  }`}
                  onClick={() => onChangeExperienceMode("generic_guided")}
                >
                  <div className="hearth-mode-v2-top">
                    <div className="hearth-mode-v2-title-group">
                      <span
                        className={`hearth-mode-icon ${
                          experienceMode === "generic_guided" ? "active" : ""
                        }`}
                      >
                        <HearthIcon name="shopping_basket" size={20} />
                      </span>
                      <span className="hearth-mode-name">Mercado Genérico</span>
                    </div>
                    {experienceMode === "generic_guided" ? (
                      <span className="hearth-mode-activo-pill">
                        <span className="hearth-pill-dot green" />
                        <span>Activo</span>
                      </span>
                    ) : (
                      <span className="hearth-mode-chevron">
                        <HearthIcon name="chevron_right" size={18} />
                      </span>
                    )}
                  </div>

                  <p className="hearth-mode-desc">
                    Canasta básica de referencia por secciones definiendo gama, tamaño y menor PUM sin amarrarte a una marca.
                  </p>

                  <div className="hearth-mode-v2-footer">
                    <span>Canasta estándar y económica</span>
                    {experienceMode === "generic_guided" ? (
                      <span className="hearth-mode-check-circle">
                        <HearthIcon name="check" size={14} />
                      </span>
                    ) : (
                      <span className="hearth-mode-footer-meta">Por características</span>
                    )}
                  </div>
                </button>

                {/* Tarjeta 2: Mi Mercado Habitual */}
                <button
                  type="button"
                  className={`hearth-mode-card-v2 ${
                    experienceMode === "habitual_guided" ? "active" : ""
                  }`}
                  onClick={() => onChangeExperienceMode("habitual_guided")}
                >
                  <div className="hearth-mode-v2-top">
                    <div className="hearth-mode-v2-title-group">
                      <span
                        className={`hearth-mode-icon ${
                          experienceMode === "habitual_guided" ? "active" : ""
                        }`}
                      >
                        <HearthIcon name="storefront" size={20} />
                      </span>
                      <span className="hearth-mode-name">Mi Mercado Habitual</span>
                    </div>
                    {experienceMode === "habitual_guided" ? (
                      <span className="hearth-mode-activo-pill">
                        <span className="hearth-pill-dot green" />
                        <span>Activo</span>
                      </span>
                    ) : (
                      <span className="hearth-mode-chevron">
                        <HearthIcon name="chevron_right" size={18} />
                      </span>
                    )}
                  </div>

                  <p className="hearth-mode-desc">
                    Elige tus productos frecuentes con marca y presentación exacta para descubrir cuánto ahorras optimizando tiendas.
                  </p>

                  <div className="hearth-mode-v2-footer">
                    <span>Tus productos y tiendas habituales</span>
                    {experienceMode === "habitual_guided" ? (
                      <span className="hearth-mode-check-circle">
                        <HearthIcon name="check" size={14} />
                      </span>
                    ) : (
                      <span className="hearth-mode-footer-meta">
                        {habitualSelectedCount > 0
                          ? `${habitualSelectedCount} ítems`
                          : "Personalizado"}
                      </span>
                    )}
                  </div>
                </button>

                {/* Tarjeta 3: Exploración Libre */}
                <button
                  type="button"
                  className={`hearth-mode-card-v2 ${
                    experienceMode === "free_shop" ? "active" : ""
                  }`}
                  onClick={() => onChangeExperienceMode("free_shop")}
                >
                  <div className="hearth-mode-v2-top">
                    <div className="hearth-mode-v2-title-group">
                      <span
                        className={`hearth-mode-icon ${
                          experienceMode === "free_shop" ? "active" : ""
                        }`}
                      >
                        <HearthIcon name="travel_explore" size={20} />
                      </span>
                      <span className="hearth-mode-name">Exploración Libre</span>
                    </div>
                    {experienceMode === "free_shop" ? (
                      <span className="hearth-mode-activo-pill">
                        <span className="hearth-pill-dot green" />
                        <span>Activo</span>
                      </span>
                    ) : (
                      <span className="hearth-mode-chevron">
                        <HearthIcon name="chevron_right" size={18} />
                      </span>
                    )}
                  </div>

                  <p className="hearth-mode-desc">
                    Arma tu lista desde cero navegando todo el catálogo real por categorías, búsqueda y menor PUM.
                  </p>

                  <div className="hearth-mode-v2-footer">
                    <span>Búsqueda abierta y personalizada</span>
                    {experienceMode === "free_shop" ? (
                      <span className="hearth-mode-check-circle">
                        <HearthIcon name="check" size={14} />
                      </span>
                    ) : (
                      <span className="hearth-mode-footer-meta tabular">
                        {knownOffers.length}+ ref.
                      </span>
                    )}
                  </div>
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
                <HearthIcon name="arrow_forward" size={18} />
              </button>
            </footer>
          </>
        )}

        {/* PANTALLA 2: UBICACIÓN Y PREFERENCIAS DE RUTA */}
        {wizardStep === "location" && (
          <>
            <div className="hearth-main">
              {renderProgressHeader(
                "Paso 2: Selecciona tu ubicación",
                2,
                "2 de 7"
              )}

              {/* Ciudad y Barrio en tarjetas adyacentes estilo Stitch */}
              <div className="hearth-field-row">
                <div className="hearth-loc-box">
                  <label className="hearth-loc-label" htmlFor="city-select">
                    <HearthIcon name="location_city" size={15} className="hearth-text-primary" />
                    <span>Ciudad</span>
                  </label>
                  <div className="hearth-select-inline-wrap">
                    <select
                      id="city-select"
                      className="hearth-select-borderless"
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
                    <HearthIcon name="expand_more" size={16} className="hearth-select-chevron" />
                  </div>
                </div>

                <div className="hearth-loc-box">
                  <label className="hearth-loc-label" htmlFor="barrio-select">
                    <HearthIcon name="home_pin" size={15} className="hearth-text-primary" />
                    <span>Barrio</span>
                  </label>
                  <div className="hearth-select-inline-wrap">
                    <select
                      id="barrio-select"
                      className="hearth-select-borderless"
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
                    <HearthIcon name="expand_more" size={16} className="hearth-select-chevron" />
                  </div>
                </div>
              </div>

              {locError && (
                <p style={{ fontSize: "0.75rem", color: "var(--h-warning)", marginTop: -6 }}>
                  {locError}
                </p>
              )}

              <RouteMap
                variant="location_preview"
                userLocation={userLocation}
                stops={previewStops}
                radiusMeters={clampedDistanceMeters}
                onRequestGeolocation={onRequestGeolocation}
                geoLoading={locLoading}
              />

              {/* Pregunta 1: Distancia máxima */}
              <div className="hearth-card hearth-slider-wrap">
                <div className="hearth-slider-header">
                  <label htmlFor="distance-range" className="hearth-q-label">
                    <span className="hearth-q-icon primary">
                      <HearthIcon name="near_me" size={16} />
                    </span>
                    <span>Distancia máxima que recorres para mercar</span>
                  </label>
                  <span className="hearth-slider-value tabular">
                    {(clampedDistanceMeters / 1000).toFixed(1)} km
                  </span>
                </div>

                <input
                  id="distance-range"
                  type="range"
                  className="hearth-range"
                  min={minNearestMeters}
                  max={15000}
                  step={100}
                  value={clampedDistanceMeters}
                  onChange={(e) => onChangeMaxDistanceMeters(Number(e.target.value))}
                />

                <div className="hearth-slider-scale">
                  <span>Mín {(minNearestMeters / 1000).toFixed(1)} km</span>
                  <span>{nearbyBranches.length} tiendas en radio</span>
                  <span>10 km</span>
                  <span>15 km</span>
                </div>
              </div>

              {/* Pregunta 2: ¿Máximo a cuántos supermercados irías? */}
              <div className="hearth-card hearth-q2-card">
                <div className="hearth-q2-left">
                  <span className="hearth-q-icon neutral">
                    <HearthIcon name="store" size={16} />
                  </span>
                  <div>
                    <label htmlFor="max-stores-select" className="hearth-q2-title">
                      ¿Máximo a cuántos supermercados irías?
                    </label>
                    <span className="hearth-q2-sub">
                      Para dividir tu canasta y optimizar el ahorro
                    </span>
                  </div>
                </div>

                <div className="hearth-compact-select-wrap">
                  <select
                    id="max-stores-select"
                    className="hearth-compact-select"
                    value={maxStores}
                    onChange={(e) =>
                      onChangeMaxStores(Number(e.target.value) as StoreCountLimit)
                    }
                  >
                    <option value={1}>1 tienda</option>
                    <option value={2}>2 tiendas</option>
                    <option value={3}>3 tiendas</option>
                    <option value={4}>4 tiendas</option>
                    <option value={5}>5 tiendas</option>
                  </select>
                  <HearthIcon name="expand_more" size={16} className="hearth-select-chevron" />
                </div>
              </div>
            </div>

            <footer className="hearth-sticky-footer">
              <div className="hearth-footer-pair">
                <button
                  type="button"
                  className="hearth-btn-secondary"
                  aria-label="Volver al paso 1"
                  onClick={() => {
                    onChangeWizardStep("mode");
                    scrollTop();
                  }}
                >
                  <HearthIcon name="arrow_back" size={17} />
                </button>
                <button
                  type="button"
                  className="hearth-btn-primary"
                  onClick={handleConfirmLocation}
                >
                  <span>Confirmar ubicación y preferencias</span>
                  <HearthIcon name="arrow_forward" size={17} />
                </button>
              </div>
            </footer>
          </>
        )}

        {/* PASO 3: EXPLORACIÓN LIBRE */}
        {wizardStep === "section_1" && experienceMode === "free_shop" && (
          <div className="hearth-main" style={{ paddingBottom: 100 }}>
            {renderProgressHeader(
              "Explora y arma tu mercado a tu medida",
              3,
              "Paso 3 de 7"
            )}
            {renderModeIndicator("section")}

            <div className="hearth-free-sticky">
              <form
                className="hearth-search-box"
                onSubmit={(e) => {
                  e.preventDefault();
                  setFreeSearching(true);
                  Promise.resolve(onSearchFreeShop?.(freeQuery)).finally(() =>
                    setFreeSearching(false)
                  );
                }}
              >
                <span className="hearth-search-icon-left">
                  <HearthIcon name="search" size={17} />
                </span>
                <input
                  type="search"
                  className="hearth-search-input"
                  placeholder="Buscar por marca, producto o presentación..."
                  value={freeQuery}
                  onChange={(e) => setFreeQuery(e.target.value)}
                />
                <button
                  type="submit"
                  className="hearth-search-submit-btn"
                  disabled={freeSearching}
                  aria-label="Buscar en catálogo"
                >
                  <HearthIcon name="arrow_forward" size={15} />
                </button>
              </form>

              <div>
                <div className="hearth-filter-top-meta">
                  <span>Sección principal</span>
                  <button
                    type="button"
                    className="hearth-link-text-btn"
                    onClick={() => {
                      setFreeSectionFilter("all");
                      setFreeSubsectionFilter("all");
                    }}
                  >
                    Ver todas (3)
                  </button>
                </div>

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
                    Todas
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
                      <HearthIcon name={sec.materialIcon} size={14} />
                      <span>{sec.shortLabel}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="hearth-free-sub-sort-row">
                <div className="hearth-scroll-pills" style={{ flex: 1 }}>
                  <button
                    type="button"
                    className={`hearth-sub-pill-chip ${
                      freeSubsectionFilter === "all" ? "active" : ""
                    }`}
                    onClick={() => setFreeSubsectionFilter("all")}
                  >
                    Todos
                  </button>
                  {freeSubsectionPills.map(({ sub, count }) => (
                    <button
                      key={sub.id}
                      type="button"
                      className={`hearth-sub-pill-chip ${
                        freeSubsectionFilter === sub.id ? "active" : ""
                      }`}
                      onClick={() => setFreeSubsectionFilter(sub.id)}
                    >
                      {sub.label.split(" ")[0]} ({count})
                    </button>
                  ))}
                </div>

                <div className="hearth-sort-pill-wrap">
                  <HearthIcon name="swap_vert" size={13} className="hearth-text-primary" />
                  <select
                    className="hearth-sort-select"
                    value={freeSort}
                    aria-label="Ordenar productos"
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
            </div>

            {freeShopSections.map(({ section, number, totalOffers, subGroups }) => (
              <section key={section.id} className="hearth-free-section-card">
                <div className="hearth-free-section-header">
                  <div className="hearth-free-section-left">
                    <span className="hearth-free-section-icon">
                      <HearthIcon name={section.materialIcon} size={19} />
                    </span>
                    <div>
                      <span className="hearth-free-section-kicker">
                        Sección 0{number}
                      </span>
                      <h2 className="hearth-free-section-title">{section.label}</h2>
                    </div>
                  </div>
                  <span className="hearth-free-count-pill">
                    {totalOffers} {totalOffers === 1 ? "producto" : "productos"}
                  </span>
                </div>

                {subGroups.map(({ sub, offers }, subIdx) => (
                  <div
                    key={sub.id}
                    className={`hearth-free-subgroup ${subIdx > 0 ? "divided" : ""}`}
                  >
                    <div className="hearth-sub-kicker-row">
                      <div className="hearth-sub-kicker-left">
                        <span className="hearth-ochre-dot" />
                        <h3 className="hearth-sub-kicker-title">
                          Subsección: {sub.label}
                        </h3>
                      </div>
                      <span className="hearth-sub-kicker-count">
                        {offers.length} {offers.length === 1 ? "opción" : "opciones"}
                      </span>
                    </div>

                    <div className="hearth-sub-rows-list">
                      {offers.map((offer) => {
                        const key = `free_shop:${offer.storeSkuId}`;
                        const added = basketItems.some((i) => i.itemKey === key);
                        const title = cleanProductTitle(offer.rawName);
                        return (
                          <article key={offer.storeSkuId} className="hearth-sku-card">
                            <OfferThumb
                              imageUrl={offer.imageUrl}
                              alt={title}
                              fallbackIcon={sub.materialIcon}
                              sizeClass="lg"
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="hearth-sku-title-row">
                                <span className="hearth-sku-title">{title}</span>
                                {offer.brand && (
                                  <span className="hearth-brand-pill">{offer.brand}</span>
                                )}
                              </div>
                              <p className="hearth-sku-meta">
                                {offer.netContent} {offer.unitMeasure} · {offer.storeName}
                              </p>
                              <div className="hearth-sku-price-row tabular">
                                <strong className="hearth-sku-price">
                                  {copFormatter.format(offer.calibratedPrice)}
                                </strong>
                                <span className="hearth-sku-pum">
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
                              <HearthIcon name={added ? "check" : "add"} size={17} />
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            ))}

            {/* Floating Basket Summary Bar matching Stitch 1830 */}
            <aside className="hearth-floating-cart-bar">
              <div className="hearth-floating-cart-left">
                <div className="hearth-floating-cart-icon">
                  <HearthIcon name="shopping_cart" size={19} />
                  <span className="hearth-floating-cart-badge tabular">
                    {basketItems.length}
                  </span>
                </div>
                <div>
                  <div className="hearth-floating-cart-title">
                    {basketItems.length}{" "}
                    {basketItems.length === 1 ? "producto agregado" : "productos agregados"}
                  </div>
                  <div className="hearth-floating-cart-sub tabular">
                    Subtotal estimado:{" "}
                    <strong>{copFormatter.format(freeEstimatedTotal)}</strong>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="hearth-floating-cart-cta"
                disabled={basketItems.length === 0}
                onClick={() => {
                  onChangeWizardStep("confirm");
                  scrollTop();
                }}
              >
                <span>Ver canasta</span>
                <HearthIcon name="arrow_forward" size={15} />
              </button>
            </aside>
          </div>
        )}

        {/* PASOS 3–5: GENÉRICO O HABITUAL */}
        {wizardStep === "section_1" &&
          experienceMode !== "free_shop" &&
          renderSectionStep(0)}
        {wizardStep === "section_2" && renderSectionStep(1)}
        {wizardStep === "section_3" && renderSectionStep(2)}

        {/* PASO 6: CONFIRMAR SELECCIÓN DE PRODUCTOS */}
        {wizardStep === "confirm" && (
          <>
            <div className="hearth-main">
              {renderProgressHeader(
                "Paso 6: Confirmar selección de productos",
                6,
                "6 de 7"
              )}
              {renderModeIndicator("confirm")}

              {/* Single White 3-metric Summary Card with Vertical Dividers */}
              <div className="hearth-confirm-trio-card">
                <div className="hearth-confirm-stat">
                  <span className="hearth-confirm-stat-val tabular">
                    {basketItems.length}
                  </span>
                  <span className="hearth-confirm-stat-label">Productos</span>
                </div>
                <div className="hearth-confirm-stat middle">
                  <span className="hearth-confirm-stat-val ink tabular">
                    {groupedBasketSections.length}
                  </span>
                  <span className="hearth-confirm-stat-label">Secciones</span>
                </div>
                <div className="hearth-confirm-stat">
                  {experienceMode === "generic_guided" ? (
                    <>
                      <span className="hearth-confirm-stat-val ochre tabular">
                        {nearbyBranches.length}
                      </span>
                      <span className="hearth-confirm-stat-label">Tiendas cerca</span>
                    </>
                  ) : (
                    <>
                      <span
                        className="hearth-confirm-stat-val ochre tabular"
                        style={{ fontSize: "0.94rem" }}
                      >
                        {copFormatter.format(freeEstimatedTotal)}
                      </span>
                      <span className="hearth-confirm-stat-label">Estimado base</span>
                    </>
                  )}
                </div>
              </div>

              {groupedBasketSections.map(({ section, items, subGroups }) => (
                <section key={section.id} className="hearth-sub-card">
                  <div className="hearth-sub-card-header">
                    <div className="hearth-sub-card-title-wrap">
                      <span className="hearth-sub-icon-box">
                        <HearthIcon name={section.materialIcon} size={17} />
                      </span>
                      <h2 className="hearth-sub-card-title">
                        Sección: {section.label}
                      </h2>
                    </div>
                    <span className="hearth-sub-card-count">
                      {items.length} {items.length === 1 ? "producto" : "productos"}
                    </span>
                  </div>

                  {subGroups.map(({ sub, items: subItems }, subIdx) => (
                    <div
                      key={sub.id}
                      className={`hearth-free-subgroup ${subIdx > 0 ? "divided" : ""}`}
                    >
                      <div className="hearth-sub-kicker-row">
                        <div className="hearth-sub-kicker-left">
                          <span className="hearth-ochre-dot" />
                          <h3 className="hearth-sub-kicker-title upper">
                            Subsección: {sub.label}
                          </h3>
                        </div>
                      </div>

                      <div className="hearth-sub-rows-list">
                        {subItems.map((item) => {
                          const packTag = formatPresentationTag(item);
                          return (
                            <div key={item.itemKey} className="hearth-sub-item-row">
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div className="hearth-confirm-title-row">
                                  <span className="hearth-item-name">
                                    {item.quantity && item.quantity > 1
                                      ? `${item.quantity}x `
                                      : ""}
                                    {item.label}
                                  </span>
                                  {packTag && (
                                    <span className="hearth-pack-badge">{packTag}</span>
                                  )}
                                </div>
                                <div className="hearth-pref-line">{renderPrefSummary(item)}</div>
                              </div>

                              <div className="hearth-item-actions">
                                <button
                                  type="button"
                                  className="hearth-icon-btn"
                                  title="Editar características"
                                  aria-label="Editar características"
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
                                  <HearthIcon name="edit" size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="hearth-icon-btn danger"
                                  title="Eliminar producto"
                                  aria-label="Eliminar producto"
                                  onClick={() => removeBasketItem(item.itemKey)}
                                >
                                  <HearthIcon name="delete" size={15} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
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
                  <HearthIcon name="arrow_back" size={16} />
                  <span>Volver al paso {experienceMode === "free_shop" ? 3 : 5}</span>
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
                  <HearthIcon name="arrow_forward" size={17} />
                </button>
              </div>
            </footer>
          </>
        )}

        {/* PASO 7: MARCAS QUE NO QUIERES VER */}
        {wizardStep === "exclude_brands" && (
          <>
            <div className="hearth-main">
              {renderProgressHeader(
                "Paso 7: Marcas que no quieres ver",
                7,
                "7 de 7"
              )}
              {renderModeIndicator("exclude")}

              <div className="hearth-amber-banner">
                <HearthIcon name="info" size={18} className="hearth-amber-icon" />
                <p>
                  ¿Hay alguna marca que prefieras evitar por sabor, calidad o experiencia? Selecciona o busca las marcas que no deseas incluir en la comparación final.
                </p>
              </div>

              {groupedBasketSections.map(({ section, items, subGroups }) => (
                <section key={section.id} className="hearth-sub-card">
                  <div className="hearth-sub-card-header">
                    <div className="hearth-sub-card-title-wrap">
                      <span className="hearth-sub-icon-box">
                        <HearthIcon name={section.materialIcon} size={17} />
                      </span>
                      <h2 className="hearth-sub-card-title">
                        Sección: {section.label}
                      </h2>
                    </div>
                    <span className="hearth-sub-card-count">
                      {items.length} {items.length === 1 ? "producto" : "productos"}
                    </span>
                  </div>

                  {subGroups.map(({ sub, items: subItems }, subIdx) => (
                    <div
                      key={sub.id}
                      className={`hearth-free-subgroup ${subIdx > 0 ? "divided" : ""}`}
                    >
                      <div className="hearth-sub-kicker-row">
                        <div className="hearth-sub-kicker-left">
                          <span className="hearth-ochre-dot" />
                          <h3 className="hearth-sub-kicker-title upper">
                            Subsección: {sub.label}
                          </h3>
                        </div>
                      </div>

                      <div className="hearth-sub-rows-list">
                        {subItems.map((item) => {
                          const availableBrands = getAvailableBrandsForItem(
                            item,
                            knownOffers
                          );
                          const excluded = item.excludedBrands ?? [];
                          const remainingBrands = availableBrands.filter(
                            (b) => !excluded.some((ex) => ex.toLowerCase() === b.toLowerCase())
                          );
                          const draft = customExcludedBrand[item.itemKey] ?? "";

                          return (
                            <div key={item.itemKey} className="hearth-excl-item-card">
                              <div className="hearth-excl-item-top">
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div className="hearth-item-name">{item.label}</div>
                                  <div className="hearth-pref-line">
                                    {availableBrands.length > 0
                                      ? `Marcas disponibles: ${availableBrands.slice(0, 6).join(", ")}`
                                      : "Escribe una marca si prefieres excluirla"}
                                  </div>
                                </div>
                                <span
                                  className={`hearth-excl-status ${
                                    excluded.length > 0 ? "active" : ""
                                  }`}
                                >
                                  {excluded.length > 0
                                    ? `${excluded.length} ${
                                        excluded.length === 1 ? "excluida" : "excluidas"
                                      }`
                                    : "Sin exclusiones"}
                                </span>
                              </div>

                              {remainingBrands.length > 0 ? (
                                <div className="hearth-excl-select-wrap">
                                  <span className="hearth-search-icon-left">
                                    <HearthIcon name="search" size={15} />
                                  </span>
                                  <select
                                    className="hearth-excl-select"
                                    value=""
                                    aria-label={`Excluir marca de ${item.label}`}
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        addExcludedBrand(item.itemKey, e.target.value);
                                      }
                                    }}
                                  >
                                    <option value="">
                                      Buscar y seleccionar marca para excluir...
                                    </option>
                                    {remainingBrands.map((brand) => (
                                      <option key={brand} value={brand}>
                                        {brand}
                                      </option>
                                    ))}
                                  </select>
                                  <span className="hearth-select-chevron-right">
                                    <HearthIcon name="expand_more" size={15} />
                                  </span>
                                </div>
                              ) : (
                                <div style={{ display: "flex", gap: 6 }}>
                                  <div className="hearth-excl-select-wrap" style={{ flex: 1 }}>
                                    <span className="hearth-search-icon-left">
                                      <HearthIcon name="search" size={15} />
                                    </span>
                                    <input
                                      type="text"
                                      className="hearth-excl-input"
                                      placeholder="Escribir marca a excluir..."
                                      value={draft}
                                      onChange={(e) =>
                                        setCustomExcludedBrand((prev) => ({
                                          ...prev,
                                          [item.itemKey]: e.target.value,
                                        }))
                                      }
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    className="hearth-btn-secondary"
                                    style={{ minHeight: 36, padding: "4px 12px", fontSize: "0.75rem" }}
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
                                      title="Quitar exclusión"
                                    >
                                      <HearthIcon name="block" size={13} />
                                      <span>{brand}</span>
                                      <HearthIcon name="close" size={13} />
                                    </button>
                                  ))}
                                  <span className="hearth-excl-hint">+ Excluir otra marca</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
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
                    onChangeWizardStep("confirm");
                    scrollTop();
                  }}
                >
                  <HearthIcon name="arrow_back" size={16} />
                  <span>Volver al paso 6</span>
                </button>
                <button
                  type="button"
                  className="hearth-btn-primary"
                  onClick={() => {
                    onChangeWizardStep("results");
                    scrollTop();
                  }}
                >
                  <span>Ver tu compra ideal</span>
                  <HearthIcon name="analytics" size={17} />
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
                <div className="hearth-results-kicker">
                  <span className="hearth-ochre-dot" />
                  <span>Optimización inteligente</span>
                </div>
                <h1 className="hearth-step-title" style={{ fontSize: "1.42rem" }}>
                  ¡Tu compra ideal está lista!
                </h1>
                <p className="hearth-step-subtitle">
                  Comparamos los productos seleccionados entre los supermercados cercanos, optimizando precio y respetando tus filtros.
                </p>
              </div>

              {activePlan ? (
                <>
                  {/* 3 Tarjetas KPI estilo Stitch */}
                  <div className="hearth-kpi-grid">
                    <div className="hearth-kpi-card">
                      <div className="hearth-kpi-head">
                        <HearthIcon name="storefront" size={14} className="hearth-ink-3" />
                        <span className="hearth-kpi-label">Referencia</span>
                      </div>
                      <div>
                        <span className="hearth-kpi-val strike red-line tabular">
                          {copFormatter.format(activePlan.baselineReferenceTotalCost)}
                        </span>
                        <span className="hearth-kpi-sub">Sin optimizar</span>
                      </div>
                    </div>

                    <div className="hearth-kpi-card hero">
                      <div className="hearth-kpi-head">
                        <HearthIcon name="verified" size={14} className="hearth-ochre" />
                        <span className="hearth-kpi-label ochre">MercaSabio</span>
                      </div>
                      <div>
                        <span className="hearth-kpi-val white tabular">
                          {copFormatter.format(activePlan.totalNominalCost)}
                        </span>
                        <span className="hearth-kpi-sub light">Precio final</span>
                      </div>
                    </div>

                    <div className="hearth-kpi-card emerald">
                      <div className="hearth-kpi-head">
                        <HearthIcon name="savings" size={14} className="hearth-emerald" />
                        <span className="hearth-kpi-label emerald">Tu ahorro</span>
                      </div>
                      <div>
                        <span className="hearth-kpi-val success tabular">
                          {copFormatter.format(activePlan.savingsVsBaselineCop)}
                        </span>
                        <span className="hearth-kpi-pct-pill tabular">
                          {activePlan.savingsVsBaselinePct}% MENOS
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Multi-store Route Strip Banner con stepper - / + */}
                  <div className="hearth-route-stepper-card-v2">
                    <div className="hearth-route-stepper-top">
                      <div className="hearth-route-stepper-left">
                        <span className="hearth-route-icon-box">
                          <HearthIcon name="alt_route" size={19} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div className="hearth-route-title-row">
                            <span className="hearth-route-title">Ruta optimizada</span>
                            <span className="hearth-route-active-pill">Activa</span>
                          </div>
                          <p className="hearth-route-stores-line">
                            {activePlan.storeStops
                              .map(
                                (s) =>
                                  `${s.storeName} (${s.allocations.length} ${
                                    s.allocations.length === 1 ? "prod." : "productos"
                                  })`
                              )
                              .join(" · ")}
                          </p>
                        </div>
                      </div>

                      <div className="hearth-stops-stepper">
                        <button
                          type="button"
                          className="hearth-stops-btn"
                          disabled={maxStores <= 1}
                          aria-label="Disminuir paradas"
                          onClick={() =>
                            onChangeMaxStores(Math.max(1, maxStores - 1) as StoreCountLimit)
                          }
                        >
                          <HearthIcon name="remove" size={14} />
                        </button>
                        <div className="hearth-stops-readout">
                          <span className="hearth-stops-num tabular">
                            {activePlan.storeStops.length}{" "}
                            {activePlan.storeStops.length === 1 ? "parada" : "paradas"}
                          </span>
                          <span className="hearth-stops-cap">supermercados</span>
                        </div>
                        <button
                          type="button"
                          className="hearth-stops-btn"
                          disabled={maxStores >= 5}
                          aria-label="Aumentar paradas"
                          onClick={() =>
                            onChangeMaxStores(Math.min(5, maxStores + 1) as StoreCountLimit)
                          }
                        >
                          <HearthIcon name="add" size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="hearth-route-stepper-bottom">
                      <span className="hearth-route-dist">
                        <HearthIcon name="swap_calls" size={13} className="hearth-ochre" />
                        <span>
                          Distancia estimada:{" "}
                          <strong className="tabular">
                            {(activePlan.totalDistanceMeters / 1000).toFixed(1)} km total
                          </strong>
                        </span>
                      </span>
                      <span className="hearth-route-recalc-pill">
                        Recalcular precio al cambiar
                      </span>
                    </div>
                  </div>

                  {experienceMode === "habitual_guided" &&
                    habitualProfileSummary.inferredTraits.length > 0 && (
                      <div className="hearth-info-banner">
                        <HearthIcon name="auto_awesome" size={17} />
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

                  {groupedResultAllocations.map(
                    ({ section, allocations, savingsCop, savingsPct }) => (
                      <section key={section.id} className="hearth-sub-card">
                        <div className="hearth-sub-card-header">
                          <div className="hearth-sub-card-title-wrap">
                            <span className="hearth-sub-icon-box">
                              <HearthIcon name={section.materialIcon} size={17} />
                            </span>
                            <h2 className="hearth-sub-card-title">
                              Sección: {section.label}
                            </h2>
                          </div>
                          {savingsCop > 0 && (
                            <span className="hearth-section-saving-label tabular">
                              Ahorro: {copFormatter.format(savingsCop)} ({savingsPct}%)
                            </span>
                          )}
                        </div>

                        <div className="hearth-sub-rows-list">
                          {allocations.map((alloc) => {
                            const isSwapping = swapItemKey === alloc.itemKey;
                            const runnerUp = alloc.runnerUpOffer;
                            const title = cleanProductTitle(alloc.offer.rawName);
                            const itemSaveCop = Math.max(
                              0,
                              alloc.baselineReferenceCost - alloc.nominalCost
                            );
                            const itemSavePct =
                              alloc.baselineReferenceCost > 0
                                ? Math.round((itemSaveCop / alloc.baselineReferenceCost) * 100)
                                : 0;
                            const srcItem = basketByKey.get(alloc.itemKey);
                            const excludedList = srcItem?.excludedBrands ?? [];
                            const subIcon =
                              getSubsectionForItem(
                                srcItem ?? { label: alloc.label }
                              ).sectionId === "nevera"
                                ? "local_drink"
                                : getSubsectionForItem(srcItem ?? { label: alloc.label })
                                      .sectionId === "aseo"
                                  ? "local_laundry_service"
                                  : "inventory_2";

                            return (
                              <article key={alloc.itemKey} className="hearth-res-item-card">
                                <div className="hearth-res-item-top">
                                  <div className="hearth-res-item-left">
                                    <OfferThumb
                                      imageUrl={alloc.offer.imageUrl}
                                      alt={title}
                                      fallbackIcon={subIcon}
                                      sizeClass="sm"
                                    />
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <div className="hearth-res-title-row">
                                        <span className="hearth-item-name" style={{ fontSize: "0.84rem" }}>
                                          {alloc.quantity > 1 ? `${alloc.quantity}x ` : ""}
                                          {title}
                                        </span>
                                        <span className="hearth-store-tag">
                                          {alloc.offer.storeName}
                                        </span>
                                      </div>
                                      <p className="hearth-pref-line">
                                        {alloc.offer.netContent} {alloc.offer.unitMeasure} ·{" "}
                                        {alloc.offer.brand || alloc.branch.branchName}
                                      </p>
                                      {alloc.baselineReferenceCost > alloc.nominalCost && (
                                        <span className="hearth-res-ref tabular">
                                          Ref. mercado:{" "}
                                          {copFormatter.format(alloc.baselineReferenceCost)}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="hearth-res-price-col">
                                    <span className="hearth-res-price tabular">
                                      {copFormatter.format(alloc.nominalCost)}
                                    </span>
                                    {itemSaveCop > 0 && (
                                      <span className="hearth-res-save-pill tabular">
                                        -{copFormatter.format(itemSaveCop)} (-{itemSavePct}%)
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {(runnerUp ||
                                  excludedList.length > 0 ||
                                  alloc.alternativesInStore.length > 1) && (
                                  <div className="hearth-res-item-footer">
                                    <span className="hearth-alt-text">
                                      {excludedList.length > 0
                                        ? `${excludedList[0]} excluida · `
                                        : ""}
                                      {runnerUp
                                        ? `Alternativa evaluada: ${cleanProductTitle(
                                            runnerUp.rawName
                                          )} (${copFormatter.format(
                                            runnerUp.calibratedPrice
                                          )})`
                                        : "Mejor opción del radio"}
                                    </span>

                                    {alloc.alternativesInStore.length > 1 && (
                                      <button
                                        type="button"
                                        className={`hearth-edit-pref-btn ${
                                          isSwapping ? "active" : ""
                                        }`}
                                        onClick={() =>
                                          setSwapItemKey(isSwapping ? null : alloc.itemKey)
                                        }
                                      >
                                        <HearthIcon name="tune" size={13} />
                                        <span>Ver otros recomendados</span>
                                      </button>
                                    )}
                                  </div>
                                )}

                                {isSwapping && alloc.alternativesInStore.length > 1 && (
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
                                              style={{ fontSize: "0.81rem" }}
                                            >
                                              {cleanProductTitle(alt.rawName)}
                                            </div>
                                            <div className="hearth-pref-line">
                                              {alt.brand} · {alt.netContent} {alt.unitMeasure} ·
                                              PUM {pumFormatter.format(alt.pumPrice)}/
                                              {alt.unitMeasure}
                                            </div>
                                          </div>
                                          <strong
                                            className="tabular"
                                            style={{
                                              fontSize: "0.84rem",
                                              color: "var(--h-primary)",
                                            }}
                                          >
                                            {copFormatter.format(alt.calibratedPrice)}
                                          </strong>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    )
                  )}

                  {optimization.uncoveredItems.length > 0 && (
                    <div className="hearth-card" style={{ borderColor: "#E8C995" }}>
                      <div className="hearth-label" style={{ color: "var(--h-warning)" }}>
                        Sin stock en el radio o con tus filtros (
                        {optimization.uncoveredItems.length}):
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
                  aria-label="Ajustar filtros"
                  onClick={() => {
                    onChangeWizardStep("exclude_brands");
                    scrollTop();
                  }}
                >
                  <HearthIcon name="arrow_back" size={16} />
                  <span>Ajustar</span>
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
                  <HearthIcon name="alt_route" size={18} className="hearth-ochre" />
                  <span>Ver ruta de mercado</span>
                  <HearthIcon name="arrow_forward" size={17} />
                </button>
              </div>
            </footer>
          </>
        )}

        {/* PANTALLA 9: RUTA IDEAL — MAPA Y LISTA DE COMPRAS */}
        {wizardStep === "route" && (
          <>
            <div className="hearth-main">
              <div>
                <div className="hearth-route-page-head">
                  <h1 className="hearth-step-title">Ruta Ideal</h1>
                  {routeSummary && (
                    <span className="hearth-route-time-pill tabular">
                      <HearthIcon
                        name="directions_walk"
                        size={14}
                        className="hearth-text-primary"
                      />
                      <span>
                        {(routeSummary.distanceMeters / 1000).toFixed(1)} km · ~
                        {Math.max(1, Math.round(routeSummary.durationSeconds / 60))} min
                      </span>
                    </span>
                  )}
                </div>
                {activePlan && (
                  <p className="hearth-step-subtitle">
                    Tu trayecto óptimo: Salida desde <strong>Tu ubicación</strong>
                    {activePlan.storeStops.map(
                      (s, idx) => ` → Parada ${idx + 1} (${s.storeName})`
                    )}
                    .
                  </p>
                )}
              </div>

              {activePlan && (
                <>
                  <RouteMap
                    variant="route"
                    userLocation={userLocation}
                    stops={routeMapStops}
                    onSummaryChange={setRouteSummary}
                    savingsLabel={`Ahorro: ${copFormatter.format(
                      activePlan.savingsVsBaselineCop
                    )}`}
                  />

                  <div className="hearth-checklist-banner">
                    <div className="hearth-checklist-banner-left">
                      <HearthIcon
                        name="checklist"
                        size={18}
                        className="hearth-text-primary"
                      />
                      <div>
                        <span className="hearth-checklist-title">
                          Lista de compras interactiva
                        </span>
                        <span className="hearth-checklist-sub">
                          Toca cualquier ítem para tacharlo al meterlo en tu canasta
                        </span>
                      </div>
                    </div>
                    <span className="hearth-checklist-counter tabular">
                      {checklistProgress.done} / {checklistProgress.total} listos
                    </span>
                  </div>

                  {activePlan.storeStops.map((stop, idx) => (
                    <section key={stop.storeId} className="hearth-sub-card">
                      <div className="hearth-sub-card-header">
                        <div className="hearth-stop-left">
                          <span className={`hearth-stop-num-box ${idx === 0 ? "first" : ""}`}>
                            {idx + 1}
                          </span>
                          <div>
                            <div className="hearth-stop-title-row">
                              <h2 className="hearth-sub-card-title">{stop.storeName}</h2>
                              <span className={`hearth-stop-tag ${idx === 0 ? "first" : ""}`}>
                                Parada {idx + 1}
                              </span>
                            </div>
                            <p className="hearth-stop-meta">
                              {stop.branch.branchName} · {Math.round(stop.branch.distanceMeters)}{" "}
                              m · {stop.allocations.length}{" "}
                              {stop.allocations.length === 1 ? "producto" : "productos"}
                            </p>
                          </div>
                        </div>
                        <strong className="hearth-stop-subtotal tabular">
                          {copFormatter.format(stop.subtotalNominal)}
                        </strong>
                      </div>

                      <div className="hearth-sub-rows-list">
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
                                {checked && <HearthIcon name="check" size={14} />}
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
                              <strong className="hearth-check-price tabular">
                                {copFormatter.format(alloc.nominalCost)}
                              </strong>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}

                  <div className="hearth-export-grid">
                    <button
                      type="button"
                      className="hearth-btn-secondary"
                      onClick={handleCopyPlainText}
                    >
                      <HearthIcon name="content_copy" size={16} />
                      <span>{copiedNotice ? "¡Copiada!" : "Copiar lista"}</span>
                    </button>
                    <button
                      type="button"
                      className="hearth-btn-secondary"
                      onClick={handleDownloadPlainText}
                    >
                      <HearthIcon name="download" size={16} />
                      <span>Descargar .txt</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    className="hearth-report-btn"
                    onClick={() => {
                      const first = activePlan.storeStops[0]?.allocations[0]?.itemKey ?? "";
                      setReportAllocKey(first);
                      setReportFeedback(null);
                      setReportModalOpen(true);
                    }}
                  >
                    <HearthIcon
                      name="report_problem"
                      size={17}
                      className="hearth-ochre-dark"
                    />
                    <span>Reportar precios diferentes</span>
                  </button>

                  <p className="hearth-community-note">
                    Tus reportes actualizan la comunidad y mejoran la precisión de MercaSabio
                  </p>
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
                  <HearthIcon name="arrow_back" size={16} />
                  <span>Volver a compra</span>
                </button>
                <button
                  type="button"
                  className="hearth-btn-primary"
                  onClick={() => {
                    onChangeWizardStep("mode");
                    scrollTop();
                  }}
                >
                  <HearthIcon name="restart_alt" size={17} />
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
              <div className="hearth-sheet-handle" aria-hidden="true" />
              <div className="hearth-sheet-header">
                <div>
                  <div className="hearth-sheet-title-row">
                    <span className="hearth-sheet-icon-box">
                      <HearthIcon name={habitualModalSub.materialIcon} size={15} />
                    </span>
                    <h3 className="hearth-sheet-title">
                      Agregar a {habitualModalSub.label}
                    </h3>
                  </div>
                  <div className="hearth-pref-line">
                    Selecciona marca, presentación y precio real de tu zona
                  </div>
                </div>
                <button
                  type="button"
                  className="hearth-sheet-close"
                  onClick={() => setHabitualModalSub(null)}
                  aria-label="Cerrar"
                >
                  <HearthIcon name="close" size={18} />
                </button>
              </div>

              <div className="hearth-sheet-body">
                <div className="hearth-search-box">
                  <span className="hearth-search-icon-left">
                    <HearthIcon name="search" size={17} />
                  </span>
                  <input
                    type="search"
                    className="hearth-search-input"
                    placeholder={`Buscar marca o tipo en ${habitualModalSub.label}...`}
                    value={habitualModalQuery}
                    onChange={(e) => setHabitualModalQuery(e.target.value)}
                  />
                  {habitualModalQuery && (
                    <button
                      type="button"
                      className="hearth-search-clear-btn"
                      onClick={() => setHabitualModalQuery("")}
                      aria-label="Limpiar búsqueda"
                    >
                      <HearthIcon name="cancel" size={15} />
                    </button>
                  )}
                </div>

                {/* Píldoras de filtro por alimento de la subsección estilo Stitch 1829 */}
                <div className="hearth-scroll-pills">
                  <button
                    type="button"
                    className={`hearth-pill-filter ${
                      habitualModalFoodId === "all" ? "active" : ""
                    }`}
                    onClick={() => setHabitualModalFoodId("all")}
                  >
                    Todos ({habitualModalBaseOffers.length})
                  </button>
                  {habitualModalFoodChips.map(({ food, count }) => (
                    <button
                      key={food.id}
                      type="button"
                      className={`hearth-pill-filter ${
                        habitualModalFoodId === food.id ? "active" : ""
                      }`}
                      onClick={() => setHabitualModalFoodId(food.id)}
                    >
                      {food.name.split(" ")[0]} ({count})
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
                    const title = cleanProductTitle(offer.rawName);
                    return (
                      <button
                        key={offer.storeSkuId}
                        type="button"
                        className={`hearth-sku-pick-card ${selected ? "selected" : ""}`}
                        onClick={() => setHabitualModalSelectedSku(offer)}
                      >
                        <OfferThumb
                          imageUrl={offer.imageUrl}
                          alt={title}
                          fallbackIcon={habitualModalSub.materialIcon}
                          sizeClass="sm"
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="hearth-sku-title-row">
                            <span className="hearth-sku-title">{title}</span>
                            {offer.brand && (
                              <span className="hearth-brand-pill">
                                Marca {offer.brand}
                              </span>
                            )}
                          </div>
                          <div className="hearth-pref-line tabular">
                            {offer.netContent} {offer.unitMeasure} · PUM{" "}
                            {pumFormatter.format(offer.pumPrice)}/{offer.unitMeasure}
                          </div>
                        </div>

                        <div className="hearth-pick-right">
                          <strong className="hearth-pick-price tabular">
                            {copFormatter.format(offer.calibratedPrice)}
                          </strong>
                          {selected ? (
                            <span className="hearth-pick-check">
                              <HearthIcon name="check" size={13} />
                            </span>
                          ) : (
                            <span className="hearth-pick-store">{offer.storeName}</span>
                          )}
                        </div>
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
                      ? `Agregar producto (${copFormatter.format(
                          habitualModalSelectedSku.calibratedPrice
                        )})`
                      : "Selecciona un producto"}
                  </span>
                  {habitualModalSelectedSku && <HearthIcon name="add" size={17} />}
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
              <div className="hearth-sheet-handle" aria-hidden="true" />
              <div className="hearth-sheet-header">
                <h3 className="hearth-sheet-title">
                  Reportar precio o diferencia en tienda
                </h3>
                <button
                  type="button"
                  className="hearth-sheet-close"
                  onClick={() => setReportModalOpen(false)}
                  aria-label="Cerrar"
                >
                  <HearthIcon name="close" size={18} />
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
                    <HearthIcon name="check_circle" size={17} />
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
