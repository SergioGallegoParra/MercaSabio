import { NextRequest, NextResponse } from "next/server";

import {
  checkFeatureGateOrRespond,
  extractWorkspaceAuth,
  PRIVATE_NO_STORE_HEADERS,
  requireSupabaseOrRespond,
} from "@/lib/apiWorkspaceAuth";
import { FALLBACK_COMMUNITY_BASKETS } from "@/lib/communityBaskets";
import { getSupabaseConfig, supabaseRpc } from "@/lib/supabase";
import type { CommunityBasketRecord, CommunityCategoryTag, DietFilter } from "@/lib/types";

interface RawCommunityRow {
  id: string;
  author_alias: string;
  title: string;
  description: string | null;
  category_tag: CommunityCategoryTag;
  zone_label: string;
  items_count: number;
  items_payload: Record<string, unknown>[];
  active_diet_filters: DietFilter[];
  estimated_total_cop: number | string;
  estimated_savings_cop: number | string;
  estimated_savings_pct: number | string;
  store_summary: string;
  avg_sabiometro: number | string | null;
  copies_count: number;
  created_at: string;
}

function mapCommunityRow(row: RawCommunityRow): CommunityBasketRecord {
  return {
    id: row.id,
    authorAlias: row.author_alias,
    title: row.title,
    description: row.description,
    categoryTag: row.category_tag,
    zoneLabel: row.zone_label,
    itemsCount: Number(row.items_count ?? 0),
    items: Array.isArray(row.items_payload) ? row.items_payload : [],
    activeDietFilters: Array.isArray(row.active_diet_filters) ? row.active_diet_filters : [],
    estimatedTotalCop: Number(row.estimated_total_cop ?? 0),
    estimatedSavingsCop: Number(row.estimated_savings_cop ?? 0),
    estimatedSavingsPct: Number(row.estimated_savings_pct ?? 0),
    storeSummary: row.store_summary ?? "Multi-tienda",
    avgSabiometro: row.avg_sabiometro != null ? Number(row.avg_sabiometro) : null,
    copiesCount: Number(row.copies_count ?? 0),
    createdAt: row.created_at,
  };
}

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category")?.trim() || "all";
  const config = getSupabaseConfig();
  if (!config) {
    const filtered =
      category === "all"
        ? FALLBACK_COMMUNITY_BASKETS
        : FALLBACK_COMMUNITY_BASKETS.filter((b) => b.categoryTag === category);
    return NextResponse.json({ baskets: filtered, isDemoData: true });
  }

  try {
    const rows = await supabaseRpc<RawCommunityRow[]>(config, "list_community_baskets", {
      p_category: category,
      p_limit: 24,
    });
    return NextResponse.json({
      baskets: rows.map(mapCommunityRow),
      isDemoData: false,
    });
  } catch (error) {
    console.error("[api/community-baskets GET]", error);
    return NextResponse.json(
      { baskets: FALLBACK_COMMUNITY_BASKETS, isDemoData: true, warning: "fallback" },
      { status: 200 },
    );
  }
}

export async function POST(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("community_baskets", request);
  if (gateResp) return gateResp;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action === "copy" ? "copy" : "publish";

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) return sb.errorResponse;

  if (action === "copy") {
    const communityBasketId =
      typeof body.communityBasketId === "string" ? body.communityBasketId : null;
    if (!communityBasketId) {
      return NextResponse.json(
        { error: "Falta el identificador del mercado a copiar." },
        { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    try {
      const res = await supabaseRpc<Record<string, unknown>>(
        sb.config,
        "record_community_basket_copy",
        { p_community_basket_id: communityBasketId },
      );
      return NextResponse.json(res, { headers: PRIVATE_NO_STORE_HEADERS });
    } catch (error) {
      console.error("[api/community-baskets POST copy]", error);
      return NextResponse.json(
        { error: "No fue posible registrar la copia del mercado." },
        { status: 404, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
  }

  const { workspaceId, sessionToken } = extractWorkspaceAuth(request, body);
  if (!workspaceId || !sessionToken) {
    return NextResponse.json(
      { error: "Faltan credenciales del hogar para publicar." },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const itemsPayload = Array.isArray(body.items) ? body.items : [];
  if (itemsPayload.length === 0) {
    return NextResponse.json(
      { error: "Tu canasta debe tener al menos 1 producto para publicarla." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  try {
    const res = await supabaseRpc<Record<string, unknown>>(
      sb.config,
      "publish_community_basket",
      {
        p_workspace_id: workspaceId,
        p_session_token: sessionToken,
        p_author_alias:
          typeof body.authorAlias === "string" && body.authorAlias.trim()
            ? body.authorAlias.trim()
            : "Hogar MercaSabio",
        p_title: typeof body.title === "string" ? body.title : "Mi mercado recomendado",
        p_description: typeof body.description === "string" ? body.description : "",
        p_category_tag: typeof body.categoryTag === "string" ? body.categoryTag : "general",
        p_zone_label:
          typeof body.zoneLabel === "string" ? body.zoneLabel : "Bogotá · Chapinero",
        p_items_payload: itemsPayload,
        p_active_diet_filters: Array.isArray(body.activeDietFilters)
          ? body.activeDietFilters
          : [],
        p_estimated_total_cop:
          typeof body.estimatedTotalCop === "number" ? body.estimatedTotalCop : 0,
        p_estimated_savings_cop:
          typeof body.estimatedSavingsCop === "number" ? body.estimatedSavingsCop : 0,
        p_estimated_savings_pct:
          typeof body.estimatedSavingsPct === "number" ? body.estimatedSavingsPct : 0,
        p_store_summary:
          typeof body.storeSummary === "string" ? body.storeSummary : "Multi-tienda",
        p_avg_sabiometro:
          typeof body.avgSabiometro === "number" ? body.avgSabiometro : null,
      },
    );
    return NextResponse.json(res, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error("[api/community-baskets POST publish]", error);
    return NextResponse.json(
      { error: "No fue posible publicar el mercado en la comunidad." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
