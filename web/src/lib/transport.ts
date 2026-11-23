import type { TransportMode } from "./types.ts";

export interface TransportProfile {
  mode: TransportMode;
  label: string;
  shortLabel: string;
  emoji: string;
  defaultRadiusM: number;
  maxRadiusM: number;
  speedKmh: number;
  circuity: number;
  maxStoresDefault: 1 | 2 | 3 | 4 | 5;
  costPerKmCop: number;
  costPerTripCop: number;
  maxRecommendedWalkWeightKg: number | null;
}

export const TRANSPORT_PROFILES: Record<TransportMode, TransportProfile> = {
  walk: {
    mode: "walk",
    label: "A pie",
    shortLabel: "A pie",
    emoji: "🚶",
    defaultRadiusM: 1200,
    maxRadiusM: 2500,
    speedKmh: 4.5,
    circuity: 1.25,
    maxStoresDefault: 2,
    costPerKmCop: 0,
    costPerTripCop: 0,
    maxRecommendedWalkWeightKg: 12,
  },
  bike: {
    mode: "bike",
    label: "Bicicleta",
    shortLabel: "Bici",
    emoji: "🚲",
    defaultRadiusM: 3000,
    maxRadiusM: 6000,
    speedKmh: 13,
    circuity: 1.25,
    maxStoresDefault: 3,
    costPerKmCop: 0,
    costPerTripCop: 0,
    maxRecommendedWalkWeightKg: 18,
  },
  public: {
    mode: "public",
    label: "Transporte público",
    shortLabel: "Público",
    emoji: "🚌",
    defaultRadiusM: 4000,
    maxRadiusM: 8000,
    speedKmh: 15,
    circuity: 1.4,
    maxStoresDefault: 2,
    costPerKmCop: 0,
    costPerTripCop: 3200,
    maxRecommendedWalkWeightKg: 14,
  },
  moto: {
    mode: "moto",
    label: "Moto",
    shortLabel: "Moto",
    emoji: "🏍️",
    defaultRadiusM: 6000,
    maxRadiusM: 12000,
    speedKmh: 25,
    circuity: 1.3,
    maxStoresDefault: 3,
    costPerKmCop: 180,
    costPerTripCop: 0,
    maxRecommendedWalkWeightKg: 22,
  },
  car: {
    mode: "car",
    label: "Carro",
    shortLabel: "Carro",
    emoji: "🚗",
    defaultRadiusM: 6000,
    maxRadiusM: 15000,
    speedKmh: 20,
    circuity: 1.3,
    maxStoresDefault: 3,
    costPerKmCop: 650,
    costPerTripCop: 0,
    maxRecommendedWalkWeightKg: null,
  },
};

export function getTransportProfile(mode?: TransportMode | null): TransportProfile {
  if (!mode || !(mode in TRANSPORT_PROFILES)) {
    return TRANSPORT_PROFILES.walk;
  }
  return TRANSPORT_PROFILES[mode];
}

export function clampRadiusForTransport(
  radiusMeters: number,
  mode?: TransportMode | null,
): number {
  const profile = getTransportProfile(mode);
  const safe = Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : profile.defaultRadiusM;
  return Math.min(profile.maxRadiusM, Math.max(300, Math.round(safe)));
}

/** Estima minutos de desplazamiento según distancia en línea recta, factor de rodeo y velocidad media. */
export function estimateTravelMinutes(
  distanceMeters: number,
  mode?: TransportMode | null,
): number {
  const profile = getTransportProfile(mode);
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0;
  const roadKm = (distanceMeters / 1000) * profile.circuity;
  return Math.max(1, Math.round((roadKm / profile.speedKmh) * 60));
}

/** Calcula costo monetario estimado del desplazamiento (combustible / pasaje por parada extra). */
export function estimateTravelCostCop(params: {
  distanceMeters: number;
  stopCount: number;
  mode?: TransportMode | null;
}): number {
  const profile = getTransportProfile(params.mode);
  const roadKm = Math.max(0, (params.distanceMeters / 1000) * profile.circuity);
  const distanceCost = Math.round(roadKm * profile.costPerKmCop);
  const extraTrips = Math.max(0, params.stopCount - 1);
  const transitCost = extraTrips * profile.costPerTripCop;
  return distanceCost + transitCost;
}

/** Evalúa si una parada adicional compensa su costo de desplazamiento frente al ahorro marginal. */
export function isExtraStopWorthTravelCost(params: {
  extraSavingsCop: number;
  extraDistanceMeters: number;
  mode?: TransportMode | null;
  minNetGainCop?: number;
}): { worth: boolean; extraTravelCostCop: number; netGainCop: number } {
  const profile = getTransportProfile(params.mode);
  const roadKm = Math.max(0, (params.extraDistanceMeters / 1000) * profile.circuity);
  const extraTravelCostCop = Math.round(roadKm * profile.costPerKmCop) + profile.costPerTripCop;
  const netGainCop = Math.round(params.extraSavingsCop - extraTravelCostCop);
  const threshold = params.minNetGainCop ?? 1500;
  return {
    worth: netGainCop >= threshold,
    extraTravelCostCop,
    netGainCop,
  };
}

/** Calcula el peso aproximado de la canasta para alertar al caminar (límite 12 kg). */
export function evaluateWalkWeightAlert(params: {
  totalWeightKg: number;
  mode?: TransportMode | null;
}): string | null {
  const profile = getTransportProfile(params.mode);
  if (!profile.maxRecommendedWalkWeightKg) return null;
  if (params.totalWeightKg > profile.maxRecommendedWalkWeightKg) {
    return `Tu mercado pesa ~${params.totalWeightKg.toFixed(1).replace(".", ",")} kg (${profile.label.toLowerCase()} recomendado ≤ ${profile.maxRecommendedWalkWeightKg} kg). Sugerimos dividir en 2 visitas o usar domicilio.`;
  }
  return null;
}

export function formatDistanceAndTime(
  distanceMeters: number,
  mode?: TransportMode | null,
): string {
  const profile = getTransportProfile(mode);
  const kmText =
    distanceMeters < 1000
      ? `${Math.round(distanceMeters)} m`
      : `${(distanceMeters / 1000).toFixed(1).replace(".", ",")} km`;
  const mins = estimateTravelMinutes(distanceMeters, mode);
  return `${mins} min ${profile.shortLabel.toLowerCase()} · ${kmText}`;
}
