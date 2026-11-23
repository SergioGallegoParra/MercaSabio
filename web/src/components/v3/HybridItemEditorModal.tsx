"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import { PumHelpTrigger as PumHelpButton } from "@/components/parallel/ParallelPrimitives";
import { QUALITY_TIERS, SIZE_OPTIONS } from "@/components/wizard/types";
import type { BasketItemInput } from "@/lib/basketOptimizer";
import { GUIDED_SECTIONS, type GenericFoodOption } from "@/lib/guidedCatalog";
import type { QualityTier } from "@/lib/types";

export function HybridItemEditorModal({
  item,
  onClose,
  onSave,
}: {
  item: BasketItemInput | null;
  onClose: () => void;
  onSave: (itemKey: string, nextItem: BasketItemInput) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [mode, setMode] = useState<"generic" | "specific">("generic");
  const [qualityTiers, setQualityTiers] = useState<QualityTier[]>(["economico", "estandar"]);
  const [sizePref, setSizePref] = useState<"any" | "small" | "medium" | "large">("any");
  const [pricePriority, setPricePriority] = useState<"lowest_pum" | "lowest_total">("lowest_pum");
  const [subtypeFamily, setSubtypeFamily] = useState<string>("");
  const [criticalAttr, setCriticalAttr] = useState<string | null>(null);
  const [allowSubstitutes, setAllowSubstitutes] = useState<boolean>(true);
  const [locked, setLocked] = useState<boolean>(false);

  const catalogFood = useMemo<GenericFoodOption | null>(() => {
    if (!item) return null;
    for (const sec of GUIDED_SECTIONS) {
      for (const sub of sec.subsections) {
        const found = sub.foods.find(
          (f) =>
            item.itemKey.includes(f.id) ||
            (item.broadFamily && f.broadFamily === item.broadFamily) ||
            f.variants.some((v) => v.subtypeFamily === item.subtypeFamily)
        );
        if (found) return found;
      }
    }
    return null;
  }, [item]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (item && !dialog.open) {
      const hasBrandAnchor = Boolean(item.anchorStoreSkuId || item.anchorBrand);
      setMode(hasBrandAnchor ? "specific" : "generic");
      setQualityTiers(
        item.allowedQualityTiers?.length
          ? item.allowedQualityTiers
          : ["economico", "estandar"]
      );
      setSizePref(item.sizePreference ?? "any");
      setPricePriority(item.pricePriority ?? "lowest_pum");
      setSubtypeFamily(item.subtypeFamily ?? "");
      setCriticalAttr(item.requiredCriticalAttribute ?? null);
      setAllowSubstitutes(item.allowSubstitutes !== false);
      setLocked(Boolean(item.locked));
      dialog.showModal();
    } else if (!item && dialog.open) {
      dialog.close();
    }
  }, [item]);

  function handleToggleTier(tier: QualityTier) {
    setQualityTiers((prev) => {
      if (prev.includes(tier)) {
        const next = prev.filter((t) => t !== tier);
        return next.length > 0 ? next : prev;
      }
      return [...prev, tier];
    });
  }

  function handleSubmit() {
    if (!item) return;
    if (mode === "generic") {
      onSave(item.itemKey, {
        ...item,
        subtypeFamily: subtypeFamily || item.subtypeFamily,
        requiredCriticalAttribute: criticalAttr,
        allowedQualityTiers: qualityTiers,
        sizePreference: sizePref,
        pricePriority,
        allowSubstitutes: true,
        locked: false,
        anchorStoreSkuId: null,
        anchorBrand: null,
      });
    } else {
      onSave(item.itemKey, {
        ...item,
        allowedQualityTiers: qualityTiers,
        sizePreference: sizePref,
        pricePriority,
        allowSubstitutes,
        locked,
      });
    }
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="hearth-dialog ms-v3-product-dialog"
      aria-labelledby="hybrid-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {item && (
        <div className="hearth-sheet ms-v3-product-sheet">
          <div className="hearth-sheet-handle" aria-hidden="true" />
          <div className="hearth-sheet-header">
            <div>
              <span className="ms-v3-kicker-tag">Regla individual del producto</span>
              <h3 id="hybrid-editor-title" className="hearth-sheet-title">
                {item.label}
              </h3>
              <p className="hearth-pref-line">
                Combina productos por características (sin marca) y marcas fijas dentro del mismo mercado.
              </p>
            </div>
            <button
              type="button"
              className="hearth-sheet-close"
              onClick={onClose}
              aria-label="Cerrar editor de producto"
            >
              <HearthIcon name="close" size={18} />
            </button>
          </div>

          <div className="hearth-sheet-body">
            {/* Switch entre Sin marca (por características) vs Marca específica */}
            <div className="ms-v4-mode-segment" role="tablist" aria-label="Estrategia del producto">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "generic"}
                className={`ms-v4-mode-seg-btn ${mode === "generic" ? "active" : ""}`}
                onClick={() => setMode("generic")}
              >
                <HearthIcon name="tune" size={15} />
                <div>
                  <strong>Por características</strong>
                  <span>Sin marca fija · menor PUM</span>
                </div>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={mode === "specific"}
                className={`ms-v4-mode-seg-btn ${mode === "specific" ? "active" : ""}`}
                onClick={() => setMode("specific")}
              >
                <HearthIcon name="lock" size={15} />
                <div>
                  <strong>Marca específica</strong>
                  <span>Comparar similar o fijar</span>
                </div>
              </button>
            </div>

            {mode === "generic" ? (
              <>
                {catalogFood && catalogFood.variants.length > 1 && (
                  <section className="hearth-card" style={{ padding: 12 }}>
                    <div className="hearth-label" style={{ marginBottom: 6 }}>
                      Tipo / Atributo obligatorio
                    </div>
                    <div className="hearth-chip-group">
                      {catalogFood.variants.map((variant) => {
                        const active =
                          subtypeFamily === variant.subtypeFamily &&
                          (variant.criticalAttribute ?? null) === (criticalAttr ?? null);
                        return (
                          <button
                            key={variant.id}
                            type="button"
                            className={`hearth-chip ${active ? "active" : ""}`}
                            onClick={() => {
                              setSubtypeFamily(variant.subtypeFamily);
                              setCriticalAttr(variant.criticalAttribute ?? null);
                            }}
                          >
                            {variant.label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="hearth-card" style={{ padding: 12 }}>
                  <div className="hearth-label" style={{ marginBottom: 6 }}>
                    Gama aceptada (sin sesgo de marca)
                  </div>
                  <div className="hearth-chip-group">
                    {QUALITY_TIERS.map((tier) => (
                      <button
                        key={tier.id}
                        type="button"
                        className={`hearth-chip ${qualityTiers.includes(tier.id) ? "active" : ""}`}
                        onClick={() => handleToggleTier(tier.id)}
                      >
                        {tier.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="hearth-card" style={{ padding: 12 }}>
                  <div className="hearth-label" style={{ marginBottom: 6 }}>
                    Presentación y tamaño (ej. paquete ×6 o familiar)
                  </div>
                  <div className="hearth-chip-group">
                    {SIZE_OPTIONS.map((sz) => (
                      <button
                        key={sz.id}
                        type="button"
                        className={`hearth-chip ${sizePref === sz.id ? "active" : ""}`}
                        onClick={() => setSizePref(sz.id)}
                      >
                        {sz.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="hearth-card" style={{ padding: 12 }}>
                  <div className="ms-v3-row-between" style={{ marginBottom: 6 }}>
                    <span className="hearth-label">Criterio de prioridad</span>
                    <PumHelpButton variant="pill" label="¿Qué es PUM?" />
                  </div>
                  <div className="hearth-chip-group">
                    <button
                      type="button"
                      className={`hearth-chip ${pricePriority === "lowest_pum" ? "active" : ""}`}
                      onClick={() => setPricePriority("lowest_pum")}
                    >
                      Menor PUM ($/g, $/ml)
                    </button>
                    <button
                      type="button"
                      className={`hearth-chip ${pricePriority === "lowest_total" ? "active" : ""}`}
                      onClick={() => setPricePriority("lowest_total")}
                    >
                      Menor precio total
                    </button>
                  </div>
                </section>
              </>
            ) : (
              <section className="hearth-card" style={{ padding: 14 }}>
                <div className="hearth-label" style={{ marginBottom: 6 }}>
                  {item.anchorBrand
                    ? `Marca actual: ${item.anchorBrand}`
                    : "Producto específico seleccionado"}
                </div>
                <p className="hearth-pref-line" style={{ marginBottom: 10 }}>
                  Elige si quieres ver opciones equivalentes más baratas lado a lado o proteger este producto para que nunca cambie.
                </p>

                <div className="hearth-chip-group" style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className={`hearth-chip ${allowSubstitutes && !locked ? "active" : ""}`}
                    onClick={() => {
                      setAllowSubstitutes(true);
                      setLocked(false);
                    }}
                  >
                    Comparar equivalentes más baratos
                  </button>
                  <button
                    type="button"
                    className={`hearth-chip ${locked || !allowSubstitutes ? "active" : ""}`}
                    onClick={() => {
                      setAllowSubstitutes(false);
                      setLocked(true);
                    }}
                  >
                    🔒 Marca fija (no sustituir)
                  </button>
                </div>
              </section>
            )}
          </div>

          <div className="hearth-sheet-footer">
            <button type="button" className="hearth-btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="hearth-btn-primary" onClick={handleSubmit}>
              <HearthIcon name="check" size={16} />
              <span>Guardar regla en canasta</span>
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
