"use client";

import { createElement } from "react";
import HearthIcon, { type HearthIconName } from "@/components/HearthIcon";
import type {
  BasketItemInput,
  BasketOptimizationResult,
  BasketPlan,
} from "@/lib/basketOptimizer";
import { formatCop } from "@/lib/formatters";
import type { ShoppingExperienceMode, SizePreference } from "@/lib/guidedCatalog";
import type { SamePlantPairRecord } from "@/lib/samePlant";
import type {
  DietFilter,
  NearbyStoreBranch,
  QualityTier,
  StoreOffer,
  StorePromoDay,
  TransportMode,
  UserProfile,
} from "@/lib/types";

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

export type StoreCountLimit = 1 | 2 | 3 | 4 | 5;

export interface GuidedMarketWizardProps {
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
  // Extensiones v3 (opcionales para compatibilidad con callers existentes)
  embeddedInShell?: boolean;
  transportMode?: TransportMode;
  onChangeTransportMode?: (mode: TransportMode) => void;
  activeDietFilters?: DietFilter[];
  onToggleDietFilter?: (filter: DietFilter) => void;
  onSaveDefaultDietFilters?: () => void;
  userProfile?: UserProfile | null;
  samePlantPairs?: SamePlantPairRecord[];
  onInspectOffer?: (offer: StoreOffer, baselineOffer?: StoreOffer | null, itemKey?: string) => void;
  onOpenVoteOffer?: (offer: StoreOffer) => void;
  onOpenBudgetOptimizer?: () => void;
  onOpenHouseholdModal?: () => void;
  onOpenFavorites?: () => void;
  favoritesCount?: number;
  favoriteLimit?: number;
  onOpenCommunity?: () => void;
  onOpenHybridEditor?: (item: BasketItemInput) => void;
  onOpenBasketPreferences?: () => void;
  onOpenMisMercados?: () => void;
  onOpenZoneModal?: () => void;
  householdCode?: string;
  syncLabel?: string;
  storePromoDays?: StorePromoDay[];
  onCompleteShoppingTrip?: (plan: BasketPlan, checkedKeys: Record<string, boolean>) => void;
  minSabioIndex?: number;
  onChangeMinSabioIndex?: (minIndex: number) => void;
}

export const copFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export const pumFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

export const QUALITY_TIERS: Array<{ id: QualityTier; label: string }> = [
  { id: "economico", label: "Económica" },
  { id: "estandar", label: "Estándar" },
  { id: "premium", label: "Premium" },
  { id: "especial", label: "Especial" },
];

export const SIZE_OPTIONS: Array<{ id: SizePreference; label: string }> = [
  { id: "any", label: "Cualquiera" },
  { id: "small", label: "Pequeña" },
  { id: "medium", label: "Mediana" },
  { id: "large", label: "Grande" },
];

export function getStepMeta(
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

export function formatPresentationTag(item: BasketItemInput): string | null {
  if (!item.targetNetContent || !item.targetUnitMeasure) return null;
  const val = Math.round(item.targetNetContent);
  if (item.targetUnitMeasure === "und") return `x ${val} und`;
  if (item.targetUnitMeasure === "g" && val >= 1000) {
    const kg = val / 1000;
    return Number.isInteger(kg) ? `${kg} kg` : `${val.toLocaleString("es-CO")} g`;
  }
  return `${val.toLocaleString("es-CO")} ${item.targetUnitMeasure}`;
}

export function renderPrefSummary(item: BasketItemInput, tierLabels: Record<QualityTier, string>, sizeLabelFn: (s: SizePreference) => string): string {
  const tierText =
    item.allowedQualityTiers && item.allowedQualityTiers.length > 0
      ? item.allowedQualityTiers.map((t) => tierLabels[t]).join("/")
      : "Estándar";
  const prioText = item.pricePriority === "lowest_total" ? "Menor precio total" : "Menor PUM";
  const sizeText = sizeLabelFn(item.sizePreference ?? "any");
  return `${tierText} · ${prioText} · ${sizeText}`;
}

export function OfferThumb({
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
    return createElement(
      "div",
      { className: `hearth-thumb-box ${sizeClass}` },
      createElement("img", { src: imageUrl, alt, className: "hearth-thumb-img" })
    );
  }
  return createElement(
    "div",
    { className: `hearth-thumb-box ${sizeClass} fallback`, "aria-hidden": true },
    createElement(HearthIcon, { name: fallbackIcon, size: sizeClass === "lg" ? 24 : 21 })
  );
}

export function scrollWizardTop() {
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

export { formatCop };
