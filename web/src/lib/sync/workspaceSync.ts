import type { DietFilter, SyncedBasket, SyncedBasketItem } from "../types.ts";

export const WORKSPACE_CREDENTIALS_KEY = "mercasabio_v3_workspace_creds";
export const WORKSPACE_CACHE_KEY = "mercasabio_v3_workspace_cache";
export const PENDING_OPS_KEY = "mercasabio_v3_pending_ops";

export interface WorkspaceCredentials {
  workspaceId: string;
  householdCode: string;
  sessionToken: string;
  deviceId: string;
  deviceName: string;
  deviceKind: "desktop" | "mobile" | "tablet";
}

export type SyncConnectionState = "synced" | "saving" | "offline" | "error";

export interface SyncOp {
  opId: string;
  kind: "upsert_basket" | "upsert_item" | "delete_item" | "toggle_check";
  basketId: string;
  itemKey?: string;
  id?: string;
  baseVersion?: number;
  title?: string;
  status?: SyncedBasket["status"];
  isHabitual?: boolean;
  budgetCop?: number | null;
  optimizeMode?: "my_brands" | "generic";
  activeDietFilters?: DietFilter[];
  transportMode?: string | null;
  maxStores?: number;
  radiusMeters?: number | null;
  lastPlan?: Record<string, unknown> | null;
  payload?: Record<string, unknown>;
  quantity?: number;
  isLocked?: boolean;
  chosenStoreSkuId?: string | null;
  checked?: boolean;
  checkedAt?: string | null;
  checkedByDevice?: string;
  sortOrder?: number;
}

/** Detecta amablemente si el dispositivo actual suele usarse en móvil o escritorio. */
export function detectDeviceInfo(): {
  deviceName: string;
  deviceKind: "desktop" | "mobile" | "tablet";
} {
  if (typeof navigator === "undefined") {
    return { deviceName: "Servidor", deviceKind: "desktop" };
  }
  const ua = navigator.userAgent || "";
  if (/iPhone|Android.*Mobile|Mobile/i.test(ua)) {
    return { deviceName: "Celular (Navegador/App)", deviceKind: "mobile" };
  }
  if (/iPad|Tablet/i.test(ua)) {
    return { deviceName: "Tableta", deviceKind: "tablet" };
  }
  if (/Windows/i.test(ua)) return { deviceName: "PC Windows", deviceKind: "desktop" };
  if (/Macintosh/i.test(ua)) return { deviceName: "Mac Escritorio", deviceKind: "desktop" };
  return { deviceName: "Navegador Escritorio", deviceKind: "desktop" };
}

/** Reduce el tamaño de un BasketPlan antes de persistirlo en last_plan (< 50 KB). */
export function compactPlanSnapshot(
  plan: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!plan) return null;
  const clone = { ...plan } as Record<string, unknown>;
  if (Array.isArray(clone.storeStops)) {
    clone.storeStops = clone.storeStops.map((stop) => {
      if (!stop || typeof stop !== "object") return stop;
      const s = { ...(stop as Record<string, unknown>) };
      if (Array.isArray(s.allocations)) {
        s.allocations = s.allocations.map((alloc) => {
          if (!alloc || typeof alloc !== "object") return alloc;
          const a = { ...(alloc as Record<string, unknown>) };
          delete a.alternativesInStore;
          return a;
        });
      }
      return s;
    });
  }
  return clone;
}

/**
 * Resolución determinista de conflictos PC <-> Celular por ítem:
 * - Borrado (`deletedAt`) gana sobre versión menor.
 * - `checkedAt`: conserva el marcado más reciente en tienda para no perder chulos en el pasillo.
 * - `quantity`, `isLocked`, `payload`: gana mayor `version` o `updatedAt`.
 */
export function mergeSyncedBasketItem(
  local: SyncedBasketItem | undefined,
  remote: SyncedBasketItem,
): SyncedBasketItem {
  if (!local) return remote;

  if (remote.deletedAt && (!local.updatedAt || remote.updatedAt >= local.updatedAt)) {
    return remote;
  }
  if (local.deletedAt && local.version > remote.version) {
    return local;
  }

  const newer = remote.version >= local.version ? remote : local;

  let chosenCheckedAt = newer.checkedAt ?? null;
  let chosenCheckedDevice = newer.checkedByDevice ?? null;

  if (local.checkedAt && (!remote.checkedAt || local.checkedAt > remote.checkedAt)) {
    chosenCheckedAt = local.checkedAt;
    chosenCheckedDevice = local.checkedByDevice ?? null;
  } else if (remote.checkedAt && (!local.checkedAt || remote.checkedAt >= local.checkedAt)) {
    chosenCheckedAt = remote.checkedAt;
    chosenCheckedDevice = remote.checkedByDevice ?? null;
  }

  return {
    ...newer,
    checkedAt: chosenCheckedAt,
    checkedByDevice: chosenCheckedDevice,
  };
}

/** Reconcilia dos arreglos de canastas compartidas preservando versiones más recientes y chulos de compra. */
export function mergeSyncedBaskets(
  localBaskets: SyncedBasket[],
  remoteBaskets: SyncedBasket[],
): SyncedBasket[] {
  const map = new Map<string, SyncedBasket>();
  for (const b of localBaskets) {
    map.set(b.id, b);
  }
  for (const remote of remoteBaskets) {
    const local = map.get(remote.id);
    if (!local) {
      map.set(remote.id, remote);
      continue;
    }
    const baseHeader = remote.version >= local.version ? remote : local;
    const itemMap = new Map<string, SyncedBasketItem>();
    for (const li of local.items) {
      itemMap.set(li.itemKey, li);
    }
    for (const ri of remote.items) {
      itemMap.set(ri.itemKey, mergeSyncedBasketItem(itemMap.get(ri.itemKey), ri));
    }
    map.set(remote.id, {
      ...baseHeader,
      items: [...itemMap.values()].filter((i) => !i.deletedAt),
    });
  }

  return [...map.values()]
    .filter((b) => b.status !== "archived")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function loadLocalWorkspaceCredentials(): WorkspaceCredentials | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceCredentials;
    if (!parsed.workspaceId || !parsed.sessionToken || !parsed.householdCode) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalWorkspaceCredentials(creds: WorkspaceCredentials): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_CREDENTIALS_KEY, JSON.stringify(creds));
  } catch {
    // ignorar cuota llena en modo privado
  }
}

export function loadPendingOps(): SyncOp[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_OPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePendingOps(ops: SyncOp[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(ops));
  } catch {
    // ignorar cuota llena
  }
}
