import { buildMultiTierComparisonGroups } from "@/lib/comparisonEngine";
import { cleanProductTitle, isGroceryStoreId, isMercadoOffer } from "@/lib/productInsights";
import { getSupabaseConfig, supabaseRestGet, supabaseRpc } from "@/lib/supabase";
import type {
  BankPromotion,
  CanonicalCategoryOption,
  CompareMode,
  ComparisonGroup,
  DashboardPayload,
  NearbyStoreBranch,
  StoreOffer,
  UnitMeasure,
} from "@/lib/types";

interface LatestPriceRow {
  store_sku_id: string;
  store_id: string;
  store_name: string;
  channel_type: string;
  markup_discount_factor: string | number;
  master_product_id: string;
  canonical_category_id: number | null;
  raw_name: string;
  raw_url: string | null;
  normalized_name: string;
  brand: string | null;
  ean: string | null;
  net_content: string | number;
  unit_measure: UnitMeasure;
  calibrated_price: string | number;
  raw_list_price: string | number;
  raw_sale_price: string | number;
  pum_price: string | number;
  in_stock: boolean;
  source_origin: string;
  is_private_label: boolean;
  image_url: string | null;
  canonical_slug: string | null;
  canonical_name: string | null;
  positive_votes: number;
  total_votes: number;
  avg_yield_factor: string | number;
  invima_registry: string | null;
  actual_manufacturer: string | null;
  shrinkflation_alert: boolean;
  previous_net_content: string | number | null;
  captured_at: string | Date;
}

interface BankPromotionRow {
  id: number;
  bank_name: string;
  store_id: string | null;
  canonical_category_id: number | null;
  discount_pct: string | number;
  valid_days: number[];
  affiliate_url: string;
  terms_short: string | null;
  active: boolean;
}

interface NearbyStoreRow {
  branch_id: string;
  store_id: string;
  branch_name: string;
  city: string;
  address: string | null;
  lat: number;
  lng: number;
  distance_meters: number;
}

const DEMO_CATEGORIES: CanonicalCategoryOption[] = [
  { id: 1, slug: "arroz-blanco-1000g", name: "Arroz Blanco 1000 g", baseUnit: "g" },
  { id: 2, slug: "leche-entera-1000ml", name: "Leche Entera 1000 ml", baseUnit: "ml" },
  { id: 3, slug: "aceite-vegetal-900ml", name: "Aceite Vegetal 900 ml", baseUnit: "ml" },
  { id: 4, slug: "cafe-molido-500g", name: "Café Molido 500 g", baseUnit: "g" },
  { id: 5, slug: "huevos-aa-30und", name: "Huevos AA 30 Unidades", baseUnit: "und" },
];

type DemoOfferSeed = Omit<
  StoreOffer,
  | "canonicalCategoryId"
  | "positiveVotes"
  | "totalVotes"
  | "avgYieldFactor"
  | "invimaRegistry"
  | "actualManufacturer"
  | "shrinkflationAlert"
  | "previousNetContent"
> &
  Partial<
    Pick<
      StoreOffer,
      | "canonicalCategoryId"
      | "positiveVotes"
      | "totalVotes"
      | "avgYieldFactor"
      | "invimaRegistry"
      | "actualManufacturer"
      | "shrinkflationAlert"
      | "previousNetContent"
    >
  >;

function buildDemoOffer(seed: DemoOfferSeed): StoreOffer {
  return {
    canonicalCategoryId: null,
    positiveVotes: 24,
    totalVotes: 27,
    avgYieldFactor: 1.0,
    invimaRegistry: null,
    actualManufacturer: null,
    shrinkflationAlert: false,
    previousNetContent: null,
    ...seed,
  };
}

const DEMO_BANK_PROMOTIONS: BankPromotion[] = [
  {
    id: 1,
    bankName: "Tarjeta Éxito",
    storeId: "exito",
    canonicalCategoryId: null,
    discountPct: 15,
    validDays: [0, 1, 2, 3, 4, 5, 6],
    affiliateUrl: "https://www.tarjetaexito.com/?utm_source=mercasabio&utm_medium=affiliate",
    termsShort: "15% de descuento pagando con Tarjeta Éxito",
    active: true,
  },
  {
    id: 2,
    bankName: "Nu Colombia",
    storeId: "d1",
    canonicalCategoryId: null,
    discountPct: 5,
    validDays: [0, 1, 2, 3, 4, 5, 6],
    affiliateUrl: "https://nu.com.co/?utm_source=mercasabio&utm_medium=affiliate",
    termsShort: "5% de ahorro sugerido con Tarjeta Nu",
    active: true,
  },
  {
    id: 3,
    bankName: "Banco de Bogotá / Aval",
    storeId: "olimpica",
    canonicalCategoryId: null,
    discountPct: 10,
    validDays: [0, 1, 2, 3, 4, 5, 6],
    affiliateUrl: "https://www.bancodebogota.com/tarjetas?utm_source=mercasabio&utm_medium=affiliate",
    termsShort: "10% con Tarjeta Silver Olímpica",
    active: true,
  },
];

const DEMO_BRANCHES: Array<Omit<NearbyStoreBranch, "distanceMeters">> = [
  {
    branchId: "demo-br-exito-chap",
    storeId: "exito",
    branchName: "Éxito Chapinero",
    city: "Bogotá",
    address: "Calle 52 #13-70",
    lat: 4.6401,
    lng: -74.0642,
  },
  {
    branchId: "demo-br-olimpica-chap",
    storeId: "olimpica",
    branchName: "Olímpica Chapinero",
    city: "Bogotá",
    address: "Cra. 13 #63-45",
    lat: 4.6498,
    lng: -74.0628,
  },
  {
    branchId: "demo-br-d1-chap",
    storeId: "d1",
    branchName: "D1 Chapinero Alto",
    city: "Bogotá",
    address: "Calle 60 #9-18",
    lat: 4.6462,
    lng: -74.0615,
  },
  {
    branchId: "demo-br-ara-chap",
    storeId: "ara",
    branchName: "Ara Calle 57",
    city: "Bogotá",
    address: "Cra. 13 #57-32",
    lat: 4.6438,
    lng: -74.0648,
  },
  {
    branchId: "demo-br-carulla-85",
    storeId: "carulla",
    branchName: "Carulla Calle 85",
    city: "Bogotá",
    address: "Cra. 15 #85-24",
    lat: 4.6695,
    lng: -74.0548,
  },
];

const DEMO_OFFERS: StoreOffer[] = (
  [
    {
      storeSkuId: "demo-ex-arroz",
      storeId: "exito",
      storeName: "Éxito",
      channelType: "vtex_io",
      masterProductId: "mp-arroz-diana-1000",
      canonicalCategoryId: 1,
      rawName: "Arroz Blanco Diana 1000 g",
      rawUrl: "https://www.exito.com",
      rawListPrice: 5200,
      rawSalePrice: 4650,
      calibratedPrice: 4650,
      pumPrice: 4.65,
      inStock: true,
      sourceOrigin: "vtex_api",
      isEstimatedPhysicalPrice: false,
      isPrivateLabel: false,
      brand: "Diana",
      ean: "7702001001234",
      netContent: 1000,
      unitMeasure: "g",
      canonicalSlug: "arroz-blanco-1000g",
      canonicalName: "Arroz Blanco 1000 g",
      imageUrl: null,
      positiveVotes: 42,
      totalVotes: 44,
      avgYieldFactor: 0.9,
      capturedAt: "2026-11-11T03:00:00Z",
    },
    {
      storeSkuId: "demo-ol-arroz",
      storeId: "olimpica",
      storeName: "Olímpica",
      channelType: "vtex_legacy",
      masterProductId: "mp-arroz-diana-1000",
      canonicalCategoryId: 1,
      rawName: "Arroz Blanco Diana Bolsa x 1000 g",
      rawUrl: "https://www.olimpica.com",
      rawListPrice: 4950,
      rawSalePrice: 4490,
      calibratedPrice: 4490,
      pumPrice: 4.49,
      inStock: true,
      sourceOrigin: "vtex_api",
      isEstimatedPhysicalPrice: false,
      isPrivateLabel: false,
      brand: "Diana",
      ean: "7702001001234",
      netContent: 1000,
      unitMeasure: "g",
      canonicalSlug: "arroz-blanco-1000g",
      canonicalName: "Arroz Blanco 1000 g",
      imageUrl: null,
      positiveVotes: 42,
      totalVotes: 44,
      avgYieldFactor: 0.9,
      capturedAt: "2026-11-11T03:00:00Z",
    },
    {
      storeSkuId: "demo-ca-arroz",
      storeId: "carulla",
      storeName: "Carulla",
      channelType: "vtex_io",
      masterProductId: "mp-arroz-diana-1000",
      canonicalCategoryId: 1,
      rawName: "Arroz Diana Tradicional 1000 g",
      rawUrl: "https://www.carulla.com",
      rawListPrice: 5300,
      rawSalePrice: 5100,
      calibratedPrice: 5100,
      pumPrice: 5.1,
      inStock: true,
      sourceOrigin: "vtex_api",
      isEstimatedPhysicalPrice: false,
      isPrivateLabel: false,
      brand: "Diana",
      ean: "7702001001234",
      netContent: 1000,
      unitMeasure: "g",
      canonicalSlug: "arroz-blanco-1000g",
      canonicalName: "Arroz Blanco 1000 g",
      imageUrl: null,
      positiveVotes: 42,
      totalVotes: 44,
      avgYieldFactor: 0.9,
      capturedAt: "2026-11-11T03:00:00Z",
    },
    {
      storeSkuId: "demo-d1-arroz",
      storeId: "d1",
      storeName: "Tiendas D1",
      channelType: "vtex_graphql",
      masterProductId: "mp-arroz-d1-molinero",
      canonicalCategoryId: 1,
      rawName: "Arroz Blanco El Molinero 1000 g",
      rawUrl: "https://domicilios.tiendasd1.com",
      rawListPrice: 3890,
      rawSalePrice: 3890,
      calibratedPrice: 3890,
      pumPrice: 3.89,
      inStock: true,
      sourceOrigin: "vtex_graphql",
      isEstimatedPhysicalPrice: false,
      isPrivateLabel: true,
      brand: "El Molinero",
      ean: null,
      netContent: 1000,
      unitMeasure: "g",
      canonicalSlug: "arroz-blanco-1000g",
      canonicalName: "Arroz Blanco 1000 g",
      imageUrl: null,
      positiveVotes: 18,
      totalVotes: 21,
      avgYieldFactor: 1.0,
      invimaRegistry: "NSA-0008412-2020",
      actualManufacturer: "Molinos Roa Florhuila S.A.",
      capturedAt: "2026-11-11T03:00:00Z",
    },
    {
      storeSkuId: "demo-ara-arroz",
      storeId: "ara",
      storeName: "Tiendas Ara",
      channelType: "app_pdf",
      masterProductId: "mp-arroz-ara-cultivo",
      canonicalCategoryId: 1,
      rawName: "Arroz Blanco El Cultivo 1000 g",
      rawUrl: "https://aratiendas.com",
      rawListPrice: 4190,
      rawSalePrice: 3790,
      calibratedPrice: 3790,
      pumPrice: 3.79,
      inStock: true,
      sourceOrigin: "pdf_folleto",
      isEstimatedPhysicalPrice: false,
      isPrivateLabel: true,
      brand: "El Cultivo",
      ean: null,
      netContent: 1000,
      unitMeasure: "g",
      canonicalSlug: "arroz-blanco-1000g",
      canonicalName: "Arroz Blanco 1000 g",
      imageUrl: null,
      positiveVotes: 14,
      totalVotes: 17,
      avgYieldFactor: 1.0,
      capturedAt: "2026-11-11T03:00:00Z",
    },
    {
      storeSkuId: "demo-ex-leche",
      storeId: "exito",
      storeName: "Éxito",
      channelType: "vtex_io",
      masterProductId: "mp-leche-alqueria-1100",
      canonicalCategoryId: 2,
      rawName: "Leche Entera Alquería Bolsa 1.1 L",
      rawUrl: "https://www.exito.com",
      rawListPrice: 5800,
      rawSalePrice: 5450,
      calibratedPrice: 5450,
      pumPrice: 4.9545,
      inStock: true,
      sourceOrigin: "vtex_api",
      isEstimatedPhysicalPrice: false,
      isPrivateLabel: false,
      brand: "Alquería",
      ean: "7702177001012",
      netContent: 1100,
      unitMeasure: "ml",
      canonicalSlug: "leche-entera-1000ml",
      canonicalName: "Leche Entera 1000 ml",
      imageUrl: null,
      positiveVotes: 31,
      totalVotes: 32,
      avgYieldFactor: 0.95,
      capturedAt: "2026-11-11T03:00:00Z",
    },
    {
      storeSkuId: "demo-d1-leche",
      storeId: "d1",
      storeName: "Tiendas D1",
      channelType: "vtex_graphql",
      masterProductId: "mp-leche-latti-1000",
      canonicalCategoryId: 2,
      rawName: "Leche Entera UHT Latti 1000 ml",
      rawUrl: "https://domicilios.tiendasd1.com",
      rawListPrice: 3290,
      rawSalePrice: 3290,
      calibratedPrice: 3290,
      pumPrice: 3.29,
      inStock: true,
      sourceOrigin: "vtex_graphql",
      isEstimatedPhysicalPrice: false,
      isPrivateLabel: true,
      brand: "Latti",
      ean: null,
      netContent: 1000,
      unitMeasure: "ml",
      canonicalSlug: "leche-entera-1000ml",
      canonicalName: "Leche Entera 1000 ml",
      imageUrl: null,
      positiveVotes: 25,
      totalVotes: 28,
      avgYieldFactor: 1.0,
      capturedAt: "2026-11-11T03:00:00Z",
    },
    {
      storeSkuId: "demo-ol-aceite",
      storeId: "olimpica",
      storeName: "Olímpica",
      channelType: "vtex_legacy",
      masterProductId: "mp-aceite-premier-900",
      canonicalCategoryId: 3,
      rawName: "Aceite Vegetal Premier 900 cc",
      rawUrl: "https://www.olimpica.com",
      rawListPrice: 14200,
      rawSalePrice: 13490,
      calibratedPrice: 13490,
      pumPrice: 14.9889,
      inStock: true,
      sourceOrigin: "vtex_api",
      isEstimatedPhysicalPrice: false,
      isPrivateLabel: false,
      brand: "Premier",
      ean: "7702001009991",
      netContent: 900,
      unitMeasure: "ml",
      canonicalSlug: "aceite-vegetal-900ml",
      canonicalName: "Aceite Vegetal 900 ml",
      imageUrl: null,
      shrinkflationAlert: true,
      previousNetContent: 1000,
      positiveVotes: 11,
      totalVotes: 20,
      avgYieldFactor: 1.0,
      capturedAt: "2026-11-11T03:00:00Z",
    },
    {
      storeSkuId: "demo-ara-aceite",
      storeId: "ara",
      storeName: "Tiendas Ara",
      channelType: "app_pdf",
      masterProductId: "mp-aceite-loma-900",
      canonicalCategoryId: 3,
      rawName: "Aceite Vegetal Loma Blanca 900 ml",
      rawUrl: "https://aratiendas.com",
      rawListPrice: 11500,
      rawSalePrice: 9900,
      calibratedPrice: 9900,
      pumPrice: 11.0,
      inStock: true,
      sourceOrigin: "pdf_folleto",
      isEstimatedPhysicalPrice: false,
      isPrivateLabel: true,
      brand: "Loma Blanca",
      ean: null,
      netContent: 900,
      unitMeasure: "ml",
      canonicalSlug: "aceite-vegetal-900ml",
      canonicalName: "Aceite Vegetal 900 ml",
      imageUrl: null,
      positiveVotes: 19,
      totalVotes: 22,
      avgYieldFactor: 0.9,
      capturedAt: "2026-11-11T03:00:00Z",
    },
  ] satisfies DemoOfferSeed[]
).map(buildDemoOffer);

function mapRowToOffer(row: LatestPriceRow): StoreOffer {
  const calibratedPrice = Number(row.calibrated_price);
  const rawSalePrice = Number(row.raw_sale_price);
  const markupFactor = Number(row.markup_discount_factor ?? 1);
  const isEstimated =
    row.source_origin === "rappi_api" ||
    markupFactor !== 1 ||
    Math.abs(calibratedPrice - rawSalePrice) > 0.01;

  return {
    storeSkuId: row.store_sku_id,
    storeId: row.store_id,
    storeName: row.store_name,
    channelType: row.channel_type,
    masterProductId: row.master_product_id,
    canonicalCategoryId: row.canonical_category_id ?? null,
    rawName: cleanProductTitle(row.raw_name),
    rawUrl: row.raw_url,
    rawListPrice: Number(row.raw_list_price),
    rawSalePrice,
    calibratedPrice,
    pumPrice: Number(row.pum_price),
    inStock: Boolean(row.in_stock),
    sourceOrigin: row.source_origin,
    isEstimatedPhysicalPrice: isEstimated,
    isPrivateLabel: Boolean(row.is_private_label),
    brand: row.brand,
    ean: row.ean,
    netContent: Number(row.net_content),
    unitMeasure: row.unit_measure,
    canonicalSlug: row.canonical_slug,
    canonicalName: row.canonical_name,
    imageUrl: row.image_url,
    positiveVotes: Number(row.positive_votes ?? 0),
    totalVotes: Number(row.total_votes ?? 0),
    avgYieldFactor: Number(row.avg_yield_factor ?? 1) || 1,
    invimaRegistry: row.invima_registry ?? null,
    actualManufacturer: row.actual_manufacturer ?? null,
    shrinkflationAlert: Boolean(row.shrinkflation_alert),
    previousNetContent:
      row.previous_net_content !== null && row.previous_net_content !== undefined
        ? Number(row.previous_net_content)
        : null,
    capturedAt:
      row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at),
  };
}

function mapBankPromotionRow(row: BankPromotionRow): BankPromotion {
  return {
    id: Number(row.id),
    bankName: row.bank_name,
    storeId: row.store_id ?? null,
    canonicalCategoryId:
      row.canonical_category_id !== null && row.canonical_category_id !== undefined
        ? Number(row.canonical_category_id)
        : null,
    discountPct: Number(row.discount_pct),
    validDays: Array.isArray(row.valid_days) ? row.valid_days.map(Number) : [],
    affiliateUrl: row.affiliate_url,
    termsShort: row.terms_short ?? null,
    active: Boolean(row.active),
  };
}

export function buildComparisonGroups(
  offers: StoreOffer[],
  mode: CompareMode
): ComparisonGroup[] {
  const validOffers = offers.filter(
    (offer) =>
      Number.isFinite(offer.calibratedPrice) &&
      offer.calibratedPrice > 0 &&
      isMercadoOffer(offer)
  );
  return buildMultiTierComparisonGroups(validOffers, mode);
}

export async function getDashboardData(options?: {
  query?: string;
  categorySlug?: string;
}): Promise<DashboardPayload> {
  const queryText = options?.query?.trim() ?? "";
  const categorySlug = options?.categorySlug?.trim() ?? "";
  const supabaseConfig = getSupabaseConfig();

  if (!supabaseConfig) {
    const filtered = DEMO_OFFERS.filter((offer) => {
      if (categorySlug && offer.canonicalSlug !== categorySlug) {
        return false;
      }
      if (queryText) {
        const needle = queryText.toLowerCase();
        const haystack =
          `${offer.rawName} ${offer.brand ?? ""} ${offer.ean ?? ""} ${offer.canonicalName ?? ""}`.toLowerCase();
        return haystack.includes(needle);
      }
      return true;
    });

    return {
      eanGroups: buildComparisonGroups(filtered, "ean"),
      pumGroups: buildComparisonGroups(filtered, "pum"),
      categories: DEMO_CATEGORIES,
      bankPromotions: DEMO_BANK_PROMOTIONS,
      storesCount: new Set(DEMO_OFFERS.map((o) => o.storeId)).size,
      totalSkus: DEMO_OFFERS.length,
      isDemoData: true,
      generatedAt: new Date().toISOString(),
    };
  }

  const [offerRows, categoryRows, promoRows, statsRows] = await Promise.all([
    supabaseRpc<LatestPriceRow[]>(supabaseConfig, "search_latest_offers", {
      p_query: queryText,
      p_category_slug: categorySlug,
      p_limit: 400,
    }),
    supabaseRestGet<{ id: number; slug: string; name: string; base_unit: UnitMeasure }[]>(
      supabaseConfig,
      "canonical_categories?select=id,slug,name,base_unit&order=name.asc"
    ),
    supabaseRestGet<BankPromotionRow[]>(
      supabaseConfig,
      "bank_promotions?select=id,bank_name,store_id,canonical_category_id,discount_pct,valid_days,affiliate_url,terms_short,active&active=eq.true"
    ),
    supabaseRpc<{ stores_count: number; total_skus: number }[]>(
      supabaseConfig,
      "get_catalog_stats",
      {}
    ),
  ]);

  const offers = offerRows.map(mapRowToOffer).filter(isMercadoOffer);
  const categories: CanonicalCategoryOption[] = categoryRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    baseUnit: row.base_unit,
  }));
  const bankPromotions = promoRows
    .map(mapBankPromotionRow)
    .filter((promo) => promo.storeId === null || isGroceryStoreId(promo.storeId));

  const statsRow = statsRows[0];
  return {
    eanGroups: buildComparisonGroups(offers, "ean"),
    pumGroups: buildComparisonGroups(offers, "pum"),
    categories,
    bankPromotions,
    storesCount: Number(statsRow?.stores_count ?? 0),
    totalSkus: Number(statsRow?.total_skus ?? offers.length),
    isDemoData: false,
    generatedAt: new Date().toISOString(),
  };
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getNearbyStores(params: {
  lat: number;
  lng: number;
  radiusMeters?: number;
}): Promise<NearbyStoreBranch[]> {
  const radiusMeters = params.radiusMeters ?? 2000;
  const supabaseConfig = getSupabaseConfig();

  if (!supabaseConfig) {
    return DEMO_BRANCHES.map((branch) => ({
      ...branch,
      distanceMeters: Math.round(haversineMeters(params.lat, params.lng, branch.lat, branch.lng)),
    }))
      .filter((branch) => branch.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  const rows = await supabaseRpc<NearbyStoreRow[]>(supabaseConfig, "get_nearby_stores", {
    user_lat: params.lat,
    user_lng: params.lng,
    radius_meters: radiusMeters,
  });

  return rows
    .filter((row) => isGroceryStoreId(row.store_id))
    .map((row) => ({
      branchId: row.branch_id,
      storeId: row.store_id,
      branchName: row.branch_name,
      city: row.city,
      address: row.address ?? null,
      lat: Number(row.lat),
      lng: Number(row.lng),
      distanceMeters: Number(row.distance_meters),
    }));
}
