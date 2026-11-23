"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ParallelAhorroView,
  type ParallelAhorroSubTab,
} from "@/components/parallel/ParallelAhorroView";
import { ParallelCanastaView, type CanastaSubView } from "@/components/parallel/ParallelCanastaView";
import {
  ParallelHeader,
  ParallelMobileBottomNav,
  type ParallelTab,
} from "@/components/parallel/ParallelChrome";
import { ParallelInicioView } from "@/components/parallel/ParallelInicioView";
import {
  ParallelBudgetModal,
  ParallelProductSheet,
  ParallelReportPriceModal,
  ParallelZoneModal,
} from "@/components/parallel/ParallelModals";
import { ParallelRutaView } from "@/components/parallel/ParallelRutaView";
import { AutoSyncDevicesModal } from "@/components/v3/AutoSyncDevicesModal";
import { BasketPreferencesModal } from "@/components/v3/BasketPreferencesModal";
import { FavoriteBasketsModal } from "@/components/v3/FavoriteBasketsModal";
import { HouseholdProfileModal } from "@/components/v3/HouseholdProfileModal";
import { HybridItemEditorModal } from "@/components/v3/HybridItemEditorModal";
import { MisMercadosModal } from "@/components/v3/MisMercadosModal";
import { SabiometroVoteSheet } from "@/components/v3/SabiometroVoteSheet";
import { WorkspaceProvider, useWorkspace } from "@/components/v3/WorkspaceContext";
import { HabitualPickerModal } from "@/components/wizard/HabitualPickerModal";
import {
  optimizeBasket,
  type BasketItemInput,
  type BasketOptimizeOptions,
  type BasketPlan,
} from "@/lib/basketOptimizer";
import { hydrateBasketItemsFromSnapshot } from "@/lib/communityBaskets";
import { extractProductSignature } from "@/lib/comparisonEngine";
import { toggleBasketDietFilter } from "@/lib/dietaryFilter";
import {
  ALL_BARRIOS,
  buildDefaultGenericBasketItems,
  formatBasketAsPlainText,
  getSectionIdForItem,
  getSubsectionForItem,
  GUIDED_SECTIONS,
  inferHabitualItemProfile,
  offerMatchesSubsection,
  type GenericFoodOption,
  type GuidedSubsection,
  type ShoppingExperienceMode,
} from "@/lib/guidedCatalog";
import { detectPackTrap } from "@/lib/packTrap";
import {
  filterBranchesByCityAndDoubleRadius,
  filterOffersByCityAvailability,
  filterOffersByStoreIds,
  normalizeColombiaCityName,
  resolveSelectedCityName,
} from "@/lib/locationFilter";
import { cleanProductTitle } from "@/lib/productInsights";
import { indexSamePlantPairs } from "@/lib/samePlant";
import { clampRadiusForTransport, getTransportProfile } from "@/lib/transport";
import type {
  DashboardPayload,
  DietFilter,
  NearbyStoreBranch,
  StoreOffer,
  TransportMode,
} from "@/lib/types";

const BASKET_STORAGE_KEY = "mercasabio_basket_v1";
const LOCATION_STORAGE_KEY = "mercasabio_loc_v1";

function collectOffersFromPayload(payload: DashboardPayload): StoreOffer[] {
  const seen = new Map<string, StoreOffer>();
  for (const group of [...payload.eanGroups, ...payload.pumGroups]) {
    for (const offer of group.offers) seen.set(offer.storeSkuId, offer);
    for (const m of [...(group.directCompetitors ?? []), ...(group.similarCompetitors ?? [])]) {
      seen.set(m.offer.storeSkuId, m.offer);
    }
    for (const b of group.bulkOptions ?? []) seen.set(b.offer.storeSkuId, b.offer);
  }
  return [...seen.values()];
}

function ParallelComparatorInner({
  initialData,
  initialTab = "inicio",
}: {
  initialData: DashboardPayload;
  initialTab?: ParallelTab;
}) {
  const {
    userProfile,
    paymentMethods,
    baskets,
    favorites,
    favoriteLimit,
    syncActiveBasket,
    saveProfileAndPayments,
    recordPurchaseEvents,
  } = useWorkspace();

  const [knownOffers, setKnownOffers] = useState<Map<string, StoreOffer>>(() => {
    const map = new Map<string, StoreOffer>();
    for (const offer of collectOffersFromPayload(initialData)) {
      map.set(offer.storeSkuId, offer);
    }
    return map;
  });

  const [basketItems, setBasketItems] = useState<BasketItemInput[]>([]);
  const [basketHydrated, setBasketHydrated] = useState(false);
  const [userLocation, setUserLocation] = useState({
    lat: 4.646,
    lng: -74.063,
    label: "Bogotá · Chapinero",
  });
  const [locationHydrated, setLocationHydrated] = useState(false);
  const [transportMode, setTransportMode] = useState<TransportMode>("walk");
  const [radiusMeters, setRadiusMeters] = useState<number>(3000);
  const [allNearbyBranches, setAllNearbyBranches] = useState<NearbyStoreBranch[]>([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ParallelTab>(initialTab);
  const [canastaSubView, setCanastaSubView] = useState<CanastaSubView>("basket");
  const [ahorroSubTab, setAhorroSubTab] = useState<ParallelAhorroSubTab>("optimizada");
  const [experienceMode, setExperienceMode] = useState<ShoppingExperienceMode>("generic_guided");
  const [maxStores, setMaxStores] = useState<1 | 2 | 3 | 4 | 5>(2);
  const [activeDietFilters, setActiveDietFilters] = useState<DietFilter[]>([]);
  const [minSabioIndex, setMinSabioIndex] = useState<number>(0);

  const [inspectState, setInspectState] = useState<{
    offer: StoreOffer;
    baselineOffer?: StoreOffer | null;
    itemKey?: string;
  } | null>(null);
  const [votingOffer, setVotingOffer] = useState<StoreOffer | null>(null);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [devicesModalOpen, setDevicesModalOpen] = useState(false);
  const [householdModalOpen, setHouseholdModalOpen] = useState(false);
  const [favoritesModalOpen, setFavoritesModalOpen] = useState(false);
  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [misMercadosModalOpen, setMisMercadosModalOpen] = useState(false);
  const [prefsModalOpen, setPrefsModalOpen] = useState(false);
  const [hybridEditingItem, setHybridEditingItem] = useState<BasketItemInput | null>(null);

  const [habitualSub, setHabitualSub] = useState<GuidedSubsection | null>(null);
  const [habitualQuery, setHabitualQuery] = useState("");
  const [habitualFoodId, setHabitualFoodId] = useState("all");
  const [habitualSelectedSku, setHabitualSelectedSku] = useState<StoreOffer | null>(null);

  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dietSavedNotice, setDietSavedNotice] = useState(false);

  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportAllocKey, setReportAllocKey] = useState("");
  const [reportReason, setReportReason] = useState<
    "distinta_calidad" | "distinto_producto" | "tamano_incomparable" | "otro"
  >("otro");
  const [reportComment, setReportComment] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);

  const prefetchedRef = useRef<Set<string>>(new Set());
  const profileAppliedRef = useRef(false);
  const remoteBasketAppliedRef = useRef(false);

  // Hydrate basket, location, and URL ?tab= on client mount (keeps /v2 static ISR)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get("tab");
      if (urlTab === "inicio" || urlTab === "canasta" || urlTab === "ahorro" || urlTab === "ruta") {
        setActiveTab(urlTab);
      }
    } catch {
      // Ignore URL parse error
    }

    try {
      const saved = window.localStorage.getItem(BASKET_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setBasketItems(
            parsed.filter(
              (item): item is BasketItemInput =>
                Boolean(item) && typeof item.itemKey === "string" && typeof item.label === "string"
            )
          );
        }
      }
    } catch {
      // Ignore corrupt storage
    } finally {
      setBasketHydrated(true);
    }

    try {
      const savedLoc = window.localStorage.getItem(LOCATION_STORAGE_KEY);
      if (savedLoc) {
        const parsed = JSON.parse(savedLoc) as { lat?: unknown; lng?: unknown; label?: unknown };
        if (
          typeof parsed.lat === "number" &&
          typeof parsed.lng === "number" &&
          Number.isFinite(parsed.lat) &&
          Number.isFinite(parsed.lng) &&
          typeof parsed.label === "string"
        ) {
          const cleanLabel = parsed.label.slice(0, 60);
          const catalogBarrio = ALL_BARRIOS.find((b) => b.label === cleanLabel);
          setUserLocation({
            lat: Number((catalogBarrio ? catalogBarrio.lat : parsed.lat).toFixed(3)),
            lng: Number((catalogBarrio ? catalogBarrio.lng : parsed.lng).toFixed(3)),
            label: cleanLabel,
          });
        }
      }
    } catch {
      // Ignore corrupt storage
    } finally {
      setLocationHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!userProfile || profileAppliedRef.current) return;
    profileAppliedRef.current = true;
    if (userProfile.dietaryRestrictions?.length > 0) {
      setActiveDietFilters(userProfile.dietaryRestrictions);
    }
    if (userProfile.transportMode) {
      setTransportMode(userProfile.transportMode);
      const prof = getTransportProfile(userProfile.transportMode);
      setRadiusMeters((prev) =>
        clampRadiusForTransport(prev || prof.defaultRadiusM, userProfile.transportMode)
      );
    }
  }, [userProfile]);

  useEffect(() => {
    if (!basketHydrated || remoteBasketAppliedRef.current) return;
    const primary =
      baskets.find((b) => b.status === "optimized" || b.status === "draft") ?? baskets[0];
    if (primary && Array.isArray(primary.items) && primary.items.length > 0) {
      remoteBasketAppliedRef.current = true;
      const mapped: BasketItemInput[] = primary.items.map((it) => {
        const raw = (it.payload ?? {}) as Partial<BasketItemInput>;
        return {
          ...raw,
          itemKey: it.itemKey,
          label: typeof raw.label === "string" && raw.label ? raw.label : it.itemKey,
          quantity: it.quantity ?? raw.quantity ?? 1,
          locked: Boolean(it.isLocked ?? raw.locked),
        };
      });
      setBasketItems((prev) => (prev.length === 0 ? mapped : prev));
      if (primary.activeDietFilters?.length > 0 && activeDietFilters.length === 0) {
        setActiveDietFilters(primary.activeDietFilters);
      }
    }
  }, [baskets, basketHydrated, activeDietFilters.length]);

  useEffect(() => {
    if (!basketHydrated) return;
    try {
      window.localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(basketItems));
    } catch {
      // Silent
    }
    syncActiveBasket(basketItems, activeDietFilters);
  }, [basketItems, basketHydrated, activeDietFilters, syncActiveBasket]);

  useEffect(() => {
    if (!locationHydrated) return;
    try {
      window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(userLocation));
    } catch {
      // Silent
    }
  }, [userLocation, locationHydrated]);

  useEffect(() => {
    let active = true;
    async function loadNearby() {
      setLocLoading(true);
      setBranchesLoaded(false);
      setLocError(null);
      try {
        const res = await fetch(
          `/api/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=30000`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { branches?: NearbyStoreBranch[] };
        if (active) {
          setAllNearbyBranches(json.branches ?? []);
          setBranchesLoaded(true);
        }
      } catch {
        if (active) setLocError("No se pudieron consultar sucursales cercanas.");
      } finally {
        if (active) setLocLoading(false);
      }
    }
    void loadNearby();
    return () => {
      active = false;
    };
  }, [userLocation.lat, userLocation.lng]);

  const chosenCity = useMemo(
    () => resolveSelectedCityName(userLocation, ALL_BARRIOS, allNearbyBranches),
    [userLocation, allNearbyBranches]
  );

  const branchScope = useMemo(
    () =>
      filterBranchesByCityAndDoubleRadius({
        branches: allNearbyBranches,
        chosenCity,
        radiusMeters,
      }),
    [allNearbyBranches, chosenCity, radiusMeters]
  );

  const nearbyBranches = branchScope.eligibleBranches;

  const knownOffersList = useMemo(() => [...knownOffers.values()], [knownOffers]);

  // Filtra inactivos/agotados, tiendas fuera de ciudad o >= 2x distancia elegida,
  // y disponibilidad regional por SKU en esa ciudad
  const visibleOffers = useMemo(() => {
    const activeOnly = knownOffersList.filter((o) => o.inStock && o.calibratedPrice > 0);
    const storeScoped =
      !branchesLoaded || locError
        ? activeOnly
        : filterOffersByStoreIds(activeOnly, branchScope.visibleStoreIds);
    return filterOffersByCityAvailability(storeScoped, chosenCity);
  }, [knownOffersList, branchesLoaded, locError, branchScope.visibleStoreIds, chosenCity]);

  const samePlantIndex = useMemo(
    () => indexSamePlantPairs(initialData.samePlantPairs ?? []),
    [initialData.samePlantPairs]
  );

  const optimizeOptions = useMemo<BasketOptimizeOptions>(() => {
    const profile = getTransportProfile(transportMode);
    return {
      objective: "nominal",
      minExtraSavingsCop: 1500,
      minExtraSavingsPct: 2,
      maxStores,
      maxDistanceMeters: radiusMeters,
      activeDietFilters,
      minSabioIndex,
      travelCostPerKmCop: profile.costPerKmCop,
      perStopCostCop: profile.costPerTripCop,
    };
  }, [transportMode, maxStores, radiusMeters, activeDietFilters, minSabioIndex]);

  const optimization = useMemo(
    () =>
      optimizeBasket({
        items: basketItems,
        offers: visibleOffers,
        nearbyBranches: branchScope.branchesWithinDoubleRadius,
        options: optimizeOptions,
      }),
    [basketItems, visibleOffers, branchScope.branchesWithinDoubleRadius, optimizeOptions]
  );

  const activePlan = useMemo<BasketPlan | null>(() => {
    const map: Partial<Record<1 | 2 | 3 | 4 | 5, BasketPlan | null | undefined>> = {
      1: optimization.bestOneStore,
      2: optimization.bestTwoStores,
      3: optimization.bestThreeStores,
      4: optimization.bestFourStores,
      5: optimization.bestFiveStores,
    };
    return map[maxStores] ?? optimization.recommendedPlan;
  }, [optimization, maxStores]);

  const prefetchTerms = useCallback(
    async (terms: string[]) => {
      const cityKey = normalizeColombiaCityName(chosenCity) || "all";
      const pending = terms
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 2 && !prefetchedRef.current.has(`${cityKey}:${t}`))
        .slice(0, 20);
      if (!pending.length) return;
      const cityQuery = chosenCity ? `&city=${encodeURIComponent(chosenCity)}` : "";
      await Promise.all(
        pending.map(async (term) => {
          prefetchedRef.current.add(`${cityKey}:${term}`);
          try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(term)}${cityQuery}`);
            if (!res.ok) return;
            const json = (await res.json()) as DashboardPayload;
            const collected = collectOffersFromPayload(json);
            if (!collected.length) return;
            setKnownOffers((prev) => {
              const merged = new Map(prev);
              for (const o of collected) merged.set(o.storeSkuId, o);
              return merged;
            });
          } catch {
            // Silent
          }
        })
      );
    },
    [chosenCity]
  );

  const prefetchStarterCatalog = useCallback(() => {
    const terms = GUIDED_SECTIONS.flatMap((s) =>
      s.subsections.flatMap((sub) =>
        sub.foods.filter((f) => f.isDefaultGeneric).flatMap((f) => f.searchTerms)
      )
    );
    void prefetchTerms(terms);
  }, [prefetchTerms]);

  useEffect(() => {
    if (!branchesLoaded || !chosenCity) return;
    prefetchStarterCatalog();
  }, [branchesLoaded, chosenCity, prefetchStarterCatalog]);

  const searchRemote = useCallback(
    async (q: string) => {
      const clean = q.trim().slice(0, 80);
      if (clean.length < 2) return;
      try {
        const cityQuery = chosenCity ? `&city=${encodeURIComponent(chosenCity)}` : "";
        const res = await fetch(`/api/search?q=${encodeURIComponent(clean)}${cityQuery}`);
        if (!res.ok) return;
        const json = (await res.json()) as DashboardPayload;
        const collected = collectOffersFromPayload(json);
        if (!collected.length) return;
        setKnownOffers((prev) => {
          const merged = new Map(prev);
          for (const o of collected) merged.set(o.storeSkuId, o);
          return merged;
        });
      } catch {
        // Keep local offers
      }
    },
    [chosenCity]
  );

  // Fixes P0 locLoading deadlock when rounded coordinates match current location
  const handleRequestGeolocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocError("Tu navegador no soporta geolocalización; selecciona un barrio manual.");
      return;
    }
    setLocLoading(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextLat = Number(pos.coords.latitude.toFixed(3));
        const nextLng = Number(pos.coords.longitude.toFixed(3));
        if (nextLat === userLocation.lat && nextLng === userLocation.lng) {
          setLocLoading(false);
        }
        setUserLocation({ lat: nextLat, lng: nextLng, label: "Tu zona GPS" });
      },
      () => {
        setLocLoading(false);
        setLocError("No obtuvimos permiso GPS; usando ubicación seleccionada.");
      },
      { enableHighAccuracy: false, timeout: 7000 }
    );
  }, [userLocation.lat, userLocation.lng]);

  const handleSelectTab = useCallback(
    (tab: ParallelTab) => {
      setActiveTab(tab);
      if (tab === "canasta") {
        prefetchStarterCatalog();
        if (basketItems.length === 0 && experienceMode === "generic_guided") {
          // Safeguard: never strand cold-start user on an empty screen when jumping straight to Canasta
          setBasketItems(buildDefaultGenericBasketItems());
        }
      }
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", tab);
        window.history.replaceState({}, "", url.toString());
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [basketItems.length, experienceMode, prefetchStarterCatalog]
  );

  function addOfferToBasket(
    offer: StoreOffer,
    origin: "habitual_guided" | "free_shop",
    forcedSub?: GuidedSubsection
  ) {
    const sig = extractProductSignature(offer);
    const inferred = inferHabitualItemProfile(offer);
    const itemKey = `${origin}:${offer.storeSkuId}`;
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
        return origin === "free_shop" ? prev.filter((i) => i.itemKey !== itemKey) : prev;
      }
      const next: BasketItemInput = {
        itemKey,
        label: cleanProductTitle(offer.rawName),
        masterProductId: offer.masterProductId ?? null,
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
        habitualReferencePriceCop: offer.calibratedPrice,
        habitualProductTitle: cleanProductTitle(offer.rawName),
        excludedBrands: [],
        sectionId: subLoc.sectionId,
        subsectionId: subLoc.subsectionId,
        originMode: origin,
      };
      return [...prev, next];
    });
    setToast(`Actualizamos "${cleanProductTitle(offer.rawName)}" en tu canasta.`);
  }

  function addGenericFood(food: GenericFoodOption, sub: GuidedSubsection) {
    const def = food.variants[0];
    const baseKey = `generic-${food.id}`;
    const exists = basketItems.some((i) => i.itemKey === baseKey);
    const itemKey = exists ? `${baseKey}-${Date.now()}` : baseKey;
    setBasketItems((prev) => [
      ...prev,
      {
        itemKey,
        label: food.name,
        masterProductId: null,
        canonicalSlug: null,
        matchMode: "pum",
        quantity: 1,
        allowSubstitutes: true,
        subtypeFamily: def?.subtypeFamily ?? food.defaultSubtype,
        broadFamily: food.broadFamily,
        familyLabel: food.name,
        targetNetContent: food.defaultTargetContent,
        targetUnitMeasure: food.defaultUnitMeasure,
        allowedQualityTiers: food.defaultQualityTiers ?? ["economico", "estandar"],
        pricePriority: food.defaultPriority ?? "lowest_pum",
        requiredCriticalAttribute: def?.criticalAttribute ?? null,
        sizePreference: food.defaultSize ?? "medium",
        excludedBrands: [],
        sectionId: food.sectionId,
        subsectionId: sub.id,
        originMode: "generic_guided",
      },
    ]);
    void prefetchTerms(food.searchTerms);
    setToast(`Agregamos ${food.name} a tu canasta.`);
  }

  function handleChangeTransportMode(mode: TransportMode) {
    setTransportMode(mode);
    const prof = getTransportProfile(mode);
    setRadiusMeters(prof.defaultRadiusM);
    setMaxStores(prof.maxStoresDefault);
  }

  // Habitual picker memoized lists
  const habitualBaseOffers = useMemo(() => {
    if (!habitualSub) return [];
    const q = habitualQuery.trim().toLowerCase();
    return visibleOffers.filter((offer) => {
      if (!offer.inStock) return false;
      if (q) {
        return `${offer.rawName} ${offer.brand} ${offer.storeName}`.toLowerCase().includes(q);
      }
      return offerMatchesSubsection(offer, habitualSub);
    });
  }, [habitualSub, habitualQuery, visibleOffers]);

  const habitualFoodChips = useMemo(() => {
    if (!habitualSub) return [];
    return habitualSub.foods.map((food) => ({
      food,
      count: habitualBaseOffers.filter((o) => {
        const sig = extractProductSignature(o);
        return (
          sig.broadFamily === food.broadFamily ||
          food.variants.some((v) => v.subtypeFamily === sig.subtypeFamily)
        );
      }).length,
    }));
  }, [habitualSub, habitualBaseOffers]);

  const habitualOffers = useMemo(() => {
    if (!habitualSub) return [];
    const activeFood =
      habitualFoodId !== "all"
        ? habitualSub.foods.find((f) => f.id === habitualFoodId) ?? null
        : null;
    const filtered = activeFood
      ? habitualBaseOffers.filter((o) => {
          const sig = extractProductSignature(o);
          return (
            sig.broadFamily === activeFood.broadFamily ||
            activeFood.variants.some((v) => v.subtypeFamily === sig.subtypeFamily)
          );
        })
      : habitualBaseOffers;
    return [...filtered].sort((a, b) => a.pumPrice - b.pumPrice).slice(0, 30);
  }, [habitualSub, habitualFoodId, habitualBaseOffers]);

  const inspectPackTrap = useMemo(() => {
    if (!inspectState?.offer || !inspectState.itemKey) return null;
    const item = basketItems.find((i) => i.itemKey === inspectState.itemKey);
    if (!item) return null;
    return detectPackTrap(
      item,
      inspectState.offer,
      visibleOffers.filter(
        (o) =>
          o.storeId === inspectState.offer.storeId &&
          o.canonicalSlug &&
          o.canonicalSlug === inspectState.offer.canonicalSlug
      )
    );
  }, [inspectState, basketItems, visibleOffers]);

  const inspectNearbyOffers = useMemo(() => {
    if (!inspectState?.offer) return [];
    const sig = extractProductSignature(inspectState.offer);
    return visibleOffers
      .filter((o) => {
        if (!o.inStock) return false;
        if (inspectState.offer.canonicalSlug && o.canonicalSlug === inspectState.offer.canonicalSlug) {
          return true;
        }
        return extractProductSignature(o).subtypeFamily === sig.subtypeFamily;
      })
      .sort((a, b) => a.pumPrice - b.pumPrice)
      .slice(0, 8);
  }, [inspectState, visibleOffers]);

  return (
    <div className="ms2-root">
      <ParallelHeader
        activeTab={activeTab}
        basketCount={basketItems.length}
        zoneLabel={userLocation.label}
        transportMode={transportMode}
        radiusMeters={radiusMeters}
        onSelectTab={handleSelectTab}
        onOpenZone={() => setZoneModalOpen(true)}
        onOpenHousehold={() => setHouseholdModalOpen(true)}
        onOpenMisMercados={() => setMisMercadosModalOpen(true)}
        onOpenFavorites={() => setFavoritesModalOpen(true)}
        onOpenDevices={() => setDevicesModalOpen(true)}
        onOpenAlerts={() => {
          setActiveTab("ahorro");
          setAhorroSubTab("recompras");
        }}
      />

      {toast && (
        <div className="ms2-toast" role="status">
          <span>{toast}</span>
          <button
            type="button"
            className="ms2-btn ms2-btn-ghost ms2-btn-sm"
            onClick={() => setToast(null)}
          >
            Cerrar
          </button>
        </div>
      )}

      <main className="ms2-main">
        {activeTab === "inicio" && (
          <ParallelInicioView
            experienceMode={experienceMode}
            onSelectMode={setExperienceMode}
            onLaunchMode={(mode) => {
              setExperienceMode(mode);
              if (mode === "generic_guided") {
                prefetchStarterCatalog();
                if (basketItems.length === 0) {
                  setBasketItems(buildDefaultGenericBasketItems());
                }
              }
              setCanastaSubView(
                mode === "free_shop"
                  ? "catalog"
                  : mode === "habitual_guided"
                    ? "sections"
                    : "basket"
              );
              setActiveTab("canasta");
            }}
            onLoadStarterBasket={() => {
              setBasketItems(buildDefaultGenericBasketItems());
              prefetchStarterCatalog();
              setCanastaSubView("basket");
              setActiveTab("canasta");
              setToast("Cargamos el mercado base colombiano de 15 productos.");
            }}
            basketItems={basketItems}
            activePlan={activePlan}
            knownOffers={visibleOffers}
            userProfile={userProfile}
            userLocationLabel={userLocation.label}
            activeDietFilters={activeDietFilters}
            storePromoDays={initialData.storePromoDays ?? []}
            onSearchRemote={searchRemote}
            onAddQuickOffer={(offer) => addOfferToBasket(offer, "free_shop")}
            onInspectOffer={(offer) => setInspectState({ offer })}
            onOpenCanasta={() => handleSelectTab("canasta")}
            onOpenAhorro={() => {
              setAhorroSubTab("optimizada");
              setActiveTab("ahorro");
            }}
            onOpenBudget={() => setBudgetModalOpen(true)}
            onOpenHousehold={() => setHouseholdModalOpen(true)}
            onOpenZone={() => setZoneModalOpen(true)}
            onOpenFavorites={() => setFavoritesModalOpen(true)}
            favoritesCount={favorites.length}
            favoriteLimit={favoriteLimit}
          />
        )}

        {activeTab === "canasta" && (
          <ParallelCanastaView
            experienceMode={experienceMode}
            subView={canastaSubView}
            onChangeSubView={setCanastaSubView}
            basketItems={basketItems}
            knownOffers={visibleOffers}
            activePlan={activePlan}
            activeDietFilters={activeDietFilters}
            onToggleDietFilter={(f) => setActiveDietFilters((p) => toggleBasketDietFilter(p, f))}
            onLoadStarterBasket={() => {
              setBasketItems(buildDefaultGenericBasketItems());
              prefetchStarterCatalog();
              setToast("Canasta base de 15 productos cargada.");
            }}
            onClearBasket={() => {
              setBasketItems([]);
              setToast("Vaciaste tu canasta.");
            }}
            onAddGenericFood={addGenericFood}
            onAddOffer={addOfferToBasket}
            onUpdateQuantity={(itemKey, delta) =>
              setBasketItems((prev) =>
                prev.map((it) =>
                  it.itemKey === itemKey
                    ? { ...it, quantity: Math.min(20, Math.max(1, (it.quantity ?? 1) + delta)) }
                    : it
                )
              )
            }
            onRemoveItem={(itemKey) =>
              setBasketItems((prev) => prev.filter((it) => it.itemKey !== itemKey))
            }
            onToggleLockItem={(itemKey) =>
              setBasketItems((prev) =>
                prev.map((it) => (it.itemKey === itemKey ? { ...it, locked: !it.locked } : it))
              )
            }
            onAddExcludedBrand={(itemKey, brand) =>
              setBasketItems((prev) =>
                prev.map((it) => {
                  if (it.itemKey !== itemKey) return it;
                  const list = it.excludedBrands ?? [];
                  if (list.includes(brand)) return it;
                  return { ...it, excludedBrands: [...list, brand] };
                })
              )
            }
            onRemoveExcludedBrand={(itemKey, brand) =>
              setBasketItems((prev) =>
                prev.map((it) =>
                  it.itemKey === itemKey
                    ? {
                        ...it,
                        excludedBrands: (it.excludedBrands ?? []).filter((b) => b !== brand),
                      }
                    : it
                )
              )
            }
            onInspectOffer={(offer, baselineOffer, itemKey) =>
              setInspectState({ offer, baselineOffer, itemKey })
            }
            onEditItemRule={(item) => setHybridEditingItem(item)}
            onOpenHabitualModal={(sub) => {
              setHabitualSub(sub);
              setHabitualQuery("");
              setHabitualFoodId("all");
              setHabitualSelectedSku(null);
              void prefetchTerms(sub.foods.flatMap((f) => f.searchTerms));
            }}
            onOpenPreferences={() => setPrefsModalOpen(true)}
            onOpenBudget={() => setBudgetModalOpen(true)}
            onOpenFavorites={() => setFavoritesModalOpen(true)}
            onSearchCatalog={searchRemote}
            onGoOptimize={() => {
              setAhorroSubTab("optimizada");
              setActiveTab("ahorro");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}

        {activeTab === "ahorro" && (
          <ParallelAhorroView
            subTab={ahorroSubTab}
            onChangeSubTab={setAhorroSubTab}
            activePlan={activePlan}
            optimization={optimization}
            basketItems={basketItems}
            knownOffers={visibleOffers}
            nearbyBranches={nearbyBranches}
            activeDietFilters={activeDietFilters}
            zoneLabel={userLocation.label}
            transportMode={transportMode}
            maxStores={maxStores}
            onChangeMaxStores={setMaxStores}
            onChangeTransportMode={handleChangeTransportMode}
            paymentPromotions={initialData.paymentPromotions ?? []}
            storePromoDays={initialData.storePromoDays ?? []}
            samePlantPairs={initialData.samePlantPairs ?? []}
            rappiDiscounts={initialData.rappiDiscounts ?? []}
            onInspectOffer={(offer, baselineOffer, itemKey) =>
              setInspectState({ offer, baselineOffer, itemKey })
            }
            onToggleLockItem={(itemKey) =>
              setBasketItems((prev) =>
                prev.map((it) => (it.itemKey === itemKey ? { ...it, locked: !it.locked } : it))
              )
            }
            onSelectSwapOffer={(itemKey, offer) =>
              setBasketItems((prev) =>
                prev.map((it) =>
                  it.itemKey === itemKey
                    ? {
                        ...it,
                        preferredSkuByStore: {
                          ...(it.preferredSkuByStore ?? {}),
                          [offer.storeId]: offer.storeSkuId,
                        },
                      }
                    : it
                )
              )
            }
            onOpenBudget={() => setBudgetModalOpen(true)}
            onOpenHousehold={() => setHouseholdModalOpen(true)}
            onOpenFavorites={() => setFavoritesModalOpen(true)}
            onOpenPreferences={() => setPrefsModalOpen(true)}
            onGoCanasta={() => handleSelectTab("canasta")}
            onGoRuta={() => handleSelectTab("ruta")}
            onLoadFavoriteQuick={(fav) => {
              setBasketItems(hydrateBasketItemsFromSnapshot(fav.items));
              if (fav.activeDietFilters?.length) setActiveDietFilters(fav.activeDietFilters);
              setAhorroSubTab("optimizada");
              setToast(`Cargamos "${fav.title}" al instante.`);
            }}
            onCopyCommunityBasket={(items, diet, mode, title) => {
              setBasketItems(items);
              if (diet.length) setActiveDietFilters(diet);
              if (mode === "copy_use") {
                setAhorroSubTab("optimizada");
                setToast(`Cargamos "${title}" optimizado para tu zona.`);
              } else {
                setCanastaSubView("basket");
                setActiveTab("canasta");
                setToast(`Copiamos "${title}" a tu canasta para editarlo.`);
              }
            }}
            onApplyContainmentSwaps={(swaps) => {
              const byKey = new Map(swaps.map((s) => [s.itemKey, s]));
              setBasketItems((prev) =>
                prev.map((it) => {
                  const sw = byKey.get(it.itemKey);
                  if (!sw) return it;
                  return {
                    ...it,
                    preferredSkuByStore: {
                      ...(it.preferredSkuByStore ?? {}),
                      [sw.recommended.storeId]: sw.recommended.storeSkuId,
                    },
                  };
                })
              );
              setAhorroSubTab("optimizada");
              setToast(`Aplicamos ${swaps.length} cambios de ahorro a tu canasta.`);
            }}
            onAdoptHouseholdFormats={(items) => {
              const keys = new Set(
                items
                  .filter((f) => !f.perishableSkipped && f.monthlySavingsCop > 0)
                  .map((f) => f.itemKey)
              );
              setBasketItems((prev) =>
                prev.map((it) =>
                  keys.has(it.itemKey) ? { ...it, sizePreference: "large", locked: false } : it
                )
              );
              setAhorroSubTab("optimizada");
              setToast(`Adoptamos formatos familiares en ${keys.size} producto(s).`);
            }}
            onAddReplenishAlert={(rep) => {
              const itemKey = rep.suggestedOffer
                ? `replenish:${rep.suggestedOffer.storeSkuId}`
                : `replenish:${rep.familyKey}`;
              setBasketItems((prev) => {
                if (prev.some((i) => i.itemKey === itemKey)) return prev;
                return [
                  ...prev,
                  {
                    itemKey,
                    label: rep.label,
                    masterProductId: rep.suggestedOffer?.masterProductId ?? null,
                    canonicalSlug: rep.suggestedOffer?.canonicalSlug ?? null,
                    matchMode: "pum",
                    quantity: 1,
                    allowSubstitutes: true,
                    subtypeFamily: rep.familyKey,
                    targetNetContent: rep.suggestedOffer?.netContent,
                    targetUnitMeasure: rep.suggestedOffer?.unitMeasure,
                    anchorStoreSkuId: rep.suggestedOffer?.storeSkuId ?? null,
                    habitualReferencePriceCop: rep.suggestedOffer?.calibratedPrice,
                  },
                ];
              });
              setToast(`Agregamos "${rep.label}" a tu canasta.`);
            }}
          />
        )}

        {activeTab === "ruta" && (
          <ParallelRutaView
            activePlan={activePlan}
            userLocation={userLocation}
            transportMode={transportMode}
            radiusMeters={radiusMeters}
            onChangeTransportMode={handleChangeTransportMode}
            onOpenZoneModal={() => setZoneModalOpen(true)}
            userProfile={userProfile}
            checkedItems={checkedItems}
            onToggleCheckedItem={(k) => setCheckedItems((p) => ({ ...p, [k]: !p[k] }))}
            onCopyPlainText={async () => {
              if (!activePlan) return;
              const text = formatBasketAsPlainText({
                mode: experienceMode,
                locationLabel: userLocation.label,
                maxDistanceMeters: radiusMeters,
                maxStores,
                plan: activePlan,
                habitualBaselineCost: optimization.habitualBaselineCost,
                savingsVsHabitualCop: optimization.savingsVsHabitualCop,
                savingsVsHabitualPct: optimization.savingsVsHabitualPct,
                uncoveredItems: optimization.uncoveredItems,
              });
              try {
                await navigator.clipboard.writeText(text);
                setCopyFeedback("¡Lista copiada al portapapeles!");
              } catch {
                setCopyFeedback(
                  "No pudimos acceder al portapapeles automático; usa el botón .txt para descargarla."
                );
              }
              window.setTimeout(() => setCopyFeedback(null), 3200);
            }}
            onDownloadPlainText={() => {
              if (!activePlan) return;
              const text = formatBasketAsPlainText({
                mode: experienceMode,
                locationLabel: userLocation.label,
                maxDistanceMeters: radiusMeters,
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
            }}
            copyFeedback={copyFeedback}
            onOpenReportModal={() => {
              setReportAllocKey(activePlan?.storeStops[0]?.allocations[0]?.itemKey ?? "");
              setReportFeedback(null);
              setReportModalOpen(true);
            }}
            onCompleteShoppingTrip={async (plan, checkedKeys) => {
              const allocs = plan.storeStops.flatMap((s) => s.allocations);
              const selected = allocs.filter((a) => checkedKeys[a.itemKey]);
              const targets = selected.length > 0 ? selected : allocs;
              const nowIso = new Date().toISOString();
              await recordPurchaseEvents(
                targets.map((a) => ({
                  masterProductId: a.offer.masterProductId ?? null,
                  familyKey: extractProductSignature(a.offer).subtypeFamily,
                  productTitle: a.offer.rawName,
                  quantity: a.quantity,
                  netContent: a.offer.netContent,
                  purchasedAt: nowIso,
                }))
              );
            }}
            onGoCanasta={() => handleSelectTab("canasta")}
            onGoInicio={() => handleSelectTab("inicio")}
          />
        )}
      </main>

      <ParallelMobileBottomNav
        activeTab={activeTab}
        basketCount={basketItems.length}
        onSelectTab={handleSelectTab}
      />

      {/* Modales encapsulados dentro de .ms2-root */}
      <ParallelProductSheet
        offer={inspectState?.offer ?? null}
        baselineOffer={inspectState?.baselineOffer ?? null}
        itemKey={inspectState?.itemKey ?? null}
        locked={
          inspectState?.itemKey
            ? Boolean(basketItems.find((i) => i.itemKey === inspectState.itemKey)?.locked)
            : false
        }
        packTrapWarning={inspectPackTrap}
        nearbyOffers={inspectNearbyOffers}
        samePlantIndex={samePlantIndex}
        onClose={() => setInspectState(null)}
        onUseRecommended={(offer) => {
          if (inspectState?.itemKey) {
            setBasketItems((prev) =>
              prev.map((it) =>
                it.itemKey === inspectState.itemKey
                  ? {
                      ...it,
                      preferredSkuByStore: {
                        ...(it.preferredSkuByStore ?? {}),
                        [offer.storeId]: offer.storeSkuId,
                      },
                    }
                  : it
              )
            );
          } else {
            addOfferToBasket(offer, "free_shop");
          }
        }}
        onKeepMine={(itemKey) =>
          setBasketItems((prev) =>
            prev.map((it) => (it.itemKey === itemKey ? { ...it, locked: true } : it))
          )
        }
        onToggleLock={(itemKey) =>
          setBasketItems((prev) =>
            prev.map((it) => (it.itemKey === itemKey ? { ...it, locked: !it.locked } : it))
          )
        }
        onRateProduct={(offer) => {
          setInspectState(null);
          // Defer opening second top-layer <dialog> to next animation frame to avoid focus/backdrop race
          window.requestAnimationFrame(() => {
            setVotingOffer(offer);
          });
        }}
      />

      <ParallelBudgetModal
        open={budgetModalOpen}
        items={basketItems}
        offers={visibleOffers}
        nearbyBranches={branchScope.branchesWithinDoubleRadius}
        dietFilters={activeDietFilters}
        minSabioIndex={minSabioIndex}
        optimizeOptions={optimizeOptions}
        defaultBudgetCop={
          userProfile?.monthlyBudgetCop ??
          Math.max(80000, activePlan?.totalNominalCost ?? 140000)
        }
        onToggleLock={(itemKey) =>
          setBasketItems((prev) =>
            prev.map((it) => (it.itemKey === itemKey ? { ...it, locked: !it.locked } : it))
          )
        }
        onApplyBudgetResult={(selectedByItem) => {
          setBasketItems((prev) =>
            prev.map((it) => {
              const picked = selectedByItem[it.itemKey];
              if (!picked) return it;
              return {
                ...it,
                preferredSkuByStore: {
                  ...(it.preferredSkuByStore ?? {}),
                  [picked.storeId]: picked.storeSkuId,
                },
              };
            })
          );
          setActiveTab("ahorro");
          setAhorroSubTab("optimizada");
          setToast("Canasta ajustada exactamente a tu presupuesto.");
        }}
        onClose={() => setBudgetModalOpen(false)}
      />

      <ParallelZoneModal
        open={zoneModalOpen}
        onClose={() => setZoneModalOpen(false)}
        userLocation={userLocation}
        onSelectBarrio={(lat, lng, label) => setUserLocation({ lat, lng, label })}
        onRequestGeolocation={handleRequestGeolocation}
        locLoading={locLoading}
        locError={locError}
        transportMode={transportMode}
        onChangeTransportMode={handleChangeTransportMode}
        maxDistanceMeters={radiusMeters}
        onChangeMaxDistanceMeters={setRadiusMeters}
        maxStores={maxStores}
        onChangeMaxStores={setMaxStores}
        nearbyBranches={nearbyBranches}
        allNearbyWithinMax={branchScope.branchesWithinDoubleRadius}
      />

      <SabiometroVoteSheet offer={votingOffer} onClose={() => setVotingOffer(null)} />

      <HybridItemEditorModal
        item={hybridEditingItem}
        onClose={() => setHybridEditingItem(null)}
        onSave={(itemKey, nextItem) => {
          setBasketItems((prev) => prev.map((it) => (it.itemKey === itemKey ? nextItem : it)));
          setToast(`Regla actualizada para "${nextItem.label}".`);
        }}
      />

      <BasketPreferencesModal
        open={prefsModalOpen}
        onClose={() => setPrefsModalOpen(false)}
        basketItems={basketItems}
        activeDietFilters={activeDietFilters}
        onToggleDietFilter={(f) => setActiveDietFilters((p) => toggleBasketDietFilter(p, f))}
        onSaveAsDefaultDietFilters={() => {
          void saveProfileAndPayments({
            profile: { dietaryRestrictions: activeDietFilters, transportMode },
            paymentMethods,
          });
          setDietSavedNotice(true);
          window.setTimeout(() => setDietSavedNotice(false), 2200);
        }}
        dietSavedNotice={dietSavedNotice}
        onToggleLockItem={(itemKey) =>
          setBasketItems((prev) =>
            prev.map((it) => (it.itemKey === itemKey ? { ...it, locked: !it.locked } : it))
          )
        }
        minSabioIndex={minSabioIndex}
        onChangeMinSabioIndex={setMinSabioIndex}
        onOpenBudgetOptimizer={() => setBudgetModalOpen(true)}
      />

      <AutoSyncDevicesModal open={devicesModalOpen} onClose={() => setDevicesModalOpen(false)} />

      <HouseholdProfileModal
        open={householdModalOpen}
        paymentPartners={initialData.paymentPartners ?? []}
        onTransportModeSaved={(mode) => {
          handleChangeTransportMode(mode);
          setHouseholdModalOpen(false);
        }}
        onClose={() => setHouseholdModalOpen(false)}
      />

      <FavoriteBasketsModal
        open={favoritesModalOpen}
        currentItems={basketItems}
        currentMode={experienceMode === "habitual_guided" ? "my_brands" : "generic"}
        currentDietFilters={activeDietFilters}
        estimatedTotalCop={activePlan?.totalNominalCost ?? 0}
        estimatedSavingsCop={activePlan?.savingsVsBaselineCop ?? 0}
        storeSummary={
          activePlan?.storeStops.map((s) => `${s.storeName} (${s.allocations.length})`).join(" + ") ??
          "Optimizado"
        }
        zoneLabel={userLocation.label}
        onClose={() => setFavoritesModalOpen(false)}
        onLoadFavorite={(items, diet) => {
          setBasketItems(items);
          if (diet.length) setActiveDietFilters(diet);
          setActiveTab("ahorro");
          setAhorroSubTab("optimizada");
          setToast(`Mercado favorito cargado (${items.length} productos).`);
        }}
      />

      <MisMercadosModal
        open={misMercadosModalOpen}
        onClose={() => setMisMercadosModalOpen(false)}
        basketItems={basketItems}
        activePlan={activePlan}
        onContinueShopping={() => {
          setCanastaSubView("basket");
          setActiveTab("canasta");
        }}
        onGoToRoute={() => setActiveTab("ruta")}
        onOptimizeActive={() => {
          setAhorroSubTab("optimizada");
          setActiveTab("ahorro");
        }}
        onLaunchMode={(mode) => {
          setExperienceMode(mode);
          if (mode === "generic_guided" && basketItems.length === 0) {
            setBasketItems(buildDefaultGenericBasketItems());
          }
          setCanastaSubView(mode === "free_shop" ? "catalog" : "sections");
          setActiveTab("canasta");
        }}
        onOpenFavoritesModal={() => setFavoritesModalOpen(true)}
        onOpenDevicesModal={() => setDevicesModalOpen(true)}
        onLoadFavoriteQuick={(fav) => {
          setBasketItems(hydrateBasketItemsFromSnapshot(fav.items));
          if (fav.activeDietFilters?.length) setActiveDietFilters(fav.activeDietFilters);
          setAhorroSubTab("optimizada");
          setActiveTab("ahorro");
          setToast(`Favorito "${fav.title}" cargado.`);
        }}
      />

      <HabitualPickerModal
        sub={habitualSub}
        query={habitualQuery}
        onChangeQuery={setHabitualQuery}
        foodId={habitualFoodId}
        onChangeFoodId={setHabitualFoodId}
        baseOffersCount={habitualBaseOffers.length}
        foodChips={habitualFoodChips}
        offers={habitualOffers}
        selectedSku={habitualSelectedSku}
        onSelectSku={setHabitualSelectedSku}
        onConfirmAdd={(offer, sub) => {
          addOfferToBasket(offer, "habitual_guided", sub);
          setHabitualSub(null);
        }}
        onClose={() => setHabitualSub(null)}
      />

      <ParallelReportPriceModal
        open={reportModalOpen}
        activePlan={activePlan}
        reportAllocKey={reportAllocKey}
        onChangeReportAllocKey={setReportAllocKey}
        reportReason={reportReason}
        onChangeReportReason={setReportReason}
        reportComment={reportComment}
        onChangeReportComment={setReportComment}
        reportSubmitting={reportSubmitting}
        reportFeedback={reportFeedback}
        onSubmit={async () => {
          setReportSubmitting(true);
          setReportFeedback(null);
          try {
            const alloc = activePlan?.storeStops
              .flatMap((s) => s.allocations)
              .find((a) => a.itemKey === reportAllocKey);
            const candidate = alloc?.runnerUpOffer?.storeSkuId ?? alloc?.alternativesInStore[0]?.storeSkuId;
            const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (alloc && candidate && uuidRe.test(alloc.offer.storeSkuId) && uuidRe.test(candidate)) {
              const res = await fetch("/api/curation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "report_unfair",
                  anchorSkuId: alloc.offer.storeSkuId,
                  comparedSkuId: candidate,
                  reason: reportReason,
                  matchTier: "direct",
                  comment: reportComment || "Reportado en ruta",
                }),
              });
              if (res.ok) {
                setReportFeedback("¡Gracias! Reporte enviado al panel de curación.");
                setReportComment("");
                setReportSubmitting(false);
                return;
              }
            }
          } catch {
            // Fallback local confirmation
          }
          setReportFeedback("¡Reporte registrado! Lo revisaremos en nuestro monitoreo.");
          setReportComment("");
          setReportSubmitting(false);
        }}
        onClose={() => setReportModalOpen(false)}
      />
    </div>
  );
}

export default function ParallelComparator({
  initialData,
  initialTab = "inicio",
}: {
  initialData: DashboardPayload;
  initialTab?: ParallelTab;
}) {
  return (
    <WorkspaceProvider>
      <ParallelComparatorInner initialData={initialData} initialTab={initialTab} />
    </WorkspaceProvider>
  );
}
