import { NextRequest, NextResponse } from "next/server";

import {
  checkFeatureGateOrRespond,
  extractWorkspaceAuth,
  PRIVATE_NO_STORE_HEADERS,
  requireSupabaseOrRespond,
} from "@/lib/apiWorkspaceAuth";
import { supabaseRpc } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("alerts_replenish", request);
  if (gateResp) return gateResp;

  const { workspaceId, sessionToken } = extractWorkspaceAuth(request);
  if (!workspaceId || !sessionToken) {
    return NextResponse.json({ alerts: [], prefs: null }, { headers: PRIVATE_NO_STORE_HEADERS });
  }

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  try {
    const res = await supabaseRpc<Record<string, unknown>>(sb.config, "get_workspace_alerts", {
      p_workspace_id: workspaceId,
      p_session_token: sessionToken,
    });
    return NextResponse.json(res, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("[api/alerts GET]", error);
    return NextResponse.json({ error: "No fue posible consultar alertas." }, { status: 500, headers: PRIVATE_NO_STORE_HEADERS });
  }
}

export async function POST(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("alerts_replenish", request);
  if (gateResp) return gateResp;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { workspaceId, sessionToken } = extractWorkspaceAuth(request, body);
  if (
    !workspaceId ||
    !sessionToken ||
    typeof body.kind !== "string" ||
    typeof body.title !== "string" ||
    typeof body.body !== "string" ||
    typeof body.dedupeKey !== "string"
  ) {
    return NextResponse.json({ error: "Datos incompletos para alerta." }, { status: 400, headers: PRIVATE_NO_STORE_HEADERS });
  }

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  try {
    const id = await supabaseRpc<string>(sb.config, "upsert_workspace_alert", {
      p_workspace_id: workspaceId,
      p_session_token: sessionToken,
      p_kind: body.kind,
      p_title: body.title,
      p_body: body.body,
      p_dedupe_key: body.dedupeKey,
      p_deep_link: typeof body.deepLink === "string" ? body.deepLink : null,
      p_payload: body.payload ?? null,
    });
    return NextResponse.json({ id, ok: true }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("[api/alerts POST]", error);
    return NextResponse.json({ error: "No fue posible registrar la alerta." }, { status: 500, headers: PRIVATE_NO_STORE_HEADERS });
  }
}

export async function PATCH(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("alerts_replenish", request);
  if (gateResp) return gateResp;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { workspaceId, sessionToken } = extractWorkspaceAuth(request, body);
  const alertId = typeof body.alertId === "string" ? body.alertId : "";
  if (!workspaceId || !sessionToken || !alertId) {
    return NextResponse.json({ error: "alertId y credenciales requeridos." }, { status: 400, headers: PRIVATE_NO_STORE_HEADERS });
  }

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  try {
    await supabaseRpc<boolean>(sb.config, "mark_workspace_alert_state", {
      p_workspace_id: workspaceId,
      p_session_token: sessionToken,
      p_alert_id: alertId,
      p_read: typeof body.read === "boolean" ? body.read : null,
      p_dismiss: typeof body.dismiss === "boolean" ? body.dismiss : null,
    });
    return NextResponse.json({ ok: true }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("[api/alerts PATCH]", error);
    return NextResponse.json({ error: "No fue posible actualizar la alerta." }, { status: 500, headers: PRIVATE_NO_STORE_HEADERS });
  }
}
