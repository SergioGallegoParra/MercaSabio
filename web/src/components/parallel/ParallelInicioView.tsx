"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import {
  pickPromoForToday,
  PumHelpTrigger,
  RappiSavingsBadge,
  SmartProductImage,
  StoreBadge,
} from "@/components/parallel/ParallelPrimitives";
import type { BasketItemInput, BasketPlan } from "@/lib/basketOptimizer";
import { formatCop, formatNetContent, formatPum } from "@/lib/formatters";
import type { ShoppingExperienceMode } from "@/lib/guidedCatalog";
import { getOfferDisplayTitle } from "@/lib/productInsights";
import { freeMarketsLabel, projectSavings } from "@/lib/savingsProjection";
import type { DietFilter, StoreOffer, StorePromoDay, UserProfile } from "@/lib/types";

const QUICK_CHIPS = ["Leche deslactosada", "Arroz", "Huevos", "Café", "Aceite"];

export function ParallelInicioView({
  experienceMode,
  onSelectMode,
  onLaunchMode,
  onLoadStarterBasket,
  basketItems,
  activePlan,
  knownOffers,
  userProfile,
  userLocationLabel,
  activeDietFilters,
  storePromoDays,
  onSearchRemote,
  onAddQuickOffer,
  onInspectOffer,
  onOpenCanasta,
  onOpenAhorro,
  onOpenBudget,
  onOpenHousehold,
  onOpenZone,
  onOpenFavorites,
  favoritesCount,
  favoriteLimit,
}: {
  experienceMode: ShoppingExperienceMode;
  onSelectMode: (mode: ShoppingExperienceMode) => void;
  onLaunchMode: (mode: ShoppingExperienceMode) => void;
  onLoadStarterBasket: () => void;
  basketItems: BasketItemInput[];
  activePlan: BasketPlan | null;
  knownOffers: StoreOffer[];
  userProfile: UserProfile | null;
  userLocationLabel: string;
  activeDietFilters: DietFilter[];
  storePromoDays: StorePromoDay[];
  onSearchRemote: (query: string) => Promise<void>;
  onAddQuickOffer: (offer: StoreOffer) => void;
  onInspectOffer: (offer: StoreOffer) => void;
  onOpenCanasta: () => void;
  onOpenAhorro: () => void;
  onOpenBudget: () => void;
  onOpenHousehold: () => void;
  onOpenZone: () => void;
  onOpenFavorites: () => void;
  favoritesCount: number;
  favoriteLimit: number;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const lastRemoteQueryRef = useRef("");

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2 || clean === lastRemoteQueryRef.current) return;
    const timer = window.setTimeout(() => {
      lastRemoteQueryRef.current = clean;
      setSearching(true);
      void onSearchRemote(clean).finally(() => setSearching(false));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query, onSearchRemote]);

  const projection = useMemo(() => {
    const hasRealBasket = Boolean(activePlan && activePlan.totalNominalCost > 0);
    const tripSavings =
      hasRealBasket && activePlan!.savingsVsBaselineCop > 0
        ? activePlan!.savingsVsBaselineCop
        : 24500;
    const optTotal = hasRealBasket ? activePlan!.totalNominalCost : 138000;
    const proj = projectSavings({
      savingsPerTripCop: tripSavings,
      optimizedBasketTotalCop: optTotal,
      cadence: userProfile?.shoppingCadence ?? "biweekly",
    });
    return {
      ...proj,
      isExample: !hasRealBasket,
      freeLabel: freeMarketsLabel(proj.freeMarketsPerYear),
    };
  }, [activePlan, userProfile?.shoppingCadence]);

  const quickMatches = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (clean.length < 2) return [];
    const tokens = clean.split(/\s+/).filter(Boolean);
    return knownOffers
      .filter((o) => {
        if (!o.inStock || o.calibratedPrice <= 0) return false;
        const hay =
          `${o.displayName ?? ""} ${o.rawName} ${o.brand ?? ""} ${o.canonicalName ?? ""} ${o.subPresentationLabel ?? ""}`.toLowerCase();
        return tokens.every((tk) => hay.includes(tk));
      })
      .sort((a, b) => a.pumPrice - b.pumPrice)
      .slice(0, 6);
  }, [query, knownOffers]);

  const instantDuel = useMemo<{
    reference: StoreOffer;
    winner: StoreOffer;
    savingsPct: number;
  } | null>(() => {
    if (quickMatches.length >= 2) {
      const winner = quickMatches[0];
      const ref = quickMatches[quickMatches.length - 1];
      if (winner.storeSkuId !== ref.storeSkuId && ref.pumPrice > winner.pumPrice) {
        const pct = Math.max(1, Math.round(((ref.pumPrice - winner.pumPrice) / ref.pumPrice) * 100));
        return { reference: ref, winner, savingsPct: pct };
      }
    }
    const bySlug = new Map<string, StoreOffer[]>();
    for (const o of knownOffers) {
      if (!o.inStock || o.calibratedPrice <= 0 || !o.canonicalSlug) continue;
      const list = bySlug.get(o.canonicalSlug) ?? [];
      list.push(o);
      bySlug.set(o.canonicalSlug, list);
    }
    for (const list of bySlug.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => a.pumPrice - b.pumPrice);
      const winner = sorted[0];
      const ref = sorted.find(
        (c) =>
          c.storeSkuId !== winner.storeSkuId &&
          c.pumPrice >= winner.pumPrice * 1.08 &&
          c.pumPrice <= winner.pumPrice * 2.2
      );
      if (ref) {
        const pct = Math.round(((ref.pumPrice - winner.pumPrice) / ref.pumPrice) * 100);
        return { reference: ref, winner, savingsPct: pct };
      }
    }
    return null;
  }, [quickMatches, knownOffers]);

  const todayPromo = useMemo(() => pickPromoForToday(storePromoDays), [storePromoDays]);

  async function runExplicitSearch(term: string) {
    setQuery(term);
    if (term.trim().length < 2) return;
    lastRemoteQueryRef.current = term.trim();
    setSearching(true);
    try {
      await onSearchRemote(term.trim());
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="ms2-inicio-grid">
      {/* Columna izquierda: Proyección + Cotizador rápido 1 vs 1 */}
      <div className="ms2-col-stack">
        <section className="ms2-hero-panel" aria-label="Resumen de ahorro potencial">
          <div className="ms2-row-between">
            <span className="ms2-hero-status-pill">
              <HearthIcon name="savings" size={14} />
              <span>
                {projection.isExample
                  ? "Ejemplo estimado de ahorro en hogar"
                  : "Tu ahorro proyectado con tu canasta"}
              </span>
            </span>

            <button
              type="button"
              className="ms2-btn ms2-btn-sm"
              style={{
                background: "rgba(255,255,255,0.14)",
                color: "#ffffff",
                borderColor: "rgba(255,255,255,0.24)",
              }}
              onClick={onOpenZone}
            >
              <HearthIcon name="location_on" size={14} />
              <span>{userLocationLabel}</span>
            </button>
          </div>

          <h1 className="ms2-hero-title">
            Ahorra{" "}
            <strong className="ms2-hero-gold ms2-num">
              {formatCop(projection.monthlySavingsCop)}
            </strong>{" "}
            al mes ·{" "}
            <strong className="ms2-hero-gold ms2-num">
              {formatCop(projection.yearlySavingsCop)}
            </strong>{" "}
            al año
          </h1>

          <p className="ms2-hero-sub">
            {projection.freeLabel} — calculado sobre un mercado optimizado de{" "}
            <span className="ms2-num">{formatCop(projection.optimizedBasketTotalCop)}</span>.
          </p>

          {projection.isExample && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <button
                type="button"
                className="ms2-btn ms2-btn-sm"
                style={{ background: "var(--ms2-gold)", color: "var(--ms2-primary)" }}
                onClick={onLoadStarterBasket}
              >
                <HearthIcon name="shopping_basket" size={15} />
                <span>Cargar canasta base (15 productos)</span>
              </button>
              <button
                type="button"
                className="ms2-btn ms2-btn-sm"
                style={{
                  background: "rgba(255,255,255,0.14)",
                  color: "#ffffff",
                  borderColor: "rgba(255,255,255,0.24)",
                }}
                onClick={onOpenFavorites}
              >
                <HearthIcon name="auto_awesome" size={14} />
                <span className="ms2-num">
                  Favoritos ({favoritesCount}/{favoriteLimit})
                </span>
              </button>
            </div>
          )}
        </section>

        {/* Cotizador rápido 1 vs 1 */}
        <section className="ms2-card" aria-label="Cotizador rápido de productos">
          <div className="ms2-row-between" style={{ marginBottom: 10 }}>
            <div>
              <h2 className="ms2-h2">Cotizador rápido 1 vs 1</h2>
              <p className="ms2-muted" style={{ margin: "2px 0 0" }}>
                Compara al instante el precio real por gramo o mililitro (PUM).
              </p>
            </div>
            <PumHelpTrigger variant="pill" />
          </div>

          <form
            className="ms2-search-form"
            onSubmit={(e) => {
              e.preventDefault();
              void runExplicitSearch(query);
            }}
          >
            <HearthIcon name="search" size={18} />
            <input
              type="search"
              className="ms2-search-input"
              aria-label="Buscar producto o marca"
              placeholder="Ej: leche deslactosada, arroz, café..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="ms2-icon-btn"
                style={{ border: "none", background: "transparent" }}
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
              >
                <HearthIcon name="close" size={16} />
              </button>
            )}
            <button
              type="submit"
              className="ms2-btn ms2-btn-primary ms2-btn-sm"
              disabled={searching}
            >
              <span>{searching ? "Buscando..." : "Cotizar"}</span>
            </button>
          </form>

          <div className="ms2-pills-scroll" style={{ marginTop: 10 }}>
            {QUICK_CHIPS.map((term) => {
              const active = query.trim().toLowerCase() === term.toLowerCase();
              return (
                <button
                  key={term}
                  type="button"
                  className={`ms2-chip ${active ? "active" : ""}`}
                  onClick={() => void runExplicitSearch(term)}
                >
                  {term}
                </button>
              );
            })}
          </div>

          {instantDuel && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--ms2-border)" }}>
              <div className="ms2-row-between" style={{ marginBottom: 8 }}>
                <span className="ms2-muted">
                  Comparativa directa ·{" "}
                  {formatNetContent(instantDuel.winner.netContent, instantDuel.winner.unitMeasure)}
                </span>
                <span className="ms2-badge green ms2-num">
                  Gana {instantDuel.winner.storeName} (-{instantDuel.savingsPct}% por{" "}
                  {instantDuel.winner.unitMeasure})
                </span>
              </div>

              <div className="ms2-duel-grid">
                <div className="ms2-duel-box ref">
                  <span className="ms2-muted">Referencia en catálogo</span>
                  <strong style={{ fontSize: "0.86rem" }}>
                    {getOfferDisplayTitle(instantDuel.reference)}
                  </strong>
                  <span className="ms2-muted ms2-num">
                    {instantDuel.reference.storeName} ·{" "}
                    {formatPum(instantDuel.reference.pumPrice, instantDuel.reference.unitMeasure)}
                  </span>
                  <strong className="ms2-num" style={{ fontSize: "1.05rem" }}>
                    {formatCop(instantDuel.reference.calibratedPrice)}
                  </strong>
                </div>

                <div className="ms2-duel-box win">
                  <span className="ms2-badge green" style={{ alignSelf: "flex-start" }}>
                    Mejor precio real
                  </span>
                  <strong style={{ fontSize: "0.86rem" }}>
                    {getOfferDisplayTitle(instantDuel.winner)}
                  </strong>
                  <span className="ms2-muted ms2-num">
                    {instantDuel.winner.storeName} ·{" "}
                    {formatPum(instantDuel.winner.pumPrice, instantDuel.winner.unitMeasure)}
                  </span>
                  <strong className="ms2-num" style={{ fontSize: "1.12rem", color: "var(--ms2-primary)" }}>
                    {formatCop(instantDuel.winner.calibratedPrice)}
                  </strong>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ms2-btn ms2-btn-secondary"
                  style={{ flex: "1 1 160px" }}
                  onClick={() => onInspectOffer(instantDuel.winner)}
                >
                  Ver ficha comparativa
                </button>
                <button
                  type="button"
                  className="ms2-btn ms2-btn-primary"
                  style={{ flex: "1 1 160px" }}
                  onClick={() => onAddQuickOffer(instantDuel.winner)}
                >
                  <HearthIcon name="add" size={16} />
                  <span>Sumar a mi canasta</span>
                </button>
              </div>
            </div>
          )}

          {query.trim().length >= 2 && (
            <div className="ms2-quick-results">
              {quickMatches.length === 0 ? (
                <p className="ms2-muted" style={{ margin: "6px 0 0" }}>
                  {searching
                    ? "Consultando precios en cadenas cercanas..."
                    : "No encontramos coincidencias exactas; prueba otra palabra o abre Catálogo libre en Canasta."}
                </p>
              ) : (
                quickMatches.map((offer) => {
                  const title = getOfferDisplayTitle(offer);
                  const added = basketItems.some(
                    (i) =>
                      i.anchorStoreSkuId === offer.storeSkuId ||
                      i.itemKey === `free_shop:${offer.storeSkuId}`
                  );
                  return (
                    <div key={offer.storeSkuId} className="ms2-offer-row">
                      <button
                        type="button"
                        className="ms2-offer-inspect-btn"
                        onClick={() => onInspectOffer(offer)}
                      >
                        <div
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 10,
                            background: "var(--ms2-bg)",
                            flexShrink: 0,
                            overflow: "hidden",
                          }}
                        >
                          <SmartProductImage src={offer.imageUrl} alt={title} size={48} />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: "0.86rem" }}>{title}</div>
                          <div className="ms2-muted ms2-num">
                            {offer.storeName} ·{" "}
                            {formatNetContent(offer.netContent, offer.unitMeasure)} ·{" "}
                            <strong style={{ color: "var(--ms2-ink)" }}>
                              {formatCop(offer.calibratedPrice)}
                            </strong>{" "}
                            · {formatPum(offer.pumPrice, offer.unitMeasure)}
                          </div>
                          {offer.rappiSavingsCop && offer.rappiSavingsCop > 0 ? (
                            <div style={{ marginTop: 4 }}>
                              <RappiSavingsBadge offer={offer} />
                            </div>
                          ) : null}
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`ms2-btn ms2-btn-sm ${added ? "ms2-btn-soft" : "ms2-btn-primary"}`}
                        onClick={() => onAddQuickOffer(offer)}
                        aria-label={added ? `Quitar ${title}` : `Agregar ${title}`}
                      >
                        <HearthIcon name={added ? "check" : "add"} size={15} />
                        <span>{added ? "En cesta" : "Agregar"}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      </div>

      {/* Columna derecha: Canasta activa + 3 caminos claros + Hogar */}
      <div className="ms2-col-stack">
        {basketItems.length > 0 && (
          <section className="ms2-card ms2-card-tint" aria-label="Tu canasta activa">
            <div className="ms2-row-between">
              <div>
                <span className="ms2-badge green">Canasta activa</span>
                <h2 className="ms2-h2" style={{ marginTop: 6 }}>
                  Mercado actual ({basketItems.length}{" "}
                  {basketItems.length === 1 ? "producto" : "productos"})
                </h2>
              </div>
              <div style={{ textAlign: "right" }}>
                <strong className="ms2-num" style={{ fontSize: "1.25rem", color: "var(--ms2-primary)" }}>
                  {activePlan ? formatCop(activePlan.totalNominalCost) : "Listo"}
                </strong>
                {activePlan && activePlan.savingsVsBaselineCop > 0 && (
                  <div className="ms2-num" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--ms2-primary)" }}>
                    Ahorras {formatCop(activePlan.savingsVsBaselineCop)} (
                    {activePlan.savingsVsBaselinePct}%)
                  </div>
                )}
              </div>
            </div>

            {activePlan && activePlan.storeStops.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {activePlan.storeStops.map((s) => (
                  <StoreBadge key={s.storeId} storeId={s.storeId} storeName={s.storeName} />
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                className="ms2-btn ms2-btn-primary"
                style={{ flex: "1 1 150px" }}
                onClick={onOpenAhorro}
              >
                <HearthIcon name="savings" size={16} />
                <span>Ver compra optimizada</span>
              </button>
              <button type="button" className="ms2-btn ms2-btn-secondary" onClick={onOpenCanasta}>
                Editar cesta
              </button>
              <button type="button" className="ms2-btn ms2-btn-secondary" onClick={onOpenBudget}>
                Presupuesto
              </button>
            </div>
          </section>
        )}

        <section className="ms2-card" aria-label="Cómo quieres armar tu mercado">
          <div className="ms2-row-between" style={{ marginBottom: 10 }}>
            <h2 className="ms2-h2">3 maneras de armar tu mercado</h2>
            <span className="ms2-badge neutral">Sin registro</span>
          </div>

          <div className="ms2-paths-list">
            {[
              {
                id: "generic_guided" as const,
                title: "Por características (Sin marca)",
                desc: "Eliges el tipo de alimento (deslactosada, económico, paquete) y buscamos el menor precio por kilo o litro.",
                cta: "Armar sin marcas",
                icon: "shopping_basket",
              },
              {
                id: "habitual_guided" as const,
                title: "Con mis marcas favoritas",
                desc: "Fija tus productos de siempre o compáralos lado a lado con equivalentes más baratos.",
                cta: "Elegir mis marcas",
                icon: "storefront",
              },
              {
                id: "free_shop" as const,
                title: "Exploración libre del catálogo",
                desc: `Busca productos puntuales entre ${knownOffers.length}+ referencias y agrégalos al instante.`,
                cta: "Explorar catálogo",
                icon: "travel_explore",
              },
            ].map((mode) => {
              const active = experienceMode === mode.id;
              return (
                <article key={mode.id} className={`ms2-path-card ${active ? "active" : ""}`}>
                  <div className="ms2-row-between">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <HearthIcon name={mode.icon} size={18} />
                      <h3 className="ms2-h3">{mode.title}</h3>
                    </div>
                    {active && <span className="ms2-badge green">Seleccionado</span>}
                  </div>
                  <p className="ms2-muted" style={{ margin: 0 }}>
                    {mode.desc}
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={`ms2-btn ms2-btn-sm ${active ? "ms2-btn-primary" : "ms2-btn-soft"}`}
                      onClick={() => {
                        onSelectMode(mode.id);
                        onLaunchMode(mode.id);
                      }}
                    >
                      <span>{mode.cta}</span>
                      <HearthIcon name="arrow_forward" size={14} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="ms2-card" aria-label="Estado de tu hogar hoy">
          <div className="ms2-row-between" style={{ marginBottom: 10 }}>
            <h2 className="ms2-h2">Hoy en tu hogar</h2>
            <button type="button" className="ms2-btn ms2-btn-ghost ms2-btn-sm" onClick={onOpenHousehold}>
              Configurar hogar →
            </button>
          </div>

          <div className="ms2-info-grid-2">
            <button type="button" className="ms2-mini-stat-btn" onClick={onOpenAhorro}>
              <span className="ms2-muted">Promoción activa hoy</span>
              <strong style={{ fontSize: "0.84rem" }}>
                {todayPromo
                  ? `${todayPromo.storeId.toUpperCase()} · ${todayPromo.label}`
                  : "Martes y miércoles de descuentos"}
              </strong>
            </button>

            <button type="button" className="ms2-mini-stat-btn" onClick={onOpenHousehold}>
              <span className="ms2-muted">Dieta y presupuesto</span>
              <strong style={{ fontSize: "0.84rem" }}>
                {activeDietFilters.length > 0
                  ? `${activeDietFilters.length} filtro(s)`
                  : "Sin restricciones"}{" "}
                ·{" "}
                {userProfile?.monthlyBudgetCop
                  ? formatCop(userProfile.monthlyBudgetCop)
                  : "Sin tope"}
              </strong>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
