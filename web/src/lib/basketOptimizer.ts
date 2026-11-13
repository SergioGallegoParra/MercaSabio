import {
  extractProductSignature,
  normalizeComparableText,
  QUALITY_TIER_LABELS,
} from "./comparisonEngine.ts";
import type {
  CompareMode,
  NearbyStoreBranch,
  QualityTier,
  StoreOffer,
  UnitMeasure,
} from "@/lib/types";

export interface BasketItemInput {
  itemKey: string;
  label: string;
  familyLabel?: string | null;
  masterProductId?: string | null;
  canonicalSlug?: string | null;
  matchMode?: CompareMode;
  quantity?: number;
  allowSubstitutes?: boolean;
  subtypeFamily?: string | null;
  broadFamily?: string | null;
  targetNetContent?: number | null;
  targetUnitMeasure?: UnitMeasure | null;
  anchorStoreSkuId?: string | null;
  anchorBrand?: string | null;
  ean?: string | null;
  allowedQualityTiers?: QualityTier[];
  pricePriority?: "lowest_total" | "lowest_pum";
  requiredCriticalAttribute?: string | null;
  sizePreference?: "any" | "small" | "medium" | "large";
  preferredSkuByStore?: Record<string, string>;
  habitualReferencePriceCop?: number | null;
  habitualProductTitle?: string | null;
  originMode?: "generic_guided" | "habitual_guided" | "free_shop";
}

export type BasketMatchKind = "exact" | "substitute_direct" | "substitute_similar";

export interface BasketAllocation {
  itemKey: string;
  label: string;
  quantity: number;
  offer: StoreOffer;
  branch: NearbyStoreBranch;
  nominalCost: number;
  yieldAdjustedCost: number;
  nominalPum: number;
  realAdjustedPum: number;
  isSubstitute: boolean;
  matchKind: BasketMatchKind;
  alternativesInStore: StoreOffer[];
  activeConstraintsLabel: string;
  baselineReferenceCost: number;
}

export interface BasketStoreStop {
  storeId: string;
  storeName: string;
  branch: NearbyStoreBranch;
  subtotalNominal: number;
  subtotalYieldAdjusted: number;
  allocations: BasketAllocation[];
}

export interface BasketPlan {
  storeCount: 1 | 2 | 3;
  storeStops: BasketStoreStop[];
  coveredItems: number;
  requestedItems: number;
  totalNominalCost: number;
  totalYieldAdjustedCost: number;
  totalNominalPum: number;
  totalRealAdjustedPum: number;
  nominalSavingsCop: number;
  nominalSavingsPct: number;
  realAdjustedSavingsCop: number;
  realAdjustedSavingsPct: number;
  baselineReferenceTotalCost: number;
  savingsVsBaselineCop: number;
  savingsVsBaselinePct: number;
  totalDistanceMeters: number;
  worthExtraStop: boolean;
  filterReason: string | null;
}

export interface BasketOptimizationResult {
  bestOneStore: BasketPlan | null;
  bestTwoStores: BasketPlan | null;
  bestThreeStores: BasketPlan | null;
  singleStoreCarts: BasketPlan[];
  recommendedPlan: BasketPlan | null;
  uncoveredItems: string[];
  nearbyStoreIds: string[];
  minNearestDistanceMeters: number | null;
  effectiveRadiusMeters: number | null;
  habitualBaselineCost: number;
  savingsVsHabitualCop: number;
  savingsVsHabitualPct: number;
}

export interface BasketOptimizeOptions {
  minExtraSavingsCop?: number;
  minExtraSavingsPct?: number;
  objective?: "nominal" | "real_pum";
  maxStores?: 1 | 2 | 3;
  maxDistanceMeters?: number;
}

interface TaggedCandidate {
  offer: StoreOffer;
  matchKind: BasketMatchKind;
  effectivePum: number;
  weightDistance: number;
  inferredTier: QualityTier;
}

function isCloseWeight(
  candidateQty: number,
  targetQty: number | null | undefined,
  tolerance = 0.45
): boolean {
  if (!targetQty || targetQty <= 0 || candidateQty <= 0) return true;
  const ratio = candidateQty / targetQty;
  return ratio >= 1 - tolerance && ratio <= 1 + tolerance;
}

function matchesSizePreference(
  qty: number,
  unit: UnitMeasure,
  sizePref?: "any" | "small" | "medium" | "large"
): boolean {
  if (!sizePref || sizePref === "any" || qty <= 0) return true;
  if (unit === "und") {
    if (sizePref === "small") return qty <= 8;
    if (sizePref === "medium") return qty > 8 && qty <= 18;
    return qty > 18;
  }
  if (sizePref === "small") return qty < 400;
  if (sizePref === "medium") return qty >= 400 && qty <= 1200;
  return qty > 1200;
}

function computeMedianValue(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatConstraintsLabel(item: BasketItemInput): string {
  const parts: string[] = [];
  if (item.familyLabel) parts.push(item.familyLabel);
  if (item.requiredCriticalAttribute) {
    parts.push(item.requiredCriticalAttribute.replace(/_/g, " "));
  }
  if (item.allowedQualityTiers && item.allowedQualityTiers.length > 0 && item.allowedQualityTiers.length < 4) {
    parts.push(item.allowedQualityTiers.map((t) => QUALITY_TIER_LABELS[t]).join(" / "));
  }
  if (item.sizePreference && item.sizePreference !== "any") {
    parts.push(
      item.sizePreference === "small"
        ? "Tamaño pequeño"
        : item.sizePreference === "medium"
          ? "Tamaño mediano"
          : "Tamaño grande"
    );
  }
  if (item.pricePriority === "lowest_pum") {
    parts.push("Menor PUM");
  } else if (item.pricePriority === "lowest_total") {
    parts.push("Menor valor total");
  }
  if (item.allowSubstitutes === false) {
    parts.push("Solo marca exacta");
  }
  return parts.join(" · ") || "Sin restricciones adicionales";
}

function resolveCandidateOffers(
  item: BasketItemInput,
  offers: StoreOffer[]
): { candidates: TaggedCandidate[]; baselineUnitPrice: number } {
  const allowSubstitutes = item.allowSubstitutes ?? item.matchMode === "pum";
  const anchorBrandNorm = item.anchorBrand ? normalizeComparableText(item.anchorBrand) : null;
  const preliminary: Array<{
    offer: StoreOffer;
    sig: ReturnType<typeof extractProductSignature>;
    matchKind: BasketMatchKind;
    weightDistance: number;
  }> = [];

  const subtypePums: number[] = [];

  for (const offer of offers) {
    const sig = extractProductSignature(offer);
    if (item.subtypeFamily && sig.subtypeFamily === item.subtypeFamily && sig.effectivePum > 0) {
      subtypePums.push(sig.effectivePum);
    }

    const targetQty = item.targetNetContent ?? null;
    const weightDistance =
      targetQty && targetQty > 0 && sig.effectiveNetContent > 0
        ? Math.abs(Math.log(sig.effectiveNetContent / targetQty))
        : 0;

    // 1) Coincidencia exacta verificada (SKU ancla, EAN igual con peso cercano, o masterProductId coherente)
    const matchesSku = Boolean(item.anchorStoreSkuId && offer.storeSkuId === item.anchorStoreSkuId);
    const matchesEan = Boolean(
      item.ean &&
        offer.ean === item.ean &&
        (!item.targetUnitMeasure || sig.effectiveUnitMeasure === item.targetUnitMeasure) &&
        isCloseWeight(sig.effectiveNetContent, targetQty, 0.15)
    );
    const matchesMaster = Boolean(
      item.masterProductId &&
        offer.masterProductId === item.masterProductId &&
        (!anchorBrandNorm || sig.brandKey === anchorBrandNorm || offer.ean === item.ean) &&
        isCloseWeight(sig.effectiveNetContent, targetQty, 0.15)
    );

    if (matchesSku || matchesEan || matchesMaster) {
      preliminary.push({
        offer: {
          ...offer,
          netContent: sig.effectiveNetContent,
          unitMeasure: sig.effectiveUnitMeasure,
          pumPrice: sig.effectivePum,
        },
        sig,
        matchKind: "exact",
        weightDistance,
      });
      continue;
    }

    if (!allowSubstitutes) {
      continue;
    }

    // 2) Sustitutos permitidos para este producto
    if (item.targetUnitMeasure && sig.effectiveUnitMeasure !== item.targetUnitMeasure) {
      continue;
    }

    const sameSubtype = Boolean(
      (item.subtypeFamily && sig.subtypeFamily === item.subtypeFamily) ||
        (item.canonicalSlug &&
          (sig.inferredCanonicalSlug === item.canonicalSlug ||
            offer.canonicalSlug === item.canonicalSlug))
    );
    const sameBroad = Boolean(item.broadFamily && sig.broadFamily === item.broadFamily);

    if (!sameSubtype && !sameBroad) {
      continue;
    }

    // Si el usuario exigió un subtipo específico en modo genérico, no mezclar otros subtipos cuando exige atributo o subtipo cerrado
    if (item.subtypeFamily && !sameSubtype && item.originMode === "generic_guided") {
      continue;
    }

    if (!matchesSizePreference(sig.effectiveNetContent, sig.effectiveUnitMeasure, item.sizePreference)) {
      continue;
    }

    if (item.requiredCriticalAttribute) {
      const candAttr = sig.criticalAttribute;
      if (candAttr !== item.requiredCriticalAttribute) {
        // Permite coincidencia parcial de tokens (ej. 'lomo_agua' contiene 'lomo')
        if (!candAttr || !candAttr.includes(item.requiredCriticalAttribute)) {
          continue;
        }
      }
    }

    const matchKind: BasketMatchKind =
      sameSubtype && isCloseWeight(sig.effectiveNetContent, targetQty, 0.45)
        ? "substitute_direct"
        : "substitute_similar";

    preliminary.push({
      offer: {
        ...offer,
        netContent: sig.effectiveNetContent,
        unitMeasure: sig.effectiveUnitMeasure,
        pumPrice: sig.effectivePum,
      },
      sig,
      matchKind,
      weightDistance,
    });
  }

  const subtypeMedian = computeMedianValue(subtypePums);
  const allowedTiers =
    item.allowedQualityTiers && item.allowedQualityTiers.length > 0
      ? new Set(item.allowedQualityTiers)
      : null;

  const deduped = new Map<string, TaggedCandidate>();
  let highestMatchingPrice = 0;

  for (const cand of preliminary) {
    let inferredTier: QualityTier = cand.sig.lexicalTierHint ?? "estandar";
    if (!cand.sig.lexicalTierHint && subtypeMedian && subtypeMedian > 0 && subtypePums.length >= 2) {
      const ratio = cand.sig.effectivePum / subtypeMedian;
      if (ratio >= 2.05) inferredTier = "especial";
      else if (ratio >= 1.48) inferredTier = "premium";
      else if (ratio <= 0.75) inferredTier = "economico";
    }

    if (cand.matchKind !== "exact" && allowedTiers && !allowedTiers.has(inferredTier)) {
      continue;
    }

    if (cand.offer.calibratedPrice > highestMatchingPrice) {
      highestMatchingPrice = cand.offer.calibratedPrice;
    }

    deduped.set(cand.offer.storeSkuId, {
      offer: cand.offer,
      matchKind: cand.matchKind,
      effectivePum: cand.sig.effectivePum,
      weightDistance: cand.weightDistance,
      inferredTier,
    });
  }

  // Fallback suave: si el filtro de gama dejó 0 resultados pero había exactos, conserva exactos
  if (deduped.size === 0 && preliminary.length > 0) {
    for (const cand of preliminary) {
      if (cand.matchKind === "exact") {
        if (cand.offer.calibratedPrice > highestMatchingPrice) {
          highestMatchingPrice = cand.offer.calibratedPrice;
        }
        deduped.set(cand.offer.storeSkuId, {
          offer: cand.offer,
          matchKind: cand.matchKind,
          effectivePum: cand.sig.effectivePum,
          weightDistance: cand.weightDistance,
          inferredTier: cand.sig.lexicalTierHint ?? "estandar",
        });
      }
    }
  }

  const baselineUnitPrice =
    item.habitualReferencePriceCop && item.habitualReferencePriceCop > 0
      ? Math.max(item.habitualReferencePriceCop, highestMatchingPrice > 0 ? item.habitualReferencePriceCop : 0)
      : highestMatchingPrice;

  return {
    candidates: [...deduped.values()],
    baselineUnitPrice,
  };
}

function combinationsOfSize<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  if (size === 1) return items.map((item) => [item]);

  const result: T[][] = [];
  for (let i = 0; i <= items.length - size; i += 1) {
    const head = items[i];
    const tails = combinationsOfSize(items.slice(i + 1), size - 1);
    for (const tail of tails) {
      result.push([head, ...tail]);
    }
  }
  return result;
}

function scoreAllocation(
  candidate: TaggedCandidate,
  quantity: number,
  objective: "nominal" | "real_pum",
  itemPriority?: "lowest_total" | "lowest_pum"
): number {
  const { offer, matchKind, effectivePum, weightDistance } = candidate;
  const yieldFactor = offer.avgYieldFactor > 0 ? offer.avgYieldFactor : 1;

  if (itemPriority === "lowest_pum" || (itemPriority !== "lowest_total" && objective === "real_pum")) {
    const tierPenalty = matchKind === "substitute_similar" ? 1.08 : 1;
    return effectivePum * yieldFactor * tierPenalty;
  }

  if (itemPriority === "lowest_total") {
    const tierPenalty = matchKind === "substitute_similar" ? 1.04 : 1;
    return offer.calibratedPrice * quantity * tierPenalty;
  }

  const sizePenalty = matchKind === "exact" ? 1 : 1 + Math.min(weightDistance, 1.5) * 0.25;
  return offer.calibratedPrice * quantity * sizePenalty;
}

interface BuiltItemPool {
  item: BasketItemInput;
  quantity: number;
  constraintsLabel: string;
  baselineUnitPrice: number;
  byStore: Map<string, TaggedCandidate[]>;
}

function evaluateStoreCombination(
  storeIds: string[],
  storeCount: 1 | 2 | 3,
  itemPools: BuiltItemPool[],
  nearestBranchByStore: Map<string, NearbyStoreBranch>,
  objective: "nominal" | "real_pum"
): BasketPlan | null {
  const stopsMap = new Map<string, BasketStoreStop>();
  let coveredItems = 0;
  let totalNominalCost = 0;
  let totalYieldAdjustedCost = 0;
  let totalNominalPum = 0;
  let totalRealAdjustedPum = 0;
  let baselineReferenceTotalCost = 0;

  for (const pool of itemPools) {
    let chosenCandidate: TaggedCandidate | null = null;
    let bestMetric = Number.POSITIVE_INFINITY;

    // Primero verificamos si el usuario seleccionó manualmente un SKU específico en alguna de las tiendas del plan
    for (const storeId of storeIds) {
      const candidateList = pool.byStore.get(storeId);
      if (!candidateList || candidateList.length === 0) continue;

      const preferredSkuId = pool.item.preferredSkuByStore?.[storeId];
      if (preferredSkuId) {
        const manualHit = candidateList.find((c) => c.offer.storeSkuId === preferredSkuId);
        if (manualHit) {
          chosenCandidate = manualHit;
          break;
        }
      }

      for (const candidate of candidateList) {
        const metric = scoreAllocation(
          candidate,
          pool.quantity,
          objective,
          pool.item.pricePriority
        );
        if (metric < bestMetric) {
          bestMetric = metric;
          chosenCandidate = candidate;
        }
      }
    }

    if (!chosenCandidate) {
      continue;
    }

    const chosenOffer = chosenCandidate.offer;
    const branch = nearestBranchByStore.get(chosenOffer.storeId);
    if (!branch) {
      continue;
    }

    coveredItems += 1;
    const yieldFactor = chosenOffer.avgYieldFactor > 0 ? chosenOffer.avgYieldFactor : 1;
    const nominalCost = chosenOffer.calibratedPrice * pool.quantity;
    const yieldAdjustedCost = nominalCost * yieldFactor;
    const nominalPum = chosenCandidate.effectivePum;
    const realAdjustedPum = nominalPum * yieldFactor;
    const baselineRef =
      pool.baselineUnitPrice > 0
        ? Math.max(pool.baselineUnitPrice * pool.quantity, nominalCost)
        : nominalCost;

    totalNominalCost += nominalCost;
    totalYieldAdjustedCost += yieldAdjustedCost;
    totalNominalPum += nominalPum;
    totalRealAdjustedPum += realAdjustedPum;
    baselineReferenceTotalCost += baselineRef;

    const storeCandidates = pool.byStore.get(chosenOffer.storeId) ?? [chosenCandidate];
    const alternativesInStore = [...storeCandidates]
      .sort(
        (a, b) =>
          scoreAllocation(a, pool.quantity, objective, pool.item.pricePriority) -
          scoreAllocation(b, pool.quantity, objective, pool.item.pricePriority)
      )
      .slice(0, 8)
      .map((c) => c.offer);

    let stop = stopsMap.get(chosenOffer.storeId);
    if (!stop) {
      stop = {
        storeId: chosenOffer.storeId,
        storeName: chosenOffer.storeName,
        branch,
        subtotalNominal: 0,
        subtotalYieldAdjusted: 0,
        allocations: [],
      };
      stopsMap.set(chosenOffer.storeId, stop);
    }

    stop.subtotalNominal += nominalCost;
    stop.subtotalYieldAdjusted += yieldAdjustedCost;
    stop.allocations.push({
      itemKey: pool.item.itemKey,
      label: pool.item.label,
      quantity: pool.quantity,
      offer: chosenOffer,
      branch,
      nominalCost,
      yieldAdjustedCost,
      nominalPum,
      realAdjustedPum,
      isSubstitute: chosenCandidate.matchKind !== "exact",
      matchKind: chosenCandidate.matchKind,
      alternativesInStore,
      activeConstraintsLabel: pool.constraintsLabel,
      baselineReferenceCost: Math.round(baselineRef),
    });
  }

  const storeStops = [...stopsMap.values()].sort(
    (a, b) => a.branch.distanceMeters - b.branch.distanceMeters
  );
  if (storeStops.length === 0) {
    return null;
  }

  const totalDistanceMeters = storeStops.reduce(
    (acc, stop) => acc + stop.branch.distanceMeters,
    0
  );
  const roundedTotal = Math.round(totalNominalCost);
  const roundedBaseline = Math.round(baselineReferenceTotalCost);
  const savingsVsBaselineCop = Math.max(0, roundedBaseline - roundedTotal);
  const savingsVsBaselinePct =
    roundedBaseline > 0
      ? Number(((savingsVsBaselineCop / roundedBaseline) * 100).toFixed(1))
      : 0;

  return {
    storeCount,
    storeStops,
    coveredItems,
    requestedItems: itemPools.length,
    totalNominalCost: roundedTotal,
    totalYieldAdjustedCost: Math.round(totalYieldAdjustedCost),
    totalNominalPum: Number(totalNominalPum.toFixed(4)),
    totalRealAdjustedPum: Number(totalRealAdjustedPum.toFixed(4)),
    nominalSavingsCop: 0,
    nominalSavingsPct: 0,
    realAdjustedSavingsCop: 0,
    realAdjustedSavingsPct: 0,
    baselineReferenceTotalCost: roundedBaseline,
    savingsVsBaselineCop,
    savingsVsBaselinePct,
    totalDistanceMeters: Math.round(totalDistanceMeters),
    worthExtraStop: true,
    filterReason: null,
  };
}

function isBetterPlan(
  candidate: BasketPlan,
  currentBest: BasketPlan | null,
  objective: "nominal" | "real_pum"
): boolean {
  if (!currentBest) return true;
  if (candidate.coveredItems !== currentBest.coveredItems) {
    return candidate.coveredItems > currentBest.coveredItems;
  }
  const candCost =
    objective === "real_pum" ? candidate.totalYieldAdjustedCost : candidate.totalNominalCost;
  const bestCost =
    objective === "real_pum" ? currentBest.totalYieldAdjustedCost : currentBest.totalNominalCost;
  if (candCost !== bestCost) {
    return candCost < bestCost;
  }
  return candidate.totalDistanceMeters < currentBest.totalDistanceMeters;
}

function attachBaselineComparisons(
  plan: BasketPlan | null,
  baseline: BasketPlan | null,
  previousTier: BasketPlan | null,
  minExtraSavingsCop: number,
  minExtraSavingsPct: number,
  objective: "nominal" | "real_pum"
): BasketPlan | null {
  if (!plan) return null;
  if (!baseline || plan === baseline) {
    return { ...plan, worthExtraStop: true, filterReason: null };
  }

  const nominalSavingsCop = baseline.totalNominalCost - plan.totalNominalCost;
  const nominalSavingsPct =
    baseline.totalNominalCost > 0
      ? Number(((nominalSavingsCop / baseline.totalNominalCost) * 100).toFixed(1))
      : 0;

  const realAdjustedSavingsCop = baseline.totalYieldAdjustedCost - plan.totalYieldAdjustedCost;
  const realAdjustedSavingsPct =
    baseline.totalYieldAdjustedCost > 0
      ? Number(((realAdjustedSavingsCop / baseline.totalYieldAdjustedCost) * 100).toFixed(1))
      : 0;

  const reference = previousTier ?? baseline;
  const incrementalCover = plan.coveredItems > reference.coveredItems;
  const incrementalCop =
    objective === "real_pum"
      ? reference.totalYieldAdjustedCost - plan.totalYieldAdjustedCost
      : reference.totalNominalCost - plan.totalNominalCost;
  const refTotal =
    objective === "real_pum" ? reference.totalYieldAdjustedCost : reference.totalNominalCost;
  const incrementalPct = refTotal > 0 ? (incrementalCop / refTotal) * 100 : 0;

  const worthExtraStop =
    incrementalCover ||
    incrementalCop >= minExtraSavingsCop ||
    incrementalPct >= minExtraSavingsPct;

  const filterReason = worthExtraStop
    ? null
    : `Ahorro adicional (${Math.max(0, Math.round(incrementalCop))} COP) menor al umbral mínimo de ${minExtraSavingsCop} COP para justificar visitar otra tienda.`;

  return {
    ...plan,
    nominalSavingsCop,
    nominalSavingsPct,
    realAdjustedSavingsCop,
    realAdjustedSavingsPct,
    worthExtraStop,
    filterReason,
  };
}

/**
 * Ejecuta la optimización combinatoria de canasta para 1, 2 y 3 tiendas cercanas,
 * respetando distancia máxima (mínimo = supermercado más cercano), máximo de tiendas,
 * características impuestas por producto y cambios manuales por tienda.
 */
export function optimizeBasket(params: {
  items: BasketItemInput[];
  offers: StoreOffer[];
  nearbyBranches: NearbyStoreBranch[];
  options?: BasketOptimizeOptions;
}): BasketOptimizationResult {
  const { items, offers, nearbyBranches, options } = params;
  const objective = options?.objective ?? "nominal";
  const minExtraSavingsCop = options?.minExtraSavingsCop ?? 2000;
  const minExtraSavingsPct = options?.minExtraSavingsPct ?? 2;
  const maxStores = options?.maxStores ?? 3;

  const sortedBranches = [...nearbyBranches].sort(
    (a, b) => a.distanceMeters - b.distanceMeters
  );
  const minNearestDistanceMeters =
    sortedBranches.length > 0 ? Math.round(sortedBranches[0].distanceMeters) : null;

  const effectiveRadiusMeters =
    minNearestDistanceMeters !== null && options?.maxDistanceMeters !== undefined
      ? Math.max(Math.round(options.maxDistanceMeters), minNearestDistanceMeters)
      : options?.maxDistanceMeters ?? null;

  const eligibleBranches =
    effectiveRadiusMeters !== null
      ? sortedBranches.filter((b) => b.distanceMeters <= effectiveRadiusMeters + 1)
      : sortedBranches;

  if (items.length === 0 || eligibleBranches.length === 0) {
    return {
      bestOneStore: null,
      bestTwoStores: null,
      bestThreeStores: null,
      singleStoreCarts: [],
      recommendedPlan: null,
      uncoveredItems: items.map((i) => i.label),
      nearbyStoreIds: [],
      minNearestDistanceMeters,
      effectiveRadiusMeters,
      habitualBaselineCost: 0,
      savingsVsHabitualCop: 0,
      savingsVsHabitualPct: 0,
    };
  }

  const nearestBranchByStore = new Map<string, NearbyStoreBranch>();
  for (const branch of eligibleBranches) {
    if (!nearestBranchByStore.has(branch.storeId)) {
      nearestBranchByStore.set(branch.storeId, branch);
    }
  }

  const nearbyStoreIds = [...nearestBranchByStore.keys()];
  const nearbyOffers = offers.filter(
    (offer) => offer.inStock && nearestBranchByStore.has(offer.storeId)
  );

  const uncoveredItems: string[] = [];
  const itemPools: BuiltItemPool[] = items.map((item) => {
    const quantity = Math.max(1, Math.round(item.quantity ?? 1));
    const { candidates, baselineUnitPrice } = resolveCandidateOffers(item, nearbyOffers);
    const byStore = new Map<string, TaggedCandidate[]>();
    for (const candidate of candidates) {
      const list = byStore.get(candidate.offer.storeId) ?? [];
      list.push(candidate);
      byStore.set(candidate.offer.storeId, list);
    }
    if (byStore.size === 0) {
      uncoveredItems.push(item.label);
    }
    return {
      item,
      quantity,
      constraintsLabel: formatConstraintsLabel(item),
      baselineUnitPrice,
      byStore,
    };
  });

  const activeStoreIds = nearbyStoreIds
    .filter((storeId) => itemPools.some((pool) => pool.byStore.has(storeId)))
    .slice(0, 12);

  if (activeStoreIds.length === 0) {
    return {
      bestOneStore: null,
      bestTwoStores: null,
      bestThreeStores: null,
      singleStoreCarts: [],
      recommendedPlan: null,
      uncoveredItems,
      nearbyStoreIds,
      minNearestDistanceMeters,
      effectiveRadiusMeters,
      habitualBaselineCost: 0,
      savingsVsHabitualCop: 0,
      savingsVsHabitualPct: 0,
    };
  }

  const singleStoreCarts: BasketPlan[] = [];
  let rawOne: BasketPlan | null = null;
  for (const storeId of activeStoreIds) {
    const plan = evaluateStoreCombination([storeId], 1, itemPools, nearestBranchByStore, objective);
    if (plan) {
      singleStoreCarts.push(plan);
      if (isBetterPlan(plan, rawOne, objective)) {
        rawOne = plan;
      }
    }
  }
  singleStoreCarts.sort((a, b) => {
    if (b.coveredItems !== a.coveredItems) return b.coveredItems - a.coveredItems;
    return a.totalNominalCost - b.totalNominalCost;
  });

  let rawTwo: BasketPlan | null = null;
  if (maxStores >= 2 && activeStoreIds.length >= 2) {
    for (const combo of combinationsOfSize(activeStoreIds, 2)) {
      const plan = evaluateStoreCombination(combo, 2, itemPools, nearestBranchByStore, objective);
      if (plan && plan.storeStops.length >= 2 && isBetterPlan(plan, rawTwo, objective)) {
        rawTwo = plan;
      }
    }
  }

  let rawThree: BasketPlan | null = null;
  if (maxStores >= 3 && activeStoreIds.length >= 3) {
    for (const combo of combinationsOfSize(activeStoreIds, 3)) {
      const plan = evaluateStoreCombination(combo, 3, itemPools, nearestBranchByStore, objective);
      if (plan && plan.storeStops.length >= 3 && isBetterPlan(plan, rawThree, objective)) {
        rawThree = plan;
      }
    }
  }

  const bestOneStore = attachBaselineComparisons(
    rawOne,
    rawOne,
    null,
    minExtraSavingsCop,
    minExtraSavingsPct,
    objective
  );
  const bestTwoStores = attachBaselineComparisons(
    rawTwo,
    bestOneStore,
    bestOneStore,
    minExtraSavingsCop,
    minExtraSavingsPct,
    objective
  );
  const bestThreeStores = attachBaselineComparisons(
    rawThree,
    bestOneStore,
    bestTwoStores?.worthExtraStop ? bestTwoStores : bestOneStore,
    minExtraSavingsCop,
    minExtraSavingsPct,
    objective
  );

  let recommendedPlan: BasketPlan | null = bestOneStore;
  if (maxStores >= 2 && bestTwoStores && bestTwoStores.worthExtraStop) {
    recommendedPlan = bestTwoStores;
  }
  if (maxStores >= 3 && bestThreeStores && bestThreeStores.worthExtraStop) {
    recommendedPlan = bestThreeStores;
  }

  const habitualBaselineCost = recommendedPlan?.baselineReferenceTotalCost ?? 0;
  const savingsVsHabitualCop = recommendedPlan?.savingsVsBaselineCop ?? 0;
  const savingsVsHabitualPct = recommendedPlan?.savingsVsBaselinePct ?? 0;

  return {
    bestOneStore,
    bestTwoStores,
    bestThreeStores,
    singleStoreCarts,
    recommendedPlan,
    uncoveredItems,
    nearbyStoreIds,
    minNearestDistanceMeters,
    effectiveRadiusMeters,
    habitualBaselineCost,
    savingsVsHabitualCop,
    savingsVsHabitualPct,
  };
}
