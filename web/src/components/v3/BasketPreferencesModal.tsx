"use client";

import { useEffect, useRef } from "react";

import HearthIcon from "@/components/HearthIcon";
import type { BasketItemInput } from "@/lib/basketOptimizer";
import { DIET_FILTER_CATALOG } from "@/lib/dietaryFilter";
import type { DietFilter } from "@/lib/types";

export function BasketPreferencesModal({
  open,
  onClose,
  basketItems,
  activeDietFilters,
  onToggleDietFilter,
  onSaveAsDefaultDietFilters,
  dietSavedNotice = false,
  onToggleLockItem,
  minSabioIndex,
  onChangeMinSabioIndex,
  onOpenBudgetOptimizer,
}: {
  open: boolean;
  onClose: () => void;
  basketItems: BasketItemInput[];
  activeDietFilters: DietFilter[];
  onToggleDietFilter: (filter: DietFilter) => void;
  onSaveAsDefaultDietFilters?: () => void;
  dietSavedNotice?: boolean;
  onToggleLockItem: (itemKey: string) => void;
  minSabioIndex: number;
  onChangeMinSabioIndex: (minIndex: number) => void;
  onOpenBudgetOptimizer?: () => void;
}) {
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

  const lockedCount = basketItems.filter((i) => i.locked).length;

  return (
    <dialog
      ref={dialogRef}
      className="hearth-dialog ms-v3-product-dialog"
      aria-labelledby="basket-prefs-modal-title"
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
            <span className="ms-v3-kicker-tag">Preferencias de esta Canasta</span>
            <h3 id="basket-prefs-modal-title" className="hearth-sheet-title" style={{ marginTop: 3 }}>
              Reglas de dieta, candados y Sabiómetro
            </h3>
            <p className="hearth-pref-line">
              Se aplican en tiempo real a tu mercado actual ({basketItems.length} productos).
            </p>
          </div>
          <button
            type="button"
            className="hearth-sheet-close"
            onClick={onClose}
            aria-label="Cerrar preferencias de canasta"
          >
            <HearthIcon name="close" size={18} />
          </button>
        </div>

        <div className="hearth-sheet-body">
          {/* 1. Filtros alimentarios temporales o predeterminados */}
          <section className="hearth-card">
            <div className="ms-v3-row-between" style={{ marginBottom: 8 }}>
              <span className="hearth-label">1. Filtros alimentarios para este mercado</span>
              {onSaveAsDefaultDietFilters && (
                <button
                  type="button"
                  className="hearth-link-text-btn"
                  onClick={onSaveAsDefaultDietFilters}
                >
                  {dietSavedNotice ? "✓ Guardado en hogar" : "Guardar por defecto"}
                </button>
              )}
            </div>
            <div className="hearth-chip-group">
              {(Object.keys(DIET_FILTER_CATALOG) as DietFilter[]).map((key) => {
                const active = activeDietFilters.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    className={`ms-v3-diet-pill ${active ? "active" : ""}`}
                    onClick={() => onToggleDietFilter(key)}
                  >
                    {active ? "✓ " : "+ "}
                    {DIET_FILTER_CATALOG[key].label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Umbral mínimo del Sabiómetro */}
          <section className="hearth-card">
            <span className="hearth-label" style={{ display: "block", marginBottom: 8 }}>
              2. Umbral mínimo en Sabiómetro
            </span>
            <div className="ms-v3-sabio-filter-row" role="radiogroup" aria-label="Umbral mínimo de Sabiómetro">
              {[
                { val: 0, label: "Todos (0+)", desc: "Incluye nuevos sin votos" },
                { val: 60, label: "60+ Aceptable", desc: "Descarta rechazos graves" },
                { val: 75, label: "75+ Compra segura ⭐", desc: "Solo favoritos validados" },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  role="radio"
                  aria-checked={minSabioIndex === opt.val}
                  className={`ms-v3-mini-pill ${minSabioIndex === opt.val ? "active" : ""}`}
                  style={{ padding: "7px 12px" }}
                  onClick={() => onChangeMinSabioIndex(opt.val)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* 3. Candados por producto */}
          <section className="hearth-card">
            <div className="ms-v3-row-between" style={{ marginBottom: 8 }}>
              <span className="hearth-label">
                3. Productos bloqueados con candado ({lockedCount}/{basketItems.length})
              </span>
              {onOpenBudgetOptimizer && (
                <button
                  type="button"
                  className="hearth-link-text-btn"
                  onClick={() => {
                    onClose();
                    onOpenBudgetOptimizer();
                  }}
                >
                  Ajustar presupuesto 🔒 →
                </button>
              )}
            </div>

            {basketItems.length === 0 ? (
              <div className="hearth-empty-subcard" style={{ padding: 10 }}>
                Agrega productos a tu canasta para bloquear marcas específicas que no quieres cambiar.
              </div>
            ) : (
              <div className="ms-v3-lock-tile-grid">
                {basketItems.map((item) => {
                  const locked = Boolean(item.locked);
                  return (
                    <button
                      key={item.itemKey}
                      type="button"
                      className={`ms-v3-lock-mini-card ${locked ? "locked" : ""}`}
                      aria-pressed={locked}
                      onClick={() => onToggleLockItem(item.itemKey)}
                    >
                      <span className="ms-v3-lock-mini-name">
                        {item.quantity && item.quantity > 1 ? `${item.quantity}× ` : ""}
                        {item.label}
                      </span>
                      <span className="ms-v3-lock-badge">
                        <HearthIcon name={locked ? "lock" : "lock_open"} size={13} />
                        <span>{locked ? "Fijo" : "Libre"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="hearth-sheet-footer">
          <button type="button" className="hearth-btn-primary" onClick={onClose}>
            <HearthIcon name="check" size={16} />
            <span>Aplicar a esta canasta ({basketItems.length} productos)</span>
          </button>
        </div>
      </div>
    </dialog>
  );
}
