import { NextRequest, NextResponse } from "next/server";

import { getSupabaseConfig, supabaseRpc } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ masterId: string }> },
) {
  const { masterId } = await context.params;
  const cleanId = (masterId ?? "").trim();
  if (!cleanId) {
    return NextResponse.json({ error: "masterId requerido." }, { status: 400 });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json(
      {
        score: null,
        satisfactionDistribution: { fixedBuy: 0, fairPrice: 0, overpriced: 0, badBuy: 0 },
        yieldDistribution: { doubleYield: 0, standardYield: 0, lowYield: 0 },
        comments: [],
      },
      { headers: { "Cache-Control": "public, s-maxage=60" } },
    );
  }

  try {
    const detail = await supabaseRpc<Record<string, unknown>>(config, "get_sabiometro_detail", {
      p_master_product_id: cleanId,
    });
    return NextResponse.json(detail, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("[api/sabiometro GET]", error);
    return NextResponse.json(
      { error: "No fue posible consultar el detalle del Sabiómetro." },
      { status: 500 },
    );
  }
}
