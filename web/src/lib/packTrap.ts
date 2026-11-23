import type { BasketItemInput } from "./basketOptimizer.ts";
import { extractProductSignature } from "./comparisonEngine.ts";
import { formatCop, formatNetContent } from "./formatters.ts";
import type { PackTrapFinding, StoreOffer } from "./types.ts";

/**
 * Detector de "Trampa del empaque grande" (PUM invertido):
 * Verifica si k = 2..4 unidades de una presentación menor ofrecen
 * menor PUM equivalente que un empaque familiar/grande (>= 2% y >= $500 de ahorro).
 */
export function detectPackTrap(
  item: BasketItemInput,
  chosen: StoreOffer,
  candidates: StoreOffer[],
  opts?: {
    maxUnits?: number;
    minContentRatio?: number;
    maxContentRatio?: number;
    minSavingsPct?: number;
    minSavingsCop?: number;
  },
): PackTrapFinding | null {
  if (!chosen || chosen.netContent <= 0 || chosen.calibratedPrice <= 0) {
    return null;
  }

  const maxUnits = opts?.maxUnits ?? 4;
  const minRatio = opts?.minContentRatio ?? 0.9;
  const maxRatio = opts?.maxContentRatio ?? 1.25;
  const minSavingsPct = opts?.minSavingsPct ?? 2;
  const minSavingsCop = opts?.minSavingsCop ?? 500;

  const chosenSig = extractProductSignature(chosen);
  const largestContentInCandidates = candidates.reduce(
    (max, o) => (o.unitMeasure === chosen.unitMeasure ? Math.max(max, o.netContent) : max),
    chosen.netContent,
  );

  // Activar si el ítem pidió tamaño grande O si el elegido es >= 85% del mayor empaque de su familia
  const triggersPackCheck =
    item.sizePreference === "large" ||
    (candidates.length > 1 && chosen.netContent >= largestContentInCandidates * 0.85);
  if (!triggersPackCheck) {
    return null;
  }

  const smallCandidates = candidates.filter((cand) => {
    if (cand.storeSkuId === chosen.storeSkuId) return false;
    if (!cand.inStock || cand.calibratedPrice <= 0 || cand.netContent <= 0) return false;
    if (cand.unitMeasure !== chosen.unitMeasure) return false;
    if (cand.netContent >= chosen.netContent * 0.85) return false;

    const candSig = extractProductSignature(cand);
    if (item.allowSubstitutes === false || item.originMode === "habitual_guided") {
      // Modo "Mis marcas": exige misma marca o EAN base
      const sameBrand =
        Boolean(chosenSig.brandKey && candSig.brandKey) &&
        chosenSig.brandKey === candSig.brandKey;
      const sameEan = Boolean(chosen.ean && cand.ean) && chosen.ean === cand.ean;
      return sameBrand || sameEan;
    }

    return candSig.subtypeFamily === chosenSig.subtypeFamily;
  });

  if (smallCandidates.length === 0) return null;

  const largePum = chosen.calibratedPrice / chosen.netContent;
  let bestFinding: PackTrapFinding | null = null;

  for (const small of smallCandidates) {
    for (let k = 2; k <= maxUnits; k++) {
      const comboContent = k * small.netContent;
      const contentRatio = comboContent / chosen.netContent;
      if (contentRatio < minRatio || contentRatio > maxRatio) {
        continue;
      }

      const comboCostCop = small.calibratedPrice * k;
      const comboPum = comboCostCop / comboContent;
      const normalizedComboCost = comboCostCop * (chosen.netContent / comboContent);
      const equivalentSavingsCop = Math.round(chosen.calibratedPrice - normalizedComboCost);
      const savingsPct =
        chosen.calibratedPrice > 0
          ? Number(((equivalentSavingsCop / chosen.calibratedPrice) * 100).toFixed(1))
          : 0;

      if (equivalentSavingsCop < minSavingsCop || savingsPct < minSavingsPct) {
        continue;
      }

      if (!bestFinding || equivalentSavingsCop > bestFinding.equivalentSavingsCop) {
        const smallPackLabel = formatNetContent(small.netContent, small.unitMeasure);
        const largePackLabel = formatNetContent(chosen.netContent, chosen.unitMeasure);
        const comboTotalLabel = formatNetContent(comboContent, small.unitMeasure);
        const message = `Trampa del empaque grande: ${k} × ${smallPackLabel} (${formatCop(small.calibratedPrice)} c/u) = ${comboTotalLabel} por ${formatCop(comboCostCop)} vs 1 × ${largePackLabel} por ${formatCop(chosen.calibratedPrice)}. Llevando ${k} medianos ahorras el equivalente a ${formatCop(equivalentSavingsCop)} (${savingsPct.toFixed(1).replace(".", ",")} %).`;

        bestFinding = {
          itemKey: item.itemKey,
          largeOffer: chosen,
          combo: [{ offer: small, units: k }],
          comboContent,
          largeContent: chosen.netContent,
          comboCostCop,
          largeCostCop: chosen.calibratedPrice,
          comboPum: Number(comboPum.toFixed(4)),
          largePum: Number(largePum.toFixed(4)),
          equivalentSavingsCop,
          savingsPct,
          message,
        };
      }
    }
  }

  return bestFinding;
}
