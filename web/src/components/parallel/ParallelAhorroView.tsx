"use client";

import { useEffect, useMemo, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import {
  PackTrapAlert,
  PumHelpTrigger,
  RappiSavingsBadge,
  SabiometroBadge,
  SamePlantBadge,
  SmartProductImage,
  StoreBadge,
} from "@/components/parallel/ParallelPrimitives";
import { CommunityMarketsView } from "@/components/v3/CommunityMarketsView";
import { useWorkspace } from "@/components/v3/WorkspaceContext";
import type {
  BasketAllocation,
  BasketItemInput,
  BasketOptimizationResult,
  BasketPlan,
} from "@/lib/basketOptimizer";
import { formatCop, formatNetContent, formatPum } from "@/lib/formatters";
import { buildHabitualSwaps } from "@/lib/habitualDiff";
import { buildHouseholdReport } from "@/lib/householdReport";
import { buildWeeklyPaymentCalendar } from "@/lib/paymentAdvisor";
import { buildPersonalInflationReport, type HistoricalPricePair } from "@/lib/personalInflation";
import { detectPackTrap } from "@/lib/packTrap";
import { getOfferDisplayTitle } from "@/lib/productInsights";
import { buildReplenishmentAlerts } from "@/lib/replenishment";
import { indexSamePlantPairs, type SamePlantPairRecord } from "@/lib/samePlant";
import { freeMarketsLabel, projectSavings } from "@/lib/savingsProjection";
import { analyzeSpendingHabits } from "@/lib/spendingAdvisor";
import type {
  DietFilter,
  FavoriteBasketRecord,
  HabitualSwap,
  HouseholdReportItem,
  NearbyStoreBranch,
  PaymentPromotion,
  RappiDiscountItem,
  ReplenishmentAlert,
  StoreOffer,
  StorePromoDay,
  TransportMode,
} from "@/lib/types";

export type ParallelAhorroSubTab = "optimizada" | "comunidad" | "hogar_pagos" | "recompras";

export function ParallelAhorroView({
  subTab,
  onChangeSubTab,
  activePlan,
  optimization,
  basketItems,
  knownOffers,
  nearbyBranches,
  activeDietFilters,
  zoneLabel,
  transportMode,
  maxStores,
  onChangeMaxStores,
  onChangeTransportMode,
  paymentPromotions,
  storePromoDays,
  samePlantPairs,
  rappiDiscounts = [],
  onInspectOffer,
  onToggleLockItem,
  onSelectSwapOffer,
  onOpenBudget,
  onOpenHousehold,
  onOpenFavorites,
  onOpenPreferences,
  onGoCanasta,
  onGoRuta,
  onLoadFavoriteQuick,
  onCopyCommunityBasket,
  onApplyContainmentSwaps,
  onAdoptHouseholdFormats,
  onAddReplenishAlert,
}: {
  subTab: ParallelAhorroSubTab;
  onChangeSubTab: (tab: ParallelAhorroSubTab) => void;
  activePlan: BasketPlan | null;
  optimization: BasketOptimizationResult;
  basketItems: BasketItemInput[];
  knownOffers: StoreOffer[];
  nearbyBranches: NearbyStoreBranch[];
  activeDietFilters: DietFilter[];
  zoneLabel: string;
  transportMode: TransportMode;
  maxStores: 1 | 2 | 3 | 4 | 5;
  onChangeMaxStores: (count: 1 | 2 | 3 | 4 | 5) => void;
  onChangeTransportMode: (mode: TransportMode) => void;
  paymentPromotions: PaymentPromotion[];
  storePromoDays: StorePromoDay[];
  samePlantPairs: SamePlantPairRecord[];
  rappiDiscounts?: RappiDiscountItem[];
  onInspectOffer: (offer: StoreOffer, baseline?: StoreOffer | null, itemKey?: string) => void;
  onToggleLockItem: (itemKey: string) => void;
  onSelectSwapOffer: (itemKey: string, offer: StoreOffer) => void;
  onOpenBudget: () => void;
  onOpenHousehold: () => void;
  onOpenFavorites: () => void;
  onOpenPreferences: () => void;
  onGoCanasta: () => void;
  onGoRuta: () => void;
  onLoadFavoriteQuick: (fav: FavoriteBasketRecord) => void;
  onCopyCommunityBasket: (
    items: BasketItemInput[],
    dietFilters: DietFilter[],
    mode: "copy_use" | "copy_edit",
    sourceTitle: string
  ) => void;
  onApplyContainmentSwaps: (swaps: HabitualSwap[]) => void;
  onAdoptHouseholdFormats: (items: HouseholdReportItem[]) => void;
  onAddReplenishAlert: (rep: ReplenishmentAlert) => void;
}) {
  const { credentials, userProfile, paymentMethods, purchaseEvents, alerts, markAlertRead } =
    useWorkspace();
  const [swapOpenKey, setSwapOpenKey] = useState<string | null>(null);
  const [inflationHistory, setInflationHistory] = useState<Map<string, HistoricalPricePair>>(
    new Map()
  );
  const [inflationError, setInflationError] = useState(false);

  const basketByKey = useMemo(() => {
    const map = new Map<string, BasketItemInput>();
    for (const item of basketItems) map.set(item.itemKey, item);
    return map;
  }, [basketItems]);

  const samePlantIndex = useMemo(() => indexSamePlantPairs(samePlantPairs), [samePlantPairs]);
  const lockedKeys = useMemo(
    () => new Set(basketItems.filter((i) => i.locked).map((i) => i.itemKey)),
    [basketItems]
  );

  const habitualSwaps = useMemo(() => {
    if (!activePlan) return [];
    return buildHabitualSwaps({
      plan: activePlan,
      items: basketItems,
      knownOffers,
      lockedItemKeys: lockedKeys,
      samePlantIndex,
    }).swaps;
  }, [activePlan, basketItems, knownOffers, lockedKeys, samePlantIndex]);

  const topSavings = useMemo(() => {
    if (!activePlan || habitualSwaps.length > 0) return [];
    return activePlan.storeStops
      .flatMap((s) => s.allocations)
      .map((alloc) => ({
        alloc,
        saveCop: Math.max(0, alloc.baselineReferenceCost - alloc.nominalCost),
        savePct:
          alloc.baselineReferenceCost > 0
            ? Math.round(
                (Math.max(0, alloc.baselineReferenceCost - alloc.nominalCost) /
                  alloc.baselineReferenceCost) *
                  100
              )
            : 0,
      }))
      .filter((e) => e.saveCop >= 400)
      .sort((a, b) => b.saveCop - a.saveCop)
      .slice(0, 5);
  }, [activePlan, habitualSwaps.length]);

  useEffect(() => {
    if (subTab !== "hogar_pagos") return;
    const masterIds = [
      ...new Set(
        basketItems.map((i) => i.masterProductId).filter((id): id is string => Boolean(id))
      ),
    ];
    if (masterIds.length === 0) return;

    const controller = new AbortController();
    setInflationError(false);

    fetch("/api/reports/inflation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        masterProductIds: masterIds,
        preferredStoreIds: userProfile?.preferredStoreIds ?? [],
      }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: { rows?: Array<{ masterProductId: string; priceA: number | null; priceB: number | null }> }) => {
        const map = new Map<string, HistoricalPricePair>();
        for (const r of json.rows ?? []) {
          map.set(r.masterProductId, {
            masterProductId: r.masterProductId,
            priceACop: r.priceA,
            priceBCop: r.priceB,
          });
        }
        setInflationHistory(map);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name !== "AbortError") {
          setInflationError(true);
        }
      });

    return () => controller.abort();
  }, [subTab, basketItems, userProfile?.preferredStoreIds]);

  const inflationReport = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const prevMonth = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    return buildPersonalInflationReport({
      dateA: prevMonth,
      dateB: today,
      items: basketItems,
      priceHistoryByMaster: inflationHistory,
      offers: knownOffers,
      nearbyBranches,
      dietFilters: activeDietFilters,
    });
  }, [basketItems, inflationHistory, knownOffers, nearbyBranches, activeDietFilters]);

  const householdReport = useMemo(
    () =>
      buildHouseholdReport({
        adults: userProfile?.householdAdults ?? 2,
        children: userProfile?.householdChildren ?? 0,
        items: basketItems,
        offers: knownOffers,
        transportMode: userProfile?.transportMode ?? "walk",
      }),
    [userProfile, basketItems, knownOffers]
  );

  const spendingRecs = useMemo(
    () =>
      analyzeSpendingHabits({
        declaredMonthlyBudgetCop: userProfile?.monthlyBudgetCop ?? null,
        actualMonthlySpendCop:
          (activePlan?.totalNominalCost ?? 140000) *
          (userProfile?.shoppingCadence === "weekly" ? 4.33 : 2.17),
        cadence: userProfile?.shoppingCadence ?? "biweekly",
        items: basketItems,
      }),
    [userProfile, activePlan, basketItems]
  );

  const weeklyCalendar = useMemo(() => {
    const storeSubtotals =
      activePlan && activePlan.storeStops.length > 0
        ? activePlan.storeStops.map((s) => ({
            storeId: s.storeId,
            storeName: s.storeName,
            subtotalCop: s.subtotalNominal,
          }))
        : Array.from(
            new Map(
              nearbyBranches.map((b) => [
                b.storeId,
                { storeId: b.storeId, storeName: b.storeId.toUpperCase(), subtotalCop: 65000 },
              ])
            ).values()
          ).slice(0, 4);
    return buildWeeklyPaymentCalendar({
      storeSubtotals,
      userPaymentMethods: paymentMethods,
      promotions: paymentPromotions,
      storePromoDays,
    });
  }, [activePlan, nearbyBranches, paymentMethods, paymentPromotions, storePromoDays]);

  const replenishmentAlerts = useMemo(
    () =>
      buildReplenishmentAlerts({
        events: purchaseEvents,
        offers: knownOffers,
        storePromoDays,
        adults: userProfile?.householdAdults ?? 2,
        children: userProfile?.householdChildren ?? 0,
      }),
    [purchaseEvents, knownOffers, storePromoDays, userProfile]
  );

  const savingsProj = useMemo(() => {
    if (!activePlan) return null;
    const p = projectSavings({
      savingsPerTripCop: activePlan.savingsVsBaselineCop,
      optimizedBasketTotalCop: activePlan.totalNominalCost,
      cadence: userProfile?.shoppingCadence ?? "biweekly",
    });
    return { ...p, label: freeMarketsLabel(p.freeMarketsPerYear) };
  }, [activePlan, userProfile?.shoppingCadence]);

  function findBaseline(alloc: BasketAllocation): StoreOffer | null {
    const src = basketByKey.get(alloc.itemKey);
    if (!src) return null;
    if (src.anchorStoreSkuId) {
      const exact = knownOffers.find((o) => o.storeSkuId === src.anchorStoreSkuId);
      if (exact) return exact;
    }
    if (src.habitualProductTitle || src.habitualReferencePriceCop) {
      return {
        ...alloc.offer,
        storeSkuId: src.anchorStoreSkuId ?? `${alloc.itemKey}-base`,
        masterProductId: `${alloc.itemKey}-base`,
        rawName: src.habitualProductTitle ?? alloc.label,
        displayName: src.habitualProductTitle ?? alloc.label,
        brand: src.anchorBrand ?? null,
        calibratedPrice:
          src.habitualReferencePriceCop ??
          Math.round(alloc.baselineReferenceCost / Math.max(1, alloc.quantity)),
        netContent: src.targetNetContent ?? alloc.offer.netContent,
        unitMeasure: src.targetUnitMeasure ?? alloc.offer.unitMeasure,
      };
    }
    return null;
  }

  return (
    <div className="ms2-col-stack">
      <div className="ms2-section-head">
        <div>
          <h1 className="ms2-h1">Centro de ahorro</h1>
          <p className="ms2-sub">
            Compara precios optimizados, canastas de la comunidad, formatos del hogar y días de descuento.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="ms2-btn ms2-btn-secondary ms2-btn-sm" onClick={onOpenPreferences}>
            <HearthIcon name="tune" size={14} />
            <span>Filtros y candados</span>
          </button>
          <button type="button" className="ms2-btn ms2-btn-secondary ms2-btn-sm" onClick={onOpenBudget}>
            <HearthIcon name="wallet" size={14} />
            <span>Presupuesto</span>
          </button>
          <PumHelpTrigger variant="pill" />
        </div>
      </div>

      {/* 4 Sub-pestañas consolidadas (sin redundancia) */}
      <div className="ms2-tablist" role="tablist" aria-label="Análisis de ahorro">
        {[
          { id: "optimizada" as const, label: "Compra optimizada" },
          { id: "comunidad" as const, label: "Comunidad y favoritos" },
          { id: "hogar_pagos" as const, label: "Hogar, inflación y pagos" },
          {
            id: "recompras" as const,
            label: `Recompras y alertas (${replenishmentAlerts.length + alerts.length})`,
          },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={subTab === t.id}
            className="ms2-tab"
            onClick={() => onChangeSubTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* SUBTAB 1: COMPRA OPTIMIZADA */}
      {subTab === "optimizada" && (
        <>
          {basketItems.length === 0 ? (
            <div className="ms2-card" style={{ textAlign: "center", padding: "32px 20px" }}>
              <h2 className="ms2-h2">Aún no tienes productos en tu canasta</h2>
              <p className="ms2-muted" style={{ margin: "6px auto 16px", maxWidth: "46ch" }}>
                Agrega al menos un producto para calcular la combinación más económica entre los supermercados de tu zona.
              </p>
              <button type="button" className="ms2-btn ms2-btn-primary" onClick={onGoCanasta}>
                <HearthIcon name="shopping_basket" size={16} />
                <span>Ir a armar mi canasta →</span>
              </button>
            </div>
          ) : !activePlan ? (
            <div className="ms2-card" style={{ padding: 24 }}>
              <h2 className="ms2-h2">No encontramos combinaciones dentro de tu radio o filtros</h2>
              <p className="ms2-sub">
                Amplía la distancia de búsqueda o relaja alguno de los filtros de dieta para ver resultados.
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button type="button" className="ms2-btn ms2-btn-primary" onClick={onOpenPreferences}>
                  Revisar filtros
                </button>
                <button type="button" className="ms2-btn ms2-btn-secondary" onClick={onGoRuta}>
                  Ajustar radio en Ruta
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="ms2-kpi-grid">
                <div className="ms2-kpi-card">
                  <span className="ms2-muted">Referencia promedio</span>
                  <span
                    className="ms2-kpi-val ms2-num"
                    style={{ textDecoration: "line-through", color: "var(--ms2-ink-muted)" }}
                  >
                    {formatCop(activePlan.baselineReferenceTotalCost)}
                  </span>
                  <span className="ms2-muted">Sin optimizar</span>
                </div>

                <div className="ms2-kpi-card hero">
                  <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.85)" }}>
                    Total MercaSabio
                  </span>
                  <span className="ms2-kpi-val ms2-num">{formatCop(activePlan.totalNominalCost)}</span>
                  <span style={{ fontSize: "0.78rem", color: "#f6cd77" }}>
                    {activePlan.storeStops.map((s) => s.storeName).join(" + ")}
                  </span>
                </div>

                <div className="ms2-kpi-card savings">
                  <span className="ms2-muted">Ahorro en este mercado</span>
                  <span className="ms2-kpi-val ms2-num" style={{ color: "var(--ms2-primary)" }}>
                    {formatCop(activePlan.savingsVsBaselineCop)}
                  </span>
                  <span className="ms2-badge green ms2-num" style={{ alignSelf: "flex-start" }}>
                    {activePlan.savingsVsBaselinePct}% menos
                  </span>
                </div>
              </div>

              {savingsProj && (
                <div className="ms2-card ms2-card-tint">
                  <div className="ms2-row-between">
                    <div>
                      <strong>{savingsProj.label}</strong>
                      <p className="ms2-muted" style={{ margin: "2px 0 0" }}>
                        Proyección anual:{" "}
                        <strong className="ms2-num" style={{ color: "var(--ms2-primary)" }}>
                          {formatCop(savingsProj.yearlySavingsCop)}
                        </strong>{" "}
                        al año comprando con tu frecuencia actual.
                      </p>
                    </div>
                    <button type="button" className="ms2-btn ms2-btn-primary" onClick={onGoRuta}>
                      <HearthIcon name="alt_route" size={16} />
                      <span>Ver ruta en mapa →</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Workspace 3 columnas reales en Desktop */}
              <div className="ms2-ahorro-3col">
                {/* Columna 1: Asignación por producto */}
                <section className="ms2-card" aria-label="Productos optimizados">
                  <div className="ms2-row-between" style={{ marginBottom: 12 }}>
                    <h2 className="ms2-h2">Productos en tu compra</h2>
                    <span className="ms2-badge neutral ms2-num">
                      {activePlan.storeStops.flatMap((s) => s.allocations).length} ítems
                    </span>
                  </div>

                  <div className="ms2-list-stack">
                    {activePlan.storeStops.flatMap((stop) =>
                      stop.allocations.map((alloc) => {
                        const title = getOfferDisplayTitle(alloc.offer);
                        const src = basketByKey.get(alloc.itemKey);
                        const locked = Boolean(src?.locked);
                        const baseline = findBaseline(alloc);
                        const isSwapping = swapOpenKey === alloc.itemKey;
                        const packTrap = src
                          ? detectPackTrap(
                              src,
                              alloc.offer,
                              knownOffers.filter(
                                (o) =>
                                  o.storeId === alloc.offer.storeId &&
                                  o.canonicalSlug === alloc.offer.canonicalSlug
                              )
                            )
                          : null;

                        return (
                          <article
                            key={alloc.itemKey}
                            className="ms2-card"
                            style={{ padding: 12, background: "var(--ms2-bg)" }}
                          >
                            <div className="ms2-row-between" style={{ alignItems: "flex-start" }}>
                              <button
                                type="button"
                                className="ms2-offer-inspect-btn"
                                onClick={() => onInspectOffer(alloc.offer, baseline, alloc.itemKey)}
                              >
                                <div
                                  style={{
                                    width: 48,
                                    height: 48,
                                    borderRadius: 9,
                                    background: "#ffffff",
                                    flexShrink: 0,
                                    overflow: "hidden",
                                  }}
                                >
                                  <SmartProductImage src={alloc.offer.imageUrl} alt={title} size={48} />
                                </div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ fontWeight: 700, fontSize: "0.86rem" }}>
                                    {alloc.quantity > 1 ? `${alloc.quantity}× ` : ""}
                                    {title}
                                  </div>
                                  <div className="ms2-muted ms2-num">
                                    {alloc.offer.storeName} ·{" "}
                                    {formatNetContent(alloc.offer.netContent, alloc.offer.unitMeasure)} ·{" "}
                                    {formatPum(alloc.offer.pumPrice, alloc.offer.unitMeasure)}
                                  </div>
                                </div>
                              </button>

                              <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <strong className="ms2-num" style={{ color: "var(--ms2-primary)" }}>
                                  {formatCop(alloc.nominalCost)}
                                </strong>
                                <div style={{ marginTop: 4 }}>
                                  <button
                                    type="button"
                                    className="ms2-btn ms2-btn-sm ms2-btn-secondary"
                                    style={{ minHeight: 30, padding: "2px 8px", fontSize: "0.74rem" }}
                                    aria-pressed={locked}
                                    onClick={() => onToggleLockItem(alloc.itemKey)}
                                  >
                                    <HearthIcon name={locked ? "lock" : "lock_open"} size={12} />
                                    <span>{locked ? "Fijo" : "Fijar"}</span>
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                              <SabiometroBadge summary={alloc.offer.sabiometro} />
                              <RappiSavingsBadge offer={alloc.offer} />
                              <SamePlantBadge
                                offer={alloc.offer}
                                baselineOffer={baseline}
                                samePlantIndex={samePlantIndex}
                              />
                              {alloc.alternativesInStore.length > 1 && (
                                <button
                                  type="button"
                                  className="ms2-btn ms2-btn-ghost ms2-btn-sm"
                                  style={{ minHeight: 28, padding: "2px 8px", fontSize: "0.74rem" }}
                                  onClick={() => setSwapOpenKey(isSwapping ? null : alloc.itemKey)}
                                >
                                  Cambiar opción ({alloc.alternativesInStore.length})
                                </button>
                              )}
                            </div>

                            {packTrap && (
                              <div style={{ marginTop: 8 }}>
                                <PackTrapAlert warning={packTrap} />
                              </div>
                            )}

                            {isSwapping && (
                              <div className="ms2-list-stack" style={{ marginTop: 8 }}>
                                {alloc.alternativesInStore.map((alt) => (
                                  <button
                                    key={alt.storeSkuId}
                                    type="button"
                                    className="ms2-item-row"
                                    style={{
                                      cursor: "pointer",
                                      padding: "8px 10px",
                                      borderColor:
                                        alt.storeSkuId === alloc.offer.storeSkuId
                                          ? "var(--ms2-primary)"
                                          : "var(--ms2-border)",
                                    }}
                                    onClick={() => {
                                      onSelectSwapOffer(alloc.itemKey, alt);
                                      setSwapOpenKey(null);
                                    }}
                                  >
                                    <div style={{ minWidth: 0, textAlign: "left" }}>
                                      <strong style={{ fontSize: "0.8rem" }}>
                                        {getOfferDisplayTitle(alt)}
                                      </strong>
                                      <div className="ms2-muted ms2-num">
                                        {formatNetContent(alt.netContent, alt.unitMeasure)} ·{" "}
                                        {formatPum(alt.pumPrice, alt.unitMeasure)}
                                      </div>
                                    </div>
                                    <strong className="ms2-num" style={{ color: "var(--ms2-primary)" }}>
                                      {formatCop(alt.calibratedPrice)}
                                    </strong>
                                  </button>
                                ))}
                              </div>
                            )}
                          </article>
                        );
                      })
                    )}
                  </div>
                </section>

                {/* Columna 2: Cambios inteligentes / Mejores ahorros */}
                <section className="ms2-card" aria-label="Mejores ahorros encontrados">
                  <div className="ms2-row-between" style={{ marginBottom: 12 }}>
                    <h2 className="ms2-h2">
                      {habitualSwaps.length > 0 ? "Cambios recomendados" : "Mayores ahorros"}
                    </h2>
                    <span className="ms2-badge gold ms2-num">
                      {habitualSwaps.length > 0 ? habitualSwaps.length : topSavings.length} oportunidades
                    </span>
                  </div>

                  {habitualSwaps.length > 0 ? (
                    <div className="ms2-list-stack">
                      {habitualSwaps.map((sw) => (
                        <article
                          key={sw.itemKey}
                          className="ms2-card"
                          style={{ padding: 12, background: "var(--ms2-bg)" }}
                        >
                          <div className="ms2-row-between">
                            <span className="ms2-muted">{sw.habitual.title}</span>
                            <span className="ms2-badge green ms2-num">
                              Ahorras {formatCop(sw.savingsCop)} ({sw.savingsPct}%)
                            </span>
                          </div>
                          <div style={{ marginTop: 6, fontWeight: 700, fontSize: "0.88rem" }}>
                            → {getOfferDisplayTitle(sw.recommended)}
                          </div>
                          <div className="ms2-muted ms2-num" style={{ marginTop: 2 }}>
                            {sw.recommended.storeName} · {formatCop(sw.recommended.calibratedPrice)}
                          </div>
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button
                              type="button"
                              className="ms2-btn ms2-btn-secondary ms2-btn-sm"
                              onClick={() => onInspectOffer(sw.recommended, null, sw.itemKey)}
                            >
                              Comparar ficha
                            </button>
                            <button
                              type="button"
                              className="ms2-btn ms2-btn-ghost ms2-btn-sm"
                              onClick={() => onToggleLockItem(sw.itemKey)}
                            >
                              Fijar el mío
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : topSavings.length > 0 ? (
                    <div className="ms2-list-stack">
                      {topSavings.map(({ alloc, saveCop, savePct }) => (
                        <article
                          key={alloc.itemKey}
                          className="ms2-card"
                          style={{ padding: 12, background: "var(--ms2-bg)" }}
                        >
                          <div className="ms2-row-between">
                            <StoreBadge
                              storeId={alloc.offer.storeId}
                              storeName={alloc.offer.storeName}
                            />
                            <span className="ms2-badge green ms2-num">
                              -{formatCop(saveCop)} (-{savePct}%)
                            </span>
                          </div>
                          <div style={{ marginTop: 6, fontWeight: 700, fontSize: "0.88rem" }}>
                            {getOfferDisplayTitle(alloc.offer)}
                          </div>
                          <div className="ms2-muted ms2-num" style={{ marginTop: 2 }}>
                            {formatCop(alloc.nominalCost)} frente a{" "}
                            {formatCop(alloc.baselineReferenceCost)} de referencia
                          </div>
                          <button
                            type="button"
                            className="ms2-btn ms2-btn-soft ms2-btn-sm"
                            style={{ marginTop: 8 }}
                            onClick={() =>
                              onInspectOffer(alloc.offer, alloc.runnerUpOffer ?? null, alloc.itemKey)
                            }
                          >
                            Ver ficha técnica
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="ms2-muted">
                      Todos los productos de tu canasta ya están en el mejor precio por unidad disponible.
                    </p>
                  )}

                  {optimization.uncoveredItems.length > 0 && (
                    <div
                      className="ms2-card"
                      style={{
                        marginTop: 12,
                        background: "var(--ms2-warn-soft)",
                        borderColor: "#e6be7a",
                        padding: 12,
                      }}
                    >
                      <strong style={{ fontSize: "0.82rem", color: "var(--ms2-warn)" }}>
                        Sin stock con los filtros actuales ({optimization.uncoveredItems.length}):
                      </strong>
                      <p className="ms2-muted" style={{ margin: "4px 0 0" }}>
                        {optimization.uncoveredItems.join(", ")}
                      </p>
                    </div>
                  )}
                </section>

                {/* Columna 3: Plan de tiendas y control de paradas */}
                <section className="ms2-card" aria-label="Tiendas y ruta">
                  <h2 className="ms2-h2" style={{ marginBottom: 10 }}>
                    Tiendas y paradas
                  </h2>

                  <div className="ms2-card" style={{ background: "var(--ms2-bg)", padding: 12 }}>
                    <div className="ms2-row-between">
                      <span style={{ fontSize: "0.84rem", fontWeight: 700 }}>
                        Máximo de supermercados
                      </span>
                      <div className="ms2-stepper">
                        <button
                          type="button"
                          className="ms2-stepper-btn"
                          disabled={maxStores <= 1}
                          aria-label="Menos tiendas"
                          onClick={() =>
                            onChangeMaxStores(Math.max(1, maxStores - 1) as 1 | 2 | 3 | 4 | 5)
                          }
                        >
                          <HearthIcon name="remove" size={13} />
                        </button>
                        <span className="ms2-num" style={{ minWidth: 26, textAlign: "center", fontWeight: 800 }}>
                          {maxStores}
                        </span>
                        <button
                          type="button"
                          className="ms2-stepper-btn"
                          disabled={maxStores >= 5}
                          aria-label="Más tiendas"
                          onClick={() =>
                            onChangeMaxStores(Math.min(5, maxStores + 1) as 1 | 2 | 3 | 4 | 5)
                          }
                        >
                          <HearthIcon name="add" size={13} />
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                      <button
                        type="button"
                        className={`ms2-chip ${transportMode === "walk" ? "active" : ""}`}
                        style={{ flex: 1, justifyContent: "center" }}
                        onClick={() => onChangeTransportMode("walk")}
                      >
                        A pie
                      </button>
                      <button
                        type="button"
                        className={`ms2-chip ${transportMode === "car" ? "active" : ""}`}
                        style={{ flex: 1, justifyContent: "center" }}
                        onClick={() => onChangeTransportMode("car")}
                      >
                        En carro
                      </button>
                    </div>
                  </div>

                  <div className="ms2-list-stack" style={{ marginTop: 12 }}>
                    {activePlan.storeStops.map((stop, idx) => (
                      <div key={stop.storeId} className="ms2-item-row" style={{ padding: 10 }}>
                        <div>
                          <strong style={{ fontSize: "0.86rem" }}>
                            {idx + 1}. {stop.storeName}
                          </strong>
                          <div className="ms2-muted ms2-num">
                            {stop.allocations.length} productos ·{" "}
                            {Math.round(stop.branch.distanceMeters)} m
                          </div>
                        </div>
                        <strong className="ms2-num" style={{ color: "var(--ms2-primary)" }}>
                          {formatCop(stop.subtotalNominal)}
                        </strong>
                      </div>
                    ))}
                  </div>

                  <div className="ms2-list-stack" style={{ marginTop: 14 }}>
                    <button type="button" className="ms2-btn ms2-btn-primary" onClick={onGoRuta}>
                      <HearthIcon name="alt_route" size={16} />
                      <span>Ir a Ruta y Modo Góndola →</span>
                    </button>
                    <button type="button" className="ms2-btn ms2-btn-secondary" onClick={onOpenBudget}>
                      <HearthIcon name="wallet" size={16} />
                      <span>Ajustar a presupuesto</span>
                    </button>
                  </div>
                </section>
              </div>
            </>
          )}

          {rappiDiscounts.length > 0 && (
            <section className="ms2-card" aria-label="Descuentos reales en Rappi">
              <div className="ms2-row-between" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                <div>
                  <h2 className="ms2-h2">Descuentos reales comprando por Rappi (Ísimo)</h2>
                  <p className="ms2-muted" style={{ margin: 0 }}>
                    Comparados contra el precio estándar oficial de Ísimo: el ahorro mostrado es real y verificado.
                  </p>
                </div>
                <span className="ms2-badge green ms2-num">
                  {rappiDiscounts.length} productos con ahorro activo
                </span>
              </div>

              <div className="ms2-grid-2">
                {rappiDiscounts.slice(0, 12).map((item) => (
                  <article
                    key={item.storeSkuId}
                    className="ms2-card"
                    style={{ padding: 12, background: "var(--ms2-bg)", display: "flex", gap: 10, alignItems: "center" }}
                  >
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 10,
                        background: "#ffffff",
                        flexShrink: 0,
                        overflow: "hidden",
                      }}
                    >
                      <SmartProductImage src={item.imageUrl} alt={item.displayName} size={48} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.86rem" }}>
                        {item.displayName}
                      </div>
                      <div className="ms2-muted ms2-num">
                        {formatNetContent(item.netContent, item.unitMeasure)} · Estándar:{" "}
                        <span style={{ textDecoration: "line-through" }}>
                          {formatCop(item.standardPrice)}
                        </span>{" "}
                        →{" "}
                        <strong style={{ color: "var(--ms2-primary)" }}>
                          {formatCop(item.rappiPromoPrice)} en Rappi
                        </strong>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                        <span className="ms2-badge green ms2-num">
                          Ahorras {formatCop(item.rappiSavingsCop)} (-{Math.round(item.rappiSavingsPct)}%)
                        </span>
                        {item.rappiPromoUrl && (
                          <a
                            href={item.rappiPromoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ms2-muted"
                            style={{ fontSize: "0.78rem", textDecoration: "underline" }}
                          >
                            Ver en Rappi
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* SUBTAB 2: COMUNIDAD Y FAVORITOS */}
      {subTab === "comunidad" && (
        <CommunityMarketsView
          currentItems={basketItems}
          activePlan={activePlan}
          activeDietFilters={activeDietFilters}
          zoneLabel={zoneLabel}
          onCopyBasket={(items, diet, mode, title) => {
            onCopyCommunityBasket(items, diet, mode, title);
          }}
          onOpenFavorites={onOpenFavorites}
          onLoadFavoriteQuick={onLoadFavoriteQuick}
        />
      )}

      {/* SUBTAB 3: HOGAR, INFLACIÓN Y PAGOS (Unifica 3 subtabs + tablero redundante) */}
      {subTab === "hogar_pagos" && (
        <div className="ms2-grid-2">
          {/* Bloque 1: Inflación Personal */}
          <section className="ms2-card">
            <div className="ms2-row-between" style={{ marginBottom: 10 }}>
              <div>
                <h2 className="ms2-h2">Inflación personal</h2>
                <p className="ms2-muted" style={{ margin: 0 }}>
                  {inflationReport.dateA} → {inflationReport.dateB}
                </p>
              </div>
              <span className="ms2-badge gold ms2-num">
                IPC ref. +{inflationReport.foodIpcReferencePct}%
              </span>
            </div>

            {inflationError ? (
              <p className="ms2-muted">
                No pudimos consultar el histórico en este momento; intentando con datos locales.
              </p>
            ) : inflationReport.lines.length === 0 ? (
              <p className="ms2-muted">
                Aún no hay suficientes registros diarios para comparar precios de tus productos habituales.
              </p>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: "0.96rem", marginBottom: 8 }} className="ms2-num">
                  {inflationReport.deltaCop >= 0
                    ? `Tu mercado subió ${formatCop(inflationReport.deltaCop)} (${inflationReport.deltaPct}%)`
                    : `Tu mercado bajó ${formatCop(Math.abs(inflationReport.deltaCop))}`}
                </div>
                <div className="ms2-list-stack">
                  {inflationReport.lines.slice(0, 5).map((line) => (
                    <div key={line.masterProductId} className="ms2-row-between">
                      <span style={{ fontSize: "0.84rem" }}>{line.title}</span>
                      <strong className="ms2-num" style={{ fontSize: "0.84rem" }}>
                        {formatCop(line.priceBCop)} ({line.deltaPct >= 0 ? "+" : ""}
                        {line.deltaPct}%)
                      </strong>
                    </div>
                  ))}
                </div>
                {inflationReport.containmentSwaps.length > 0 && (
                  <button
                    type="button"
                    className="ms2-btn ms2-btn-primary ms2-btn-sm"
                    style={{ width: "100%", marginTop: 12 }}
                    onClick={() => onApplyContainmentSwaps(inflationReport.containmentSwaps)}
                  >
                    Aplicar {inflationReport.containmentSwaps.length} cambios de ahorro (-
                    {formatCop(inflationReport.containmentSavingsCop)})
                  </button>
                )}
              </>
            )}
          </section>

          {/* Bloque 2: Informe del Hogar y Formatos */}
          <section className="ms2-card">
            <div className="ms2-row-between" style={{ marginBottom: 10 }}>
              <div>
                <span className="ms2-code ms2-muted">
                  {credentials?.householdCode ?? "HOGAR-LOCAL"}
                </span>
                <h2 className="ms2-h2">
                  Formatos para tu hogar ({householdReport.adults} ad. · {householdReport.children}{" "}
                  niñ.)
                </h2>
              </div>
              <button
                type="button"
                className="ms2-btn ms2-btn-secondary ms2-btn-sm"
                onClick={onOpenHousehold}
              >
                Editar hogar
              </button>
            </div>

            <div className="ms2-info-grid-2" style={{ marginBottom: 10 }}>
              <div className="ms2-card" style={{ background: "var(--ms2-bg)", padding: 10 }}>
                <span className="ms2-muted">Ahorro por empaque</span>
                <strong className="ms2-num" style={{ display: "block", fontSize: "1.1rem", color: "var(--ms2-primary)" }}>
                  {formatCop(householdReport.totalMonthlySavingsCop)}/mes
                </strong>
              </div>
              <div className="ms2-card" style={{ background: "var(--ms2-bg)", padding: 10 }}>
                <span className="ms2-muted">Viajes evitados</span>
                <strong className="ms2-num" style={{ display: "block", fontSize: "1.1rem" }}>
                  {householdReport.totalTripsAvoidedPerMonth}/mes
                </strong>
              </div>
            </div>

            {householdReport.items.length > 0 ? (
              <>
                <div className="ms2-list-stack">
                  {householdReport.items.slice(0, 4).map((it) => (
                    <div key={it.itemKey} className="ms2-row-between">
                      <span style={{ fontSize: "0.83rem" }}>{it.recommendedTitle}</span>
                      <strong className="ms2-num" style={{ color: "var(--ms2-primary)" }}>
                        -{formatCop(it.monthlySavingsCop)}/mes
                      </strong>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="ms2-btn ms2-btn-soft ms2-btn-sm"
                  style={{ width: "100%", marginTop: 10 }}
                  onClick={() => onAdoptHouseholdFormats(householdReport.items)}
                >
                  Adoptar formatos recomendados →
                </button>
              </>
            ) : (
              <p className="ms2-muted">
                Agrega productos a tu canasta para sugerir tamaños familiares eficientes.
              </p>
            )}

            {spendingRecs.length > 0 && (
              <div className="ms2-list-stack" style={{ marginTop: 12 }}>
                {spendingRecs.slice(0, 2).map((rec) => (
                  <div
                    key={rec.id}
                    className="ms2-card"
                    style={{ background: "var(--ms2-bg)", padding: 10, fontSize: "0.82rem" }}
                  >
                    <strong style={{ display: "block" }}>{rec.title}</strong>
                    <span className="ms2-muted">{rec.body}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Bloque 3: Calendario de Pagos (ocupa ancho completo en 2-col) */}
          <section className="ms2-card" style={{ gridColumn: "1 / -1" }}>
            <div className="ms2-row-between" style={{ marginBottom: 12 }}>
              <div>
                <h2 className="ms2-h2">Calendario semanal de pagos y descuentos</h2>
                <p className="ms2-muted" style={{ margin: 0 }}>
                  {weeklyCalendar.bestChainCombo} · Mejor día:{" "}
                  <strong>{weeklyCalendar.bestDayLabel}</strong> (ahorro extra{" "}
                  <strong className="ms2-num">{formatCop(weeklyCalendar.paymentDiscountCop)}</strong>)
                </p>
              </div>
              <button
                type="button"
                className="ms2-btn ms2-btn-secondary ms2-btn-sm"
                onClick={onOpenHousehold}
              >
                Mis tarjetas ({paymentMethods.length})
              </button>
            </div>

            <div className="ms2-basket-grid">
              {weeklyCalendar.matrix.map((day) => {
                const isBest = day.dayOfWeek === weeklyCalendar.bestDayOfWeek;
                return (
                  <div
                    key={day.dayOfWeek}
                    className="ms2-card"
                    style={{
                      padding: 12,
                      background: isBest ? "var(--ms2-surface-tint)" : "var(--ms2-bg)",
                      borderColor: isBest ? "var(--ms2-primary)" : "var(--ms2-border)",
                    }}
                  >
                    <div className="ms2-row-between" style={{ marginBottom: 6 }}>
                      <strong>{day.dayLabel}</strong>
                      {isBest && <span className="ms2-badge green">Mejor día</span>}
                    </div>
                    <div className="ms2-list-stack">
                      {day.cells.map((cell) => (
                        <div key={cell.storeId} style={{ fontSize: "0.78rem" }}>
                          <div className="ms2-row-between">
                            <strong>{cell.storeName}</strong>
                            <strong className="ms2-num">
                              {cell.discountCop > 0
                                ? `-${formatCop(cell.discountCop)}`
                                : formatCop(cell.estimatedTotalCop)}
                            </strong>
                          </div>
                          <div className="ms2-muted">{cell.promoLabel ?? "Tarifa regular"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* SUBTAB 4: RECOMPRAS Y ALERTAS */}
      {subTab === "recompras" && (
        <section className="ms2-card">
          <h2 className="ms2-h2" style={{ marginBottom: 10 }}>
            Recompras sugeridas y alertas
          </h2>
          {replenishmentAlerts.length === 0 && alerts.length === 0 ? (
            <p className="ms2-muted" style={{ margin: 0 }}>
              Finaliza compras en la pestaña Ruta para activar recordatorios automáticos de reposición y promociones.
            </p>
          ) : (
            <div className="ms2-list-stack">
              {replenishmentAlerts.map((rep) => (
                <div
                  key={rep.dedupeKey}
                  className="ms2-card"
                  style={{ background: "var(--ms2-bg)", padding: 12 }}
                >
                  <div className="ms2-row-between">
                    <strong>{rep.label}</strong>
                    <span className="ms2-badge gold ms2-num">
                      ~{Math.max(0, Math.round(rep.estimatedDaysRemaining))} días
                    </span>
                  </div>
                  <p className="ms2-muted" style={{ margin: "4px 0 8px" }}>
                    {rep.message}
                  </p>
                  <button
                    type="button"
                    className="ms2-btn ms2-btn-primary ms2-btn-sm"
                    onClick={() => onAddReplenishAlert(rep)}
                  >
                    + Agregar a mi canasta
                  </button>
                </div>
              ))}

              {alerts.map((al) => (
                <div
                  key={al.id}
                  className="ms2-card"
                  style={{
                    background: al.readAt ? "var(--ms2-surface)" : "var(--ms2-surface-tint)",
                    padding: 12,
                  }}
                >
                  <div className="ms2-row-between">
                    <strong>{al.title}</strong>
                    {!al.readAt && (
                      <button
                        type="button"
                        className="ms2-btn ms2-btn-ghost ms2-btn-sm"
                        onClick={() => void markAlertRead(al.id)}
                      >
                        Marcar leída
                      </button>
                    )}
                  </div>
                  <p className="ms2-muted" style={{ margin: "4px 0 0" }}>
                    {al.body}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
