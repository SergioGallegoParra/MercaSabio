import type { BasketItemInput } from "./basketOptimizer.ts";
import { optimizeBasketWithinBudget } from "./budgetOptimizer.ts";
import type {
  DietFilter,
  InflationLineItem,
  InflationReport,
  NearbyStoreBranch,
  StoreOffer,
} from "./types.ts";

export interface HistoricalPricePair {
  masterProductId: string;
  priceACop: number | null;
  priceBCop: number | null;
}

/**
 * Calcula el Termómetro de Inflación Personal comparando los productos habituales en dos fechas
 * y propone 2 a 3 sustituciones puntuales de contención para volver al gasto del mes anterior.
 */
export function buildPersonalInflationReport(params: {
  dateA: string;
  dateB: string;
  items: BasketItemInput[];
  priceHistoryByMaster: Map<string, HistoricalPricePair>;
  offers: StoreOffer[];
  nearbyBranches: NearbyStoreBranch[];
  dietFilters?: DietFilter[];
  foodIpcReferencePct?: number;
}): InflationReport {
  const {
    dateA,
    dateB,
    items,
    priceHistoryByMaster,
    offers,
    nearbyBranches,
    dietFilters = [],
    foodIpcReferencePct = 4.2,
  } = params;

  const lines: InflationLineItem[] = [];
  const deltaByFamily = new Map<string, number>();
  let totalACop = 0;
  let totalBCop = 0;
  let missingCount = 0;

  for (const item of items) {
    const masterId = item.masterProductId ?? null;
    const hist = masterId ? priceHistoryByMaster.get(masterId) : null;
    if (!hist || !hist.priceACop || !hist.priceBCop || hist.priceACop <= 0 || hist.priceBCop <= 0) {
      missingCount += 1;
      continue;
    }

    const qty = Math.max(1, item.quantity ?? 1);
    const lineA = Math.round(hist.priceACop * qty);
    const lineB = Math.round(hist.priceBCop * qty);
    const deltaCop = lineB - lineA;
    const deltaPct = lineA > 0 ? Number(((deltaCop / lineA) * 100).toFixed(1)) : 0;

    totalACop += lineA;
    totalBCop += lineB;

    const familyLabel = item.familyLabel ?? item.label;
    deltaByFamily.set(familyLabel, (deltaByFamily.get(familyLabel) ?? 0) + deltaCop);

    lines.push({
      masterProductId: masterId!,
      title: item.habitualProductTitle ?? item.label,
      familyLabel,
      quantity: qty,
      priceACop: lineA,
      priceBCop: lineB,
      deltaCop,
      deltaPct,
    });
  }

  lines.sort((a, b) => Math.abs(b.deltaCop) - Math.abs(a.deltaCop));

  const topCauses = [...deltaByFamily.entries()]
    .filter(([, delta]) => delta !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .map(([familyLabel, deltaCop]) => ({ familyLabel, deltaCop }));

  const deltaCop = totalBCop - totalACop;
  const deltaPct = totalACop > 0 ? Number(((deltaCop / totalACop) * 100).toFixed(1)) : 0;

  // Plan de contención: si la canasta subió, buscar hasta 3 sustituciones sin marca hacia totalACop
  let containmentSwaps: InflationReport["containmentSwaps"] = [];
  let containmentSavingsCop = 0;

  if (deltaCop > 0 && totalACop > 0 && offers.length > 0 && nearbyBranches.length > 0) {
    const containment = optimizeBasketWithinBudget({
      items,
      offers,
      nearbyBranches,
      budgetCop: totalACop,
      mode: "generic",
      dietFilters,
    });
    containmentSwaps = containment.swaps.slice(0, 3);
    containmentSavingsCop = containmentSwaps.reduce((acc, s) => acc + s.savingsCop, 0);
  }

  return {
    dateA,
    dateB,
    totalACop,
    totalBCop,
    deltaCop,
    deltaPct,
    foodIpcReferencePct,
    missingCount,
    topCauses,
    lines,
    containmentSwaps,
    containmentSavingsCop,
  };
}
