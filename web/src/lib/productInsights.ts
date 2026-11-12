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
  /\b(televisor|smart\s*tv|qled|oled|celular|smartphone|iphone|tablet|ipad|portatil|computador|laptop|proyector|videoproyector|impresora|audifonos?|parlante|subwoofer|reloj\s+inteligente|smartwatch|nevera|nevecon|minibar|estufa|microondas|freidora\s+de\s+aire|sandwichera|sanduchera|licuadora|cafetera|calentador\s+de\s+agua|aire\s+acondicionado|ventilador|cortadora\s+de\s+cabello|colchon|colchoneta|sabana\s+(?:cannon|fatelares|distrihogar|sencilla|doble|king|queen)|camisa|camiseta|pantalon|chaqueta|vestido|blusa|falda|juguete|rompecabezas|lego|triciclo|bicicleta|patineta|llanta|casco\s+moto|guante\s+moto|motocicleta|taladro|guirnalda|adorno\s+navideno|papel\s+regalo|sombrilla|paraguas|morral|maleta|base\s+liquida)\b/i;

const NON_GROCERY_URL_RE =
  /\/(tecnologia|electrodomesticos|celulares|computadores|televisores|jugueteria|moda|ropa|calzado|deportes|colchones|muebles|ferreteria|automotores|llantas|motos|decoracion)\//i;

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
