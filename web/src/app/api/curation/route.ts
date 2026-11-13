import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { getAdminCurationData } from "@/lib/queries";
import { getSupabaseConfig, supabaseRpc } from "@/lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_REPORT_REASONS = new Set([
  "distinta_calidad",
  "distinto_producto",
  "tamano_incomparable",
  "otro",
]);
const VALID_MATCH_TIERS = new Set(["direct", "similar", "bulk", "offer"]);
const VALID_QUALITY_TIERS = new Set(["economico", "estandar", "premium", "especial"]);
const VALID_RULE_TYPES = new Set([
  "blocked_pair",
  "approved_same_tier",
  "approved_substitute",
]);
const VALID_ADMIN_ACTIONS = new Set([
  "set_product_curation",
  "exclude_sku",
  "set_pair_rule",
  "remove_pair_rule",
  "dismiss_report",
  "resolve_report",
]);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);

  try {
    const payload = await getAdminCurationData({ query });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/curation] Error cargando panel de curación:", error);
    return NextResponse.json(
      { error: "No fue posible cargar los datos de curación." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  const supabaseConfig = getSupabaseConfig();

  if (action === "report_unfair") {
    const anchorSkuId = body.anchorSkuId;
    const comparedSkuId = body.comparedSkuId;
    const reason =
      typeof body.reason === "string" && VALID_REPORT_REASONS.has(body.reason)
        ? body.reason
        : "otro";
    const matchTier =
      typeof body.matchTier === "string" && VALID_MATCH_TIERS.has(body.matchTier)
        ? body.matchTier
        : "direct";
    const comment =
      typeof body.comment === "string" ? body.comment.trim().slice(0, 250) : "";

    if (!isUuid(anchorSkuId) || !isUuid(comparedSkuId) || anchorSkuId === comparedSkuId) {
      return NextResponse.json(
        { error: "Se requieren dos SKUs válidos y distintos para reportar." },
        { status: 400 }
      );
    }

    if (!supabaseConfig) {
      return NextResponse.json({ ok: true, demo: true, reportId: "demo-report" });
    }

    try {
      const reportId = await supabaseRpc<string>(
        supabaseConfig,
        "submit_comparison_report",
        {
          p_anchor_sku_id: anchorSkuId.trim(),
          p_compared_sku_id: comparedSkuId.trim(),
          p_reason: reason,
          p_match_tier: matchTier,
          p_comment: comment,
        }
      );

      try {
        revalidatePath("/admin");
      } catch {
        // En entornos edge sin tag cache, la respuesta sigue siendo exitosa
      }
      return NextResponse.json({ ok: true, reportId });
    } catch (error) {
      console.error("[api/curation] Error registrando reporte:", error);
      return NextResponse.json(
        { error: "No fue posible registrar el reporte de comparación." },
        { status: 500 }
      );
    }
  }

  if (!VALID_ADMIN_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Acción de curación inválida." }, { status: 400 });
  }

  const storeSkuId = isUuid(body.storeSkuId) ? body.storeSkuId.trim() : null;
  const secondSkuId = isUuid(body.secondSkuId) ? body.secondSkuId.trim() : null;
  const reportId = isUuid(body.reportId) ? body.reportId.trim() : null;

  const qualityTier =
    typeof body.qualityTier === "string" && VALID_QUALITY_TIERS.has(body.qualityTier)
      ? body.qualityTier
      : null;
  const ruleType =
    typeof body.ruleType === "string" && VALID_RULE_TYPES.has(body.ruleType)
      ? body.ruleType
      : null;
  const rawSubtype = typeof body.subtype === "string" ? body.subtype.trim().toLowerCase() : "";
  const subtype = /^[a-z0-9_:-]{1,80}$/.test(rawSubtype) ? rawSubtype : null;
  const rawBroad =
    typeof body.broadFamily === "string" ? body.broadFamily.trim().toLowerCase() : "";
  const broadFamily = /^[a-z0-9_:-]{1,80}$/.test(rawBroad) ? rawBroad : null;
  const notes =
    typeof body.notes === "string" ? body.notes.trim().slice(0, 300) || null : null;

  if (!supabaseConfig) {
    return NextResponse.json({ ok: true, demo: true, action });
  }

  try {
    const result = await supabaseRpc<Record<string, unknown>>(
      supabaseConfig,
      "apply_admin_curation",
      {
        p_action: action,
        p_store_sku_id: storeSkuId,
        p_second_sku_id: secondSkuId,
        p_quality_tier: qualityTier,
        p_subtype: subtype,
        p_broad_family: broadFamily,
        p_rule_type: ruleType,
        p_report_id: reportId,
        p_notes: notes,
      }
    );

    try {
      revalidatePath("/");
      revalidatePath("/admin");
    } catch {
      // En entornos edge sin tag cache, la respuesta sigue siendo exitosa
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/curation] Error aplicando curación admin:", error);
    return NextResponse.json(
      { error: "No fue posible guardar el cambio de curación." },
      { status: 500 }
    );
  }
}
