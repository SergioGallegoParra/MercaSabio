import { NextRequest, NextResponse } from "next/server";

import { isFeatureUnlocked } from "@/lib/featureAccess";
import { getSupabaseConfig } from "@/lib/supabase";
import type { GatedFeature } from "@/lib/types";

export const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

export function extractWorkspaceAuth(
  request: NextRequest,
  body?: Record<string, unknown> | null,
): { workspaceId: string | null; sessionToken: string | null } {
  const headerWs = request.headers.get("x-workspace-id")?.trim() || null;
  const headerToken = request.headers.get("x-workspace-token")?.trim() || null;
  const bodyWs =
    typeof body?.workspaceId === "string" ? body.workspaceId.trim() : null;
  const bodyToken =
    typeof body?.sessionToken === "string" ? body.sessionToken.trim() : null;
  const queryWs = request.nextUrl.searchParams.get("workspaceId")?.trim() || null;
  const queryToken =
    request.nextUrl.searchParams.get("sessionToken")?.trim() || null;

  return {
    workspaceId: headerWs || bodyWs || queryWs,
    sessionToken: headerToken || bodyToken || queryToken,
  };
}

export function checkFeatureGateOrRespond(
  feature: GatedFeature,
  request: NextRequest,
): NextResponse | null {
  const registeredUserId = request.headers.get("x-auth-user-id");
  const unlocked = isFeatureUnlocked(feature, {
    id: registeredUserId,
    isRegistered: Boolean(registeredUserId),
  });
  if (!unlocked) {
    return NextResponse.json(
      {
        error: "Esta funcionalidad requiere iniciar sesión.",
        feature,
        requiresAuth: true,
      },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return null;
}

export function requireSupabaseOrRespond(): {
  config: NonNullable<ReturnType<typeof getSupabaseConfig>>;
  errorResponse?: undefined;
} | {
  config?: undefined;
  errorResponse: NextResponse;
} {
  const config = getSupabaseConfig();
  if (!config) {
    return {
      errorResponse: NextResponse.json(
        { error: "Servicio de sincronización en modo demo local.", isDemoData: true },
        { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
      ),
    };
  }
  return { config };
}
