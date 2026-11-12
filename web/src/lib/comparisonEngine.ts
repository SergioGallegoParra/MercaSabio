import type {
  BulkComparisonOption,
  CompareMode,
  ComparisonGroup,
  ProductSignatureSummary,
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
}

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
    match: /\barroz\b.*\b(coco|pollo|paella|mix|risotto|verduras|ajonjoli)\b/,
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

    // En Colombia "1.000 gr" o "2.500 g" representa miles; "1.5 lt" representa decimales
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

  // Fallback si la marca no llegó explícita
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

  // Deduplica palabras consecutivas (D1 a veces duplica el nombre en el raw_name)
  const unique = [...new Set(tokens)].sort().slice(0, 6);
  return unique.join("-") || "std";
}

function inferFamily(
  normalizedText: string,
  unitMeasure: UnitMeasure,
  canonicalSlug: string | null
): {
  subtypeFamily: string;
  broadFamily: string;
  familyLabel: string;
  inferredCanonicalSlug: string | null;
} {
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

export function extractProductSignature(offer: StoreOffer): ExtractedSignature {
  const cleanTitle = cleanProductTitle(offer.rawName);
  const normalizedText = normalizeComparableText(cleanTitle);
  const { qty, unit } = parseWeightFallback(offer.rawName, offer.netContent, offer.unitMeasure);
  const effectivePum = qty > 0 && offer.calibratedPrice > 0 ? offer.calibratedPrice / qty : offer.pumPrice;
  const family = inferFamily(normalizedText, unit, offer.canonicalSlug);
  const brandKey = normalizeBrandKey(offer.brand, normalizedText);
  const variantTokensKey = extractVariantKey(normalizedText, brandKey);

  // Huella única de producto dentro de una tienda para eliminar repeticiones
  const roundedQty = qty >= 50 ? Math.round(qty) : Number(qty.toFixed(1));
  const skuFingerprint = `${offer.storeId}::${brandKey}::${family.subtypeFamily}::${roundedQty}${unit}::${variantTokensKey}`;

  return {
    broadFamily: family.broadFamily,
    subtypeFamily: family.subtypeFamily,
    familyLabel: family.familyLabel,
    effectiveNetContent: qty,
    effectiveUnitMeasure: unit,
    effectivePum,
    normalizedText,
    brandKey,
    variantTokensKey,
    skuFingerprint,
    inferredCanonicalSlug: family.inferredCanonicalSlug,
  };
}

interface IndexedOffer {
  offer: StoreOffer;
  signature: ExtractedSignature;
  sanitizedOffer: StoreOffer;
}

function compareOfferPriority(a: IndexedOffer, b: IndexedOffer): number {
  if (a.offer.inStock !== b.offer.inStock) {
    return a.offer.inStock ? -1 : 1;
  }
  if (a.offer.calibratedPrice !== b.offer.calibratedPrice) {
    return a.offer.calibratedPrice - b.offer.calibratedPrice;
  }
  return a.signature.effectivePum - b.signature.effectivePum;
}

/**
 * Elimina filas repetidas dentro de cada cadena manteniendo la oferta vigente más económica.
 */
export function deduplicateStoreOffers(offers: StoreOffer[]): IndexedOffer[] {
  const bySkuId = new Map<string, IndexedOffer>();
  for (const offer of offers) {
    if (!Number.isFinite(offer.calibratedPrice) || offer.calibratedPrice <= 0) {
      continue;
    }
    const cleanTitle = cleanProductTitle(offer.rawName);
    const sig = extractProductSignature(offer);
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
    const candidate: IndexedOffer = { offer, signature: sig, sanitizedOffer };
    if (!existingId || compareOfferPriority(candidate, existingId) < 0) {
      bySkuId.set(offer.storeSkuId, candidate);
    }
  }

  const byFingerprint = new Map<string, IndexedOffer>();
  for (const item of bySkuId.values()) {
    const existing = byFingerprint.get(item.signature.skuFingerprint);
    if (!existing || compareOfferPriority(item, existing) < 0) {
      byFingerprint.set(item.signature.skuFingerprint, item);
    }
  }

  return [...byFingerprint.values()];
}

function areWeightsClose(qtyA: number, qtyB: number, toleranceRatio = 0.35): boolean {
  if (qtyA <= 0 || qtyB <= 0) return false;
  const ratio = qtyB / qtyA;
  return ratio >= 1 - toleranceRatio && ratio <= 1 + toleranceRatio;
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
  // Si el EAN es válido (8+ dígitos), agrupamos solo si subtipo y peso coinciden (~15%), evitando fusiones erróneas de trgm
  if (/^\d{8,14}$/.test(ean)) {
    return `ean:${ean}:${signature.subtypeFamily}:${roundQtyBucket(roundedQty)}${signature.effectiveUnitMeasure}`;
  }
  return `sku:${signature.brandKey}:${signature.subtypeFamily}:${roundedQty}${signature.effectiveUnitMeasure}`;
}

function getPumGroupKey(item: IndexedOffer): string {
  const { signature } = item;
  const bucket = roundQtyBucket(signature.effectiveNetContent);
  return `pum:${signature.subtypeFamily}:${bucket}${signature.effectiveUnitMeasure}`;
}

function pickBestPerStore(
  candidates: IndexedOffer[],
  maxPerStore = 1,
  maxTotal = 6
): StoreOffer[] {
  const sorted = [...candidates].sort(compareOfferPriority);
  const perStoreCounts = new Map<string, number>();
  const perStoreBrands = new Set<string>();
  const picked: StoreOffer[] = [];

  for (const item of sorted) {
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

function computeTieredMatches(
  anchor: IndexedOffer,
  anchorGroupOffers: StoreOffer[],
  pool: IndexedOffer[]
): {
  directCompetitors: TieredCompetitorMatch[];
  similarCompetitors: TieredCompetitorMatch[];
  bulkOptions: BulkComparisonOption[];
  substitutesCount: number;
} {
  const existingStoreIds = new Set(anchorGroupOffers.map((o) => o.storeId));
  const existingSkuIds = new Set(anchorGroupOffers.map((o) => o.storeSkuId));
  const anchorSig = anchor.signature;
  const anchorQty = anchorSig.effectiveNetContent;
  const anchorPrice = anchor.sanitizedOffer.calibratedPrice;
  const anchorPum = anchorSig.effectivePum;

  // Tier 1: Competencia directa en OTRA tienda con peso/volumen cercano (±35%) y mismo subtipo
  const directByStore = new Map<string, { item: IndexedOffer; score: number }>();
  // Tier 2: Producto más parecido en OTRA tienda (cuando no hay peso cercano, o calidad/subtipo alterno)
  const similarByStore = new Map<string, { item: IndexedOffer; score: number; sameSubtype: boolean }>();
  // Conteo total de sustitutos compatibles (mismo broadFamily & unit)
  let substitutesCount = 0;

  for (const cand of pool) {
    if (existingSkuIds.has(cand.offer.storeSkuId) || !cand.offer.inStock) {
      continue;
    }
    const candSig = cand.signature;
    if (candSig.effectiveUnitMeasure !== anchorSig.effectiveUnitMeasure) {
      continue;
    }

    const sameSubtype = candSig.subtypeFamily === anchorSig.subtypeFamily;
    const sameBroad = candSig.broadFamily === anchorSig.broadFamily;
    if (!sameSubtype && !sameBroad) {
      continue;
    }

    substitutesCount += 1;

    // Solo competencia en tiendas distintas a las ya presentes como oferta exacta en la tarjeta
    if (existingStoreIds.has(cand.offer.storeId)) {
      continue;
    }

    const qtyRatio = anchorQty > 0 ? candSig.effectiveNetContent / anchorQty : 1;
    const logDist = Math.abs(Math.log(Math.max(qtyRatio, 0.05)));

    if (sameSubtype && areWeightsClose(anchorQty, candSig.effectiveNetContent, 0.35)) {
      const sameBrandBonus = candSig.brandKey === anchorSig.brandKey ? 0 : 0.25;
      const pumRatio = anchorPum > 0 ? candSig.effectivePum / anchorPum : 1;
      const score = sameBrandBonus + logDist * 2.2 + pumRatio * 0.4;
      const prev = directByStore.get(cand.offer.storeId);
      if (!prev || score < prev.score) {
        directByStore.set(cand.offer.storeId, { item: cand, score });
      }
    } else {
      // Fallback similar: prioriza mismo subtipo, luego distancia logarítmica de tamaño, luego PUM
      const subtypePenalty = sameSubtype ? 0 : 1.5;
      const pumRatio = anchorPum > 0 ? candSig.effectivePum / anchorPum : 1;
      const score = subtypePenalty + logDist * 1.4 + pumRatio * 0.35;
      const prev = similarByStore.get(cand.offer.storeId);
      if (!prev || score < prev.score) {
        similarByStore.set(cand.offer.storeId, { item: cand, score, sameSubtype });
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
      };
    });

  // Solo mostramos Tier 2 "Más parecido en competencia" para tiendas sin Tier 1 directo
  const directStores = new Set(directCompetitors.map((d) => d.offer.storeId));
  const similarCompetitors: TieredCompetitorMatch[] =
    existingStoreIds.size >= 2 || directCompetitors.length > 0
      ? []
      : [...similarByStore.values()]
          .filter(({ item }) => !directStores.has(item.offer.storeId))
          .sort((a, b) => a.score - b.score)
          .slice(0, 2)
          .map(({ item, sameSubtype }) => {
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
            };
          });

  // Tier 3: "Al por mayor" — formatos >= 1.6x más grandes en el mismo subtipo que ahorran >= 4% en PUM
  const bulkCandidates: Array<BulkComparisonOption & { score: number }> = [];
  const seenBulkKeys = new Set<string>();

  for (const cand of pool) {
    if (!cand.offer.inStock) continue;
    const candSig = cand.signature;
    if (
      candSig.subtypeFamily !== anchorSig.subtypeFamily ||
      candSig.effectiveUnitMeasure !== anchorSig.effectiveUnitMeasure
    ) {
      continue;
    }

    const sizeRatio = anchorQty > 0 ? candSig.effectiveNetContent / anchorQty : 0;
    if (sizeRatio < 1.6) continue;
    if (anchorPum <= 0 || candSig.effectivePum <= 0) continue;

    const pumSavingsPct = Number(
      (((anchorPum - candSig.effectivePum) / anchorPum) * 100).toFixed(1)
    );
    if (pumSavingsPct < 4) continue;

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
  };
}

/**
 * Construye tarjetas de comparación limpias:
 * - Cero ofertas duplicadas dentro de una misma cadena
 * - Tier 1: Competencia directa más cercana en peso y precio
 * - Tier 2: Alternativa más parecida en competencia cuando no hay peso igual
 * - Tier 3: Opciones al por mayor (formatos grandes con ahorro real en PUM)
 */
export function buildMultiTierComparisonGroups(
  rawOffers: StoreOffer[],
  mode: CompareMode
): ComparisonGroup[] {
  const dedupedPool = deduplicateStoreOffers(rawOffers);
  if (dedupedPool.length === 0) {
    return [];
  }

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
      mode === "ean" ? pickBestPerStore(items, 1, 6) : pickBestPerStore(items, 2, 6);
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

    const tiered = computeTieredMatches(anchorIndexed, pickedOffers, dedupedPool);

    const isMultiBrandPum =
      mode === "pum" && new Set(items.map((i) => i.signature.brandKey)).size > 1;
    const title = isMultiBrandPum
      ? `${anchorIndexed.signature.familyLabel} · ${formatQty(anchorIndexed.signature.effectiveNetContent, anchorIndexed.signature.effectiveUnitMeasure)}`
      : anchorOffer.rawName;

    const subtitle =
      mode === "pum"
        ? `Equivalentes por ${anchorIndexed.signature.effectiveUnitMeasure} (${pickedOffers.length} ofertas)`
        : `${anchorOffer.brand ?? "Marca comercial"} · ${formatQty(anchorIndexed.signature.effectiveNetContent, anchorIndexed.signature.effectiveUnitMeasure)}`;

    const mostVotedAnchor =
      [...pickedOffers].sort((a, b) => b.totalVotes - a.totalVotes)[0] ?? anchorOffer;

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
      },
      directCompetitors: tiered.directCompetitors,
      similarCompetitors: tiered.similarCompetitors,
      bulkOptions: tiered.bulkOptions,
      substitutesCount: tiered.substitutesCount,
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
