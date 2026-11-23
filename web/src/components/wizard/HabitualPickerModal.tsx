"use client";

import { useEffect, useRef } from "react";

import HearthIcon from "@/components/HearthIcon";
import { copFormatter, OfferThumb, pumFormatter } from "@/components/wizard/types";
import type { GenericFoodOption, GuidedSubsection } from "@/lib/guidedCatalog";
import { cleanProductTitle } from "@/lib/productInsights";
import type { StoreOffer } from "@/lib/types";

export function HabitualPickerModal({
  sub,
  query,
  onChangeQuery,
  foodId,
  onChangeFoodId,
  baseOffersCount,
  foodChips,
  offers,
  selectedSku,
  onSelectSku,
  onConfirmAdd,
  onClose,
}: {
  sub: GuidedSubsection | null;
  query: string;
  onChangeQuery: (q: string) => void;
  foodId: string;
  onChangeFoodId: (id: string) => void;
  baseOffersCount: number;
  foodChips: Array<{ food: GenericFoodOption; count: number }>;
  offers: StoreOffer[];
  selectedSku: StoreOffer | null;
  onSelectSku: (offer: StoreOffer) => void;
  onConfirmAdd: (offer: StoreOffer, sub: GuidedSubsection) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (sub && !dialog.open) {
      dialog.showModal();
    } else if (!sub && dialog.open) {
      dialog.close();
    }
  }, [sub]);

  return (
    <dialog
      ref={dialogRef}
      className="hearth-dialog"
      aria-labelledby="habitual-picker-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {sub && (
        <div className="hearth-sheet">
          <div className="hearth-sheet-handle" aria-hidden="true" />
          <div className="hearth-sheet-header">
            <div>
              <div className="hearth-sheet-title-row">
                <span className="hearth-sheet-icon-box">
                  <HearthIcon name={sub.materialIcon} size={15} />
                </span>
                <h3 id="habitual-picker-title" className="hearth-sheet-title">
                  Agregar a {sub.label}
                </h3>
              </div>
              <div className="hearth-pref-line">
                Selecciona marca, presentación y precio real de tu zona
              </div>
            </div>
            <button
              type="button"
              className="hearth-sheet-close"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <HearthIcon name="close" size={18} />
            </button>
          </div>

          <div className="hearth-sheet-body">
            <div className="hearth-search-box">
              <span className="hearth-search-icon-left">
                <HearthIcon name="search" size={17} />
              </span>
              <input
                type="search"
                className="hearth-search-input"
                placeholder={`Buscar marca o tipo en ${sub.label}...`}
                value={query}
                onChange={(e) => onChangeQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="hearth-search-clear-btn"
                  onClick={() => onChangeQuery("")}
                  aria-label="Limpiar búsqueda"
                >
                  <HearthIcon name="cancel" size={15} />
                </button>
              )}
            </div>

            <div className="hearth-scroll-pills">
              <button
                type="button"
                className={`hearth-pill-filter ${foodId === "all" ? "active" : ""}`}
                onClick={() => onChangeFoodId("all")}
              >
                Todos ({baseOffersCount})
              </button>
              {foodChips.map(({ food, count }) => (
                <button
                  key={food.id}
                  type="button"
                  className={`hearth-pill-filter ${foodId === food.id ? "active" : ""}`}
                  onClick={() => onChangeFoodId(food.id)}
                >
                  {food.name.split(" ")[0]} ({count})
                </button>
              ))}
            </div>

            {offers.length === 0 ? (
              <div className="hearth-empty-subcard">
                No hay productos disponibles para este filtro. Prueba otra palabra clave.
              </div>
            ) : (
              offers.map((offer) => {
                const selected = selectedSku?.storeSkuId === offer.storeSkuId;
                const title = cleanProductTitle(offer.rawName);
                return (
                  <button
                    key={offer.storeSkuId}
                    type="button"
                    className={`hearth-sku-pick-card ${selected ? "selected" : ""}`}
                    onClick={() => onSelectSku(offer)}
                  >
                    <OfferThumb
                      imageUrl={offer.imageUrl}
                      alt={title}
                      fallbackIcon={sub.materialIcon}
                      sizeClass="sm"
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="hearth-sku-title-row">
                        <span className="hearth-sku-title">{title}</span>
                        {offer.brand && (
                          <span className="hearth-brand-pill">Marca {offer.brand}</span>
                        )}
                      </div>
                      <div className="hearth-pref-line tabular">
                        {offer.netContent} {offer.unitMeasure} · PUM{" "}
                        {pumFormatter.format(offer.pumPrice)}/{offer.unitMeasure}
                      </div>
                    </div>

                    <div className="hearth-pick-right">
                      <strong className="hearth-pick-price tabular">
                        {copFormatter.format(offer.calibratedPrice)}
                      </strong>
                      {selected ? (
                        <span className="hearth-pick-check">
                          <HearthIcon name="check" size={13} />
                        </span>
                      ) : (
                        <span className="hearth-pick-store">{offer.storeName}</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="hearth-sheet-footer">
            <button type="button" className="hearth-btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="hearth-btn-primary"
              disabled={!selectedSku}
              onClick={() => {
                if (!selectedSku || !sub) return;
                onConfirmAdd(selectedSku, sub);
              }}
            >
              <span>
                {selectedSku
                  ? `Agregar producto (${copFormatter.format(selectedSku.calibratedPrice)})`
                  : "Selecciona un producto"}
              </span>
              {selectedSku && <HearthIcon name="add" size={17} />}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
