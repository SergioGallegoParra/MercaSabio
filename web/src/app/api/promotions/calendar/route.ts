import { NextRequest, NextResponse } from "next/server";

import { checkFeatureGateOrRespond } from "@/lib/apiWorkspaceAuth";
import { getSupabaseConfig, supabaseRestGet } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const gateResp = checkFeatureGateOrRespond("payment_calendar", request);
  if (gateResp) return gateResp;

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json(
      { partners: [], promotions: [], storePromoDays: [], isDemoData: true },
      { headers: { "Cache-Control": "public, s-maxage=300" } },
    );
  }

  try {
    const [partners, promotions, storePromoDays] = await Promise.all([
      supabaseRestGet<unknown[]>(
        config,
        "payment_partners?select=id,name,partner_type,logo_url&active=eq.true&order=name.asc",
      ),
      supabaseRestGet<unknown[]>(
        config,
        "payment_promotions?select=*&active=eq.true&order=id.asc",
      ),
      supabaseRestGet<unknown[]>(
        config,
        "store_promo_days?select=*&active=eq.true&order=id.asc",
      ),
    ]);

    return NextResponse.json(
      { partners, promotions, storePromoDays },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" } },
    );
  } catch (error) {
    console.error("[api/promotions/calendar GET]", error);
    return NextResponse.json(
      { error: "No fue posible consultar promociones de medios de pago." },
      { status: 500 },
    );
  }
}
