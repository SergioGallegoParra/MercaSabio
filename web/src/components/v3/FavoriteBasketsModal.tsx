"use client";

import { useEffect, useRef, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import { useWorkspace } from "@/components/v3/WorkspaceContext";
import { hydrateBasketItemsFromSnapshot } from "@/lib/communityBaskets";
import { FAVORITE_BASKET_LIMITS } from "@/lib/featureAccess";
import { formatCop } from "@/lib/formatters";
import type { BasketItemInput } from "@/lib/basketOptimizer";
import type { DietFilter, FavoriteBasketRecord } from "@/lib/types";

export function FavoriteBasketsModal({
  open,
  currentItems,
  currentMode,
  currentDietFilters,
  estimatedTotalCop,
  estimatedSavingsCop,
  storeSummary,
  zoneLabel,
  onClose,
  onLoadFavorite,
  onPublishToCommunity,
}: {
  open: boolean;
  currentItems: BasketItemInput[];
  currentMode: "my_brands" | "generic";
  currentDietFilters: DietFilter[];
  estimatedTotalCop: number;
  estimatedSavingsCop: number;
  storeSummary: string;
  zoneLabel: string;
  onClose: () => void;
  onLoadFavorite: (items: BasketItemInput[], dietFilters: DietFilter[]) => void;
  onPublishToCommunity?: (fav: FavoriteBasketRecord) => void;
}) {
  const {
    favorites,
    favoriteLimit,
    planTier,
    saveFavoriteBasket,
    removeFavoriteBasket,
  } = useWorkspace();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [titleInput, setTitleInput] = useState("Mercado quincenal hogar");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setStatusMsg(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const atLimit = favorites.length >= favoriteLimit;

  async function handleSave(replaceId?: string) {
    if (currentItems.length === 0) {
      setStatusMsg("Agrega al menos 1 producto a tu canasta antes de guardarla como favorita.");
      return;
    }
    setSaving(true);
    setStatusMsg(null);
    const res = await saveFavoriteBasket({
      title: titleInput.trim() || "Mercado favorito",
      optimizeMode: currentMode,
      items: currentItems,
      activeDietFilters: currentDietFilters,
      estimatedTotalCop,
      estimatedSavingsCop,
      storeSummary,
      zoneLabel,
      replaceId: replaceId ?? null,
    });
    setSaving(false);
    if (res.ok) {
      setStatusMsg(
        replaceId
          ? "Favorito reemplazado y sincronizado en tu hogar."
          : "¡Mercado favorito guardado para carga rápida!"
      );
    } else {
      setStatusMsg(res.message ?? "No se pudo guardar el favorito.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="hearth-dialog ms-v3-product-dialog"
      aria-labelledby="favorites-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="hearth-sheet ms-v3-product-sheet">
        <div className="hearth-sheet-handle" aria-hidden="true" />
        <div className="hearth-sheet-header">
          <div>
            <div className="ms-v4-fav-kicker-row">
              <span className="ms-v3-kicker-tag">Carga en 1 toque</span>
              <span className="ms-v4-quota-pill tabular">
                Cupo: {favorites.length} / {favoriteLimit} ·{" "}
                {planTier === "premium" ? "Premium" : "Plan Gratis"}
              </span>
            </div>
            <h3 id="favorites-dialog-title" className="hearth-sheet-title">
              Mis Mercados Favoritos
            </h3>
            <p className="hearth-pref-line">
              Guarda listas frecuentes para cargarlas al instante sin volver a armarlas cada semana.
            </p>
          </div>
          <button
            type="button"
            className="hearth-sheet-close"
            onClick={onClose}
            aria-label="Cerrar mercados favoritos"
          >
            <HearthIcon name="close" size={18} />
          </button>
        </div>

        <div className="hearth-sheet-body">
          {/* Guardar canasta actual */}
          {currentItems.length > 0 && (
            <section className="hearth-card" style={{ padding: 12 }}>
              <label className="hearth-label" htmlFor="fav-basket-title">
                Guardar canasta actual ({currentItems.length} ítems · {formatCop(estimatedTotalCop)})
              </label>
              <div className="ms-v3-join-row" style={{ marginTop: 6 }}>
                <input
                  id="fav-basket-title"
                  type="text"
                  className="hearth-search-input"
                  style={{ border: "1px solid var(--h-line)", borderRadius: 10, padding: "8px 10px" }}
                  value={titleInput}
                  maxLength={80}
                  onChange={(e) => setTitleInput(e.target.value)}
                  placeholder="Ej. Mercado quincenal hogar"
                />
                {!atLimit ? (
                  <button
                    type="button"
                    className="hearth-btn-primary"
                    style={{ width: "auto", padding: "8px 14px" }}
                    disabled={saving}
                    onClick={() => void handleSave()}
                  >
                    <HearthIcon name="auto_awesome" size={15} />
                    <span>{saving ? "Guardando..." : "Guardar"}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="hearth-btn-secondary"
                    style={{ width: "auto", padding: "8px 12px" }}
                    disabled={saving || favorites.length === 0}
                    onClick={() => void handleSave(favorites[0]?.id)}
                  >
                    <HearthIcon name="restart_alt" size={15} />
                    <span>Reemplazar actual</span>
                  </button>
                )}
              </div>
              {statusMsg && (
                <p className="hearth-pref-line" style={{ marginTop: 6, color: "var(--h-primary)" }}>
                  {statusMsg}
                </p>
              )}
            </section>
          )}

          {/* Lista de favoritos guardados */}
          {favorites.length === 0 ? (
            <div className="hearth-empty-subcard">
              Aún no tienes mercados favoritos guardados. Guarda tu canasta actual arriba para cargarla en 1 toque cuando vuelvas.
            </div>
          ) : (
            <div className="ms-v3-store-mini-list">
              {favorites.map((fav) => (
                <article key={fav.id} className="ms-v4-fav-card">
                  <div className="ms-v3-row-between">
                    <div>
                      <span className="ms-v3-kicker-tag">Favorito guardado</span>
                      <h4 className="hearth-item-name" style={{ fontSize: "0.95rem", marginTop: 2 }}>
                        {fav.title}
                      </h4>
                    </div>
                    <strong className="tabular" style={{ color: "var(--h-primary)", fontSize: "0.96rem" }}>
                      {formatCop(fav.estimatedTotalCop)}
                    </strong>
                  </div>

                  <p className="hearth-pref-line" style={{ marginTop: 4 }}>
                    {fav.itemsCount} ítems · {fav.zoneLabel || "Bogotá"}
                    {fav.storeSummary ? ` · ${fav.storeSummary}` : ""}
                    {fav.estimatedSavingsCop > 0
                      ? ` · Ahorro est. ${formatCop(fav.estimatedSavingsCop)}`
                      : ""}
                  </p>

                  <div className="ms-v3-footer-btn-group" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="hearth-btn-primary"
                      style={{ flex: 1, padding: "8px 12px" }}
                      onClick={() => {
                        const hydrated = hydrateBasketItemsFromSnapshot(fav.items, {
                          sourcePrefix: "fav",
                        });
                        onLoadFavorite(hydrated, fav.activeDietFilters ?? []);
                        onClose();
                      }}
                    >
                      <HearthIcon name="shopping_basket" size={15} />
                      <span>Cargar ya en canasta</span>
                    </button>
                    {onPublishToCommunity && (
                      <button
                        type="button"
                        className="hearth-edit-pref-btn"
                        onClick={() => {
                          onPublishToCommunity(fav);
                          onClose();
                        }}
                      >
                        <HearthIcon name="groups" size={14} />
                        <span>Subir</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="hearth-icon-btn danger"
                      aria-label={`Quitar favorito ${fav.title}`}
                      onClick={() => void removeFavoriteBasket(fav.id)}
                    >
                      <HearthIcon name="delete" size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* Tarjeta informativa de cupo Gratis (1) vs Premium (10) */}
          {planTier !== "premium" && (
            <section className="ms-v4-premium-nudge">
              <div className="ms-v3-row-between">
                <strong>
                  ¿Necesitas hasta {FAVORITE_BASKET_LIMITS.premium} mercados favoritos?
                </strong>
                <span className="ms-v4-quota-pill tabular">
                  Gratis: {FAVORITE_BASKET_LIMITS.free} · Premium: {FAVORITE_BASKET_LIMITS.premium}
                </span>
              </div>
              <p className="hearth-pref-line" style={{ marginTop: 4 }}>
                Con 1 favorito gratis puedes reemplazarlo cuantas veces quieras sin registrarte. En la versión Premium podrás guardar hasta 10 listas simultáneas (quincenal, asado, aseo mensual, lonchera).
              </p>
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}
