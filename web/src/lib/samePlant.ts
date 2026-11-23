import type {
  ProductManufacturingSummary,
  QualityTier,
  SamePlantInfo,
  SamePlantMatchLevel,
  StoreOffer,
} from "./types.ts";

/**
 * Modificación del usuario (#6): el módulo INVIMA / "Misma planta" queda creado en BD,
 * ETL y frontend, marcado como pendiente de poblar (en producción hoy 0 productos tienen
 * `invimaRegistry` o `actualManufacturer`). Nunca inventar registros sanitarios.
 */
export const INVIMA_DB_STATUS = "pending_population" as const;

export interface SamePlantPairRecord {
  productA: string;
  productB: string;
  matchLevel: SamePlantMatchLevel;
  confidence: number;
  verifiedByAdmin: boolean;
  sharedInvimaRegistry: string | null;
  manufacturerName: string | null;
  plantName: string | null;
  plantCity: string | null;
  evidenceUrl?: string | null;
}

export type SamePlantIndex = Map<string, SamePlantPairRecord>;

export function makeSamePlantPairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export function indexSamePlantPairs(pairs: SamePlantPairRecord[]): SamePlantIndex {
  const map: SamePlantIndex = new Map();
  for (const pair of pairs) {
    map.set(makeSamePlantPairKey(pair.productA, pair.productB), pair);
  }
  return map;
}

/**
 * Evalúa si debe mostrarse la alerta sutil "Misma planta" al comparar
 * el producto habitual (anchor) contra uno recomendado de menor aparente gama.
 */
export function evaluateSamePlantMatch(params: {
  anchorOffer?: Pick<
    StoreOffer,
    "masterProductId" | "brand" | "pumPrice" | "invimaRegistry" | "actualManufacturer" | "manufacturing"
  > | null;
  recommendedOffer: Pick<
    StoreOffer,
    "masterProductId" | "brand" | "pumPrice" | "invimaRegistry" | "actualManufacturer" | "manufacturing"
  >;
  anchorTier?: QualityTier;
  recommendedTier?: QualityTier;
  sameFamily: boolean;
  samePlantIndex?: SamePlantIndex;
}): SamePlantInfo | null {
  const {
    anchorOffer,
    recommendedOffer,
    anchorTier,
    recommendedTier,
    sameFamily,
    samePlantIndex,
  } = params;

  if (!anchorOffer || anchorOffer.masterProductId === recommendedOffer.masterProductId) {
    return null;
  }
  if (!sameFamily) {
    return null;
  }
  // Exige ahorro real por PUM >= 5 % y contraste entre calidad aparente (ej. estándar/premium vs económico)
  if (
    anchorOffer.pumPrice <= 0 ||
    recommendedOffer.pumPrice > anchorOffer.pumPrice * 0.95
  ) {
    return null;
  }
  if (anchorTier && recommendedTier && anchorTier === recommendedTier) {
    return null;
  }

  const pairRecord = samePlantIndex?.get(
    makeSamePlantPairKey(anchorOffer.masterProductId, recommendedOffer.masterProductId),
  );

  if (pairRecord) {
    if (
      pairRecord.matchLevel !== "same_registry" &&
      pairRecord.matchLevel !== "same_plant"
    ) {
      return null;
    }
    if (!pairRecord.verifiedByAdmin && pairRecord.confidence < 0.7) {
      return null;
    }
    return buildLegalSamePlantInfo({
      matchLevel: pairRecord.matchLevel,
      confidence: pairRecord.confidence,
      verifiedByAdmin: pairRecord.verifiedByAdmin,
      manufacturerName: pairRecord.manufacturerName,
      plantName: pairRecord.plantName,
      plantCity: pairRecord.plantCity,
      invimaRegistry: pairRecord.sharedInvimaRegistry,
      evidenceUrl: pairRecord.evidenceUrl,
      anchorBrand: anchorOffer.brand,
      recommendedTier,
    });
  }

  // Fallback si ambos SKUs traen metadata estructurada con registro INVIMA o planta idéntica verificada
  const aMfg: ProductManufacturingSummary | undefined = anchorOffer.manufacturing;
  const bMfg: ProductManufacturingSummary | undefined = recommendedOffer.manufacturing;
  const aInvima = aMfg?.invimaRegistry ?? anchorOffer.invimaRegistry;
  const bInvima = bMfg?.invimaRegistry ?? recommendedOffer.invimaRegistry;

  if (aInvima && bInvima && aInvima.trim().toUpperCase() === bInvima.trim().toUpperCase()) {
    const conf = Math.min(aMfg?.confidence ?? 0.85, bMfg?.confidence ?? 0.85);
    if (conf >= 0.7 || (aMfg?.verifiedByAdmin && bMfg?.verifiedByAdmin)) {
      return buildLegalSamePlantInfo({
        matchLevel: "same_registry",
        confidence: conf,
        verifiedByAdmin: Boolean(aMfg?.verifiedByAdmin && bMfg?.verifiedByAdmin),
        manufacturerName:
          bMfg?.manufacturerName ?? recommendedOffer.actualManufacturer ?? anchorOffer.actualManufacturer,
        plantName: bMfg?.plantName ?? aMfg?.plantName ?? null,
        plantCity: bMfg?.plantCity ?? aMfg?.plantCity ?? null,
        invimaRegistry: bInvima.trim(),
        evidenceUrl: bMfg?.evidenceUrl ?? aMfg?.evidenceUrl ?? null,
        anchorBrand: anchorOffer.brand,
        recommendedTier,
      });
    }
  }

  if (aMfg?.plantId && bMfg?.plantId && aMfg.plantId === bMfg.plantId) {
    const conf = Math.min(aMfg.confidence, bMfg.confidence);
    if (conf >= 0.7 || (aMfg.verifiedByAdmin && bMfg.verifiedByAdmin)) {
      return buildLegalSamePlantInfo({
        matchLevel: "same_plant",
        confidence: conf,
        verifiedByAdmin: aMfg.verifiedByAdmin && bMfg.verifiedByAdmin,
        manufacturerName: bMfg.manufacturerName ?? aMfg.manufacturerName,
        plantName: bMfg.plantName ?? aMfg.plantName,
        plantCity: bMfg.plantCity ?? aMfg.plantCity,
        invimaRegistry: bMfg.invimaRegistry ?? aMfg.invimaRegistry,
        evidenceUrl: bMfg.evidenceUrl ?? aMfg.evidenceUrl,
        anchorBrand: anchorOffer.brand,
        recommendedTier,
      });
    }
  }

  return null;
}

function buildLegalSamePlantInfo(params: {
  matchLevel: SamePlantMatchLevel;
  confidence: number;
  verifiedByAdmin: boolean;
  manufacturerName: string | null;
  plantName: string | null;
  plantCity: string | null;
  invimaRegistry: string | null;
  evidenceUrl?: string | null;
  anchorBrand?: string | null;
  recommendedTier?: QualityTier;
}): SamePlantInfo {
  const maker = params.manufacturerName ?? "el mismo fabricante";
  const plantPlace = params.plantName
    ? params.plantCity
      ? `en la planta ${params.plantName} (${params.plantCity})`
      : `en la planta ${params.plantName}`
    : "en la misma planta de producción";
  const invimaPart = params.invimaRegistry
    ? ` (registro INVIMA ${params.invimaRegistry})`
    : "";
  const tierPart =
    params.recommendedTier === "economico"
      ? " Aunque su etiqueta comercial es Económica, el origen de fabricación está respaldado por registro."
      : "";
  const anchorText = params.anchorBrand ? ` igual que tu ${params.anchorBrand} habitual` : "";

  return {
    matchLevel: params.matchLevel,
    confidence: params.confidence,
    verifiedByAdmin: params.verifiedByAdmin,
    manufacturerName: params.manufacturerName,
    plantName: params.plantName,
    plantCity: params.plantCity,
    invimaRegistry: params.invimaRegistry,
    evidenceUrl: params.evidenceUrl,
    explanationText: `Fabricado por ${maker} ${plantPlace}${anchorText}${invimaPart}.${tierPart}`,
  };
}

/** Mensaje neutro mostrado en la ficha cuando el producto aún no tiene registro INVIMA poblado. */
export function getInvimaPendingNotice(offer: Pick<StoreOffer, "invimaRegistry" | "manufacturing">): string | null {
  if (offer.invimaRegistry || offer.manufacturing?.invimaRegistry) {
    return null;
  }
  return "Origen de planta y registro INVIMA: módulo creado, base sanitaria en proceso de carga (próximamente).";
}
