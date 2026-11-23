"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import HearthIcon, { type HearthIconName } from "@/components/HearthIcon";
import { formatCop } from "@/lib/formatters";
import { evaluateSamePlantMatch, type SamePlantIndex } from "@/lib/samePlant";
import type {
  PackTrapFinding,
  SabiometroSummary,
  StoreOffer,
  StorePromoDay,
} from "@/lib/types";

export const STORE_META: Record<string, { short: string; bg: string; fg: string }> = {
  d1: { short: "D1", bg: "#fef2f2", fg: "#b91c1c" },
  exito: { short: "ÉX", bg: "#fef9c3", fg: "#854d0e" },
  carulla: { short: "CA", bg: "#ecfdf5", fg: "#166534" },
  olimpica: { short: "OL", bg: "#fff7ed", fg: "#9a3412" },
  ara: { short: "AR", bg: "#ffedd5", fg: "#c2410c" },
  farmatodo: { short: "FT", bg: "#eff6ff", fg: "#1d4ed8" },
  euro: { short: "EU", bg: "#fefce8", fg: "#854d0e" },
  oxxo: { short: "OX", bg: "#fef2f2", fg: "#991b1b" },
  mercaldas: { short: "MC", bg: "#f0fdf4", fg: "#15803d" },
  isimo: { short: "ÍS", bg: "#fdf2f8", fg: "#9d174d" },
  zapatoca: { short: "ZP", bg: "#ecfeff", fg: "#0e7490" },
  makro: { short: "MK", bg: "#eef2ff", fg: "#3730a3" },
  alkosto: { short: "AL", bg: "#fff1f2", fg: "#9f1239" },
  ktronix: { short: "KT", bg: "#eff6ff", fg: "#1d4ed8" },
  jumbo: { short: "JU", bg: "#f0fdf4", fg: "#15803d" },
};

export function StoreBadge({ storeId, storeName }: { storeId: string; storeName: string }) {
  const meta = STORE_META[storeId.toLowerCase()] ?? {
    short: storeName.slice(0, 2).toUpperCase(),
    bg: "#f3ede2",
    fg: "#162019",
  };
  return (
    <span className="ms2-store-pill">
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          borderRadius: 6,
          background: meta.bg,
          color: meta.fg,
          fontSize: "0.68rem",
          fontWeight: 800,
        }}
        aria-hidden="true"
      >
        {meta.short}
      </span>
      <span>{storeName}</span>
    </span>
  );
}

/**
 * Product image with referrerPolicy="no-referrer" and resilient fallback
 * so cross-origin VTEX images blocked by ORB/CORB never show broken image icons.
 */
export function SmartProductImage({
  src,
  alt,
  fallbackIcon = "inventory_2",
  size = 64,
}: {
  src?: string | null;
  alt: string;
  fallbackIcon?: HearthIconName;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ms2-ink-muted)",
        }}
        aria-hidden="true"
      >
        <HearthIcon name={fallbackIcon} size={Math.max(22, Math.round(size * 0.45))} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        padding: 4,
      }}
    />
  );
}

/**
 * Accessible native <dialog> modal following Modern Web Guidance:
 * - No redundant role="dialog" or aria-modal
 * - Pointerdown + pointerup outside check for safe light-dismiss
 * - Browser-native Escape + focus restoration
 */
export function ParallelDialog({
  open,
  titleId,
  title,
  kicker,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  titleId: string;
  title: string;
  kicker?: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedOutsideRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function isOutside(e: React.PointerEvent<HTMLDialogElement>, dialog: HTMLDialogElement) {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  }

  return (
    <dialog
      ref={dialogRef}
      className="hearth-dialog ms2-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(e) => {
        const dialog = dialogRef.current;
        pressedOutsideRef.current = Boolean(dialog && isOutside(e, dialog));
      }}
      onPointerUp={(e) => {
        const dialog = dialogRef.current;
        if (pressedOutsideRef.current && dialog && isOutside(e, dialog)) {
          onClose();
        }
        pressedOutsideRef.current = false;
      }}
    >
      {open && (
        <div className="hearth-sheet" style={{ width: "100%", maxWidth: "100%" }}>
          <div className="hearth-sheet-handle" aria-hidden="true" />
          <div className="hearth-sheet-header">
            <div style={{ minWidth: 0, flex: 1 }}>
              {kicker && <span className="ms2-badge green">{kicker}</span>}
              <h2
                id={titleId}
                tabIndex={-1}
                autoFocus
                className="hearth-sheet-title"
                style={{ marginTop: kicker ? 6 : 0, outline: "none" }}
              >
                {title}
              </h2>
              {subtitle && (
                <p className="ms2-muted" style={{ margin: "3px 0 0" }}>
                  {subtitle}
                </p>
              )}
            </div>
            <button
              type="button"
              className="ms2-icon-btn"
              onClick={onClose}
              aria-label={`Cerrar ${title}`}
            >
              <HearthIcon name="close" size={18} />
            </button>
          </div>

          <div className="hearth-sheet-body">{children}</div>

          {footer && <div className="hearth-sheet-footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function PumHelpTrigger({
  variant = "icon",
  label = "¿Qué es el PUM?",
}: {
  variant?: "icon" | "pill";
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={variant === "pill" ? "ms2-btn ms2-btn-soft ms2-btn-sm" : "ms2-help-q"}
        aria-label="¿Qué es el precio por kilo o litro (PUM)?"
        title="Ver ejemplo claro de cómo funciona el PUM"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <span>?</span>
        {variant === "pill" && <span>{label}</span>}
      </button>

      <ParallelDialog
        open={open}
        titleId="ms2-pum-help-title"
        kicker="Normativa SIC Colombia"
        title="¿Qué es el PUM? (Precio por Unidad de Medida)"
        onClose={() => setOpen(false)}
        footer={
          <button
            type="button"
            className="ms2-btn ms2-btn-primary"
            style={{ width: "100%" }}
            onClick={() => setOpen(false)}
          >
            <HearthIcon name="check" size={16} />
            <span>Entendido</span>
          </button>
        }
      >
        <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--ms2-ink)" }}>
          El <strong>PUM</strong> es lo que pagas realmente por cada{" "}
          <strong>gramo (g), mililitro (ml) o unidad (und)</strong>. Sirve para comparar tamaños
          distintos sin dejarte confundir por el precio total de la etiqueta.
        </p>

        <div className="ms2-card" style={{ background: "var(--ms2-bg)", padding: 14 }}>
          <strong style={{ display: "block", marginBottom: 8, fontSize: "0.86rem" }}>
            Ejemplo real: 900 ml vs 1.000 ml
          </strong>
          <div className="ms2-list-stack">
            <div className="ms2-row-between">
              <span>Leche A · 900 ml ($6.900)</span>
              <span className="ms2-badge warn ms2-num">$7,67 / ml</span>
            </div>
            <div className="ms2-row-between">
              <strong>Leche B · 1.000 ml ($7.300)</strong>
              <span className="ms2-badge green ms2-num">$7,30 / ml · Más económica</span>
            </div>
          </div>
          <p className="ms2-muted" style={{ margin: "8px 0 0" }}>
            Aunque la bolsa B cuesta $400 más en caja, te da 11% más leche y ahorras $370 por litro real.
          </p>
        </div>
      </ParallelDialog>
    </>
  );
}

export function SabiometroBadge({ summary }: { summary?: SabiometroSummary | null }) {
  if (!summary || (summary.voteMass <= 0 && summary.votesCount <= 0) || summary.valueIndex == null) {
    return <span className="ms2-badge neutral">Sin calificaciones aún</span>;
  }
  const score = Math.round(summary.valueIndex);
  const tone = score >= 75 ? "green" : score >= 55 ? "gold" : "warn";
  return (
    <span className={`ms2-badge ${tone} ms2-num`} title="Calificación real de calidad y rendimiento">
      <HearthIcon name="verified" size={13} />
      <span>Calificación real {score}/100</span>
    </span>
  );
}

export function SamePlantBadge({
  offer,
  baselineOffer,
  samePlantIndex,
}: {
  offer: StoreOffer;
  baselineOffer?: StoreOffer | null;
  samePlantIndex?: SamePlantIndex;
}) {
  const match = evaluateSamePlantMatch({
    anchorOffer: baselineOffer ?? null,
    recommendedOffer: offer,
    sameFamily: true,
    samePlantIndex,
  });
  if (!match) return null;
  return (
    <span className="ms2-badge green" title={match.explanationText}>
      <HearthIcon name="eco" size={13} />
      <span>Misma planta verificada</span>
    </span>
  );
}

export function PackTrapAlert({ warning }: { warning?: PackTrapFinding | null }) {
  if (!warning) return null;
  return (
    <div
      className="ms2-card"
      style={{
        background: "var(--ms2-warn-soft)",
        borderColor: "#e6be7a",
        padding: "10px 12px",
      }}
      role="status"
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <HearthIcon name="report_problem" size={16} />
        <div style={{ fontSize: "0.82rem", color: "var(--ms2-warn)" }}>
          <strong>¡Ojo con el empaque grande!</strong> {warning.message}
        </div>
      </div>
    </div>
  );
}

export function pickPromoForToday(storePromoDays: StorePromoDay[]): StorePromoDay | null {
  const activePromos = storePromoDays.filter((p) => p.active);
  if (!activePromos.length) return null;
  const jsDay = new Date().getDay();
  const exact = activePromos.find((p) => Array.isArray(p.validDays) && p.validDays.includes(jsDay));
  return exact ?? activePromos[0];
}

export function RappiSavingsBadge({ offer }: { offer: StoreOffer }) {
  if (
    !offer.rappiSavingsCop ||
    offer.rappiSavingsCop <= 0 ||
    !offer.rappiPromoPrice ||
    offer.rappiPromoPrice <= 0
  ) {
    return null;
  }
  return (
    <span
      className="ms2-badge green ms2-num"
      title={`Comprando en Rappi pagas ${formatCop(offer.rappiPromoPrice)} frente a ${formatCop(offer.calibratedPrice)} estándar`}
    >
      En Rappi: {formatCop(offer.rappiPromoPrice)} (-{formatCop(offer.rappiSavingsCop)} ahorro)
    </span>
  );
}
