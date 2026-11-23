import type { DietFilter, ProductAttributes, StoreOffer } from "./types.ts";

export interface DietFilterMeta {
  id: DietFilter;
  label: string;
  shortLabel: string;
  missingWarning: string;
}

export const DIET_FILTER_CATALOG: Record<DietFilter, DietFilterMeta> = {
  lactose_free: {
    id: "lactose_free",
    label: "Sin lactosa",
    shortLabel: "Sin lactosa",
    missingWarning: "Sin información confirmada de lactosa — revisa el empaque",
  },
  gluten_free: {
    id: "gluten_free",
    label: "Sin gluten",
    shortLabel: "Sin gluten",
    missingWarning: "Sin certificación declarada libre de gluten",
  },
  low_sugar: {
    id: "low_sugar",
    label: "Bajo en azúcar",
    shortLabel: "Bajo azúcar",
    missingWarning: "Sin tabla nutricional de azúcares disponible",
  },
  high_protein: {
    id: "high_protein",
    label: "Alto en proteína",
    shortLabel: "Alta proteína",
    missingWarning: "Sin porcentaje de proteína verificado",
  },
  vegan: {
    id: "vegan",
    label: "Vegano / vegetal",
    shortLabel: "Vegano",
    missingWarning: "Sin confirmación de ingredientes de origen vegetal",
  },
  vegetarian: {
    id: "vegetarian",
    label: "Vegetariano",
    shortLabel: "Vegetariano",
    missingWarning: "Sin confirmación vegetariana",
  },
  low_sodium: {
    id: "low_sodium",
    label: "Bajo en sodio",
    shortLabel: "Bajo sodio",
    missingWarning: "Sin reporte de sodio en etiqueta",
  },
};

export type DietMatchOutcome = "pass" | "fail" | "unknown";

function normalizeName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Fallback conservador cuando aún no existe fila en `product_attributes`.
 * Regla clave: si falta certeza para una dieta restrictiva, devuelve 'unknown'
 * para nunca sustituir automáticamente leche entera por una persona intolerante a la lactosa.
 */
function inferConservativeDietMatch(
  offer: Pick<StoreOffer, "rawName" | "canonicalName" | "unitMeasure">,
  filter: DietFilter,
): DietMatchOutcome {
  const txt = normalizeName(`${offer.rawName} ${offer.canonicalName ?? ""}`);

  if (filter === "lactose_free") {
    if (
      /\b(deslactosad\w*|sin\s+lactosa|lactose\s*free|bebida\s+(de\s+)?(almendra\w*|soya|avena|coco)|tofu|aceite|arroz|frijol|lenteja|azucar|cafe|pasta)\b/.test(
        txt,
      )
    ) {
      return "pass";
    }
    if (/\b(leche\s+entera|leche\s+semidescremada|yogur\w*|kumis|queso|mantequilla|crema\s+de\s+leche|suero)\b/.test(txt)) {
      return "fail";
    }
    return "unknown";
  }

  if (filter === "gluten_free") {
    if (/\b(sin\s+gluten|gluten\s*free|libre\s+de\s+gluten|harina\s+de\s+arroz|maizena|arepa\s+de\s+maiz)\b/.test(txt)) {
      return "pass";
    }
    if (/\b(trigo|cebada|centeno|avena\s+tradicional|pasta|espagueti|spaghetti|pan\s+(blanco|integral|tajado)|galleta|ponque)\b/.test(txt)) {
      return "fail";
    }
    return "unknown";
  }

  if (filter === "low_sugar") {
    if (/\b(sin\s+azucar|zero\s+azucar|cero\s+azucar|0%\s+azucar|sin\s+azucares\s+anadidos|stevia|light)\b/.test(txt)) {
      return "pass";
    }
    if (/\b(azucar\b|panela\b|arequipe\b|leche\s+condensada|milo|chocolisto|gaseosa\b|compota)\b/.test(txt)) {
      return "fail";
    }
    return "unknown";
  }

  if (filter === "high_protein") {
    if (/\b(yogur\w*\s+griego|greek|alta\s+proteina|high\s+protein|\bpro\b.*proteina|huevos?|pechuga|atun\b|carne\b|lenteja\b|frijol\b)\b/.test(txt)) {
      return "pass";
    }
    if (/\b(azucar|aceite|agua\b|gaseosa)\b/.test(txt)) {
      return "fail";
    }
    return "unknown";
  }

  if (filter === "vegan") {
    if (/\b(vegano|plant\s+based|almendra|soya|coco|tofu|lenteja|frijol|garbanzo|arroz|aceite\s+vegetal)\b/.test(txt)) {
      return "pass";
    }
    if (/\b(leche\b|queso|yogur|mantequilla|huevos?|carne|pollo|res|cerdo|atun|pescado|miel)\b/.test(txt)) {
      return "fail";
    }
    return "unknown";
  }

  if (filter === "vegetarian") {
    if (/\b(carne|pollo|pechuga|res|cerdo|atun|salmon|pescado|tocino|jamon|salchicha)\b/.test(txt)) {
      return "fail";
    }
    if (/\b(arroz|frijol|lenteja|leche|queso|yogur|huevo|pasta|aceite)\b/.test(txt)) {
      return "pass";
    }
    return "unknown";
  }

  if (filter === "low_sodium") {
    if (/\b(bajo\s+en\s+sodio|sin\s+sal|reducido\s+en\s+sodio)\b/.test(txt)) {
      return "pass";
    }
    if (/\b(salsa\s+soya|caldo\s+en\s+cubo|sal\s+refinada|chorizo|jamon|tocineta)\b/.test(txt)) {
      return "fail";
    }
    return "unknown";
  }

  return "unknown";
}

export function evaluateSingleDietFilter(
  attrs: ProductAttributes | undefined | null,
  offer: Pick<StoreOffer, "rawName" | "canonicalName" | "unitMeasure"> | undefined | null,
  filter: DietFilter,
): DietMatchOutcome {
  if (attrs) {
    const isLiquid = offer?.unitMeasure === "ml";
    switch (filter) {
      case "lactose_free":
        if (attrs.lactoseFree === true) return "pass";
        if (attrs.lactoseFree === false) return "fail";
        break;
      case "gluten_free":
        if (attrs.glutenFree === true) return "pass";
        if (attrs.glutenFree === false) return "fail";
        break;
      case "vegan":
        if (attrs.vegan === true) return "pass";
        if (attrs.vegan === false) return "fail";
        break;
      case "vegetarian":
        if (attrs.vegetarian === true) return "pass";
        if (attrs.vegetarian === false) return "fail";
        break;
      case "low_sugar":
        if (attrs.frontWarningSeals?.includes("exceso_azucares")) return "fail";
        if (typeof attrs.sugarG100 === "number") {
          return attrs.sugarG100 <= (isLiquid ? 2.5 : 5) ? "pass" : "fail";
        }
        break;
      case "high_protein":
        if (typeof attrs.proteinG100 === "number") {
          return attrs.proteinG100 >= (isLiquid ? 5 : 10) ? "pass" : "fail";
        }
        break;
      case "low_sodium":
        if (attrs.frontWarningSeals?.includes("exceso_sodio")) return "fail";
        if (typeof attrs.sodiumMg100 === "number") {
          return attrs.sodiumMg100 <= 140 ? "pass" : "fail";
        }
        break;
    }
  }

  if (offer) {
    return inferConservativeDietMatch(offer, filter);
  }
  return "unknown";
}

/** Evalúa todas las restricciones activas sobre un producto candidato. */
export function passesDiet(
  attrs: ProductAttributes | undefined | null,
  filters: DietFilter[],
  offer?: Pick<StoreOffer, "rawName" | "canonicalName" | "unitMeasure"> | null,
): DietMatchOutcome {
  if (!filters || filters.length === 0) return "pass";
  let hasUnknown = false;
  for (const f of filters) {
    const res = evaluateSingleDietFilter(attrs ?? offer ? attrs : undefined, offer, f);
    if (res === "fail") return "fail";
    if (res === "unknown") hasUnknown = true;
  }
  return hasUnknown ? "unknown" : "pass";
}

/** Aviso amable si un producto habitual del usuario contradice sus filtros de dieta activos. */
export function getHabitualDietMismatchWarning(
  offer: StoreOffer,
  filters: DietFilter[],
): string | null {
  if (!filters.length) return null;
  for (const f of filters) {
    const res = evaluateSingleDietFilter(offer.productAttributes, offer, f);
    if (res === "fail") {
      return `Tu producto habitual incumple tu filtro "${DIET_FILTER_CATALOG[f].label}".`;
    }
  }
  return null;
}

/** Alterna un filtro únicamente sobre una canasta específica sin alterar el perfil global. */
export function toggleBasketDietFilter(
  currentFilters: DietFilter[],
  filter: DietFilter,
): DietFilter[] {
  if (currentFilters.includes(filter)) {
    return currentFilters.filter((f) => f !== filter);
  }
  return [...currentFilters, filter];
}
