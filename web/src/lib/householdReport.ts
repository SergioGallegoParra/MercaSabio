import type { BasketItemInput } from "./basketOptimizer.ts";
import { extractProductSignature } from "./comparisonEngine.ts";
import { formatNetContent } from "./formatters.ts";
import { detectPackTrap } from "./packTrap.ts";
import { getTransportProfile } from "./transport.ts";
import type {
  HouseholdReport,
  HouseholdReportItem,
  StoreOffer,
  TransportMode,
  UnitMeasure,
} from "./types.ts";

/** Consumo mensual estimado por adulto equivalente para despensa colombiana. */
export const PER_CAPITA_MONTHLY_ESTIMATE: Record<
  string,
  { adultQty: number; childQty: number; unit: UnitMeasure; shelfLifeDays: number; perishable: boolean }
> = {
  arroz_blanco: { adultQty: 1800, childQty: 1000, unit: "g", shelfLifeDays: 365, perishable: false },
  arroz_integral: { adultQty: 1500, childQty: 800, unit: "g", shelfLifeDays: 270, perishable: false },
  aceite_cocina: { adultQty: 750, childQty: 400, unit: "ml", shelfLifeDays: 365, perishable: false },
  papel_higienico: { adultQty: 4, childQty: 3, unit: "und", shelfLifeDays: 999, perishable: false },
  detergente_ropa: { adultQty: 750, childQty: 500, unit: "g", shelfLifeDays: 730, perishable: false },
  cafe_molido: { adultQty: 350, childQty: 0, unit: "g", shelfLifeDays: 270, perishable: false },
  pasta_seca: { adultQty: 600, childQty: 450, unit: "g", shelfLifeDays: 540, perishable: false },
  huevos_gallina: { adultQty: 20, childQty: 18, unit: "und", shelfLifeDays: 21, perishable: true },
  leche_entera: { adultQty: 6000, childQty: 8000, unit: "ml", shelfLifeDays: 14, perishable: true },
  leche_deslactosada: { adultQty: 6000, childQty: 8000, unit: "ml", shelfLifeDays: 14, perishable: true },
  queso_fresco: { adultQty: 500, childQty: 400, unit: "g", shelfLifeDays: 12, perishable: true },
  pan_sin_gluten: { adultQty: 500, childQty: 400, unit: "g", shelfLifeDays: 10, perishable: true },
};

/**
 * Genera el informe "Compra grande vs compra frecuente" según tamaño del hogar,
 * validando siempre vida útil en perecederos y pasando formatos grandes por el detector de PUM invertido.
 */
export function buildHouseholdReport(params: {
  adults: number;
  children: number;
  items: BasketItemInput[];
  offers: StoreOffer[];
  transportMode?: TransportMode;
  tripOverheadCop?: number;
}): HouseholdReport {
  const adults = Math.max(0, params.adults);
  const children = Math.max(0, params.children);
  const householdEquivalent = Number((adults + children * 0.7).toFixed(1));
  const profile = getTransportProfile(params.transportMode);
  const singleTripCostCop = params.tripOverheadCop ?? (profile.costPerTripCop > 0 ? profile.costPerTripCop : 1800);

  const reportItems: HouseholdReportItem[] = [];
  const skippedPerishableFamilies: string[] = [];

  for (const item of params.items) {
    const familyKey = item.subtypeFamily ?? "";
    const meta = PER_CAPITA_MONTHLY_ESTIMATE[familyKey];
    const minReasonableSize = item.targetUnitMeasure === "und" ? 2 : 120;
    const rawFamilyOffers = params.offers.filter((o) => {
      if (!o.inStock || o.calibratedPrice <= 0 || o.netContent <= 0 || o.pumPrice <= 0) return false;
      const sig = extractProductSignature(o);
      return (
        sig.subtypeFamily === familyKey &&
        (!item.targetUnitMeasure || sig.effectiveUnitMeasure === item.targetUnitMeasure)
      );
    });

    const filteredStandard = rawFamilyOffers.filter((o) => o.netContent >= minReasonableSize);
    const familyOffers = filteredStandard.length >= 2 ? filteredStandard : rawFamilyOffers;

    if (familyOffers.length < 2) continue;

    const sortedBySize = [...familyOffers].sort((a, b) => a.netContent - b.netContent);
    const targetRefSize = item.targetNetContent ?? sortedBySize[0].netContent;
    const smallRef =
      (item.anchorStoreSkuId
        ? familyOffers.find((o) => o.storeSkuId === item.anchorStoreSkuId)
        : null) ??
      [...sortedBySize].sort(
        (a, b) =>
          Math.abs(a.netContent - targetRefSize) - Math.abs(b.netContent - targetRefSize) ||
          a.netContent - b.netContent
      )[0];

    const largest = sortedBySize[sortedBySize.length - 1];

    if (!smallRef || !largest || largest.netContent <= smallRef.netContent * 1.3) {
      continue;
    }

    const monthlyNeed = meta
      ? adults * meta.adultQty + children * meta.childQty
      : Math.max(smallRef.netContent * 2, Math.min(largest.netContent, smallRef.netContent * 4));

    if (meta?.perishable && monthlyNeed < largest.netContent) {
      skippedPerishableFamilies.push(item.familyLabel ?? item.label);
      continue;
    }

    // Pasar por detector de trampa del empaque grande antes de sugerir formato familiar
    const trap = detectPackTrap(
      { ...item, sizePreference: "large" },
      largest,
      familyOffers,
    );

    const smallTripsPerMonth = Math.min(6, Math.max(1, monthlyNeed / Math.max(1, smallRef.netContent)));
    const monthlyCurrentCostCop = Math.round(smallRef.calibratedPrice * smallTripsPerMonth);

    let chosenBulk = largest;
    let packTrapApplied = false;
    let packNote = "";
    if (trap && trap.combo.length > 0) {
      chosenBulk = trap.combo[0].offer;
      packTrapApplied = true;
      packNote = `Aviso PUM invertido: ${trap.combo[0].units} × ${formatNetContent(chosenBulk.netContent, chosenBulk.unitMeasure)} resulta más barato por unidad que el empaque de ${formatNetContent(largest.netContent, largest.unitMeasure)}.`;
    }

    // El formato familiar solo conviene si mejora el PUM o evita viajes reales dentro de un tope razonable
    const bulkTripsPerMonth = Math.max(0.5, monthlyNeed / Math.max(1, chosenBulk.netContent));
    const tripsAvoided = Number(Math.max(0, smallTripsPerMonth - bulkTripsPerMonth).toFixed(1));
    const bulkProductsCostCop = Math.round(chosenBulk.calibratedPrice * bulkTripsPerMonth);
    const productSavingsCop = monthlyCurrentCostCop - bulkProductsCostCop;

    if (productSavingsCop <= 500) continue;

    reportItems.push({
      itemKey: item.itemKey,
      familyLabel: item.familyLabel ?? item.label,
      currentTitle: `${item.familyLabel ?? item.label} (${formatNetContent(smallRef.netContent, smallRef.unitMeasure)})`,
      recommendedTitle: packTrapApplied
        ? `${formatNetContent(chosenBulk.netContent, chosenBulk.unitMeasure)} × ${trap!.combo[0].units}`
        : `${chosenBulk.brand ?? chosenBulk.storeName} (${formatNetContent(chosenBulk.netContent, chosenBulk.unitMeasure)})`,
      monthlyCurrentCostCop,
      monthlyBulkCostCop: bulkProductsCostCop,
      monthlySavingsCop: Math.round(productSavingsCop),
      tripsAvoidedPerMonth: Math.min(2, Math.floor(tripsAvoided)),
      perishableSkipped: false,
      packTrapApplied,
      note:
        packNote ||
        `Ahorro real por mayor formato: PUM ${Math.round(chosenBulk.pumPrice * 10) / 10}/${chosenBulk.unitMeasure} frente a ${Math.round(smallRef.pumPrice * 10) / 10}/${smallRef.unitMeasure}.`,
    });
  }

  reportItems.sort((a, b) => b.monthlySavingsCop - a.monthlySavingsCop);

  const combinedTripsAvoided =
    reportItems.length > 0
      ? Math.min(4, Math.max(1, ...reportItems.map((r) => r.tripsAvoidedPerMonth)))
      : 0;
  const householdTravelSavings = combinedTripsAvoided * singleTripCostCop;
  const productSavingsSum = reportItems.reduce((acc, r) => acc + r.monthlySavingsCop, 0);

  return {
    householdMembersEquivalent: householdEquivalent,
    adults,
    children,
    totalMonthlySavingsCop: productSavingsSum > 0 ? productSavingsSum + householdTravelSavings : 0,
    totalTripsAvoidedPerMonth: combinedTripsAvoided,
    items: reportItems,
    skippedPerishableFamilies,
  };
}
