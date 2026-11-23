import { NextRequest, NextResponse } from "next/server";

import {
  checkFeatureGateOrRespond,
  extractWorkspaceAuth,
  PRIVATE_NO_STORE_HEADERS,
  requireSupabaseOrRespond,
} from "@/lib/apiWorkspaceAuth";
import { supabaseRpc } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("household_report", request);
  if (gateResp) return gateResp;

  const { workspaceId, sessionToken } = extractWorkspaceAuth(request);
  if (!workspaceId || !sessionToken) {
    return NextResponse.json({ reports: [] }, { headers: PRIVATE_NO_STORE_HEADERS });
  }

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  try {
    const reports = await supabaseRpc<unknown[]>(sb.config, "get_workspace_reports", {
      p_workspace_id: workspaceId,
      p_session_token: sessionToken,
      p_kind: "household_size",
    });
    return NextResponse.json({ reports }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("[api/reports/household GET]", error);
    return NextResponse.json({ error: "No fue posible leer informes." }, { status: 500, headers: PRIVATE_NO_STORE_HEADERS });
  }
}

export async function POST(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("household_report", request);
  if (gateResp) return gateResp;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { workspaceId, sessionToken } = extractWorkspaceAuth(request, body);
  if (!workspaceId || !sessionToken || !body.payload) {
    return NextResponse.json({ error: "Faltan datos del informe." }, { status: 400, headers: PRIVATE_NO_STORE_HEADERS });
  }

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  try {
    const kind =
      body.kind === "inflation_monthly" || body.kind === "payment_calendar"
        ? body.kind
        : "household_size";
    const id = await supabaseRpc<string>(sb.config, "save_workspace_report", {
      p_workspace_id: workspaceId,
      p_session_token: sessionToken,
      p_kind: kind,
      p_period: new Date().toISOString().slice(0, 10),
      p_payload: body.payload,
    });
    return NextResponse.json({ id, ok: true }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("[api/reports/household POST]", error);
    return NextResponse.json({ error: "No fue posible guardar el informe." }, { status: 500, headers: PRIVATE_NO_STORE_HEADERS });
  }
}
