import type { BankPromotion, StoreOffer } from "@/lib/types";

export interface SteamBadge {
  label: string;
  tone: "steam-high" | "steam-mid" | "steam-mixed" | "steam-low" | "steam-none";
  positivePct: number | null;
}

export interface RealUsageMetrics {
  avgYieldFactor: number;
  nominalPrice: number;
  realUsagePrice: number;
  nominalPum: number;
  realAdjustedPum: number;
  yieldLabel: string | null;
}

export interface EvaluatedBankPromotion {
  promo: BankPromotion;
  discountedPrice: number;
  savingsCop: number;
}

/**
 * Clasifica la reputación binaria estilo Steam según `positive_votes / total_votes`.
 */
export function getSteamRatingBadge(positiveVotes: number, totalVotes: number): SteamBadge {
  if (totalVotes <= 0) {
    return { label: "Sin reseñas aún", tone: "steam-none", positivePct: null };
  }
  const pct = Math.round((positiveVotes / totalVotes) * 100);
  if (pct >= 95 && totalVotes >= 20) {
    return { label: "Extremadamente positivo", tone: "steam-high", positivePct: pct };
  }
  if (pct >= 80) {
    return { label: "Muy positivo", tone: "steam-high", positivePct: pct };
  }
  if (pct >= 70) {
    return { label: "Mayormente positivo", tone: "steam-mid", positivePct: pct };
  }
  if (pct >= 40) {
    return { label: "Variado", tone: "steam-mixed", positivePct: pct };
  }
  return { label: "Mayormente negativo", tone: "steam-low", positivePct: pct };
}

/**
 * Calcula PUM Real Ajustado y Costo Real por Uso multiplicando por `avg_yield_factor`.
 */
export function computeRealUsageMetrics(
  calibratedPrice: number,
  pumPrice: number,
  avgYieldFactor: number
): RealUsageMetrics {
  const safeYield = avgYieldFactor > 0 ? avgYieldFactor : 1;
  const realUsagePrice = Math.round(calibratedPrice * safeYield);
  const realAdjustedPum = Number((pumPrice * safeYield).toFixed(4));

  let yieldLabel: string | null = null;
  if (safeYield <= 0.65) {
    yieldLabel = "Rinde el doble · Ahorro invisible";
  } else if (safeYield < 0.98) {
    yieldLabel = "Mayor rendimiento real";
  } else if (safeYield > 1.15) {
    yieldLabel = "Rinde menos por uso";
  }

  return {
    avgYieldFactor: safeYield,
    nominalPrice: calibratedPrice,
    realUsagePrice,
    nominalPum: pumPrice,
    realAdjustedPum,
    yieldLabel,
  };
}

/**
 * Cruza el día actual de la semana (`0..6`) contra `bank_promotions` activas para tienda y categoría.
 */
export function findActiveBankPromotions(
  offer: Pick<StoreOffer, "storeId" | "canonicalCategoryId" | "calibratedPrice">,
  promotions: BankPromotion[],
  dayOfWeek: number = new Date().getDay()
): EvaluatedBankPromotion[] {
  return promotions
    .filter((promo) => {
      if (!promo.active) return false;
      if (!promo.validDays.includes(dayOfWeek)) return false;
      if (promo.storeId && promo.storeId !== offer.storeId) return false;
      if (
        promo.canonicalCategoryId !== null &&
        promo.canonicalCategoryId !== offer.canonicalCategoryId
      ) {
        return false;
      }
      return true;
    })
    .map((promo) => {
      const discountedPrice = Math.max(
        0,
        Math.round(offer.calibratedPrice * (1 - promo.discountPct / 100))
      );
      return {
        promo,
        discountedPrice,
        savingsCop: Math.max(0, Math.round(offer.calibratedPrice - discountedPrice)),
      };
    })
    .sort((a, b) => b.promo.discountPct - a.promo.discountPct);
}

/**
 * Elimina frases repetidas consecutivas frecuentes en catálogos externos y normaliza espacios.
 */
export function cleanProductTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized.replace(/^(.{8,}?)\s+\1$/i, "$1").trim();
}

/**
 * Valida que una URL externa utilice exclusivamente protocolo http: o https:.
 */
export function sanitizeExternalUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "#";
    }
    return parsed.toString();
  } catch {
    return "#";
  }
}

/**
 * Añade atribución de afiliado en URLs externas seguras de supermercados compatibles.
 */
export function buildStoreAffiliateUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "#";
    }
    if (!parsed.searchParams.has("utm_source")) {
      parsed.searchParams.set("utm_source", "mercasabio");
      parsed.searchParams.set("utm_medium", "affiliate");
    }
    return parsed.toString();
  } catch {
    return "#";
  }
}
