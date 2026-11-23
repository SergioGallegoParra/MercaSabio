import type { GatedFeature, SubscriptionPlanTier } from "./types.ts";

/**
 * Variable centralizada de control de acceso por funcionalidad.
 *
 * Modificación del usuario (#1): por ahora NINGUNA función solicita iniciar sesión
 * (`false` para todas). Para exigir cuenta registrada en el futuro, basta cambiar
 * la bandera deseada a `true` aquí o definir `NEXT_PUBLIC_AUTH_GATED_FEATURES`.
 */
export const REQUIRE_AUTH_FOR: Record<GatedFeature, boolean> = {
  multi_device_sync: false,
  personal_inflation: false,
  household_report: false,
  payment_calendar: false,
  alerts_replenish: false,
  sabiometro_vote: false,
  budget_optimizer: false,
  save_habitual_basket: false,
  purchase_verification: false,
  community_baskets: false,
  favorite_baskets: false,
};

/**
 * Plan predeterminado para usuarios sin suscripción activa y límites de mercados favoritos.
 * Cambiable en un solo punto o vía env (`NEXT_PUBLIC_FREE_FAVORITES_LIMIT` / `NEXT_PUBLIC_PREMIUM_FAVORITES_LIMIT`).
 */
export const DEFAULT_PLAN_TIER: SubscriptionPlanTier = "free";

export const FAVORITE_BASKET_LIMITS: Record<SubscriptionPlanTier, number> = {
  free: 1,
  premium: 10,
};

export function getFavoriteBasketLimit(
  planTier?: SubscriptionPlanTier | null,
  overrides?: Partial<Record<SubscriptionPlanTier, number>>,
): number {
  const tier: SubscriptionPlanTier = planTier === "premium" ? "premium" : DEFAULT_PLAN_TIER;
  if (overrides && typeof overrides[tier] === "number" && Number.isFinite(overrides[tier])) {
    return Math.max(1, Math.round(overrides[tier]!));
  }
  if (typeof process !== "undefined" && process.env) {
    const raw =
      tier === "premium"
        ? process.env.NEXT_PUBLIC_PREMIUM_FAVORITES_LIMIT
        : process.env.NEXT_PUBLIC_FREE_FAVORITES_LIMIT;
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.round(parsed);
    }
  }
  return FAVORITE_BASKET_LIMITS[tier];
}

export function evaluateFavoriteSaveEligibility(params: {
  currentFavoritesCount: number;
  planTier?: SubscriptionPlanTier | null;
  replacingFavoriteId?: string | null;
  limitOverrides?: Partial<Record<SubscriptionPlanTier, number>>;
}): {
  allowed: boolean;
  limit: number;
  planTier: SubscriptionPlanTier;
  reason: string | null;
} {
  const tier: SubscriptionPlanTier = params.planTier === "premium" ? "premium" : DEFAULT_PLAN_TIER;
  const limit = getFavoriteBasketLimit(tier, params.limitOverrides);
  if (params.replacingFavoriteId) {
    return { allowed: true, limit, planTier: tier, reason: null };
  }
  if (params.currentFavoritesCount >= limit) {
    return {
      allowed: false,
      limit,
      planTier: tier,
      reason:
        tier === "free"
          ? `Tu plan gratis permite guardar hasta ${limit} mercado favorito. Reemplaza el existente o pasa a Premium para guardar hasta ${FAVORITE_BASKET_LIMITS.premium}.`
          : `Alcanzaste el límite de ${limit} mercados favoritos de tu plan.`,
    };
  }
  return { allowed: true, limit, planTier: tier, reason: null };
}

export interface FeatureAccessUser {
  id?: string | null;
  isRegistered?: boolean;
}

export const FEATURE_DISPLAY_NAMES: Record<GatedFeature, string> = {
  multi_device_sync: "Sincronización entre dispositivos",
  personal_inflation: "Termómetro de inflación personal",
  household_report: "Informe del hogar",
  payment_calendar: "Calendario de medios de pago",
  alerts_replenish: "Alertas de recompra y promociones",
  sabiometro_vote: "Calificar en el Sabiómetro",
  budget_optimizer: "Optimización por presupuesto",
  save_habitual_basket: "Guardar mercado habitual",
  purchase_verification: "Verificación de factura DIAN",
  community_baskets: "Comunidad de mercados recomendados",
  favorite_baskets: "Guardar mercados favoritos",
};

/**
 * Lee overrides opcionales desde variable pública CSV (`NEXT_PUBLIC_AUTH_GATED_FEATURES`)
 * sin exigir login cuando está vacía.
 */
export function resolveFeatureAuthConfig(
  overrides?: Partial<Record<GatedFeature, boolean>>,
  envCsv?: string | undefined,
): Record<GatedFeature, boolean> {
  const merged: Record<GatedFeature, boolean> = { ...REQUIRE_AUTH_FOR };
  const rawEnv =
    envCsv !== undefined
      ? envCsv
      : typeof process !== "undefined"
        ? process.env?.NEXT_PUBLIC_AUTH_GATED_FEATURES
        : undefined;

  if (rawEnv) {
    for (const token of rawEnv.split(",")) {
      const key = token.trim() as GatedFeature;
      if (key in merged) {
        merged[key] = true;
      }
    }
  }

  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (k in merged && typeof v === "boolean") {
        merged[k as GatedFeature] = v;
      }
    }
  }

  return merged;
}

/** Devuelve true si el usuario actual puede acceder sin bloqueo a la funcionalidad. */
export function isFeatureUnlocked(
  feature: GatedFeature,
  user?: FeatureAccessUser | null,
  overrides?: Partial<Record<GatedFeature, boolean>>,
): boolean {
  const config = resolveFeatureAuthConfig(overrides);
  if (!config[feature]) {
    return true;
  }
  return Boolean(user?.id && user.isRegistered);
}

/** Lista las funcionalidades que actualmente exigirían cuenta registrada. */
export function getAuthGatedFeatures(
  overrides?: Partial<Record<GatedFeature, boolean>>,
): GatedFeature[] {
  const config = resolveFeatureAuthConfig(overrides);
  return (Object.keys(config) as GatedFeature[]).filter((key) => config[key]);
}
