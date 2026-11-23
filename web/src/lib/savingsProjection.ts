import { formatCop } from "./formatters.ts";
import type { SavingsProjection, ShoppingCadence } from "./types.ts";

export const TRIPS_PER_MONTH_BY_CADENCE: Record<ShoppingCadence, number> = {
  daily: 30,
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
};

function roundTo100(value: number): number {
  return Math.round(value / 100) * 100;
}

/**
 * Etiqueta humana para los mercados optimizados gratis equivalentes al año.
 */
export function freeMarketsLabel(freeMarkets: number): string {
  if (!Number.isFinite(freeMarkets) || freeMarkets <= 0) {
    return "0 mercados optimizados gratis al año";
  }
  if (freeMarkets < 0.9) {
    return "casi 1 mercado optimizado gratis al año";
  }
  const whole = Math.floor(freeMarkets);
  const frac = freeMarkets - whole;
  if (frac >= 0.7) {
    return `casi ${whole + 1} mercados optimizados gratis al año`;
  }
  if (frac <= 0.3) {
    return whole === 1
      ? "1 mercado optimizado gratis al año"
      : `${whole} mercados optimizados gratis al año`;
  }
  return whole === 1
    ? "más de 1 mercado optimizado gratis al año"
    : `más de ${whole} mercados optimizados gratis al año`;
}

/**
 * Modificación del usuario (#4): la proyección de "mercados gratis al año"
 * SIEMPRE se divide entre el total del mercado OPTIMIZADO (`optimizedBasketTotalCop`).
 */
export function projectSavings(params: {
  savingsPerTripCop: number;
  optimizedBasketTotalCop: number;
  cadence: ShoppingCadence;
}): SavingsProjection {
  const safeSavings = Math.max(0, Number.isFinite(params.savingsPerTripCop) ? params.savingsPerTripCop : 0);
  const safeOptimized = Math.max(
    0,
    Number.isFinite(params.optimizedBasketTotalCop) ? params.optimizedBasketTotalCop : 0,
  );
  const tripsPerMonth = TRIPS_PER_MONTH_BY_CADENCE[params.cadence] ?? 2.17;

  const monthlySavingsCop = roundTo100(safeSavings * tripsPerMonth);
  const yearlySavingsCop = monthlySavingsCop * 12;
  const freeMarketsPerYear =
    safeOptimized > 0 ? Number((yearlySavingsCop / safeOptimized).toFixed(2)) : 0;
  const label = freeMarketsLabel(freeMarketsPerYear);

  const headline = `Con los cambios de esta lista ahorras ${formatCop(monthlySavingsCop)} al mes; al año son ${formatCop(yearlySavingsCop)} (${label})`;

  return {
    savingsPerTripCop: Math.round(safeSavings),
    optimizedBasketTotalCop: Math.round(safeOptimized),
    cadence: params.cadence,
    tripsPerMonth,
    monthlySavingsCop,
    yearlySavingsCop,
    freeMarketsPerYear,
    label,
    headline,
  };
}
