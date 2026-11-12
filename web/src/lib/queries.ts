import { getPool } from "@/lib/db";
import type {
  CanonicalCategoryOption,
  CompareMode,
  ComparisonGroup,
  DashboardPayload,
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
  captured_at: string | Date;
}

const DEMO_CATEGORIES: CanonicalCategoryOption[] = [
  { id: 1, slug: "arroz-blanco-1000g", name: "Arroz Blanco 1000 g", baseUnit: "g" },
  { id: 2, slug: "leche-entera-1000ml", name: "Leche Entera 1000 ml", baseUnit: "ml" },
  { id: 3, slug: "aceite-vegetal-900ml", name: "Aceite Vegetal 900 ml", baseUnit: "ml" },
  { id: 4, slug: "cafe-molido-500g", name: "Café Molido 500 g", baseUnit: "g" },
  { id: 5, slug: "huevos-aa-30und", name: "Huevos AA 30 Unidades", baseUnit: "und" },
];

const DEMO_OFFERS: StoreOffer[] = [
  {
    storeSkuId: "demo-ex-arroz",
    storeId: "exito",
    storeName: "Éxito",
    channelType: "vtex_io",
    masterProductId: "mp-arroz-diana-1000",
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
    capturedAt: "2026-11-11T03:00:00Z",
  },
  {
    storeSkuId: "demo-ol-arroz",
    storeId: "olimpica",
    storeName: "Olímpica",
    channelType: "vtex_legacy",
    masterProductId: "mp-arroz-diana-1000",
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
    capturedAt: "2026-11-11T03:00:00Z",
  },
  {
    storeSkuId: "demo-ca-arroz",
    storeId: "carulla",
    storeName: "Carulla",
    channelType: "vtex_io",
    masterProductId: "mp-arroz-diana-1000",
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
    capturedAt: "2026-11-11T03:00:00Z",
  },
  {
    storeSkuId: "demo-ra-arroz",
    storeId: "rappi",
    storeName: "Rappi Agregador",
    channelType: "aggregator",
    masterProductId: "mp-arroz-diana-1000",
    rawName: "Arroz Blanco Diana 1000 g",
    rawUrl: null,
    rawListPrice: 5600,
    rawSalePrice: 5400,
    calibratedPrice: 4860,
    pumPrice: 4.86,
    inStock: true,
    sourceOrigin: "rappi_api",
    isEstimatedPhysicalPrice: true,
    isPrivateLabel: false,
    brand: "Diana",
    ean: "7702001001234",
    netContent: 1000,
    unitMeasure: "g",
    canonicalSlug: "arroz-blanco-1000g",
    canonicalName: "Arroz Blanco 1000 g",
    imageUrl: null,
    capturedAt: "2026-11-11T03:00:00Z",
  },
  {
    storeSkuId: "demo-d1-arroz",
    storeId: "d1",
    storeName: "Tiendas D1",
    channelType: "vtex_graphql",
    masterProductId: "mp-arroz-d1-molinero",
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
    capturedAt: "2026-11-11T03:00:00Z",
  },
  {
    storeSkuId: "demo-ara-arroz",
    storeId: "ara",
    storeName: "Tiendas Ara",
    channelType: "app_pdf",
    masterProductId: "mp-arroz-ara-cultivo",
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
    capturedAt: "2026-11-11T03:00:00Z",
  },
  {
    storeSkuId: "demo-ex-leche",
    storeId: "exito",
    storeName: "Éxito",
    channelType: "vtex_io",
    masterProductId: "mp-leche-alqueria-1100",
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
    capturedAt: "2026-11-11T03:00:00Z",
  },
  {
    storeSkuId: "demo-ca-leche",
    storeId: "carulla",
    storeName: "Carulla",
    channelType: "vtex_io",
    masterProductId: "mp-leche-alqueria-1100",
    rawName: "Leche Entera Alquería 1100 ml",
    rawUrl: "https://www.carulla.com",
    rawListPrice: 5900,
    rawSalePrice: 5900,
    calibratedPrice: 5900,
    pumPrice: 5.3636,
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
    capturedAt: "2026-11-11T03:00:00Z",
  },
  {
    storeSkuId: "demo-d1-leche",
    storeId: "d1",
    storeName: "Tiendas D1",
    channelType: "vtex_graphql",
    masterProductId: "mp-leche-latti-1000",
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
    capturedAt: "2026-11-11T03:00:00Z",
  },
  {
    storeSkuId: "demo-ak-aceite",
    storeId: "alkosto",
    storeName: "Alkosto",
    channelType: "sap_hybris",
    masterProductId: "mp-aceite-premier-900",
    rawName: "Aceite Girasol Premier 900 ml",
    rawUrl: "https://www.alkosto.com",
    rawListPrice: 14500,
    rawSalePrice: 12900,
    calibratedPrice: 12900,
    pumPrice: 14.3333,
    inStock: true,
    sourceOrigin: "hybris_api",
    isEstimatedPhysicalPrice: false,
    isPrivateLabel: false,
    brand: "Premier",
    ean: "7702001009991",
    netContent: 900,
    unitMeasure: "ml",
    canonicalSlug: "aceite-vegetal-900ml",
    canonicalName: "Aceite Vegetal 900 ml",
    imageUrl: null,
    capturedAt: "2026-11-11T03:00:00Z",
  },
  {
    storeSkuId: "demo-ol-aceite",
    storeId: "olimpica",
    storeName: "Olímpica",
    channelType: "vtex_legacy",
    masterProductId: "mp-aceite-premier-900",
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
    capturedAt: "2026-11-11T03:00:00Z",
  },
  {
    storeSkuId: "demo-ara-aceite",
    storeId: "ara",
    storeName: "Tiendas Ara",
    channelType: "app_pdf",
    masterProductId: "mp-aceite-loma-900",
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
    capturedAt: "2026-11-11T03:00:00Z",
  },
];

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
    rawName: row.raw_name,
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
    capturedAt:
      row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at),
  };
}

export function buildComparisonGroups(
  offers: StoreOffer[],
  mode: CompareMode
): ComparisonGroup[] {
  const buckets = new Map<string, StoreOffer[]>();

  for (const offer of offers) {
    const key =
      mode === "ean"
        ? offer.masterProductId
        : offer.canonicalSlug ?? `mp:${offer.masterProductId}`;

    const list = buckets.get(key) ?? [];
    list.push(offer);
    buckets.set(key, list);
  }

  const groups: ComparisonGroup[] = [];
  for (const [groupId, groupOffers] of buckets.entries()) {
    const sorted = [...groupOffers].sort((a, b) => {
      if (a.inStock !== b.inStock) {
        return a.inStock ? -1 : 1;
      }
      return mode === "pum"
        ? a.pumPrice - b.pumPrice
        : a.calibratedPrice - b.calibratedPrice;
    });

    const anchor = sorted[0];
    const activeOffers = sorted.filter((o) => o.inStock);
    const referencePool = activeOffers.length > 0 ? activeOffers : sorted;

    const bestPrice = Math.min(...referencePool.map((o) => o.calibratedPrice));
    const bestPum = Math.min(...referencePool.map((o) => o.pumPrice));
    const highestPrice = Math.max(...referencePool.map((o) => o.calibratedPrice));
    const highestPum = Math.max(...referencePool.map((o) => o.pumPrice));

    const savingsPct =
      mode === "pum"
        ? highestPum > 0
          ? Math.round(((highestPum - bestPum) / highestPum) * 100)
          : 0
        : highestPrice > 0
          ? Math.round(((highestPrice - bestPrice) / highestPrice) * 100)
          : 0;

    const title =
      mode === "pum" && anchor.canonicalName
        ? anchor.canonicalName
        : anchor.rawName;

    const subtitle =
      mode === "pum"
        ? `Equivalentes por ${anchor.unitMeasure} (${sorted.length} ofertas)`
        : `${anchor.brand ?? "Marca comercial"} · ${anchor.netContent} ${anchor.unitMeasure}`;

    groups.push({
      groupId,
      title,
      subtitle,
      brand: anchor.brand,
      ean: anchor.ean,
      canonicalSlug: anchor.canonicalSlug,
      canonicalName: anchor.canonicalName,
      netContent: anchor.netContent,
      unitMeasure: anchor.unitMeasure,
      imageUrl: sorted.find((o) => o.imageUrl)?.imageUrl ?? null,
      bestPrice,
      bestPum,
      highestPrice,
      savingsPct,
      offers: sorted,
    });
  }

  return groups.sort((a, b) => b.offers.length - a.offers.length || b.savingsPct - a.savingsPct);
}

export async function getDashboardData(options?: {
  query?: string;
  categorySlug?: string;
}): Promise<DashboardPayload> {
  const queryText = options?.query?.trim() ?? "";
  const categorySlug = options?.categorySlug?.trim() ?? "";
  const pool = getPool();

  if (!pool) {
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
      storesCount: new Set(DEMO_OFFERS.map((o) => o.storeId)).size,
      totalSkus: DEMO_OFFERS.length,
      isDemoData: true,
      generatedAt: new Date().toISOString(),
    };
  }

  const conditions: string[] = ["v.master_product_id IS NOT NULL"];
  const params: unknown[] = [];

  if (categorySlug) {
    params.push(categorySlug);
    conditions.push(`cc.slug = $${params.length}`);
  }

  if (queryText) {
    params.push(queryText);
    const exactIdx = params.length;
    params.push(`%${queryText.toLowerCase()}%`);
    const likeIdx = params.length;
    conditions.push(
      `(mp.ean = $${exactIdx} OR mp.normalized_name ILIKE $${likeIdx} OR ss.raw_name ILIKE $${likeIdx} OR extensions.similarity(mp.normalized_name, lower($${exactIdx})) >= 0.25)`
    );
  }

  const sql = `
    SELECT
      v.store_sku_id,
      v.store_id,
      s.name AS store_name,
      s.channel_type,
      s.markup_discount_factor,
      v.master_product_id,
      ss.raw_name,
      ss.raw_url,
      v.normalized_name,
      v.brand,
      mp.ean,
      v.net_content,
      v.unit_measure,
      v.calibrated_price,
      v.raw_list_price,
      v.raw_sale_price,
      v.pum_price,
      v.in_stock,
      v.source_origin,
      v.is_private_label,
      mp.image_url,
      cc.slug AS canonical_slug,
      cc.name AS canonical_name,
      v.captured_at
    FROM v_latest_prices v
    JOIN stores s ON s.id = v.store_id
    JOIN store_skus ss ON ss.id = v.store_sku_id
    JOIN master_products mp ON mp.id = v.master_product_id
    LEFT JOIN canonical_categories cc ON cc.id = v.canonical_category_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY v.captured_at DESC
    LIMIT 240
  `;

  const [offersRes, categoriesRes, statsRes] = await Promise.all([
    pool.query<LatestPriceRow>(sql, params),
    pool.query<{ id: number; slug: string; name: string; base_unit: UnitMeasure }>(
      "SELECT id, slug, name, base_unit FROM canonical_categories ORDER BY name ASC"
    ),
    pool.query<{ stores_count: string; total_skus: string }>(
      "SELECT COUNT(DISTINCT store_id)::text AS stores_count, COUNT(*)::text AS total_skus FROM v_latest_prices"
    ),
  ]);

  const offers = offersRes.rows.map(mapRowToOffer);
  const categories: CanonicalCategoryOption[] = categoriesRes.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    baseUnit: row.base_unit,
  }));

  const statsRow = statsRes.rows[0];
  return {
    eanGroups: buildComparisonGroups(offers, "ean"),
    pumGroups: buildComparisonGroups(offers, "pum"),
    categories,
    storesCount: Number(statsRow?.stores_count ?? 0),
    totalSkus: Number(statsRow?.total_skus ?? offers.length),
    isDemoData: false,
    generatedAt: new Date().toISOString(),
  };
}
