import type { BasketItemInput } from "./basketOptimizer.ts";
import { formatCop } from "./formatters.ts";
import type { ShoppingCadence } from "./types.ts";

export interface SpendingRecommendation {
  id: string;
  title: string;
  body: string;
  estimatedMonthlySavingsCop: number;
  actionKind: "open_budget" | "split_pantry" | "shift_hard_discount" | "positive_reinforcement";
}

const PREMIUM_CHAINS = new Set(["carulla", "jumbo"]);

export function analyzeSpendingHabits(params: {
  declaredMonthlyBudgetCop: number | null;
  actualMonthlySpendCop: number;
  previousMonthSpendCop?: number | null;
  cadence: ShoppingCadence;
  items: BasketItemInput[];
  premiumChainSpendSharePct?: number;
}): SpendingRecommendation[] {
  const recs: SpendingRecommendation[] = [];
  const {
    declaredMonthlyBudgetCop,
    actualMonthlySpendCop,
    previousMonthSpendCop,
    cadence,
    items,
    premiumChainSpendSharePct,
  } = params;

  if (
    declaredMonthlyBudgetCop &&
    declaredMonthlyBudgetCop > 0 &&
    actualMonthlySpendCop > declaredMonthlyBudgetCop
  ) {
    const excess = Math.round(actualMonthlySpendCop - declaredMonthlyBudgetCop);
    recs.push({
      id: "over_budget",
      title: "Tu gasto mensual supera tu meta",
      body: `Estás gastando ${formatCop(excess)} por encima de tu presupuesto mensual. Ajusta la canasta con candados para volver a la meta sin sacrificar tus esenciales.`,
      estimatedMonthlySavingsCop: excess,
      actionKind: "open_budget",
    });
  }

  const nonPerishables = items.filter((i) => i.sectionId !== "nevera").length;
  const nonPerishableRatio = items.length > 0 ? nonPerishables / items.length : 0;
  if ((cadence === "weekly" || cadence === "daily") && nonPerishableRatio > 0.4) {
    recs.push({
      id: "split_pantry_fresh",
      title: "Separa alacena mensual y frescos semanales",
      body: "Más del 40 % de tu lista no es perecedera. Comprar despensa y aseo 1 vez al mes en formato grande y frescos por semana reduce viajes y PUM.",
      estimatedMonthlySavingsCop: 18000,
      actionKind: "split_pantry",
    });
  }

  const premiumItems = items.filter((i) => {
    const skuStore = Object.keys(i.preferredSkuByStore ?? {})[0];
    return skuStore && PREMIUM_CHAINS.has(skuStore);
  }).length;
  const computedPremiumShare =
    premiumChainSpendSharePct ?? (items.length > 0 ? (premiumItems / items.length) * 100 : 0);

  if (computedPremiumShare > 30 && actualMonthlySpendCop > 0) {
    const estSavings = Math.round(actualMonthlySpendCop * 0.12);
    recs.push({
      id: "move_pantry_hard_discount",
      title: "Mueve tu alacena y aseo a formato hard discount",
      body: `Concentras ~${Math.round(computedPremiumShare)} % en cadenas de gama alta. Pasar los productos no perecederos a D1 o Ara te ahorra cerca de ${formatCop(estSavings)} al mes.`,
      estimatedMonthlySavingsCop: estSavings,
      actionKind: "shift_hard_discount",
    });
  }

  if (
    declaredMonthlyBudgetCop &&
    declaredMonthlyBudgetCop > 0 &&
    actualMonthlySpendCop > 0 &&
    actualMonthlySpendCop < declaredMonthlyBudgetCop * 0.8 &&
    previousMonthSpendCop &&
    previousMonthSpendCop < declaredMonthlyBudgetCop * 0.8
  ) {
    recs.push({
      id: "positive_margin",
      title: "¡Vas por debajo de tu presupuesto 2 meses seguidos!",
      body: "Mantienes tu mercado en menos del 80 % de tu tope. Puedes ahorrar la diferencia o subir un nivel de calidad en tus proteínas.",
      estimatedMonthlySavingsCop: Math.round(declaredMonthlyBudgetCop - actualMonthlySpendCop),
      actionKind: "positive_reinforcement",
    });
  }

  return recs;
}
