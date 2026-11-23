import {
  type BasketItemInput,
  type BasketOptimizationResult,
  type BasketOptimizeOptions,
  optimizeBasket,
} from "./basketOptimizer.ts";
import { extractProductSignature, normalizeComparableText } from "./comparisonEngine.ts";
import { passesDiet } from "./dietaryFilter.ts";
import { buildHabitualSwaps } from "./habitualDiff.ts";
import { passesSabiometroFilter } from "./sabiometro.ts";
import { type SamePlantIndex } from "./samePlant.ts";
import type {
  BudgetOptimizationResult,
  DietFilter,
  NearbyStoreBranch,
  SabiometroSummary,
  StoreOffer,
} from "./types.ts";

export interface BudgetCandidate {
  offer: StoreOffer;
  costCop: number;
  utility: number;
}

function candidateUtility(params: {
  item: BasketItemInput;
  offer: StoreOffer;
  anchorSig: ReturnType<typeof extractProductSignature> | null;
}): number {
  const { item, offer, anchorSig } = params;
  if (
    (item.anchorStoreSkuId && offer.storeSkuId === item.anchorStoreSkuId) ||
    (item.masterProductId && offer.masterProductId === item.masterProductId && !item.locked)
  ) {
    return 1.0;
  }

  const candSig = extractProductSignature(offer);
  const sameBrand = Boolean(
    anchorSig?.brandKey && candSig.brandKey && anchorSig.brandKey === candSig.brandKey,
  );
  const sameEan = Boolean(item.ean && offer.ean && item.ean === offer.ean);
  if (sameBrand || sameEan) {
    return 0.95;
  }

  const sabioVal = offer.sabiometro?.status === "published" && offer.sabiometro.valueIndex !== null
    ? offer.sabiometro.valueIndex
    : 60;
  const sabioNorm = Math.min(1, Math.max(0, sabioVal / 100));

  const tier = candSig.lexicalTierHint ?? "estandar";
  const anchorTier = anchorSig?.lexicalTierHint ?? "estandar";
  if (tier === anchorTier || tier === "premium" || tier === "especial") {
    return Number((0.8 + 0.15 * sabioNorm).toFixed(4));
  }
  return Number((0.6 + 0.25 * sabioNorm).toFixed(4));
}

export function buildBudgetCandidatePool(params: {
  item: BasketItemInput;
  offers: StoreOffer[];
  mode: "my_brands" | "generic";
  locked: boolean;
  dietFilters: DietFilter[];
  minSabioIndex?: number;
  maxCandidates?: number;
}): BudgetCandidate[] {
  const { item, offers, mode, locked, dietFilters, minSabioIndex, maxCandidates = 8 } = params;
  const qty = Math.max(1, Math.round(item.quantity ?? 1));
  const anchorOffer = item.anchorStoreSkuId
    ? offers.find((o) => o.storeSkuId === item.anchorStoreSkuId) ?? null
    : null;
  const anchorSig = anchorOffer ? extractProductSignature(anchorOffer) : null;
  const excludedBrands = new Set(
    (item.excludedBrands ?? []).map((b) => normalizeComparableText(b)).filter(Boolean),
  );
  const allowedTiers =
    item.allowedQualityTiers && item.allowedQualityTiers.length > 0
      ? new Set(item.allowedQualityTiers)
      : null;

  const groupedByMaster = new Map<string, StoreOffer>();

  for (const offer of offers) {
    if (!offer.inStock || offer.calibratedPrice <= 0) continue;
    const candSig = extractProductSignature(offer);

    const isExactAnchor =
      Boolean(item.anchorStoreSkuId && offer.storeSkuId === item.anchorStoreSkuId) ||
      Boolean(item.masterProductId && offer.masterProductId === item.masterProductId) ||
      Boolean(item.ean && offer.ean === item.ean);

    if (locked) {
      if (!isExactAnchor) continue;
    } else {
      const brandNorm = normalizeComparableText(offer.brand ?? candSig.brandKey ?? "");
      if (brandNorm && excludedBrands.has(brandNorm)) continue;

      if (mode === "my_brands") {
        const anchorBrandNorm = normalizeComparableText(
          item.anchorBrand ?? anchorOffer?.brand ?? anchorSig?.brandKey ?? "",
        );
        const brandMatches = anchorBrandNorm && brandNorm === anchorBrandNorm;
        const eanMatches = Boolean(item.ean && offer.ean === item.ean);
        if (!isExactAnchor && !brandMatches && !eanMatches) continue;
      } else {
        if (item.targetUnitMeasure && candSig.effectiveUnitMeasure !== item.targetUnitMeasure) {
          continue;
        }
        const sameSubtype =
          (item.subtypeFamily && candSig.subtypeFamily === item.subtypeFamily) ||
          (item.canonicalSlug &&
            (candSig.inferredCanonicalSlug === item.canonicalSlug ||
              offer.canonicalSlug === item.canonicalSlug));
        const sameBroad = Boolean(item.broadFamily && candSig.broadFamily === item.broadFamily);
        if (!isExactAnchor && !sameSubtype && !sameBroad) continue;
      }

      if (!isExactAnchor && allowedTiers) {
        const tier = candSig.lexicalTierHint ?? "estandar";
        if (!allowedTiers.has(tier)) continue;
      }

      if (!isExactAnchor && dietFilters.length > 0) {
        if (passesDiet(offer.productAttributes, dietFilters, offer) !== "pass") continue;
      }

      if (!isExactAnchor && minSabioIndex) {
        if (!passesSabiometroFilter(offer.sabiometro, minSabioIndex)) continue;
      }
    }

    const dedupeId = `${offer.masterProductId}::${offer.netContent}`;
    const existing = groupedByMaster.get(dedupeId);
    if (!existing || offer.calibratedPrice < existing.calibratedPrice) {
      groupedByMaster.set(dedupeId, {
        ...offer,
        netContent: candSig.effectiveNetContent,
        unitMeasure: candSig.effectiveUnitMeasure,
        pumPrice: candSig.effectivePum,
      });
    }
  }

  const rawList: BudgetCandidate[] = [];
  for (const bestOffer of groupedByMaster.values()) {
    rawList.push({
      offer: bestOffer,
      costCop: Math.round(bestOffer.calibratedPrice * qty),
      utility: candidateUtility({ item, offer: bestOffer, anchorSig }),
    });
  }

  rawList.sort((a, b) => {
    if (a.costCop !== b.costCop) return a.costCop - b.costCop;
    return b.utility - a.utility;
  });

  // Garantiza conservar el producto habitual actual entre los candidatos si existía
  const top = rawList.slice(0, maxCandidates);
  const anchorCandidate = rawList.find((c) => c.utility === 1.0);
  if (anchorCandidate && !top.some((c) => c.offer.storeSkuId === anchorCandidate.offer.storeSkuId)) {
    top[top.length - 1] = anchorCandidate;
  }
  return top;
}

/**
 * Resuelve el problema de mochila de elección múltiple (MCKP) mediante Programación Dinámica
 * discretizada por paso COP ($100 hasta $2M, $500 por encima).
 * Determinista y verificable contra fuerza bruta en instancias pequeñas.
 */
export function solveMultipleChoiceKnapsack(params: {
  pools: Array<{ itemKey: string; candidates: BudgetCandidate[] }>;
  budgetCop: number;
}): {
  feasible: boolean;
  totalCostCop: number;
  utilityScore: number;
  minimumPossibleCop: number;
  chosenByKey: Record<string, BudgetCandidate>;
} {
  const { pools, budgetCop } = params;
  const nonEmptyPools = pools.filter((p) => p.candidates.length > 0);
  if (nonEmptyPools.length === 0) {
    return {
      feasible: true,
      totalCostCop: 0,
      utilityScore: 0,
      minimumPossibleCop: 0,
      chosenByKey: {},
    };
  }

  const minimumPossibleCop = nonEmptyPools.reduce(
    (sum, p) => sum + Math.min(...p.candidates.map((c) => c.costCop)),
    0,
  );

  if (minimumPossibleCop > budgetCop) {
    const minChoices: Record<string, BudgetCandidate> = {};
    let util = 0;
    for (const p of nonEmptyPools) {
      const cheapest = [...p.candidates].sort((a, b) => a.costCop - b.costCop || b.utility - a.utility)[0];
      minChoices[p.itemKey] = cheapest;
      util += cheapest.utility;
    }
    return {
      feasible: false,
      totalCostCop: minimumPossibleCop,
      utilityScore: Number(util.toFixed(4)),
      minimumPossibleCop,
      chosenByKey: minChoices,
    };
  }

  const step = budgetCop > 2_000_000 ? 500 : 100;
  const capUnits = Math.floor(budgetCop / step);

  let dpUtil = new Float64Array(capUnits + 1);
  dpUtil.fill(-1);
  dpUtil[0] = 0;

  let dpExactCost = new Int32Array(capUnits + 1);
  const backptr: Array<Int16Array> = [];

  for (let row = 0; row < nonEmptyPools.length; row++) {
    const candidates = nonEmptyPools[row].candidates;
    const nextUtil = new Float64Array(capUnits + 1);
    nextUtil.fill(-1);
    const nextCost = new Int32Array(capUnits + 1);
    const choiceRow = new Int16Array(capUnits + 1);
    choiceRow.fill(-1);

    for (let u = 0; u <= capUnits; u++) {
      if (dpUtil[u] < 0) continue;
      for (let k = 0; k < candidates.length; k++) {
        const cand = candidates[k];
        const exactCost = dpExactCost[u] + cand.costCop;
        if (exactCost > budgetCop) continue;
        const nextU = Math.min(capUnits, Math.floor(exactCost / step));
        const nextUtility = dpUtil[u] + cand.utility;

        const betterUtility = nextUtility > nextUtil[nextU] + 1e-9;
        const equalUtilCheaper =
          Math.abs(nextUtility - nextUtil[nextU]) <= 1e-9 &&
          (nextUtil[nextU] < 0 || exactCost < nextCost[nextU]);

        if (betterUtility || equalUtilCheaper) {
          nextUtil[nextU] = nextUtility;
          nextCost[nextU] = exactCost;
          choiceRow[nextU] = k;
        }
      }
    }

    dpUtil = nextUtil;
    dpExactCost = nextCost;
    backptr.push(choiceRow);
  }

  let bestU = -1;
  let bestUtil = -1;
  let bestCost = Number.MAX_SAFE_INTEGER;
  for (let u = 0; u <= capUnits; u++) {
    if (dpUtil[u] < 0) continue;
    const betterU = dpUtil[u] > bestUtil + 1e-9;
    const tiedCheaper = Math.abs(dpUtil[u] - bestUtil) <= 1e-9 && dpExactCost[u] < bestCost;
    if (betterU || tiedCheaper) {
      bestUtil = dpUtil[u];
      bestCost = dpExactCost[u];
      bestU = u;
    }
  }

  if (bestU < 0) {
    // Discretización marginal: caer al mínimo posible verificando presupuesto exacto
    const minChoices: Record<string, BudgetCandidate> = {};
    let util = 0;
    for (const p of nonEmptyPools) {
      const cheapest = p.candidates[0];
      minChoices[p.itemKey] = cheapest;
      util += cheapest.utility;
    }
    return {
      feasible: minimumPossibleCop <= budgetCop,
      totalCostCop: minimumPossibleCop,
      utilityScore: Number(util.toFixed(4)),
      minimumPossibleCop,
      chosenByKey: minChoices,
    };
  }

  // Reconstrucción hacia atrás por costo exacto acumulado
  const chosenByKey: Record<string, BudgetCandidate> = {};
  let remBudget = bestCost;
  for (let row = nonEmptyPools.length - 1; row >= 0; row--) {
    const u = Math.min(capUnits, Math.floor(remBudget / step));
    const k = backptr[row][u];
    const cand = nonEmptyPools[row].candidates[k >= 0 ? k : 0];
    chosenByKey[nonEmptyPools[row].itemKey] = cand;
    remBudget = Math.max(0, remBudget - cand.costCop);
  }

  return {
    feasible: true,
    totalCostCop: bestCost,
    utilityScore: Number(bestUtil.toFixed(4)),
    minimumPossibleCop,
    chosenByKey,
  };
}

export function optimizeBasketWithinBudget(params: {
  items: BasketItemInput[];
  offers: StoreOffer[];
  nearbyBranches: NearbyStoreBranch[];
  budgetCop: number;
  mode: "my_brands" | "generic";
  lockedItemKeys?: Set<string>;
  dietFilters?: DietFilter[];
  minSabioIndex?: number;
  optimizeOptions?: BasketOptimizeOptions;
  samePlantIndex?: SamePlantIndex;
  sabiometroMap?: Map<string, SabiometroSummary>;
}): BudgetOptimizationResult & { optimizationResult: BasketOptimizationResult } {
  const {
    items,
    offers,
    nearbyBranches,
    budgetCop,
    mode,
    lockedItemKeys = new Set<string>(),
    dietFilters = [],
    minSabioIndex,
    optimizeOptions,
    samePlantIndex,
    sabiometroMap,
  } = params;

  const maxDist = optimizeOptions?.maxDistanceMeters;
  const sortedBranches = [...nearbyBranches].sort((a, b) => a.distanceMeters - b.distanceMeters);
  const minBranchDist = sortedBranches[0]?.distanceMeters ?? 0;
  const effectiveRadius =
    maxDist !== undefined ? Math.max(maxDist, minBranchDist) : undefined;
  const eligibleStores = new Set(
    (effectiveRadius !== undefined
      ? sortedBranches.filter((b) => b.distanceMeters <= effectiveRadius + 1)
      : sortedBranches
    ).map((b) => b.storeId),
  );
  const eligibleOffers = offers.filter((o) => o.inStock && eligibleStores.has(o.storeId));

  const pools = items.map((item) => {
    const locked = Boolean(item.locked || lockedItemKeys.has(item.itemKey));
    return {
      item,
      locked,
      itemKey: item.itemKey,
      candidates: buildBudgetCandidatePool({
        item,
        offers: eligibleOffers,
        mode,
        locked,
        dietFilters,
        minSabioIndex,
      }),
    };
  });

  // Etapa A + B iterada hasta cumplir techo de presupuesto con el límite de tiendas
  let targetBudget = budgetCop;
  let finalKnapsack = solveMultipleChoiceKnapsack({
    pools: pools.map((p) => ({ itemKey: p.itemKey, candidates: p.candidates })),
    budgetCop: targetBudget,
  });
  let finalOptResult: BasketOptimizationResult | null = null;

  for (let iter = 0; iter < 4; iter++) {
    const pinnedItems: BasketItemInput[] = items.map((item) => {
      const chosen = finalKnapsack.chosenByKey[item.itemKey];
      if (!chosen) return item;
      return {
        ...item,
        masterProductId: chosen.offer.masterProductId,
        anchorStoreSkuId: chosen.offer.storeSkuId,
        ean: chosen.offer.ean,
        targetNetContent: chosen.offer.netContent,
        targetUnitMeasure: chosen.offer.unitMeasure,
        allowSubstitutes: false,
      };
    });

    const optRes = optimizeBasket({
      items: pinnedItems,
      offers: eligibleOffers,
      nearbyBranches,
      options: {
        ...optimizeOptions,
        activeDietFilters: dietFilters,
        minSabioIndex,
      },
    });
    finalOptResult = optRes;

    const actualCost = optRes.recommendedPlan?.totalNominalCost ?? finalKnapsack.totalCostCop;
    if (!finalKnapsack.feasible || actualCost <= budgetCop) {
      break;
    }
    const overshoot = actualCost - budgetCop;
    targetBudget = Math.max(0, targetBudget - overshoot);
    finalKnapsack = solveMultipleChoiceKnapsack({
      pools: pools.map((p) => ({ itemKey: p.itemKey, candidates: p.candidates })),
      budgetCop: targetBudget,
    });
  }

  const chosenOffersRecord: Record<string, StoreOffer> = {};
  for (const [k, c] of Object.entries(finalKnapsack.chosenByKey)) {
    chosenOffersRecord[k] = c.offer;
  }

  const blockingLocks: Array<{ itemKey: string; label: string; unlockSavingsCop: number }> = [];
  if (!finalKnapsack.feasible) {
    for (const pool of pools) {
      if (!pool.locked) continue;
      const unlockedPool = buildBudgetCandidatePool({
        item: pool.item,
        offers: eligibleOffers,
        mode: "generic",
        locked: false,
        dietFilters,
        minSabioIndex,
      });
      const currentCost = pool.candidates[0]?.costCop ?? 0;
      const lowestUnlocked = unlockedPool[0]?.costCop ?? currentCost;
      const unlockSavingsCop = Math.max(0, currentCost - lowestUnlocked);
      if (unlockSavingsCop > 0) {
        blockingLocks.push({
          itemKey: pool.itemKey,
          label: pool.item.label,
          unlockSavingsCop,
        });
      }
    }
    blockingLocks.sort((a, b) => b.unlockSavingsCop - a.unlockSavingsCop);
  }

  const plan = finalOptResult?.recommendedPlan ?? null;
  const swaps = plan
    ? buildHabitualSwaps({
        plan,
        items,
        knownOffers: offers,
        lockedItemKeys,
        samePlantIndex,
        sabiometroMap,
      }).swaps
    : [];

  const totalCop = plan?.totalNominalCost ?? finalKnapsack.totalCostCop;
  const feasible = finalKnapsack.feasible && totalCop <= budgetCop;

  return {
    feasible,
    totalCop: Math.round(totalCop),
    budgetCop: Math.round(budgetCop),
    minimumPossibleCop: finalKnapsack.minimumPossibleCop,
    utilityScore: finalKnapsack.utilityScore,
    mode,
    selectedCandidates: chosenOffersRecord,
    swaps,
    blockingLocks: blockingLocks.slice(0, 3),
    optimizationResult:
      finalOptResult ??
      optimizeBasket({ items, offers: eligibleOffers, nearbyBranches, options: optimizeOptions }),
  };
}
