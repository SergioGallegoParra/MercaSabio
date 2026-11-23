import assert from "node:assert/strict";
import test from "node:test";

import type { BasketItemInput } from "../src/lib/basketOptimizer.ts";
import {
  optimizeBasketWithinBudget,
  solveMultipleChoiceKnapsack,
  type BudgetCandidate,
} from "../src/lib/budgetOptimizer.ts";
import {
  hydrateBasketItemsFromSnapshot,
  sanitizeBasketItemsForSnapshot,
} from "../src/lib/communityBaskets.ts";
import { passesDiet, toggleBasketDietFilter } from "../src/lib/dietaryFilter.ts";
import {
  evaluateFavoriteSaveEligibility,
  FAVORITE_BASKET_LIMITS,
  getAuthGatedFeatures,
  getFavoriteBasketLimit,
  isFeatureUnlocked,
  REQUIRE_AUTH_FOR,
} from "../src/lib/featureAccess.ts";
import { buildHouseholdReport } from "../src/lib/householdReport.ts";
import {
  filterBranchesByCityAndDoubleRadius,
  filterOffersByCityAvailability,
  filterOffersByStoreIds,
  resolveSelectedCityName,
} from "../src/lib/locationFilter.ts";
import { ALL_BARRIOS } from "../src/lib/guidedCatalog.ts";
import { detectPackTrap } from "../src/lib/packTrap.ts";
import { buildWeeklyPaymentCalendar } from "../src/lib/paymentAdvisor.ts";
import { buildPersonalInflationReport } from "../src/lib/personalInflation.ts";
import {
  buildMultiTierComparisonGroups,
} from "../src/lib/comparisonEngine.ts";
import { isMercadoOffer, simplifyProductDisplayName } from "../src/lib/productInsights.ts";
import {
  classifyOfferUnifiedTaxonomy,
  UNIFIED_MACRO_CATEGORIES,
} from "../src/lib/unifiedTaxonomy.ts";
import {
  buildPendingVerificationResponse,
  NIVEL_2_QR_ENABLED,
} from "../src/lib/purchaseVerification.ts";
import { buildReplenishmentAlerts } from "../src/lib/replenishment.ts";
import {
  computeRealPum,
  computeSabiometroFromVotes,
  passesSabiometroFilter,
} from "../src/lib/sabiometro.ts";
import {
  evaluateSamePlantMatch,
  INVIMA_DB_STATUS,
  indexSamePlantPairs,
} from "../src/lib/samePlant.ts";
import { freeMarketsLabel, projectSavings } from "../src/lib/savingsProjection.ts";
import { analyzeSpendingHabits } from "../src/lib/spendingAdvisor.ts";
import {
  compactPlanSnapshot,
  mergeSyncedBasketItem,
  mergeSyncedBaskets,
} from "../src/lib/sync/workspaceSync.ts";
import {
  clampRadiusForTransport,
  estimateTravelCostCop,
  evaluateWalkWeightAlert,
  isExtraStopWorthTravelCost,
} from "../src/lib/transport.ts";
import type {
  NearbyStoreBranch,
  SabiometroVoteInput,
  StoreOffer,
  SyncedBasket,
} from "../src/lib/types.ts";

function makeOffer(overrides: Partial<StoreOffer>): StoreOffer {
  const calibratedPrice = overrides.calibratedPrice ?? 10000;
  const netContent = overrides.netContent ?? 1000;
  return {
    storeSkuId: overrides.storeSkuId ?? "sku-default",
    storeId: overrides.storeId ?? "exito",
    storeName: overrides.storeName ?? "Éxito",
    channelType: "vtex_io",
    masterProductId: overrides.masterProductId ?? "mp-default",
    canonicalCategoryId: 1,
    rawName: overrides.rawName ?? "Producto Genérico 1000 g",
    rawUrl: "https://www.exito.com/p",
    rawListPrice: calibratedPrice,
    rawSalePrice: calibratedPrice,
    calibratedPrice,
    pumPrice: overrides.pumPrice ?? calibratedPrice / Math.max(1, netContent),
    inStock: true,
    sourceOrigin: "vtex_api",
    isEstimatedPhysicalPrice: false,
    isPrivateLabel: overrides.isPrivateLabel ?? false,
    brand: overrides.brand ?? "Marca Test",
    ean: overrides.ean ?? null,
    netContent,
    unitMeasure: overrides.unitMeasure ?? "g",
    canonicalSlug: overrides.canonicalSlug ?? "arroz-blanco",
    canonicalName: overrides.canonicalName ?? "Arroz Blanco",
    imageUrl: null,
    positiveVotes: 0,
    totalVotes: 0,
    avgYieldFactor: 1,
    invimaRegistry: overrides.invimaRegistry ?? null,
    actualManufacturer: overrides.actualManufacturer ?? null,
    shrinkflationAlert: false,
    previousNetContent: null,
    capturedAt: "2026-11-15T12:00:00.000Z",
    ...overrides,
  };
}

function makeBranch(storeId: string, distanceMeters = 450): NearbyStoreBranch {
  return {
    branchId: `br-${storeId}`,
    storeId,
    branchName: `${storeId.toUpperCase()} Chapinero`,
    city: "Bogotá",
    address: "Cra 13 # 60-10",
    lat: 4.646,
    lng: -74.063,
    distanceMeters,
  };
}

test("Sabiómetro: Wilson Lower + penalización 0.6*R_malo + PUM real + umbral + circuit breaker", () => {
  const votes: SabiometroVoteInput[] = [
    { satisfaction: 1.0, yieldFactor: 0.5, reputationLevel: 2, ageDays: 10 },
    { satisfaction: 0.75, yieldFactor: 1.0, reputationLevel: 1, ageDays: 40 },
    { satisfaction: 0.0, yieldFactor: 1.0, reputationLevel: 1, ageDays: 400 },
    { satisfaction: 0.25, yieldFactor: 1.5, reputationLevel: 0, ageDays: 5 },
  ];
  const res = computeSabiometroFromVotes("mp-test", votes);
  assert.equal(res.voteMass, 4.55);
  assert.equal(res.status, "published");
  // Formula exacta verificada: 100 * 0.44374 * (1 - 0.6 * (0.5 / 4.55)) = 41.45
  assert.equal(res.valueIndex, 41.45);
  assert.equal(res.consensusLabel, "Consenso moderado");
  assert.equal(res.supportLabel, "Pocas reseñas");

  const realPum = computeRealPum({
    calibratedPriceCop: 10000,
    netContent: 1000,
    sabiometro: res,
  });
  assert.ok(realPum < 10 && realPum > 6.5);

  // Masa < 1.0 debe devolver estado insuficiente y no bloquear filtros
  const lowMass = computeSabiometroFromVotes("mp-new", [
    { satisfaction: 0.0, yieldFactor: 1.5, reputationLevel: 0, ageDays: 1 },
  ]);
  assert.equal(lowMass.status, "insufficient");
  assert.equal(lowMass.valueIndex, null);
  assert.equal(passesSabiometroFilter(lowMass, 70), true);

  // Circuit breaker congelado
  const frozen = computeSabiometroFromVotes("mp-frozen", votes, {
    underReview: true,
    frozenSummary: {
      voteMass: 4.55,
      valueIndex: 41.45,
      consensusLabel: "Consenso moderado",
      supportLabel: "Pocas reseñas",
      votesCount: 4,
    },
  });
  assert.equal(frozen.status, "under_review");
  assert.equal(frozen.valueIndex, 41.45);

  // Caso Respaldado (W=14.60, R_malo=0.0 -> Compra segura + Respaldado)
  const backedVotes: SabiometroVoteInput[] = [
    { satisfaction: 1.0, yieldFactor: 1.0, reputationLevel: 2, ageDays: 10 },
    { satisfaction: 1.0, yieldFactor: 1.0, reputationLevel: 2, ageDays: 10 },
    { satisfaction: 1.0, yieldFactor: 1.0, reputationLevel: 2, ageDays: 10 },
    { satisfaction: 1.0, yieldFactor: 1.0, reputationLevel: 2, ageDays: 10 },
    { satisfaction: 0.75, yieldFactor: 1.0, reputationLevel: 1, ageDays: 20 },
    { satisfaction: 0.75, yieldFactor: 1.0, reputationLevel: 1, ageDays: 20 },
    { satisfaction: 1.0, yieldFactor: 0.5, reputationLevel: 1, ageDays: 400 },
    { satisfaction: 0.75, yieldFactor: 1.0, reputationLevel: 0, ageDays: 5 },
    { satisfaction: 0.75, yieldFactor: 1.0, reputationLevel: 0, ageDays: 5 },
  ];
  const backed = computeSabiometroFromVotes("mp-backed", backedVotes);
  assert.equal(backed.voteMass, 14.6);
  assert.equal(backed.status, "published");
  assert.equal(backed.consensusLabel, "Compra segura");
  assert.equal(backed.supportLabel, "Respaldado");
  assert.ok(backed.valueIndex !== null && backed.valueIndex >= 75 && backed.valueIndex <= 95);
});

test("Presupuesto MCKP: óptimo exacto igual a fuerza bruta + respeta candados + sugiere desbloqueo", () => {
  const pools: Array<{ itemKey: string; candidates: BudgetCandidate[] }> = [
    {
      itemKey: "arroz",
      candidates: [
        { offer: makeOffer({ storeSkuId: "a1", calibratedPrice: 4000 }), costCop: 4000, utility: 0.55 },
        { offer: makeOffer({ storeSkuId: "a2", calibratedPrice: 6000 }), costCop: 6000, utility: 1.0 },
      ],
    },
    {
      itemKey: "aceite",
      candidates: [
        { offer: makeOffer({ storeSkuId: "b1", calibratedPrice: 7000 }), costCop: 7000, utility: 0.55 },
        { offer: makeOffer({ storeSkuId: "b2", calibratedPrice: 10000 }), costCop: 10000, utility: 1.0 },
      ],
    },
    {
      itemKey: "cafe",
      candidates: [
        { offer: makeOffer({ storeSkuId: "c1", calibratedPrice: 5000 }), costCop: 5000, utility: 0.55 },
        { offer: makeOffer({ storeSkuId: "c2", calibratedPrice: 8000 }), costCop: 8000, utility: 1.0 },
      ],
    },
  ];

  const budget = 19000;
  const dp = solveMultipleChoiceKnapsack({ pools, budgetCop: budget });

  // Fuerza bruta sobre las 8 combinaciones
  let bestUtil = -1;
  for (const a of pools[0].candidates) {
    for (const b of pools[1].candidates) {
      for (const c of pools[2].candidates) {
        const cost = a.costCop + b.costCop + c.costCop;
        if (cost <= budget) {
          bestUtil = Math.max(bestUtil, a.utility + b.utility + c.utility);
        }
      }
    }
  }
  assert.equal(dp.feasible, true);
  assert.ok(dp.totalCostCop <= budget);
  assert.equal(dp.utilityScore, Number(bestUtil.toFixed(4)));

  // E2E con bloqueo inviable sugiriendo cuál candado soltar
  const arrozCheap = makeOffer({
    storeSkuId: "arroz-d1",
    masterProductId: "mp-arroz-eco",
    storeId: "d1",
    rawName: "Arroz Blanco Económico 1000 g",
    calibratedPrice: 3600,
    canonicalSlug: "arroz-blanco",
  });
  const arrozFav = makeOffer({
    storeSkuId: "arroz-exito",
    masterProductId: "mp-arroz-fav",
    storeId: "exito",
    rawName: "Arroz Blanco Diana 1000 g",
    calibratedPrice: 6800,
    canonicalSlug: "arroz-blanco",
  });
  const items: BasketItemInput[] = [
    {
      itemKey: "arroz-lock",
      label: "Arroz Blanco 1 kg",
      subtypeFamily: "arroz_blanco",
      broadFamily: "arroz",
      anchorStoreSkuId: "arroz-exito",
      targetNetContent: 1000,
      targetUnitMeasure: "g",
      locked: true,
    },
  ];
  const infeas = optimizeBasketWithinBudget({
    items,
    offers: [arrozCheap, arrozFav],
    nearbyBranches: [makeBranch("d1"), makeBranch("exito")],
    budgetCop: 4500,
    mode: "generic",
    lockedItemKeys: new Set(["arroz-lock"]),
  });
  assert.equal(infeas.feasible, false);
  assert.ok(infeas.blockingLocks.length === 1);
  assert.equal(infeas.blockingLocks[0].itemKey, "arroz-lock");
  assert.equal(infeas.blockingLocks[0].unlockSavingsCop, 3200);
});

test("Trampa del empaque grande + filtros alimentarios conservadores reversibles", () => {
  const bigOil = makeOffer({
    storeSkuId: "oil-3l",
    storeId: "exito",
    rawName: "Aceite Vegetal Familiar 3000 ml",
    canonicalSlug: "aceite-vegetal",
    netContent: 3000,
    unitMeasure: "ml",
    calibratedPrice: 36000,
    pumPrice: 12,
  });
  const medOil = makeOffer({
    storeSkuId: "oil-1l",
    storeId: "exito",
    rawName: "Aceite Vegetal Mediano 1000 ml",
    canonicalSlug: "aceite-vegetal",
    netContent: 1000,
    unitMeasure: "ml",
    calibratedPrice: 10000,
    pumPrice: 10,
  });
  const item: BasketItemInput = {
    itemKey: "aceite",
    label: "Aceite vegetal",
    subtypeFamily: "aceite_cocina",
    sizePreference: "large",
  };
  const trap = detectPackTrap(item, bigOil, [bigOil, medOil]);
  assert.ok(trap !== null);
  assert.equal(trap.equivalentSavingsCop, 6000);

  // Filtro sin lactosa bloquea leche entera sin atributo explícito
  const wholeMilk = makeOffer({
    rawName: "Leche Entera Alquería 1000 ml",
    canonicalName: "Leche Entera",
    unitMeasure: "ml",
  });
  const almondMilk = makeOffer({
    rawName: "Bebida de Almendras Sin Azúcar 1000 ml",
    canonicalName: "Bebida Vegetal",
    unitMeasure: "ml",
  });
  assert.equal(passesDiet(undefined, ["lactose_free"], wholeMilk), "fail");
  assert.equal(passesDiet(undefined, ["lactose_free"], almondMilk), "pass");

  const reverted = toggleBasketDietFilter(["lactose_free", "gluten_free"], "lactose_free");
  assert.deepEqual(reverted, ["gluten_free"]);
});

test("Modificación #4: mercados gratis al año calculados sobre total del mercado optimizado", () => {
  const proj = projectSavings({
    savingsPerTripCop: 26400,
    optimizedBasketTotalCop: 141200,
    cadence: "biweekly",
  });
  assert.equal(proj.monthlySavingsCop, 57300);
  assert.equal(proj.yearlySavingsCop, 687600);
  assert.equal(proj.freeMarketsPerYear, 4.87);
  assert.equal(freeMarketsLabel(proj.freeMarketsPerYear), "casi 5 mercados optimizados gratis al año");
});

test("Transporte (pie vs vehículo) + Inflación personal + Hogar + Recompra", () => {
  assert.equal(clampRadiusForTransport(10000, "walk"), 2500);
  assert.equal(clampRadiusForTransport(10000, "car"), 10000);
  assert.ok(estimateTravelCostCop({ distanceMeters: 4000, stopCount: 2, mode: "car" }) > 0);
  assert.equal(
    isExtraStopWorthTravelCost({ extraSavingsCop: 2000, extraDistanceMeters: 5000, mode: "car" })
      .worth,
    false
  );
  assert.ok(evaluateWalkWeightAlert({ totalWeightKg: 14.2, mode: "walk" }) !== null);
  assert.equal(evaluateWalkWeightAlert({ totalWeightKg: 14.2, mode: "car" }), null);

  // Inflación personal + plan de contención
  const items: BasketItemInput[] = [
    {
      itemKey: "huevos-hab",
      label: "Huevos AAA ×30",
      masterProductId: "mp-huevos-a",
      subtypeFamily: "huevos_gallina",
      familyLabel: "Huevos",
      targetNetContent: 30,
      targetUnitMeasure: "und",
      quantity: 1,
    },
  ];
  const priceHistoryByMaster = new Map([
    ["mp-huevos-a", { masterProductId: "mp-huevos-a", priceACop: 15000, priceBCop: 21000 }],
  ]);
  const cheapEggs = makeOffer({
    storeSkuId: "eggs-d1",
    masterProductId: "mp-huevos-b",
    storeId: "d1",
    rawName: "Huevos Rojos A 30 und",
    netContent: 30,
    unitMeasure: "und",
    calibratedPrice: 14900,
  });
  const inf = buildPersonalInflationReport({
    dateA: "2026-10-15",
    dateB: "2026-11-15",
    items,
    priceHistoryByMaster,
    offers: [cheapEggs],
    nearbyBranches: [makeBranch("d1")],
  });
  assert.equal(inf.deltaCop, 6000);
  assert.ok(inf.topCauses[0].familyLabel === "Huevos");

  // Informe hogar respeta vida útil de perecederos para hogar unipersonal
  const milkSmall = makeOffer({
    storeSkuId: "m-1",
    rawName: "Leche Entera 1000 ml",
    netContent: 1000,
    unitMeasure: "ml",
    calibratedPrice: 4500,
  });
  const milkSixPack = makeOffer({
    storeSkuId: "m-12",
    rawName: "Leche Entera Paca 12000 ml",
    netContent: 12000,
    unitMeasure: "ml",
    calibratedPrice: 46000,
  });
  const hrSingle = buildHouseholdReport({
    adults: 1,
    children: 0,
    items: [
      {
        itemKey: "leche",
        label: "Leche Entera",
        subtypeFamily: "leche_entera",
        targetUnitMeasure: "ml",
        anchorStoreSkuId: "m-1",
      },
    ],
    offers: [milkSmall, milkSixPack],
  });
  assert.ok(hrSingle.skippedPerishableFamilies.includes("Leche Entera"));

  // Recompra alerta cuando intervalo está próximo y hay promoción
  const repl = buildReplenishmentAlerts({
    events: [
      {
        familyKey: "arroz_blanco",
        productTitle: "Arroz 1 kg",
        quantity: 1,
        netContent: 1000,
        purchasedAt: "2026-10-01T10:00:00.000Z",
      },
      {
        familyKey: "arroz_blanco",
        productTitle: "Arroz 1 kg",
        quantity: 1,
        netContent: 1000,
        purchasedAt: "2026-10-16T10:00:00.000Z",
      },
    ],
    offers: [makeOffer({ rawName: "Arroz Blanco 1000 g", storeId: "exito", calibratedPrice: 4200 })],
    adults: 2,
    children: 0,
    now: new Date("2026-11-15T12:00:00.000Z"),
  });
  assert.ok(repl.length >= 1);

  // Hábitos de gasto
  const spending = analyzeSpendingHabits({
    declaredMonthlyBudgetCop: 400000,
    actualMonthlySpendCop: 480000,
    cadence: "weekly",
    items: [{ itemKey: "a", label: "Arroz", sectionId: "alacena" }],
  });
  assert.ok(spending.some((r) => r.id === "over_budget"));
  assert.ok(spending.some((r) => r.id === "split_pantry_fresh"));

  // Calendario pagos semanal
  const cal = buildWeeklyPaymentCalendar({
    storeSubtotals: [{ storeId: "exito", storeName: "Éxito", subtotalCop: 100000 }],
    userPaymentMethods: [{ partnerId: "p-1", partnerName: "Nequi", productVariant: "cuenta" }],
    promotions: [
      {
        id: 1,
        partnerId: "p-1",
        partnerName: "Nequi",
        storeId: "exito",
        canonicalCategoryId: null,
        discountType: "pct",
        discountValue: 10,
        maxDiscountCop: 20000,
        minPurchaseCop: 50000,
        validDays: [3],
        termsShort: "10% con Nequi miércoles",
        active: true,
      },
    ],
    storePromoDays: [],
  });
  assert.equal(cal.bestDayOfWeek, 3);
  assert.equal(cal.paymentDiscountCop, 10000);
});

test("Sync PC↔Móvil (LWW + unión chulos) y Modificaciones #1, #3, #6", () => {
  const localBasket: SyncedBasket = {
    id: "b1",
    workspaceId: "ws1",
    title: "Mi mercado",
    status: "optimized",
    isHabitual: true,
    budgetCop: null,
    optimizeMode: "generic",
    activeDietFilters: [],
    transportMode: "walk",
    maxStores: 2,
    radiusMeters: 2000,
    lastPlan: null,
    lastPlanAt: null,
    version: 3,
    updatedByDevice: "mobile",
    createdAt: "2026-11-15T10:00:00.000Z",
    updatedAt: "2026-11-15T10:05:00.000Z",
    items: [
      {
        basketId: "b1",
        itemKey: "arroz",
        payload: { label: "Arroz" },
        quantity: 2,
        isLocked: true,
        checkedAt: "2026-11-15T10:06:00.000Z",
        checkedByDevice: "mobile",
        sortOrder: 0,
        version: 4,
        updatedAt: "2026-11-15T10:06:00.000Z",
      },
    ],
  };

  const remoteBasket: SyncedBasket = {
    ...localBasket,
    version: 4,
    updatedByDevice: "pc",
    items: [
      {
        basketId: "b1",
        itemKey: "arroz",
        payload: { label: "Arroz" },
        quantity: 2,
        isLocked: false,
        checkedAt: null,
        checkedByDevice: null,
        sortOrder: 0,
        version: 3,
        updatedAt: "2026-11-15T10:03:00.000Z",
      },
    ],
  };

  const merged = mergeSyncedBaskets([localBasket], [remoteBasket]);
  assert.equal(merged[0].items[0].checkedAt, "2026-11-15T10:06:00.000Z");

  // Borrado más reciente gana sobre versión menor
  const deletedRemote = mergeSyncedBasketItem(localBasket.items[0], {
    ...localBasket.items[0],
    version: 5,
    deletedAt: "2026-11-15T10:08:00.000Z",
    updatedAt: "2026-11-15T10:08:00.000Z",
  });
  assert.ok(deletedRemote.deletedAt !== null);

  // Compactación de lastPlan quita alternativesInStore para caber < 50 KB
  const compacted = compactPlanSnapshot({
    storeStops: [
      {
        storeId: "exito",
        allocations: [{ itemKey: "arroz", alternativesInStore: [{ storeSkuId: "1" }, { storeSkuId: "2" }] }],
      },
    ],
  });
  const compactedAlloc = ((compacted?.storeStops as Array<{ allocations: Array<Record<string, unknown>> }>)[0])
    .allocations[0];
  assert.equal("alternativesInStore" in compactedAlloc, false);

  // Modificación #1: Sin login obligatorio hoy
  assert.equal(getAuthGatedFeatures().length, 0);
  for (const k of Object.keys(REQUIRE_AUTH_FOR) as Array<keyof typeof REQUIRE_AUTH_FOR>) {
    assert.equal(isFeatureUnlocked(k, null), true);
  }
  assert.equal(isFeatureUnlocked("household_report", null, { household_report: true }), false);
  assert.equal(
    isFeatureUnlocked("household_report", { id: "u1", isRegistered: true }, { household_report: true }),
    true
  );

  // Modificación #3: Nivel 2 QR creado y pendiente
  assert.equal(NIVEL_2_QR_ENABLED, false);
  const stub = buildPendingVerificationResponse({
    cufe: "cufe-demo",
    invoiceNumber: "F123",
    issuerNit: "900",
    issuedAtRaw: "2026-11-15",
    invoiceTotalCop: 90000,
    rawUrl: null,
  });
  assert.equal(stub.status, "module_pending");

  // Modificación #6: INVIMA pendiente de poblar + evaluación verificada
  assert.equal(INVIMA_DB_STATUS, "pending_population");
  const idx = indexSamePlantPairs([
    {
      productA: "mp-premium",
      productB: "mp-white",
      matchLevel: "same_plant",
      confidence: 0.92,
      verifiedByAdmin: true,
      sharedInvimaRegistry: "NSA-000123-2024",
      manufacturerName: "Molinos Unidos S.A.",
      plantName: "Planta Ibagué",
      plantCity: "Ibagué",
    },
  ]);
  const info = evaluateSamePlantMatch({
    anchorOffer: makeOffer({ masterProductId: "mp-premium", brand: "Premium", pumPrice: 12 }),
    recommendedOffer: makeOffer({ masterProductId: "mp-white", brand: "Económica", pumPrice: 8 }),
    anchorTier: "estandar",
    recommendedTier: "economico",
    sameFamily: true,
    samePlantIndex: idx,
  });
  assert.ok(info !== null);
  assert.ok(info.explanationText.includes("Planta Ibagué"));
});

test("Worker de presupuesto acepta lockedItemKeys como arreglo serializable y Set", async () => {
  const { runBudgetWorkerPayload } = await import("../src/workers/budget.worker.ts");
  const arrozCheap = makeOffer({
    storeSkuId: "arroz-d1-w",
    masterProductId: "mp-arroz-d1-w",
    storeId: "d1",
    rawName: "Arroz Economico 1000 g",
    calibratedPrice: 3600,
    canonicalSlug: "arroz-blanco",
  });
  const arrozFav = makeOffer({
    storeSkuId: "arroz-exito-w",
    masterProductId: "mp-arroz-fav-w",
    storeId: "exito",
    rawName: "Arroz Favorito 1000 g",
    calibratedPrice: 6800,
    canonicalSlug: "arroz-blanco",
  });
  const items: BasketItemInput[] = [
    {
      itemKey: "arroz-lock-w",
      label: "Arroz Blanco 1 kg",
      subtypeFamily: "arroz_blanco",
      broadFamily: "arroz",
      anchorStoreSkuId: "arroz-exito-w",
      targetNetContent: 1000,
      targetUnitMeasure: "g",
      locked: true,
    },
  ];
  const resFromArray = runBudgetWorkerPayload({
    items,
    offers: [arrozCheap, arrozFav],
    nearbyBranches: [makeBranch("d1"), makeBranch("exito")],
    budgetCop: 4500,
    mode: "generic",
    lockedItemKeys: ["arroz-lock-w"],
  });
  assert.equal(resFromArray.feasible, false);
  assert.ok(Array.isArray(resFromArray.swaps));
  assert.equal(resFromArray.blockingLocks.length, 1);

  const unlockedItems = items.map((x) => ({ ...x, locked: false }));
  const resUnlocked = runBudgetWorkerPayload({
    items: unlockedItems,
    offers: [arrozCheap, arrozFav],
    nearbyBranches: [makeBranch("d1"), makeBranch("exito")],
    budgetCop: 4500,
    mode: "generic",
    lockedItemKeys: new Set<string>(),
  });
  assert.equal(resUnlocked.feasible, true);
  assert.equal(resUnlocked.totalCop, 3600);
  assert.equal(resUnlocked.blockingLocks.length, 0);
  assert.ok(Array.isArray(resUnlocked.swaps));
});

test("Favoritos (Gratis=1 vs Premium=10) y Comunidad (publicar, copiar y modificar)", () => {
  // Límite por defecto: Gratis = 1, Premium = 10
  assert.equal(FAVORITE_BASKET_LIMITS.free, 1);
  assert.equal(FAVORITE_BASKET_LIMITS.premium, 10);
  assert.equal(getFavoriteBasketLimit("free"), 1);
  assert.equal(getFavoriteBasketLimit("premium"), 10);

  const freeOk = evaluateFavoriteSaveEligibility({
    currentFavoritesCount: 0,
    planTier: "free",
  });
  assert.equal(freeOk.allowed, true);

  const freeBlocked = evaluateFavoriteSaveEligibility({
    currentFavoritesCount: 1,
    planTier: "free",
  });
  assert.equal(freeBlocked.allowed, false);
  assert.ok(freeBlocked.reason?.includes("1"));

  const freeReplace = evaluateFavoriteSaveEligibility({
    currentFavoritesCount: 1,
    planTier: "free",
    replacingFavoriteId: "fav-1",
  });
  assert.equal(freeReplace.allowed, true);

  const premOk = evaluateFavoriteSaveEligibility({
    currentFavoritesCount: 9,
    planTier: "premium",
  });
  assert.equal(premOk.allowed, true);

  const premBlocked = evaluateFavoriteSaveEligibility({
    currentFavoritesCount: 10,
    planTier: "premium",
  });
  assert.equal(premBlocked.allowed, false);

  // Comunidad: sanitización e hidratación ("copy_use" preserva candados; "copy_edit" desbloquea para modificar)
  const sampleItems: BasketItemInput[] = [
    {
      itemKey: "leche-desl",
      label: "Leche deslactosada ×6",
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
      locked: false,
    },
    {
      itemKey: "cafe-fijo",
      label: "Café Sello Rojo 500 g",
      subtypeFamily: "cafe_molido",
      broadFamily: "cafe",
      anchorStoreSkuId: "sku-sello",
      anchorBrand: "Sello Rojo",
      targetNetContent: 500,
      targetUnitMeasure: "g",
      quantity: 1,
      allowedQualityTiers: ["estandar"],
      allowSubstitutes: false,
      locked: true,
    },
  ];

  const snapshot = sanitizeBasketItemsForSnapshot(sampleItems);
  assert.equal(snapshot.length, 2);
  assert.equal(snapshot[0].requiredCriticalAttribute, "deslactosada");

  const copiedUse = hydrateBasketItemsFromSnapshot(snapshot, {
    sourcePrefix: "comm",
    unlockAllOnEdit: false,
  });
  assert.equal(copiedUse[1].locked, true);
  assert.equal(copiedUse[1].allowSubstitutes, false);

  const copiedEdit = hydrateBasketItemsFromSnapshot(snapshot, {
    sourcePrefix: "comm",
    unlockAllOnEdit: true,
  });
  assert.equal(copiedEdit[1].locked, false);
  assert.equal(copiedEdit[1].allowSubstitutes, true);
  assert.equal(copiedEdit[0].requiredCriticalAttribute, "deslactosada");
});

test("Filtro estricto por ciudad elegida y tope de 2x distancia para tiendas y productos", () => {
  const chosenCity = resolveSelectedCityName(
    { lat: 5.034, lng: -75.461, label: "Manizales · La Enea" },
    ALL_BARRIOS,
    []
  );
  assert.equal(chosenCity, "Manizales");

  const branches = [
    {
      branchId: "b-ara",
      storeId: "ara",
      branchName: "Tiendas Ara · Cra. 35 #101-50",
      city: "Manizales",
      address: "Cra. 35 #101-50",
      lat: 5.031,
      lng: -75.462,
      distanceMeters: 334,
    },
    {
      branchId: "b-d1",
      storeId: "d1",
      branchName: "Tiendas D1 · Cra. 32 #105c",
      city: "Manizales",
      address: "Cra. 32 #105c",
      lat: 5.0315,
      lng: -75.458,
      distanceMeters: 425,
    },
    {
      branchId: "b-villamaria",
      storeId: "farmatodo",
      branchName: "Farmatodo La Florida",
      city: "Villamaría",
      address: "Cra. 1, Villamaría",
      lat: 5.03,
      lng: -75.48,
      distanceMeters: 2100,
    },
    {
      branchId: "b-oxxo-far",
      storeId: "oxxo",
      branchName: "OXXO Milán 23",
      city: "Manizales",
      address: "Milán",
      lat: 5.045,
      lng: -75.479,
      distanceMeters: 2464, // >= 2 * 1200 m
    },
  ];

  // Radio elegido = 1200 m -> 2x = 2400 m; solo Manizales y < 2400 m
  const scope = filterBranchesByCityAndDoubleRadius({
    branches,
    chosenCity,
    radiusMeters: 1200,
  });

  assert.deepEqual(
    scope.branchesWithinDoubleRadius.map((b) => b.storeId),
    ["ara", "d1"]
  );
  assert.equal(scope.visibleStoreIds.has("farmatodo"), false); // Otra ciudad (Villamaría)
  assert.equal(scope.visibleStoreIds.has("oxxo"), false); // >= 2x distancia (2464 >= 2400)
  assert.equal(scope.visibleStoreIds.has("zapatoca"), false); // No existe en Manizales

  const offers = [
    makeOffer({ storeSkuId: "o-ara", storeId: "ara", rawName: "Arroz Ara" }),
    makeOffer({ storeSkuId: "o-d1", storeId: "d1", rawName: "Leche D1" }),
    makeOffer({ storeSkuId: "o-oxxo", storeId: "oxxo", rawName: "Café OXXO" }),
    makeOffer({ storeSkuId: "o-zap", storeId: "zapatoca", rawName: "Frijol Zapatoca" }),
  ];

  const visibleOffers = filterOffersByStoreIds(offers, scope.visibleStoreIds);
  assert.deepEqual(
    visibleOffers.map((o) => o.storeId),
    ["ara", "d1"]
  );
});

test("filterOffersByCityAvailability filtra SKUs segun availableCities por ciudad elegida", () => {
  const offers = [
    makeOffer({
      storeSkuId: "o-national",
      storeId: "d1",
      rawName: "Arroz D1 (nacional)",
      availableCities: null,
    }),
    makeOffer({
      storeSkuId: "o-bogota-only",
      storeId: "olimpica",
      rawName: "Producto solo Bogotá",
      availableCities: ["bogota"],
    }),
    makeOffer({
      storeSkuId: "o-manizales",
      storeId: "olimpica",
      rawName: "Leche disponible en Manizales",
      availableCities: ["bogota", "manizales"],
    }),
    makeOffer({
      storeSkuId: "o-out-of-stock",
      storeId: "farmatodo",
      rawName: "Sin stock en ninguna ciudad",
      availableCities: [],
    }),
  ];

  const manizalesOffers = filterOffersByCityAvailability(offers, "Manizales");
  assert.deepEqual(
    manizalesOffers.map((o) => o.storeSkuId),
    ["o-national", "o-manizales"]
  );

  // Sin ciudad elegida (fallback) no filtra por regionalidad
  const allOffers = filterOffersByCityAvailability(offers, "");
  assert.equal(allOffers.length, 4);
});

test("simplifyProductDisplayName limpia gramajes repetidos y homogeneiza Title Case en español", () => {
  assert.equal(
    simplifyProductDisplayName("LECHE ALPINA DESLACTOSADA EN BOLSA DE 1100 ML", "ml"),
    "Leche Alpina Deslactosada en Bolsa"
  );
  assert.equal(
    simplifyProductDisplayName("Té Bitaco Verde Lulo 20 G Té Bitaco Verde Lulo 20 G", "g"),
    "Té Bitaco Verde Lulo"
  );
  assert.equal(
    simplifyProductDisplayName("Papel Higiénico Familia Húmedo x 50 und", "und"),
    "Papel Higiénico Familia Húmedo"
  );
});

test("comparisonEngine separa subpresentaciones leche deslactosada vs entera y cafe liofilizado vs instantaneo", () => {
  const lecheDeslact = makeOffer({
    storeSkuId: "l-desl",
    storeId: "d1",
    rawName: "Leche Latti Deslactosada 1100 ml",
    canonicalSlug: "leche-entera-1000ml",
    subPresentation: "leche_deslactosada",
    subPresentationLabel: "Leche deslactosada",
    calibratedPrice: 4200,
    pumPrice: 3.82,
    netContent: 1100,
    unitMeasure: "ml",
  });
  const lecheEntera = makeOffer({
    storeSkuId: "l-ent",
    storeId: "exito",
    rawName: "Leche Éxito Entera 1100 ml",
    canonicalSlug: "leche-entera-1000ml",
    subPresentation: "leche_entera",
    subPresentationLabel: "Leche entera",
    calibratedPrice: 4100,
    pumPrice: 3.73,
    netContent: 1100,
    unitMeasure: "ml",
  });

  const cafeLiof = makeOffer({
    storeSkuId: "c-liof",
    storeId: "carulla",
    rawName: "Café Juan Valdez Liofilizado 95 g",
    subPresentation: "cafe_liofilizado",
    subPresentationLabel: "Café liofilizado",
    calibratedPrice: 22900,
    pumPrice: 241,
    netContent: 95,
    unitMeasure: "g",
  });
  const cafeInst = makeOffer({
    storeSkuId: "c-inst",
    storeId: "olimpica",
    rawName: "Café Colcafé Instantáneo 95 g",
    subPresentation: "cafe_instantaneo",
    subPresentationLabel: "Café instantáneo / soluble",
    calibratedPrice: 14900,
    pumPrice: 156.8,
    netContent: 95,
    unitMeasure: "g",
  });

  const groups = buildMultiTierComparisonGroups([lecheDeslact, lecheEntera, cafeLiof, cafeInst], "pum");
  const lecheGroup = groups.find((g) => g.offers.some((o) => o.storeSkuId === "l-desl"));
  assert.ok(lecheGroup);
  assert.equal(
    (lecheGroup.directCompetitors ?? []).some((m) => m.offer.storeSkuId === "l-ent"),
    false
  );

  const cafeGroup = groups.find((g) => g.offers.some((o) => o.storeSkuId === "c-liof"));
  assert.ok(cafeGroup);
  assert.equal(
    (cafeGroup.directCompetitors ?? []).some((m) => m.offer.storeSkuId === "c-inst"),
    false
  );
});

test("unifiedTaxonomy agrupa en 10x59 y refuerza exclusiones de maquillaje, peluches y Tena adulto", () => {
  assert.equal(UNIFIED_MACRO_CATEGORIES.length, 10);
  const subCount = UNIFIED_MACRO_CATEGORIES.reduce((acc, m) => acc + m.subcategories.length, 0);
  assert.equal(subCount, 59);

  assert.equal(
    classifyOfferUnifiedTaxonomy(
      makeOffer({ rawName: "Alimento Perros Dog Chow Adultos 2000 g", brand: "Dog Chow" })
    ).subLabel,
    "Mascotas"
  );
  assert.equal(
    classifyOfferUnifiedTaxonomy(
      makeOffer({ rawName: "Crema Dental Colgate Triple Accion 150 ml", brand: "Colgate" })
    ).subLabel,
    "Cuidado oral"
  );
  assert.equal(
    classifyOfferUnifiedTaxonomy(
      makeOffer({ rawName: "Panales Winny Gold Etapa 3 x 50 und", brand: "Winny" })
    ).subLabel,
    "Pañales y pañitos húmedos"
  );
  assert.equal(
    classifyOfferUnifiedTaxonomy(
      makeOffer({ rawName: "Detergente Liquido Ariel 2000 ml", brand: "Ariel" })
    ).subLabel,
    "Detergentes y cuidado de ropa"
  );

  // Colados reales bloqueados vs falsos positivos permitidos
  assert.equal(isMercadoOffer(makeOffer({ storeId: "megatiendas", rawName: "Esmalte de Uñas Nailen 10 g" })), false);
  assert.equal(isMercadoOffer(makeOffer({ storeId: "farmatodo", rawName: "Lubricante WD-40 Multiusos 191 ml" })), false);
  assert.equal(isMercadoOffer(makeOffer({ storeId: "makro", rawName: "OSO DE PELUCHE VDM CON LUZ LED" })), false);
  assert.equal(isMercadoOffer(makeOffer({ storeId: "d1", rawName: "Suavizante Xtra Perfume Bonaropa 1 L" })), true);
});
