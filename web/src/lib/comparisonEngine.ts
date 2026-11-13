import type {
  AdminActiveMatchSummary,
  AdminCatalogItem,
  AdminSubtypeOption,
  BulkComparisonOption,
  CompareMode,
  ComparisonGroup,
  ComparisonPairRule,
  CurationContext,
  ProductCurationOverride,
  ProductSignatureSummary,
  QualityTier,
  ReviewStatus,
  StoreOffer,
  TieredCompetitorMatch,
  UnitMeasure,
} from "@/lib/types";
import { cleanProductTitle, sanitizeExternalUrl } from "./productInsights.ts";

export interface ExtractedSignature extends ProductSignatureSummary {
  normalizedText: string;
  brandKey: string;
  variantTokensKey: string;
  skuFingerprint: string;
  inferredCanonicalSlug: string | null;
  lexicalTierHint: QualityTier | null;
}

export const QUALITY_TIER_LABELS: Record<QualityTier, string> = {
  economico: "Económico",
  estandar: "Estándar",
  premium: "Premium",
  especial: "Especial",
};

const KNOWN_FAMILIES: Array<{
  subtype: string;
  broad: string;
  label: string;
  slug: string | null;
  exclude?: RegExp;
  match: RegExp;
}> = [
  // Exclusiones y categorías específicas primero (orden importa)
  {
    subtype: "pasta_seca",
    broad: "pasta",
    label: "Pasta seca",
    slug: "pasta-espagueti-500g",
    exclude: /\b(de\s+tomate|pasta\s+dental|betun|dientes|lustrar|zapatos)\b/,
    match: /\b(pastas?|espagueti|spaghetti|tallarin\w*|fusilli|penne|macarron\w*|tornillo\w*|conchitas|fideo\w*|lasagna|lasaña|ravioli)\b/,
  },
  {
    subtype: "pasta_tomate",
    broad: "salsas",
    label: "Pasta o salsa de tomate",
    slug: null,
    match: /\b(pasta\s+de\s+tomate|salsa\s+(?:de\s+)?tomate|ketchup|napolitana)\b/,
  },
  {
    subtype: "atun_preparado",
    broad: "atun",
    label: "Atún preparado / ensalada",
    slug: null,
    match: /\b(antipasto|aderezo|ensalada\s+(?:de\s+)?atun|dip\s+de\s+atun|pate\s+de\s+atun)\b.*\batun\b|\batun\b.*\b(antipasto|aderezo|ensalada|veget|maiz)\b/,
  },
  {
    subtype: "atun_oliva",
    broad: "atun",
    label: "Atún en aceite de oliva",
    slug: "atun-lata-160g",
    match: /\batun\b.*\b(aceite\s+de\s+)?oliva\b/,
  },
  {
    subtype: "atun_agua",
    broad: "atun",
    label: "Atún en agua",
    slug: "atun-lata-160g",
    match: /\batun\b.*\bagua\b/,
  },
  {
    subtype: "atun_aceite",
    broad: "atun",
    label: "Atún en aceite",
    slug: "atun-lata-160g",
    match: /\batun\b.*\baceite\b|\batun\b.*\b(lomitos?|trozos?|rallado|solido)\b/,
  },
  {
    subtype: "cafe_capsulas",
    broad: "cafe",
    label: "Café en cápsulas",
    slug: null,
    match: /\bcafe\b.*\b(capsul\w*|dolce\s+gusto|nespresso|pods?)\b|\b(capsul\w*|dolce\s+gusto)\b.*\bcafe\b/,
  },
  {
    subtype: "cafe_instantaneo",
    broad: "cafe",
    label: "Café instantáneo / soluble",
    slug: null,
    match: /\bcafe\b.*\b(instant\w*|liofiliz\w*|soluble|descafeinado\s+inst)\b/,
  },
  {
    subtype: "cafe_grano",
    broad: "cafe",
    label: "Café en grano",
    slug: "cafe-molido-500g",
    exclude: /\b(dulce|licor|bebida|granola|pan|arroz|capsul\w*|dolce\s+gusto)\b/,
    match: /\bcafe\b.*\ben\s+grano\b|\bcafe\s+.*\bgrano\b/,
  },
  {
    subtype: "cafe_molido",
    broad: "cafe",
    label: "Café tostado y molido",
    slug: "cafe-molido-500g",
    exclude: /\b(bebida\s+cafe|helado|licor|galleta|tort[ae]|arequipe|pan|chocolat\w*|capsul\w*|dolce\s+gusto)\b/,
    match: /\bcafe\b/,
  },
  {
    subtype: "arroz_integral",
    broad: "arroz",
    label: "Arroz integral",
    slug: "arroz-blanco-1000g",
    exclude: /\b(pasta|tallarin|achocolatad\w*|chocolatin\w*|leche\s+de\s+arroz|bebida|galleta|torta|vinagre|harina|crujiente)\b/,
    match: /\barroz\b.*\bintegral\b/,
  },
  {
    subtype: "arroz_parbolizado",
    broad: "arroz",
    label: "Arroz parbolizado",
    slug: "arroz-blanco-1000g",
    exclude: /\b(chocolatin\w*|galleta|snack)\b/,
    match: /\barroz\b.*\bparbol\w*\b/,
  },
  {
    subtype: "arroz_saborizado",
    broad: "arroz",
    label: "Arroz saborizado",
    slug: null,
    exclude: /\b(chocolatin\w*|galleta|snack)\b/,
    match: /\barroz\b.*\b(coco|pollo|paella|mix|verduras|ajonjoli)\b/,
  },
  {
    subtype: "arroz_especial",
    broad: "arroz",
    label: "Arroz especial (Jazmín / Basmati / Arborio)",
    slug: "arroz-blanco-1000g",
    exclude: /\b(pasta|tallarin|leche|bebida|galleta|torta|harina|vinagre|inflado|crisp|snack|achocolatad\w*|chocolat\w*)\b/,
    match: /\barroz\b.*\b(jazmin|jasmin|jasmine|basmati|arborio|risotto|sushi|salvaje|negro)\b/,
  },
  {
    subtype: "arroz_blanco",
    broad: "arroz",
    label: "Arroz blanco",
    slug: "arroz-blanco-1000g",
    exclude: /\b(pasta|tallarin|leche|bebida|galleta|torta|harina|vinagre|inflado|crisp|snack|achocolatad\w*|chocolat\w*|crujiente)\b/,
    match: /\barroz\b/,
  },
  {
    subtype: "leche_polvo",
    broad: "leche",
    label: "Leche en polvo",
    slug: null,
    exclude: /\b(milo|chocolisto|cocoa|malteada|formula|bebe|infantil|etapa\s+\d)\b/,
    match: /\bleche\b.*\ben\s+polvo\b|\bleche\s+.*\bpolvo\b/,
  },
  {
    subtype: "leche_deslactosada",
    broad: "leche",
    label: "Leche deslactosada",
    slug: "leche-entera-1000ml",
    exclude: /\b(condensada|crema\s+de\s+leche|arequipe|asada|polvo|yogurt|queso|postre|helado)\b/,
    match: /\bleche\b.*\bdeslactosad\w*\b/,
  },
  {
    subtype: "leche_descremada",
    broad: "leche",
    label: "Leche descremada / semidescremada",
    slug: "leche-entera-1000ml",
    exclude: /\b(condensada|crema\s+de\s+leche|arequipe|asada|polvo|yogurt|queso|postre|helado)\b/,
    match: /\bleche\b.*\b(descremada|semidescremada|light|baja\s+en\s+grasa)\b/,
  },
  {
    subtype: "leche_entera",
    broad: "leche",
    label: "Leche entera líquida",
    slug: "leche-entera-1000ml",
    exclude: /\b(condensada|crema\s+de\s+leche|arequipe|asada|polvo|yogurt|queso|postre|natilla|saboriz\w*|achocolatad\w*|almendra|soya|coco|avena)\b/,
    match: /\bleche\b/,
  },
  {
    subtype: "aceite_oliva",
    broad: "aceite",
    label: "Aceite de oliva",
    slug: "aceite-vegetal-900ml",
    exclude: /\b(atun|sardina|antipasto|conserva|cabello|corporal|bebe|esencial)\b/,
    match: /\baceite\b.*\boliva\b/,
  },
  {
    subtype: "aceite_cocina",
    broad: "aceite",
    label: "Aceite vegetal / girasol / canola",
    slug: "aceite-vegetal-900ml",
    exclude: /\b(atun|sardina|antipasto|conserva|motor|moto|carro|cabello|corporal|masaje|bebe|esencial|coco\s+cosmetico)\b/,
    match: /\baceite\b/,
  },
  {
    subtype: "frijol_enlatado",
    broad: "frijol",
    label: "Frijoles preparados / enlatados",
    slug: null,
    match: /\bfrijol\w*\b.*\b(lata|enlatad\w*|refrit\w*|antioquen\w*|tocino|chile|carne|chicharron|ranchero)\b/,
  },
  {
    subtype: "frijol_seco",
    broad: "frijol",
    label: "Frijol en grano seco",
    slug: "frijol-500g",
    exclude: /\b(sopa|harina|snack|refrit\w*)\b/,
    match: /\bfrijol\w*\b/,
  },
  {
    subtype: "lenteja_seca",
    broad: "granos",
    label: "Lenteja seca",
    slug: "lenteja-500g",
    exclude: /\b(pasta|harina|snack|sopa)\b/,
    match: /\blenteja\w*\b/,
  },
  {
    subtype: "garbanzo_arveja",
    broad: "granos",
    label: "Garbanzo / arveja",
    slug: null,
    exclude: /\b(harina|hummus|pasta)\b/,
    match: /\b(garbanzo\w*|arveja\s+seca|arveja\s+verde\s+seca)\b/,
  },
  {
    subtype: "azucar_morena",
    broad: "endulzantes",
    label: "Azúcar morena / orgánica",
    slug: "azucar-refinada-1000g",
    exclude: /\b(sin\s+azucar|menos\s+azucar|milo|bebida|gaseosa|aguardiente|galleta|wafer|dulce|cereal|chocolat\w*)\b/,
    match: /\bazucar\b.*\b(morena|organica|rubia|pulverizada|micro)\b/,
  },
  {
    subtype: "azucar_blanca",
    broad: "endulzantes",
    label: "Azúcar blanca / refinada",
    slug: "azucar-refinada-1000g",
    exclude: /\b(sin\s+azucar|menos\s+azucar|zero|milo|bebida|gaseosa|aguardiente|ron|galleta|wafer|chocolat\w*|cereal|yogurt)\b/,
    match: /\bazucar\b/,
  },
  {
    subtype: "panela",
    broad: "endulzantes",
    label: "Panela",
    slug: null,
    exclude: /\b(bebida|te\s+de|jugo)\b/,
    match: /\bpanela\b/,
  },
  {
    subtype: "huevos_codorniz",
    broad: "huevos",
    label: "Huevos de codorniz",
    slug: "huevos-aa-30und",
    match: /\bhuevos?\b.*\bcodorniz\b/,
  },
  {
    subtype: "huevos_gallina",
    broad: "huevos",
    label: "Huevos de gallina",
    slug: "huevos-aa-30und",
    exclude: /\b(chocolate|kinder|pascua|sorpresa|codorniz|pasta)\b/,
    match: /\bhuevos?\b/,
  },
  {
    subtype: "harina_maiz",
    broad: "harinas",
    label: "Harina de maíz para arepas",
    slug: null,
    match: /\bharina\b.*\b(maiz|precocida|arepa\w*)\b/,
  },
  {
    subtype: "harina_trigo",
    broad: "harinas",
    label: "Harina de trigo",
    slug: null,
    match: /\bharina\b.*\btrigo\b|\bharina\s+tradicional\b/,
  },
  {
    subtype: "avena",
    broad: "cereales",
    label: "Avena en hojuelas / molida",
    slug: null,
    exclude: /\b(bebida|galleta|jabon|shampoo)\b/,
    match: /\bavena\b/,
  },
  {
    subtype: "chocolate_mesa",
    broad: "desayuno",
    label: "Chocolate de mesa",
    slug: null,
    match: /\bchocolate\b.*\b(mesa|pastilla|tradicional|clavo|canela|sin\s+azucar)\b|\bchocolate\s+(sol|luker|corona|quesada)\b/,
  },
  {
    subtype: "detergente_ropa",
    broad: "aseo_hogar",
    label: "Detergente para ropa",
    slug: null,
    match: /\bdetergente\b|\bjabon\s+en\s+polvo\b|\bjabon\s+liquido\s+ropa\b/,
  },
  {
    subtype: "papel_higienico",
    broad: "aseo_personal",
    label: "Papel higiénico",
    slug: null,
    match: /\bpapel\s+higienic\w*\b/,
  },
  {
    subtype: "lavaloza",
    broad: "aseo_hogar",
    label: "Lavaloza",
    slug: null,
    match: /\blavaloza\w*\b|\bcrema\s+lavaplatos\b/,
  },
];

export const KNOWN_SUBTYPE_OPTIONS: Array<Omit<AdminSubtypeOption, "count">> = KNOWN_FAMILIES.map(
  (f) => ({
    subtype: f.subtype,
    broadFamily: f.broad,
    label: f.label,
  })
);

const FAMILY_BY_SUBTYPE = new Map(KNOWN_FAMILIES.map((f) => [f.subtype, f]));

export function normalizeComparableText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWeightFallback(
  rawName: string,
  currentNetContent: number,
  currentUnit: UnitMeasure
): { qty: number; unit: UnitMeasure } {
  if (currentNetContent > 1 || currentUnit !== "und") {
    if (currentNetContent > 0) {
      return { qty: currentNetContent, unit: currentUnit };
    }
  }

  const normalized = normalizeComparableText(rawName);
  const weightMatch = normalized.match(
    /(?:\bx\s*)?(\d+(?:[.,]\d+)?)\s*(kg|kilos?|grs?|gramos?|g|ml|lts?|litros?|l|cc)\b/
  );
  if (weightMatch) {
    let rawNum = weightMatch[1];
    const unitRaw = weightMatch[2];

    if (/^\d+\.\d{3}$/.test(rawNum)) {
      rawNum = rawNum.replace(".", "");
    } else {
      rawNum = rawNum.replace(",", ".");
    }

    const parsed = Number.parseFloat(rawNum);
    if (Number.isFinite(parsed) && parsed > 0) {
      if (unitRaw === "kg" || unitRaw.startsWith("kilo")) {
        return { qty: Math.round(parsed * 1000 * 100) / 100, unit: "g" };
      }
      if (unitRaw === "l" || unitRaw === "lt" || unitRaw === "lts" || unitRaw.startsWith("litro")) {
        return { qty: Math.round(parsed * 1000 * 100) / 100, unit: "ml" };
      }
      if (unitRaw === "cc") {
        return { qty: parsed, unit: "ml" };
      }
      if (unitRaw === "g" || unitRaw.startsWith("gr")) {
        return { qty: parsed, unit: "g" };
      }
      if (unitRaw === "ml") {
        return { qty: parsed, unit: "ml" };
      }
    }
  }

  return {
    qty: currentNetContent > 0 ? currentNetContent : 1,
    unit: currentUnit,
  };
}

function normalizeBrandKey(brand: string | null | undefined, normalizedName: string): string {
  const cleanedBrand = normalizeComparableText(brand)
    .replace(/\b(marca\s+exclusiva|colombia|sa|sas)\b/g, "")
    .trim();
  if (cleanedBrand && cleanedBrand !== "generico" && cleanedBrand !== "sin marca") {
    return cleanedBrand;
  }

  const tokens = normalizedName.split(" ").filter((t) => t.length >= 3);
  return tokens[1] ?? tokens[0] ?? "generico";
}

function extractVariantKey(normalizedText: string, brandKey: string): string {
  const noise = new Set([
    "de",
    "la",
    "el",
    "los",
    "las",
    "en",
    "con",
    "para",
    "por",
    "y",
    "x",
    "bolsa",
    "empaque",
    "caja",
    "lata",
    "botella",
    "frasco",
    "doypack",
    "paquete",
    "gr",
    "grs",
    "g",
    "gramos",
    "kg",
    "kilo",
    "ml",
    "lt",
    "litro",
    "und",
    "neto",
    "cuidadosamente",
    "seleccionado",
    "seleccionados",
    "seleccionadas",
    "promocion",
    "promo",
    "oferta",
    "marca",
    "exclusiva",
    ...brandKey.split(" "),
  ]);

  const tokens = normalizedText
    .split(" ")
    .filter((token) => token.length >= 3 && !/^\d+(?:[.,]\d+)?$/.test(token) && !noise.has(token));

  const unique = [...new Set(tokens)].sort().slice(0, 6);
  return unique.join("-") || "std";
}

function detectLexicalTierHint(normalizedText: string, brandKey: string): QualityTier | null {
  if (
    /\b(organico|organica|campo\s+libre|gallina\s+feliz|pastoreo|sin\s+gluten|keto|biologico|basmati|jasmin|jasmine|arborio|wild|salvaje|artesanal|artisan)\b/.test(
      normalizedText
    )
  ) {
    return "especial";
  }
  if (
    /\b(premium|gourmet|seleccion\s+especial|extra\s+virgen|extravirgen|gran\s+reserva|reserva|origen|deluxe|supreme|importad[oa]|dorado|edicion\s+especial|maestria)\b/.test(
      normalizedText
    )
  ) {
    return "premium";
  }
  if (
    /\b(economico|economica|ahorro|super\s*ahorro|marca\s+propia|basico|bodega|popular|ekono|tottus|rallado)\b/.test(
      normalizedText
    ) ||
    /\b(ekono|marca\s+propia|krikos)\b/.test(brandKey)
  ) {
    return "economico";
  }
  return null;
}

function extractCriticalAttribute(normalizedText: string, broadFamily: string): string | null {
  if (broadFamily === "atun") {
    const cut = /\b(lomo|lomitos|solido)\b/.test(normalizedText)
      ? "lomo"
      : /\b(trozos?)\b/.test(normalizedText)
        ? "trozos"
        : /\b(rallado|desmenuzado)\b/.test(normalizedText)
          ? "rallado"
          : null;
    const medium = /\boliva\b/.test(normalizedText)
      ? "oliva"
      : /\bagua\b/.test(normalizedText)
        ? "agua"
        : /\baceite\b/.test(normalizedText)
          ? "aceite"
          : null;
    if (cut && medium) return `${cut}_${medium}`;
    return cut ?? medium;
  }

  if (broadFamily === "huevos") {
    const caliber = /\bjumbo\b/.test(normalizedText)
      ? "jumbo"
      : /\baaa\b/.test(normalizedText)
        ? "aaa"
        : /\baa\b/.test(normalizedText)
          ? "aa"
          : /\btipo\s+a\b|\ba\b/.test(normalizedText)
            ? "a"
            : null;
    const farming = /\b(campo\s+libre|gallina\s+feliz|pastoreo|organico)\b/.test(normalizedText)
      ? "campo_libre"
      : null;
    if (farming && caliber) return `${farming}_${caliber}`;
    return farming ?? caliber;
  }

  if (broadFamily === "arroz") {
    if (/\b(basmati|jasmin|jasmine|arborio|risotto|sushi|salvaje)\b/.test(normalizedText)) {
      return "grano_especial";
    }
    if (/\bintegral\b/.test(normalizedText)) return "integral";
    if (/\bparbol\w*\b/.test(normalizedText)) return "parbolizado";
    return null;
  }

  if (broadFamily === "aceite") {
    if (/\bextra\s+virgen\b|\bextravirgen\b/.test(normalizedText)) return "extra_virgen";
    if (/\boliva\b/.test(normalizedText)) return "oliva";
    if (/\baguacate\b/.test(normalizedText)) return "aguacate";
    if (/\bcoco\b/.test(normalizedText)) return "coco";
    if (/\bgirasol\b/.test(normalizedText)) return "girasol";
    if (/\bcanola\b/.test(normalizedText)) return "canola";
    return null;
  }

  if (broadFamily === "cafe") {
    if (/\bliofiliz\w*\b/.test(normalizedText)) return "liofilizado";
    if (/\b(organico|organica|origen)\b/.test(normalizedText)) return "origen_organico";
    if (/\bdescafeinad\w*\b/.test(normalizedText)) return "descafeinado";
    return null;
  }

  return null;
}

function inferFamily(
  normalizedText: string,
  unitMeasure: UnitMeasure,
  canonicalSlug: string | null,
  override?: ProductCurationOverride
): {
  subtypeFamily: string;
  broadFamily: string;
  familyLabel: string;
  inferredCanonicalSlug: string | null;
} {
  if (override?.overrideSubtype) {
    const known = FAMILY_BY_SUBTYPE.get(override.overrideSubtype);
    return {
      subtypeFamily: override.overrideSubtype,
      broadFamily: override.overrideBroadFamily ?? known?.broad ?? override.overrideSubtype.split("_")[0] ?? "mercado",
      familyLabel: known?.label ?? override.overrideSubtype.replace(/_/g, " "),
      inferredCanonicalSlug: known?.slug ?? canonicalSlug,
    };
  }

  for (const rule of KNOWN_FAMILIES) {
    if (rule.exclude && rule.exclude.test(normalizedText)) {
      continue;
    }
    if (rule.match.test(normalizedText)) {
      return {
        subtypeFamily: rule.subtype,
        broadFamily: rule.broad,
        familyLabel: rule.label,
        inferredCanonicalSlug: rule.slug ?? canonicalSlug,
      };
    }
  }

  if (canonicalSlug) {
    return {
      subtypeFamily: `cat:${canonicalSlug}`,
      broadFamily: canonicalSlug.split("-")[0] ?? canonicalSlug,
      familyLabel: canonicalSlug.replace(/-/g, " "),
      inferredCanonicalSlug: canonicalSlug,
    };
  }

  const rootWords = normalizedText
    .split(" ")
    .filter(
      (t) =>
        t.length >= 4 &&
        !/^\d/.test(t) &&
        !["para", "bolsa", "empaque", "pack", "neto", "gramos", "unidad", "unidades"].includes(t)
    )
    .slice(0, 2);
  const fallbackKey = rootWords.join("_") || "mercado";
  return {
    subtypeFamily: `gen:${fallbackKey}:${unitMeasure}`,
    broadFamily: `gen:${rootWords[0] ?? "mercado"}:${unitMeasure}`,
    familyLabel: rootWords.join(" ") || "Despensa general",
    inferredCanonicalSlug: null,
  };
}

export function extractProductSignature(
  offer: StoreOffer,
  override?: ProductCurationOverride
): ExtractedSignature {
  const cleanTitle = cleanProductTitle(offer.rawName);
  const normalizedText = normalizeComparableText(cleanTitle);
  const { qty, unit } = parseWeightFallback(offer.rawName, offer.netContent, offer.unitMeasure);
  const effectivePum = qty > 0 && offer.calibratedPrice > 0 ? offer.calibratedPrice / qty : offer.pumPrice;
  const family = inferFamily(normalizedText, unit, offer.canonicalSlug, override);
  const brandKey = normalizeBrandKey(offer.brand, normalizedText);
  const variantTokensKey = extractVariantKey(normalizedText, brandKey);
  const lexicalTierHint = detectLexicalTierHint(normalizedText, brandKey);
  const criticalAttribute = extractCriticalAttribute(normalizedText, family.broadFamily);

  const roundedQty = qty >= 50 ? Math.round(qty) : Number(qty.toFixed(1));
  const skuFingerprint = `${offer.storeId}::${brandKey}::${family.subtypeFamily}::${roundedQty}${unit}::${variantTokensKey}`;

  return {
    broadFamily: family.broadFamily,
    subtypeFamily: family.subtypeFamily,
    familyLabel: family.familyLabel,
    effectiveNetContent: qty,
    effectiveUnitMeasure: unit,
    effectivePum,
    criticalAttribute,
    normalizedText,
    brandKey,
    variantTokensKey,
    skuFingerprint,
    inferredCanonicalSlug: family.inferredCanonicalSlug,
    lexicalTierHint,
  };
}

interface IndexedOffer {
  offer: StoreOffer;
  signature: ExtractedSignature;
  sanitizedOffer: StoreOffer;
  qualityTier: QualityTier;
  qualityLabel: string;
  subtypeMedianPum: number | null;
  pumRatioVsMedian: number | null;
  reviewStatus: ReviewStatus;
  needsReview: boolean;
  doubtReason: string | null;
  override?: ProductCurationOverride;
}

function buildPairRuleMap(pairRules?: ComparisonPairRule[]): Map<string, ComparisonPairRule> {
  const map = new Map<string, ComparisonPairRule>();
  if (!pairRules) return map;
  for (const rule of pairRules) {
    const key = [rule.skuAId, rule.skuBId].sort().join("::");
    map.set(key, rule);
  }
  return map;
}

function getPairRuleType(
  skuA: string,
  skuB: string,
  pairRuleMap: Map<string, ComparisonPairRule>
): ComparisonPairRule["ruleType"] | null {
  const key = [skuA, skuB].sort().join("::");
  return pairRuleMap.get(key)?.ruleType ?? null;
}

function compareOfferPriority(a: { offer: StoreOffer; signature: ExtractedSignature }, b: { offer: StoreOffer; signature: ExtractedSignature }): number {
  if (a.offer.inStock !== b.offer.inStock) {
    return a.offer.inStock ? -1 : 1;
  }
  if (a.offer.calibratedPrice !== b.offer.calibratedPrice) {
    return a.offer.calibratedPrice - b.offer.calibratedPrice;
  }
  return a.signature.effectivePum - b.signature.effectivePum;
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Elimina filas repetidas dentro de cada cadena, aplica overrides de curación,
 * calcula la gama de calidad relativa a la mediana del subtipo y detecta dudas automáticas.
 */
export function deduplicateStoreOffers(
  offers: StoreOffer[],
  curationContext?: CurationContext
): IndexedOffer[] {
  const overridesBySkuId = curationContext?.overridesBySkuId ?? {};
  const bySkuId = new Map<string, { offer: StoreOffer; signature: ExtractedSignature; sanitizedOffer: StoreOffer; override?: ProductCurationOverride }>();

  for (const offer of offers) {
    if (!Number.isFinite(offer.calibratedPrice) || offer.calibratedPrice <= 0) {
      continue;
    }
    const override = overridesBySkuId[offer.storeSkuId];
    if (override?.reviewStatus === "excluded") {
      continue;
    }

    const cleanTitle = cleanProductTitle(offer.rawName);
    const sig = extractProductSignature(offer, override);
    const sanitizedOffer: StoreOffer = {
      ...offer,
      rawName: cleanTitle,
      rawUrl: offer.rawUrl ? (sanitizeExternalUrl(offer.rawUrl) ?? "") : offer.rawUrl,
      imageUrl: offer.imageUrl ? sanitizeExternalUrl(offer.imageUrl) : null,
      netContent: sig.effectiveNetContent,
      unitMeasure: sig.effectiveUnitMeasure,
      pumPrice: sig.effectivePum,
      canonicalSlug: sig.inferredCanonicalSlug ?? offer.canonicalSlug,
    };

    const existingId = bySkuId.get(offer.storeSkuId);
    const candidate = { offer, signature: sig, sanitizedOffer, override };
    if (!existingId || compareOfferPriority(candidate, existingId) < 0) {
      bySkuId.set(offer.storeSkuId, candidate);
    }
  }

  const byFingerprint = new Map<string, { offer: StoreOffer; signature: ExtractedSignature; sanitizedOffer: StoreOffer; override?: ProductCurationOverride }>();
  for (const item of bySkuId.values()) {
    const existing = byFingerprint.get(item.signature.skuFingerprint);
    if (!existing || compareOfferPriority(item, existing) < 0) {
      byFingerprint.set(item.signature.skuFingerprint, item);
    }
  }

  const uniqueItems = [...byFingerprint.values()];

  // Mediana de PUM por subtipo + unidad de medida
  const pumsBySubtype = new Map<string, number[]>();
  for (const item of uniqueItems) {
    if (item.signature.effectivePum <= 0) continue;
    const key = `${item.signature.subtypeFamily}::${item.signature.effectiveUnitMeasure}`;
    const arr = pumsBySubtype.get(key) ?? [];
    arr.push(item.signature.effectivePum);
    pumsBySubtype.set(key, arr);
  }

  const medianBySubtype = new Map<string, { median: number; count: number }>();
  for (const [key, values] of pumsBySubtype.entries()) {
    const median = computeMedian(values);
    if (median && median > 0) {
      medianBySubtype.set(key, { median, count: values.length });
    }
  }

  return uniqueItems.map((item) => {
    const key = `${item.signature.subtypeFamily}::${item.signature.effectiveUnitMeasure}`;
    const stats = medianBySubtype.get(key);
    const subtypeMedianPum = stats ? Number(stats.median.toFixed(2)) : null;
    const pumRatioVsMedian =
      stats && stats.median > 0 && item.signature.effectivePum > 0
        ? Number((item.signature.effectivePum / stats.median).toFixed(2))
        : null;

    let autoTier: QualityTier = "estandar";
    if (item.signature.lexicalTierHint === "especial") {
      autoTier = "especial";
    } else if (item.signature.lexicalTierHint === "premium") {
      autoTier = "premium";
    } else if (item.signature.lexicalTierHint === "economico") {
      autoTier = "economico";
    } else if (stats && stats.count >= 2 && pumRatioVsMedian !== null) {
      if (pumRatioVsMedian >= 2.05) {
        autoTier = "especial";
      } else if (pumRatioVsMedian >= 1.48) {
        autoTier = "premium";
      } else if (pumRatioVsMedian <= 0.72) {
        autoTier = "economico";
      }
    }

    const qualityTier = item.override?.overrideQualityTier ?? autoTier;
    const qualityLabel = QUALITY_TIER_LABELS[qualityTier];

    let needsReview = false;
    let doubtReason: string | null = null;
    let reviewStatus: ReviewStatus = "provisional_auto";

    if (item.override?.reviewStatus === "verified") {
      reviewStatus = "verified";
      needsReview = false;
      doubtReason = null;
    } else if (item.override?.reviewStatus === "reported") {
      reviewStatus = "reported";
      needsReview = true;
      doubtReason = item.override.doubtReason ?? "Reportado por un usuario como comparación injusta";
    } else {
      // Detección automática de dudas algorítmicas
      const count = stats?.count ?? 1;
      if (
        (item.signature.lexicalTierHint === "premium" || item.signature.lexicalTierHint === "especial") &&
        count >= 3 &&
        pumRatioVsMedian !== null &&
        pumRatioVsMedian <= 1.15
      ) {
        needsReview = true;
        doubtReason = `Nombre sugiere gama ${qualityLabel}, pero su PUM es ${pumRatioVsMedian}x la mediana`;
      } else if (
        item.signature.lexicalTierHint !== "premium" &&
        item.signature.lexicalTierHint !== "especial" &&
        count >= 3 &&
        pumRatioVsMedian !== null &&
        pumRatioVsMedian >= 1.65
      ) {
        needsReview = true;
        doubtReason = `PUM elevado (${pumRatioVsMedian}x mediana, cerca de 2x) sin etiqueta Premium/Especial`;
      } else if (item.signature.subtypeFamily.startsWith("gen:")) {
        needsReview = true;
        doubtReason = "Categoría provisional detectada automáticamente";
      } else if (item.override?.reviewStatus === "needs_review") {
        needsReview = true;
        doubtReason = item.override.doubtReason ?? "Marcado manualmente para revisión";
      }
      reviewStatus = needsReview ? "needs_review" : "provisional_auto";
    }

    const enrichedSig: ExtractedSignature = {
      ...item.signature,
      qualityTier,
      qualityLabel,
      pumRatioVsMedian,
      reviewStatus,
      needsReview,
      doubtReason,
    };

    return {
      offer: item.offer,
      signature: enrichedSig,
      sanitizedOffer: item.sanitizedOffer,
      qualityTier,
      qualityLabel,
      subtypeMedianPum,
      pumRatioVsMedian,
      reviewStatus,
      needsReview,
      doubtReason,
      override: item.override,
    };
  });
}

function areWeightsClose(qtyA: number, qtyB: number, toleranceRatio = 0.35): boolean {
  if (qtyA <= 0 || qtyB <= 0) return false;
  const ratio = qtyB / qtyA;
  return ratio >= 1 - toleranceRatio && ratio <= 1 + toleranceRatio;
}

function areAttributesCompatible(attrA: string | null | undefined, attrB: string | null | undefined): boolean {
  if (!attrA || !attrB) return true;
  return attrA === attrB;
}

function roundQtyBucket(qty: number): number {
  if (qty >= 2000) return Math.round(qty / 500) * 500;
  if (qty >= 400) return Math.round(qty / 100) * 100;
  if (qty >= 100) return Math.round(qty / 50) * 50;
  return Math.round(qty / 5) * 5 || Math.round(qty);
}

function getStrictGroupKey(item: IndexedOffer): string {
  const { offer, signature } = item;
  const ean = (offer.ean ?? "").trim();
  const roundedQty = Math.round(signature.effectiveNetContent);
  if (/^\d{8,14}$/.test(ean)) {
    return `ean:${ean}:${signature.subtypeFamily}:${roundQtyBucket(roundedQty)}${signature.effectiveUnitMeasure}`;
  }
  return `sku:${signature.brandKey}:${signature.subtypeFamily}:${roundedQty}${signature.effectiveUnitMeasure}`;
}

function getPumGroupKey(item: IndexedOffer): string {
  const { signature, qualityTier } = item;
  const bucket = roundQtyBucket(signature.effectiveNetContent);
  return `pum:${signature.subtypeFamily}:${qualityTier}:${bucket}${signature.effectiveUnitMeasure}`;
}

function pickBestPerStore(
  candidates: IndexedOffer[],
  maxPerStore = 1,
  maxTotal = 6,
  pairRuleMap?: Map<string, ComparisonPairRule>
): StoreOffer[] {
  const sorted = [...candidates].sort(compareOfferPriority);
  const perStoreCounts = new Map<string, number>();
  const perStoreBrands = new Set<string>();
  const picked: StoreOffer[] = [];

  for (const item of sorted) {
    if (pairRuleMap && picked.length > 0) {
      const hasBlockedWithPicked = picked.some(
        (existing) => getPairRuleType(existing.storeSkuId, item.offer.storeSkuId, pairRuleMap) === "blocked_pair"
      );
      if (hasBlockedWithPicked) {
        continue;
      }
    }

    const count = perStoreCounts.get(item.offer.storeId) ?? 0;
    const brandTag = `${item.offer.storeId}::${item.signature.brandKey}`;
    if (count >= maxPerStore || perStoreBrands.has(brandTag)) {
      continue;
    }
    perStoreCounts.set(item.offer.storeId, count + 1);
    perStoreBrands.add(brandTag);
    picked.push(item.sanitizedOffer);
    if (picked.length >= maxTotal) break;
  }

  return picked;
}

function formatQty(qty: number, unit: UnitMeasure): string {
  if (unit === "g" && qty >= 1000 && qty % 500 === 0) {
    return `${qty / 1000} kg`;
  }
  if (unit === "ml" && qty >= 1000 && qty % 500 === 0) {
    return `${qty / 1000} L`;
  }
  return `${Math.round(qty)} ${unit}`;
}

function formatCopShort(amount: number): string {
  return `$${Math.round(Math.abs(amount)).toLocaleString("es-CO")}`;
}

interface IndexedMatchPool {
  byBroadUnit: Map<string, IndexedOffer[]>;
  bySubtypeUnit: Map<string, IndexedOffer[]>;
  bySkuId: Map<string, IndexedOffer>;
  approvedPartnerIds: Map<string, string[]>;
}

function buildIndexedMatchPool(
  pool: IndexedOffer[],
  pairRules?: ComparisonPairRule[]
): IndexedMatchPool {
  const byBroadUnit = new Map<string, IndexedOffer[]>();
  const bySubtypeUnit = new Map<string, IndexedOffer[]>();
  const bySkuId = new Map<string, IndexedOffer>();

  for (const cand of pool) {
    bySkuId.set(cand.offer.storeSkuId, cand);
    if (!cand.offer.inStock) continue;
    const broadKey = `${cand.signature.broadFamily}::${cand.signature.effectiveUnitMeasure}`;
    const broadArr = byBroadUnit.get(broadKey);
    if (broadArr) broadArr.push(cand);
    else byBroadUnit.set(broadKey, [cand]);

    const subKey = `${cand.signature.subtypeFamily}::${cand.signature.effectiveUnitMeasure}`;
    const subArr = bySubtypeUnit.get(subKey);
    if (subArr) subArr.push(cand);
    else bySubtypeUnit.set(subKey, [cand]);
  }

  const approvedPartnerIds = new Map<string, string[]>();
  if (pairRules) {
    for (const r of pairRules) {
      if (r.ruleType !== "approved_substitute") continue;
      const aList = approvedPartnerIds.get(r.skuAId) ?? [];
      aList.push(r.skuBId);
      approvedPartnerIds.set(r.skuAId, aList);
      const bList = approvedPartnerIds.get(r.skuBId) ?? [];
      bList.push(r.skuAId);
      approvedPartnerIds.set(r.skuBId, bList);
    }
  }

  return { byBroadUnit, bySubtypeUnit, bySkuId, approvedPartnerIds };
}

function computeTieredMatches(
  anchor: IndexedOffer,
  anchorGroupOffers: StoreOffer[],
  poolIndex: IndexedMatchPool,
  pairRuleMap: Map<string, ComparisonPairRule>,
  includeBulk = true
): {
  directCompetitors: TieredCompetitorMatch[];
  similarCompetitors: TieredCompetitorMatch[];
  bulkOptions: BulkComparisonOption[];
  substitutesCount: number;
  borderlinePumDoubt: boolean;
} {
  const existingStoreIds = new Set(anchorGroupOffers.map((o) => o.storeId));
  const existingSkuIds = new Set(anchorGroupOffers.map((o) => o.storeSkuId));
  const anchorSig = anchor.signature;
  const anchorQty = anchorSig.effectiveNetContent;
  const anchorPrice = anchor.sanitizedOffer.calibratedPrice;
  const anchorPum = anchorSig.effectivePum;

  const directByStore = new Map<string, { item: IndexedOffer; score: number }>();
  const similarByStore = new Map<
    string,
    { item: IndexedOffer; score: number; sameSubtype: boolean; isCrossTier: boolean }
  >();
  let substitutesCount = 0;
  let borderlinePumDoubt = false;

  const broadCandidates =
    poolIndex.byBroadUnit.get(`${anchorSig.broadFamily}::${anchorSig.effectiveUnitMeasure}`) ?? [];
  const extraIds = poolIndex.approvedPartnerIds.get(anchor.offer.storeSkuId);
  let candidates = broadCandidates;
  if (extraIds && extraIds.length > 0) {
    const seenIds = new Set(broadCandidates.map((c) => c.offer.storeSkuId));
    const extras: IndexedOffer[] = [];
    for (const id of extraIds) {
      if (seenIds.has(id)) continue;
      const hit = poolIndex.bySkuId.get(id);
      if (hit && hit.offer.inStock) extras.push(hit);
    }
    if (extras.length > 0) candidates = [...broadCandidates, ...extras];
  }

  const skipSimilarComputation = existingStoreIds.size >= 2;

  for (const cand of candidates) {
    if (existingSkuIds.has(cand.offer.storeSkuId)) {
      continue;
    }
    const pairRule = getPairRuleType(anchor.offer.storeSkuId, cand.offer.storeSkuId, pairRuleMap);
    if (pairRule === "blocked_pair") {
      continue;
    }

    const candSig = cand.signature;
    if (candSig.effectiveUnitMeasure !== anchorSig.effectiveUnitMeasure) {
      continue;
    }

    const sameSubtype = candSig.subtypeFamily === anchorSig.subtypeFamily;
    const sameBroad = candSig.broadFamily === anchorSig.broadFamily;
    if (!sameSubtype && !sameBroad && pairRule !== "approved_substitute") {
      continue;
    }

    const sameTier = cand.qualityTier === anchor.qualityTier || pairRule === "approved_same_tier";
    substitutesCount += 1;

    if (existingStoreIds.has(cand.offer.storeId)) {
      continue;
    }

    const attrsOk = areAttributesCompatible(anchorSig.criticalAttribute, candSig.criticalAttribute);
    const pumSpreadRatio =
      anchorPum > 0 && candSig.effectivePum > 0
        ? Math.max(candSig.effectivePum / anchorPum, anchorPum / candSig.effectivePum)
        : 1;

    const qtyRatio = anchorQty > 0 ? candSig.effectiveNetContent / anchorQty : 1;
    const logDist = Math.abs(Math.log(Math.max(qtyRatio, 0.05)));

    const eligibleDirect =
      sameSubtype &&
      areWeightsClose(anchorQty, candSig.effectiveNetContent, 0.35) &&
      sameTier &&
      attrsOk &&
      (pumSpreadRatio <= 1.95 || pairRule === "approved_same_tier");

    if (eligibleDirect) {
      if (pumSpreadRatio >= 1.75 && anchor.reviewStatus !== "verified") {
        borderlinePumDoubt = true;
      }
      const sameBrandBonus = candSig.brandKey === anchorSig.brandKey ? 0 : 0.25;
      const pumRatio = anchorPum > 0 ? candSig.effectivePum / anchorPum : 1;
      const score = sameBrandBonus + logDist * 2.2 + pumRatio * 0.4;
      const prev = directByStore.get(cand.offer.storeId);
      if (!prev || score < prev.score) {
        directByStore.set(cand.offer.storeId, { item: cand, score });
      }
    } else if (!skipSimilarComputation && (pumSpreadRatio <= 2.6 || pairRule === "approved_substitute")) {
      // Tier 2 similar: si fue descartado por diferencia de gama o PUM ~2x, no entra como directo
      if (sameSubtype && areWeightsClose(anchorQty, candSig.effectiveNetContent, 0.35) && !sameTier && pumSpreadRatio >= 1.75 && anchor.reviewStatus !== "verified") {
        borderlinePumDoubt = true;
      }
      const subtypePenalty = sameSubtype ? 0 : 1.5;
      const tierPenalty = sameTier ? 0 : 1.25;
      const pumRatio = anchorPum > 0 ? candSig.effectivePum / anchorPum : 1;
      const score = subtypePenalty + tierPenalty + logDist * 1.4 + pumRatio * 0.35;
      const prev = similarByStore.get(cand.offer.storeId);
      if (!prev || score < prev.score) {
        similarByStore.set(cand.offer.storeId, {
          item: cand,
          score,
          sameSubtype,
          isCrossTier: cand.qualityTier !== anchor.qualityTier,
        });
      }
    }
  }

  const directCompetitors: TieredCompetitorMatch[] = [...directByStore.values()]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(({ item }) => {
      const weightDiffPct =
        anchorQty > 0
          ? Math.round(((item.signature.effectiveNetContent - anchorQty) / anchorQty) * 100)
          : 0;
      const priceDiffCop = Math.round(item.sanitizedOffer.calibratedPrice - anchorPrice);
      const pumDiffPct =
        anchorPum > 0
          ? Number((((item.signature.effectivePum - anchorPum) / anchorPum) * 100).toFixed(1))
          : 0;

      const sizeNote =
        Math.abs(weightDiffPct) <= 4
          ? "Mismo tamaño"
          : `Tamaño cercano (${formatQty(item.signature.effectiveNetContent, item.signature.effectiveUnitMeasure)} vs ${formatQty(anchorQty, anchorSig.effectiveUnitMeasure)})`;
      const priceNote =
        priceDiffCop < 0
          ? `-${formatCopShort(priceDiffCop)} más barato`
          : priceDiffCop > 0
            ? `+${formatCopShort(priceDiffCop)}`
            : "Mismo precio";

      return {
        offer: item.sanitizedOffer,
        matchType: "equivalent_size",
        weightDiffPct,
        priceDiffCop,
        pumDiffPct,
        reasonLabel: `${sizeNote} · ${priceNote}`,
        effectiveNetContent: item.signature.effectiveNetContent,
        effectiveUnitMeasure: item.signature.effectiveUnitMeasure,
        effectivePum: item.signature.effectivePum,
        qualityTier: item.qualityTier,
        qualityLabel: item.qualityLabel,
        isCrossTier: false,
      };
    });

  const directStores = new Set(directCompetitors.map((d) => d.offer.storeId));
  const similarCompetitors: TieredCompetitorMatch[] =
    existingStoreIds.size >= 2 || directCompetitors.length > 0
      ? []
      : [...similarByStore.values()]
          .filter(({ item }) => !directStores.has(item.offer.storeId))
          .sort((a, b) => a.score - b.score)
          .slice(0, 2)
          .map(({ item, sameSubtype, isCrossTier }) => {
            const weightDiffPct =
              anchorQty > 0
                ? Math.round(((item.signature.effectiveNetContent - anchorQty) / anchorQty) * 100)
                : 0;
            const priceDiffCop = Math.round(item.sanitizedOffer.calibratedPrice - anchorPrice);
            const pumDiffPct =
              anchorPum > 0
                ? Number((((item.signature.effectivePum - anchorPum) / anchorPum) * 100).toFixed(1))
                : 0;

            let reasonLabel: string;
            if (!sameSubtype) {
              reasonLabel = `Alternativa similar (${formatQty(item.signature.effectiveNetContent, item.signature.effectiveUnitMeasure)})`;
            } else if (isCrossTier) {
              reasonLabel = `Gama ${item.qualityLabel} (${formatQty(item.signature.effectiveNetContent, item.signature.effectiveUnitMeasure)})`;
            } else if (weightDiffPct > 35) {
              reasonLabel = `Mayor tamaño en competencia (${formatQty(item.signature.effectiveNetContent, item.signature.effectiveUnitMeasure)} vs ${formatQty(anchorQty, anchorSig.effectiveUnitMeasure)})`;
            } else {
              reasonLabel = `Presentación distinta (${formatQty(item.signature.effectiveNetContent, item.signature.effectiveUnitMeasure)} vs ${formatQty(anchorQty, anchorSig.effectiveUnitMeasure)})`;
            }
            if (pumDiffPct <= -5) {
              reasonLabel += ` · ${pumDiffPct}% PUM`;
            }

            return {
              offer: item.sanitizedOffer,
              matchType: "similar_competitor",
              weightDiffPct,
              priceDiffCop,
              pumDiffPct,
              reasonLabel,
              effectiveNetContent: item.signature.effectiveNetContent,
              effectiveUnitMeasure: item.signature.effectiveUnitMeasure,
              effectivePum: item.signature.effectivePum,
              qualityTier: item.qualityTier,
              qualityLabel: item.qualityLabel,
              isCrossTier,
            };
          });

  // Tier 3: "Al por mayor" — formatos >= 1.6x más grandes en el mismo subtipo y MISMA gama que ahorran entre 4% y 65%
  const bulkCandidates: Array<BulkComparisonOption & { score: number }> = [];
  const seenBulkKeys = new Set<string>();

  const subtypeCandidates = includeBulk
    ? poolIndex.bySubtypeUnit.get(`${anchorSig.subtypeFamily}::${anchorSig.effectiveUnitMeasure}`) ?? []
    : [];

  for (const cand of subtypeCandidates) {
    const pairRule = getPairRuleType(anchor.offer.storeSkuId, cand.offer.storeSkuId, pairRuleMap);
    if (pairRule === "blocked_pair") continue;

    const candSig = cand.signature;
    if (cand.qualityTier !== anchor.qualityTier) {
      continue;
    }

    const sizeRatio = anchorQty > 0 ? candSig.effectiveNetContent / anchorQty : 0;
    if (sizeRatio < 1.6) continue;
    if (anchorPum <= 0 || candSig.effectivePum <= 0) continue;

    const pumSavingsPct = Number(
      (((anchorPum - candSig.effectivePum) / anchorPum) * 100).toFixed(1)
    );
    if (pumSavingsPct < 4 || pumSavingsPct > 65) continue;

    const equivalentAnchorTotalCop = Math.round(anchorPum * candSig.effectiveNetContent);
    const totalSavingsOnBulkCop = Math.round(
      equivalentAnchorTotalCop - cand.sanitizedOffer.calibratedPrice
    );
    if (totalSavingsOnBulkCop < 500) continue;

    const dedupKey = `${cand.offer.storeId}::${candSig.brandKey}::${Math.round(candSig.effectiveNetContent)}`;
    if (seenBulkKeys.has(dedupKey)) continue;
    seenBulkKeys.add(dedupKey);

    const sameBrandBonus = candSig.brandKey === anchorSig.brandKey ? 12 : 0;
    const score = pumSavingsPct + sameBrandBonus;

    bulkCandidates.push({
      offer: cand.sanitizedOffer,
      effectiveNetContent: candSig.effectiveNetContent,
      effectiveUnitMeasure: candSig.effectiveUnitMeasure,
      effectivePum: candSig.effectivePum,
      sizeRatio: Number(sizeRatio.toFixed(1)),
      pumSavingsPct,
      equivalentAnchorTotalCop,
      totalSavingsOnBulkCop,
      savingsLabel: `Llevando ${formatQty(candSig.effectiveNetContent, candSig.effectiveUnitMeasure)} ahorras ${formatCopShort(totalSavingsOnBulkCop)} (-${pumSavingsPct}% PUM)`,
      score,
    });
  }

  const bulkOptions: BulkComparisonOption[] = bulkCandidates
    .sort((a, b) => b.score - a.score || b.totalSavingsOnBulkCop - a.totalSavingsOnBulkCop)
    .slice(0, 2)
    .map(({ score: _score, ...option }) => option);

  return {
    directCompetitors,
    similarCompetitors,
    bulkOptions,
    substitutesCount,
    borderlinePumDoubt,
  };
}

/**
 * Construye tarjetas de comparación limpias respetando gama de calidad, atributos críticos,
 * límite de PUM ~1.95x y reglas de curación manual (/admin + reportes ciudadanos).
 */
function buildGroupsFromIndexedPool(
  dedupedPool: IndexedOffer[],
  poolIndex: IndexedMatchPool,
  pairRuleMap: Map<string, ComparisonPairRule>,
  mode: CompareMode
): ComparisonGroup[] {
  const buckets = new Map<string, IndexedOffer[]>();
  for (const item of dedupedPool) {
    const key = mode === "ean" ? getStrictGroupKey(item) : getPumGroupKey(item);
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }

  const groups: ComparisonGroup[] = [];

  for (const [groupId, items] of buckets.entries()) {
    const pickedOffers =
      mode === "ean"
        ? pickBestPerStore(items, 1, 6, pairRuleMap)
        : pickBestPerStore(items, 2, 6, pairRuleMap);
    if (pickedOffers.length === 0) continue;

    const anchorOffer = pickedOffers[0];
    const anchorIndexed =
      items.find((i) => i.offer.storeSkuId === anchorOffer.storeSkuId) ?? items[0];

    const bestPrice = Math.min(...pickedOffers.map((o) => o.calibratedPrice));
    const highestPrice = Math.max(...pickedOffers.map((o) => o.calibratedPrice));
    const bestPum = Math.min(...pickedOffers.map((o) => o.pumPrice));
    const highestPum = Math.max(...pickedOffers.map((o) => o.pumPrice));

    const realPums = pickedOffers.map((o) => {
      const yf = o.avgYieldFactor > 0 ? o.avgYieldFactor : 1;
      return o.pumPrice * yf;
    });
    const bestRealPum = Math.min(...realPums);
    const savingsPct =
      mode === "pum"
        ? highestPum > 0
          ? Math.round(((highestPum - bestPum) / highestPum) * 100)
          : 0
        : highestPrice > 0
          ? Math.round(((highestPrice - bestPrice) / highestPrice) * 100)
          : 0;

    const tiered = computeTieredMatches(anchorIndexed, pickedOffers, poolIndex, pairRuleMap, true);

    const isMultiBrandPum =
      mode === "pum" && new Set(items.map((i) => i.signature.brandKey)).size > 1;
    const title = isMultiBrandPum
      ? `${anchorIndexed.signature.familyLabel} · ${formatQty(anchorIndexed.signature.effectiveNetContent, anchorIndexed.signature.effectiveUnitMeasure)}`
      : anchorOffer.rawName;

    const subtitle =
      mode === "pum"
        ? `Equivalentes gama ${anchorIndexed.qualityLabel} por ${anchorIndexed.signature.effectiveUnitMeasure} (${pickedOffers.length} ofertas)`
        : `${anchorOffer.brand ?? "Marca comercial"} · ${formatQty(anchorIndexed.signature.effectiveNetContent, anchorIndexed.signature.effectiveUnitMeasure)}`;

    const mostVotedAnchor =
      [...pickedOffers].sort((a, b) => b.totalVotes - a.totalVotes)[0] ?? anchorOffer;

    const needsReview =
      anchorIndexed.needsReview ||
      (tiered.borderlinePumDoubt && anchorIndexed.reviewStatus !== "verified");
    const doubtReason =
      anchorIndexed.doubtReason ??
      (tiered.borderlinePumDoubt
        ? "Cruce cercano al límite 1.95x de PUM; recomendable revisar gama"
        : null);
    const reviewStatus: ReviewStatus =
      anchorIndexed.reviewStatus === "verified"
        ? "verified"
        : anchorIndexed.reviewStatus === "reported"
          ? "reported"
          : needsReview
            ? "needs_review"
            : anchorIndexed.reviewStatus;

    groups.push({
      groupId,
      title,
      subtitle,
      brand: isMultiBrandPum ? null : anchorOffer.brand,
      ean: mode === "ean" ? anchorOffer.ean : null,
      canonicalCategoryId: anchorOffer.canonicalCategoryId,
      canonicalSlug: anchorIndexed.signature.inferredCanonicalSlug ?? anchorOffer.canonicalSlug,
      canonicalName: anchorOffer.canonicalName ?? anchorIndexed.signature.familyLabel,
      netContent: anchorIndexed.signature.effectiveNetContent,
      unitMeasure: anchorIndexed.signature.effectiveUnitMeasure,
      imageUrl: pickedOffers.find((o) => o.imageUrl)?.imageUrl ?? null,
      bestPrice,
      highestPrice,
      savingsPct,
      bestPum,
      bestRealPum,
      positiveVotes: mostVotedAnchor.positiveVotes,
      totalVotes: mostVotedAnchor.totalVotes,
      avgYieldFactor: mostVotedAnchor.avgYieldFactor,
      invimaRegistry: pickedOffers.find((o) => o.invimaRegistry)?.invimaRegistry ?? null,
      actualManufacturer: pickedOffers.find((o) => o.actualManufacturer)?.actualManufacturer ?? null,
      shrinkflationAlert: pickedOffers.some((o) => o.shrinkflationAlert),
      previousNetContent:
        pickedOffers.find((o) => o.previousNetContent !== null)?.previousNetContent ?? null,
      offers: pickedOffers,
      signature: {
        broadFamily: anchorIndexed.signature.broadFamily,
        subtypeFamily: anchorIndexed.signature.subtypeFamily,
        familyLabel: anchorIndexed.signature.familyLabel,
        effectiveNetContent: anchorIndexed.signature.effectiveNetContent,
        effectiveUnitMeasure: anchorIndexed.signature.effectiveUnitMeasure,
        effectivePum: anchorIndexed.signature.effectivePum,
        qualityTier: anchorIndexed.qualityTier,
        qualityLabel: anchorIndexed.qualityLabel,
        criticalAttribute: anchorIndexed.signature.criticalAttribute ?? null,
        pumRatioVsMedian: anchorIndexed.pumRatioVsMedian,
        reviewStatus,
        needsReview,
        doubtReason,
      },
      directCompetitors: tiered.directCompetitors,
      similarCompetitors: tiered.similarCompetitors,
      bulkOptions: tiered.bulkOptions,
      substitutesCount: tiered.substitutesCount,
      qualityTier: anchorIndexed.qualityTier,
      qualityLabel: anchorIndexed.qualityLabel,
      criticalAttribute: anchorIndexed.signature.criticalAttribute ?? null,
      pumRatioVsMedian: anchorIndexed.pumRatioVsMedian,
      reviewStatus,
      needsReview,
      doubtReason,
    });
  }

  return groups.sort((a, b) => {
    const aReach =
      new Set([
        ...a.offers.map((o) => o.storeId),
        ...(a.directCompetitors ?? []).map((d) => d.offer.storeId),
      ]).size;
    const bReach =
      new Set([
        ...b.offers.map((o) => o.storeId),
        ...(b.directCompetitors ?? []).map((d) => d.offer.storeId),
      ]).size;

    const aTotalSignals =
      aReach * 10 +
      (a.similarCompetitors?.length ?? 0) * 3 +
      (a.bulkOptions?.length ?? 0) * 2;
    const bTotalSignals =
      bReach * 10 +
      (b.similarCompetitors?.length ?? 0) * 3 +
      (b.bulkOptions?.length ?? 0) * 2;

    if (bReach !== aReach) {
      return bReach - aReach;
    }
    if (bTotalSignals !== aTotalSignals) {
      return bTotalSignals - aTotalSignals;
    }
    return b.savingsPct - a.savingsPct || a.bestPrice - b.bestPrice;
  });
}

/**
 * Construye tarjetas de comparación limpias respetando gama de calidad, atributos críticos,
 * límite de PUM ~1.95x y reglas de curación manual (/admin + reportes ciudadanos).
 */
export function buildMultiTierComparisonGroups(
  rawOffers: StoreOffer[],
  mode: CompareMode,
  curationContext?: CurationContext
): ComparisonGroup[] {
  const dedupedPool = deduplicateStoreOffers(rawOffers, curationContext);
  if (dedupedPool.length === 0) {
    return [];
  }
  const pairRuleMap = buildPairRuleMap(curationContext?.pairRules);
  const poolIndex = buildIndexedMatchPool(dedupedPool, curationContext?.pairRules);
  return buildGroupsFromIndexedPool(dedupedPool, poolIndex, pairRuleMap, mode);
}

/**
 * Deduplica una sola vez y devuelve tanto `eanGroups` como `pumGroups` (mitad de CPU en edge workers).
 */
export function buildBothComparisonModes(
  rawOffers: StoreOffer[],
  curationContext?: CurationContext
): { eanGroups: ComparisonGroup[]; pumGroups: ComparisonGroup[] } {
  const dedupedPool = deduplicateStoreOffers(rawOffers, curationContext);
  if (dedupedPool.length === 0) {
    return { eanGroups: [], pumGroups: [] };
  }
  const pairRuleMap = buildPairRuleMap(curationContext?.pairRules);
  const poolIndex = buildIndexedMatchPool(dedupedPool, curationContext?.pairRules);
  return {
    eanGroups: buildGroupsFromIndexedPool(dedupedPool, poolIndex, pairRuleMap, "ean"),
    pumGroups: buildGroupsFromIndexedPool(dedupedPool, poolIndex, pairRuleMap, "pum"),
  };
}

/**
 * Construye el catálogo completo para la vista visual `/admin` con estado de gama,
 * dudas automáticas, mediana de PUM por subtipo y cruces directos/similares activos.
 */
export function buildAdminCatalogItems(
  rawOffers: StoreOffer[],
  curationContext?: CurationContext
): AdminCatalogItem[] {
  const dedupedPool = deduplicateStoreOffers(rawOffers, curationContext);
  const pairRuleMap = buildPairRuleMap(curationContext?.pairRules);
  const poolIndex = buildIndexedMatchPool(dedupedPool, curationContext?.pairRules);

  const items: AdminCatalogItem[] = dedupedPool.map((item) => {
    const tiered = computeTieredMatches(
      item,
      [item.sanitizedOffer],
      poolIndex,
      pairRuleMap,
      false
    );

    const toMatchSummary = (m: TieredCompetitorMatch): AdminActiveMatchSummary => ({
      storeSkuId: m.offer.storeSkuId,
      storeName: m.offer.storeName,
      storeSlug: m.offer.storeId,
      productTitle: m.offer.rawName,
      priceCop: m.offer.calibratedPrice,
      pum: m.effectivePum,
      unitMeasure: m.effectiveUnitMeasure,
      matchType: m.matchType,
      qualityTier: m.qualityTier ?? "estandar",
      isCrossTier: Boolean(m.isCrossTier),
    });

    const needsReview =
      item.needsReview ||
      (tiered.borderlinePumDoubt && item.reviewStatus !== "verified");
    const doubtReason =
      item.doubtReason ??
      (tiered.borderlinePumDoubt
        ? "Cruce directo entre 1.75x y 1.95x de PUM; conviene confirmar gama"
        : null);
    const reviewStatus: ReviewStatus =
      item.reviewStatus === "verified"
        ? "verified"
        : item.reviewStatus === "reported"
          ? "reported"
          : needsReview
            ? "needs_review"
            : item.reviewStatus;

    return {
      offer: item.sanitizedOffer,
      signature: item.signature,
      qualityTier: item.qualityTier,
      qualityLabel: item.qualityLabel,
      criticalAttribute: item.signature.criticalAttribute ?? null,
      subtypeMedianPum: item.subtypeMedianPum,
      pumRatioVsMedian: item.pumRatioVsMedian,
      reviewStatus,
      needsReview,
      doubtReason,
      hasOverride: Boolean(item.override),
      adminNotes: item.override?.adminNotes ?? null,
      directMatches: tiered.directCompetitors.map(toMatchSummary),
      similarMatches: tiered.similarCompetitors.map(toMatchSummary),
    };
  });

  // Además incluimos SKUs marcados como 'excluded' en overrides para poder restaurarlos desde /admin
  const overrides = curationContext?.overridesBySkuId ?? {};
  const includedIds = new Set(items.map((i) => i.offer.storeSkuId));
  for (const offer of rawOffers) {
    if (includedIds.has(offer.storeSkuId)) continue;
    const ov = overrides[offer.storeSkuId];
    if (ov?.reviewStatus !== "excluded") continue;
    includedIds.add(offer.storeSkuId);
    const sig = extractProductSignature(offer, ov);
    const tier = ov.overrideQualityTier ?? "estandar";
    items.push({
      offer: {
        ...offer,
        rawName: cleanProductTitle(offer.rawName),
        rawUrl: offer.rawUrl ? (sanitizeExternalUrl(offer.rawUrl) ?? "") : offer.rawUrl,
        imageUrl: offer.imageUrl ? sanitizeExternalUrl(offer.imageUrl) : null,
      },
      signature: sig,
      qualityTier: tier,
      qualityLabel: QUALITY_TIER_LABELS[tier],
      criticalAttribute: sig.criticalAttribute ?? null,
      subtypeMedianPum: null,
      pumRatioVsMedian: null,
      reviewStatus: "excluded",
      needsReview: false,
      doubtReason: ov.doubtReason ?? "Excluido manualmente del catálogo público",
      hasOverride: true,
      adminNotes: ov.adminNotes ?? null,
      directMatches: [],
      similarMatches: [],
    });
  }

  return items;
}
