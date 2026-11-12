import assert from "node:assert/strict";
import test from "node:test";

import { optimizeBasket } from "../src/lib/basketOptimizer.ts";
import { buildMultiTierComparisonGroups } from "../src/lib/comparisonEngine.ts";
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
