import assert from "node:assert/strict";
import test from "node:test";

import { optimizeBasket } from "../src/lib/basketOptimizer.ts";
import { buildMultiTierComparisonGroups } from "../src/lib/comparisonEngine.ts";
import {
  buildDefaultGenericBasketItems,
  formatBasketAsPlainText,
  getAvailableBrandsForItem,
  inferBasketProfileSummary,
  inferHabitualItemProfile,
} from "../src/lib/guidedCatalog.ts";
import {
  buildStoreAffiliateUrl,
  cleanProductTitle,
  computeRealUsageMetrics,
  findActiveBankPromotions,
  getSteamRatingBadge,
  isGroceryStoreId,
  isMercadoOffer,
  sanitizeExternalUrl,
} from "../src/lib/productInsights.ts";
import type { BankPromotion, NearbyStoreBranch, StoreOffer } from "../src/lib/types.ts";

function makeOffer(overrides: Partial<StoreOffer>): StoreOffer {
  return {
    storeSkuId: "sku-default",
    storeId: "exito",
    storeName: "Éxito",
    channelType: "vtex_io",
    masterProductId: "mp-1",
    canonicalCategoryId: 1,
    rawName: "Producto Demo",
    rawUrl: "https://www.exito.com/p",
    rawListPrice: 10000,
    rawSalePrice: 10000,
    calibratedPrice: 10000,
    pumPrice: 10,
    inStock: true,
    sourceOrigin: "vtex_api",
    isEstimatedPhysicalPrice: false,
    isPrivateLabel: false,
    brand: "Marca",
    ean: "7700000000001",
    netContent: 1000,
    unitMeasure: "g",
    canonicalSlug: "arroz-blanco-1000g",
    canonicalName: "Arroz Blanco 1000 g",
    imageUrl: null,
    positiveVotes: 25,
    totalVotes: 26,
    avgYieldFactor: 1,
    invimaRegistry: null,
    actualManufacturer: null,
    shrinkflationAlert: false,
    previousNetContent: null,
    capturedAt: "2026-11-12T00:00:00Z",
    ...overrides,
  };
}

test("optimizeBasket evalúa 1, 2 y 3 tiendas cercanas y calcula ahorro nominal y real", () => {
  const branches: NearbyStoreBranch[] = [
    {
      branchId: "b1",
      storeId: "exito",
      branchName: "Éxito Chapinero",
      city: "Bogotá",
      address: "Cll 52",
      lat: 4.64,
      lng: -74.06,
      distanceMeters: 300,
    },
    {
      branchId: "b2",
      storeId: "d1",
      branchName: "D1 Chapinero",
      city: "Bogotá",
      address: "Cll 60",
      lat: 4.646,
      lng: -74.061,
      distanceMeters: 450,
    },
    {
      branchId: "b3",
      storeId: "olimpica",
      branchName: "Olímpica 63",
      city: "Bogotá",
      address: "Cra 13",
      lat: 4.65,
      lng: -74.062,
      distanceMeters: 620,
    },
  ];

  const offers: StoreOffer[] = [
    // Item 1: Arroz
    makeOffer({
      storeSkuId: "ex-1",
      storeId: "exito",
      storeName: "Éxito",
      masterProductId: "mp-arroz",
      calibratedPrice: 12000,
      pumPrice: 12,
      avgYieldFactor: 1.0,
    }),
    makeOffer({
      storeSkuId: "d1-1",
      storeId: "d1",
      storeName: "D1",
      masterProductId: "mp-arroz",
      calibratedPrice: 7000,
      pumPrice: 7,
      avgYieldFactor: 1.0,
    }),
    makeOffer({
      storeSkuId: "ol-1",
      storeId: "olimpica",
      storeName: "Olímpica",
      masterProductId: "mp-arroz",
      calibratedPrice: 11500,
      pumPrice: 11.5,
      avgYieldFactor: 1.0,
    }),
    // Item 2: Detergente concentrado (D1 cuesta 15000 y rinde normal; Exito cuesta 16000 pero rinde doble 0.5)
    makeOffer({
      storeSkuId: "ex-2",
      storeId: "exito",
      storeName: "Éxito",
      masterProductId: "mp-det",
      canonicalSlug: "detergente",
      calibratedPrice: 10000,
      pumPrice: 10,
      avgYieldFactor: 0.5,
    }),
    makeOffer({
      storeSkuId: "d1-2",
      storeId: "d1",
      storeName: "D1",
      masterProductId: "mp-det",
      canonicalSlug: "detergente",
      calibratedPrice: 15000,
      pumPrice: 15,
      avgYieldFactor: 1.0,
    }),
    makeOffer({
      storeSkuId: "ol-2",
      storeId: "olimpica",
      storeName: "Olímpica",
      masterProductId: "mp-det",
      canonicalSlug: "detergente",
      calibratedPrice: 13000,
      pumPrice: 13,
      avgYieldFactor: 1.0,
    }),
    // Item 3: Aceite más barato en Olímpica por diferencia de 4000 COP
    makeOffer({
      storeSkuId: "ex-3",
      storeId: "exito",
      storeName: "Éxito",
      masterProductId: "mp-aceite",
      canonicalSlug: "aceite",
      calibratedPrice: 16000,
      pumPrice: 16,
    }),
    makeOffer({
      storeSkuId: "d1-3",
      storeId: "d1",
      storeName: "D1",
      masterProductId: "mp-aceite",
      canonicalSlug: "aceite",
      calibratedPrice: 15000,
      pumPrice: 15,
    }),
    makeOffer({
      storeSkuId: "ol-3",
      storeId: "olimpica",
      storeName: "Olímpica",
      masterProductId: "mp-aceite",
      canonicalSlug: "aceite",
      calibratedPrice: 11000,
      pumPrice: 11,
    }),
  ];

  const result = optimizeBasket({
    items: [
      { itemKey: "1", label: "Arroz", masterProductId: "mp-arroz", quantity: 1 },
      { itemKey: "2", label: "Detergente", masterProductId: "mp-det", quantity: 1 },
      { itemKey: "3", label: "Aceite", masterProductId: "mp-aceite", quantity: 1 },
    ],
    offers,
    nearbyBranches: branches,
    options: { minExtraSavingsCop: 2000 },
  });

  assert.equal(result.bestOneStore?.totalNominalCost, 35500); // Olímpica: 11.5k + 13k + 11k
  assert.equal(result.bestTwoStores?.totalNominalCost, 31000); // D1 arroz (7k) + Olímpica det/aceite (24k)
  assert.equal(result.bestTwoStores?.nominalSavingsCop, 4500);
  assert.equal(result.bestThreeStores?.totalNominalCost, 28000); // D1 (7k) + Éxito (10k) + Olímpica (11k)
  assert.equal(result.bestThreeStores?.nominalSavingsCop, 7500);
  assert.equal(result.recommendedPlan?.storeCount, 3);
  assert.ok(result.bestThreeStores!.realAdjustedSavingsCop > result.bestThreeStores!.nominalSavingsCop);
});

test("optimizeBasket filtra combinaciones extra cuyo ahorro no justifica visitar otra tienda", () => {
  const branches: NearbyStoreBranch[] = [
    {
      branchId: "b1",
      storeId: "exito",
      branchName: "Éxito",
      city: "Bogotá",
      address: null,
      lat: 4.64,
      lng: -74.06,
      distanceMeters: 200,
    },
    {
      branchId: "b2",
      storeId: "d1",
      branchName: "D1",
      city: "Bogotá",
      address: null,
      lat: 4.641,
      lng: -74.061,
      distanceMeters: 300,
    },
  ];
  const offers: StoreOffer[] = [
    makeOffer({ storeSkuId: "1", storeId: "exito", masterProductId: "mp-1", calibratedPrice: 5000 }),
    makeOffer({ storeSkuId: "2", storeId: "d1", masterProductId: "mp-1", calibratedPrice: 4950 }),
    makeOffer({ storeSkuId: "3", storeId: "exito", masterProductId: "mp-2", calibratedPrice: 10000 }),
    makeOffer({ storeSkuId: "4", storeId: "d1", masterProductId: "mp-2", calibratedPrice: 12000 }),
  ];

  const result = optimizeBasket({
    items: [
      { itemKey: "1", label: "P1", masterProductId: "mp-1" },
      { itemKey: "2", label: "P2", masterProductId: "mp-2" },
    ],
    offers,
    nearbyBranches: branches,
    options: { minExtraSavingsCop: 2000, minExtraSavingsPct: 5 },
  });

  assert.equal(result.bestTwoStores?.worthExtraStop, false);
  assert.equal(result.recommendedPlan?.storeCount, 1);
});

test("Steam rating, rendimiento real y promociones bancarias por día", () => {
  assert.equal(getSteamRatingBadge(19, 20).label, "Extremadamente positivo");
  assert.equal(getSteamRatingBadge(9, 10).label, "Muy positivo"); // 90%, pero <20 votos también entra en >=80%
  assert.equal(getSteamRatingBadge(15, 20).label, "Mayormente positivo");
  assert.equal(getSteamRatingBadge(10, 20).label, "Variado");
  assert.equal(getSteamRatingBadge(5, 20).label, "Mayormente negativo");

  const usage = computeRealUsageMetrics(20000, 20, 0.5);
  assert.equal(usage.realUsagePrice, 10000);
  assert.equal(usage.realAdjustedPum, 10);

  const promos: BankPromotion[] = [
    {
      id: 1,
      bankName: "Tarjeta Éxito",
      storeId: "exito",
      canonicalCategoryId: null,
      discountPct: 15,
      validDays: [4],
      affiliateUrl: "https://example.com/exito",
      termsShort: null,
      active: true,
    },
    {
      id: 2,
      bankName: "Otra",
      storeId: "exito",
      canonicalCategoryId: null,
      discountPct: 20,
      validDays: [1],
      affiliateUrl: "https://example.com/other",
      termsShort: null,
      active: true,
    },
  ];
  const activeDay4 = findActiveBankPromotions(
    { storeId: "exito", canonicalCategoryId: 1, calibratedPrice: 10000 },
    promos,
    4
  );
  assert.equal(activeDay4.length, 1);
  assert.equal(activeDay4[0].discountedPrice, 8500);
  assert.equal(activeDay4[0].savingsCop, 1500);
});

test("cleanProductTitle y sanitización de enlaces externos previenen duplicados y URLs inseguras", () => {
  assert.equal(
    cleanProductTitle("Arroz Extra Gourmet Albar 1000 Gr Arroz Extra Gourmet Albar 1000 Gr"),
    "Arroz Extra Gourmet Albar 1000 Gr"
  );
  assert.equal(cleanProductTitle("Leche Entera  Alquería   1000 ml"), "Leche Entera Alquería 1000 ml");

  assert.equal(buildStoreAffiliateUrl("javascript:alert(1)"), "#");
  assert.equal(buildStoreAffiliateUrl("data:text/html,xss"), "#");
  assert.equal(
    buildStoreAffiliateUrl("https://www.exito.com/arroz"),
    "https://www.exito.com/arroz?utm_source=mercasabio&utm_medium=affiliate"
  );

  assert.equal(sanitizeExternalUrl("javascript:alert(1)"), "#");
  assert.equal(sanitizeExternalUrl("https://nu.com.co/"), "https://nu.com.co/");
});

test("isMercadoOffer e isGroceryStoreId excluyen tiendas y productos ajenos al mercado", () => {
  assert.equal(isGroceryStoreId("alkosto"), false);
  assert.equal(isGroceryStoreId("ktronix"), false);
  assert.equal(isGroceryStoreId("carulla"), true);
  assert.equal(isGroceryStoreId("d1"), true);

  assert.equal(
    isMercadoOffer({
      storeId: "ktronix",
      rawName: "Celular iPhone 17 256GB",
      brand: "Apple",
      rawUrl: "https://www.ktronix.com/iphone/p/1",
    }),
    false
  );
  assert.equal(
    isMercadoOffer({
      storeId: "olimpica",
      rawName: "Televisor Caixun 55 Pulgadas Smart TV QLED",
      brand: "CAIXUN",
      rawUrl: "https://www.olimpica.com/tv/p",
    }),
    false
  );
  assert.equal(
    isMercadoOffer({
      storeId: "olimpica",
      rawName: "Camisa JSN Azul Talla XXL",
      brand: "JSN",
      rawUrl: "https://www.olimpica.com/camisa-jsn/p",
    }),
    false
  );
  assert.equal(
    isMercadoOffer({
      storeId: "carulla",
      rawName: "Pastas LA MUÑECA spaghetti (500 gr)",
      brand: "LA MUÑECA",
      rawUrl: "https://secure.carulla.com/pastas-la-muneca/p",
    }),
    true
  );
  assert.equal(
    isMercadoOffer({
      storeId: "d1",
      rawName: "Arroz Extra Gourmet Albar 1000 Gr",
      brand: "ALBAR",
      rawUrl: "https://www.d1.com.co/arroz-albar/p",
    }),
    true
  );
});

test("buildMultiTierComparisonGroups elimina duplicados intra-tienda y separa marcas fusionadas", () => {
  const offers: StoreOffer[] = [
    makeOffer({
      storeSkuId: "ca-cafe-1",
      storeId: "carulla",
      storeName: "Carulla",
      masterProductId: "mp-amor",
      rawName: "Café AMOR PERFECTO molido (350 gr)",
      brand: "AMOR PERFECTO",
      ean: "7709375032007",
      netContent: 350,
      unitMeasure: "g",
      calibratedPrice: 36720,
      pumPrice: 104.91,
    }),
    makeOffer({
      storeSkuId: "ca-cafe-2",
      storeId: "carulla",
      storeName: "Carulla",
      masterProductId: "mp-amor",
      rawName: "Café AMOR PERFECTO molido (350 gr)",
      brand: "AMOR PERFECTO",
      ean: "7709375032007",
      netContent: 350,
      unitMeasure: "g",
      calibratedPrice: 36280,
      pumPrice: 103.66,
    }),
    // Falsa fusión trgm de 2 pesos dentro de Carulla/D1 almacenados erróneamente como 1 und
    makeOffer({
      storeSkuId: "d1-albar-450",
      storeId: "d1",
      storeName: "Tiendas D1",
      masterProductId: "mp-albar-merged",
      rawName: "Arroz Económico Albar 450 Grs",
      brand: "ALBAR",
      ean: "7700304985838",
      netContent: 1,
      unitMeasure: "und",
      calibratedPrice: 1300,
      pumPrice: 1300,
    }),
    makeOffer({
      storeSkuId: "d1-albar-2000",
      storeId: "d1",
      storeName: "Tiendas D1",
      masterProductId: "mp-albar-merged",
      rawName: "Arroz Económico Albar 2000 Grs",
      brand: "ALBAR",
      ean: "7700304985838",
      netContent: 1,
      unitMeasure: "und",
      calibratedPrice: 5550,
      pumPrice: 5550,
    }),
  ];

  const groups = buildMultiTierComparisonGroups(offers, "ean");
  const amorGroup = groups.find((g) => g.brand === "AMOR PERFECTO");
  assert.ok(amorGroup);
  assert.equal(amorGroup.offers.length, 1);
  assert.equal(amorGroup.offers[0].calibratedPrice, 36280);

  const albar450 = groups.find((g) => g.offers[0].storeSkuId === "d1-albar-450");
  const albar2000 = groups.find((g) => g.offers[0].storeSkuId === "d1-albar-2000");
  assert.ok(albar450);
  assert.ok(albar2000);
  assert.notEqual(albar450.groupId, albar2000.groupId);
  assert.equal(albar450.netContent, 450);
  assert.equal(albar450.unitMeasure, "g");
  assert.equal(albar2000.netContent, 2000);
  assert.equal(albar2000.unitMeasure, "g");
});

test("buildMultiTierComparisonGroups genera comparación directa, alternativa parecida y al por mayor", () => {
  const offers: StoreOffer[] = [
    // Arroz 2500g distinto EAN entre D1 y Carulla -> Tier 1 Competencia Directa
    makeOffer({
      storeSkuId: "d1-arroz-2500",
      storeId: "d1",
      storeName: "Tiendas D1",
      masterProductId: "mp-albar-2500",
      rawName: "Arroz Estandar Albar 2500 g",
      brand: "ALBAR",
      ean: "7700304944743",
      netContent: 2500,
      unitMeasure: "g",
      calibratedPrice: 8150,
      pumPrice: 3.26,
    }),
    makeOffer({
      storeSkuId: "ca-arroz-2500",
      storeId: "carulla",
      storeName: "Carulla",
      masterProductId: "mp-frescampo-2500",
      rawName: "Arroz FRESCAMPO blanco (2500 gr)",
      brand: "FRESCAMPO",
      ean: "7701002013489",
      netContent: 2500,
      unitMeasure: "g",
      calibratedPrice: 8470,
      pumPrice: 3.388,
    }),
    // Café 300g en D1 vs Café 1000g en Carulla -> Tier 2 Similar Competitor + Tier 3 Por Mayor
    makeOffer({
      storeSkuId: "d1-cafe-300",
      storeId: "d1",
      storeName: "Tiendas D1",
      masterProductId: "mp-sello-300",
      rawName: "Café Sello Rojo 300 g",
      brand: "SELLO ROJO",
      ean: "7702032109227",
      netContent: 300,
      unitMeasure: "g",
      calibratedPrice: 15350,
      pumPrice: 51.1667,
    }),
    makeOffer({
      storeSkuId: "ca-cafe-1000",
      storeId: "carulla",
      storeName: "Carulla",
      masterProductId: "mp-sello-1000",
      rawName: "Café SELLO ROJO tostado y molido (1000 gr)",
      brand: "SELLO ROJO",
      ean: "7702032109999",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 38900,
      pumPrice: 38.9,
    }),
    // Antipasto de atún NO debe contaminar Atún en agua
    makeOffer({
      storeSkuId: "d1-atun-agua",
      storeId: "d1",
      storeName: "Tiendas D1",
      masterProductId: "mp-atun-170",
      rawName: "Atún en agua Carlo Forte 170 g",
      brand: "CARLO FORTE",
      ean: "7700304930951",
      netContent: 170,
      unitMeasure: "g",
      calibratedPrice: 4450,
      pumPrice: 26.1765,
    }),
    makeOffer({
      storeSkuId: "ca-antipasto-250",
      storeId: "carulla",
      storeName: "Carulla",
      masterProductId: "mp-antipasto",
      rawName: "Antipasto FRESCAMPO con atún (250 gr)",
      brand: "FRESCAMPO",
      ean: "7701001918952",
      netContent: 250,
      unitMeasure: "g",
      calibratedPrice: 15400,
      pumPrice: 61.6,
    }),
  ];

  const groups = buildMultiTierComparisonGroups(offers, "ean");

  const d1Arroz = groups.find((g) => g.offers[0].storeSkuId === "d1-arroz-2500");
  assert.ok(d1Arroz);
  assert.equal(d1Arroz.directCompetitors?.length, 1);
  assert.equal(d1Arroz.directCompetitors?.[0].offer.storeId, "carulla");
  assert.equal(d1Arroz.directCompetitors?.[0].offer.storeSkuId, "ca-arroz-2500");

  const d1Cafe = groups.find((g) => g.offers[0].storeSkuId === "d1-cafe-300");
  assert.ok(d1Cafe);
  assert.equal(d1Cafe.directCompetitors?.length, 0);
  assert.equal(d1Cafe.similarCompetitors?.length, 1);
  assert.equal(d1Cafe.similarCompetitors?.[0].offer.storeSkuId, "ca-cafe-1000");
  assert.equal(d1Cafe.bulkOptions?.length, 1);
  assert.equal(d1Cafe.bulkOptions?.[0].offer.storeSkuId, "ca-cafe-1000");
  assert.ok((d1Cafe.bulkOptions?.[0].pumSavingsPct ?? 0) > 20);
  assert.ok((d1Cafe.bulkOptions?.[0].totalSavingsOnBulkCop ?? 0) > 10000);

  const d1Atun = groups.find((g) => g.offers[0].storeSkuId === "d1-atun-agua");
  assert.ok(d1Atun);
  assert.equal(d1Atun.directCompetitors?.length, 0);
});

test("optimizeBasket respeta allowSubstitutes selectivo por producto (uno con sustitutos y otro solo exacto)", () => {
  const branches: NearbyStoreBranch[] = [
    {
      branchId: "b-ca",
      storeId: "carulla",
      branchName: "Carulla 85",
      city: "Bogotá",
      address: "Cra 15 #85",
      lat: 4.668,
      lng: -74.054,
      distanceMeters: 250,
    },
    {
      branchId: "b-d1",
      storeId: "d1",
      branchName: "D1 85",
      city: "Bogotá",
      address: "Cra 15 #84",
      lat: 4.667,
      lng: -74.055,
      distanceMeters: 280,
    },
  ];

  const offers: StoreOffer[] = [
    // Item 1: Arroz 1000g (D1 tiene sustituto Albar más barato; Carulla tiene Diana)
    makeOffer({
      storeSkuId: "ca-diana-1000",
      storeId: "carulla",
      storeName: "Carulla",
      masterProductId: "mp-arroz-diana",
      rawName: "Arroz DIANA blanco (1000 gr)",
      brand: "DIANA",
      ean: "7702511000001",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 5200,
      pumPrice: 5.2,
    }),
    makeOffer({
      storeSkuId: "d1-albar-1000",
      storeId: "d1",
      storeName: "Tiendas D1",
      masterProductId: "mp-arroz-albar",
      rawName: "Arroz blanco ALBAR (1000 gr)",
      brand: "ALBAR",
      ean: "7700304000001",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 3600,
      pumPrice: 3.6,
    }),
    // Item 2: Café Sello Rojo 300g SOLO exacto (D1 tiene otra marca más barata pero usuario prohíbe sustituir)
    makeOffer({
      storeSkuId: "ca-sello-300",
      storeId: "carulla",
      storeName: "Carulla",
      masterProductId: "mp-cafe-sello",
      rawName: "Café SELLO ROJO molido (300 gr)",
      brand: "SELLO ROJO",
      ean: "7702032109227",
      netContent: 300,
      unitMeasure: "g",
      calibratedPrice: 16500,
      pumPrice: 55,
    }),
    makeOffer({
      storeSkuId: "d1-viejo-300",
      storeId: "d1",
      storeName: "Tiendas D1",
      masterProductId: "mp-cafe-viejo",
      rawName: "Café VIEJO MOLINO molido (300 gr)",
      brand: "VIEJO MOLINO",
      ean: "7700304841999",
      netContent: 300,
      unitMeasure: "g",
      calibratedPrice: 11200,
      pumPrice: 37.33,
    }),
  ];

  const result = optimizeBasket({
    items: [
      {
        itemKey: "item-arroz",
        label: "Arroz DIANA blanco 1000g",
        masterProductId: "mp-arroz-diana",
        canonicalSlug: "arroz-blanco-1000g",
        matchMode: "ean",
        quantity: 1,
        allowSubstitutes: true,
        subtypeFamily: "arroz_blanco",
        broadFamily: "arroz",
        targetNetContent: 1000,
        targetUnitMeasure: "g",
        anchorStoreSkuId: "ca-diana-1000",
        anchorBrand: "DIANA",
        ean: "7702511000001",
      },
      {
        itemKey: "item-cafe",
        label: "Café SELLO ROJO molido 300g",
        masterProductId: "mp-cafe-sello",
        canonicalSlug: "cafe-molido-500g",
        matchMode: "ean",
        quantity: 1,
        allowSubstitutes: false,
        subtypeFamily: "cafe_molido",
        broadFamily: "cafe",
        targetNetContent: 300,
        targetUnitMeasure: "g",
        anchorStoreSkuId: "ca-sello-300",
        anchorBrand: "SELLO ROJO",
        ean: "7702032109227",
      },
    ],
    offers,
    nearbyBranches: branches,
    options: { minExtraSavingsCop: 1000, minExtraSavingsPct: 1 },
  });

  assert.ok(result.bestTwoStores);
  const allocations = result.bestTwoStores.storeStops.flatMap((s) => s.allocations);
  const arrozAlloc = allocations.find((a) => a.itemKey === "item-arroz");
  const cafeAlloc = allocations.find((a) => a.itemKey === "item-cafe");

  assert.ok(arrozAlloc);
  assert.equal(arrozAlloc.offer.storeId, "d1");
  assert.equal(arrozAlloc.offer.storeSkuId, "d1-albar-1000");
  assert.equal(arrozAlloc.isSubstitute, true);

  assert.ok(cafeAlloc);
  assert.equal(cafeAlloc.offer.storeId, "carulla");
  assert.equal(cafeAlloc.offer.storeSkuId, "ca-sello-300");
  assert.equal(cafeAlloc.isSubstitute, false);
});

test("Separa gamas de calidad y aplica tope 1.95x de PUM en competencia directa", () => {
  const offers = [
    makeOffer({
      storeSkuId: "d1-arroz-eco-1000",
      storeId: "d1",
      storeName: "Tiendas D1",
      masterProductId: "mp-arroz-eco",
      rawName: "Arroz blanco ALBAR economico (1000 gr)",
      brand: "ALBAR",
      ean: "7700100000001",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 3600,
      pumPrice: 3.6,
    }),
    makeOffer({
      storeSkuId: "ex-arroz-std-1000",
      storeId: "exito",
      storeName: "Éxito",
      masterProductId: "mp-arroz-std",
      rawName: "Arroz blanco ROA tradicional (1000 gr)",
      brand: "ROA",
      ean: "7700100000002",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 4400,
      pumPrice: 4.4,
    }),
    makeOffer({
      storeSkuId: "ca-arroz-prem-1000",
      storeId: "carulla",
      storeName: "Carulla",
      masterProductId: "mp-arroz-prem",
      rawName: "Arroz blanco SELECCION ESPECIAL gourmet (1000 gr)",
      brand: "CARULLA",
      ean: "7700100000003",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 9800,
      pumPrice: 9.8,
    }),
  ];

  const eanGroups = buildMultiTierComparisonGroups(offers, "ean");
  const ecoGroup = eanGroups.find((g) => g.offers[0].storeSkuId === "d1-arroz-eco-1000");
  assert.ok(ecoGroup);
  assert.equal(ecoGroup.qualityTier, "economico");
  assert.equal(
    (ecoGroup.directCompetitors ?? []).some((d) => d.offer.storeSkuId === "ca-arroz-prem-1000"),
    false,
    "Arroz económico no debe cruzarse directamente con Arroz gourmet 2.7x más caro"
  );

  const pumGroups = buildMultiTierComparisonGroups(offers, "pum");
  const mergedCrossTier = pumGroups.some((g) => {
    const ids = g.offers.map((o) => o.storeSkuId);
    return ids.includes("d1-arroz-eco-1000") && ids.includes("ca-arroz-prem-1000");
  });
  assert.equal(mergedCrossTier, false, "El modo PUM separa gamas distintas");
});

test("Detecta dudas automáticas cuando nombre y PUM se contradicen o rozan 2x", () => {
  const offers = [
    makeOffer({
      storeSkuId: "s1",
      storeId: "d1",
      storeName: "Tiendas D1",
      rawName: "Arroz blanco tradicional A (1000 gr)",
      brand: "A",
      ean: "7700200000001",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 4000,
      pumPrice: 4.0,
    }),
    makeOffer({
      storeSkuId: "s2",
      storeId: "ara",
      storeName: "Tiendas Ara",
      rawName: "Arroz blanco tradicional B (1000 gr)",
      brand: "B",
      ean: "7700200000002",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 4100,
      pumPrice: 4.1,
    }),
    makeOffer({
      storeSkuId: "s-prem-barato",
      storeId: "olimpica",
      storeName: "Olímpica",
      rawName: "Arroz blanco gourmet reserva especial (1000 gr)",
      brand: "C",
      ean: "7700200000003",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 3900,
      pumPrice: 3.9,
    }),
    makeOffer({
      storeSkuId: "s-sin-etiqueta-caro",
      storeId: "carulla",
      storeName: "Carulla",
      rawName: "Arroz blanco tradicional D (1000 gr)",
      brand: "D",
      ean: "7700200000004",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 7900,
      pumPrice: 7.9,
    }),
  ];

  const groups = buildMultiTierComparisonGroups(offers, "ean");
  const cheapPremGroup = groups.find((g) => g.offers[0].storeSkuId === "s-prem-barato");
  const unlabeledExpensiveGroup = groups.find(
    (g) => g.offers[0].storeSkuId === "s-sin-etiqueta-caro"
  );

  assert.ok(cheapPremGroup);
  assert.equal(cheapPremGroup.needsReview, true);
  assert.ok(cheapPremGroup.doubtReason);

  assert.ok(unlabeledExpensiveGroup);
  assert.equal(unlabeledExpensiveGroup.needsReview, true);
  assert.ok(unlabeledExpensiveGroup.doubtReason);
});

test("Aplica overrides de curación admin, excluye SKUs y respeta blocked_pair", () => {
  const offers = [
    makeOffer({
      storeSkuId: "sku-d1-a",
      storeId: "d1",
      storeName: "Tiendas D1",
      rawName: "Atún en agua LOMITOS A (160 gr)",
      brand: "A",
      ean: "7700300000001",
      netContent: 160,
      unitMeasure: "g",
      calibratedPrice: 5200,
      pumPrice: 32.5,
    }),
    makeOffer({
      storeSkuId: "sku-ca-b",
      storeId: "carulla",
      storeName: "Carulla",
      rawName: "Atún en agua LOMITOS B (160 gr)",
      brand: "B",
      ean: "7700300000002",
      netContent: 160,
      unitMeasure: "g",
      calibratedPrice: 5600,
      pumPrice: 35.0,
    }),
    makeOffer({
      storeSkuId: "sku-ex-c",
      storeId: "exito",
      storeName: "Éxito",
      rawName: "Atún en agua LOMITOS C (160 gr)",
      brand: "C",
      ean: "7700300000003",
      netContent: 160,
      unitMeasure: "g",
      calibratedPrice: 5800,
      pumPrice: 36.25,
    }),
  ];

  const groups = buildMultiTierComparisonGroups(offers, "ean", {
    overridesBySkuId: {
      "sku-d1-a": {
        storeSkuId: "sku-d1-a",
        masterProductId: null,
        overrideSubtype: "atun_agua",
        overrideBroadFamily: "atun",
        overrideQualityTier: "premium",
        reviewStatus: "verified",
        doubtReason: null,
        adminNotes: null,
        updatedAt: "2026-11-12T00:00:00Z",
      },
      "sku-ex-c": {
        storeSkuId: "sku-ex-c",
        masterProductId: null,
        overrideSubtype: null,
        overrideBroadFamily: null,
        overrideQualityTier: null,
        reviewStatus: "excluded",
        doubtReason: null,
        adminNotes: "Producto mal catalogado",
        updatedAt: "2026-11-12T00:00:00Z",
      },
    },
    pairRules: [
      {
        id: "rule-1",
        skuAId: "sku-ca-b",
        skuBId: "sku-d1-a",
        ruleType: "blocked_pair",
        reason: "No comparables según admin",
        createdAt: "2026-11-12T00:00:00Z",
      },
    ],
  });

  assert.equal(
    groups.some((g) => g.offers.some((o) => o.storeSkuId === "sku-ex-c")),
    false,
    "SKU excluido no debe aparecer"
  );

  const d1Group = groups.find((g) => g.offers[0].storeSkuId === "sku-d1-a");
  assert.ok(d1Group);
  assert.equal(d1Group.qualityTier, "premium");
  assert.equal(d1Group.reviewStatus, "verified");
  assert.equal(
    (d1Group.directCompetitors ?? []).some((d) => d.offer.storeSkuId === "sku-ca-b"),
    false,
    "Par bloqueado no debe entrar en competencia directa"
  );
  assert.equal(
    (d1Group.similarCompetitors ?? []).some((d) => d.offer.storeSkuId === "sku-ca-b"),
    false,
    "Par bloqueado no debe entrar en similares"
  );
});

test("Opción 1: optimizeBasket respeta características genéricas, clamp de distancia mínima, maxStores e intercambio de producto", () => {
  const branches: NearbyStoreBranch[] = [
    {
      branchId: "b-d1-2400",
      storeId: "d1",
      branchName: "D1 Cedritos",
      city: "Bogotá",
      address: "Cll 140 # 12",
      lat: 4.718,
      lng: -74.035,
      distanceMeters: 2400,
    },
    {
      branchId: "b-ca-3100",
      storeId: "carulla",
      branchName: "Carulla Cedritos",
      city: "Bogotá",
      address: "Cll 140 # 9",
      lat: 4.72,
      lng: -74.03,
      distanceMeters: 3100,
    },
  ];

  const offers: StoreOffer[] = [
    makeOffer({
      storeSkuId: "sku-leche-d1-900",
      storeId: "d1",
      storeName: "Tiendas D1",
      rawName: "Leche Deslactosada Latti 900 ml",
      brand: "Latti",
      ean: "7700400000001",
      netContent: 900,
      unitMeasure: "ml",
      canonicalSlug: "leche-deslactosada-latti-900",
      canonicalName: "Leche Deslactosada Latti",
      calibratedPrice: 3600,
      pumPrice: 4.0,
      isPrivateLabel: true,
    }),
    makeOffer({
      storeSkuId: "sku-leche-d1-sixpack",
      storeId: "d1",
      storeName: "Tiendas D1",
      rawName: "Sixpack Leche Deslactosada Latti 6 x 900 ml",
      brand: "Latti",
      ean: "7700400000002",
      netContent: 5400,
      unitMeasure: "ml",
      canonicalSlug: "sixpack-leche-deslactosada-latti",
      canonicalName: "Sixpack Leche Deslactosada Latti",
      calibratedPrice: 18900,
      pumPrice: 3.5,
      isPrivateLabel: true,
    }),
    makeOffer({
      storeSkuId: "sku-leche-ca-prem",
      storeId: "carulla",
      storeName: "Carulla",
      rawName: "Leche Deslactosada Orgánica Premium 1000 ml",
      brand: "Pomona",
      ean: "7700400000003",
      netContent: 1000,
      unitMeasure: "ml",
      canonicalSlug: "leche-deslactosada-organica-premium",
      canonicalName: "Leche Deslactosada Orgánica Premium",
      calibratedPrice: 7800,
      pumPrice: 7.8,
      isPrivateLabel: false,
    }),
  ];

  // 1) Clamp automático de maxDistanceMeters: pide 1000 m, mínimo real es 2400 m (D1) y excluye Carulla (3100 m)
  const lowestTotalResult = optimizeBasket({
    items: [
      {
        itemKey: "generic:leche",
        label: "Leche",
        masterProductId: null,
        canonicalSlug: null,
        matchMode: "pum",
        quantity: 1,
        allowSubstitutes: true,
        subtypeFamily: "leche_deslactosada",
        broadFamily: "leche",
        targetNetContent: 900,
        targetUnitMeasure: "ml",
        allowedQualityTiers: ["economico", "estandar"],
        pricePriority: "lowest_total",
        originMode: "generic_guided",
      },
    ],
    offers,
    nearbyBranches: branches,
    options: {
      objective: "nominal",
      minExtraSavingsCop: 1500,
      minExtraSavingsPct: 2,
      maxStores: 1,
      maxDistanceMeters: 1000,
    },
  });

  assert.equal(lowestTotalResult.minNearestDistanceMeters, 2400);
  assert.equal(lowestTotalResult.effectiveRadiusMeters, 2400);
  assert.ok(lowestTotalResult.recommendedPlan);
  const firstAlloc = lowestTotalResult.recommendedPlan.storeStops[0]?.allocations[0];
  assert.ok(firstAlloc);
  assert.equal(firstAlloc.offer.storeSkuId, "sku-leche-d1-900");
  assert.equal(lowestTotalResult.singleStoreCarts.length, 1);

  assert.ok(firstAlloc.alternativesInStore && firstAlloc.alternativesInStore.length >= 2);

  // 2) Prioridad menor valor PUM elige sixpack (3.5/ml < 4.0/ml)
  const lowestPumResult = optimizeBasket({
    items: [
      {
        itemKey: "generic:leche",
        label: "Leche",
        masterProductId: null,
        canonicalSlug: null,
        matchMode: "pum",
        quantity: 1,
        allowSubstitutes: true,
        subtypeFamily: "leche_deslactosada",
        broadFamily: "leche",
        targetNetContent: 900,
        targetUnitMeasure: "ml",
        allowedQualityTiers: ["economico", "estandar"],
        pricePriority: "lowest_pum",
        originMode: "generic_guided",
      },
    ],
    offers,
    nearbyBranches: branches,
    options: {
      objective: "nominal",
      minExtraSavingsCop: 1500,
      minExtraSavingsPct: 2,
      maxStores: 2,
      maxDistanceMeters: 3000,
    },
  });

  assert.equal(
    lowestPumResult.recommendedPlan?.storeStops[0]?.allocations[0]?.offer.storeSkuId,
    "sku-leche-d1-sixpack"
  );

  // 3) Intercambio manual en el carrito (preferredSkuByStore) aún con lowest_total
  const swappedResult = optimizeBasket({
    items: [
      {
        itemKey: "generic:leche",
        label: "Leche",
        masterProductId: null,
        canonicalSlug: null,
        matchMode: "pum",
        quantity: 1,
        allowSubstitutes: true,
        subtypeFamily: "leche_deslactosada",
        broadFamily: "leche",
        targetNetContent: 900,
        targetUnitMeasure: "ml",
        allowedQualityTiers: ["economico", "estandar"],
        pricePriority: "lowest_total",
        preferredSkuByStore: { d1: "sku-leche-d1-sixpack" },
        originMode: "generic_guided",
      },
    ],
    offers,
    nearbyBranches: branches,
    options: {
      objective: "nominal",
      minExtraSavingsCop: 1500,
      minExtraSavingsPct: 2,
      maxStores: 1,
      maxDistanceMeters: 3000,
    },
  });

  assert.equal(
    swappedResult.recommendedPlan?.storeStops[0]?.allocations[0]?.offer.storeSkuId,
    "sku-leche-d1-sixpack"
  );
});

test("Opción 2: inferHabitualItemProfile deduce restricciones, calcula ahorro Normal vs Optimizado y exporta texto plano", () => {
  const branches: NearbyStoreBranch[] = [
    {
      branchId: "b-ex",
      storeId: "exito",
      branchName: "Éxito Express",
      city: "Bogotá",
      address: "Cra 11 # 80",
      lat: 4.666,
      lng: -74.054,
      distanceMeters: 400,
    },
    {
      branchId: "b-d1",
      storeId: "d1",
      branchName: "Tiendas D1",
      city: "Bogotá",
      address: "Cra 15 # 82",
      lat: 4.668,
      lng: -74.056,
      distanceMeters: 520,
    },
  ];

  const habitualOffer = makeOffer({
    storeSkuId: "sku-arroz-roa-1000",
    storeId: "exito",
    storeName: "Éxito",
    rawName: "Arroz Blanco Roa Bolsa 1000 g",
    brand: "Roa",
    ean: "7700500000001",
    netContent: 1000,
    unitMeasure: "g",
    canonicalSlug: "arroz-blanco-roa-1000",
    canonicalName: "Arroz Blanco Roa",
    calibratedPrice: 5400,
    pumPrice: 5.4,
    isPrivateLabel: false,
  });

  const substituteOffer = makeOffer({
    storeSkuId: "sku-arroz-d1-1000",
    storeId: "d1",
    storeName: "Tiendas D1",
    rawName: "Arroz Blanco Diana 1000 g",
    brand: "Diana",
    ean: "7700500000002",
    netContent: 1000,
    unitMeasure: "g",
    canonicalSlug: "arroz-blanco-diana-1000",
    canonicalName: "Arroz Blanco Diana",
    calibratedPrice: 3900,
    pumPrice: 3.9,
    isPrivateLabel: false,
  });

  const inferred = inferHabitualItemProfile(habitualOffer);
  assert.equal(inferred.subtypeFamily, "arroz_blanco");
  assert.equal(inferred.broadFamily, "arroz");
  assert.equal(inferred.sizeBucket, "medium");

  const basketItems = [
    {
      itemKey: "habitual:sku-arroz-roa-1000",
      label: "Arroz Blanco Roa",
      masterProductId: habitualOffer.masterProductId,
      canonicalSlug: habitualOffer.canonicalSlug,
      matchMode: "pum" as const,
      quantity: 2,
      allowSubstitutes: true,
      subtypeFamily: inferred.subtypeFamily,
      broadFamily: inferred.broadFamily,
      familyLabel: inferred.familyLabel,
      targetNetContent: inferred.effectiveNetContent,
      targetUnitMeasure: inferred.effectiveUnitMeasure,
      anchorStoreSkuId: habitualOffer.storeSkuId,
      anchorBrand: habitualOffer.brand,
      allowedQualityTiers: ["economico" as const, "estandar" as const],
      pricePriority: "lowest_total" as const,
      habitualReferencePriceCop: habitualOffer.calibratedPrice,
      habitualProductTitle: habitualOffer.rawName,
      originMode: "habitual_guided" as const,
    },
  ];

  const summary = inferBasketProfileSummary(basketItems);
  assert.equal(summary.totalItems, 1);

  const result = optimizeBasket({
    items: basketItems,
    offers: [habitualOffer, substituteOffer],
    nearbyBranches: branches,
    options: {
      objective: "nominal",
      minExtraSavingsCop: 1500,
      minExtraSavingsPct: 2,
      maxStores: 2,
      maxDistanceMeters: 3000,
    },
  });

  assert.ok(result.recommendedPlan);
  assert.equal(result.habitualBaselineCost, 10800);
  assert.equal(result.recommendedPlan.totalNominalCost, 7800);
  assert.equal(result.savingsVsHabitualCop, 3000);

  const plainText = formatBasketAsPlainText({
    mode: "habitual_guided",
    locationLabel: "Bogotá · Chapinero",
    maxDistanceMeters: 3000,
    maxStores: 2,
    plan: result.recommendedPlan,
    habitualBaselineCost: result.habitualBaselineCost,
    savingsVsHabitualCop: result.savingsVsHabitualCop,
    savingsVsHabitualPct: result.savingsVsHabitualPct,
    uncoveredItems: result.uncoveredItems,
  });

  assert.ok(plainText.includes("MERCASABIO"));
  assert.ok(plainText.includes("TIENDAS D1"));
  assert.ok(plainText.includes("10.800"));
  assert.ok(plainText.includes("3.000"));
});

test("Paso 7 Stitch: excludedBrands descarta marcas bloqueadas, expone runnerUpOffer y buildDefaultGenericBasketItems cubre las 3 secciones", () => {
  const defaultItems = buildDefaultGenericBasketItems();
  assert.ok(defaultItems.length >= 10);
  assert.ok(defaultItems.some((i) => i.sectionId === "alacena" && i.subsectionId === "granos"));
  assert.ok(defaultItems.some((i) => i.sectionId === "nevera" && i.subsectionId === "leches"));
  assert.ok(defaultItems.some((i) => i.sectionId === "aseo" && i.subsectionId === "lavanderia"));

  const branches: NearbyStoreBranch[] = [
    {
      branchId: "b-d1",
      storeId: "d1",
      branchName: "D1 Chapinero",
      city: "Bogotá",
      address: "Cra 7",
      lat: 4.64,
      lng: -74.06,
      distanceMeters: 250,
    },
    {
      branchId: "b-ex",
      storeId: "exito",
      branchName: "Éxito Express",
      city: "Bogotá",
      address: "Cra 13",
      lat: 4.645,
      lng: -74.062,
      distanceMeters: 420,
    },
  ];

  const offers: StoreOffer[] = [
    makeOffer({
      storeSkuId: "sku-diana-1",
      storeId: "d1",
      storeName: "Tiendas D1",
      rawName: "Arroz Blanco Diana x 1000 g",
      brand: "Diana",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 3600,
      pumPrice: 3.6,
      canonicalSlug: "arroz-blanco-1000g",
    }),
    makeOffer({
      storeSkuId: "sku-roa-1",
      storeId: "exito",
      storeName: "Éxito",
      rawName: "Arroz Blanco Roa x 1000 g",
      brand: "Roa",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 4400,
      pumPrice: 4.4,
      canonicalSlug: "arroz-blanco-1000g",
    }),
    makeOffer({
      storeSkuId: "sku-florhuila-1",
      storeId: "exito",
      storeName: "Éxito",
      rawName: "Arroz Blanco Florhuila x 1000 g",
      brand: "Florhuila",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 4900,
      pumPrice: 4.9,
      canonicalSlug: "arroz-blanco-1000g",
    }),
  ];

  const arrozItem = defaultItems.find((i) => i.subtypeFamily === "arroz_blanco");
  assert.ok(arrozItem);

  const brands = getAvailableBrandsForItem(arrozItem, offers);
  assert.deepEqual(brands, ["Diana", "Florhuila", "Roa"]);

  const withoutExclusion = optimizeBasket({
    items: [arrozItem],
    offers,
    nearbyBranches: branches,
    options: { maxStores: 2, maxDistanceMeters: 2000 },
  });
  const allocNormal = withoutExclusion.recommendedPlan?.storeStops[0]?.allocations[0];
  assert.equal(allocNormal?.offer.brand, "Diana");
  assert.equal(allocNormal?.runnerUpOffer?.brand, "Roa");

  const withExclusion = optimizeBasket({
    items: [{ ...arrozItem, excludedBrands: ["Diana"] }],
    offers,
    nearbyBranches: branches,
    options: { maxStores: 2, maxDistanceMeters: 2000 },
  });
  const allocExcluded = withExclusion.recommendedPlan?.storeStops[0]?.allocations[0];
  assert.equal(allocExcluded?.offer.brand, "Roa");
  assert.equal(allocExcluded?.runnerUpOffer?.brand, "Florhuila");
  assert.deepEqual(allocExcluded?.excludedBrandsApplied, ["Diana"]);
});

test("optimizeBasket soporta maxStores 4 y 5 paradas cuando hay 5 cadenas distintas", () => {
  const storeIds = ["d1", "ara", "exito", "olimpica", "carulla"];
  const branches: NearbyStoreBranch[] = storeIds.map((id, idx) => ({
    branchId: `br-${id}`,
    storeId: id,
    branchName: `${id.toUpperCase()} Sede`,
    city: "Bogotá",
    address: `Cll ${10 + idx}`,
    lat: 4.64 + idx * 0.001,
    lng: -74.06,
    distanceMeters: 200 + idx * 100,
  }));

  const offers: StoreOffer[] = [
    makeOffer({
      storeSkuId: "o-1",
      storeId: "d1",
      storeName: "Tiendas D1",
      rawName: "Arroz Blanco 1000 g",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 3000,
      pumPrice: 3,
      canonicalSlug: "arroz-blanco-1000g",
    }),
    makeOffer({
      storeSkuId: "o-2",
      storeId: "ara",
      storeName: "Ara",
      rawName: "Leche Deslactosada 1000 ml",
      netContent: 1000,
      unitMeasure: "ml",
      calibratedPrice: 3200,
      pumPrice: 3.2,
      canonicalSlug: "leche-entera-1000ml",
    }),
    makeOffer({
      storeSkuId: "o-3",
      storeId: "exito",
      storeName: "Éxito",
      rawName: "Aceite Vegetal 900 ml",
      netContent: 900,
      unitMeasure: "ml",
      calibratedPrice: 8000,
      pumPrice: 8.88,
      canonicalSlug: "aceite-vegetal-900ml",
    }),
    makeOffer({
      storeSkuId: "o-4",
      storeId: "olimpica",
      storeName: "Olímpica",
      rawName: "Café Molido 500 g",
      netContent: 500,
      unitMeasure: "g",
      calibratedPrice: 12000,
      pumPrice: 24,
      canonicalSlug: "cafe-molido-500g",
    }),
    makeOffer({
      storeSkuId: "o-5",
      storeId: "carulla",
      storeName: "Carulla",
      rawName: "Detergente Ropa 1000 g",
      netContent: 1000,
      unitMeasure: "g",
      calibratedPrice: 7000,
      pumPrice: 7,
      canonicalSlug: "detergente-1000g",
    }),
  ];

  const items = [
    { itemKey: "i1", label: "Arroz", subtypeFamily: "arroz_blanco", broadFamily: "arroz", allowSubstitutes: true },
    { itemKey: "i2", label: "Leche", subtypeFamily: "leche_deslactosada", broadFamily: "leche", allowSubstitutes: true },
    { itemKey: "i3", label: "Aceite", subtypeFamily: "aceite_cocina", broadFamily: "aceite", allowSubstitutes: true },
    { itemKey: "i4", label: "Café", subtypeFamily: "cafe_molido", broadFamily: "cafe", allowSubstitutes: true },
    { itemKey: "i5", label: "Detergente", subtypeFamily: "detergente_ropa", broadFamily: "aseo_hogar", allowSubstitutes: true },
  ];

  const res = optimizeBasket({
    items,
    offers,
    nearbyBranches: branches,
    options: { maxStores: 5, maxDistanceMeters: 2000 },
  });

  assert.equal(res.bestFourStores?.storeStops.length, 4);
  assert.equal(res.bestFiveStores?.storeStops.length, 5);
  assert.equal(res.recommendedPlan?.storeStops.length, 5);
  assert.equal(res.recommendedPlan?.coveredItems, 5);
});
