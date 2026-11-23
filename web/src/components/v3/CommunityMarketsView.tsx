"use client";

import { useCallback, useEffect, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import { PumHelpTrigger as PumHelpButton } from "@/components/parallel/ParallelPrimitives";
import { useWorkspace } from "@/components/v3/WorkspaceContext";
import type { BasketItemInput, BasketPlan } from "@/lib/basketOptimizer";
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_CATEGORY_LABELS,
  FALLBACK_COMMUNITY_BASKETS,
  hydrateBasketItemsFromSnapshot,
  sanitizeBasketItemsForSnapshot,
} from "@/lib/communityBaskets";
import { formatCop } from "@/lib/formatters";
import type {
  CommunityBasketRecord,
  CommunityCategoryTag,
  DietFilter,
  FavoriteBasketRecord,
} from "@/lib/types";

export function CommunityMarketsView({
  currentItems,
  activePlan,
  activeDietFilters,
  zoneLabel,
  onCopyBasket,
  onOpenFavorites,
  onLoadFavoriteQuick,
}: {
  currentItems: BasketItemInput[];
  activePlan: BasketPlan | null;
  activeDietFilters: DietFilter[];
  zoneLabel: string;
  onCopyBasket: (
    items: BasketItemInput[],
    dietFilters: DietFilter[],
    mode: "copy_use" | "copy_edit",
    sourceTitle: string
  ) => void;
  onOpenFavorites?: () => void;
  onLoadFavoriteQuick?: (fav: FavoriteBasketRecord) => void;
}) {
  const { credentials, favorites, favoriteLimit } = useWorkspace();

  const [categoryFilter, setCategoryFilter] = useState<"all" | CommunityCategoryTag>("all");
  const [baskets, setBaskets] = useState<CommunityBasketRecord[]>(FALLBACK_COMMUNITY_BASKETS);
  const [loading, setLoading] = useState(false);

  const [publishOpen, setPublishOpen] = useState(false);
  const [titleInput, setTitleInput] = useState("Mi mercado optimizado recomendado");
  const [aliasInput, setAliasInput] = useState("Hogar MercaSabio");
  const [descInput, setDescInput] = useState("");
  const [tagInput, setTagInput] = useState<CommunityCategoryTag>("economico");
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadCommunity = useCallback(async (cat: "all" | CommunityCategoryTag) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/community-baskets?category=${encodeURIComponent(cat)}`);
      if (!res.ok) return;
      const json = (await res.json()) as { baskets?: CommunityBasketRecord[] };
      if (Array.isArray(json.baskets)) {
        setBaskets(json.baskets);
      }
    } catch {
      // Mantiene fallback local
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCommunity(categoryFilter);
  }, [categoryFilter, loadCommunity]);

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (currentItems.length === 0) {
      setFeedback("Arma al menos 1 producto en tu canasta para poder compartirla.");
      return;
    }
    if (!credentials) {
      setFeedback("Conectando tu espacio anónimo del hogar; intenta de nuevo en un instante.");
      return;
    }

    setPublishing(true);
    setFeedback(null);

    const storeSummary =
      activePlan && activePlan.storeStops.length > 0
        ? activePlan.storeStops.map((s) => `${s.storeName} (${s.allocations.length})`).join(" + ")
        : "Multi-tienda";

    const cleanItems = sanitizeBasketItemsForSnapshot(currentItems, {
      stripAnchorSpecifics: false,
    });

    try {
      const res = await fetch("/api/community-baskets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": credentials.workspaceId,
          "x-workspace-token": credentials.sessionToken,
        },
        body: JSON.stringify({
          action: "publish",
          authorAlias: aliasInput.trim() || "Hogar MercaSabio",
          title: titleInput.trim() || "Mi mercado recomendado",
          description: descInput.trim(),
          categoryTag: tagInput,
          zoneLabel,
          items: cleanItems,
          activeDietFilters,
          estimatedTotalCop: activePlan?.totalNominalCost ?? 0,
          estimatedSavingsCop: activePlan?.savingsVsBaselineCop ?? 0,
          estimatedSavingsPct: activePlan?.savingsVsBaselinePct ?? 0,
          storeSummary,
          avgSabiometro: 82,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setFeedback(json.error ?? "No se pudo publicar el mercado.");
      } else {
        setPublishOpen(false);
        setDescInput("");
        setFeedback("¡Mercado publicado en la comunidad sin exponer datos personales!");
        await loadCommunity(categoryFilter);
      }
    } catch {
      setFeedback("Error de red publicando el mercado.");
    } finally {
      setPublishing(false);
    }
  }

  async function handleCopy(record: CommunityBasketRecord, mode: "copy_use" | "copy_edit") {
    // Registrar incremento de copias sin bloquear al usuario
    void fetch("/api/community-baskets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "copy", communityBasketId: record.id }),
    }).catch(() => {});

    const hydrated = hydrateBasketItemsFromSnapshot(record.items, {
      sourcePrefix: "comm",
      unlockAllOnEdit: mode === "copy_edit",
    });
    onCopyBasket(hydrated, record.activeDietFilters ?? [], mode, record.title);
  }

  return (
    <section className="hearth-card ms-v3-analysis-panel">
      <div className="ms-v3-row-between">
        <div>
          <div className="ms-v4-pum-inline">
            <span className="ms-v3-kicker-tag">Comunidad dentro de Optimizar compra</span>
            <PumHelpButton variant="pill" label="¿Qué es PUM?" />
          </div>
          <h2 className="hearth-sub-card-title" style={{ marginTop: 4 }}>
            Mercados recomendados de la comunidad
          </h2>
          <p className="hearth-pref-line">
            Copia canastas optimizadas reales para usarlas de una vez o modificarlas a tu gusto, y comparte las tuyas mostrando tu ahorro.
          </p>
        </div>

        <button
          type="button"
          className="hearth-btn-primary"
          style={{ width: "auto", flex: "0 0 auto", padding: "8px 16px" }}
          onClick={() => {
            setFeedback(null);
            setPublishOpen((prev) => !prev);
          }}
        >
          <HearthIcon name="add_circle" size={15} />
          <span>{publishOpen ? "Cerrar" : "Subir mi mercado"}</span>
        </button>
      </div>

      {feedback && (
        <div className="ms-v3-info-callout" style={{ marginTop: 10 }}>
          {feedback}
        </div>
      )}

      {publishOpen && (
        <form className="ms-v4-publish-form" onSubmit={(e) => void handlePublish(e)}>
          <div className="hearth-label">
            Publicar tu canasta actual ({currentItems.length} ítems
            {activePlan
              ? ` · ${formatCop(activePlan.totalNominalCost)} · ahorro ${formatCop(activePlan.savingsVsBaselineCop)}`
              : ""}
            )
          </div>
          <div className="ms-v4-publish-grid">
            <input
              type="text"
              className="hearth-search-input"
              style={{ border: "1px solid var(--h-line)", borderRadius: 10, padding: "8px 10px" }}
              value={titleInput}
              maxLength={100}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Título (ej. Quincena económica Chapinero)"
            />
            <input
              type="text"
              className="hearth-search-input"
              style={{ border: "1px solid var(--h-line)", borderRadius: 10, padding: "8px 10px" }}
              value={aliasInput}
              maxLength={40}
              onChange={(e) => setAliasInput(e.target.value)}
              placeholder="Tu alias público (ej. @LauraBogotá)"
            />
            <select
              className="hearth-sort-select"
              style={{ border: "1px solid var(--h-line)", borderRadius: 10, padding: "8px 10px", background: "#fffdf9" }}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value as CommunityCategoryTag)}
              aria-label="Categoría del mercado"
            >
              {COMMUNITY_CATEGORIES.filter((c) => c.id !== "all").map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className="hearth-search-input"
            style={{ border: "1px solid var(--h-line)", borderRadius: 10, padding: "8px 10px", width: "100%", marginTop: 8 }}
            rows={2}
            maxLength={240}
            value={descInput}
            onChange={(e) => setDescInput(e.target.value)}
            placeholder="Nota corta opcional (ej. Todo D1 + Café Sello Rojo fijo)..."
          />
          <div className="ms-v3-row-between" style={{ marginTop: 8 }}>
            <span className="hearth-pref-line">
              Se publica anónimamente sin direcciones ni datos personales.
            </span>
            <button
              type="submit"
              className="hearth-btn-primary"
              style={{ width: "auto", padding: "8px 16px" }}
              disabled={publishing || currentItems.length === 0}
            >
              <span>{publishing ? "Publicando..." : "Publicar ahora"}</span>
            </button>
          </div>
        </form>
      )}

      {/* Filtros por estilo */}
      <div className="hearth-scroll-pills" style={{ marginTop: 12 }}>
        {COMMUNITY_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`hearth-pill-filter ${categoryFilter === cat.id ? "active" : ""}`}
            onClick={() => setCategoryFilter(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="ms-v4-community-split-desktop">
        <div>
          {loading ? (
            <div className="hearth-empty-subcard" style={{ marginTop: 10 }}>
              Cargando mercados recomendados...
            </div>
          ) : baskets.length === 0 ? (
            <div className="hearth-empty-subcard" style={{ marginTop: 10 }}>
              No hay mercados publicados en esta categoría todavía. ¡Sé el primero en subir el tuyo!
            </div>
          ) : (
            <div className="ms-v4-community-grid">
              {baskets.map((basket) => (
                <article key={basket.id} className="ms-v4-community-card">
                  <div className="ms-v3-row-between">
                    <div style={{ minWidth: 0 }}>
                      <span className="ms-v3-kicker-tag">
                        {COMMUNITY_CATEGORY_LABELS[basket.categoryTag] ?? "Recomendado"}
                      </span>
                      <h3 className="hearth-item-name" style={{ fontSize: "0.96rem", marginTop: 2 }}>
                        {basket.title}
                      </h3>
                      <p className="hearth-pref-line">
                        {basket.authorAlias} · {basket.itemsCount} ítems · {basket.zoneLabel}
                      </p>
                    </div>

                    {basket.estimatedSavingsCop > 0 && (
                      <span className="hearth-res-save-pill tabular" style={{ flexShrink: 0 }}>
                        Ahorro -{formatCop(basket.estimatedSavingsCop)} (
                        {Math.round(basket.estimatedSavingsPct)}%)
                      </span>
                    )}
                  </div>

                  {basket.description && (
                    <p className="hearth-pref-line" style={{ marginTop: 6 }}>
                      {basket.description}
                    </p>
                  )}

                  <div className="ms-v4-community-meta-box tabular">
                    <div>
                      <span>Total optimizado</span>
                      <strong>{formatCop(basket.estimatedTotalCop)}</strong>
                    </div>
                    <div>
                      <span>Tiendas</span>
                      <strong>{basket.storeSummary}</strong>
                    </div>
                    <div>
                      <span>Sabiómetro / Copias</span>
                      <strong>
                        {basket.avgSabiometro != null ? `${Math.round(basket.avgSabiometro)}/100` : "Ref."} ·{" "}
                        {basket.copiesCount} copias
                      </strong>
                    </div>
                  </div>

                  <div className="ms-v3-footer-btn-group" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="hearth-btn-primary"
                      style={{ flex: 1, padding: "8px 12px" }}
                      onClick={() => void handleCopy(basket, "copy_use")}
                    >
                      <HearthIcon name="content_copy" size={14} />
                      <span>Copiar y usar</span>
                    </button>
                    <button
                      type="button"
                      className="hearth-btn-secondary"
                      style={{ flex: 1, padding: "8px 12px" }}
                      onClick={() => void handleCopy(basket, "copy_edit")}
                    >
                      <HearthIcon name="edit" size={14} />
                      <span>Copiar y modificar</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {/* Barra lateral de Favoritos en Desktop (Stitch 33) */}
        <aside className="ms-v4-community-fav-aside" aria-label="Mis Mercados Favoritos">
          <div className="ms-v4-fav-card">
            <div className="ms-v3-row-between">
              <strong style={{ fontSize: "0.9rem", color: "var(--h-primary)" }}>
                ⭐ Mis Mercados Favoritos
              </strong>
              <span className="ms-v4-quota-pill tabular">
                {favorites.length}/{favoriteLimit} {favoriteLimit <= 1 ? "Gratis" : "Premium"}
              </span>
            </div>
            <p className="hearth-pref-line" style={{ marginTop: 4 }}>
              Carga tus listas recurrentes con 1 toque sin armarlas cada vez.
            </p>

            {favorites.length > 0 ? (
              <div className="ms-v3-device-list" style={{ marginTop: 10 }}>
                {favorites.map((fav) => (
                  <div key={fav.id} className="ms-v3-device-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div className="ms-v3-row-between">
                      <strong style={{ fontSize: "0.82rem" }}>{fav.title}</strong>
                      <strong className="tabular" style={{ color: "var(--h-primary)" }}>
                        {formatCop(fav.estimatedTotalCop)}
                      </strong>
                    </div>
                    <span className="hearth-pref-line">
                      {fav.itemsCount} productos · {fav.storeSummary || "Multi-tienda"}
                    </span>
                    {onLoadFavoriteQuick && (
                      <button
                        type="button"
                        className="hearth-btn-primary"
                        style={{ minHeight: 36, fontSize: "0.76rem" }}
                        onClick={() => onLoadFavoriteQuick(fav)}
                      >
                        ⚡ Cargar ya en canasta →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="hearth-empty-subcard" style={{ marginTop: 10, padding: 10 }}>
                Guarda tu canasta favorita para acceder en 1 toque (1 gratis · hasta 10 en Premium).
              </div>
            )}

            {onOpenFavorites && (
              <button
                type="button"
                className="hearth-btn-secondary"
                style={{ width: "100%", marginTop: 10, minHeight: 38 }}
                onClick={onOpenFavorites}
              >
                <span>{favorites.length > 0 ? "Administrar o guardar" : "+ Guardar esta canasta como favorito"}</span>
              </button>
            )}
          </div>

          <div className="ms-v4-premium-nudge" style={{ marginTop: 10 }}>
            <strong style={{ fontSize: "0.8rem", display: "block", marginBottom: 4 }}>
              🔒 Hasta 10 favoritos en Hogar Premium
            </strong>
            <span className="hearth-pref-line">
              Organiza compras separadas (Mercado semanal, Asado con amigos, Aseo mensual, Lonchera).
            </span>
          </div>
        </aside>
      </div>
    </section>
  );
}
