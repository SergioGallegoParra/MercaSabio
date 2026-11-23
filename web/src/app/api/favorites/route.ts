import { NextRequest, NextResponse } from "next/server";

import {
  checkFeatureGateOrRespond,
  extractWorkspaceAuth,
  PRIVATE_NO_STORE_HEADERS,
  requireSupabaseOrRespond,
} from "@/lib/apiWorkspaceAuth";
import { FAVORITE_BASKET_LIMITS } from "@/lib/featureAccess";
import { supabaseRpc } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { workspaceId, sessionToken } = extractWorkspaceAuth(request);
  if (!workspaceId || !sessionToken) {
    return NextResponse.json(
      { error: "Faltan credenciales del hogar." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  try {
    const data = await supabaseRpc<Record<string, unknown>>(
      sb.config,
      "get_workspace_favorites",
      {
        p_workspace_id: workspaceId,
        p_session_token: sessionToken,
      },
    );
    return NextResponse.json(
      {
        planTier: data.planTier ?? "free",
        limit: Number(data.limit ?? FAVORITE_BASKET_LIMITS.free),
        favorites: Array.isArray(data.favorites) ? data.favorites : [],
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[api/favorites GET]", error);
    return NextResponse.json(
      { error: "No fue posible cargar tus mercados favoritos." },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("favorite_baskets", request);
  if (gateResp) return gateResp;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { workspaceId, sessionToken } = extractWorkspaceAuth(request, body);
  if (!workspaceId || !sessionToken) {
    return NextResponse.json(
      { error: "Faltan credenciales del hogar." },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  const itemsPayload = Array.isArray(body.items) ? body.items : [];
  if (itemsPayload.length === 0) {
    return NextResponse.json(
      { error: "Agrega al menos un producto para guardar el mercado favorito." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  try {
    const res = await supabaseRpc<Record<string, unknown>>(
      sb.config,
      "save_workspace_favorite",
      {
        p_workspace_id: workspaceId,
        p_session_token: sessionToken,
        p_title: typeof body.title === "string" ? body.title : "Mi mercado favorito",
        p_optimize_mode: body.optimizeMode === "my_brands" ? "my_brands" : "generic",
        p_items_payload: itemsPayload,
        p_active_diet_filters: Array.isArray(body.activeDietFilters)
          ? body.activeDietFilters
          : [],
        p_estimated_total_cop:
          typeof body.estimatedTotalCop === "number" ? body.estimatedTotalCop : 0,
        p_estimated_savings_cop:
          typeof body.estimatedSavingsCop === "number" ? body.estimatedSavingsCop : 0,
        p_store_summary: typeof body.storeSummary === "string" ? body.storeSummary : "",
        p_zone_label:
          typeof body.zoneLabel === "string" ? body.zoneLabel : "Bogotá · Chapinero",
        p_replace_id: typeof body.replaceId === "string" ? body.replaceId : null,
      },
    );

    if (res.ok === false) {
      return NextResponse.json(res, { status: 409, headers: PRIVATE_NO_STORE_HEADERS });
    }

    return NextResponse.json(res, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("[api/favorites POST]", error);
    return NextResponse.json(
      { error: "No fue posible guardar tu mercado favorito." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("favorite_baskets", request);
  if (gateResp) return gateResp;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { workspaceId, sessionToken } = extractWorkspaceAuth(request, body);
  const favoriteId =
    typeof body.favoriteId === "string"
      ? body.favoriteId
      : request.nextUrl.searchParams.get("favoriteId");

  if (!workspaceId || !sessionToken || !favoriteId) {
    return NextResponse.json(
      { error: "Faltan credenciales o el identificador del favorito." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  try {
    const res = await supabaseRpc<Record<string, unknown>>(
      sb.config,
      "delete_workspace_favorite",
      {
        p_workspace_id: workspaceId,
        p_session_token: sessionToken,
        p_favorite_id: favoriteId,
      },
    );
    return NextResponse.json(res, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("[api/favorites DELETE]", error);
    return NextResponse.json(
      { error: "No fue posible eliminar el mercado favorito." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
