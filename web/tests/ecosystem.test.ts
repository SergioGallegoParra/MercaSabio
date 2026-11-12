import assert from "node:assert/strict";
import test from "node:test";

import { optimizeBasket } from "../src/lib/basketOptimizer.ts";
import {
  buildStoreAffiliateUrl,
  cleanProductTitle,
  computeRealUsageMetrics,
  findActiveBankPromotions,
  getSteamRatingBadge,
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
