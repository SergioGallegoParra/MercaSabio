"use client";

import { useMemo, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import {
  PackTrapAlert,
  PumHelpTrigger,
  RappiSavingsBadge,
  SmartProductImage,
  StoreBadge,
} from "@/components/parallel/ParallelPrimitives";
import type { BasketItemInput, BasketPlan } from "@/lib/basketOptimizer";
import { extractProductSignature } from "@/lib/comparisonEngine";
import { DIET_FILTER_CATALOG } from "@/lib/dietaryFilter";
import { formatCop, formatNetContent, formatPum } from "@/lib/formatters";
import {
  getAvailableBrandsForItem,
  getSectionIdForItem,
  getSubsectionForItem,
  GUIDED_SECTIONS,
  offerMatchesSubsection,
  type GenericFoodOption,
  type GuidedSubsection,
  type ShoppingExperienceMode,
} from "@/lib/guidedCatalog";
import { detectPackTrap } from "@/lib/packTrap";
import { getOfferDisplayTitle } from "@/lib/productInsights";
import {
  classifyOfferUnifiedTaxonomy,
  UNIFIED_MACRO_CATEGORIES,
} from "@/lib/unifiedTaxonomy";
import type { DietFilter, StoreOffer } from "@/lib/types";

export type CanastaSubView = "basket" | "sections" | "catalog";

export function ParallelCanastaView({
  experienceMode,
  subView,
  onChangeSubView,
  basketItems,
  knownOffers,
  activePlan,
  activeDietFilters,
  onToggleDietFilter,
  onLoadStarterBasket,
  onClearBasket,
  onAddGenericFood,
  onAddOffer,
  onUpdateQuantity,
  onRemoveItem,
  onToggleLockItem,
  onAddExcludedBrand,
  onRemoveExcludedBrand,
  onInspectOffer,
  onEditItemRule,
  onOpenHabitualModal,
  onOpenPreferences,
  onOpenBudget,
  onOpenFavorites,
  onSearchCatalog,
  onGoOptimize,
}: {
  experienceMode: ShoppingExperienceMode;
  subView: CanastaSubView;
  onChangeSubView: (view: CanastaSubView) => void;
  basketItems: BasketItemInput[];
  knownOffers: StoreOffer[];
  activePlan: BasketPlan | null;
  activeDietFilters: DietFilter[];
  onToggleDietFilter: (f: DietFilter) => void;
  onLoadStarterBasket: () => void;
  onClearBasket: () => void;
  onAddGenericFood: (food: GenericFoodOption, sub: GuidedSubsection) => void;
  onAddOffer: (offer: StoreOffer, origin: "habitual_guided" | "free_shop", sub?: GuidedSubsection) => void;
  onUpdateQuantity: (itemKey: string, delta: number) => void;
  onRemoveItem: (itemKey: string) => void;
  onToggleLockItem: (itemKey: string) => void;
  onAddExcludedBrand: (itemKey: string, brand: string) => void;
  onRemoveExcludedBrand: (itemKey: string, brand: string) => void;
  onInspectOffer: (offer: StoreOffer, baselineOffer?: StoreOffer | null, itemKey?: string) => void;
  onEditItemRule: (item: BasketItemInput) => void;
  onOpenHabitualModal: (sub: GuidedSubsection) => void;
  onOpenPreferences: () => void;
  onOpenBudget: () => void;
  onOpenFavorites: () => void;
  onSearchCatalog: (q: string) => Promise<void>;
  onGoOptimize: () => void;
}) {
  const [sectionFilter, setSectionFilter] = useState<"all" | "alacena" | "nevera" | "aseo">("all");
  const [activeGuidedSec, setActiveGuidedSec] = useState<"alacena" | "nevera" | "aseo">("alacena");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [catalogSort, setCatalogSort] = useState<"pum" | "price" | "sabio" | "name">("pum");
  const [catalogMacroFilter, setCatalogMacroFilter] = useState<string>("all");
  const [catalogSubFilter, setCatalogSubFilter] = useState<string>("all");
  const [excludeExpandedKey, setExcludeExpandedKey] = useState<string | null>(null);

  const allocationByKey = useMemo(() => {
    const map = new Map<string, StoreOffer>();
    if (!activePlan) return map;
    for (const stop of activePlan.storeStops) {
      for (const alloc of stop.allocations) {
        map.set(alloc.itemKey, alloc.offer);
      }
    }
    return map;
  }, [activePlan]);

  const resolvedEntries = useMemo(() => {
    return basketItems
      .filter((item) => sectionFilter === "all" || getSectionIdForItem(item) === sectionFilter)
      .map((item) => {
        let offer = allocationByKey.get(item.itemKey) ?? null;
        if (!offer && item.anchorStoreSkuId) {
          offer = knownOffers.find((o) => o.storeSkuId === item.anchorStoreSkuId) ?? null;
        }
        if (!offer) {
          offer =
            knownOffers
              .filter((o) => {
                if (!o.inStock) return false;
                if (item.subtypeFamily) {
                  const sig = extractProductSignature(o);
                  return (
                    sig.subtypeFamily === item.subtypeFamily ||
                    (item.broadFamily && sig.broadFamily === item.broadFamily)
                  );
                }
                return false;
              })
              .sort((a, b) => a.pumPrice - b.pumPrice)[0] ?? null;
        }
        const packTrap = offer
          ? detectPackTrap(
              item,
              offer,
              knownOffers.filter(
                (o) =>
                  o.storeId === offer.storeId &&
                  o.canonicalSlug &&
                  o.canonicalSlug === offer.canonicalSlug
              )
            )
          : null;
        const sub = getSubsectionForItem(item);
        return { item, offer, packTrap, sub };
      });
  }, [basketItems, sectionFilter, allocationByKey, knownOffers]);

  const firstPackTrap = useMemo(
    () => resolvedEntries.find((e) => e.packTrap)?.packTrap ?? null,
    [resolvedEntries]
  );

  const estimatedTotal = useMemo(() => {
    if (activePlan && activePlan.totalNominalCost > 0) return activePlan.totalNominalCost;
    return resolvedEntries.reduce(
      (sum, e) =>
        sum +
        (e.offer?.calibratedPrice ?? e.item.habitualReferencePriceCop ?? 0) *
          (e.item.quantity ?? 1),
      0
    );
  }, [activePlan, resolvedEntries]);

  const activeGuidedSectionObj = useMemo(
    () => GUIDED_SECTIONS.find((s) => s.id === activeGuidedSec) ?? GUIDED_SECTIONS[0],
    [activeGuidedSec]
  );

  const activeUnifiedMacroObj = useMemo(
    () =>
      catalogMacroFilter !== "all"
        ? UNIFIED_MACRO_CATEGORIES.find((m) => m.macroSlug === catalogMacroFilter) ?? null
        : null,
    [catalogMacroFilter]
  );

  const catalogOffers = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];

    const filtered = knownOffers.filter((offer) => {
      if (!offer.inStock || offer.calibratedPrice <= 0) return false;
      if (catalogMacroFilter !== "all" || catalogSubFilter !== "all") {
        const tax = classifyOfferUnifiedTaxonomy(offer);
        if (catalogMacroFilter !== "all" && tax.macroSlug !== catalogMacroFilter) {
          return false;
        }
        if (catalogSubFilter !== "all" && tax.subSlug !== catalogSubFilter) {
          return false;
        }
      }
      if (tokens.length > 0) {
        const hay = `${offer.displayName ?? ""} ${offer.rawName} ${offer.brand ?? ""} ${offer.storeName} ${offer.subPresentationLabel ?? ""}`.toLowerCase();
        if (!tokens.every((tk) => hay.includes(tk))) return false;
      }
      return true;
    });

    return [...filtered]
      .sort((a, b) => {
        if (catalogSort === "price") return a.calibratedPrice - b.calibratedPrice;
        if (catalogSort === "name")
          return getOfferDisplayTitle(a).localeCompare(getOfferDisplayTitle(b), "es");
        if (catalogSort === "sabio") {
          return (
            (b.sabiometro?.valueIndex ?? -1) - (a.sabiometro?.valueIndex ?? -1) ||
            a.pumPrice - b.pumPrice
          );
        }
        return a.pumPrice - b.pumPrice;
      })
      .slice(0, 36);
  }, [knownOffers, catalogQuery, catalogMacroFilter, catalogSubFilter, catalogSort]);

  async function handleRunCatalogSearch(e: React.FormEvent) {
    e.preventDefault();
    if (catalogQuery.trim().length < 2) return;
    setCatalogSearching(true);
    try {
      await onSearchCatalog(catalogQuery.trim());
    } finally {
      setCatalogSearching(false);
    }
  }

  return (
    <div className="ms2-workspace-2col">
      {/* Columna Principal: Cesta / Secciones / Catálogo */}
      <div className="ms2-col-stack">
        <div className="ms2-section-head">
          <div>
            <h1 className="ms2-h1 ms2-num">
              Mi Canasta ({basketItems.length}{" "}
              {basketItems.length === 1 ? "producto" : "productos"})
            </h1>
            <p className="ms2-sub">
              Combina productos sin marca (al menor precio por unidad) y marcas fijas en un mismo mercado.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="ms2-btn ms2-btn-secondary ms2-btn-sm" onClick={onOpenFavorites}>
              <HearthIcon name="auto_awesome" size={14} />
              <span>Favoritos</span>
            </button>
            {basketItems.length === 0 ? (
              <button type="button" className="ms2-btn ms2-btn-primary ms2-btn-sm" onClick={onLoadStarterBasket}>
                <HearthIcon name="add" size={14} />
                <span>Cargar mercado base (15)</span>
              </button>
            ) : (
              <button type="button" className="ms2-btn ms2-btn-ghost ms2-btn-sm" onClick={onClearBasket}>
                Vaciar cesta
              </button>
            )}
          </div>
        </div>

        {/* Sub-navegación limpia en 1 sola fila */}
        <div className="ms2-tablist" role="tablist" aria-label="Vistas de la canasta">
          {[
            { id: "basket" as const, label: `Mi cesta (${basketItems.length})` },
            { id: "sections" as const, label: "Agregar por sección" },
            { id: "catalog" as const, label: "Explorar catálogo" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={subView === tab.id}
              className="ms2-tab"
              onClick={() => onChangeSubView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filtros rápidos de sección */}
        {(subView === "basket" || subView === "catalog") && (
          <div className="ms2-pills-scroll">
            <button
              type="button"
              className={`ms2-chip ${sectionFilter === "all" ? "active" : ""}`}
              onClick={() => {
                setSectionFilter("all");
                setCatalogSubFilter("all");
              }}
            >
              Todas las secciones
            </button>
            {GUIDED_SECTIONS.map((sec) => {
              const count = basketItems.filter((i) => getSectionIdForItem(i) === sec.id).length;
              return (
                <button
                  key={sec.id}
                  type="button"
                  className={`ms2-chip ${sectionFilter === sec.id ? "active" : ""}`}
                  onClick={() => {
                    setSectionFilter(sec.id);
                    setCatalogSubFilter("all");
                  }}
                >
                  <HearthIcon name={sec.materialIcon} size={14} />
                  <span>
                    {sec.shortLabel}
                    {subView === "basket" ? ` (${count})` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* VISTA 1: MI CESTA */}
        {subView === "basket" && (
          <>
            {firstPackTrap && <PackTrapAlert warning={firstPackTrap} />}

            {basketItems.length === 0 ? (
              <div className="ms2-card" style={{ textAlign: "center", padding: "32px 20px" }}>
                <h2 className="ms2-h2">Tu canasta está vacía</h2>
                <p className="ms2-muted" style={{ margin: "6px auto 16px", maxWidth: "44ch" }}>
                  Carga un mercado base colombiano de 15 productos esenciales o agrega alimentos por sección.
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <button type="button" className="ms2-btn ms2-btn-primary" onClick={onLoadStarterBasket}>
                    <HearthIcon name="shopping_basket" size={16} />
                    <span>Cargar mercado base (15)</span>
                  </button>
                  <button
                    type="button"
                    className="ms2-btn ms2-btn-secondary"
                    onClick={() => onChangeSubView("sections")}
                  >
                    Agregar por sección
                  </button>
                </div>
              </div>
            ) : (
              <div className="ms2-basket-grid">
                {resolvedEntries.map(({ item, offer, sub }) => {
                  const locked = Boolean(item.locked);
                  const qty = item.quantity ?? 1;
                  const title = offer ? getOfferDisplayTitle(offer) : item.label;
                  const unitPrice = offer?.calibratedPrice ?? item.habitualReferencePriceCop ?? 0;
                  const totalPrice = unitPrice * qty;
                  const weight = offer
                    ? formatNetContent(offer.netContent, offer.unitMeasure)
                    : item.targetNetContent && item.targetUnitMeasure
                      ? formatNetContent(item.targetNetContent, item.targetUnitMeasure)
                      : "Estándar";
                  const ruleText = locked
                    ? "Marca fija"
                    : item.anchorStoreSkuId
                      ? "Marca · similar"
                      : "Sin marca";
                  const iconName =
                    sub.sectionId === "nevera"
                      ? "local_drink"
                      : sub.sectionId === "aseo"
                        ? "local_laundry_service"
                        : "inventory_2";

                  const excludedBrands = item.excludedBrands ?? [];
                  const availableBrands = getAvailableBrandsForItem(item, knownOffers);
                  const remainingBrands = availableBrands.filter(
                    (b) => !excludedBrands.some((ex) => ex.toLowerCase() === b.toLowerCase())
                  );
                  const isExcludeOpen = excludeExpandedKey === item.itemKey;

                  return (
                    <article key={item.itemKey} className={`ms2-tile ${locked ? "locked" : ""}`}>
                      <button
                        type="button"
                        className={`ms2-tile-lock-btn ${locked ? "active" : ""}`}
                        aria-pressed={locked}
                        aria-label={locked ? `Desbloquear ${title}` : `Fijar ${title}`}
                        onClick={() => onToggleLockItem(item.itemKey)}
                      >
                        <HearthIcon name={locked ? "lock" : "lock_open"} size={14} />
                      </button>

                      <button
                        type="button"
                        className="ms2-tile-inspect"
                        onClick={() =>
                          offer
                            ? onInspectOffer(offer, null, item.itemKey)
                            : onEditItemRule(item)
                        }
                      >
                        <div className="ms2-tile-media">
                          <SmartProductImage src={offer?.imageUrl} alt={title} fallbackIcon={iconName} />
                          <span className="ms2-tile-weight ms2-num">{weight}</span>
                          {qty > 1 && <span className="ms2-tile-qty-pill ms2-num">{qty}×</span>}
                        </div>

                        <div className="ms2-tile-title">{title}</div>

                        <div className="ms2-row-between" style={{ marginTop: "auto" }}>
                          <strong className="ms2-num" style={{ color: "var(--ms2-primary)", fontSize: "0.96rem" }}>
                            {totalPrice > 0 ? formatCop(totalPrice) : "Por cotizar"}
                          </strong>
                          <span className="ms2-muted" style={{ fontSize: "0.74rem" }}>
                            {offer?.storeName ?? item.anchorBrand ?? "Auto"}
                          </span>
                        </div>
                      </button>

                      <div className="ms2-tile-foot">
                        <button
                          type="button"
                          className="ms2-tile-rule-btn"
                          onClick={() => onEditItemRule(item)}
                        >
                          <span>{ruleText}</span>
                          <HearthIcon name="tune" size={12} />
                        </button>

                        <div className="ms2-row-between">
                          <div className="ms2-stepper" aria-label={`Cantidad de ${item.label}`}>
                            <button
                              type="button"
                              className="ms2-stepper-btn"
                              aria-label={`Disminuir ${item.label}`}
                              onClick={() => onUpdateQuantity(item.itemKey, -1)}
                            >
                              <HearthIcon name="remove" size={13} />
                            </button>
                            <span className="ms2-num" style={{ minWidth: 20, textAlign: "center", fontWeight: 700, fontSize: "0.82rem" }}>
                              {qty}
                            </span>
                            <button
                              type="button"
                              className="ms2-stepper-btn"
                              aria-label={`Aumentar ${item.label}`}
                              onClick={() => onUpdateQuantity(item.itemKey, 1)}
                            >
                              <HearthIcon name="add" size={13} />
                            </button>
                          </div>

                          <div style={{ display: "flex", gap: 4 }}>
                            {remainingBrands.length > 0 && (
                              <button
                                type="button"
                                className="ms2-icon-btn"
                                style={{ minWidth: 32, minHeight: 32 }}
                                aria-label={`Excluir marcas de ${item.label}`}
                                title="Excluir marcas no deseadas"
                                onClick={() =>
                                  setExcludeExpandedKey(isExcludeOpen ? null : item.itemKey)
                                }
                              >
                                <HearthIcon name="block" size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="ms2-icon-btn danger"
                              style={{ minWidth: 32, minHeight: 32 }}
                              aria-label={`Eliminar ${item.label}`}
                              onClick={() => onRemoveItem(item.itemKey)}
                            >
                              <HearthIcon name="delete" size={14} />
                            </button>
                          </div>
                        </div>

                        {isExcludeOpen && (
                          <div style={{ paddingTop: 4, borderTop: "1px solid var(--ms2-border)" }}>
                            <select
                              className="ms2-select"
                              style={{ minHeight: 34, fontSize: "0.76rem", padding: "4px 8px" }}
                              value=""
                              aria-label={`Seleccionar marca a excluir en ${item.label}`}
                              onChange={(e) => {
                                if (e.target.value) onAddExcludedBrand(item.itemKey, e.target.value);
                              }}
                            >
                              <option value="">Excluir marca...</option>
                              {remainingBrands.map((b) => (
                                <option key={b} value={b}>
                                  {b}
                                </option>
                              ))}
                            </select>
                            {excludedBrands.length > 0 && (
                              <div className="ms2-chip-wrap" style={{ marginTop: 6 }}>
                                {excludedBrands.map((b) => (
                                  <button
                                    key={b}
                                    type="button"
                                    className="ms2-chip"
                                    style={{ minHeight: 28, fontSize: "0.72rem", padding: "2px 8px" }}
                                    onClick={() => onRemoveExcludedBrand(item.itemKey, b)}
                                  >
                                    {b} ×
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* VISTA 2: AGREGAR POR SECCIÓN (Alacena / Nevera / Aseo sin pasos lineales rotos) */}
        {subView === "sections" && (
          <div className="ms2-col-stack">
            <div className="ms2-pills-scroll">
              {GUIDED_SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  className={`ms2-chip ${activeGuidedSec === sec.id ? "active" : ""}`}
                  onClick={() => setActiveGuidedSec(sec.id as "alacena" | "nevera" | "aseo")}
                >
                  <HearthIcon name={sec.materialIcon} size={14} />
                  <span>{sec.label}</span>
                </button>
              ))}
            </div>

            {activeGuidedSectionObj.subsections.map((sub) => {
              const subItems = basketItems.filter(
                (i) => getSubsectionForItem(i).subsectionId === sub.id
              );
              return (
                <section key={sub.id} className="ms2-card">
                  <div className="ms2-row-between" style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <HearthIcon name={sub.materialIcon} size={18} />
                      <h2 className="ms2-h2">{sub.label}</h2>
                    </div>
                    <span className="ms2-badge neutral ms2-num">{subItems.length} en cesta</span>
                  </div>

                  {subItems.length > 0 && (
                    <div className="ms2-list-stack" style={{ marginBottom: 12 }}>
                      {subItems.map((item) => (
                        <div key={item.itemKey} className="ms2-item-row">
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <strong style={{ fontSize: "0.88rem" }}>
                              {item.quantity && item.quantity > 1 ? `${item.quantity}× ` : ""}
                              {item.label}
                            </strong>
                            <div className="ms2-muted">
                              {item.locked
                                ? "Marca fija"
                                : item.anchorStoreSkuId
                                  ? `Marca ${item.anchorBrand ?? ""} · compara similares`
                                  : "Sin marca · busca menor PUM"}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <button
                              type="button"
                              className="ms2-btn ms2-btn-secondary ms2-btn-sm"
                              onClick={() => onEditItemRule(item)}
                            >
                              Regla
                            </button>
                            <button
                              type="button"
                              className="ms2-icon-btn danger"
                              aria-label={`Quitar ${item.label}`}
                              onClick={() => onRemoveItem(item.itemKey)}
                            >
                              <HearthIcon name="delete" size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="ms2-chip-wrap">
                    {sub.foods.map((food) => (
                      <button
                        key={food.id}
                        type="button"
                        className="ms2-chip"
                        onClick={() => onAddGenericFood(food, sub)}
                      >
                        <HearthIcon name="add" size={14} />
                        <span>{food.name}</span>
                      </button>
                    ))}
                    {experienceMode === "habitual_guided" || true ? (
                      <button
                        type="button"
                        className="ms2-btn ms2-btn-soft ms2-btn-sm"
                        onClick={() => onOpenHabitualModal(sub)}
                      >
                        <HearthIcon name="storefront" size={14} />
                        <span>Elegir marca específica</span>
                      </button>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* VISTA 3: EXPLORAR CATÁLOGO COMPLETO */}
        {subView === "catalog" && (
          <div className="ms2-col-stack">
            <div className="ms2-card">
              <form className="ms2-search-form" onSubmit={handleRunCatalogSearch}>
                <HearthIcon name="search" size={18} />
                <input
                  type="search"
                  className="ms2-search-input"
                  aria-label="Buscar en catálogo completo"
                  placeholder="Buscar por producto, marca o presentación..."
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                />
                <button
                  type="submit"
                  className="ms2-btn ms2-btn-primary ms2-btn-sm"
                  disabled={catalogSearching}
                >
                  {catalogSearching ? "Buscando..." : "Buscar"}
                </button>
              </form>

              <div className="ms2-row-between" style={{ marginTop: 12 }}>
                <div className="ms2-pills-scroll" style={{ flex: 1 }}>
                  <button
                    type="button"
                    className={`ms2-chip ${catalogMacroFilter === "all" ? "active" : ""}`}
                    onClick={() => {
                      setCatalogMacroFilter("all");
                      setCatalogSubFilter("all");
                    }}
                  >
                    Todas (10)
                  </button>
                  {UNIFIED_MACRO_CATEGORIES.map((mc) => (
                    <button
                      key={mc.macroSlug}
                      type="button"
                      className={`ms2-chip ${catalogMacroFilter === mc.macroSlug ? "active" : ""}`}
                      onClick={() => {
                        setCatalogMacroFilter(mc.macroSlug);
                        setCatalogSubFilter("all");
                      }}
                    >
                      <HearthIcon name={mc.icon} size={14} />
                      <span>{mc.shortLabel}</span>
                    </button>
                  ))}
                </div>

                <select
                  className="ms2-select"
                  style={{ width: "auto", minWidth: 170 }}
                  aria-label="Ordenar catálogo"
                  value={catalogSort}
                  onChange={(e) =>
                    setCatalogSort(e.target.value as "pum" | "price" | "sabio" | "name")
                  }
                >
                  <option value="pum">Menor PUM ($/g, $/ml)</option>
                  <option value="price">Menor precio total</option>
                  <option value="sabio">Mejor calificación real</option>
                  <option value="name">Nombre A–Z</option>
                </select>
              </div>

              {activeUnifiedMacroObj && (
                <div className="ms2-pills-scroll" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className={`ms2-chip ${catalogSubFilter === "all" ? "active" : ""}`}
                    style={{ minHeight: 30, fontSize: "0.75rem", padding: "3px 10px" }}
                    onClick={() => setCatalogSubFilter("all")}
                  >
                    Todo {activeUnifiedMacroObj.shortLabel}
                  </button>
                  {activeUnifiedMacroObj.subcategories.map((sb) => (
                    <button
                      key={sb.subSlug}
                      type="button"
                      className={`ms2-chip ${catalogSubFilter === sb.subSlug ? "active" : ""}`}
                      style={{ minHeight: 30, fontSize: "0.75rem", padding: "3px 10px" }}
                      onClick={() => setCatalogSubFilter(sb.subSlug)}
                    >
                      {sb.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="ms2-list-stack">
              {catalogOffers.map((offer) => {
                const key = `free_shop:${offer.storeSkuId}`;
                const added = basketItems.some(
                  (i) => i.itemKey === key || i.anchorStoreSkuId === offer.storeSkuId
                );
                const title = getOfferDisplayTitle(offer);
                const unifiedCat = classifyOfferUnifiedTaxonomy(offer);
                return (
                  <article key={offer.storeSkuId} className="ms2-offer-row">
                    <button
                      type="button"
                      className="ms2-offer-inspect-btn"
                      onClick={() => onInspectOffer(offer)}
                    >
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 10,
                          background: "var(--ms2-bg)",
                          flexShrink: 0,
                          overflow: "hidden",
                        }}
                      >
                        <SmartProductImage src={offer.imageUrl} alt={title} size={56} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{title}</div>
                        <div className="ms2-muted ms2-num" style={{ marginTop: 2 }}>
                          {offer.brand ? `${offer.brand} · ` : ""}
                          {formatNetContent(offer.netContent, offer.unitMeasure)} ·{" "}
                          {formatPum(offer.pumPrice, offer.unitMeasure)}
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                          <StoreBadge storeId={offer.storeId} storeName={offer.storeName} />
                          <span className="ms2-badge neutral" style={{ fontSize: "0.7rem" }}>
                            {unifiedCat.subLabel}
                          </span>
                          <strong className="ms2-num" style={{ color: "var(--ms2-primary)" }}>
                            {formatCop(offer.calibratedPrice)}
                          </strong>
                          <RappiSavingsBadge offer={offer} />
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      className={`ms2-btn ms2-btn-sm ${added ? "ms2-btn-soft" : "ms2-btn-primary"}`}
                      onClick={() => onAddOffer(offer, "free_shop")}
                    >
                      <HearthIcon name={added ? "check" : "add"} size={15} />
                      <span>{added ? "En cesta" : "Agregar"}</span>
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Columna Lateral Fija (Desktop) / Resumen en flujo (Mobile): Reglas, Dieta y Optimización */}
      <aside className="ms2-sticky-aside" aria-label="Resumen de optimización y preferencias">
        <section className="ms2-card ms2-card-tint">
          <div className="ms2-row-between">
            <span className="ms2-badge green">Total estimado</span>
            {activePlan && (
              <span className="ms2-muted ms2-num">
                {activePlan.storeStops.length}{" "}
                {activePlan.storeStops.length === 1 ? "parada" : "paradas"}
              </span>
            )}
          </div>

          <div className="ms2-num" style={{ fontSize: "1.65rem", fontWeight: 800, color: "var(--ms2-primary)", marginTop: 6 }}>
            {estimatedTotal > 0 ? formatCop(estimatedTotal) : "Por calcular"}
          </div>

          {activePlan && activePlan.savingsVsBaselineCop > 0 && (
            <div className="ms2-num" style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--ms2-primary)" }}>
              Ahorro estimado: {formatCop(activePlan.savingsVsBaselineCop)} (
              {activePlan.savingsVsBaselinePct}%)
            </div>
          )}

          <div className="ms2-list-stack" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="ms2-btn ms2-btn-primary"
              style={{ width: "100%" }}
              disabled={basketItems.length === 0}
              onClick={onGoOptimize}
            >
              <HearthIcon name="savings" size={17} />
              <span>Optimizar compra ahora →</span>
            </button>

            <button
              type="button"
              className="ms2-btn ms2-btn-secondary"
              style={{ width: "100%" }}
              disabled={basketItems.length === 0}
              onClick={onOpenBudget}
            >
              <HearthIcon name="wallet" size={16} />
              <span>Ajustar a mi presupuesto</span>
            </button>
          </div>
        </section>

        <section className="ms2-card">
          <div className="ms2-row-between" style={{ marginBottom: 10 }}>
            <h2 className="ms2-h3">Filtros y calidad de canasta</h2>
            <PumHelpTrigger />
          </div>

          <div className="ms2-chip-wrap">
            {(Object.keys(DIET_FILTER_CATALOG) as DietFilter[]).map((key) => {
              const active = activeDietFilters.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  className={`ms2-chip ${active ? "active" : ""}`}
                  style={{ minHeight: 34, fontSize: "0.76rem", padding: "4px 10px" }}
                  onClick={() => onToggleDietFilter(key)}
                >
                  {active ? "✓ " : "+ "}
                  {DIET_FILTER_CATALOG[key].label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="ms2-btn ms2-btn-soft ms2-btn-sm"
            style={{ width: "100%", marginTop: 12 }}
            onClick={onOpenPreferences}
          >
            <HearthIcon name="tune" size={15} />
            <span>Candados, calificación mínima y reglas</span>
          </button>
        </section>
      </aside>
    </div>
  );
}
