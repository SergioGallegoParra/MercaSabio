import { extractProductSignature } from "./comparisonEngine.ts";
import { PER_CAPITA_MONTHLY_ESTIMATE } from "./householdReport.ts";
import type { ReplenishmentAlert, StoreOffer, StorePromoDay } from "./types.ts";

export interface PurchaseEventRecord {
  masterProductId?: string | null;
  familyKey: string;
  productTitle?: string | null;
  quantity: number;
  netContent?: number | null;
  purchasedAt: string;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function getIsoWeekStamp(date: Date): string {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((copy.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Estima cuándo se agota cada familia comprada a partir del intervalo mediano real
 * (o consumo per cápita de respaldo) y adelanta alertas cuando hay promoción activa.
 */
export function buildReplenishmentAlerts(params: {
  events: PurchaseEventRecord[];
  offers: StoreOffer[];
  storePromoDays?: StorePromoDay[];
  adults: number;
  children: number;
  now?: Date;
}): ReplenishmentAlert[] {
  const { events, offers, storePromoDays = [], adults, children, now = new Date() } = params;
  const weekStamp = getIsoWeekStamp(now);

  const byFamily = new Map<string, PurchaseEventRecord[]>();
  for (const ev of events) {
    if (!ev.familyKey) continue;
    const list = byFamily.get(ev.familyKey) ?? [];
    list.push(ev);
    byFamily.set(ev.familyKey, list);
  }

  const alerts: ReplenishmentAlert[] = [];

  for (const [familyKey, famEvents] of byFamily.entries()) {
    const sorted = [...famEvents].sort(
      (a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime(),
    );
    const latest = sorted[sorted.length - 1];
    if (!latest) continue;

    let typicalDays = 21;
    if (sorted.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const diffDays =
          (new Date(sorted[i].purchasedAt).getTime() -
            new Date(sorted[i - 1].purchasedAt).getTime()) /
          86_400_000;
        if (diffDays >= 1) {
          intervals.push(diffDays);
        }
      }
      if (intervals.length > 0) {
        typicalDays = Math.max(3, Math.round(computeMedian(intervals)));
      }
    } else {
      const famMeta = PER_CAPITA_MONTHLY_ESTIMATE[familyKey];
      const monthlyNeed = famMeta
        ? adults * famMeta.adultQty + children * famMeta.childQty
        : 0;
      const content = (latest.netContent ?? 1000) * Math.max(1, latest.quantity);
      if (monthlyNeed > 0 && content > 0) {
        typicalDays = Math.max(3, Math.min(60, Math.round((content / monthlyNeed) * 30)));
      }
    }

    const elapsedDays = Math.max(
      0,
      (now.getTime() - new Date(latest.purchasedAt).getTime()) / 86_400_000,
    );
    const remainingDays = Math.max(0, Math.round(typicalDays - elapsedDays));
    const urgencyRatio = typicalDays > 0 ? elapsedDays / typicalDays : 0;

    // Buscar oferta sugerida más barata para la familia y revisar si hay promoción activa o en próximos 5 días
    const matchingOffers = offers
      .filter((o) => {
        if (!o.inStock || o.calibratedPrice <= 0) return false;
        const sig = extractProductSignature(o);
        return sig.subtypeFamily === familyKey;
      })
      .sort((a, b) => a.pumPrice - b.pumPrice);
    const bestOffer = matchingOffers[0];

    const matchingPromo = storePromoDays.find((p) => p.active && bestOffer && p.storeId === bestOffer.storeId);
    const priceDropPromo =
      bestOffer && bestOffer.rawListPrice > bestOffer.calibratedPrice * 1.08
        ? Math.round(((bestOffer.rawListPrice - bestOffer.calibratedPrice) / bestOffer.rawListPrice) * 100)
        : 0;

    const hasPromo = Boolean(matchingPromo || priceDropPromo >= 8);
    if (urgencyRatio < 0.8 && !(urgencyRatio >= 0.65 && hasPromo)) {
      continue;
    }

    const label = latest.productTitle ?? familyKey.replace(/_/g, " ");
    const promoText =
      priceDropPromo >= 8 && bestOffer
        ? `Hoy está ${priceDropPromo} % más económico en ${bestOffer.storeName}`
        : matchingPromo
          ? `${matchingPromo.label} (${matchingPromo.discountPct ?? 15} % referencial)`
          : null;

    const message =
      remainingDays === 0
        ? `Es buen momento para reponer ${label}${promoText ? `: ${promoText}` : ""}.`
        : `Tu ${label} se acaba en ~${remainingDays} días${promoText ? ` y ${promoText.toLowerCase()}` : ""}.`;

    alerts.push({
      familyKey,
      label,
      estimatedDaysRemaining: remainingDays,
      urgencyRatio: Number(urgencyRatio.toFixed(2)),
      hasActivePromo: hasPromo,
      promoText,
      suggestedOffer: bestOffer,
      dedupeKey: `replenish:${familyKey}:${weekStamp}`,
      message,
    });
  }

  return alerts.sort((a, b) => b.urgencyRatio - a.urgencyRatio);
}
