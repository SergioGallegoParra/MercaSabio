import type {
  PaymentPromotion,
  StorePromoDay,
  UserPaymentMethod,
  WeeklyShoppingPlan,
} from "./types.ts";

export const WEEKDAYS_ES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

export function isPromoVerificationStale(lastVerifiedAt?: string | null, now = new Date()): boolean {
  if (!lastVerifiedAt) return true;
  const diffDays = (now.getTime() - new Date(lastVerifiedAt).getTime()) / 86_400_000;
  return diffDays > 35;
}

export function computePromotionDiscountCop(params: {
  promo: PaymentPromotion;
  subtotalCop: number;
}): number {
  const { promo, subtotalCop } = params;
  if (!promo.active || subtotalCop <= 0) return 0;
  if (promo.minPurchaseCop && subtotalCop < promo.minPurchaseCop) return 0;

  let discount = 0;
  if (promo.discountType === "pct" || promo.discountType === "cashback_pct") {
    discount = subtotalCop * (promo.discountValue / 100);
  } else if (promo.discountType === "fixed_cop") {
    discount = promo.discountValue;
  }

  if (promo.maxDiscountCop && promo.maxDiscountCop > 0) {
    discount = Math.min(discount, promo.maxDiscountCop);
  }
  return Math.max(0, Math.round(discount));
}

export function computeDayDiscountForStore(params: {
  storeId: string;
  subtotalCop: number;
  dayOfWeek: number;
  userPaymentMethods: UserPaymentMethod[];
  promotions: PaymentPromotion[];
  storePromoDays?: StorePromoDay[];
  now?: Date;
}): {
  discountCop: number;
  partnerName: string | null;
  promoLabel: string | null;
  staleVerification: boolean;
} {
  const {
    storeId,
    subtotalCop,
    dayOfWeek,
    userPaymentMethods,
    promotions,
    storePromoDays = [],
    now = new Date(),
  } = params;

  const ownedPartners = new Set(userPaymentMethods.map((m) => m.partnerId));
  let bestDiscount = 0;
  let bestPartner: string | null = null;
  let bestLabel: string | null = null;
  let stale = false;

  for (const promo of promotions) {
    if (!promo.active) continue;
    if (promo.storeId && promo.storeId !== storeId) continue;
    if (!promo.validDays.includes(dayOfWeek)) continue;
    if (ownedPartners.size > 0 && !ownedPartners.has(promo.partnerId)) continue;

    const amount = computePromotionDiscountCop({ promo, subtotalCop });
    if (amount > bestDiscount) {
      bestDiscount = amount;
      bestPartner = promo.partnerName ?? promo.partnerId;
      bestLabel = promo.termsShort ?? `${promo.discountValue}%`;
      stale = isPromoVerificationStale(promo.lastVerifiedAt, now);
    }
  }

  // Suma referencial de día temático de la cadena (ej. Martes de frutas) si aplica cuando no hay promo de banco mayor
  const chainDay = storePromoDays.find(
    (spd) => spd.active && spd.storeId === storeId && spd.validDays.includes(dayOfWeek),
  );
  if (chainDay && chainDay.discountPct && bestDiscount === 0) {
    bestDiscount = Math.round(subtotalCop * 0.3 * (chainDay.discountPct / 100));
    bestLabel = chainDay.label;
  }

  return {
    discountCop: bestDiscount,
    partnerName: bestPartner,
    promoLabel: bestLabel,
    staleVerification: stale,
  };
}

/** Construye la matriz semanal 7 días × cadenas preferidas del usuario. */
export function buildWeeklyPaymentCalendar(params: {
  storeSubtotals: Array<{ storeId: string; storeName: string; subtotalCop: number }>;
  userPaymentMethods: UserPaymentMethod[];
  promotions: PaymentPromotion[];
  storePromoDays?: StorePromoDay[];
  now?: Date;
}): WeeklyShoppingPlan {
  const {
    storeSubtotals,
    userPaymentMethods,
    promotions,
    storePromoDays = [],
    now = new Date(),
  } = params;

  const baseTotal = storeSubtotals.reduce((acc, s) => acc + s.subtotalCop, 0);
  const matrix: WeeklyShoppingPlan["matrix"] = [];

  let bestDayOfWeek = 2;
  let bestDaySavings = -1;
  let bestChainCombo = "";

  // Orden lunes (1)..domingo (0) para la vista semanal colombiana
  const orderedDays = [1, 2, 3, 4, 5, 6, 0];

  for (const dayOfWeek of orderedDays) {
    let dayDiscountTotal = 0;
    const winningLabels: string[] = [];

    const cells = storeSubtotals.map((store) => {
      const res = computeDayDiscountForStore({
        storeId: store.storeId,
        subtotalCop: store.subtotalCop,
        dayOfWeek,
        userPaymentMethods,
        promotions,
        storePromoDays,
        now,
      });
      dayDiscountTotal += res.discountCop;
      if (res.discountCop > 0 && res.partnerName) {
        winningLabels.push(`${store.storeName} (${res.partnerName})`);
      }
      return {
        storeId: store.storeId,
        storeName: store.storeName,
        partnerName: res.partnerName,
        promoLabel: res.promoLabel,
        discountCop: res.discountCop,
        estimatedTotalCop: Math.max(0, store.subtotalCop - res.discountCop),
        staleVerification: res.staleVerification,
      };
    });

    if (dayDiscountTotal > bestDaySavings) {
      bestDaySavings = dayDiscountTotal;
      bestDayOfWeek = dayOfWeek;
      bestChainCombo =
        winningLabels.length > 0
          ? `${WEEKDAYS_ES[dayOfWeek]}: ${winningLabels.join(" + ")}`
          : `${WEEKDAYS_ES[dayOfWeek]}: ruta habitual sin recargo`;
    }

    matrix.push({
      dayOfWeek,
      dayLabel: WEEKDAYS_ES[dayOfWeek],
      cells,
    });
  }

  return {
    bestDayOfWeek,
    bestDayLabel: WEEKDAYS_ES[bestDayOfWeek],
    bestChainCombo,
    projectedTotalCop: Math.max(0, baseTotal - Math.max(0, bestDaySavings)),
    paymentDiscountCop: Math.max(0, bestDaySavings),
    matrix,
  };
}
