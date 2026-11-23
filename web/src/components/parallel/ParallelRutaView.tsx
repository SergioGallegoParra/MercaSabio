"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import { SmartProductImage } from "@/components/parallel/ParallelPrimitives";
import type { ParallelRouteSummary } from "@/components/parallel/ParallelRouteMap";
import type { BasketPlan } from "@/lib/basketOptimizer";
import { formatCop, formatNetContent, formatPum } from "@/lib/formatters";
import { getOfferDisplayTitle } from "@/lib/productInsights";
import { freeMarketsLabel, projectSavings } from "@/lib/savingsProjection";
import { evaluateWalkWeightAlert, TRANSPORT_PROFILES } from "@/lib/transport";
import type { TransportMode, UserProfile } from "@/lib/types";

const ParallelRouteMap = dynamic(() => import("@/components/parallel/ParallelRouteMap"), {
  ssr: false,
  loading: () => (
    <div className="ms2-card" style={{ textAlign: "center", padding: 36 }}>
      Cargando mapa OpenStreetMap...
    </div>
  ),
});

function buildGoogleMapsUrl(
  origin: { lat: number; lng: number },
  stops: Array<{ branch: { lat: number; lng: number } }>,
  mode: TransportMode
): string {
  if (!stops.length) return "https://www.google.com/maps";
  const dest = stops[stops.length - 1].branch;
  const waypoints = stops
    .slice(0, -1)
    .map((s) => `${s.branch.lat},${s.branch.lng}`)
    .join("|");
  const travelmode =
    mode === "walk" ? "walking" : mode === "bike" ? "bicycling" : mode === "public" ? "transit" : "driving";
  const params = new URLSearchParams({
    api: "1",
    origin: `${origin.lat},${origin.lng}`,
    destination: `${dest.lat},${dest.lng}`,
    travelmode,
  });
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function ParallelRutaView({
  activePlan,
  userLocation,
  transportMode,
  radiusMeters,
  onChangeTransportMode,
  onOpenZoneModal,
  userProfile,
  checkedItems,
  onToggleCheckedItem,
  onCopyPlainText,
  onDownloadPlainText,
  copyFeedback,
  onOpenReportModal,
  onCompleteShoppingTrip,
  onGoCanasta,
  onGoInicio,
}: {
  activePlan: BasketPlan | null;
  userLocation: { lat: number; lng: number; label: string };
  transportMode: TransportMode;
  radiusMeters: number;
  onChangeTransportMode: (mode: TransportMode) => void;
  onOpenZoneModal: () => void;
  userProfile: UserProfile | null;
  checkedItems: Record<string, boolean>;
  onToggleCheckedItem: (itemKey: string) => void;
  onCopyPlainText: () => Promise<void>;
  onDownloadPlainText: () => void;
  copyFeedback: string | null;
  onOpenReportModal: () => void;
  onCompleteShoppingTrip: (plan: BasketPlan, checkedKeys: Record<string, boolean>) => Promise<void>;
  onGoCanasta: () => void;
  onGoInicio: () => void;
}) {
  const [subView, setSubView] = useState<"map" | "gondola" | "completed">("map");
  const [gondolaStop, setGondolaStop] = useState("all");
  const [routeSummary, setRouteSummary] = useState<ParallelRouteSummary | null>(null);

  const mapStops = useMemo(
    () =>
      (activePlan?.storeStops ?? []).map((stop) => ({
        ...stop.branch,
        storeName: stop.storeName,
      })),
    [activePlan]
  );

  const flatAllocs = useMemo(
    () => (activePlan ? activePlan.storeStops.flatMap((s) => s.allocations) : []),
    [activePlan]
  );

  const progress = useMemo(() => {
    const doneList = flatAllocs.filter((a) => checkedItems[a.itemKey]);
    const collected = doneList.reduce((sum, a) => sum + a.nominalCost, 0);
    return {
      done: doneList.length,
      total: flatAllocs.length,
      pct: flatAllocs.length ? Math.round((doneList.length / flatAllocs.length) * 100) : 0,
      collectedCop: collected,
    };
  }, [flatAllocs, checkedItems]);

  const totalWeightKg = useMemo(() => {
    if (!activePlan) return 0;
    return activePlan.storeStops.reduce(
      (sum, s) =>
        sum +
        s.allocations.reduce((inner, a) => {
          const unitKg =
            a.offer.unitMeasure === "g" || a.offer.unitMeasure === "ml"
              ? a.offer.netContent / 1000
              : 0.25;
          return inner + unitKg * a.quantity;
        }, 0),
      0
    );
  }, [activePlan]);

  const weightAlert = activePlan
    ? evaluateWalkWeightAlert({ totalWeightKg, mode: transportMode })
    : null;

  const googleMapsUrl = activePlan
    ? buildGoogleMapsUrl(userLocation, activePlan.storeStops, transportMode)
    : "https://www.google.com/maps";

  const completionProj = useMemo(() => {
    if (!activePlan) return null;
    const p = projectSavings({
      savingsPerTripCop: activePlan.savingsVsBaselineCop,
      optimizedBasketTotalCop: activePlan.totalNominalCost,
      cadence: userProfile?.shoppingCadence ?? "biweekly",
    });
    return { ...p, label: freeMarketsLabel(p.freeMarketsPerYear) };
  }, [activePlan, userProfile?.shoppingCadence]);

  async function finishTrip() {
    if (!activePlan) return;
    await onCompleteShoppingTrip(activePlan, checkedItems);
    setSubView("completed");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!activePlan) {
    return (
      <div className="ms2-card" style={{ textAlign: "center", padding: "36px 20px" }}>
        <h1 className="ms2-h1">Ruta y Modo Góndola</h1>
        <p className="ms2-muted" style={{ margin: "8px auto 16px", maxWidth: "46ch" }}>
          Agrega productos a tu canasta para trazar la ruta más corta entre supermercados y usar la lista interactiva en tienda.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="ms2-btn ms2-btn-primary" onClick={onGoCanasta}>
            <HearthIcon name="shopping_basket" size={16} />
            <span>Ir a mi canasta</span>
          </button>
          <button type="button" className="ms2-btn ms2-btn-secondary" onClick={onOpenZoneModal}>
            Configurar mi barrio y radio
          </button>
        </div>
      </div>
    );
  }

  if (subView === "completed") {
    return (
      <div className="ms2-col-stack" style={{ maxWidth: 680, margin: "0 auto", width: "100%" }}>
        <section className="ms2-card ms2-card-tint" style={{ textAlign: "center", padding: 28 }}>
          <span className="ms2-badge green">✓ Mercado completado</span>
          <h1 className="ms2-h1 ms2-num" style={{ marginTop: 10 }}>
            ¡Ahorraste {formatCop(activePlan.savingsVsBaselineCop)} hoy!
          </h1>
          <p className="ms2-sub" style={{ marginInline: "auto" }}>
            {progress.done > 0 ? progress.done : progress.total} de {progress.total} productos
            recolectados · {(activePlan.totalDistanceMeters / 1000).toFixed(1)} km recorridos.
          </p>
          {completionProj && (
            <div className="ms2-card" style={{ marginTop: 16, background: "var(--ms2-primary)", color: "#fff" }}>
              <strong style={{ fontSize: "1rem" }}>{completionProj.label}</strong>
              <div className="ms2-num" style={{ color: "#f6cd77", marginTop: 4, fontWeight: 800 }}>
                {formatCop(completionProj.yearlySavingsCop)} ahorrados al año a este ritmo
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
            <button
              type="button"
              className="ms2-btn ms2-btn-primary"
              onClick={() => {
                setSubView("map");
                onGoInicio();
              }}
            >
              Volver al inicio →
            </button>
            <button
              type="button"
              className="ms2-btn ms2-btn-secondary"
              onClick={() => setSubView("map")}
            >
              Ver mapa de nuevo
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="ms2-col-stack">
      <div className="ms2-section-head">
        <div>
          <h1 className="ms2-h1">Ruta ideal de compra</h1>
          <p className="ms2-sub">
            {userLocation.label} →{" "}
            {activePlan.storeStops.map((s, i) => `Parada ${i + 1}: ${s.storeName}`).join(" · ")}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {routeSummary && (
            <span className="ms2-badge green ms2-num">
              {(routeSummary.distanceMeters / 1000).toFixed(1)} km · ~
              {Math.max(1, Math.round(routeSummary.durationSeconds / 60))} min
            </span>
          )}
          <button type="button" className="ms2-btn ms2-btn-secondary ms2-btn-sm" onClick={onOpenZoneModal}>
            <HearthIcon name="location_on" size={14} />
            <span>Cambiar zona y radio</span>
          </button>
        </div>
      </div>

      {/* Switch limpio Ruta en mapa vs Modo Góndola */}
      <div className="ms2-tablist" role="tablist" aria-label="Vista de ruta">
        <button
          type="button"
          role="tab"
          aria-selected={subView === "map"}
          className="ms2-tab"
          onClick={() => setSubView("map")}
        >
          Ruta en mapa y paradas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subView === "gondola"}
          className="ms2-tab"
          onClick={() => setSubView("gondola")}
        >
          Modo Góndola (En tienda)
        </button>
      </div>

      {/* Selector unificado de 5 modos de transporte */}
      <div className="ms2-transport-grid" role="radiogroup" aria-label="Modo de transporte">
        {(Object.keys(TRANSPORT_PROFILES) as TransportMode[]).map((modeKey) => {
          const prof = TRANSPORT_PROFILES[modeKey];
          const active = transportMode === modeKey;
          return (
            <button
              key={modeKey}
              type="button"
              role="radio"
              aria-checked={active}
              className={`ms2-transport-pill ${active ? "active" : ""}`}
              onClick={() => onChangeTransportMode(modeKey)}
            >
              <span>
                {prof.emoji} {prof.shortLabel}
              </span>
              <span className="ms2-num" style={{ fontSize: "0.7rem", opacity: 0.85 }}>
                {(prof.defaultRadiusM / 1000).toFixed(1)} km
              </span>
            </button>
          );
        })}
      </div>

      {weightAlert && (
        <div
          className="ms2-card"
          style={{ background: "var(--ms2-warn-soft)", borderColor: "#e6be7a", padding: "10px 14px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ms2-warn)", fontSize: "0.86rem" }}>
            <HearthIcon name="info" size={17} />
            <span>{weightAlert}</span>
          </div>
        </div>
      )}

      {subView === "map" ? (
        <div className="ms2-ruta-grid">
          {/* Izquierda: Mapa sincronizado + acciones */}
          <div className="ms2-col-stack">
            <ParallelRouteMap
              userLocation={userLocation}
              stops={mapStops}
              transportMode={transportMode}
              radiusMeters={radiusMeters}
              onSummaryChange={setRouteSummary}
            />

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="ms2-btn ms2-btn-primary"
                style={{ flex: "1 1 200px" }}
                onClick={() => setSubView("gondola")}
              >
                <HearthIcon name="shopping_cart" size={16} />
                <span>Iniciar Modo Góndola →</span>
              </button>

              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ms2-btn ms2-btn-secondary"
              >
                <HearthIcon name="navigation" size={15} />
                <span>Abrir en Google Maps</span>
              </a>
            </div>
          </div>

          {/* Derecha: Paradas y checklist interactiva */}
          <div className="ms2-col-stack">
            <div className="ms2-card ms2-card-tint">
              <div className="ms2-row-between" style={{ marginBottom: 6 }}>
                <strong>Lista interactiva en tienda</strong>
                <span className="ms2-badge green ms2-num">
                  {progress.done} / {progress.total} ({progress.pct}%)
                </span>
              </div>
              <div className="ms2-progress-track">
                <div className="ms2-progress-fill" style={{ width: `${progress.pct}%` }} />
              </div>
            </div>

            {activePlan.storeStops.map((stop, idx) => (
              <section key={stop.storeId} className="ms2-card">
                <div className="ms2-row-between" style={{ marginBottom: 10 }}>
                  <div>
                    <span className="ms2-badge green">Parada {idx + 1}</span>
                    <h2 className="ms2-h2" style={{ marginTop: 4 }}>
                      {stop.storeName}
                    </h2>
                    <span className="ms2-muted ms2-num">
                      {stop.branch.branchName} · {Math.round(stop.branch.distanceMeters)} m
                    </span>
                  </div>
                  <strong className="ms2-num" style={{ fontSize: "1.08rem", color: "var(--ms2-primary)" }}>
                    {formatCop(stop.subtotalNominal)}
                  </strong>
                </div>

                <div className="ms2-list-stack">
                  {stop.allocations.map((alloc) => {
                    const checked = Boolean(checkedItems[alloc.itemKey]);
                    return (
                      <button
                        key={alloc.itemKey}
                        type="button"
                        className={`ms2-check-row ${checked ? "checked" : ""}`}
                        onClick={() => onToggleCheckedItem(alloc.itemKey)}
                      >
                        <span className="ms2-check-box" aria-hidden="true">
                          {checked && <HearthIcon name="check" size={14} />}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: "0.86rem",
                              textDecoration: checked ? "line-through" : "none",
                            }}
                          >
                            {alloc.quantity > 1 ? `${alloc.quantity}× ` : ""}
                            {getOfferDisplayTitle(alloc.offer)}
                          </div>
                          <div className="ms2-muted ms2-num">
                            {formatNetContent(alloc.offer.netContent, alloc.offer.unitMeasure)}
                          </div>
                        </div>
                        <strong className="ms2-num">{formatCop(alloc.nominalCost)}</strong>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="ms2-btn ms2-btn-primary"
                style={{ flex: "1 1 200px" }}
                onClick={() => void finishTrip()}
              >
                <HearthIcon name="verified" size={16} />
                <span>Finalizar compra</span>
              </button>
              <button
                type="button"
                className="ms2-btn ms2-btn-secondary"
                onClick={() => void onCopyPlainText()}
              >
                <HearthIcon name="content_copy" size={15} />
                <span>Copiar lista</span>
              </button>
              <button
                type="button"
                className="ms2-btn ms2-btn-secondary"
                onClick={onDownloadPlainText}
              >
                <HearthIcon name="download" size={15} />
                <span>.txt</span>
              </button>
            </div>

            {copyFeedback && (
              <div className="ms2-badge green" role="status">
                {copyFeedback}
              </div>
            )}

            <button
              type="button"
              className="ms2-btn ms2-btn-ghost ms2-btn-sm"
              style={{ alignSelf: "flex-start" }}
              onClick={onOpenReportModal}
            >
              <HearthIcon name="report_problem" size={15} />
              <span>Reportar precio diferente en tienda</span>
            </button>
          </div>
        </div>
      ) : (
        /* MODO GÓNDOLA */
        <div className="ms2-col-stack">
          <div className="ms2-card" style={{ background: "var(--ms2-primary)", color: "#fff" }}>
            <div className="ms2-row-between">
              <div>
                <strong style={{ fontSize: "1rem" }}>Modo Góndola · Toca cada producto al llevarlo</strong>
                <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "rgba(255,255,255,0.85)" }}>
                  <span className="ms2-num">
                    {progress.done} de {progress.total} en el carrito ({progress.pct}%) ·{" "}
                    {formatCop(progress.collectedCop)} / {formatCop(activePlan.totalNominalCost)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                className="ms2-btn ms2-btn-sm"
                style={{ background: "var(--ms2-gold)", color: "var(--ms2-primary)" }}
                onClick={() => void finishTrip()}
              >
                <HearthIcon name="verified" size={15} />
                <span>Finalizar compra</span>
              </button>
            </div>
            <div className="ms2-progress-track" style={{ marginTop: 10, background: "rgba(255,255,255,0.2)" }}>
              <div
                className="ms2-progress-fill"
                style={{ width: `${progress.pct}%`, background: "var(--ms2-gold)" }}
              />
            </div>
          </div>

          <div className="ms2-pills-scroll">
            <button
              type="button"
              className={`ms2-chip ${gondolaStop === "all" ? "active" : ""}`}
              onClick={() => setGondolaStop("all")}
            >
              Todas ({flatAllocs.length})
            </button>
            {activePlan.storeStops.map((s, idx) => (
              <button
                key={s.storeId}
                type="button"
                className={`ms2-chip ${gondolaStop === s.storeId ? "active" : ""}`}
                onClick={() => setGondolaStop(s.storeId)}
              >
                Parada {idx + 1}: {s.storeName} ({s.allocations.length})
              </button>
            ))}
          </div>

          <div className="ms2-gondola-grid">
            {activePlan.storeStops
              .filter((s) => gondolaStop === "all" || s.storeId === gondolaStop)
              .flatMap((stop) =>
                stop.allocations.map((alloc) => {
                  const checked = Boolean(checkedItems[alloc.itemKey]);
                  const title = getOfferDisplayTitle(alloc.offer);
                  return (
                    <button
                      key={alloc.itemKey}
                      type="button"
                      className={`ms2-gondola-card ${checked ? "checked" : ""}`}
                      aria-pressed={checked}
                      onClick={() => onToggleCheckedItem(alloc.itemKey)}
                    >
                      <div className="ms2-tile-media">
                        <SmartProductImage src={alloc.offer.imageUrl} alt={title} size={72} />
                        <span className="ms2-tile-weight ms2-num">
                          {formatNetContent(alloc.offer.netContent, alloc.offer.unitMeasure)}
                        </span>
                        {checked && (
                          <span
                            className="ms2-badge green"
                            style={{ position: "absolute", top: 6, right: 6 }}
                          >
                            ✓ Listo
                          </span>
                        )}
                      </div>
                      <span className="ms2-muted" style={{ fontSize: "0.74rem", fontWeight: 700 }}>
                        {stop.storeName}
                      </span>
                      <strong className="ms2-tile-title">{title}</strong>
                      <div className="ms2-row-between" style={{ marginTop: "auto" }}>
                        <strong className="ms2-num" style={{ color: "var(--ms2-primary)" }}>
                          {formatCop(alloc.nominalCost)}
                        </strong>
                        <span className="ms2-muted ms2-num" style={{ fontSize: "0.74rem" }}>
                          {formatPum(alloc.offer.pumPrice, alloc.offer.unitMeasure)}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
          </div>
        </div>
      )}
    </div>
  );
}
