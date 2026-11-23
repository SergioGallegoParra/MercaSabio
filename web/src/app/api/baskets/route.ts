import { NextRequest, NextResponse } from "next/server";

import {
  checkFeatureGateOrRespond,
  extractWorkspaceAuth,
  PRIVATE_NO_STORE_HEADERS,
  requireSupabaseOrRespond,
} from "@/lib/apiWorkspaceAuth";
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
    const baskets = await supabaseRpc<unknown[]>(sb.config, "get_workspace_baskets", {
      p_workspace_id: workspaceId,
      p_session_token: sessionToken,
    });
    return NextResponse.json({ baskets }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("[api/baskets GET]", error);
    return NextResponse.json(
      { error: "No fue posible cargar tus mercados." },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("multi_device_sync", request);
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

  try {
    const result = await supabaseRpc<Record<string, unknown>>(
      sb.config,
      "apply_workspace_basket_ops",
      {
        p_workspace_id: workspaceId,
        p_session_token: sessionToken,
        p_device_id: typeof body.deviceId === "string" ? body.deviceId : "web",
        p_ops: Array.isArray(body.ops) ? body.ops : [],
      },
    );

    if (Array.isArray(body.purchaseEvents) && body.purchaseEvents.length > 0) {
      await supabaseRpc<number>(sb.config, "record_workspace_purchase_events", {
        p_workspace_id: workspaceId,
        p_session_token: sessionToken,
        p_events: body.purchaseEvents,
      }).catch((err) => console.warn("[api/baskets] purchaseEvents opcionales fallaron:", err));
    }

    return NextResponse.json(result, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("[api/baskets POST]", error);
    return NextResponse.json(
      { error: "No fue posible sincronizar los cambios." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
