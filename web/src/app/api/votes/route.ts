import { NextRequest, NextResponse } from "next/server";

import {
  checkFeatureGateOrRespond,
  extractWorkspaceAuth,
  PRIVATE_NO_STORE_HEADERS,
  requireSupabaseOrRespond,
} from "@/lib/apiWorkspaceAuth";
import { supabaseRpc } from "@/lib/supabase";

const ALLOWED_SATISFACTION = new Set([1, 0.75, 0.25, 0]);
const ALLOWED_YIELD = new Set([0.5, 1, 1.5]);

export async function POST(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("sabiometro_vote", request);
  if (gateResp) return gateResp;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { workspaceId, sessionToken } = extractWorkspaceAuth(request, body);
  const masterProductId =
    typeof body.masterProductId === "string" ? body.masterProductId.trim() : "";
  const satisfaction = Number(body.satisfaction);
  const yieldFactor = Number(body.yieldFactor);
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 500) : null;

  if (!workspaceId || !sessionToken || !masterProductId) {
    return NextResponse.json(
      { error: "Falta identificador del producto o espacio del hogar." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  if (!ALLOWED_SATISFACTION.has(satisfaction) || !ALLOWED_YIELD.has(yieldFactor)) {
    return NextResponse.json(
      { error: "Valores de voto fuera de escala permitida." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  try {
    const rawScore = await supabaseRpc<Record<string, unknown>>(
      sb.config,
      "submit_workspace_vote",
      {
        p_workspace_id: workspaceId,
        p_session_token: sessionToken,
        p_master_product_id: masterProductId,
        p_satisfaction: satisfaction,
        p_yield_factor: yieldFactor,
        p_comment: comment,
      },
    );
    return NextResponse.json(
      { score: rawScore, ok: true },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[api/votes POST]", error);
    return NextResponse.json(
      { error: "No fue posible registrar tu calificación en el Sabiómetro." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
