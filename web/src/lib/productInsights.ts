import type { BankPromotion, StoreOffer } from "@/lib/types";

export interface SteamBadge {
  label: string;
  tone: "steam-high" | "steam-mid" | "steam-mixed" | "steam-low" | "steam-none";
  positivePct: number | null;
}

export interface RealUsageMetrics {
  avgYieldFactor: number;
  nominalPrice: number;
  realUsagePrice: number;
  nominalPum: number;
  realAdjustedPum: number;
  yieldLabel: string | null;
}

export interface EvaluatedBankPromotion {
  promo: BankPromotion;
  discountedPrice: number;
  savingsCop: number;
}

/**
 * Clasifica la reputación binaria estilo Steam según `positive_votes / total_votes`.
 */
export function getSteamRatingBadge(positiveVotes: number, totalVotes: number): SteamBadge {
  if (totalVotes <= 0) {
    return { label: "Sin reseñas aún", tone: "steam-none", positivePct: null };
  }
  const pct = Math.round((positiveVotes / totalVotes) * 100);
  if (pct >= 95 && totalVotes >= 20) {
    return { label: "Extremadamente positivo", tone: "steam-high", positivePct: pct };
  }
  if (pct >= 80) {
    return { label: "Muy positivo", tone: "steam-high", positivePct: pct };
  }
  if (pct >= 70) {
    return { label: "Mayormente positivo", tone: "steam-mid", positivePct: pct };
  }
  if (pct >= 40) {
    return { label: "Variado", tone: "steam-mixed", positivePct: pct };
  }
  return { label: "Mayormente negativo", tone: "steam-low", positivePct: pct };
}

/**
 * Calcula PUM Real Ajustado y Costo Real por Uso multiplicando por `avg_yield_factor`.
 */
export function computeRealUsageMetrics(
  calibratedPrice: number,
  pumPrice: number,
  avgYieldFactor: number
): RealUsageMetrics {
  const safeYield = avgYieldFactor > 0 ? avgYieldFactor : 1;
  const realUsagePrice = Math.round(calibratedPrice * safeYield);
  const realAdjustedPum = Number((pumPrice * safeYield).toFixed(4));

  let yieldLabel: string | null = null;
  if (safeYield <= 0.65) {
    yieldLabel = "Rinde el doble · Ahorro invisible";
  } else if (safeYield < 0.98) {
    yieldLabel = "Mayor rendimiento real";
  } else if (safeYield > 1.15) {
    yieldLabel = "Rinde menos por uso";
  }

  return {
    avgYieldFactor: safeYield,
    nominalPrice: calibratedPrice,
    realUsagePrice,
    nominalPum: pumPrice,
    realAdjustedPum,
    yieldLabel,
  };
}

/**
 * Cruza el día actual de la semana (`0..6`) contra `bank_promotions` activas para tienda y categoría.
 */
export function findActiveBankPromotions(
  offer: Pick<StoreOffer, "storeId" | "canonicalCategoryId" | "calibratedPrice">,
  promotions: BankPromotion[],
  dayOfWeek: number = new Date().getDay()
): EvaluatedBankPromotion[] {
  return promotions
    .filter((promo) => {
      if (!promo.active) return false;
      if (!promo.validDays.includes(dayOfWeek)) return false;
      if (promo.storeId && promo.storeId !== offer.storeId) return false;
      if (
        promo.canonicalCategoryId !== null &&
        promo.canonicalCategoryId !== offer.canonicalCategoryId
      ) {
        return false;
      }
      return true;
    })
    .map((promo) => {
      const discountedPrice = Math.max(
        0,
        Math.round(offer.calibratedPrice * (1 - promo.discountPct / 100))
      );
      return {
        promo,
        discountedPrice,
        savingsCop: Math.max(0, Math.round(offer.calibratedPrice - discountedPrice)),
      };
    })
    .sort((a, b) => b.promo.discountPct - a.promo.discountPct);
}

/**
 * Elimina frases repetidas consecutivas frecuentes en catálogos externos y normaliza espacios.
 */
export function cleanProductTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized.replace(/^(.{8,}?)\s+\1$/i, "$1").trim();
}

const SPANISH_CONNECTORS = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "e",
  "el",
  "en",
  "la",
  "las",
  "los",
  "o",
  "para",
  "por",
  "sin",
  "u",
  "y",
]);

const PRESERVED_UPPERCASE = new Set([
  "D1",
  "ARA",
  "OXXO",
  "UHT",
  "AA",
  "AAA",
  "BBQ",
  "UV",
  "SPF",
  "HD",
  "XL",
  "XXL",
  "PH",
  "LED",
  "USA",
  "VIP",
]);

/**
 * Simplifica títulos largos eliminando gramaje repetido (cuando ya está capturado) y homogeneiza
 * mayúsculas iniciales respetando conectores en español.
 */
export function simplifyProductDisplayName(
  rawName: string,
  unitMeasure?: string | null
): string {
  const base = cleanProductTitle(rawName);
  if (!base) return "";

  const unitLow = (unitMeasure ?? "").toLowerCase();
  let cleaned = base
    .replace(/^(?:oferta|super\s+oferta|promo(?:cion)?)\s+/i, "")
    .replace(
      /\(\s*(?:aprox\.?\s*)?(?:x\s*)?\d+(?:[.,]\d+)?\s*(?:g|gr|grs|gramos?|kg|kilos?|ml|cc|l|lt|lts|litros?|und|unds|un|unidad|unidades)\s*\)/gi,
      " "
    );

  if (unitLow === "g" || unitLow === "ml" || unitLow === "") {
    cleaned = cleaned.replace(
      /\b(?:x\s*)?\d+(?:[.,]\d+)?\s*(?:g|gr|grs|gramos?|kg|kilos?|ml|cc|l|lt|lts|litros?)\s*[xX×]\s*(\d+)\s*(?:und|unds|un|unidades?)?\b/gi,
      " x$1 "
    );
  }

  cleaned = cleaned.replace(
    /(?:^|\s)(?:x\s*)?\d+(?:[.,]\d+)?\s*(?:g|gr|grs|gramos?|kg|kilos?|ml|cc|l|lt|lts|litros?)(?=\s|$|[,.;/\)])/gi,
    " "
  );

  if (unitLow === "und") {
    cleaned = cleaned.replace(/(?:^|\s)(?:[xX×]\s*)?\d+\s*(?:und|unds|un|unidad|unidades)\b/gi, " ");
  } else {
    cleaned = cleaned.replace(
      /(?:^|\s)(?:[xX×]\s*)?(\d+)\s*(?:und|unds|un|unidad|unidades)\b/gi,
      (_, n: string) => (Number(n) <= 1 ? "" : ` x${n}`)
    );
  }

  cleaned = cleaned
    .replace(/\b(?:caj\s*1\s*fra|caj|fra|bsa|pte|unds?|unidad(?:es)?)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[,/|·-]+|[,/|·-]+$/g, "")
    .trim()
    .replace(/(?:\s+(?:de|del|en|por|con|para|a|al|x))+$/i, "")
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !/^[xX×]\d+$/.test(w) && w.length >= 2);
  const finalWords = (meaningful.length >= 2 ? words : base.split(/\s+/)).filter(Boolean);

  return finalWords
    .map((word, idx) => {
      const packMatch = word.match(/^[xX×](\d+)$/);
      if (packMatch) return `x${packMatch[1]}`;
      const core = word.replace(/^[.,;:-]+|[.,;:-]+$/g, "");
      if (PRESERVED_UPPERCASE.has(core.toUpperCase())) {
        return word.replace(core, core.toUpperCase());
      }
      const norm = core
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      if (idx > 0 && SPANISH_CONNECTORS.has(norm)) {
        return norm;
      }
      if (!core) return word;
      if (/\d/.test(core)) {
        return word === word.toUpperCase() ? core.toLowerCase() : word;
      }
      const titled = core.charAt(0).toUpperCase() + core.slice(1).toLowerCase();
      return word.replace(core, titled);
    })
    .join(" ");
}

export function getOfferDisplayTitle(
  offer: Pick<StoreOffer, "rawName" | "displayName" | "unitMeasure">
): string {
  const persisted = (offer.displayName ?? "").trim();
  if (persisted) return persisted;
  return simplifyProductDisplayName(offer.rawName, offer.unitMeasure);
}

/**
 * Valida que una URL externa utilice exclusivamente protocolo http: o https:.
 */
export function sanitizeExternalUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "#";
    }
    return parsed.toString();
  } catch {
    return "#";
  }
}

/**
 * Añade atribución de afiliado en URLs externas seguras de supermercados compatibles.
 */
export function buildStoreAffiliateUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "#";
    }
    if (!parsed.searchParams.has("utm_source")) {
      parsed.searchParams.set("utm_source", "mercasabio");
      parsed.searchParams.set("utm_medium", "affiliate");
    }
    return parsed.toString();
  } catch {
    return "#";
  }
}

export const GROCERY_STORE_IDS = new Set([
  "carulla",
  "d1",
  "olimpica",
  "exito",
  "ara",
  "farmatodo",
  "euro",
  "oxxo",
  "mercaldas",
  "isimo",
  "zapatoca",
  "makro",
  "megatiendas",
  "mercacentro",
  "jumbo",
  "canaveral",
  "mxm",
  "supermu",
  "superboom",
  "mercamio",
  "belalcazar",
  "amy",
  "metro",
  "rappi",
]);

const NON_GROCERY_BRANDS = new Set([
  "samsung",
  "lg",
  "haceb",
  "mabe",
  "challenger",
  "whirlpool",
  "electrolux",
  "hisense",
  "caixun",
  "hyundai",
  "epson",
  "acer",
  "lenovo",
  "hp",
  "asus",
  "xiaomi",
  "motorola",
  "nokia",
  "infinix",
  "esenses",
  "maxell",
  "cubitt",
  "mykronoz",
  "vta",
  "sylvania",
  "topluz",
  "ilumax",
  "sonya",
  "olimpo",
  "imusa",
  "t-fal",
  "tefal",
  "black+decker",
  "oster",
  "hamilton beach",
  "ninja",
  "nutribullet",
  "mr. coffee",
  "midea",
  "conair",
  "remington",
  "revlon",
  "mattel",
  "hasbro",
  "barbie",
  "hot wheels",
  "nerf",
  "play doh",
  "play-doh",
  "fisher price",
  "fisher-price",
  "lego",
  "paw patrol",
  "batman",
  "monopoly",
  "simoniz",
  "cristar",
  "comodisimos",
  "espumados",
  "cannon",
  "fatelares",
  "distrihogar",
  "samsonite",
  "totto",
  "jsn",
  "new balance",
  "covergirl",
  "maybelline",
  "vogue",
  "red flag",
]);

const NON_GROCERY_TEXT_RE =
  /\b(televisor|smart\s*tv|qled|oled|celular|smartphone|iphone|tablet|ipad|portatil|computador|laptop|proyector|videoproyector|impresora|audifonos?|parlante|subwoofer|reloj\s+inteligente|smartwatch|nevera|nevecon|minibar|estufa|microondas|freidora\s+de\s+aire|sandwichera|sanduchera|licuadora|cafetera|calentador\s+de\s+agua|aire\s+acondicionado|ventilador|cortadora\s+de\s+cabello|colchon|colchoneta|sabana\s+(?:cannon|fatelares|distrihogar|sencilla|doble|king|queen)|camisa|camiseta|pantalon|chaqueta|vestido|blusa|falda|juguete|rompecabezas|lego|triciclo|bicicleta|patineta|llanta|casco\s+moto|guante\s+moto|motocicleta|taladro|guirnalda|adorno\s+navideno|papel\s+regalo|sombrilla|paraguas|morral|maleta|bolso\s+de\s+tenis|delantal\s+(?:behome|jean|cocina|parrillero)|base\s+liquida|esmalte\s+(?:de\s+)?unas|polvo\s+compacto|rubor\s+(?:compacto|liquido|en\s+crema|mineral)|labial\s+(?:mate|liquido|brillo|cremoso|hydra)|pestanina|mascara\s+de\s+pestanas|eau\s+de\s+(?:parfum|toilette)|perfume\s+(?:hombre|mujer|caballero|dama)|oso\s+de\s+peluche|wd-40|alfombra\s+de\s+bano|whisky|whiskey|vodka|tequila|ginebra|brandy|cognac|aguardiente|champana|champagne|prosecco|cervezas?|licor(?:es)?|crema\s+de\s+whisky|(?<!vinagre\sde\s)vino\s+(?:tinto|blanco|rosado|espumoso|seco|dulce|importado|carmenere|cabernet|merlot|malbec|sauvignon|chardonnay)|ron\s+(?:caldas|medellin|santa\s+fe|viejo|anejo|blanco|dorado|bacardi|havana|zacapa|hechicera|dictador|diplomatico)|cigarrillos?|cajetilla|tabaco|vaper|vapeador(?:es)?|vaporizador(?:es)?\s+(?:de\s+)?nicotina|e-?liquid|medicamentos?|acetaminofen|ibuprofeno|naproxeno|dolex|advil|aspirina|loratadina|cetirizina|desloratadina|omeprazol|esomeprazol|buscapina|sal\s+de\s+frutas|pepto\s+bismol|jarabe\s+(?:para\s+la\s+tos|expectorante)|suero\s+oral|pedialyte|hidraplus|electrolit\s+suero|curitas|vendaje|gasa\s+esteril|isodine|tensiometro|jeringa|preservativo|condon|prueba\s+de\s+embarazo|incontinencia|panal(?:es)?\s+(?:de\s+|para\s+)?adulto|tena\s+(?:pants|slip|discreet|lady|men|protector|toalla|ropa)|plenitud|cotidian|lubricante\s+(?:intimo|sexual|personal)|gel\s+lubricante|calzon(?:cito)?\s+entrenador|pantalon(?:cito)?\s+entrenador|asiento\s+entrenador|tapete\s+entrenador|alfombra\s+(?:sala|decorativa|piso|bano|[0-9]+)|tapete\s+(?:decorativo|bano|entrada|piso)|caminadora\s+para\s+bebe|coche\s+para\s+bebe|silla\s+de\s+carro)\b/i;

const NON_GROCERY_URL_RE =
  /\/(tecnologia|electrodomesticos|celulares|computadores|televisores|jugueteria|moda|ropa|calzado|deportes|colchones|muebles|ferreteria|automotores|llantas|motos|decoracion|vinos-y-licores|licores|cervezas|cigarrillos|medicamentos|drogueria|farmacia|variedades|pinturas|pisos-y-paredes|belleza|maquillaje|coches-y-sillas|cuarto-del-bebe|ropa-bebes|incontinencia|bienestar-sexual|salud-sexual|lubricantes|preservativos|entrenadores|alfombras|tapetes)\//i;

function normalizeAccentLower(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function isGroceryStoreId(storeId: string | null | undefined): boolean {
  return GROCERY_STORE_IDS.has((storeId ?? "").trim().toLowerCase());
}

/**
 * Guardia defensiva en TypeScript para filtrar exclusivamente ofertas y cadenas de mercado.
 */
export function isMercadoOffer(offer: {
  storeId: string;
  rawName: string;
  brand?: string | null;
  rawUrl?: string | null;
}): boolean {
  if (!isGroceryStoreId(offer.storeId)) {
    return false;
  }
  const brandNorm = normalizeAccentLower(offer.brand);
  if (brandNorm && NON_GROCERY_BRANDS.has(brandNorm)) {
    return false;
  }
  if (offer.rawUrl && NON_GROCERY_URL_RE.test(offer.rawUrl)) {
    return false;
  }
  const nameNorm = normalizeAccentLower(offer.rawName);
  if (!nameNorm) {
    return false;
  }
  if (/\bmunec[oa]s?\b/.test(nameNorm) && !/\bla\s+muneca\b/.test(nameNorm)) {
    return false;
  }
  if (/\b(lavadora|secadora)\b/.test(nameNorm) && !/\bgoma\s+secadora\b/.test(nameNorm)) {
    return false;
  }
  return !NON_GROCERY_TEXT_RE.test(nameNorm);
}
