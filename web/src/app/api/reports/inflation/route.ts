import { NextRequest, NextResponse } from "next/server";

import {
  checkFeatureGateOrRespond,
  PRIVATE_NO_STORE_HEADERS,
  requireSupabaseOrRespond,
} from "@/lib/apiWorkspaceAuth";
import { supabaseRpc } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("personal_inflation", request);
  if (gateResp) return gateResp;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const masterIds = Array.isArray(body.masterProductIds)
    ? body.masterProductIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  const storeIds = Array.isArray(body.preferredStoreIds)
    ? body.preferredStoreIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : null;

  const dateB =
    typeof body.dateB === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dateB)
      ? body.dateB
      : new Date().toISOString().slice(0, 10);
  const defaultDateA = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const dateA =
    typeof body.dateA === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dateA)
      ? body.dateA
      : defaultDateA;

  if (masterIds.length === 0) {
    return NextResponse.json({ rows: [], dateA, dateB }, { headers: PRIVATE_NO_STORE_HEADERS });
  }

  const sb = requireSupabaseOrRespond();
  if (sb.errorResponse) {
    return NextResponse.json({ rows: [], dateA, dateB, isDemoData: true }, { headers: PRIVATE_NO_STORE_HEADERS });
  }

  try {
    const rows = await supabaseRpc<
      Array<{
        master_product_id: string;
        price_a: number | string | null;
        price_b: number | string | null;
        earliest_day: string | null;
        latest_day: string | null;
      }>
    >(sb.config, "personal_inflation_lookup", {
      p_master_ids: masterIds,
      p_date_a: dateA,
      p_date_b: dateB,
      p_store_ids: storeIds && storeIds.length > 0 ? storeIds : null,
    });

    return NextResponse.json(
      {
        dateA,
        dateB,
        rows: rows.map((r) => ({
          masterProductId: r.master_product_id,
          priceACop: r.price_a !== null ? Number(r.price_a) : null,
          priceBCop: r.price_b !== null ? Number(r.price_b) : null,
          earliestDay: r.earliest_day,
          latestDay: r.latest_day,
        })),
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[api/reports/inflation POST]", error);
    return NextResponse.json(
      { error: "No fue posible consultar precios históricos de inflación." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
