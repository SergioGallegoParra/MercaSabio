import {
  extractProductSignature,
  normalizeComparableText,
} from "./comparisonEngine.ts";
import type {
  CompareMode,
  NearbyStoreBranch,
  StoreOffer,
  UnitMeasure,
} from "@/lib/types";

export interface BasketItemInput {
  itemKey: string;
  label: string;
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
  totalDistanceMeters: number;
  worthExtraStop: boolean;
  filterReason: string | null;
}

export interface BasketOptimizationResult {
  bestOneStore: BasketPlan | null;
  bestTwoStores: BasketPlan | null;
  bestThreeStores: BasketPlan | null;
  recommendedPlan: BasketPlan | null;
  uncoveredItems: string[];
  nearbyStoreIds: string[];
}

export interface BasketOptimizeOptions {
  minExtraSavingsCop?: number;
  minExtraSavingsPct?: number;
  objective?: "nominal" | "real_pum";
}

interface TaggedCandidate {
  offer: StoreOffer;
  matchKind: BasketMatchKind;
  effectivePum: number;
  weightDistance: number;
}

function isCloseWeight(candidateQty: number, targetQty: number | null | undefined, tolerance = 0.45): boolean {
  if (!targetQty || targetQty <= 0 || candidateQty <= 0) return true;
  const ratio = candidateQty / targetQty;
  return ratio >= 1 - tolerance && ratio <= 1 + tolerance;
}

function resolveCandidateOffers(item: BasketItemInput, offers: StoreOffer[]): TaggedCandidate[] {
  const allowSubstitutes = item.allowSubstitutes ?? item.matchMode === "pum";
  const anchorBrandNorm = item.anchorBrand ? normalizeComparableText(item.anchorBrand) : null;
  const results = new Map<string, TaggedCandidate>();

  for (const offer of offers) {
    const sig = extractProductSignature(offer);
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
      results.set(offer.storeSkuId, {
        offer: { ...offer, netContent: sig.effectiveNetContent, unitMeasure: sig.effectiveUnitMeasure, pumPrice: sig.effectivePum },
        matchKind: "exact",
        effectivePum: sig.effectivePum,
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
        (item.canonicalSlug && (sig.inferredCanonicalSlug === item.canonicalSlug || offer.canonicalSlug === item.canonicalSlug))
    );
    const sameBroad = Boolean(item.broadFamily && sig.broadFamily === item.broadFamily);

    if (!sameSubtype && !sameBroad) {
      continue;
    }

    const matchKind: BasketMatchKind =
      sameSubtype && isCloseWeight(sig.effectiveNetContent, targetQty, 0.45)
        ? "substitute_direct"
        : "substitute_similar";

    results.set(offer.storeSkuId, {
      offer: { ...offer, netContent: sig.effectiveNetContent, unitMeasure: sig.effectiveUnitMeasure, pumPrice: sig.effectivePum },
      matchKind,
      effectivePum: sig.effectivePum,
      weightDistance,
    });
  }

  return [...results.values()];
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
  objective: "nominal" | "real_pum"
): number {
  const { offer, matchKind, effectivePum, weightDistance } = candidate;
  const yieldFactor = offer.avgYieldFactor > 0 ? offer.avgYieldFactor : 1;
  if (objective === "real_pum") {
    const tierPenalty = matchKind === "substitute_similar" ? 1.08 : 1;
    return effectivePum * yieldFactor * tierPenalty;
  }
  // En modo nominal penalizamos saltos extremos de tamaño (>50% lejos) solo cuando hay tamaño cercano
  const sizePenalty = matchKind === "exact" ? 1 : 1 + Math.min(weightDistance, 1.5) * 0.25;
  return offer.calibratedPrice * quantity * sizePenalty;
}

function evaluateStoreCombination(
  storeIds: string[],
  storeCount: 1 | 2 | 3,
  itemPools: Array<{ item: BasketItemInput; quantity: number; byStore: Map<string, TaggedCandidate[]> }>,
  nearestBranchByStore: Map<string, NearbyStoreBranch>,
  objective: "nominal" | "real_pum"
): BasketPlan | null {
  const stopsMap = new Map<string, BasketStoreStop>();
  let coveredItems = 0;
  let totalNominalCost = 0;
  let totalYieldAdjustedCost = 0;
  let totalNominalPum = 0;
  let totalRealAdjustedPum = 0;

  for (const pool of itemPools) {
    let chosenCandidate: TaggedCandidate | null = null;
    let bestMetric = Number.POSITIVE_INFINITY;

    for (const storeId of storeIds) {
      const candidateList = pool.byStore.get(storeId);
      if (!candidateList) continue;
      for (const candidate of candidateList) {
        const metric = scoreAllocation(candidate, pool.quantity, objective);
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

    totalNominalCost += nominalCost;
    totalYieldAdjustedCost += yieldAdjustedCost;
    totalNominalPum += nominalPum;
    totalRealAdjustedPum += realAdjustedPum;

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

  return {
    storeCount,
    storeStops,
    coveredItems,
    requestedItems: itemPools.length,
    totalNominalCost: Math.round(totalNominalCost),
    totalYieldAdjustedCost: Math.round(totalYieldAdjustedCost),
    totalNominalPum: Number(totalNominalPum.toFixed(4)),
    totalRealAdjustedPum: Number(totalRealAdjustedPum.toFixed(4)),
    nominalSavingsCop: 0,
    nominalSavingsPct: 0,
    realAdjustedSavingsCop: 0,
    realAdjustedSavingsPct: 0,
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
 * Ejecuta en el navegador del usuario la optimización combinatoria de canasta
 * para 1, 2 y 3 tiendas cercanas devueltas por `get_nearby_stores`.
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

  if (items.length === 0 || nearbyBranches.length === 0) {
    return {
      bestOneStore: null,
      bestTwoStores: null,
      bestThreeStores: null,
      recommendedPlan: null,
      uncoveredItems: items.map((i) => i.label),
      nearbyStoreIds: [],
    };
  }

  // `get_nearby_stores` retorna ordenado por distance_meters ASC: conservamos la sede más cercana por cadena
  const nearestBranchByStore = new Map<string, NearbyStoreBranch>();
  for (const branch of [...nearbyBranches].sort((a, b) => a.distanceMeters - b.distanceMeters)) {
    if (!nearestBranchByStore.has(branch.storeId)) {
      nearestBranchByStore.set(branch.storeId, branch);
    }
  }

  const nearbyStoreIds = [...nearestBranchByStore.keys()];
  const nearbyOffers = offers.filter(
    (offer) => offer.inStock && nearestBranchByStore.has(offer.storeId)
  );

  const uncoveredItems: string[] = [];
  const itemPools = items.map((item) => {
    const quantity = Math.max(1, Math.round(item.quantity ?? 1));
    const candidates = resolveCandidateOffers(item, nearbyOffers);
    const byStore = new Map<string, TaggedCandidate[]>();
    for (const candidate of candidates) {
      const list = byStore.get(candidate.offer.storeId) ?? [];
      list.push(candidate);
      byStore.set(candidate.offer.storeId, list);
    }
    if (byStore.size === 0) {
      uncoveredItems.push(item.label);
    }
    return { item, quantity, byStore };
  });

  // Limita a las 12 cadenas cercanas con mayor cobertura para mantener O(C(12,3)) < 1 ms
  const activeStoreIds = nearbyStoreIds
    .filter((storeId) => itemPools.some((pool) => pool.byStore.has(storeId)))
    .slice(0, 12);

  if (activeStoreIds.length === 0) {
    return {
      bestOneStore: null,
      bestTwoStores: null,
      bestThreeStores: null,
      recommendedPlan: null,
      uncoveredItems,
      nearbyStoreIds,
    };
  }

  let rawOne: BasketPlan | null = null;
  for (const storeId of activeStoreIds) {
    const plan = evaluateStoreCombination([storeId], 1, itemPools, nearestBranchByStore, objective);
    if (plan && isBetterPlan(plan, rawOne, objective)) {
      rawOne = plan;
    }
  }

  let rawTwo: BasketPlan | null = null;
  if (activeStoreIds.length >= 2) {
    for (const combo of combinationsOfSize(activeStoreIds, 2)) {
      const plan = evaluateStoreCombination(combo, 2, itemPools, nearestBranchByStore, objective);
      if (plan && plan.storeStops.length >= 2 && isBetterPlan(plan, rawTwo, objective)) {
        rawTwo = plan;
      }
    }
  }

  let rawThree: BasketPlan | null = null;
  if (activeStoreIds.length >= 3) {
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
  if (bestTwoStores && bestTwoStores.worthExtraStop) {
    recommendedPlan = bestTwoStores;
  }
  if (bestThreeStores && bestThreeStores.worthExtraStop) {
    recommendedPlan = bestThreeStores;
  }

  return {
    bestOneStore,
    bestTwoStores,
    bestThreeStores,
    recommendedPlan,
    uncoveredItems,
    nearbyStoreIds,
  };
}
