import type { BasketItemInput } from "./basketOptimizer.ts";
import type {
  CommunityBasketRecord,
  CommunityCategoryTag,
  DietFilter,
  QualityTier,
  UnitMeasure,
} from "./types.ts";

export const COMMUNITY_CATEGORIES: Array<{
  id: "all" | CommunityCategoryTag;
  label: string;
}> = [
  { id: "all", label: "Todos" },
  { id: "economico", label: "Económicos" },
  { id: "alto_proteina", label: "Alto en proteína" },
  { id: "sin_lactosa", label: "Sin lactosa" },
  { id: "familiar", label: "Familiar" },
  { id: "rapido", label: "Rápido" },
];

export const COMMUNITY_CATEGORY_LABELS: Record<CommunityCategoryTag, string> = {
  general: "Canasta balanceada",
  economico: "Económico",
  alto_proteina: "Alto en proteína",
  sin_lactosa: "Sin lactosa",
  familiar: "Familiar",
  rapido: "Mercado rápido",
};

/** Sanitiza los ítems de una canasta antes de guardarla en Favoritos o Comunidad. */
export function sanitizeBasketItemsForSnapshot(
  items: BasketItemInput[],
  options?: { stripAnchorSpecifics?: boolean },
): Record<string, unknown>[] {
  const stripSpecifics = Boolean(options?.stripAnchorSpecifics);
  return items.slice(0, 80).map((item, idx) => {
    const clean: Record<string, unknown> = {
      itemKey: item.itemKey || `item-${idx + 1}`,
      label: item.label.slice(0, 120),
      subtypeFamily: item.subtypeFamily ?? null,
      broadFamily: item.broadFamily ?? null,
      canonicalSlug: item.canonicalSlug ?? null,
      familyLabel: item.familyLabel ?? null,
      targetNetContent:
        typeof item.targetNetContent === "number" && Number.isFinite(item.targetNetContent)
          ? item.targetNetContent
          : null,
      targetUnitMeasure: item.targetUnitMeasure ?? null,
      quantity:
        typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
          ? item.quantity
          : 1,
      allowedQualityTiers: Array.isArray(item.allowedQualityTiers)
        ? item.allowedQualityTiers
        : ["economico", "estandar"],
      pricePriority: item.pricePriority ?? "lowest_pum",
      requiredCriticalAttribute: item.requiredCriticalAttribute ?? null,
      sizePreference: item.sizePreference ?? "any",
      allowSubstitutes: item.allowSubstitutes !== false,
      sectionId: item.sectionId ?? null,
      subsectionId: item.subsectionId ?? null,
      originMode: item.originMode ?? "generic_guided",
      locked: Boolean(item.locked),
    };

    if (!stripSpecifics) {
      if (item.anchorStoreSkuId) clean.anchorStoreSkuId = item.anchorStoreSkuId;
      if (item.anchorBrand) clean.anchorBrand = item.anchorBrand;
      if (item.habitualProductTitle) clean.habitualProductTitle = item.habitualProductTitle;
      if (typeof item.habitualReferencePriceCop === "number") {
        clean.habitualReferencePriceCop = item.habitualReferencePriceCop;
      }
      if (item.masterProductId) clean.masterProductId = item.masterProductId;
    }

    return clean;
  });
}

/** Convierte un snapshot guardado (Favorito o Comunidad) en BasketItemInput[] fresco listo para optimizar o editar. */
export function hydrateBasketItemsFromSnapshot(
  rawItems: Record<string, unknown>[],
  options?: {
    sourcePrefix?: string;
    unlockAllOnEdit?: boolean;
  },
): BasketItemInput[] {
  const prefix = options?.sourcePrefix ?? "copy";
  const unlockAll = Boolean(options?.unlockAllOnEdit);

  return rawItems
    .filter((row) => row && typeof row.label === "string" && row.label.trim().length > 0)
    .map((row, idx) => {
      const rawKey = typeof row.itemKey === "string" && row.itemKey ? row.itemKey : `item-${idx}`;
      const cleanKey = rawKey.replace(/^(comm|fav|copy):[^:]+:/, "");
      const qualityTiers = Array.isArray(row.allowedQualityTiers)
        ? (row.allowedQualityTiers.filter(
            (t): t is QualityTier =>
              t === "economico" || t === "estandar" || t === "premium" || t === "especial",
          ))
        : (["economico", "estandar"] as QualityTier[]);
      const unitRaw = row.targetUnitMeasure;
      const unitMeasure: UnitMeasure | null =
        unitRaw === "g" || unitRaw === "ml" || unitRaw === "und" ? unitRaw : null;

      return {
        itemKey: `${prefix}:${cleanKey}:${idx}`,
        label: String(row.label).trim().slice(0, 120),
        familyLabel: typeof row.familyLabel === "string" ? row.familyLabel : null,
        masterProductId: typeof row.masterProductId === "string" ? row.masterProductId : null,
        canonicalSlug: typeof row.canonicalSlug === "string" ? row.canonicalSlug : null,
        subtypeFamily: typeof row.subtypeFamily === "string" ? row.subtypeFamily : null,
        broadFamily: typeof row.broadFamily === "string" ? row.broadFamily : null,
        targetNetContent:
          typeof row.targetNetContent === "number" && Number.isFinite(row.targetNetContent)
            ? row.targetNetContent
            : null,
        targetUnitMeasure: unitMeasure,
        quantity:
          typeof row.quantity === "number" && Number.isFinite(row.quantity) && row.quantity > 0
            ? row.quantity
            : 1,
        allowedQualityTiers: qualityTiers.length > 0 ? qualityTiers : ["economico", "estandar"],
        pricePriority: row.pricePriority === "lowest_total" ? "lowest_total" : "lowest_pum",
        requiredCriticalAttribute:
          typeof row.requiredCriticalAttribute === "string" ? row.requiredCriticalAttribute : null,
        sizePreference:
          row.sizePreference === "small" ||
          row.sizePreference === "medium" ||
          row.sizePreference === "large"
            ? row.sizePreference
            : "any",
        allowSubstitutes: unlockAll ? true : row.allowSubstitutes !== false,
        anchorStoreSkuId: typeof row.anchorStoreSkuId === "string" ? row.anchorStoreSkuId : null,
        anchorBrand: typeof row.anchorBrand === "string" ? row.anchorBrand : null,
        habitualProductTitle:
          typeof row.habitualProductTitle === "string" ? row.habitualProductTitle : null,
        habitualReferencePriceCop:
          typeof row.habitualReferencePriceCop === "number" ? row.habitualReferencePriceCop : null,
        sectionId:
          row.sectionId === "alacena" || row.sectionId === "nevera" || row.sectionId === "aseo"
            ? row.sectionId
            : undefined,
        subsectionId: typeof row.subsectionId === "string" ? row.subsectionId : undefined,
        originMode:
          row.originMode === "habitual_guided" || row.originMode === "free_shop"
            ? row.originMode
            : "generic_guided",
        locked: unlockAll ? false : Boolean(row.locked),
      } satisfies BasketItemInput;
    });
}

export const FALLBACK_COMMUNITY_BASKETS: CommunityBasketRecord[] = [
  {
    id: "c0000001-0000-4000-8000-000000000001",
    authorAlias: "@LauraBogotá",
    title: "Canasta quincenal inteligente (D1 + Olímpica)",
    description:
      "Combinación híbrida con básicos sin marca y café fijo para ahorrar sin sacrificar rendimiento.",
    categoryTag: "economico",
    zoneLabel: "Bogotá · Chapinero",
    itemsCount: 6,
    items: [
      {
        itemKey: "comm-arroz",
        label: "Arroz blanco 1 kg",
        subtypeFamily: "arroz_blanco",
        broadFamily: "arroz",
        targetNetContent: 1000,
        targetUnitMeasure: "g",
        quantity: 2,
        allowedQualityTiers: ["economico", "estandar"],
        pricePriority: "lowest_pum",
        sizePreference: "medium",
        allowSubstitutes: true,
      },
      {
        itemKey: "comm-frijol",
        label: "Fríjol rojo / cargamanto",
        subtypeFamily: "frijol",
        broadFamily: "frijol",
        targetNetContent: 500,
        targetUnitMeasure: "g",
        quantity: 1,
        allowedQualityTiers: ["economico", "estandar"],
        pricePriority: "lowest_pum",
        sizePreference: "any",
        allowSubstitutes: true,
      },
      {
        itemKey: "comm-aceite",
        label: "Aceite vegetal 900 ml",
        subtypeFamily: "aceite_vegetal",
        broadFamily: "aceite",
        targetNetContent: 900,
        targetUnitMeasure: "ml",
        quantity: 1,
        allowedQualityTiers: ["economico", "estandar"],
        pricePriority: "lowest_pum",
        sizePreference: "medium",
        allowSubstitutes: true,
      },
      {
        itemKey: "comm-leche-desl",
        label: "Leche deslactosada",
        subtypeFamily: "leche_liquida",
        broadFamily: "leche",
        requiredCriticalAttribute: "deslactosada",
        targetNetContent: 1000,
        targetUnitMeasure: "ml",
        quantity: 6,
        allowedQualityTiers: ["economico", "estandar"],
        pricePriority: "lowest_pum",
        sizePreference: "large",
        allowSubstitutes: true,
      },
      {
        itemKey: "comm-pasta",
        label: "Pasta espagueti 500 g",
        subtypeFamily: "pasta_corta_larga",
        broadFamily: "pasta",
        targetNetContent: 500,
        targetUnitMeasure: "g",
        quantity: 2,
        allowedQualityTiers: ["economico", "estandar"],
        pricePriority: "lowest_pum",
        sizePreference: "medium",
        allowSubstitutes: true,
      },
      {
        itemKey: "comm-cafe",
        label: "Café molido 500 g",
        subtypeFamily: "cafe_molido",
        broadFamily: "cafe",
        targetNetContent: 500,
        targetUnitMeasure: "g",
        quantity: 1,
        allowedQualityTiers: ["estandar", "premium"],
        pricePriority: "lowest_pum",
        sizePreference: "medium",
        allowSubstitutes: true,
      },
    ],
    activeDietFilters: ["lactose_free"] as DietFilter[],
    estimatedTotalCop: 98400,
    estimatedSavingsCop: 24800,
    estimatedSavingsPct: 20.1,
    storeSummary: "Tiendas D1 + Olímpica",
    avgSabiometro: 84,
    copiesCount: 38,
    createdAt: new Date().toISOString(),
  },
];
