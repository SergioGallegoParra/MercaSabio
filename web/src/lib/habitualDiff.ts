import type { BasketAllocation, BasketItemInput, BasketPlan } from "./basketOptimizer.ts";
import { extractProductSignature } from "./comparisonEngine.ts";
import { formatCop } from "./formatters.ts";
import { computeRealPum } from "./sabiometro.ts";
import { evaluateSamePlantMatch, type SamePlantIndex } from "./samePlant.ts";
import type { HabitualSwap, SabiometroSummary, StoreOffer, SwapReason } from "./types.ts";

/**
 * Construye las filas lado a lado "Tu producto habitual (pequeño) vs Recomendado (grande)"
 * explicando características y por qué fue elegido como alternativa más económica.
 */
export function buildHabitualSwaps(params: {
  plan: BasketPlan;
  items: BasketItemInput[];
  knownOffers: StoreOffer[];
  lockedItemKeys?: Set<string>;
  samePlantIndex?: SamePlantIndex;
  sabiometroMap?: Map<string, SabiometroSummary>;
}): { swaps: HabitualSwap[]; unchanged: BasketAllocation[] } {
  const { plan, items, knownOffers, lockedItemKeys, samePlantIndex, sabiometroMap } = params;
  const itemByKey = new Map(items.map((i) => [i.itemKey, i]));
  const skuById = new Map(knownOffers.map((o) => [o.storeSkuId, o]));

  const swaps: HabitualSwap[] = [];
  const unchanged: BasketAllocation[] = [];

  for (const stop of plan.storeStops) {
    for (const alloc of stop.allocations) {
      const item = itemByKey.get(alloc.itemKey);
      const anchorOffer = item?.anchorStoreSkuId
        ? skuById.get(item.anchorStoreSkuId) ?? null
        : null;

      const isDifferentProduct =
        alloc.isSubstitute ||
        Boolean(item?.anchorStoreSkuId && alloc.offer.storeSkuId !== item.anchorStoreSkuId);

      const habitualPrice =
        item?.habitualReferencePriceCop && item.habitualReferencePriceCop > 0
          ? item.habitualReferencePriceCop
          : alloc.baselineReferenceCost / Math.max(1, alloc.quantity);

      const habitualTotalCost = habitualPrice * alloc.quantity;
      const savingsCop = Math.round(habitualTotalCost - alloc.nominalCost);

      if (!isDifferentProduct || savingsCop <= 0) {
        unchanged.push(alloc);
        continue;
      }

      const sabio =
        sabiometroMap?.get(alloc.offer.masterProductId) ?? alloc.offer.sabiometro ?? null;

      const recSig = extractProductSignature(alloc.offer);
      const anchorSig = anchorOffer ? extractProductSignature(anchorOffer) : null;
      const sameFamily = anchorSig
        ? recSig.subtypeFamily === anchorSig.subtypeFamily
        : Boolean(item?.subtypeFamily && recSig.subtypeFamily === item.subtypeFamily);

      const samePlant = evaluateSamePlantMatch({
        anchorOffer,
        recommendedOffer: alloc.offer,
        anchorTier: anchorSig?.lexicalTierHint ?? undefined,
        recommendedTier: recSig.lexicalTierHint ?? undefined,
        sameFamily,
        samePlantIndex,
      });

      const habitualContent = anchorOffer?.netContent ?? item?.targetNetContent ?? alloc.offer.netContent;
      const habitualUnit = anchorOffer?.unitMeasure ?? item?.targetUnitMeasure ?? alloc.offer.unitMeasure;
      const habitualPum = habitualContent > 0 ? habitualPrice / habitualContent : alloc.offer.pumPrice;
      const habitualRealPum = computeRealPum({
        calibratedPriceCop: habitualPrice,
        netContent: habitualContent,
        sabiometro: anchorOffer?.sabiometro ?? null,
        fallbackYieldFactor: anchorOffer?.avgYieldFactor ?? 1,
      });

      const recRealPum = computeRealPum({
        calibratedPriceCop: alloc.offer.calibratedPrice,
        netContent: alloc.offer.netContent,
        sabiometro: sabio,
        fallbackYieldFactor: alloc.offer.avgYieldFactor,
      });

      const reasonCodes: SwapReason[] = [];
      const reasonsText: string[] = [];

      if (samePlant) {
        reasonCodes.push("same_plant");
        reasonsText.push("Origen verificado en la misma planta de producción");
      }
      if (alloc.offer.pumPrice < habitualPum * 0.99) {
        const pumPct = Math.round(((habitualPum - alloc.offer.pumPrice) / habitualPum) * 100);
        reasonCodes.push("lower_pum");
        reasonsText.push(`Precio por unidad ${pumPct} % menor`);
      }
      if (alloc.offer.isPrivateLabel) {
        reasonCodes.push("private_label_equivalent");
        reasonsText.push(`Alternativa marca propia ${alloc.offer.storeName}`);
      }
      if (sabio?.status === "published" && (sabio.valueIndex ?? 0) >= 65) {
        reasonCodes.push("better_sabiometro");
        reasonsText.push(`Sabiómetro ${Math.round(sabio.valueIndex ?? 0)} · ${sabio.consensusLabel}`);
      }
      if (reasonCodes.length === 0) {
        reasonCodes.push("same_tier");
        reasonsText.push(`Competidor directo ${formatCop(savingsCop)} más económico`);
      }

      const pumWarning =
        recRealPum > habitualRealPum * 1.05 && alloc.nominalCost < habitualTotalCost;

      const savingsPct =
        habitualTotalCost > 0
          ? Number(((savingsCop / habitualTotalCost) * 100).toFixed(1))
          : 0;

      swaps.push({
        itemKey: alloc.itemKey,
        habitual: {
          title: item?.habitualProductTitle ?? anchorOffer?.rawName ?? item?.label ?? alloc.label,
          brand: item?.anchorBrand ?? anchorOffer?.brand ?? null,
          priceCop: Math.round(habitualPrice),
          imageUrl: anchorOffer?.imageUrl ?? null,
          netContent: habitualContent,
          unitMeasure: habitualUnit,
          pum: Number(habitualPum.toFixed(4)),
          realPum: habitualRealPum,
          qualityTier: anchorSig?.lexicalTierHint ?? undefined,
        },
        recommended: {
          ...alloc.offer,
          sabiometro: sabio ?? alloc.offer.sabiometro,
        },
        quantity: alloc.quantity,
        nominalCostCop: Math.round(alloc.nominalCost),
        savingsCop,
        savingsPct,
        pumWarning,
        reasonCodes,
        reasonsText,
        samePlant,
        sabiometro: sabio,
        qualityTier: recSig.lexicalTierHint ?? undefined,
        locked: Boolean(lockedItemKeys?.has(alloc.itemKey)),
      });
    }
  }

  // Ordenar por ahorro absoluto descendente, priorizando hallazgos "Misma planta" si ahorro es comparable
  swaps.sort((a, b) => {
    const aScore = a.savingsCop * (a.samePlant ? 1.1 : 1);
    const bScore = b.savingsCop * (b.samePlant ? 1.1 : 1);
    return bScore - aScore;
  });

  return { swaps, unchanged };
}
