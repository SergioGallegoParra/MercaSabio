"use client";

import { useEffect, useMemo, useRef } from "react";

import HearthIcon from "@/components/HearthIcon";
import { useWorkspace } from "@/components/v3/WorkspaceContext";
import type { BasketItemInput, BasketPlan } from "@/lib/basketOptimizer";
import { formatCop } from "@/lib/formatters";
import type { ShoppingExperienceMode } from "@/lib/guidedCatalog";
import type { FavoriteBasketRecord } from "@/lib/types";

export function MisMercadosModal({
  open,
  onClose,
  basketItems,
  activePlan,
  onContinueShopping,
  onGoToRoute,
  onOptimizeActive,
  onLaunchMode,
  onOpenFavoritesModal,
  onOpenDevicesModal,
  onLoadFavoriteQuick,
}: {
  open: boolean;
  onClose: () => void;
  basketItems: BasketItemInput[];
  activePlan: BasketPlan | null;
  onContinueShopping: () => void;
  onGoToRoute: () => void;
  onOptimizeActive: () => void;
  onLaunchMode: (mode: ShoppingExperienceMode) => void;
  onOpenFavoritesModal: () => void;
  onOpenDevicesModal: () => void;
  onLoadFavoriteQuick: (fav: FavoriteBasketRecord) => void;
}) {
  const { credentials, favorites, favoriteLimit, baskets } = useWorkspace();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const habitualItemsCount = useMemo(
    () => basketItems.filter((i) => i.originMode === "habitual_guided" || Boolean(i.anchorStoreSkuId)).length,
    [basketItems]
  );

  const habitualEstimatedTotal = useMemo(
    () =>
      basketItems.reduce(
        (sum, i) => sum + (i.habitualReferencePriceCop ?? 0) * (i.quantity ?? 1),
        0
      ),
    [basketItems]
  );

  const remoteDrafts = useMemo(
    () => baskets.filter((b) => b.status === "draft" || b.status === "optimized").slice(0, 3),
    [baskets]
  );

  const householdCode = credentials?.householdCode ?? "HOGAR-LOCAL";

  return (
    <dialog
      ref={dialogRef}
      className="hearth-dialog ms-v3-product-dialog"
      aria-labelledby="mis-mercados-title"
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
            <span className="ms-v3-kicker-tag">Mis mercados · {householdCode}</span>
            <h3 id="mis-mercados-title" className="hearth-sheet-title" style={{ marginTop: 3 }}>
              Tus mercados y favoritos guardados
            </h3>
            <p className="hearth-pref-line">
              Usa Conectar si deseas abrir este código en otro dispositivo.
            </p>
          </div>
          <button
            type="button"
            className="hearth-sheet-close"
            onClick={onClose}
            aria-label="Cerrar Mis mercados"
          >
            <HearthIcon name="close" size={18} />
          </button>
        </div>

        <div className="hearth-sheet-body">
          {/* Bloque 1: EN COMPRA AHORA */}
          <section className="ms-v4-market-active-card">
            <div className="ms-v3-row-between">
              <span className="ms-v4-live-badge">
                <span className="hearth-pill-dot green pulse" />
                <span>EN COMPRA AHORA</span>
              </span>
              <span className="hearth-step-counter tabular">
                {basketItems.length} {basketItems.length === 1 ? "producto" : "productos"}
              </span>
            </div>

            {basketItems.length > 0 ? (
              <>
                <div className="ms-v3-row-between" style={{ marginTop: 6 }}>
                  <strong className="hearth-item-name" style={{ fontSize: "0.94rem" }}>
                    Mercado semanal activo
                  </strong>
                  <strong className="tabular" style={{ color: "var(--h-primary)", fontSize: "0.95rem" }}>
                    {activePlan
                      ? formatCop(activePlan.totalNominalCost)
                      : habitualEstimatedTotal > 0
                        ? formatCop(habitualEstimatedTotal)
                        : "Por calcular"}
                  </strong>
                </div>

                {activePlan && activePlan.savingsVsBaselineCop > 0 && (
                  <p className="hearth-pref-line" style={{ color: "#166534", fontWeight: 700, marginTop: 2 }}>
                    Ahorras {formatCop(activePlan.savingsVsBaselineCop)} ({activePlan.savingsVsBaselinePct}%) ·{" "}
                    {activePlan.storeStops.map((s) => s.storeName).join(" + ")}
                  </p>
                )}

                <div className="hearth-chip-group" style={{ marginTop: 8 }}>
                  {basketItems.slice(0, 5).map((item) => (
                    <span key={item.itemKey} className="ms-v4-mini-tag-chip">
                      {item.quantity && item.quantity > 1 ? `${item.quantity}× ` : ""}
                      {item.label}
                    </span>
                  ))}
                  {basketItems.length > 5 && (
                    <span className="ms-v4-mini-tag-chip">+{basketItems.length - 5} más</span>
                  )}
                </div>

                <div className="ms-v3-footer-btn-group" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="hearth-btn-primary"
                    style={{ flex: 1, minHeight: 40 }}
                    onClick={() => {
                      onClose();
                      onOptimizeActive();
                    }}
                  >
                    <span>Optimizar compra →</span>
                  </button>
                  <button
                    type="button"
                    className="hearth-btn-secondary"
                    style={{ minHeight: 40 }}
                    onClick={() => {
                      onClose();
                      onContinueShopping();
                    }}
                  >
                    <span>Editar cesta</span>
                  </button>
                  {activePlan && (
                    <button
                      type="button"
                      className="hearth-btn-secondary"
                      style={{ minHeight: 40 }}
                      onClick={() => {
                        onClose();
                        onGoToRoute();
                      }}
                    >
                      <HearthIcon name="alt_route" size={14} />
                      <span>Modo tienda</span>
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div style={{ marginTop: 8 }}>
                <p className="hearth-pref-line">
                  Tu cesta activa está vacía. Crea un mercado por características, con tus marcas favoritas o desde un favorito.
                </p>
                <div className="ms-v3-footer-btn-group" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="hearth-btn-primary"
                    style={{ minHeight: 40 }}
                    onClick={() => {
                      onClose();
                      onLaunchMode("generic_guided");
                    }}
                  >
                    <span>+ Armar mercado genérico →</span>
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Bloque 2: MI MERCADO HABITUAL */}
          <section className="hearth-card">
            <div className="ms-v3-row-between">
              <span className="ms-v4-habitual-star-pill">★ MI MERCADO HABITUAL</span>
              <span className="hearth-pref-line tabular">
                {habitualItemsCount > 0 ? `${habitualItemsCount} marcas ancladas` : "Comparar contra tus marcas"}
              </span>
            </div>
            <p className="hearth-pref-line" style={{ marginTop: 6 }}>
              Guarda tus marcas de siempre para ver lado a lado si existe un equivalente más barato (incluso de la misma planta).
            </p>
            <div className="ms-v3-footer-btn-group" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="hearth-btn-secondary"
                style={{ flex: 1, minHeight: 38 }}
                onClick={() => {
                  onClose();
                  onLaunchMode("habitual_guided");
                }}
              >
                <HearthIcon name="storefront" size={14} />
                <span>Elegir mis marcas habituales</span>
              </button>
              <button
                type="button"
                className="hearth-edit-pref-btn"
                onClick={() => {
                  onClose();
                  onLaunchMode("generic_guided");
                }}
              >
                <span>+ Modo sin marcas</span>
              </button>
            </div>
          </section>

          {/* Bloque 3: MERCADOS FAVORITOS Y BORRADORES */}
          <section className="hearth-card">
            <div className="ms-v3-row-between" style={{ marginBottom: 8 }}>
              <span className="hearth-label">
                ⭐ Mercados Favoritos ({favorites.length}/{favoriteLimit})
              </span>
              <button
                type="button"
                className="hearth-link-text-btn"
                onClick={() => {
                  onClose();
                  onOpenFavoritesModal();
                }}
              >
                Gestionar / Guardar →
              </button>
            </div>

            {favorites.length === 0 ? (
              <div className="hearth-empty-subcard" style={{ padding: 10 }}>
                No has guardado favoritos rápidos aún. Toca Gestionar para guardar esta canasta (1 gratis · hasta 10 en Premium).
              </div>
            ) : (
              <div className="ms-v3-device-list">
                {favorites.map((fav) => (
                  <div key={fav.id} className="ms-v3-device-row">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong style={{ display: "block", fontSize: "0.81rem" }}>
                        {fav.title}
                      </strong>
                      <span className="hearth-pref-line tabular">
                        {fav.itemsCount} productos · {fav.storeSummary || "Optimizado"} ·{" "}
                        {formatCop(fav.estimatedTotalCop)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="hearth-btn-primary"
                      style={{ flex: "0 0 auto", minHeight: 34, padding: "6px 12px", fontSize: "0.75rem" }}
                      onClick={() => {
                        onLoadFavoriteQuick(fav);
                        onClose();
                      }}
                    >
                      Cargar →
                    </button>
                  </div>
                ))}
              </div>
            )}

            {remoteDrafts.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="hearth-pref-line" style={{ fontWeight: 700, marginBottom: 4 }}>
                  Guardados en {householdCode}:
                </div>
                <div className="ms-v3-device-list">
                  {remoteDrafts.map((bsk) => (
                    <div key={bsk.id} className="ms-v3-device-row">
                      <span>{bsk.title || "Canasta guardada"}</span>
                      <span className="hearth-step-counter tabular">
                        {bsk.items.length} ítems · {bsk.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="hearth-sheet-footer">
          <button
            type="button"
            className="hearth-btn-secondary"
            onClick={() => {
              onClose();
              onOpenDevicesModal();
            }}
          >
            <HearthIcon name="smartphone" size={15} />
            <span>Sync {householdCode}</span>
          </button>
          <button
            type="button"
            className="hearth-btn-primary"
            onClick={() => {
              onClose();
              onLaunchMode("free_shop");
            }}
          >
            <HearthIcon name="add_circle" size={16} />
            <span>+ Nuevo mercado</span>
          </button>
        </div>
      </div>
    </dialog>
  );
}
