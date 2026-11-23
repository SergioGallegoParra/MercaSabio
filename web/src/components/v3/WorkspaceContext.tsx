"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { BasketItemInput } from "@/lib/basketOptimizer";
import { sanitizeBasketItemsForSnapshot } from "@/lib/communityBaskets";
import {
  DEFAULT_PLAN_TIER,
  evaluateFavoriteSaveEligibility,
  getFavoriteBasketLimit,
} from "@/lib/featureAccess";
import type { PurchaseEventRecord } from "@/lib/replenishment";
import {
  detectDeviceInfo,
  loadLocalWorkspaceCredentials,
  mergeSyncedBaskets,
  saveLocalWorkspaceCredentials,
  type WorkspaceCredentials,
} from "@/lib/sync/workspaceSync";
import type {
  DietFilter,
  FavoriteBasketRecord,
  SabiometroSatisfaction,
  SabiometroYieldFactor,
  SubscriptionPlanTier,
  SyncedBasket,
  UserPaymentMethod,
  UserProfile,
  WorkspaceAlert,
  WorkspaceDevice,
} from "@/lib/types";

export type SyncConnectionState = "local" | "syncing" | "synced" | "offline";

export interface VoteSubmitInput {
  masterProductId: string;
  satisfaction: SabiometroSatisfaction;
  yieldFactor: SabiometroYieldFactor;
  comment?: string;
}

export interface SaveFavoriteInput {
  title: string;
  optimizeMode: "my_brands" | "generic";
  items: BasketItemInput[];
  activeDietFilters?: DietFilter[];
  estimatedTotalCop?: number;
  estimatedSavingsCop?: number;
  storeSummary?: string;
  zoneLabel?: string;
  replaceId?: string | null;
}

interface WorkspaceContextValue {
  credentials: WorkspaceCredentials | null;
  syncState: SyncConnectionState;
  lastSyncedAt: string | null;
  userProfile: UserProfile | null;
  planTier: SubscriptionPlanTier;
  paymentMethods: UserPaymentMethod[];
  baskets: SyncedBasket[];
  favorites: FavoriteBasketRecord[];
  favoriteLimit: number;
  devices: WorkspaceDevice[];
  alerts: WorkspaceAlert[];
  purchaseEvents: PurchaseEventRecord[];
  unreadAlertsCount: number;
  joinByHouseholdCode: (code: string) => Promise<{ ok: boolean; error?: string }>;
  removeDevice: (deviceId: string) => Promise<void>;
  saveProfileAndPayments: (input: {
    profile: Partial<UserProfile>;
    paymentMethods: UserPaymentMethod[];
  }) => Promise<boolean>;
  syncActiveBasket: (items: BasketItemInput[], activeDietFilters?: DietFilter[]) => void;
  saveFavoriteBasket: (input: SaveFavoriteInput) => Promise<{
    ok: boolean;
    errorCode?: string;
    message?: string;
  }>;
  removeFavoriteBasket: (favoriteId: string) => Promise<void>;
  recordPurchaseEvents: (events: PurchaseEventRecord[]) => Promise<void>;
  markAlertRead: (alertId: string) => Promise<void>;
  submitSabiometroVote: (
    vote: VoteSubmitInput
  ) => Promise<{ ok: boolean; score?: unknown; error?: string }>;
  refreshWorkspace: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const PROFILE_STORAGE_KEY = "mercasabio_profile_v3";
const PAYMENTS_STORAGE_KEY = "mercasabio_payments_v3";
const PURCHASES_STORAGE_KEY = "mercasabio_purchases_v3";
const ALERTS_STORAGE_KEY = "mercasabio_alerts_v3";
const BASKETS_SYNC_KEY = "mercasabio_baskets_v3";
const FAVORITES_STORAGE_KEY = "mercasabio_favorites_v4";
const DEVICE_ID_STORAGE_KEY = "mercasabio_device_id_v3";

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "server-ssr";
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const created =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `dev-${crypto.randomUUID().slice(0, 12)}`
        : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return `dev-${Date.now().toString(36)}`;
  }
}

function readStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key: string, val: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // Modo privado o cuota llena
  }
}

function mapRawProfile(raw: Record<string, unknown>, fallbackWsId: string): UserProfile {
  const rawPlan = raw.plan_tier ?? raw.planTier;
  return {
    workspaceId: String(raw.workspace_id ?? raw.workspaceId ?? fallbackWsId),
    displayName: typeof raw.display_name === "string" ? raw.display_name : typeof raw.displayName === "string" ? raw.displayName : null,
    planTier: rawPlan === "premium" ? "premium" : "free",
    householdAdults: Number(raw.household_adults ?? raw.householdAdults ?? 2),
    householdChildren: Number(raw.household_children ?? raw.householdChildren ?? 0),
    householdPets: Number(raw.household_pets ?? raw.householdPets ?? 0),
    monthlyBudgetCop:
      raw.monthly_budget_cop != null
        ? Number(raw.monthly_budget_cop)
        : raw.monthlyBudgetCop != null
          ? Number(raw.monthlyBudgetCop)
          : null,
    weeklyBudgetCop:
      raw.weekly_budget_cop != null
        ? Number(raw.weekly_budget_cop)
        : raw.weeklyBudgetCop != null
          ? Number(raw.weeklyBudgetCop)
          : null,
    shoppingCadence:
      ((raw.shopping_cadence ?? raw.shoppingCadence) as UserProfile["shoppingCadence"]) ?? "biweekly",
    transportMode:
      ((raw.transport_mode ?? raw.transportMode) as UserProfile["transportMode"]) ?? "walk",
    homeLat:
      raw.home_lat != null ? Number(raw.home_lat) : raw.homeLat != null ? Number(raw.homeLat) : null,
    homeLng:
      raw.home_lng != null ? Number(raw.home_lng) : raw.homeLng != null ? Number(raw.homeLng) : null,
    homeLabel:
      typeof raw.home_label === "string"
        ? raw.home_label
        : typeof raw.homeLabel === "string"
          ? raw.homeLabel
          : null,
    dietaryRestrictions: Array.isArray(raw.dietary_restrictions ?? raw.dietaryRestrictions)
      ? ((raw.dietary_restrictions ?? raw.dietaryRestrictions) as DietFilter[])
      : [],
    preferredStoreIds: Array.isArray(raw.preferred_store_ids ?? raw.preferredStoreIds)
      ? ((raw.preferred_store_ids ?? raw.preferredStoreIds) as string[])
      : [],
    onboardingCompletedAt:
      typeof raw.onboarding_completed_at === "string"
        ? raw.onboarding_completed_at
        : typeof raw.onboardingCompletedAt === "string"
          ? raw.onboardingCompletedAt
          : null,
  };
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [credentials, setCredentials] = useState<WorkspaceCredentials | null>(null);
  const [syncState, setSyncState] = useState<SyncConnectionState>("local");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<UserPaymentMethod[]>([]);
  const [baskets, setBaskets] = useState<SyncedBasket[]>([]);
  const [favorites, setFavorites] = useState<FavoriteBasketRecord[]>([]);
  const [devices, setDevices] = useState<WorkspaceDevice[]>([]);
  const [alerts, setAlerts] = useState<WorkspaceAlert[]>([]);
  const [purchaseEvents, setPurchaseEvents] = useState<PurchaseEventRecord[]>([]);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const credentialsRef = useRef<WorkspaceCredentials | null>(null);
  credentialsRef.current = credentials;

  const hydrateFromLocalStorage = useCallback(() => {
    setUserProfile(readStoredJson<UserProfile | null>(PROFILE_STORAGE_KEY, null));
    setPaymentMethods(readStoredJson<UserPaymentMethod[]>(PAYMENTS_STORAGE_KEY, []));
    setPurchaseEvents(readStoredJson<PurchaseEventRecord[]>(PURCHASES_STORAGE_KEY, []));
    setAlerts(readStoredJson<WorkspaceAlert[]>(ALERTS_STORAGE_KEY, []));
    setBaskets(readStoredJson<SyncedBasket[]>(BASKETS_SYNC_KEY, []));
    setFavorites(readStoredJson<FavoriteBasketRecord[]>(FAVORITES_STORAGE_KEY, []));
  }, []);

  const authHeaders = useCallback((creds: WorkspaceCredentials) => ({
    "x-workspace-id": creds.workspaceId,
    "x-workspace-token": creds.sessionToken,
  }), []);

  const applyBundle = useCallback((bundle: Record<string, unknown>) => {
    const devMeta = detectDeviceInfo();
    let activeCreds = credentialsRef.current;

    if (bundle.credentials && typeof bundle.credentials === "object") {
      const c = bundle.credentials as {
        workspaceId?: string;
        householdCode?: string;
        sessionToken?: string;
        deviceId?: string;
      };
      if (c.workspaceId && c.householdCode && c.sessionToken) {
        activeCreds = {
          workspaceId: c.workspaceId,
          householdCode: c.householdCode,
          sessionToken: c.sessionToken,
          deviceId: c.deviceId || getOrCreateDeviceId(),
          deviceName: devMeta.deviceName,
          deviceKind: devMeta.deviceKind,
        };
        saveLocalWorkspaceCredentials(activeCreds);
        setCredentials(activeCreds);
      }
    }

    if (bundle.profile && typeof bundle.profile === "object") {
      const mapped = mapRawProfile(
        bundle.profile as Record<string, unknown>,
        activeCreds?.workspaceId ?? "local"
      );
      setUserProfile(mapped);
      writeStoredJson(PROFILE_STORAGE_KEY, mapped);
    }

    if (Array.isArray(bundle.paymentMethods)) {
      setPaymentMethods(bundle.paymentMethods as UserPaymentMethod[]);
      writeStoredJson(PAYMENTS_STORAGE_KEY, bundle.paymentMethods);
    }

    if (Array.isArray(bundle.devices)) {
      setDevices(bundle.devices as WorkspaceDevice[]);
    }

    if (Array.isArray(bundle.alerts)) {
      setAlerts(bundle.alerts as WorkspaceAlert[]);
      writeStoredJson(ALERTS_STORAGE_KEY, bundle.alerts);
    }

    if (Array.isArray(bundle.baskets)) {
      setBaskets((prev) => {
        const merged = mergeSyncedBaskets(prev, bundle.baskets as SyncedBasket[]);
        writeStoredJson(BASKETS_SYNC_KEY, merged);
        return merged;
      });
    }

    if (Array.isArray(bundle.favorites)) {
      const favs = bundle.favorites as FavoriteBasketRecord[];
      setFavorites(favs);
      writeStoredJson(FAVORITES_STORAGE_KEY, favs);
    }

    setLastSyncedAt(new Date().toISOString());
    setSyncState("synced");
  }, []);

  const refreshWorkspace = useCallback(async () => {
    const creds = credentialsRef.current ?? loadLocalWorkspaceCredentials();
    if (!creds) return;
    setSyncState("syncing");
    try {
      const [wsRes, bskRes, altRes, favRes] = await Promise.all([
        fetch("/api/workspace", { headers: authHeaders(creds) }),
        fetch("/api/baskets", { headers: authHeaders(creds) }).catch(() => null),
        fetch("/api/alerts", { headers: authHeaders(creds) }).catch(() => null),
        fetch("/api/favorites", { headers: authHeaders(creds) }).catch(() => null),
      ]);
      if (!wsRes.ok) {
        setSyncState("local");
        return;
      }
      const data = (await wsRes.json()) as Record<string, unknown>;
      if (bskRes?.ok) {
        const bJson = (await bskRes.json()) as { baskets?: SyncedBasket[] };
        data.baskets = bJson.baskets ?? [];
      }
      if (altRes?.ok) {
        const aJson = (await altRes.json()) as { alerts?: WorkspaceAlert[] };
        data.alerts = aJson.alerts ?? [];
      }
      if (favRes?.ok) {
        const fJson = (await favRes.json()) as { favorites?: FavoriteBasketRecord[] };
        data.favorites = fJson.favorites ?? [];
      }
      applyBundle(data);
    } catch {
      setSyncState(navigator.onLine ? "local" : "offline");
    }
  }, [applyBundle, authHeaders]);

  const provisionOrJoin = useCallback(
    async (householdCodeOverride?: string): Promise<{ ok: boolean; error?: string }> => {
      setSyncState("syncing");
      const dev = detectDeviceInfo();
      const existing = loadLocalWorkspaceCredentials();
      const deviceId = existing?.deviceId || getOrCreateDeviceId();

      if (existing && !householdCodeOverride) {
        setCredentials(existing);
        await refreshWorkspace();
        return { ok: true };
      }

      try {
        const isJoin = Boolean(householdCodeOverride);
        const res = await fetch("/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: isJoin ? "join" : "provision",
            householdCode: householdCodeOverride,
            deviceId,
            deviceName: dev.deviceName,
            deviceKind: dev.deviceKind,
          }),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          setSyncState("local");
          return { ok: false, error: errBody.error ?? "No se pudo conectar el hogar" };
        }
        const data = (await res.json()) as Record<string, unknown>;
        applyBundle(data);
        return { ok: true };
      } catch {
        setSyncState(navigator.onLine ? "local" : "offline");
        return { ok: false, error: "Sin conexión en este momento; trabajando en local." };
      }
    },
    [applyBundle, refreshWorkspace]
  );

  useEffect(() => {
    hydrateFromLocalStorage();
    let urlCode: string | undefined;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const rawCode = params.get("hogar");
      if (rawCode && rawCode.trim()) {
        urlCode = rawCode.trim().toUpperCase();
        params.delete("hogar");
        const cleanQuery = params.toString();
        const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}`;
        window.history.replaceState({}, "", cleanUrl);
      }
    }
    void provisionOrJoin(urlCode);
  }, [hydrateFromLocalStorage, provisionOrJoin]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("mercasabio_sync");
    channelRef.current = ch;
    ch.onmessage = (ev) => {
      const msg = ev.data as { type?: string; baskets?: SyncedBasket[]; profile?: UserProfile };
      if (msg?.type === "baskets_updated" && Array.isArray(msg.baskets)) {
        setBaskets((prev) => mergeSyncedBaskets(prev, msg.baskets ?? []));
      } else if (msg?.type === "profile_updated" && msg.profile) {
        setUserProfile(msg.profile);
      }
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocusOrOnline = () => {
      if (credentialsRef.current && navigator.onLine) {
        void refreshWorkspace();
      } else if (!navigator.onLine) {
        setSyncState("offline");
      }
    };
    window.addEventListener("online", onFocusOrOnline);
    window.addEventListener("focus", onFocusOrOnline);
    return () => {
      window.removeEventListener("online", onFocusOrOnline);
      window.removeEventListener("focus", onFocusOrOnline);
    };
  }, [refreshWorkspace]);

  const joinByHouseholdCode = useCallback(
    async (code: string) => provisionOrJoin(code.trim().toUpperCase()),
    [provisionOrJoin]
  );

  const removeDevice = useCallback(
    async (deviceId: string) => {
      setDevices((prev) => prev.filter((d) => d.deviceId !== deviceId));
      const creds = credentialsRef.current;
      if (!creds) return;
      await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(creds) },
        body: JSON.stringify({
          action: "remove_device",
          targetDeviceId: deviceId,
        }),
      }).catch(() => {});
    },
    [authHeaders]
  );

  const saveProfileAndPayments = useCallback(
    async ({
      profile,
      paymentMethods: methods,
    }: {
      profile: Partial<UserProfile>;
      paymentMethods: UserPaymentMethod[];
    }): Promise<boolean> => {
      const mergedProfile: UserProfile = {
        workspaceId: credentialsRef.current?.workspaceId ?? userProfile?.workspaceId ?? "local",
        displayName: profile.displayName ?? userProfile?.displayName ?? null,
        householdAdults: profile.householdAdults ?? userProfile?.householdAdults ?? 2,
        householdChildren: profile.householdChildren ?? userProfile?.householdChildren ?? 0,
        householdPets: profile.householdPets ?? userProfile?.householdPets ?? 0,
        monthlyBudgetCop: profile.monthlyBudgetCop ?? userProfile?.monthlyBudgetCop ?? 520000,
        weeklyBudgetCop: profile.weeklyBudgetCop ?? userProfile?.weeklyBudgetCop ?? 130000,
        shoppingCadence:
          profile.shoppingCadence ?? userProfile?.shoppingCadence ?? "biweekly",
        transportMode: profile.transportMode ?? userProfile?.transportMode ?? "walk",
        homeLat: profile.homeLat ?? userProfile?.homeLat ?? 4.646,
        homeLng: profile.homeLng ?? userProfile?.homeLng ?? -74.063,
        homeLabel: profile.homeLabel ?? userProfile?.homeLabel ?? "Bogotá · Chapinero",
        dietaryRestrictions:
          profile.dietaryRestrictions ?? userProfile?.dietaryRestrictions ?? [],
        preferredStoreIds:
          profile.preferredStoreIds ?? userProfile?.preferredStoreIds ?? [],
        onboardingCompletedAt:
          profile.onboardingCompletedAt ??
          userProfile?.onboardingCompletedAt ??
          new Date().toISOString(),
      };
      setUserProfile(mergedProfile);
      setPaymentMethods(methods);
      writeStoredJson(PROFILE_STORAGE_KEY, mergedProfile);
      writeStoredJson(PAYMENTS_STORAGE_KEY, methods);
      channelRef.current?.postMessage({ type: "profile_updated", profile: mergedProfile });

      const creds = credentialsRef.current;
      if (!creds) return true;
      setSyncState("syncing");
      try {
        const res = await fetch("/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders(creds) },
          body: JSON.stringify({
            action: "save_profile",
            profile: {
              display_name: mergedProfile.displayName,
              household_adults: mergedProfile.householdAdults,
              household_children: mergedProfile.householdChildren,
              household_pets: mergedProfile.householdPets,
              monthly_budget_cop: mergedProfile.monthlyBudgetCop,
              weekly_budget_cop: mergedProfile.weeklyBudgetCop,
              shopping_cadence: mergedProfile.shoppingCadence,
              transport_mode: mergedProfile.transportMode,
              home_lat: mergedProfile.homeLat,
              home_lng: mergedProfile.homeLng,
              home_label: mergedProfile.homeLabel,
              dietary_restrictions: mergedProfile.dietaryRestrictions,
              preferred_store_ids: mergedProfile.preferredStoreIds,
              onboarding_completed_at: mergedProfile.onboardingCompletedAt,
            },
            paymentMethods: methods.map((m) => ({
              partnerId: m.partnerId,
              productVariant: m.productVariant,
            })),
          }),
        });
        setSyncState(res.ok ? "synced" : "local");
        setLastSyncedAt(new Date().toISOString());
        return res.ok;
      } catch {
        setSyncState("local");
        return false;
      }
    },
    [authHeaders, userProfile]
  );

  const syncActiveBasket = useCallback(
    (items: BasketItemInput[], activeDietFilters?: DietFilter[]) => {
      const nowIso = new Date().toISOString();
      const wsId = credentialsRef.current?.workspaceId ?? "local";
      const existingBasket = baskets[0];
      const basketId = existingBasket?.id ?? "00000000-0000-0000-0000-000000000001";

      const localBasket: SyncedBasket = {
        id: basketId,
        workspaceId: wsId,
        title: existingBasket?.title ?? "Mi mercado principal",
        status: existingBasket?.status ?? "draft",
        isHabitual: existingBasket?.isHabitual ?? false,
        budgetCop: existingBasket?.budgetCop ?? null,
        optimizeMode: existingBasket?.optimizeMode ?? "generic",
        activeDietFilters: activeDietFilters ?? existingBasket?.activeDietFilters ?? [],
        transportMode: userProfile?.transportMode ?? "walk",
        maxStores: existingBasket?.maxStores ?? 2,
        radiusMeters: existingBasket?.radiusMeters ?? 1500,
        lastPlan: existingBasket?.lastPlan ?? null,
        lastPlanAt: existingBasket?.lastPlanAt ?? null,
        version: (existingBasket?.version ?? 0) + 1,
        updatedByDevice: credentialsRef.current?.deviceId ?? "local",
        createdAt: existingBasket?.createdAt ?? nowIso,
        updatedAt: nowIso,
        items: sanitizeBasketItemsForSnapshot(items).map((cleanPayload, idx) => {
          const it = items[idx];
          return {
            basketId,
            itemKey: it.itemKey,
            payload: cleanPayload,
            quantity: it.quantity ?? 1,
            isLocked: Boolean(it.locked),
            chosenStoreSkuId: it.anchorStoreSkuId ?? null,
            checkedAt: null,
            checkedByDevice: null,
            sortOrder: idx,
            version: 1,
            updatedAt: nowIso,
          };
        }),
      };

      setBaskets((prev) => {
        const rest = prev.slice(1);
        const next = [localBasket, ...rest];
        writeStoredJson(BASKETS_SYNC_KEY, next);
        channelRef.current?.postMessage({ type: "baskets_updated", baskets: next });
        return next;
      });

      const creds = credentialsRef.current;
      if (!creds) return;
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = window.setTimeout(() => {
        setSyncState("syncing");
        const cleanPayloads = sanitizeBasketItemsForSnapshot(items.slice(0, 60));
        void fetch("/api/baskets", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders(creds) },
          body: JSON.stringify({
            deviceId: creds.deviceId,
            ops: items.slice(0, 60).map((it, idx) => ({
              opId: `${creds.deviceId}-${it.itemKey}-${Date.now()}`,
              kind: "upsert_item",
              basketId,
              itemKey: it.itemKey,
              quantity: it.quantity ?? 1,
              isLocked: Boolean(it.locked),
              chosenStoreSkuId: it.anchorStoreSkuId ?? null,
              sortOrder: idx,
              payload: cleanPayloads[idx] ?? { label: it.label },
            })),
          }),
        })
          .then((res) => {
            setSyncState(res.ok ? "synced" : "local");
            if (res.ok) setLastSyncedAt(new Date().toISOString());
          })
          .catch(() => setSyncState("local"));
      }, 650);
    },
    [authHeaders, baskets, userProfile?.transportMode]
  );

  const recordPurchaseEvents = useCallback(
    async (events: PurchaseEventRecord[]) => {
      setPurchaseEvents((prev) => {
        const next = [...events, ...prev].slice(0, 120);
        writeStoredJson(PURCHASES_STORAGE_KEY, next);
        return next;
      });
      const creds = credentialsRef.current;
      if (!creds) return;
      await fetch("/api/baskets", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(creds) },
        body: JSON.stringify({
          deviceId: creds.deviceId,
          ops: [],
          purchaseEvents: events,
        }),
      }).catch(() => {});
    },
    [authHeaders]
  );

  const markAlertRead = useCallback(
    async (alertId: string) => {
      const nowIso = new Date().toISOString();
      setAlerts((prev) => {
        const next = prev.map((a) => (a.id === alertId ? { ...a, readAt: nowIso } : a));
        writeStoredJson(ALERTS_STORAGE_KEY, next);
        return next;
      });
      const creds = credentialsRef.current;
      if (!creds) return;
      await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders(creds) },
        body: JSON.stringify({ alertId, read: true }),
      }).catch(() => {});
    },
    [authHeaders]
  );

  const submitSabiometroVote = useCallback(
    async (vote: VoteSubmitInput) => {
      const creds = credentialsRef.current;
      if (!creds) {
        return { ok: false, error: "Espacio del hogar aún inicializando." };
      }
      try {
        const res = await fetch("/api/votes", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders(creds) },
          body: JSON.stringify(vote),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          score?: unknown;
          error?: string;
        };
        if (!res.ok) {
          return { ok: false, error: json.error ?? "No se pudo guardar tu voto" };
        }
        return { ok: true, score: json.score };
      } catch {
        return { ok: false, error: "Error de red al enviar voto" };
      }
    },
    [authHeaders]
  );

  const planTier: SubscriptionPlanTier = userProfile?.planTier ?? DEFAULT_PLAN_TIER;
  const favoriteLimit = useMemo(() => getFavoriteBasketLimit(planTier), [planTier]);

  const saveFavoriteBasket = useCallback(
    async (
      input: SaveFavoriteInput
    ): Promise<{ ok: boolean; errorCode?: string; message?: string }> => {
      const elig = evaluateFavoriteSaveEligibility({
        currentFavoritesCount: favorites.length,
        planTier,
        replacingFavoriteId: input.replaceId,
      });
      if (!elig.allowed) {
        return {
          ok: false,
          errorCode: "FAVORITE_LIMIT_REACHED",
          message: elig.reason ?? "Límite de mercados favoritos alcanzado.",
        };
      }

      const snapshotItems = sanitizeBasketItemsForSnapshot(input.items);
      const creds = credentialsRef.current;

      if (!creds) {
        const nowIso = new Date().toISOString();
        const nextFav: FavoriteBasketRecord = {
          id: input.replaceId ?? `local-fav-${Date.now()}`,
          workspaceId: "local",
          title: input.title.trim() || "Mi mercado favorito",
          optimizeMode: input.optimizeMode,
          itemsCount: snapshotItems.length,
          items: snapshotItems,
          activeDietFilters: input.activeDietFilters ?? [],
          estimatedTotalCop: input.estimatedTotalCop ?? 0,
          estimatedSavingsCop: input.estimatedSavingsCop ?? 0,
          storeSummary: input.storeSummary ?? "",
          zoneLabel: input.zoneLabel ?? "Bogotá · Chapinero",
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        setFavorites((prev) => {
          const next = input.replaceId
            ? prev.map((f) => (f.id === input.replaceId ? nextFav : f))
            : [nextFav, ...prev];
          writeStoredJson(FAVORITES_STORAGE_KEY, next);
          return next;
        });
        return { ok: true };
      }

      try {
        const res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders(creds) },
          body: JSON.stringify({
            title: input.title,
            optimizeMode: input.optimizeMode,
            items: snapshotItems,
            activeDietFilters: input.activeDietFilters ?? [],
            estimatedTotalCop: input.estimatedTotalCop ?? 0,
            estimatedSavingsCop: input.estimatedSavingsCop ?? 0,
            storeSummary: input.storeSummary ?? "",
            zoneLabel: input.zoneLabel ?? "Bogotá · Chapinero",
            replaceId: input.replaceId ?? null,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          favorites?: FavoriteBasketRecord[];
          errorCode?: string;
          message?: string;
          error?: string;
        };
        if (Array.isArray(json.favorites)) {
          setFavorites(json.favorites);
          writeStoredJson(FAVORITES_STORAGE_KEY, json.favorites);
        }
        if (!res.ok || json.ok === false) {
          return {
            ok: false,
            errorCode: json.errorCode ?? "SAVE_FAILED",
            message: json.message ?? json.error ?? "No se pudo guardar el mercado favorito.",
          };
        }
        return { ok: true };
      } catch {
        return { ok: false, errorCode: "NETWORK_ERROR", message: "Error de red al guardar favorito." };
      }
    },
    [authHeaders, favorites.length, planTier]
  );

  const removeFavoriteBasket = useCallback(
    async (favoriteId: string) => {
      setFavorites((prev) => {
        const next = prev.filter((f) => f.id !== favoriteId);
        writeStoredJson(FAVORITES_STORAGE_KEY, next);
        return next;
      });
      const creds = credentialsRef.current;
      if (!creds) return;
      try {
        const res = await fetch("/api/favorites", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", ...authHeaders(creds) },
          body: JSON.stringify({ favoriteId }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          favorites?: FavoriteBasketRecord[];
        };
        if (res.ok && Array.isArray(json.favorites)) {
          setFavorites(json.favorites);
          writeStoredJson(FAVORITES_STORAGE_KEY, json.favorites);
        }
      } catch {
        // Conserva eliminación local
      }
    },
    [authHeaders]
  );

  const unreadAlertsCount = useMemo(
    () => alerts.filter((a) => !a.readAt && !a.dismissedAt).length,
    [alerts]
  );

  const value: WorkspaceContextValue = {
    credentials,
    syncState,
    lastSyncedAt,
    userProfile,
    planTier,
    paymentMethods,
    baskets,
    favorites,
    favoriteLimit,
    devices,
    alerts,
    purchaseEvents,
    unreadAlertsCount,
    joinByHouseholdCode,
    removeDevice,
    saveProfileAndPayments,
    syncActiveBasket,
    saveFavoriteBasket,
    removeFavoriteBasket,
    recordPurchaseEvents,
    markAlertRead,
    submitSabiometroVote,
    refreshWorkspace,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace debe usarse dentro de <WorkspaceProvider>");
  }
  return ctx;
}
