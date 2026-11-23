import { buildWeeklyPaymentCalendar, WEEKDAYS_ES } from "./paymentAdvisor.ts";
import type { PaymentPromotion, StorePromoDay, UserPaymentMethod } from "./types.ts";

export interface PromoScheduleAlertCandidate {
  dedupeKey: string;
  storeId: string;
  storeName: string;
  dayOfWeek: number;
  dayLabel: string;
  title: string;
  body: string;
  savingsCop: number;
  savingsPct: number;
}

/**
 * Genera alertas de día promocional cuando el ahorro estimado alcanza >= $5.000 o >= 4 %.
 */
export function findUpcomingPromoAlerts(params: {
  storeSubtotals: Array<{ storeId: string; storeName: string; subtotalCop: number }>;
  userPaymentMethods: UserPaymentMethod[];
  promotions: PaymentPromotion[];
  storePromoDays?: StorePromoDay[];
  today?: Date;
}): PromoScheduleAlertCandidate[] {
  const today = params.today ?? new Date();
  const baseTotal = params.storeSubtotals.reduce((acc, s) => acc + s.subtotalCop, 0);
  const calendar = buildWeeklyPaymentCalendar({
    ...params,
    now: today,
  });

  const alerts: PromoScheduleAlertCandidate[] = [];
  for (const row of calendar.matrix) {
    for (const cell of row.cells) {
      const pct = baseTotal > 0 ? (cell.discountCop / baseTotal) * 100 : 0;
      if (cell.discountCop < 5000 && pct < 4) continue;

      const dayDiff = (row.dayOfWeek - today.getDay() + 7) % 7;
      const targetDate = new Date(today.getTime() + dayDiff * 86_400_000);
      const isoDate = targetDate.toISOString().slice(0, 10);

      alerts.push({
        dedupeKey: `promo:${cell.storeId}:${isoDate}`,
        storeId: cell.storeId,
        storeName: cell.storeName,
        dayOfWeek: row.dayOfWeek,
        dayLabel: WEEKDAYS_ES[row.dayOfWeek],
        title: `${WEEKDAYS_ES[row.dayOfWeek]} de ahorro en ${cell.storeName}`,
        body: cell.promoLabel
          ? `${cell.promoLabel}. Te ahorras ~${cell.discountCop.toLocaleString("es-CO")} COP pagando ese día.`
          : `Aprovecha descuento con ${cell.partnerName ?? "medio de pago aliado"}.`,
        savingsCop: cell.discountCop,
        savingsPct: Number(pct.toFixed(1)),
      });
    }
  }

  return alerts.sort((a, b) => b.savingsCop - a.savingsCop);
}
