import type { UnitMeasure } from "./types.ts";

/** Formatea montos en pesos colombianos sin decimales (es-CO). */
export function formatCop(amount: number, opts?: { signed?: boolean }): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  const absFormatted = new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
  }).format(Math.abs(safe));
  if (safe < 0) return `−$${absFormatted}`;
  if (opts?.signed && safe > 0) return `+$${absFormatted}`;
  return `$${absFormatted}`;
}

/** Convierte contenido neto base (g, ml, und) a etiqueta compacta (1 kg, 1 L, ×30). */
export function formatNetContent(netContent: number, unitMeasure: UnitMeasure): string {
  const safe = Number.isFinite(netContent) && netContent > 0 ? netContent : 1;
  if (unitMeasure === "g") {
    if (safe >= 1000) {
      const kg = safe / 1000;
      const str = Number.isInteger(kg)
        ? String(kg)
        : kg.toFixed(1).replace(/\.0$/, "").replace(".", ",");
      return `${str} kg`;
    }
    return `${Math.round(safe)} g`;
  }
  if (unitMeasure === "ml") {
    if (safe >= 1000) {
      const l = safe / 1000;
      const str = Number.isInteger(l)
        ? String(l)
        : l.toFixed(1).replace(/\.0$/, "").replace(".", ",");
      return `${str} L`;
    }
    return `${Math.round(safe)} ml`;
  }
  return `×${Math.round(safe)} und`;
}

/** Formatea Precio por Unidad de Medida (PUM) con coma decimal es-CO. */
export function formatPum(pum: number, unitMeasure: UnitMeasure): string {
  const safe = Number.isFinite(pum) && pum > 0 ? pum : 0;
  const formatted =
    safe >= 100
      ? new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Math.round(safe))
      : safe.toFixed(1).replace(".", ",");
  return `$${formatted}/${unitMeasure}`;
}

/** Limita texto al máximo indicado agregando elipsis limpia. */
export function truncateText(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}
