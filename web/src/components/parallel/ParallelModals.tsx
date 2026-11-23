"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import {
  PackTrapAlert,
  ParallelDialog,
  PumHelpTrigger,
  RappiSavingsBadge,
  SabiometroBadge,
  SamePlantBadge,
  SmartProductImage,
} from "@/components/parallel/ParallelPrimitives";
import type { BasketItemInput, BasketOptimizeOptions } from "@/lib/basketOptimizer";
import { optimizeBasketWithinBudget } from "@/lib/budgetOptimizer";
import { formatCop, formatNetContent, formatPum } from "@/lib/formatters";
import { ALL_BARRIOS, COLOMBIAN_CITIES } from "@/lib/guidedCatalog";
import { getOfferDisplayTitle } from "@/lib/productInsights";
import { computeRealPum } from "@/lib/sabiometro";
import { getInvimaPendingNotice, type SamePlantIndex } from "@/lib/samePlant";
import { clampRadiusForTransport, TRANSPORT_PROFILES } from "@/lib/transport";
import type {
  BudgetOptimizationResult,
  DietFilter,
  NearbyStoreBranch,
  PackTrapFinding,
  StoreOffer,
  TransportMode,
} from "@/lib/types";

export function ParallelProductSheet({
  offer,
  baselineOffer,
  itemKey,
  locked,
  packTrapWarning,
  nearbyOffers,
  samePlantIndex,
  onClose,
  onUseRecommended,
  onKeepMine,
  onToggleLock,
  onRateProduct,
}: {
  offer: StoreOffer | null;
  baselineOffer?: StoreOffer | null;
  itemKey?: string | null;
  locked: boolean;
  packTrapWarning: PackTrapFinding | null;
  nearbyOffers: StoreOffer[];
  samePlantIndex: SamePlantIndex;
  onClose: () => void;
  onUseRecommended: (offer: StoreOffer) => void;
  onKeepMine: (itemKey: string) => void;
  onToggleLock: (itemKey: string) => void;
  onRateProduct: (offer: StoreOffer) => void;
}) {
  const title = offer ? getOfferDisplayTitle(offer) : "";
  const baselineTitle = baselineOffer ? getOfferDisplayTitle(baselineOffer) : null;
  const savingsCop =
    offer && baselineOffer
      ? Math.max(0, baselineOffer.calibratedPrice - offer.calibratedPrice)
      : 0;
  const realPum = offer
    ? computeRealPum({
        calibratedPriceCop: offer.calibratedPrice,
        netContent: offer.netContent,
        sabiometro: offer.sabiometro,
      })
    : null;
  const invimaNotice = offer ? getInvimaPendingNotice(offer) : null;

  return (
    <ParallelDialog
      open={Boolean(offer)}
      titleId="ms2-product-sheet-title"
      kicker="Ficha comparativa de producto"
      title={title || "Producto"}
      subtitle={
        offer
          ? `${offer.brand || "Marca verificada"} · ${offer.storeName} · ${formatNetContent(
              offer.netContent,
              offer.unitMeasure
            )}${offer.subPresentationLabel ? ` · ${offer.subPresentationLabel}` : ""}`
          : undefined
      }
      onClose={onClose}
      footer={
        offer ? (
          <div style={{ display: "flex", gap: 8, width: "100%", flexWrap: "wrap" }}>
            {itemKey && (
              <button
                type="button"
                className="ms2-btn ms2-btn-secondary"
                onClick={() => onToggleLock(itemKey)}
              >
                <HearthIcon name={locked ? "lock" : "lock_open"} size={15} />
                <span>{locked ? "Desbloquear" : "Fijar marca"}</span>
              </button>
            )}
            {itemKey && baselineOffer && (
              <button
                type="button"
                className="ms2-btn ms2-btn-secondary"
                onClick={() => {
                  onKeepMine(itemKey);
                  onClose();
                }}
              >
                Prefiero el mío
              </button>
            )}
            <button
              type="button"
              className="ms2-btn ms2-btn-primary"
              style={{ flex: "1 1 180px" }}
              onClick={() => {
                onUseRecommended(offer);
                onClose();
              }}
            >
              <HearthIcon name="check" size={16} />
              <span>Usar este producto</span>
            </button>
          </div>
        ) : null
      }
    >
      {offer && (
        <div className="ms2-col-stack" style={{ gap: 12 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div
              style={{
                width: 82,
                height: 82,
                borderRadius: 12,
                background: "var(--ms2-bg)",
                border: "1px solid var(--ms2-border)",
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              <SmartProductImage src={offer.imageUrl} alt={title} size={82} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="ms2-badge green">{offer.storeName}</span>
              <div
                className="ms2-num"
                style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--ms2-primary)", marginTop: 4 }}
              >
                {formatCop(offer.calibratedPrice)}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <span className="ms2-muted ms2-num">
                  PUM {formatPum(offer.pumPrice, offer.unitMeasure)}
                </span>
                <PumHelpTrigger />
              </div>
              {savingsCop > 0 && (
                <span className="ms2-badge green ms2-num" style={{ marginTop: 6 }}>
                  Ahorras {formatCop(savingsCop)}
                </span>
              )}
              {offer.rappiSavingsCop && offer.rappiSavingsCop > 0 ? (
                <div style={{ marginTop: 6 }}>
                  <RappiSavingsBadge offer={offer} />
                </div>
              ) : null}
            </div>
          </div>

          <div className="ms2-card" style={{ background: "var(--ms2-bg)", padding: 12 }}>
            <strong style={{ display: "block", fontSize: "0.84rem", marginBottom: 4 }}>
              ¿Por qué te lo recomendamos?
            </strong>
            <p className="ms2-muted" style={{ margin: 0 }}>
              {baselineOffer
                ? `Comparte categoría y formato (${formatNetContent(
                    offer.netContent,
                    offer.unitMeasure
                  )}) con ${formatPum(offer.pumPrice, offer.unitMeasure)} frente a ${formatPum(
                    baselineOffer.pumPrice,
                    baselineOffer.unitMeasure
                  )} de tu habitual.`
                : `Es la opción con mejor relación precio/rendimiento (${formatPum(
                    realPum ?? offer.pumPrice,
                    offer.unitMeasure
                  )}) dentro de tu radio y filtros actuales.`}
            </p>
          </div>

          {baselineOffer && baselineTitle && (
            <div style={{ overflowX: "auto" }}>
              <table className="ms-v3-compare-table ms2-num">
                <thead>
                  <tr>
                    <th>Dato</th>
                    <th>Tu habitual</th>
                    <th>Recomendado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Producto</td>
                    <td>{baselineTitle}</td>
                    <td>
                      <strong>{title}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Precio</td>
                    <td>{formatCop(baselineOffer.calibratedPrice)}</td>
                    <td>
                      <strong>{formatCop(offer.calibratedPrice)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>PUM</td>
                    <td>{formatPum(baselineOffer.pumPrice, baselineOffer.unitMeasure)}</td>
                    <td>{formatPum(offer.pumPrice, offer.unitMeasure)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <SabiometroBadge summary={offer.sabiometro} />
            <SamePlantBadge
              offer={offer}
              baselineOffer={baselineOffer}
              samePlantIndex={samePlantIndex}
            />
          </div>

          {invimaNotice && <p className="ms2-muted" style={{ margin: 0 }}>{invimaNotice}</p>}
          <PackTrapAlert warning={packTrapWarning} />

          {nearbyOffers.length > 0 && (
            <div className="ms2-card" style={{ padding: 12 }}>
              <strong style={{ display: "block", fontSize: "0.84rem", marginBottom: 8 }}>
                Precios en otras cadenas cercanas
              </strong>
              <div className="ms2-list-stack" style={{ gap: 6 }}>
                {nearbyOffers.slice(0, 4).map((alt) => (
                  <div key={alt.storeSkuId} className="ms2-row-between" style={{ fontSize: "0.82rem" }}>
                    <span>{alt.storeName}</span>
                    <span className="ms2-muted ms2-num">
                      {formatNetContent(alt.netContent, alt.unitMeasure)}
                    </span>
                    <strong className="ms2-num">{formatCop(alt.calibratedPrice)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="ms2-card" style={{ background: "var(--ms2-bg)", padding: 12 }}>
            <div className="ms2-row-between">
              <div>
                <strong style={{ fontSize: "0.84rem" }}>¿Ya probaste este producto?</strong>
                <div className="ms2-muted">Califica calidad y rendimiento para ayudar a otros hogares.</div>
              </div>
              <button
                type="button"
                className="ms2-btn ms2-btn-secondary ms2-btn-sm"
                onClick={() => onRateProduct(offer)}
              >
                <HearthIcon name="verified" size={14} />
                <span>Calificar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </ParallelDialog>
  );
}

/**
 * Fixes P0 slider reset bug: initializes budgetCop ONLY when modal opens (false -> true),
 * never on every lock toggle recalculation. Also clears stale result when basket is empty.
 */
export function ParallelBudgetModal({
  open,
  items,
  offers,
  nearbyBranches,
  dietFilters,
  minSabioIndex,
  optimizeOptions,
  defaultBudgetCop,
  onToggleLock,
  onApplyBudgetResult,
  onClose,
}: {
  open: boolean;
  items: BasketItemInput[];
  offers: StoreOffer[];
  nearbyBranches: NearbyStoreBranch[];
  dietFilters: DietFilter[];
  minSabioIndex: number;
  optimizeOptions: BasketOptimizeOptions;
  defaultBudgetCop: number;
  onToggleLock: (itemKey: string) => void;
  onApplyBudgetResult: (selectedOfferByItem: Record<string, StoreOffer>) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"generic" | "my_brands">("generic");
  const [budgetCop, setBudgetCop] = useState<number>(() =>
    Math.max(40000, Math.round(defaultBudgetCop / 1000) * 1000)
  );
  const [result, setResult] = useState<BudgetOptimizationResult | null>(null);
  const [computing, setComputing] = useState(false);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current && defaultBudgetCop > 0) {
      setBudgetCop(Math.max(40000, Math.round(defaultBudgetCop / 1000) * 1000));
    }
    wasOpenRef.current = open;
  }, [open, defaultBudgetCop]);

  const lockedKeysList = useMemo(
    () => items.filter((i) => i.locked).map((i) => i.itemKey),
    [items]
  );

  useEffect(() => {
    if (!open) return;
    if (items.length === 0) {
      setResult(null);
      setComputing(false);
      return;
    }

    let cancelled = false;
    setComputing(true);

    const request = {
      items,
      offers,
      nearbyBranches,
      budgetCop,
      mode,
      lockedItemKeys: lockedKeysList,
      dietFilters,
      minSabioIndex,
      optimizeOptions,
    };

    const runSyncFallback = () =>
      optimizeBasketWithinBudget({
        ...request,
        lockedItemKeys: new Set(lockedKeysList),
      });

    try {
      if (typeof Worker !== "undefined") {
        const requestId = `budget_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const worker = new Worker(new URL("../../workers/budget.worker.ts", import.meta.url));
        worker.onmessage = (
          ev: MessageEvent<{ requestId?: string; ok?: boolean; result?: BudgetOptimizationResult }>
        ) => {
          if (!cancelled) {
            if (ev.data?.requestId === requestId && ev.data.ok && ev.data.result) {
              setResult(ev.data.result);
            } else {
              setResult(runSyncFallback());
            }
            setComputing(false);
          }
          worker.terminate();
        };
        worker.onerror = () => {
          if (!cancelled) {
            setResult(runSyncFallback());
            setComputing(false);
          }
          worker.terminate();
        };
        worker.postMessage({ requestId, payload: request });
        return () => {
          cancelled = true;
          worker.terminate();
        };
      }
    } catch {
      // Fallback directo
    }

    setResult(runSyncFallback());
    setComputing(false);
    return () => {
      cancelled = true;
    };
  }, [
    open,
    items,
    offers,
    nearbyBranches,
    budgetCop,
    mode,
    lockedKeysList,
    dietFilters,
    minSabioIndex,
    optimizeOptions,
  ]);

  const minSlider = Math.max(25000, Math.round((Math.max(40000, defaultBudgetCop) * 0.5) / 5000) * 5000);
  const maxSlider = Math.max(
    minSlider + 40000,
    Math.round((Math.max(40000, defaultBudgetCop) * 1.4) / 5000) * 5000
  );
  const deltaCop = result ? result.budgetCop - result.totalCop : 0;

  return (
    <ParallelDialog
      open={open}
      titleId="ms2-budget-modal-title"
      kicker="Ajuste por presupuesto"
      title="Ajustar mercado a tu presupuesto"
      subtitle="Fija con candado tus productos intocables y ajustamos el resto sin pasarte del tope."
      onClose={onClose}
      footer={
        result && items.length > 0 ? (
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <button type="button" className="ms2-btn ms2-btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="ms2-btn ms2-btn-primary"
              style={{ flex: 1 }}
              onClick={() => {
                onApplyBudgetResult(result.selectedCandidates);
                onClose();
              }}
            >
              <HearthIcon name="check" size={16} />
              <span>Aplicar combinación ({formatCop(result.totalCop)})</span>
            </button>
          </div>
        ) : (
          <button type="button" className="ms2-btn ms2-btn-primary" style={{ width: "100%" }} onClick={onClose}>
            Entendido
          </button>
        )
      }
    >
      {items.length === 0 ? (
        <div className="ms2-card" style={{ textAlign: "center", padding: 20 }}>
          <p className="ms2-muted" style={{ margin: 0 }}>
            Agrega productos a tu canasta antes de ajustar un presupuesto máximo.
          </p>
        </div>
      ) : (
        <div className="ms2-col-stack" style={{ gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className={`ms2-chip ${mode === "generic" ? "active" : ""}`}
              style={{ flex: 1, justifyContent: "center" }}
              onClick={() => setMode("generic")}
            >
              Sin marca (Máximo ahorro)
            </button>
            <button
              type="button"
              className={`ms2-chip ${mode === "my_brands" ? "active" : ""}`}
              style={{ flex: 1, justifyContent: "center" }}
              onClick={() => setMode("my_brands")}
            >
              Mis marcas / Favoritos
            </button>
          </div>

          <div className="ms2-card" style={{ background: "var(--ms2-bg)", padding: 14 }}>
            <div className="ms2-row-between">
              <label htmlFor="ms2-budget-slider" style={{ fontWeight: 700, fontSize: "0.86rem" }}>
                Presupuesto máximo
              </label>
              <strong className="ms2-num" style={{ fontSize: "1.15rem", color: "var(--ms2-primary)" }}>
                {formatCop(budgetCop)}
              </strong>
            </div>
            <input
              id="ms2-budget-slider"
              type="range"
              className="ms2-range"
              min={minSlider}
              max={maxSlider}
              step={2000}
              value={Math.min(maxSlider, Math.max(minSlider, budgetCop))}
              onChange={(e) => setBudgetCop(Number(e.target.value))}
            />
            <div className="ms2-row-between ms2-muted ms2-num" style={{ fontSize: "0.75rem" }}>
              <span>{formatCop(minSlider)}</span>
              <span>{lockedKeysList.length} fijos</span>
              <span>{formatCop(maxSlider)}</span>
            </div>
          </div>

          {result && (
            <div
              className="ms2-card"
              style={{
                padding: 14,
                background: result.feasible ? "var(--ms2-surface-tint)" : "var(--ms2-warn-soft)",
                borderColor: result.feasible ? "#9ec8ab" : "#e6be7a",
              }}
            >
              <div className="ms2-row-between">
                <strong>
                  {computing
                    ? "Calculando combinación..."
                    : result.feasible
                      ? "¡Cabe dentro de tu presupuesto!"
                      : "Necesitas ampliar tope o desbloquear ítems"}
                </strong>
                <strong className="ms2-num" style={{ fontSize: "1.08rem" }}>
                  {formatCop(result.totalCop)}
                </strong>
              </div>
              <p className="ms2-muted ms2-num" style={{ margin: "4px 0 0" }}>
                {deltaCop >= 0
                  ? `${formatCop(deltaCop)} disponibles debajo del tope`
                  : `${formatCop(Math.abs(deltaCop))} por encima del tope`}{" "}
                · {result.swaps.length} cambio(s)
              </p>

              {!result.feasible && result.blockingLocks.length > 0 && (
                <div className="ms2-chip-wrap" style={{ marginTop: 10 }}>
                  {result.blockingLocks.map((sug) => (
                    <button
                      key={sug.itemKey}
                      type="button"
                      className="ms2-btn ms2-btn-secondary ms2-btn-sm"
                      onClick={() => onToggleLock(sug.itemKey)}
                    >
                      <HearthIcon name="lock_open" size={13} />
                      <span>
                        Desbloquear {sug.label} (-{formatCop(sug.unlockSavingsCop)})
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="ms2-card" style={{ padding: 12 }}>
            <strong style={{ display: "block", fontSize: "0.84rem", marginBottom: 8 }}>
              Candados de productos ({lockedKeysList.length}/{items.length})
            </strong>
            <div className="ms2-chip-wrap">
              {items.map((item) => {
                const locked = Boolean(item.locked);
                return (
                  <button
                    key={item.itemKey}
                    type="button"
                    aria-pressed={locked}
                    className={`ms2-chip ${locked ? "active" : ""}`}
                    onClick={() => onToggleLock(item.itemKey)}
                  >
                    <HearthIcon name={locked ? "lock" : "lock_open"} size={13} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </ParallelDialog>
  );
}

interface GeocodeSuggestion {
  id: string;
  label: string;
  city: string;
  barrio: string;
  lat: number;
  lng: number;
  source: "google" | "osm";
}

function normalizeGeoQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function ParallelZoneModal({
  open,
  onClose,
  userLocation,
  onSelectBarrio,
  onRequestGeolocation,
  locLoading,
  locError,
  transportMode,
  onChangeTransportMode,
  maxDistanceMeters,
  onChangeMaxDistanceMeters,
  maxStores,
  onChangeMaxStores,
  nearbyBranches,
  allNearbyWithinMax,
}: {
  open: boolean;
  onClose: () => void;
  userLocation: { lat: number; lng: number; label: string };
  onSelectBarrio: (lat: number, lng: number, label: string) => void;
  onRequestGeolocation: () => void;
  locLoading: boolean;
  locError: string | null;
  transportMode: TransportMode;
  onChangeTransportMode: (mode: TransportMode) => void;
  maxDistanceMeters: number;
  onChangeMaxDistanceMeters: (meters: number) => void;
  maxStores: 1 | 2 | 3 | 4 | 5;
  onChangeMaxStores: (count: 1 | 2 | 3 | 4 | 5) => void;
  nearbyBranches: NearbyStoreBranch[];
  allNearbyWithinMax: NearbyStoreBranch[];
}) {
  const [placeQuery, setPlaceQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<GeocodeSuggestion[]>([]);
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [placeSearchNote, setPlaceSearchNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPlaceQuery("");
      setRemoteResults([]);
      setPlaceSearchNote(null);
    }
  }, [open]);

  const localPlaceMatches = useMemo(() => {
    const q = normalizeGeoQuery(placeQuery);
    if (q.length < 2) return [];
    return ALL_BARRIOS.filter((b) => {
      const hay = normalizeGeoQuery(`${b.city} ${b.department ?? ""} ${b.barrio} ${b.label}`);
      return hay.includes(q);
    }).slice(0, 6);
  }, [placeQuery]);

  async function handleRemotePlaceSearch() {
    const q = placeQuery.trim();
    if (q.length < 2) return;
    setSearchingPlace(true);
    setPlaceSearchNote(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { results?: GeocodeSuggestion[] };
      const list = Array.isArray(json.results) ? json.results : [];
      setRemoteResults(list);
      if (list.length === 0 && localPlaceMatches.length === 0) {
        setPlaceSearchNote("No encontramos direcciones exactas para esa búsqueda en Colombia.");
      }
    } catch {
      setPlaceSearchNote("No fue posible consultar el buscador de direcciones.");
    } finally {
      setSearchingPlace(false);
    }
  }

  const minNearestMeters = useMemo(() => {
    if (!allNearbyWithinMax.length) return 400;
    return Math.max(400, Math.round(Math.min(...allNearbyWithinMax.map((b) => b.distanceMeters))));
  }, [allNearbyWithinMax]);

  const selectedCityObj = useMemo(() => {
    const match = ALL_BARRIOS.find(
      (b) =>
        Math.abs(b.lat - userLocation.lat) < 0.004 &&
        Math.abs(b.lng - userLocation.lng) < 0.004
    );
    if (match) {
      return COLOMBIAN_CITIES.find((c) => c.city === match.city) ?? COLOMBIAN_CITIES[0];
    }
    const labelPrefix = normalizeGeoQuery(userLocation.label.split("·")[0] ?? "");
    const byName = COLOMBIAN_CITIES.find((c) => normalizeGeoQuery(c.city) === labelPrefix);
    return byName ?? COLOMBIAN_CITIES[0];
  }, [userLocation.lat, userLocation.lng, userLocation.label]);

  const selectedBarrioId = useMemo(() => {
    const match = ALL_BARRIOS.find(
      (b) =>
        Math.abs(b.lat - userLocation.lat) < 0.004 &&
        Math.abs(b.lng - userLocation.lng) < 0.004
    );
    return match?.id ?? "custom";
  }, [userLocation.lat, userLocation.lng]);

  const activeProfile = TRANSPORT_PROFILES[transportMode];
  const sliderMax = Math.max(minNearestMeters + 500, activeProfile.maxRadiusM);
  const clampedDistance = Math.max(maxDistanceMeters, minNearestMeters);

  return (
    <ParallelDialog
      open={open}
      titleId="ms2-zone-modal-title"
      kicker="Ubicación y traslado"
      title="¿Dónde y cómo vas a mercar?"
      subtitle={`Cobertura en ${COLOMBIAN_CITIES.length} capitales de Colombia. Actualizamos sedes cercanas, tiempos y costo por parada.`}
      onClose={onClose}
      footer={
        <button type="button" className="ms2-btn ms2-btn-primary" style={{ width: "100%" }} onClick={onClose}>
          <HearthIcon name="check_circle" size={17} />
          <span>Guardar zona y recalcular</span>
        </button>
      }
    >
      <div className="ms2-col-stack" style={{ gap: 12 }}>
        <div className="ms2-card" style={{ background: "var(--ms2-bg)", padding: 14 }}>
          <div className="ms2-row-between" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: "0.86rem" }}>Ciudad, barrio o dirección</strong>
            <button
              type="button"
              className="ms2-btn ms2-btn-secondary ms2-btn-sm"
              disabled={locLoading}
              onClick={onRequestGeolocation}
            >
              <HearthIcon name="my_location" size={14} />
              <span>{locLoading ? "Ubicando..." : "Usar mi GPS"}</span>
            </button>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label htmlFor="ms2-place-search" className="ms2-muted" style={{ display: "block", marginBottom: 4 }}>
              Buscar ciudad, barrio o dirección en Colombia
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                id="ms2-place-search"
                type="search"
                className="ms2-input"
                placeholder="Ej. Cabecera Bucaramanga, Bocagrande, Cra 15 #85..."
                value={placeQuery}
                onChange={(e) => {
                  setPlaceQuery(e.target.value);
                  if (remoteResults.length) setRemoteResults([]);
                  if (placeSearchNote) setPlaceSearchNote(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleRemotePlaceSearch();
                  }
                }}
              />
              <button
                type="button"
                className="ms2-btn ms2-btn-secondary ms2-btn-sm"
                disabled={searchingPlace || placeQuery.trim().length < 2}
                onClick={() => void handleRemotePlaceSearch()}
                style={{ flexShrink: 0 }}
              >
                <HearthIcon name="search" size={14} />
                <span>{searchingPlace ? "Buscando..." : "Buscar"}</span>
              </button>
            </div>

            {(localPlaceMatches.length > 0 || remoteResults.length > 0) && (
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  maxHeight: 170,
                  overflowY: "auto",
                  padding: 6,
                  borderRadius: 10,
                  border: "1px solid var(--ms2-border)",
                  background: "var(--ms2-surface)",
                }}
              >
                {localPlaceMatches.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="ms2-btn ms2-btn-ghost ms2-btn-sm"
                    style={{ justifyContent: "space-between", textAlign: "left", padding: "6px 8px" }}
                    onClick={() => {
                      onSelectBarrio(b.lat, b.lng, b.label);
                      setPlaceQuery("");
                      setRemoteResults([]);
                    }}
                  >
                    <span>
                      <strong>{b.city}</strong> · {b.barrio}
                    </span>
                    <span className="ms2-muted" style={{ fontSize: "0.72rem" }}>
                      {b.department ?? "Capital"}
                    </span>
                  </button>
                ))}
                {remoteResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="ms2-btn ms2-btn-ghost ms2-btn-sm"
                    style={{ justifyContent: "space-between", textAlign: "left", padding: "6px 8px" }}
                    onClick={() => {
                      onSelectBarrio(r.lat, r.lng, r.label);
                      setPlaceQuery("");
                      setRemoteResults([]);
                    }}
                  >
                    <span>
                      <strong>{r.label}</strong>
                      <span className="ms2-muted" style={{ display: "block", fontSize: "0.72rem" }}>
                        {r.barrio}
                      </span>
                    </span>
                    <span className="ms2-muted" style={{ fontSize: "0.7rem", flexShrink: 0 }}>
                      {r.source === "google" ? "Google Maps" : "Mapa CO"}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {placeSearchNote && (
              <p className="ms2-muted" style={{ fontSize: "0.75rem", margin: "6px 0 0" }}>
                {placeSearchNote}
              </p>
            )}
          </div>

          <div className="ms2-info-grid-2">
            <div>
              <label htmlFor="ms2-city" className="ms2-muted" style={{ display: "block", marginBottom: 4 }}>
                Ciudad ({COLOMBIAN_CITIES.length} capitales)
              </label>
              <select
                id="ms2-city"
                className="ms2-select"
                value={selectedCityObj.city}
                onChange={(e) => {
                  const next =
                    COLOMBIAN_CITIES.find((c) => c.city === e.target.value) ?? COLOMBIAN_CITIES[0];
                  if (next.barrios[0]) {
                    onSelectBarrio(next.barrios[0].lat, next.barrios[0].lng, next.barrios[0].label);
                  }
                }}
              >
                {COLOMBIAN_CITIES.map((c) => (
                  <option key={c.city} value={c.city}>
                    {c.city} {c.department && c.department !== c.city ? `(${c.department})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ms2-barrio" className="ms2-muted" style={{ display: "block", marginBottom: 4 }}>
                Barrio / Zona
              </label>
              <select
                id="ms2-barrio"
                className="ms2-select"
                value={selectedBarrioId}
                onChange={(e) => {
                  const found = ALL_BARRIOS.find((b) => b.id === e.target.value);
                  if (found) onSelectBarrio(found.lat, found.lng, found.label);
                }}
              >
                {selectedCityObj.barrios.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.barrio}
                  </option>
                ))}
                {selectedBarrioId === "custom" && (
                  <option value="custom">{userLocation.label}</option>
                )}
              </select>
            </div>
          </div>

          <div className="ms2-row-between ms2-muted" style={{ fontSize: "0.75rem", marginTop: 8 }}>
            <span>Zona activa: {userLocation.label}</span>
            <strong className="ms2-num" style={{ color: "var(--ms2-primary)" }}>
              {locLoading
                ? "Consultando sedes..."
                : `${nearbyBranches.length} sedes en tu radio (${allNearbyWithinMax.length} en ${selectedCityObj.city} < ${((maxDistanceMeters * 2) / 1000).toFixed(1)} km)`}
            </strong>
          </div>

          {locError && (
            <p style={{ color: "var(--ms2-warn)", fontSize: "0.8rem", margin: "8px 0 0" }}>
              {locError}
            </p>
          )}
        </div>

        <div className="ms2-card" style={{ padding: 14 }}>
          <strong style={{ display: "block", fontSize: "0.86rem", marginBottom: 8 }}>
            Medio de transporte
          </strong>
          <div className="ms2-transport-grid" role="radiogroup" aria-label="Transporte">
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
                  onClick={() => {
                    onChangeTransportMode(modeKey);
                    onChangeMaxDistanceMeters(
                      Math.max(minNearestMeters, clampRadiusForTransport(prof.defaultRadiusM, modeKey))
                    );
                  }}
                >
                  <span>
                    {prof.emoji} {prof.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="ms2-card" style={{ padding: 14 }}>
          <div className="ms2-row-between">
            <label htmlFor="ms2-zone-radius" style={{ fontWeight: 700, fontSize: "0.86rem" }}>
              Radio máximo ({activeProfile.label})
            </label>
            <strong className="ms2-num" style={{ color: "var(--ms2-primary)" }}>
              {(clampedDistance / 1000).toFixed(1)} km
            </strong>
          </div>
          <input
            id="ms2-zone-radius"
            type="range"
            className="ms2-range"
            min={minNearestMeters}
            max={sliderMax}
            step={100}
            value={Math.min(clampedDistance, sliderMax)}
            onChange={(e) =>
              onChangeMaxDistanceMeters(
                Math.max(
                  minNearestMeters,
                  clampRadiusForTransport(Number(e.target.value), transportMode)
                )
              )
            }
          />
          <div className="ms2-row-between ms2-muted ms2-num" style={{ fontSize: "0.75rem" }}>
            <span>Mín {(minNearestMeters / 1000).toFixed(1)} km</span>
            <span>{nearbyBranches.length} sedes disponibles</span>
            <span>Máx {(sliderMax / 1000).toFixed(1)} km</span>
          </div>

          <div className="ms2-row-between" style={{ marginTop: 12 }}>
            <span style={{ fontWeight: 700, fontSize: "0.86rem" }}>Máximo de tiendas por ruta</span>
            <div className="ms2-stepper">
              <button
                type="button"
                className="ms2-stepper-btn"
                disabled={maxStores <= 1}
                aria-label="Menos paradas"
                onClick={() => onChangeMaxStores(Math.max(1, maxStores - 1) as 1 | 2 | 3 | 4 | 5)}
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
                aria-label="Más paradas"
                onClick={() => onChangeMaxStores(Math.min(5, maxStores + 1) as 1 | 2 | 3 | 4 | 5)}
              >
                <HearthIcon name="add" size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </ParallelDialog>
  );
}

export function ParallelReportPriceModal({
  open,
  activePlan,
  reportAllocKey,
  onChangeReportAllocKey,
  reportReason,
  onChangeReportReason,
  reportComment,
  onChangeReportComment,
  reportSubmitting,
  reportFeedback,
  onSubmit,
  onClose,
}: {
  open: boolean;
  activePlan: import("@/lib/basketOptimizer").BasketPlan | null;
  reportAllocKey: string;
  onChangeReportAllocKey: (k: string) => void;
  reportReason: "distinta_calidad" | "distinto_producto" | "tamano_incomparable" | "otro";
  onChangeReportReason: (
    r: "distinta_calidad" | "distinto_producto" | "tamano_incomparable" | "otro"
  ) => void;
  reportComment: string;
  onChangeReportComment: (c: string) => void;
  reportSubmitting: boolean;
  reportFeedback: string | null;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <ParallelDialog
      open={Boolean(open && activePlan)}
      titleId="ms2-report-price-title"
      kicker="Reporte comunitario"
      title="Reportar precio o diferencia en tienda"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, width: "100%" }}>
          <button type="button" className="ms2-btn ms2-btn-secondary" onClick={onClose}>
            Cerrar
          </button>
          <button
            type="button"
            className="ms2-btn ms2-btn-primary"
            style={{ flex: 1 }}
            disabled={reportSubmitting}
            onClick={onSubmit}
          >
            {reportSubmitting ? "Enviando..." : "Enviar reporte"}
          </button>
        </div>
      }
    >
      {activePlan && (
        <div className="ms2-col-stack" style={{ gap: 12 }}>
          <div>
            <label htmlFor="ms2-report-product" className="ms2-muted" style={{ display: "block", marginBottom: 4 }}>
              Producto de tu ruta
            </label>
            <select
              id="ms2-report-product"
              className="ms2-select"
              value={reportAllocKey}
              onChange={(e) => onChangeReportAllocKey(e.target.value)}
            >
              {activePlan.storeStops.flatMap((stop) =>
                stop.allocations.map((a) => (
                  <option key={a.itemKey} value={a.itemKey}>
                    {stop.storeName} · {getOfferDisplayTitle(a.offer)} ({formatCop(a.nominalCost)})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label htmlFor="ms2-report-reason" className="ms2-muted" style={{ display: "block", marginBottom: 4 }}>
              Motivo
            </label>
            <select
              id="ms2-report-reason"
              className="ms2-select"
              value={reportReason}
              onChange={(e) =>
                onChangeReportReason(
                  e.target.value as
                    | "distinta_calidad"
                    | "distinto_producto"
                    | "tamano_incomparable"
                    | "otro"
                )
              }
            >
              <option value="otro">El precio en tienda física era distinto</option>
              <option value="distinto_producto">Producto no coincide en góndola</option>
              <option value="tamano_incomparable">Gramaje o presentación distinta</option>
              <option value="distinta_calidad">Comparación de calidad injusta</option>
            </select>
          </div>

          <div>
            <label htmlFor="ms2-report-comment" className="ms2-muted" style={{ display: "block", marginBottom: 4 }}>
              Detalle opcional (precio visto en tienda)
            </label>
            <input
              id="ms2-report-comment"
              type="text"
              className="ms2-input"
              placeholder="Ej: En D1 estaba en $4.200 hoy"
              value={reportComment}
              onChange={(e) => onChangeReportComment(e.target.value)}
            />
          </div>

          {reportFeedback && (
            <div className="ms2-badge green" role="status">
              {reportFeedback}
            </div>
          )}
        </div>
      )}
    </ParallelDialog>
  );
}
