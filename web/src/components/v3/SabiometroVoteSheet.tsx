"use client";

import { useEffect, useRef, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import { useWorkspace } from "@/components/v3/WorkspaceContext";
import { cleanProductTitle } from "@/lib/productInsights";
import { buildPendingVerificationResponse } from "@/lib/purchaseVerification";
import type { StoreOffer } from "@/lib/types";

const SATISFACTION_OPTIONS: Array<{
  score: 1 | 0.75 | 0.25 | 0;
  title: string;
  desc: string;
}> = [
  { score: 1, title: "Compra fija", desc: "Excelente relación calidad/precio (1.00)" },
  { score: 0.75, title: "Cumple por el precio", desc: "Adecuado para lo que cuesta (0.75)" },
  { score: 0.25, title: "No vale lo que cuesta", desc: "Esperabas mejor desempeño (0.25)" },
  { score: 0, title: "Mala compra", desc: "No lo volverías a llevar (0.00)" },
];

const YIELD_OPTIONS: Array<{
  factor: 0.5 | 1 | 1.5;
  title: string;
  desc: string;
}> = [
  { factor: 0.5, title: "Rinde el doble / concentrado", desc: "PUM real baja 50% (0.50x)" },
  { factor: 1, title: "Rendimiento estándar", desc: "Dura lo esperado (1.00x)" },
  { factor: 1.5, title: "Se agota rápido", desc: "Rinde menos de lo normal (1.50x)" },
];

export function SabiometroVoteSheet({
  offer,
  onClose,
  onSubmitted,
}: {
  offer: StoreOffer | null;
  onClose: () => void;
  onSubmitted?: (summary?: unknown) => void;
}) {
  const { submitSabiometroVote } = useWorkspace();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [satisfaction, setSatisfaction] = useState<1 | 0.75 | 0.25 | 0>(1);
  const [yieldFactor, setYieldFactor] = useState<0.5 | 1 | 1.5>(1);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (offer && !dialog.open) {
      setFeedback(null);
      dialog.showModal();
    } else if (!offer && dialog.open) {
      dialog.close();
    }
  }, [offer]);

  const nivel2Notice = buildPendingVerificationResponse({
    cufe: null,
    invoiceNumber: null,
    issuerNit: null,
    issuedAtRaw: null,
    invoiceTotalCop: null,
    rawUrl: null,
  });

  async function handleSubmit() {
    if (!offer) return;
    setSubmitting(true);
    setFeedback(null);
    const res = await submitSabiometroVote({
      masterProductId: offer.masterProductId ?? offer.storeSkuId,
      satisfaction,
      yieldFactor,
      comment: comment.trim() || undefined,
    });
    setSubmitting(false);
    if (res.ok) {
      setFeedback("¡Voto guardado en el Sabiómetro! Gracias por ayudar a la comunidad.");
      onSubmitted?.(res.score);
      window.setTimeout(() => onClose(), 950);
    } else {
      setFeedback(res.error ?? "Guardado en modo local; se sincronizará cuando haya red.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="hearth-dialog"
      aria-labelledby="sabio-vote-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {offer && (
        <div className="hearth-sheet">
          <div className="hearth-sheet-handle" aria-hidden="true" />
          <div className="hearth-sheet-header">
            <div>
              <div className="hearth-sheet-title-row">
                <span className="hearth-sheet-icon-box">
                  <HearthIcon name="verified" size={16} />
                </span>
                <h3 id="sabio-vote-title" className="hearth-sheet-title">
                  Calificar en el Sabiómetro
                </h3>
              </div>
              <div className="hearth-pref-line">
                {cleanProductTitle(offer.rawName)} · {offer.storeName}
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
            <div>
              <div className="hearth-label" style={{ marginBottom: 6 }}>
                1. ¿Cómo te pareció la relación calidad / precio?
              </div>
              <div className="ms-v3-vote-grid">
                {SATISFACTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.score}
                    type="button"
                    className={`ms-v3-vote-option ${
                      satisfaction === opt.score ? "active" : ""
                    }`}
                    onClick={() => setSatisfaction(opt.score)}
                  >
                    <strong>{opt.title}</strong>
                    <span>{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="hearth-label" style={{ marginBottom: 6 }}>
                2. Rendimiento percibido en uso real
              </div>
              <div className="ms-v3-vote-grid cols-3">
                {YIELD_OPTIONS.map((opt) => (
                  <button
                    key={opt.factor}
                    type="button"
                    className={`ms-v3-vote-option ${
                      yieldFactor === opt.factor ? "active" : ""
                    }`}
                    onClick={() => setYieldFactor(opt.factor)}
                  >
                    <strong>{opt.title}</strong>
                    <span>{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="hearth-field">
              <label className="hearth-label" htmlFor="sabio-comment">
                Comentario corto (opcional)
              </label>
              <input
                id="sabio-comment"
                type="text"
                className="hearth-input"
                maxLength={180}
                placeholder="Ej: Rinde bien en lavadora, sin aroma fuerte"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            {/* Modificación #3: Nivel 2 QR DIAN visible como módulo creado y pendiente */}
            <div className="ms-v3-pending-module-note">
              <HearthIcon name="info" size={15} />
              <div>
                <strong>Verificación con factura electrónica QR DIAN (voto Nivel 2 · 3×)</strong>
                <span> — {nivel2Notice.message} Tu voto actual se registra inmediatamente.</span>
              </div>
            </div>

            {feedback && (
              <div className="hearth-info-banner">
                <HearthIcon name="check_circle" size={16} />
                <span>{feedback}</span>
              </div>
            )}
          </div>

          <div className="hearth-sheet-footer">
            <button type="button" className="hearth-btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="hearth-btn-primary"
              disabled={submitting}
              onClick={() => void handleSubmit()}
            >
              <span>{submitting ? "Publicando..." : "Enviar calificación"}</span>
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
