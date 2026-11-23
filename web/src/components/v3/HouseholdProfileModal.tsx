"use client";

import { useEffect, useRef, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import { useWorkspace } from "@/components/v3/WorkspaceContext";
import { DIET_FILTER_CATALOG } from "@/lib/dietaryFilter";
import { formatCop } from "@/lib/formatters";
import { TRANSPORT_PROFILES } from "@/lib/transport";
import type {
  DietFilter,
  PaymentPartner,
  ShoppingCadence,
  TransportMode,
  UserPaymentMethod,
} from "@/lib/types";

const CADENCE_OPTIONS: Array<{ id: ShoppingCadence; label: string }> = [
  { id: "weekly", label: "Semanal" },
  { id: "biweekly", label: "Quincenal" },
  { id: "monthly", label: "Mensual" },
  { id: "daily", label: "Diaria / reposición" },
];

const FREQUENT_STORES = [
  { id: "d1", label: "Tiendas D1" },
  { id: "ara", label: "Tiendas Ara" },
  { id: "olimpica", label: "Olímpica" },
  { id: "exito", label: "Éxito" },
  { id: "carulla", label: "Carulla" },
  { id: "farmatodo", label: "Farmatodo" },
  { id: "euro", label: "Euro Supermercados" },
  { id: "oxxo", label: "OXXO" },
  { id: "mercaldas", label: "Mercaldas" },
  { id: "isimo", label: "Tiendas Ísimo" },
  { id: "zapatoca", label: "Supermercados Zapatoca" },
  { id: "makro", label: "Makro" },
];

const ONBOARDING_STEPS: Array<{ id: 1 | 2 | 3 | 4; label: string }> = [
  { id: 1, label: "1. Hogar" },
  { id: 2, label: "2. Dieta" },
  { id: 3, label: "3. Pagos" },
  { id: 4, label: "4. Tiendas" },
];

export function HouseholdProfileModal({
  open,
  paymentPartners = [],
  onTransportModeSaved,
  onClose,
}: {
  open: boolean;
  paymentPartners?: PaymentPartner[];
  onTransportModeSaved?: (mode: TransportMode) => void;
  onClose: () => void;
}) {
  const { userProfile, paymentMethods, saveProfileAndPayments } = useWorkspace();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | "all">("all");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [pets, setPets] = useState(0);
  const [cadence, setCadence] = useState<ShoppingCadence>("biweekly");
  const [monthlyBudgetCop, setMonthlyBudgetCop] = useState<number>(550000);
  const [manualBudgetInput, setManualBudgetInput] = useState<string>("550000");
  const [dietFilters, setDietFilters] = useState<DietFilter[]>([]);
  const [preferredStores, setPreferredStores] = useState<string[]>([]);
  const [selectedPartners, setSelectedPartners] = useState<string[]>([]);
  const [transportMode, setTransportMode] = useState<TransportMode>("walk");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAdults(userProfile?.householdAdults ?? 2);
    setChildren(userProfile?.householdChildren ?? 0);
    setPets(userProfile?.householdPets ?? 0);
    setCadence(userProfile?.shoppingCadence ?? "biweekly");
    const loadedBudget = userProfile?.monthlyBudgetCop ?? 550000;
    setMonthlyBudgetCop(loadedBudget);
    setManualBudgetInput(String(loadedBudget));
    setDietFilters(userProfile?.dietaryRestrictions ?? []);
    setPreferredStores(userProfile?.preferredStoreIds ?? []);
    setSelectedPartners(paymentMethods.map((m) => m.partnerId));
    setTransportMode(userProfile?.transportMode ?? "walk");
  }, [open, userProfile, paymentMethods]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function toggleItem<T extends string>(list: T[], val: T): T[] {
    return list.includes(val) ? list.filter((x) => x !== val) : [...list, val];
  }

  async function handleSave() {
    setSaving(true);
    const partnerMap = new Map(paymentPartners.map((p) => [p.id, p]));
    const methods: UserPaymentMethod[] = selectedPartners.map((pid) => ({
      partnerId: pid,
      productVariant: "Principal",
      partnerName: partnerMap.get(pid)?.name ?? pid,
      partnerType: partnerMap.get(pid)?.partnerType ?? "bank",
    }));

    await saveProfileAndPayments({
      profile: {
        householdAdults: adults,
        householdChildren: children,
        householdPets: pets,
        shoppingCadence: cadence,
        monthlyBudgetCop,
        weeklyBudgetCop: Math.round(monthlyBudgetCop / 4.33),
        dietaryRestrictions: dietFilters,
        preferredStoreIds: preferredStores,
        transportMode,
        onboardingCompletedAt: new Date().toISOString(),
      },
      paymentMethods: methods,
    });
    onTransportModeSaved?.(transportMode);
    setSaving(false);
    onClose();
  }

  const catalogPartners =
    paymentPartners.length > 0
      ? paymentPartners
      : [
          { id: "bancolombia", name: "Bancolombia", partnerType: "bank" as const },
          { id: "davivienda", name: "Davivienda", partnerType: "bank" as const },
          { id: "nu", name: "Nu Colombia", partnerType: "bank" as const },
          { id: "rappicard", name: "RappiCard", partnerType: "bank" as const },
          { id: "nequi", name: "Nequi", partnerType: "wallet" as const },
          { id: "tarjeta_exito", name: "Tarjeta Éxito / Tuya", partnerType: "store_card" as const },
          { id: "compensar", name: "Caja Compensar", partnerType: "caja_compensacion" as const },
          { id: "colsubsidio", name: "Caja Colsubsidio", partnerType: "caja_compensacion" as const },
          { id: "comfama", name: "Caja Comfama", partnerType: "caja_compensacion" as const },
        ];

  const showStep = (s: 1 | 2 | 3 | 4) => step === "all" || step === s;

  return (
    <dialog
      ref={dialogRef}
      className="hearth-dialog"
      aria-labelledby="household-profile-title"
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
            <span className="ms-v3-kicker-tag">Onboarding en 4 pasos · Sin registro</span>
            <h3 id="household-profile-title" className="hearth-sheet-title" style={{ marginTop: 3 }}>
              Perfil de Mi Hogar
            </h3>
            <p className="hearth-pref-line">
              Usamos estos datos opcionales para sugerir tamaños, presupuesto y días de descuento.
            </p>
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

        {/* Barra de 4 pasos de Onboarding (Stitch 17) */}
        <div className="ms-v4-household-steps-bar" role="tablist" aria-label="Pasos de perfil de hogar">
          {ONBOARDING_STEPS.map((st) => (
            <button
              key={st.id}
              type="button"
              role="tab"
              aria-selected={step === st.id}
              className={`ms-v4-step-pill ${step === st.id ? "active" : ""}`}
              onClick={() => setStep(st.id)}
            >
              {st.label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={step === "all"}
            className={`ms-v4-step-pill ${step === "all" ? "active" : ""}`}
            onClick={() => setStep("all")}
          >
            Ver todo
          </button>
        </div>

        <div className="hearth-sheet-body">
          {/* Paso 1: Integrantes, presupuesto y frecuencia */}
          {showStep(1) && (
            <>
              <section className="hearth-card">
                <h4 className="hearth-label" style={{ marginBottom: 8 }}>
                  1. Integrantes y frecuencia de compra
                </h4>
                <div className="ms-v3-household-counters">
                  <div className="ms-v3-counter-box">
                    <span>Adultos</span>
                    <div className="hearth-qty-stepper">
                      <button
                        type="button"
                        className="hearth-qty-btn"
                        aria-label="Disminuir adultos"
                        onClick={() => setAdults((v) => Math.max(1, v - 1))}
                      >
                        <HearthIcon name="remove" size={12} />
                      </button>
                      <strong className="tabular">{adults}</strong>
                      <button
                        type="button"
                        className="hearth-qty-btn"
                        aria-label="Aumentar adultos"
                        onClick={() => setAdults((v) => Math.min(10, v + 1))}
                      >
                        <HearthIcon name="add" size={12} />
                      </button>
                    </div>
                  </div>

                  <div className="ms-v3-counter-box">
                    <span>Niños / jóvenes</span>
                    <div className="hearth-qty-stepper">
                      <button
                        type="button"
                        className="hearth-qty-btn"
                        aria-label="Disminuir niños"
                        onClick={() => setChildren((v) => Math.max(0, v - 1))}
                      >
                        <HearthIcon name="remove" size={12} />
                      </button>
                      <strong className="tabular">{children}</strong>
                      <button
                        type="button"
                        className="hearth-qty-btn"
                        aria-label="Aumentar niños"
                        onClick={() => setChildren((v) => Math.min(10, v + 1))}
                      >
                        <HearthIcon name="add" size={12} />
                      </button>
                    </div>
                  </div>

                  <div className="ms-v3-counter-box" style={{ gridColumn: "1 / -1" }}>
                    <span>Mascotas (para sugerir concentrados)</span>
                    <div className="hearth-qty-stepper">
                      <button
                        type="button"
                        className="hearth-qty-btn"
                        aria-label="Disminuir mascotas"
                        onClick={() => setPets((v) => Math.max(0, v - 1))}
                      >
                        <HearthIcon name="remove" size={12} />
                      </button>
                      <strong className="tabular">{pets}</strong>
                      <button
                        type="button"
                        className="hearth-qty-btn"
                        aria-label="Aumentar mascotas"
                        onClick={() => setPets((v) => Math.min(6, v + 1))}
                      >
                        <HearthIcon name="add" size={12} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="hearth-chip-group" style={{ marginTop: 10 }}>
                  {CADENCE_OPTIONS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`hearth-chip ${cadence === c.id ? "active" : ""}`}
                      onClick={() => setCadence(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="hearth-card hearth-slider-wrap">
                <div className="hearth-slider-header">
                  <label htmlFor="household-budget-range" className="hearth-q-label">
                    <span>Gasto / presupuesto mensual habitual</span>
                  </label>
                  <strong className="hearth-slider-value tabular">
                    {formatCop(monthlyBudgetCop)}
                  </strong>
                </div>
                <input
                  id="household-budget-range"
                  type="range"
                  className="hearth-range"
                  min={150000}
                  max={2500000}
                  step={50000}
                  value={Math.min(2500000, Math.max(150000, monthlyBudgetCop))}
                  onChange={(e) => {
                    const nextVal = Number(e.target.value);
                    setMonthlyBudgetCop(nextVal);
                    setManualBudgetInput(String(nextVal));
                  }}
                />
                <div className="hearth-slider-scale tabular">
                  <span>$150.000</span>
                  <span>Saltos de $50.000</span>
                  <span>$2.500.000</span>
                </div>

                <div className="ms-v4-manual-budget-row">
                  <label htmlFor="household-budget-manual" className="hearth-label">
                    O escribe / pega tu presupuesto exacto (hasta $9&apos;999.999)
                  </label>
                  <div className="ms-v4-manual-budget-input-wrap">
                    <span className="ms-v4-currency-prefix" aria-hidden="true">
                      $
                    </span>
                    <input
                      id="household-budget-manual"
                      type="text"
                      inputMode="numeric"
                      className="hearth-input tabular"
                      placeholder="Ej: 1800000"
                      maxLength={12}
                      value={manualBudgetInput}
                      onChange={(e) => {
                        const digitsOnly = e.target.value.replace(/\D/g, "");
                        if (!digitsOnly) {
                          setManualBudgetInput("");
                          return;
                        }
                        const clamped = Math.min(9999999, Number(digitsOnly));
                        setManualBudgetInput(String(clamped));
                        setMonthlyBudgetCop(clamped);
                      }}
                      onBlur={() => {
                        if (!manualBudgetInput) {
                          setManualBudgetInput(String(monthlyBudgetCop));
                        }
                      }}
                    />
                  </div>
                </div>
              </section>
            </>
          )}

          {/* Paso 2: Restricciones alimentarias por defecto */}
          {showStep(2) && (
            <section className="hearth-card">
              <h4 className="hearth-label" style={{ marginBottom: 6 }}>
                2. Restricciones alimentarias predeterminadas
              </h4>
              <p className="hearth-pref-line" style={{ marginBottom: 8 }}>
                Vienen activas por defecto en tu canasta para no elegirlas cada vez (reversibles en 1 toque).
              </p>
              <div className="hearth-chip-group">
                {(Object.keys(DIET_FILTER_CATALOG) as DietFilter[]).map((key) => {
                  const active = dietFilters.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`hearth-chip ${active ? "active" : ""}`}
                      onClick={() => setDietFilters((prev) => toggleItem(prev, key))}
                    >
                      {active ? "✓ " : ""}
                      {DIET_FILTER_CATALOG[key].label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Paso 3: Bancos, billeteras y cajas de compensación */}
          {showStep(3) && (
            <section className="hearth-card">
              <h4 className="hearth-label" style={{ marginBottom: 6 }}>
                3. Bancos, billeteras y cajas de compensación
              </h4>
              <p className="hearth-pref-line" style={{ marginBottom: 8 }}>
                Cruzamos tus tarjetas con días de descuento en supermercados sin pedir números ni credenciales.
              </p>
              <div className="hearth-chip-group">
                {catalogPartners.map((partner) => (
                  <button
                    key={partner.id}
                    type="button"
                    className={`hearth-chip ${selectedPartners.includes(partner.id) ? "active" : ""}`}
                    onClick={() => setSelectedPartners((prev) => toggleItem(prev, partner.id))}
                  >
                    {selectedPartners.includes(partner.id) ? "✓ " : ""}
                    {partner.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Paso 4: Supermercados frecuentes y medio de transporte */}
          {showStep(4) && (
            <section className="hearth-card">
              <h4 className="hearth-label" style={{ marginBottom: 6 }}>
                4. Supermercados frecuentes y traslado
              </h4>
              <p className="hearth-pref-line" style={{ marginBottom: 8 }}>
                Personaliza qué cadenas frecuentas y cómo te mueves habitualmente.
              </p>
              <div className="hearth-chip-group" style={{ marginBottom: 10 }}>
                {FREQUENT_STORES.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    className={`hearth-chip ${preferredStores.includes(st.id) ? "active" : ""}`}
                    onClick={() => setPreferredStores((prev) => toggleItem(prev, st.id))}
                  >
                    {preferredStores.includes(st.id) ? "✓ " : ""}
                    {st.label}
                  </button>
                ))}
              </div>

              <div className="hearth-label" style={{ marginBottom: 6 }}>
                Transporte habitual
              </div>
              <div className="ms-v3-transport-pills">
                {(Object.keys(TRANSPORT_PROFILES) as TransportMode[]).map((tKey) => {
                  const prof = TRANSPORT_PROFILES[tKey];
                  return (
                    <button
                      key={tKey}
                      type="button"
                      className={`ms-v3-transport-pill ${transportMode === tKey ? "active" : ""}`}
                      onClick={() => setTransportMode(tKey)}
                    >
                      {prof.emoji} {prof.shortLabel}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <div className="hearth-sheet-footer">
          {typeof step === "number" && step < 4 ? (
            <>
              <button
                type="button"
                className="hearth-btn-secondary"
                onClick={() => void handleSave()}
              >
                <span>Guardar ya</span>
              </button>
              <button
                type="button"
                className="hearth-btn-primary"
                onClick={() => setStep((s) => (typeof s === "number" && s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : 4))}
              >
                <span>Siguiente paso ({step + 1}/4) →</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" className="hearth-btn-secondary" onClick={onClose}>
                Omitir por ahora
              </button>
              <button
                type="button"
                className="hearth-btn-primary"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                <span>{saving ? "Guardando..." : "Guardar perfil del hogar"}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
