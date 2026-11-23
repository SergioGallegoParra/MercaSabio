import { NextRequest, NextResponse } from "next/server";

import {
  extractWorkspaceAuth,
  PRIVATE_NO_STORE_HEADERS,
  requireSupabaseOrRespond,
} from "@/lib/apiWorkspaceAuth";
import {
  buildPendingVerificationResponse,
  NIVEL_2_QR_ENABLED,
  parseDianQrPayload,
} from "@/lib/purchaseVerification";
import { supabaseRpc } from "@/lib/supabase";

/**
 * Módulo Nivel 2 QR DIAN: creado y cableado, pendiente de activación (`NIVEL_2_QR_ENABLED = false`).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { workspaceId, sessionToken } = extractWorkspaceAuth(request, body);
  const rawQrText = typeof body.qrPayload === "string" ? body.qrPayload : "";
  const parsed = parseDianQrPayload(rawQrText);

  if (!NIVEL_2_QR_ENABLED) {
    if (workspaceId && sessionToken && parsed.cufe) {
      const sb = requireSupabaseOrRespond();
      if (sb.config) {
        const stub = await supabaseRpc<Record<string, unknown>>(
          sb.config,
          "register_purchase_verification_stub",
          {
            p_workspace_id: workspaceId,
            p_session_token: sessionToken,
            p_cufe: parsed.cufe,
            p_verification_method: "qr_dian",
            p_store_id: typeof body.storeId === "string" ? body.storeId : null,
            p_invoice_total: parsed.invoiceTotalCop,
          },
        ).catch(() => null);
        if (stub) {
          return NextResponse.json(stub, {
            status: 202,
            headers: PRIVATE_NO_STORE_HEADERS,
          });
        }
      }
    }

    return NextResponse.json(buildPendingVerificationResponse(parsed), {
      status: 202,
      headers: PRIVATE_NO_STORE_HEADERS,
    });
  }

  return NextResponse.json(
    { error: "Verificación automática aún pendiente." },
    { status: 501, headers: PRIVATE_NO_STORE_HEADERS },
  );
}
