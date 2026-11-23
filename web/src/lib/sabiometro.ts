import type {
  SabiometroConsensusLabel,
  SabiometroReputationLevel,
  SabiometroSummary,
  SabiometroSupportLabel,
  SabiometroVoteInput,
} from "./types.ts";

export const SABIOMETRO_CONSTANTS = {
  Z_CONFIDENCE: 1.645,
  MIN_PUBLISH_WEIGHT: 1.0,
  BAD_PENALTY_WEIGHT: 0.6,
  FRESHNESS_CUTOFF_DAYS: 365,
  FRESH_FACTOR: 1.0,
  STALE_FACTOR: 0.5,
  REPUTATION_BASE_WEIGHT: {
    0: 0.05,
    1: 1.0,
    2: 3.0,
  } as Record<SabiometroReputationLevel, number>,
} as const;

export function resolveVoteWeight(vote: SabiometroVoteInput): number {
  if (typeof vote.effectiveWeightOverride === "number" && vote.effectiveWeightOverride >= 0) {
    return vote.effectiveWeightOverride;
  }
  const level: SabiometroReputationLevel = vote.reputationLevel ?? 0;
  const wBase = SABIOMETRO_CONSTANTS.REPUTATION_BASE_WEIGHT[level] ?? 0.05;
  const ageDays = vote.ageDays ?? 0;
  const d =
    ageDays > SABIOMETRO_CONSTANTS.FRESHNESS_CUTOFF_DAYS
      ? SABIOMETRO_CONSTANTS.STALE_FACTOR
      : SABIOMETRO_CONSTANTS.FRESH_FACTOR;
  return wBase * d;
}

export function getConsensusLabel(rBad: number): Exclude<SabiometroConsensusLabel, "Sin calificación suficiente"> {
  if (rBad < 0.05) return "Compra segura";
  if (rBad < 0.15) return "Consenso moderado";
  return "Opiniones divididas";
}

export function getSupportLabel(voteMass: number): SabiometroSupportLabel {
  if (voteMass < 10) return "Pocas reseñas";
  if (voteMass < 50) return "Respaldado";
  return "Ampliamente probado";
}

/**
 * Calcula el Índice de Valor Real (Sabiómetro) a partir de votos individuales,
 * idéntico en matemática al procedimiento SQL `recompute_sabiometro`.
 */
export function computeSabiometroFromVotes(
  masterProductId: string,
  votes: SabiometroVoteInput[],
  options?: {
    underReview?: boolean;
    frozenSummary?: Partial<SabiometroSummary> | null;
    nowIso?: string;
  },
): SabiometroSummary {
  const computedAt = options?.nowIso ?? new Date().toISOString();

  if (options?.underReview && options.frozenSummary) {
    return {
      masterProductId,
      voteMass: options.frozenSummary.voteMass ?? 0,
      pHat: options.frozenSummary.pHat ?? null,
      rBad: options.frozenSummary.rBad ?? null,
      fYield: options.frozenSummary.fYield ?? 1,
      wilsonLower: options.frozenSummary.wilsonLower ?? null,
      valueIndex: options.frozenSummary.valueIndex ?? null,
      status: "under_review",
      consensusLabel:
        options.frozenSummary.consensusLabel ?? "Sin calificación suficiente",
      supportLabel: options.frozenSummary.supportLabel ?? null,
      votesCount: options.frozenSummary.votesCount ?? votes.length,
      underReview: true,
      frozenAt: options.frozenSummary.frozenAt ?? computedAt,
      computedAt,
    };
  }

  let totalWeight = 0;
  let weightedSatisfaction = 0;
  let weightedBad = 0;
  let weightedYield = 0;

  for (const vote of votes) {
    const w = resolveVoteWeight(vote);
    if (w <= 0) continue;
    totalWeight += w;
    weightedSatisfaction += w * vote.satisfaction;
    if (vote.satisfaction === 0) {
      weightedBad += w;
    }
    weightedYield += w * vote.yieldFactor;
  }

  if (totalWeight < SABIOMETRO_CONSTANTS.MIN_PUBLISH_WEIGHT) {
    return {
      masterProductId,
      voteMass: Number(totalWeight.toFixed(4)),
      pHat: null,
      rBad: null,
      fYield: totalWeight > 0 ? Number((weightedYield / totalWeight).toFixed(5)) : 1,
      wilsonLower: null,
      valueIndex: null,
      status: options?.underReview ? "under_review" : "insufficient",
      consensusLabel: "Sin calificación suficiente",
      supportLabel: null,
      votesCount: votes.length,
      underReview: Boolean(options?.underReview),
      computedAt,
    };
  }

  const pHat = weightedSatisfaction / totalWeight;
  const rBad = weightedBad / totalWeight;
  const fYield = weightedYield / totalWeight;

  const z = SABIOMETRO_CONSTANTS.Z_CONFIDENCE;
  const z2 = z * z;
  const radicand = Math.max(
    0,
    (pHat * (1 - pHat) + z2 / (4 * totalWeight)) / totalWeight,
  );
  const rawWilson =
    (pHat + z2 / (2 * totalWeight) - z * Math.sqrt(radicand)) /
    (1 + z2 / totalWeight);
  const wilson = Math.min(1, Math.max(0, rawWilson));
  const valueIndex = Math.min(
    100,
    Math.max(0, 100 * wilson * (1 - SABIOMETRO_CONSTANTS.BAD_PENALTY_WEIGHT * rBad)),
  );

  return {
    masterProductId,
    voteMass: Number(totalWeight.toFixed(4)),
    pHat: Number(pHat.toFixed(5)),
    rBad: Number(rBad.toFixed(5)),
    fYield: Number(fYield.toFixed(5)),
    wilsonLower: Number(wilson.toFixed(5)),
    valueIndex: Number(valueIndex.toFixed(2)),
    status: options?.underReview ? "under_review" : "published",
    consensusLabel: getConsensusLabel(rBad),
    supportLabel: getSupportLabel(totalWeight),
    votesCount: votes.length,
    underReview: Boolean(options?.underReview),
    computedAt,
  };
}

/** PUM_real = (Precio_calibrado / Contenido_neto) * F_rend (solo si el Sabiómetro está publicado). */
export function computeRealPum(params: {
  calibratedPriceCop: number;
  netContent: number;
  sabiometro?: SabiometroSummary | null;
  fallbackYieldFactor?: number;
}): number {
  const safePrice = Number.isFinite(params.calibratedPriceCop) ? params.calibratedPriceCop : 0;
  const safeContent = params.netContent > 0 ? params.netContent : 1;
  const nominalPum = safePrice / safeContent;
  const fRend =
    params.sabiometro && params.sabiometro.voteMass >= 1.0 && params.sabiometro.fYield > 0
      ? params.sabiometro.fYield
      : params.fallbackYieldFactor && params.fallbackYieldFactor > 0
        ? params.fallbackYieldFactor
        : 1.0;
  return Number((nominalPum * fRend).toFixed(4));
}

/** Un producto sin calificación suficiente (W < 1) se trata como neutro, nunca penalizado. */
export function passesSabiometroFilter(
  summary: SabiometroSummary | undefined | null,
  minSabioIndex: number | undefined,
): boolean {
  if (!minSabioIndex || minSabioIndex <= 0) return true;
  if (!summary || summary.status === "insufficient" || summary.valueIndex === null) {
    return true;
  }
  return summary.valueIndex >= minSabioIndex;
}
