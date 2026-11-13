"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import GuidedMarketWizard, { type WizardStep } from "@/components/GuidedMarketWizard";
import { optimizeBasket, type BasketItemInput } from "@/lib/basketOptimizer";
import { type ShoppingExperienceMode } from "@/lib/guidedCatalog";
import type { DashboardPayload, NearbyStoreBranch, StoreOffer } from "@/lib/types";

const BASKET_STORAGE_KEY = "mercasabio_basket_v1";
const LOCATION_STORAGE_KEY = "mercasabio_loc_v1";

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
  const [knownOffers, setKnownOffers] = useState<Map<string, StoreOffer>>(() => {
    const map = new Map<string, StoreOffer>();
    for (const offer of collectOffersFromPayload(initialData)) {
      map.set(offer.storeSkuId, offer);
    }
    return map;
  });

  const [basketItems, setBasketItems] = useState<BasketItemInput[]>([]);
  const [basketHydrated, setBasketHydrated] = useState(false);

  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
    label: string;
  }>({
    lat: 4.646,
    lng: -74.063,
    label: "Bogotá · Chapinero",
  });
  const [locationHydrated, setLocationHydrated] = useState(false);
  const [radiusMeters, setRadiusMeters] = useState<number>(3000);
  const [allNearbyBranches, setAllNearbyBranches] = useState<NearbyStoreBranch[]>([]);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const [experienceMode, setExperienceMode] =
    useState<ShoppingExperienceMode>("generic_guided");
  const [wizardStep, setWizardStep] = useState<WizardStep>("mode");
  const [maxStores, setMaxStores] = useState<1 | 2 | 3 | 4 | 5>(2);
  const prefetchedTermsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
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
      .slice(0, 5);
    if (pending.length === 0) return;

    await Promise.allSettled(
      pending.map(async (term) => {
        prefetchedTermsRef.current.add(term);
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
          if (!res.ok) return;
          const nextPayload = (await res.json()) as DashboardPayload;
          const collected = collectOffersFromPayload(nextPayload);
          if (collected.length === 0) return;
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
      })
    );
  }, []);

  const handleSearchFreeShop = useCallback(async (nextQuery: string) => {
    const cleanQuery = nextQuery.trim().slice(0, 80);
    if (!cleanQuery) return;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(cleanQuery)}`);
      if (!res.ok) return;
      const nextPayload = (await res.json()) as DashboardPayload;
      const collected = collectOffersFromPayload(nextPayload);
      if (collected.length === 0) return;
      setKnownOffers((prev) => {
        const merged = new Map(prev);
        for (const offer of collected) {
          merged.set(offer.storeSkuId, offer);
        }
        return merged;
      });
    } catch {
      // Mantiene resultados locales ya cargados
    }
  }, []);

  const handleRequestGeolocation = useCallback(() => {
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
  }, []);

  const knownOffersList = useMemo(() => [...knownOffers.values()], [knownOffers]);

  const basketOptimization = useMemo(() => {
    return optimizeBasket({
      items: basketItems,
      offers: knownOffersList,
      nearbyBranches: allNearbyBranches,
      options: {
        objective: "nominal",
        minExtraSavingsCop: 1500,
        minExtraSavingsPct: 2,
        maxStores,
        maxDistanceMeters: radiusMeters,
      },
    });
  }, [basketItems, knownOffersList, allNearbyBranches, maxStores, radiusMeters]);

  return (
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
      onSearchFreeShop={handleSearchFreeShop}
      isDemoData={initialData.isDemoData}
    />
  );
}
