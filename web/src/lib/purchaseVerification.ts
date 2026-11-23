import type { PurchaseVerificationStub } from "./types.ts";

/**
 * Modificación del usuario (#3): el módulo de compra verificada Nivel 2 con QR DIAN
 * queda creado y tipado, pero pendiente de activación mientras se habilita el lector
 * de facturas electrónicas. Todos los usuarios pueden votar normalmente en Nivel 0/1.
 */
export const NIVEL_2_QR_ENABLED = false;

export interface ParsedDianQr {
  cufe: string | null;
  invoiceNumber: string | null;
  issuerNit: string | null;
  issuedAtRaw: string | null;
  invoiceTotalCop: number | null;
  rawUrl: string | null;
}

/** Extrae CUFE, NIT emisor, fecha y total del texto contenido en un QR de factura electrónica DIAN. */
export function parseDianQrPayload(rawQrText: string): ParsedDianQr {
  const clean = rawQrText.trim();
  const numFac = clean.match(/NumFac\s*[:=]\s*([^\s\r\n]+)/i)?.[1] ?? null;
  const nitFac = clean.match(/NitFac\s*[:=]\s*([0-9\-]+)/i)?.[1] ?? null;
  const fecFac = clean.match(/FecFac\s*[:=]\s*([0-9\-:T ]+)/i)?.[1]?.trim() ?? null;
  const valTolRaw = clean.match(/ValTolFac\s*[:=]\s*([0-9.,]+)/i)?.[1] ?? null;
  const cufe =
    clean.match(/CUFE\s*[:=]\s*([a-fA-F0-9]{40,128})/i)?.[1] ??
    clean.match(/DocumentKey\s*=?\s*([a-fA-F0-9]{40,128})/i)?.[1] ??
    clean.match(/\b([a-fA-F0-9]{96})\b/)?.[1] ??
    null;
  const rawUrl = clean.match(/https?:\/\/[^\s]+/i)?.[0] ?? null;

  let invoiceTotalCop: number | null = null;
  if (valTolRaw) {
    const parsed = Number(valTolRaw.replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      invoiceTotalCop = Math.round(parsed);
    }
  }

  return {
    cufe,
    invoiceNumber: numFac,
    issuerNit: nitFac,
    issuedAtRaw: fecFac,
    invoiceTotalCop,
    rawUrl,
  };
}

export function buildPendingVerificationResponse(
  parsed: ParsedDianQr,
): PurchaseVerificationStub {
  return {
    cufe: parsed.cufe ?? "PENDIENTE",
    invoiceTotal: parsed.invoiceTotalCop,
    verificationMethod: "qr_dian",
    status: "module_pending",
    message:
      "Módulo de compra verificada (Nivel 2 con QR DIAN) creado pero pendiente de activación. Tu voto sigue sumando sin escanear factura.",
  };
}
