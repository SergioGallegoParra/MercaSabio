import type { BarrioLocationOption } from "./guidedCatalog.ts";
import type { NearbyStoreBranch, StoreOffer } from "./types.ts";

/**
 * Normaliza nombres de ciudades colombianas removiendo tildes, prefijos
 * administrativos ('Perímetro Urbano', 'D.C.') y espacios extra.
 */
export function normalizeColombiaCityName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^perimetro urbano\s+/i, "")
    .replace(/\b(d\.?\s*c\.?|colombia)\b/gi, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Determina la ciudad activa a partir de `userLocation` y del catálogo/sedes.
 */
export function resolveSelectedCityName(
  userLocation: { lat: number; lng: number; label: string },
  allBarrios: readonly BarrioLocationOption[],
  branches: readonly NearbyStoreBranch[]
): string {
  const byCoords = allBarrios.find(
    (b) =>
      Math.abs(b.lat - userLocation.lat) < 0.004 &&
      Math.abs(b.lng - userLocation.lng) < 0.004
  );
  if (byCoords) return byCoords.city;

  const cleanLabel = userLocation.label.trim();
  const byLabel = allBarrios.find((b) => b.label === cleanLabel);
  if (byLabel) return byLabel.city;

  if (cleanLabel.includes("·")) {
    const cityPart = cleanLabel.split("·")[0]?.trim() ?? "";
    if (cityPart && normalizeColombiaCityName(cityPart) !== "tu zona gps") {
      return cityPart;
    }
  }

  if (
    cleanLabel &&
    normalizeColombiaCityName(cleanLabel) !== "tu zona gps" &&
    !cleanLabel.toLowerCase().includes("gps")
  ) {
    return cleanLabel;
  }

  return branches[0]?.city ?? "";
}

export interface CityDoubleRadiusScope {
  /** Todas las sedes dentro de la ciudad elegida (cualquier distancia dentro del fetch). */
  cityBranches: NearbyStoreBranch[];
  /** Sedes de la ciudad elegida con distancia estrictamente menor a `2 * radiusMeters`. */
  branchesWithinDoubleRadius: NearbyStoreBranch[];
  /** Sedes de la ciudad elegida dentro del radio de ruta (`max(radiusMeters, minNearest)` y `< 2 * radiusMeters`). */
  eligibleBranches: NearbyStoreBranch[];
  /** Identificadores de cadena visibles en UI y catálogo (`branchesWithinDoubleRadius`). */
  visibleStoreIds: Set<string>;
}

/**
 * Aplica dos reglas estrictas:
 * 1. Solo incluye tiendas que existan en la ciudad elegida.
 * 2. Excluye toda tienda cuya sede más cercana esté a >= 2x la distancia elegida.
 */
export function filterBranchesByCityAndDoubleRadius(params: {
  branches: readonly NearbyStoreBranch[];
  chosenCity: string;
  radiusMeters: number;
}): CityDoubleRadiusScope {
  const normChosen = normalizeColombiaCityName(params.chosenCity);
  const sorted = [...params.branches].sort((a, b) => a.distanceMeters - b.distanceMeters);

  const cityBranches = normChosen
    ? sorted.filter((b) => normalizeColombiaCityName(b.city) === normChosen)
    : sorted;

  const doubleLimit = Math.max(0, params.radiusMeters) * 2;
  const branchesWithinDoubleRadius = cityBranches.filter(
    (b) => b.distanceMeters < doubleLimit
  );

  const visibleStoreIds = new Set<string>(
    branchesWithinDoubleRadius.map((b) => b.storeId)
  );

  const minNearest =
    branchesWithinDoubleRadius.length > 0
      ? branchesWithinDoubleRadius[0].distanceMeters
      : Infinity;
  const routeRadius =
    Number.isFinite(minNearest)
      ? Math.min(doubleLimit, Math.max(params.radiusMeters, minNearest))
      : params.radiusMeters;

  const eligibleBranches = branchesWithinDoubleRadius.filter(
    (b) => b.distanceMeters <= routeRadius + 1
  );

  return {
    cityBranches,
    branchesWithinDoubleRadius,
    eligibleBranches,
    visibleStoreIds,
  };
}

/**
 * Filtra ofertas conservando únicamente productos de cadenas presentes en `visibleStoreIds`.
 */
export function filterOffersByStoreIds(
  offers: readonly StoreOffer[],
  visibleStoreIds: ReadonlySet<string>
): StoreOffer[] {
  return offers.filter((offer) => visibleStoreIds.has(offer.storeId));
}

/**
 * Filtra ofertas por disponibilidad regional en la ciudad elegida.
 * - Si `availableCities` es `null` o `undefined`, el SKU es nacional/no segmentado y se conserva.
 * - Si `availableCities` es un arreglo (`string[]`), solo se conserva cuando incluye `chosenCity`.
 */
export function filterOffersByCityAvailability(
  offers: readonly StoreOffer[],
  chosenCity: string
): StoreOffer[] {
  const normCity = normalizeColombiaCityName(chosenCity);
  if (!normCity) return [...offers];
  return offers.filter((offer) => {
    if (!Array.isArray(offer.availableCities)) return true;
    return offer.availableCities.some((c) => normalizeColombiaCityName(c) === normCity);
  });
}
