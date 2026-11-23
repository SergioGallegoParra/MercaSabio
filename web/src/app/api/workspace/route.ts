import { NextRequest, NextResponse } from "next/server";

import {
  extractWorkspaceAuth,
  PRIVATE_NO_STORE_HEADERS,
  requireSupabaseOrRespond,
} from "@/lib/apiWorkspaceAuth";
import { supabaseRpc } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { workspaceId, sessionToken } = extractWorkspaceAuth(request);
  if (!workspaceId || !sessionToken) {
    return NextResponse.json(
      { error: "Faltan credenciales locales del hogar." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  try {
    const bundle = await supabaseRpc<Record<string, unknown>>(sb.config, "get_workspace_bundle", {
      p_workspace_id: workspaceId,
      p_session_token: sessionToken,
    });
    return NextResponse.json(bundle, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("[api/workspace GET]", error);
    return NextResponse.json(
      { error: "No fue posible consultar el hogar." },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "provision";
  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  try {
    if (action === "provision" || action === "join") {
      const householdCode =
        action === "join" && typeof body.householdCode === "string"
          ? body.householdCode.trim()
          : null;
      if (action === "join" && !householdCode) {
        return NextResponse.json(
          { error: "Ingresa tu Código de Hogar (ej. HOGAR-XXXXXX)." },
          { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
        );
      }

      const provisioned = await supabaseRpc<{
        workspaceId: string;
        householdCode: string;
        sessionToken: string;
        deviceId: string;
        joined: boolean;
      }>(sb.config, "provision_or_join_workspace", {
        p_household_code: householdCode,
        p_device_id: typeof body.deviceId === "string" ? body.deviceId : "web-default",
        p_device_name: typeof body.deviceName === "string" ? body.deviceName : "Navegador",
        p_device_kind: typeof body.deviceKind === "string" ? body.deviceKind : "desktop",
      });

      const bundle = await supabaseRpc<Record<string, unknown>>(
        sb.config,
        "get_workspace_bundle",
        {
          p_workspace_id: provisioned.workspaceId,
          p_session_token: provisioned.sessionToken,
        },
      );

      return NextResponse.json(
        { credentials: provisioned, ...bundle },
        { headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    const { workspaceId, sessionToken } = extractWorkspaceAuth(request, body);
    if (!workspaceId || !sessionToken) {
      return NextResponse.json(
        { error: "Faltan credenciales del hogar." },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    if (action === "save_profile") {
      const updated = await supabaseRpc<Record<string, unknown>>(
        sb.config,
        "save_workspace_profile",
        {
          p_workspace_id: workspaceId,
          p_session_token: sessionToken,
          p_profile: body.profile ?? {},
          p_payment_methods: Array.isArray(body.paymentMethods) ? body.paymentMethods : null,
        },
      );
      return NextResponse.json(updated, { headers: PRIVATE_NO_STORE_HEADERS });
    }

    if (action === "remove_device" && typeof body.targetDeviceId === "string") {
      await supabaseRpc<boolean>(sb.config, "remove_workspace_device", {
        p_workspace_id: workspaceId,
        p_session_token: sessionToken,
        p_device_id: body.targetDeviceId,
      });
      const bundle = await supabaseRpc<Record<string, unknown>>(
        sb.config,
        "get_workspace_bundle",
        { p_workspace_id: workspaceId, p_session_token: sessionToken },
      );
      return NextResponse.json(bundle, { headers: PRIVATE_NO_STORE_HEADERS });
    }

    return NextResponse.json(
      { error: "Acción de hogar no reconocida." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error en espacio de hogar";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
